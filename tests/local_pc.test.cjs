const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalPcStore } = require('../electron/local_pc.cjs');

// Function Test Folder
function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-local-pc-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = path.join(root, 'Saves');
  fs.mkdirSync(saves);
  const settings = {
    stateFile: path.join(root, 'settings', 'local-pc.json'),
    backupRoot: path.join(root, 'app-backups'),
    stagingRoot: path.join(root, 'app-staging'),
  };
  return { root, saves, settings, store: new LocalPcStore(settings) };
}

// Function Test Save
function save(folder, filename = 'sdimg_DATA', data = 'encrypted save') {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, filename);
  fs.writeFileSync(file, data);
  return file;
}

test('PC inventory separates source users and includes saves without a user', async (t) => {
  const { saves, store } = fixture(t);
  const first = save(path.join(saves, 'UserOne', 'PPSA12345'));
  const second = save(path.join(saves, 'UserTwo', 'PPSA12345'));
  const third = save(path.join(saves, 'PPSA54321'));
  const result = await store.setRoot(saves);
  assert.equal(result.root, fs.realpathSync.native(saves));
  assert.equal(result.active, true);
  assert.equal(result.entries.length, 3);
  assert.equal(new Set(result.entries.map((entry) => entry.id)).size, 3);
  assert.deepEqual(new Set(result.entries.map((entry) => entry.owner)), new Set(['userone', 'usertwo', 'unassigned']));
  assert.ok(result.entries.every((entry) => entry.localSource === 'pc'));
  assert.ok(result.users.some((user) => user.id === 'unassigned' && /unassigned/i.test(user.name)));
  for (const file of [first, second, third]) {
    assert.equal(fs.readFileSync(file, 'utf8'), 'encrypted save');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['sdimg_DATA']);
  }
  const again = await store.inventory();
  assert.deepEqual(again.entries.map((entry) => entry.id), result.entries.map((entry) => entry.id));
});

test('PC root selection accepts the Saves parent, a user and a direct title folder', async (t) => {
  const { root, saves, store } = fixture(t);
  const game = path.join(saves, '18C60EA2', 'PPSA12345');
  save(game);
  assert.equal((await store.setRoot(root)).entries.length, 1);
  const user = await store.setRoot(path.dirname(game));
  assert.equal(user.entries.length, 1);
  assert.equal(user.entries[0].owner, '18c60ea2');
  const direct = await store.setRoot(game);
  assert.equal(direct.entries.length, 1);
  assert.equal(direct.entries[0].title, 'PPSA12345');
  assert.equal(await store.file(direct.entries[0].id, 'sdimg_DATA'), path.join(game, 'sdimg_DATA'));
});

test('PC inventory keeps readable saves when one sibling user folder cannot be read', { concurrency: false }, async (t) => {
  const { saves, store } = fixture(t);
  save(path.join(saves, 'PPSA12345'));
  save(path.join(saves, 'Readable', 'PPSA54321'));
  const blocked = path.join(saves, 'Z-Blocked');
  fs.mkdirSync(blocked);
  const fsp = require('node:fs/promises');
  const readdir = fsp.readdir;
  fsp.readdir = async (folder, options) => {
    if (folder === blocked) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return readdir(folder, options);
  };
  let result;
  try { result = await store.setRoot(saves); }
  finally { fsp.readdir = readdir; }
  assert.deepEqual(new Set(result.entries.map(entry => entry.title)), new Set(['PPSA12345', 'PPSA54321']));
  assert.ok(result.warnings.some(warning => warning.includes('Z-Blocked') && warning.includes('permission denied')));
});

test('PC folder and active selection persist without depending on transfer metadata', async (t) => {
  const { saves, settings, store } = fixture(t);
  save(path.join(saves, 'PPSA12345'));
  const empty = await store.inventory();
  assert.equal(empty.root, '');
  assert.deepEqual(empty.entries, []);
  await store.setRoot(saves);
  await store.setActive(false);
  const restored = await new LocalPcStore(settings).inventory();
  assert.equal(restored.root, fs.realpathSync.native(saves));
  assert.equal(restored.active, false);
  assert.equal(restored.entries.length, 1);
  const reactivated = new LocalPcStore(settings);
  await reactivated.setActive(true);
  assert.equal((await new LocalPcStore(settings).inventory()).active, true);
});

