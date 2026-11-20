const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { writeEditedFile, addWorkspaceFiles } = require('../electron/workspace_io.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-edit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'save.dat');
  await fs.writeFile(selected, 'original');
  await fs.writeFile(`${selected}.save-editor.tmp`, 'user temporary file');
  return { root, selected };
}

function isolatedWorkspace(overrides = {}, uuid = 'owned-test', streamOverrides = {}) {
  const module = { exports: {} };
  const filename = path.join(__dirname, '../electron/workspace_io.cjs');
  const context = vm.createContext({ module, require: name => {
    if (name === 'node:fs/promises') return { ...fs, ...overrides };
    if (name === 'node:fs') return { ...syncFs, ...streamOverrides };
    if (name === 'node:crypto') return { randomUUID: () => uuid };
    return require(name);
  } });
  new vm.Script(syncFs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
  return module.exports;
}

function isolatedWriter(...args) {
  return isolatedWorkspace(...args).writeEditedFile;
}

async function addFixture(t, names = ['first.dat', 'second.dat']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-add-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'keep.dat'), 'existing user file');
  const sources = [];
  for (const [index, name] of names.entries()) {
    const folder = path.join(root, `source-${index}`);
    await fs.mkdir(folder);
    const source = path.join(folder, name);
    const data = Buffer.from([index, 0, 255, 128]);
    await fs.writeFile(source, data);
    sources.push({ source, name, data });
  }
  return { workspace, sources, paths: sources.map(file => file.source) };
}

async function assertSourcesUnchanged(sources) {
  for (const file of sources) assert.deepEqual(await fs.readFile(file.source), file.data);
}

test('edited file replaces the original and leaves unrelated temporary files intact', async t => {
  const { root, selected } = await fixture(t);
  await writeEditedFile(selected, Buffer.from('edited bytes'));
  assert.equal(await fs.readFile(selected, 'utf8'), 'edited bytes');
  assert.equal(await fs.readFile(`${selected}.save-editor.tmp`, 'utf8'), 'user temporary file');
  assert.deepEqual((await fs.readdir(root)).sort(), ['save.dat', 'save.dat.save-editor.tmp']);
});

test('rename failure removes only its own stage after the file handle is closed', async t => {
  const { root, selected } = await fixture(t);
  const failure = Object.assign(new Error('file is locked'), { code: 'EACCES' });
  const stage = path.join(root, '.garlic-edit-owned-test.tmp');
  let closed = false;
  const writer = isolatedWriter({
    open: async (...args) => {
      const handle = await fs.open(...args);
      return {
        writeFile: data => handle.writeFile(data),
        sync: () => handle.sync(),
        close: async () => { await handle.close(); closed = true; },
      };
    },
    rename: async (source, destination) => {
      assert.equal(source, stage);
      assert.equal(closed, true);
      assert.equal(destination, selected);
      assert.equal(closed, true);
      assert.equal(await fs.readFile(source, 'utf8'), 'edited');
      throw failure;
    },
  });
  await assert.rejects(writer(selected, Buffer.from('edited')), error => error === failure);
  assert.equal(await fs.readFile(selected, 'utf8'), 'original');
  assert.equal(await fs.readFile(`${selected}.save-editor.tmp`, 'utf8'), 'user temporary file');
  assert.deepEqual((await fs.readdir(root)).sort(), ['save.dat', 'save.dat.save-editor.tmp']);
});

test('partial write failure closes the file, removes its stage and preserves the original', async t => {
  const { root, selected } = await fixture(t);
  const failure = Object.assign(new Error('disk is full'), { code: 'ENOSPC' });
  let closed = false;
  let renamed = false;
  const writer = isolatedWriter({
    open: async (...args) => {
      const handle = await fs.open(...args);
      return {
        writeFile: async () => { await handle.writeFile('partial'); throw failure; },
        sync: () => handle.sync(),
        close: async () => { await handle.close(); closed = true; },
      };
    },
    rename: async () => { renamed = true; },
  });
  await assert.rejects(writer(selected, Buffer.from('edited')), error => error === failure);
  assert.equal(closed, true);
  assert.equal(renamed, false);
  assert.equal(await fs.readFile(selected, 'utf8'), 'original');
  assert.deepEqual((await fs.readdir(root)).sort(), ['save.dat', 'save.dat.save-editor.tmp']);
});

test('exclusive stage creation failure does not delete a pre-existing file', async t => {
  const { root, selected } = await fixture(t);
  const stage = path.join(root, '.garlic-edit-owned-test.tmp');
  await fs.writeFile(stage, 'someone else owns this file');
  const writer = isolatedWriter();
  await assert.rejects(writer(selected, Buffer.from('edited')), { code: 'EEXIST' });
  assert.equal(await fs.readFile(selected, 'utf8'), 'original');
  assert.equal(await fs.readFile(stage, 'utf8'), 'someone else owns this file');
});

