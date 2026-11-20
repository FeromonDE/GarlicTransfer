const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SaveTemps } = require('../electron/save_temps.cjs');
const { LocalPcStore } = require('../electron/local_pc.cjs');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-owned-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('temporary release accepts only owned IDs and preserves selected folders and backups', async t => {
  const root = await fixture(t);
  const temps = new SaveTemps(path.join(root, 'temporary'));
  const selected = path.join(root, 'user-files');
  await fs.mkdir(selected);
  await fs.writeFile(path.join(selected, 'save.dat'), 'user save');
  const owned = await temps.create();
  await fs.writeFile(path.join(owned.directory, 'input.zip'), 'input');
  assert.equal(await temps.release(selected), false);
  assert.equal(await temps.release(owned.directory), false);
  assert.equal(await temps.release(owned.id), true);
  assert.equal(await temps.release(owned.id), false);
  assert.equal(await fs.readFile(path.join(selected, 'save.dat'), 'utf8'), 'user save');
});

test('closing an owned workspace defers deletion until its active job releases it', async t => {
  const root = await fixture(t);
  const temps = new SaveTemps(path.join(root, 'temporary'));
  const owned = await temps.create();
  const workspace = path.join(owned.directory, 'workspace');
  await fs.mkdir(workspace);
  const releaseUse = temps.use(workspace);
  assert.equal(await temps.release(owned.id), false);
  assert.equal((await fs.stat(workspace)).isDirectory(), true);
  assert.throws(() => temps.use(workspace), /already been closed/);
  await releaseUse();
  await assert.rejects(fs.access(owned.directory), { code: 'ENOENT' });
});

test('prepared upload staging survives active use and is deleted after the consumer closes', async t => {
  const root = await fixture(t);
  const saves = path.join(root, 'Saves');
  const title = path.join(saves, 'PPSA12345');
  await fs.mkdir(title, { recursive: true });
  await fs.writeFile(path.join(title, 'sdimg_DATA'), 'original');
  const store = new LocalPcStore({ stateFile: path.join(root, 'settings.json'),
    backupRoot: path.join(root, 'backups'), stagingRoot: path.join(root, 'staging') });
  const inventory = await store.setRoot(saves);
  const stage = await store.prepareUpload(inventory.entries[0].id);
  const release = store.retainUpload(stage.stageId, stage.folder);
  assert.equal(await store.releaseUpload(stage.stageId), false);
  const next = await store.prepareUpload(inventory.entries[0].id);
  assert.equal(await fs.readFile(path.join(stage.folder, 'sdimg_DATA'), 'utf8'), 'original');
  await release();
  await assert.rejects(fs.access(stage.folder), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(next.folder, 'sdimg_DATA'), 'utf8'), 'original');
  assert.equal(await store.releaseUpload(stage.folder), false);
  await store.releaseUpload(next.stageId);
  assert.equal(await fs.readFile(path.join(title, 'sdimg_DATA'), 'utf8'), 'original');
});
