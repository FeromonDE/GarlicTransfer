const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalPcStore } = require('../electron/local_pc.cjs');

// Function Test Folder
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-pc-scan-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = path.join(root, 'Saves');
  fs.mkdirSync(saves);
  const settings = { stateFile: path.join(root, 'settings', 'local-pc.json'),
    backupRoot: path.join(root, 'backups'), stagingRoot: path.join(root, 'staging') };
  return { root, saves, settings, store: new LocalPcStore(settings) };
}

// Function Test Save
function save(folder, name = 'DATA', contents = 'encrypted save') {
  fs.mkdirSync(folder, { recursive: true });
  const selected = path.join(folder, name);
  fs.writeFileSync(selected, contents);
  return selected;
}

// Function Scan Guard
async function withoutFolders(folders, action) {
  const readdir = fsp.readdir;
  const reads = [];
  fsp.readdir = async (selected, options) => {
    const folder = path.resolve(String(selected));
    reads.push(folder);
    assert.ok(!folders.some(blocked => folder === blocked || folder.startsWith(blocked + path.sep)),
      `read an unrelated save folder: ${folder}`);
    return readdir(selected, options);
  };
  try { await action(); }
  finally { fsp.readdir = readdir; }
  assert.ok(!reads.some(folder => folders.some(blocked => folder === blocked || folder.startsWith(blocked + path.sep))),
    'selected save operations must not attempt to read unrelated folders');
  return reads;
}

test('saved Local PC status does not scan or touch the selected drive', { concurrency: false }, async t => {
  const { saves, settings, store } = fixture(t);
  save(path.join(saves, 'PPSA12345'));
  await store.setRoot(saves);
  await store.setActive(false);
  const restored = new LocalPcStore(settings);
  assert.deepEqual(await restored.status(), { root: fs.realpathSync(saves), active: false, warnings: [] });
  const original = {};
  for (const name of ['readdir', 'lstat', 'stat', 'realpath', 'readFile']) {
    original[name] = fsp[name];
    fsp[name] = async () => { throw new Error(`status must not call ${name}`); };
  }
  try {
    assert.deepEqual(await restored.status(), { root: fs.realpathSync(saves), active: false, warnings: [] });
  } finally {
    for (const [name, method] of Object.entries(original)) fsp[name] = method;
  }
});

test('selected save operations skip unrelated titles and source users', { concurrency: false }, async t => {
  const { root, saves, store } = fixture(t);
  const selected = path.join(saves, 'UserOne', 'PPSA12345');
  const file = save(selected);
  const unrelated = [path.join(saves, 'OtherUser'), path.join(saves, 'UserOne', 'PPSA54321'),
    path.join(saves, 'PPSA33333')];
  for (const folder of unrelated) save(folder.endsWith('OtherUser') ? path.join(folder, 'PPSA22222') : folder);
  const inventory = await store.setRoot(root);
  const entry = inventory.entries.find(item => item.title === 'PPSA12345');
  const replacement = save(path.join(root, 'replacement'), 'DATA', 'updated encrypted save');
  const destination = path.join(root, 'export');
  fs.mkdirSync(destination);
  const reads = await withoutFolders(unrelated, async () => {
    assert.equal(await store.file(entry.id, 'DATA'), file);
    assert.deepEqual(await store.inputs(entry.id, 'DATA'), [file]);
    const backup = await store.backup(entry.id, 'DATA');
    assert.equal(fs.readFileSync(backup, 'utf8'), 'encrypted save');
    await store.replace(entry.id, 'DATA', replacement);
    await store.export(entry.id, 'DATA', destination);
    const staged = await store.prepareUpload(entry.id);
    assert.equal(fs.readFileSync(path.join(staged.folder, 'DATA'), 'utf8'), 'updated encrypted save');
    await store.releaseUpload(staged.stageId);
  });
  assert.ok(reads.includes(selected));
  assert.equal(fs.readFileSync(path.join(destination, 'DATA'), 'utf8'), 'updated encrypted save');
});