test('PC inventory ignores non-save files and keeps companion files with their container', async (t) => {
  const { saves, store } = fixture(t);
  const game = path.join(saves, 'PPSA12345');
  save(game, 'DATA', 'container');
  save(game, 'DATA.bin', 'companion');
  save(game, 'sdimg_sce_sdmemory', 'memory');
  for (const name of ['manifest.json', 'metadata.db', 'notes.txt', 'payload.exe', 'DATA.part', 'DATA.tmp', 'DATA.backup-123', '.sdimg_cache', 'sdimg_cache.tmp', 'sdimg_DATA.part']) save(game, name);
  save(game, 'empty.dat', '');
  save(path.join(game, 'nested'), 'hidden.save');
  const { entries, warnings } = await store.setRoot(saves);
  assert.equal(entries.length, 1);
  assert.deepEqual(new Set(entries[0].files.map((file) => file.file)), new Set(['DATA', 'sdimg_sce_sdmemory']));
  assert.ok(warnings.length > 0);
  assert.deepEqual(await store.inputs(entries[0].id, 'DATA'), [path.join(game, 'DATA'), path.join(game, 'DATA.bin')]);
  await assert.rejects(store.file(entries[0].id, 'DATA.bin'));
});

test('PC file actions reject forged IDs and paths outside the selected save', async (t) => {
  const { root, saves, store } = fixture(t);
  const game = path.join(saves, 'PPSA12345');
  save(game);
  const outside = save(root, 'private.dat', 'private');
  const { entries } = await store.setRoot(saves);
  await assert.rejects(store.file('../private.dat', 'private.dat'));
  await assert.rejects(store.file(entries[0].id, '../../private.dat'));
  await assert.rejects(store.file(entries[0].id, outside));
  await assert.rejects(store.prepareUpload('../private.dat'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'private');
});

test('PC inventory and actions do not follow a linked title folder', async (t) => {
  const { root, saves, store } = fixture(t);
  const game = path.join(saves, 'PPSA12345');
  save(game);
  const { entries } = await store.setRoot(saves);
  const moved = path.join(root, 'outside');
  fs.renameSync(game, moved);
  try { fs.symlinkSync(moved, game, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Folder links unavailable');
    throw error;
  }
  assert.deepEqual((await store.inventory()).entries, []);
  await assert.rejects(store.file(entries[0].id, 'sdimg_DATA'));
  assert.equal(fs.readFileSync(path.join(moved, 'sdimg_DATA'), 'utf8'), 'encrypted save');
});

test('PC actions recheck files that were replaced with links after scanning', async (t) => {
  const { root, saves, store } = fixture(t);
  const file = save(path.join(saves, 'PPSA12345'));
  const { entries } = await store.setRoot(saves);
  const outside = save(root, 'private.dat', 'private');
  fs.unlinkSync(file);
  try { fs.symlinkSync(outside, file, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('File links unavailable');
    throw error;
  }
  await assert.rejects(store.inputs(entries[0].id, 'sdimg_DATA'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'private');
});

test('PC replacement makes a recoverable backup and export does not overwrite a file', async (t) => {
  const { root, saves, store } = fixture(t);
  const file = save(path.join(saves, 'PPSA12345'), 'save.dat', 'old save');
  const replacement = save(path.join(root, 'replacement'), 'save.dat', 'edited save');
  const { entries } = await store.setRoot(saves);
  const result = await store.replace(entries[0].id, 'save.dat', replacement);
  assert.equal(result.destination, file);
  assert.equal(fs.readFileSync(file, 'utf8'), 'edited save');
  assert.equal(fs.readFileSync(result.backup, 'utf8'), 'old save');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['save.dat']);
  const destination = path.join(root, 'export');
  fs.mkdirSync(destination);
  const exported = await store.export(entries[0].id, 'save.dat', destination);
  assert.equal(fs.readFileSync(exported.destination, 'utf8'), 'edited save');
  await assert.rejects(store.export(entries[0].id, 'save.dat', destination));
  assert.equal(fs.readFileSync(exported.destination, 'utf8'), 'edited save');
});

test('PC paired-container replacement preserves old data and key together', async (t) => {
  const { root, saves, store } = fixture(t);
  const game = path.join(saves, 'PPSA12345');
  const file = save(game, 'DATA', 'old container');
  save(game, 'DATA.bin', 'old key');
  const replacement = save(path.join(root, 'replacement'), 'DATA', 'new container');
  const { entries } = await store.setRoot(saves);
  await assert.rejects(store.replace(entries[0].id, 'DATA', replacement));
  assert.equal(fs.readFileSync(file, 'utf8'), 'old container');
  assert.equal(fs.readFileSync(path.join(game, 'DATA.bin'), 'utf8'), 'old key');
  save(path.dirname(replacement), 'DATA.bin', 'new key');
  const result = await store.replace(entries[0].id, 'DATA', replacement);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new container');
  assert.equal(fs.readFileSync(path.join(game, 'DATA.bin'), 'utf8'), 'new key');
  assert.equal(fs.readFileSync(result.backup, 'utf8'), 'old container');
  assert.equal(fs.readFileSync(path.join(path.dirname(result.backup), 'DATA.bin'), 'utf8'), 'old key');
  const exported = path.join(root, 'paired-export');
  fs.mkdirSync(exported);
  await store.export(entries[0].id, 'DATA', exported);
  assert.equal(fs.readFileSync(path.join(exported, 'DATA'), 'utf8'), 'new container');
  assert.equal(fs.readFileSync(path.join(exported, 'DATA.bin'), 'utf8'), 'new key');
});

test('PC paired replacement rolls back if the second file cannot be installed', { concurrency: false }, async (t) => {
  const { root, saves, store } = fixture(t);
  const game = path.join(saves, 'PPSA12345');
  const file = save(game, 'DATA', 'old container');
  const key = save(game, 'DATA.bin', 'old key');
  const replacement = save(path.join(root, 'replacement'), 'DATA', 'new container');
  save(path.dirname(replacement), 'DATA.bin', 'new key');
  const { entries } = await store.setRoot(saves);
  const fsp = require('node:fs/promises');
  const rename = fsp.rename;
  let failed = false;
  fsp.rename = async (from, to) => {
    if (!failed && to === key) {
      failed = true;
      assert.equal(fs.readFileSync(file, 'utf8'), 'new container');
      throw Object.assign(new Error('simulated key rename failure'), { code: 'EACCES' });
    }
    return rename(from, to);
  };
  try {
    await assert.rejects(store.replace(entries[0].id, 'DATA', replacement), /simulated key rename failure/);
  } finally { fsp.rename = rename; }
  assert.equal(failed, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old container');
  assert.equal(fs.readFileSync(key, 'utf8'), 'old key');
  assert.deepEqual(new Set(fs.readdirSync(game)), new Set(['DATA', 'DATA.bin']));
});

test('PC upload staging snapshots all payloads for one title and source user', async (t) => {
  const { saves, store } = fixture(t);
  const game = path.join(saves, 'UserOne', 'PPSA12345');
  save(game, 'DATA', 'first');
  save(game, 'DATA.bin', 'key');
  save(game, 'sdimg_sce_sdmemory', 'memory');
  save(game, 'manifest.json', '{}');
  save(path.join(saves, 'UserTwo', 'PPSA12345'), 'save.dat', 'other user');
  save(path.join(saves, 'PPSA54321'), 'save.dat', 'other title');
  const { entries } = await store.setRoot(saves);
  const entry = entries.find((item) => item.owner === 'userone');
  const staged = await store.prepareUpload(entry.id);
  assert.equal(staged.titleId, 'PPSA12345');
  assert.deepEqual(new Set(fs.readdirSync(staged.folder)), new Set(['DATA', 'DATA.bin', 'sdimg_sce_sdmemory']));
  assert.equal(fs.readFileSync(path.join(staged.folder, 'DATA'), 'utf8'), 'first');
  save(game, 'DATA', 'changed later');
  assert.equal(fs.readFileSync(path.join(staged.folder, 'DATA'), 'utf8'), 'first');
  assert.deepEqual(new Set(fs.readdirSync(game)), new Set(['DATA', 'DATA.bin', 'sdimg_sce_sdmemory', 'manifest.json']));
});

test('PC upload staging removes only its old owned snapshots', async (t) => {
  const { saves, settings, store } = fixture(t);
  const game = path.join(saves, 'PPSA12345');
  save(game, 'DATA', 'first');
  const { entries } = await store.setRoot(saves);
  const first = await store.prepareUpload(entries[0].id);
  const unrelated = path.join(settings.stagingRoot, 'local-pc-upload-unowned');
  save(unrelated, 'keep.txt', 'keep me');
  save(game, 'DATA', 'second');
  const second = await store.prepareUpload(entries[0].id);
  assert.equal(fs.existsSync(first.folder), false);
  assert.equal(fs.readFileSync(path.join(second.folder, 'DATA'), 'utf8'), 'second');
  assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep me');
});

test('PC folder disappearance and empty replacement are handled without changing source data', async (t) => {
  const { root, saves, store } = fixture(t);
  const game = path.join(saves, 'PPSA12345');
  const file = save(game, 'save.dat', 'original');
  const { entries } = await store.setRoot(saves);
  const empty = save(path.join(root, 'replacement'), 'save.dat', '');
  await assert.rejects(store.replace(entries[0].id, 'save.dat', empty));
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  fs.rmSync(saves, { recursive: true });
  const inventory = await store.inventory();
  assert.deepEqual(inventory.entries, []);
  assert.ok(inventory.warnings.length > 0);
  await assert.rejects(store.file(entries[0].id, 'save.dat'));
});
