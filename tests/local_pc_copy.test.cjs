const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalPcStore } = require('../electron/local_pc.cjs');

// Function Test Folder
async function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-pc-copy-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = path.join(root, 'Saves');
  const folder = path.join(saves, 'PPSA12345');
  const output = path.join(root, 'export');
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(output);
  const source = path.join(folder, 'DATA');
  fs.writeFileSync(source, 'encrypted save');
  const store = new LocalPcStore({ stateFile: path.join(root, 'settings', 'local-pc.json'),
    backupRoot: path.join(root, 'backups'), stagingRoot: path.join(root, 'staging') });
  const { entries } = await store.setRoot(saves);
  return { store, id: entries[0].id, source, output, destination: path.join(output, 'DATA') };
}

test('an export removes its new destination when closing the copied file fails', { concurrency: false }, async t => {
  const { store, id, source, output, destination } = await fixture(t);
  const originalOpen = fsp.open;
  const closeFailure = new Error('simulated close failure');
  fsp.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] !== destination) return handle;
    let closed = false;
    return {
      sync: () => handle.sync(),
      close: async () => {
        if (!closed) { await handle.close(); closed = true; }
        throw closeFailure;
      },
    };
  };
  try { await assert.rejects(store.export(id, 'DATA', output), error => error === closeFailure); }
  finally { fsp.open = originalOpen; }
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'encrypted save');
});

test('an export preserves its sync error when closing and removal also fail', { concurrency: false }, async t => {
  const { store, id, output, destination } = await fixture(t);
  const original = { open: fsp.open, rm: fsp.rm };
  const syncFailure = new Error('simulated sync failure');
  let closes = 0;
  let removals = 0;
  fsp.open = async (...args) => {
    const handle = await original.open(...args);
    if (args[0] !== destination) return handle;
    let closed = false;
    return {
      sync: async () => { throw syncFailure; },
      close: async () => {
        closes++;
        if (!closed) { await handle.close(); closed = true; }
        throw new Error('simulated cleanup close failure');
      },
    };
  };
  fsp.rm = async (selected, ...args) => {
    if (selected !== destination) return original.rm(selected, ...args);
    removals++;
    throw new Error('simulated cleanup removal failure');
  };
  try { await assert.rejects(store.export(id, 'DATA', output), error => error === syncFailure); }
  finally { Object.assign(fsp, original); }
  assert.ok(closes > 0, 'cleanup must attempt to close the destination handle');
  assert.ok(removals > 0, 'cleanup must attempt to remove the destination');
});

test('an exclusive copy collision preserves a file created after export validation', { concurrency: false }, async t => {
  const { store, id, output, destination } = await fixture(t);
  const originalCopy = fsp.copyFile;
  let collision = false;
  fsp.copyFile = async (source, selected, ...args) => {
    if (selected === destination && !collision) {
      collision = true;
      fs.writeFileSync(destination, 'user file created during export');
    }
    return originalCopy(source, selected, ...args);
  };
  try { await assert.rejects(store.export(id, 'DATA', output), error => error.code === 'EEXIST'); }
  finally { fsp.copyFile = originalCopy; }
  assert.equal(collision, true);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'user file created during export');
});

test('upload registration uses its validated staging parent after copying', { concurrency: false }, async t => {
  const { store, id } = await fixture(t);
  const original = { copyFile: fsp.copyFile, realpath: fsp.realpath };
  let copied = false;
  let lateLookups = 0;
  fsp.copyFile = async (...args) => {
    await original.copyFile(...args);
    copied = true;
  };
  fsp.realpath = async (selected, ...args) => {
    if (selected === store.stagingRoot && copied) {
      lateLookups++;
      throw new Error('staging parent lookup failed after copy');
    }
    return original.realpath(selected, ...args);
  };
  let stage;
  try { stage = await store.prepareUpload(id); }
  finally { Object.assign(fsp, original); }
  assert.equal(copied, true);
  assert.equal(lateLookups, 0);
  assert.equal(fs.readFileSync(path.join(stage.folder, 'DATA'), 'utf8'), 'encrypted save');
  const releaseLease = store.retainUpload(stage.stageId, stage.folder);
  assert.equal(await store.releaseUpload(stage.stageId), false);
  assert.equal(fs.existsSync(stage.folder), true);
  await releaseLease();
  assert.equal(fs.existsSync(path.dirname(stage.folder)), false);
});