test('selected-title checks remain valid for every supported root layout', async t => {
  const { root, saves, store } = fixture(t);
  const userTitle = path.join(saves, 'Account', 'PPSA12345');
  const directTitle = path.join(saves, 'PPSA54321');
  const first = save(userTitle);
  const second = save(directTitle);
  for (const [folder, title, selected] of [[root, 'PPSA12345', first], [saves, 'PPSA54321', second],
    [path.dirname(userTitle), 'PPSA12345', first], [userTitle, 'PPSA12345', first]]) {
    const result = await store.setRoot(folder);
    const entry = result.entries.find(item => item.title === title);
    assert.ok(entry, `missing title for ${folder}`);
    assert.equal(await store.file(entry.id, 'DATA'), selected);
    const staged = await store.prepareUpload(entry.id);
    assert.equal(staged.titleId, title);
    assert.equal(fs.readFileSync(path.join(staged.folder, 'DATA'), 'utf8'), 'encrypted save');
    await store.releaseUpload(staged.stageId);
  }
});

test('selected title IDs stay inside the discovered Saves and user layouts', async t => {
  const { root, saves, store } = fixture(t);
  save(path.join(saves, 'Account', 'PPSA12345'));
  save(path.join(root, 'PPSA22222'));
  const user = path.join(saves, 'Account');
  save(path.join(user, 'Nested', 'PPSA33333'));
  const parent = await store.setRoot(root);
  assert.deepEqual(parent.entries.map(entry => entry.id), ['Saves/Account/PPSA12345']);
  await assert.rejects(store.file('PPSA22222', 'DATA'));
  await assert.rejects(store.prepareUpload('PPSA22222'));
  const owner = await store.setRoot(user);
  assert.deepEqual(owner.entries.map(entry => entry.id), ['PPSA12345']);
  await assert.rejects(store.file('Nested/PPSA33333', 'DATA'));
  await assert.rejects(store.prepareUpload('Nested/PPSA33333'));
});

test('a direct lowercase title folder uses its canonical uppercase entry ID', async t => {
  const { saves, store } = fixture(t);
  const folder = path.join(saves, 'ppsa12345');
  const selected = save(folder);
  const { entries } = await store.setRoot(folder);
  assert.deepEqual(entries.map(entry => entry.id), ['PPSA12345']);
  assert.equal(await store.file('PPSA12345', 'DATA'), selected);
  const staged = await store.prepareUpload('PPSA12345');
  assert.equal(staged.titleId, 'PPSA12345');
  await store.releaseUpload(staged.stageId);
  await assert.rejects(store.file('ppsa12345', 'DATA'));
  await assert.rejects(store.prepareUpload('ppsa12345'));
});

test('fresh title validation sees added sidecars and rejects files removed after inventory', async t => {
  const { saves, store } = fixture(t);
  const folder = path.join(saves, 'PPSA12345');
  const selected = save(folder);
  const { entries } = await store.setRoot(saves);
  const companion = save(folder, 'DATA.bin', 'new companion');
  assert.deepEqual(await store.inputs(entries[0].id, 'DATA'), [selected, companion]);
  const stage = await store.prepareUpload(entries[0].id);
  assert.deepEqual(new Set(fs.readdirSync(stage.folder)), new Set(['DATA', 'DATA.bin']));
  await store.releaseUpload(stage.stageId);
  fs.unlinkSync(selected);
  await assert.rejects(store.file(entries[0].id, 'DATA'));
});

test('fresh file validation rejects empty, directory and unsupported replacements', async t => {
  for (const replacement of ['empty', 'directory', 'unsupported']) {
    await t.test(replacement, async t => {
      const { saves, store } = fixture(t);
      const folder = path.join(saves, 'PPSA12345');
      const selected = save(folder);
      const { entries } = await store.setRoot(saves);
      fs.unlinkSync(selected);
      if (replacement === 'empty') fs.writeFileSync(selected, '');
      else if (replacement === 'directory') fs.mkdirSync(selected);
      else save(folder, 'DATA.exe', 'unsupported replacement');
      await assert.rejects(store.file(entries[0].id, 'DATA'));
      await assert.rejects(store.prepareUpload(entries[0].id));
      if (replacement === 'unsupported') await assert.rejects(store.file(entries[0].id, 'DATA.exe'));
    });
  }
});