test('adding files copies a full batch and returns the completion result without staging files', async t => {
  const { workspace, sources, paths } = await addFixture(t);
  const result = { refreshed: true };
  const returned = await addWorkspaceFiles(workspace, paths, async () => {
    assert.deepEqual((await fs.readdir(workspace)).sort(), ['first.dat', 'keep.dat', 'second.dat']);
    for (const file of sources) {
      assert.deepEqual(await fs.readFile(path.join(workspace, file.name)), file.data);
    }
    return result;
  });
  assert.equal(returned, result);
  assert.equal(await fs.readFile(path.join(workspace, 'keep.dat'), 'utf8'), 'existing user file');
  await assertSourcesUnchanged(sources);
});

test('duplicate portable basenames are rejected before copying any selected files', async t => {
  const { workspace, sources, paths } = await addFixture(t, ['SAVE.dat', 'save.DAT']);
  let copied = false;
  const { addWorkspaceFiles: add } = isolatedWorkspace({
    copyFile: async () => { copied = true; },
  });
  await assert.rejects(add(workspace, paths), { code: 'EEXIST' });
  assert.equal(copied, false);
  assert.deepEqual(await fs.readdir(workspace), ['keep.dat']);
  await assertSourcesUnchanged(sources);
});

test('existing destination names are protected before any file in the batch is copied', async t => {
  const { workspace, sources, paths } = await addFixture(t, ['new.dat', 'KEEP.DAT']);
  let copied = false;
  const { addWorkspaceFiles: add } = isolatedWorkspace({
    copyFile: async () => { copied = true; },
  });
  await assert.rejects(add(workspace, paths), { code: 'EEXIST' });
  assert.equal(copied, false);
  assert.deepEqual(await fs.readdir(workspace), ['keep.dat']);
  assert.equal(await fs.readFile(path.join(workspace, 'keep.dat'), 'utf8'), 'existing user file');
  await assertSourcesUnchanged(sources);
});

test('a partial staging copy failure removes the full batch and preserves user files', async t => {
  const { workspace, sources, paths } = await addFixture(t);
  const failure = Object.assign(new Error('disk is full'), { code: 'ENOSPC' });
  let copied = 0;
  const { addWorkspaceFiles: add } = isolatedWorkspace({
    copyFile: async (source, destination, flags) => {
      assert.equal(flags, syncFs.constants.COPYFILE_EXCL);
      if (++copied === 2) {
        await fs.writeFile(destination, 'partial copy', { flag: 'wx' });
        throw failure;
      }
      await fs.copyFile(source, destination, flags);
    },
  });
  await assert.rejects(add(workspace, paths), error => error === failure);
  assert.deepEqual(await fs.readdir(workspace), ['keep.dat']);
  assert.equal(await fs.readFile(path.join(workspace, 'keep.dat'), 'utf8'), 'existing user file');
  await assertSourcesUnchanged(sources);
});

test('a publish stream failure rolls back both the current file and earlier additions', async t => {
  const { workspace, sources, paths } = await addFixture(t);
  const failure = Object.assign(new Error('could not read staged file'), { code: 'EIO' });
  const { addWorkspaceFiles: add } = isolatedWorkspace({}, 'owned-test', {
    createReadStream: filename => path.basename(filename) === '1'
      ? Readable.from((async function* () { yield Buffer.from('partial'); throw failure; })())
      : syncFs.createReadStream(filename),
  });
  await assert.rejects(add(workspace, paths), error => error === failure);
  assert.deepEqual(await fs.readdir(workspace), ['keep.dat']);
  assert.equal(await fs.readFile(path.join(workspace, 'keep.dat'), 'utf8'), 'existing user file');
  await assertSourcesUnchanged(sources);
});

test('a destination appearing during publication is preserved while earlier additions roll back', async t => {
  const { workspace, sources, paths } = await addFixture(t);
  const collision = path.join(workspace, 'second.dat');
  const { addWorkspaceFiles: add } = isolatedWorkspace({
    open: async (filename, ...args) => {
      if (filename === collision) await fs.writeFile(filename, 'new user file', { flag: 'wx' });
      return fs.open(filename, ...args);
    },
  });
  await assert.rejects(add(workspace, paths), { code: 'EEXIST' });
  assert.deepEqual((await fs.readdir(workspace)).sort(), ['keep.dat', 'second.dat']);
  assert.equal(await fs.readFile(collision, 'utf8'), 'new user file');
  assert.equal(await fs.readFile(path.join(workspace, 'keep.dat'), 'utf8'), 'existing user file');
  await assertSourcesUnchanged(sources);
});

test('a failed completion refresh rolls back additions after staging has been removed', async t => {
  const { workspace, sources, paths } = await addFixture(t);
  const failure = new Error('workspace refresh failed');
  await assert.rejects(addWorkspaceFiles(workspace, paths, async () => {
    assert.deepEqual((await fs.readdir(workspace)).sort(), ['first.dat', 'keep.dat', 'second.dat']);
    throw failure;
  }), error => error === failure);
  assert.deepEqual(await fs.readdir(workspace), ['keep.dat']);
  assert.equal(await fs.readFile(path.join(workspace, 'keep.dat'), 'utf8'), 'existing user file');
  await assertSourcesUnchanged(sources);
});
