const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { SaveTemps } = require('../electron/save_temps.cjs');

// Function Editor Fixture
async function fixture(t) {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'garlic-editor-lease-')));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  let store;
  class CapturedTemps extends SaveTemps {
    constructor(base) { super(base); store = this; }
  }
  const editorPath = path.join(__dirname, '../electron/save_editor.cjs');
  const actualRequire = createRequire(editorPath);
  const context = vm.createContext({ module: { exports: {} }, Buffer, process, URL, setTimeout, clearTimeout, AbortController,
    require: name => name === './save_temps.cjs' ? { SaveTemps: CapturedTemps } : actualRequire(name),
  });
  vm.runInContext(fs.readFileSync(editorPath, 'utf8'), context);
  const handlers = new Map(), logs = [];
  let resolveDialog, notifyDialog;
  const dialogOpened = new Promise(resolve => { notifyDialog = resolve; });
  const dialog = {
    showSaveDialog: () => { notifyDialog(); return new Promise(resolve => { resolveDialog = resolve; }); },
    showOpenDialog: () => { notifyDialog(); return new Promise(resolve => { resolveDialog = resolve; }); },
  };
  context.module.exports.registerSaveEditor({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    app: { getPath: () => root }, dialog, shell: {} });
  const owned = await store.create();
  const workspace = path.join(owned.directory, 'workspace');
  const archivePath = path.join(owned.directory, 'decrypted.zip');
  await fsp.mkdir(workspace);
  await fsp.writeFile(path.join(workspace, 'game.dat'), 'decrypted bytes');
  await fsp.writeFile(archivePath, 'archive bytes');
  const event = { sender: { isDestroyed: () => false, send: (_channel, message) => logs.push(message) } };
  return { root, store, handlers, owned, workspace, archivePath, event, logs, dialogOpened,
    completeDialog: result => resolveDialog(result) };
}

for (const route of ['download-archive', 'download-file']) {
  test(`closing the workspace defers cleanup until ${route} finishes its save dialog and copy`, async t => {
    const f = await fixture(t);
    const selected = route === 'download-archive' ? { archivePath: f.archivePath } : { root: f.workspace, path: 'game.dat' };
    const pending = f.handlers.get('save-editor:' + route)(f.event, selected);
    await f.dialogOpened;
    assert.equal(await f.handlers.get('save-editor:release-temporary')(f.event, f.owned.id), false);
    assert.equal((await fsp.stat(f.owned.directory)).isDirectory(), true);
    const output = path.join(f.root, 'user-export');
    f.completeDialog({ canceled: false, filePath: output });
    assert.equal(await pending, output);
    assert.equal(await fsp.readFile(output, 'utf8'), route === 'download-archive' ? 'archive bytes' : 'decrypted bytes');
    await assert.rejects(fsp.access(f.owned.directory), { code: 'ENOENT' });
  });
}

test('canceling a save dialog releases the held workspace after close was requested', async t => {
  const f = await fixture(t);
  const pending = f.handlers.get('save-editor:download-archive')(f.event, { archivePath: f.archivePath });
  await f.dialogOpened;
  await f.store.release(f.owned.id);
  f.completeDialog({ canceled: true });
  assert.equal(await pending, null);
  await assert.rejects(fsp.access(f.owned.directory), { code: 'ENOENT' });
});

test('a cleanup error after export is logged without turning a successful copy into failure', async t => {
  const f = await fixture(t);
  const pending = f.handlers.get('save-editor:download-archive')(f.event, { archivePath: f.archivePath });
  await f.dialogOpened;
  await f.store.release(f.owned.id);
  f.store.remove = async () => { throw new Error('temporary cleanup blocked'); };
  const output = path.join(f.root, 'user-export');
  f.completeDialog({ canceled: false, filePath: output });
  assert.equal(await pending, output);
  assert.equal(await fsp.readFile(output, 'utf8'), 'archive bytes');
  assert.ok(f.logs.some(message => /cleanup blocked/.test(message.message)));
});