test('fresh file validation refuses a save replaced by a link', async t => {
  const { root, saves, store } = fixture(t);
  const folder = path.join(saves, 'PPSA12345');
  const selected = save(folder);
  const { entries } = await store.setRoot(saves);
  const outside = save(root, 'outside.dat', 'private data');
  fs.unlinkSync(selected);
  try { fs.symlinkSync(outside, selected, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('File links unavailable');
    throw error;
  }
  await assert.rejects(store.file(entries[0].id, 'DATA'));
  await assert.rejects(store.prepareUpload(entries[0].id));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'private data');
});

test('fresh selected-title validation rejects case-conflicting payloads', async t => {
  const { saves, store } = fixture(t);
  const folder = path.join(saves, 'PPSA12345');
  save(folder);
  const { entries } = await store.setRoot(saves);
  save(folder, 'data', 'conflicting save');
  if (fs.readdirSync(folder).length !== 2) return t.skip('Filesystem does not allow case-distinct names');
  await assert.rejects(store.inputs(entries[0].id, 'DATA'));
  await assert.rejects(store.prepareUpload(entries[0].id));
});

test('fresh selected-title validation rejects ambiguous sidecars', async t => {
  const { saves, store } = fixture(t);
  const folder = path.join(saves, 'PPSA12345');
  save(folder);
  save(folder, 'DATA.bin', 'first companion');
  const { entries } = await store.setRoot(saves);
  save(folder, 'data.BIN', 'second companion');
  if (fs.readdirSync(folder).length !== 3) return t.skip('Filesystem does not allow case-distinct names');
  await assert.rejects(store.inputs(entries[0].id, 'DATA'));
  await assert.rejects(store.prepareUpload(entries[0].id));
});

test('title lookup rejects hidden, too-deep, differently cased and traversal IDs', async t => {
  const { saves, store } = fixture(t);
  save(path.join(saves, 'Account', 'PPSA12345'));
  save(path.join(saves, '.Hidden', 'PPSA22222'));
  save(path.join(saves, 'Account', 'Nested', 'PPSA33333'));
  const { entries } = await store.setRoot(saves);
  const id = entries[0].id;
  assert.equal(id, 'Account/PPSA12345');
  for (const invalid of ['.Hidden/PPSA22222', 'Account/Nested/PPSA33333', id.toLowerCase(),
    '../PPSA12345', 'Account/../PPSA12345', '/PPSA12345', 'Account\\PPSA12345', 'Account/PPSA12345/']) {
    await assert.rejects(store.file(invalid, 'DATA'), invalid);
    await assert.rejects(store.prepareUpload(invalid), invalid);
  }
});

test('fresh title lookup refuses a directory replaced by a link', async t => {
  const { root, saves, store } = fixture(t);
  const folder = path.join(saves, 'PPSA12345');
  save(folder);
  const { entries } = await store.setRoot(saves);
  const outside = path.join(root, 'outside');
  fs.renameSync(folder, outside);
  try { fs.symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Directory links unavailable');
    throw error;
  }
  await assert.rejects(store.file(entries[0].id, 'DATA'));
  await assert.rejects(store.prepareUpload(entries[0].id));
  assert.equal(fs.readFileSync(path.join(outside, 'DATA'), 'utf8'), 'encrypted save');
});

test('inventory reuses verified file attributes within a scan', { concurrency: false }, async t => {
  const { saves, store } = fixture(t);
  const selected = save(path.join(saves, 'PPSA12345'));
  await store.setRoot(saves);
  const original = { lstat: fsp.lstat, stat: fsp.stat };
  const calls = { lstat: 0, stat: 0 };
  for (const name of Object.keys(original)) {
    fsp[name] = async (file, ...args) => {
      if (String(file) === selected) calls[name]++;
      return original[name](file, ...args);
    };
  }
  let inventory;
  try { inventory = await store.inventory(); }
  finally { Object.assign(fsp, original); }
  assert.equal(inventory.entries[0].files[0].size, Buffer.byteLength('encrypted save'));
  assert.equal(calls.lstat, 1, 'a scanned save should be validated once');
  assert.equal(calls.stat, 0, 'reuse the file attributes obtained during validation');
});
