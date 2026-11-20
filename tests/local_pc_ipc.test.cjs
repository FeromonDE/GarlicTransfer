const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { registerSaveEditor } = require('../electron/save_editor.cjs');

// Function PC IPC Fixture
function mainFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-pc-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map(), calls = [];
  const inventory = { root, active: true, entries: [{ id: 'PPSA12345', title: 'PPSA12345', owner: 'unassigned', localSource: 'pc', files: [] }], users: [], warnings: [] };
  class Store {
    constructor(options) { calls.push(['constructor', options]); }
    async inventory() { calls.push(['inventory']); return inventory; }
    async setRoot(folder) { calls.push(['setRoot', folder]); return inventory; }
    async setActive(selected) { calls.push(['setActive', selected]); }
    async prepareUpload(id) { calls.push(['prepareUpload', id]); return { folder: '/staged', titleId: 'PPSA12345', files: ['sdimg_DATA'] }; }
    async export(...args) { calls.push(['export', ...args]); return { destination: '/exported' }; }
    async replace(...args) { calls.push(['replace', ...args]); return { entryId: args[0] }; }
  }
  const mainPath = path.join(__dirname, '../electron/main.cjs');
  const actualRequire = createRequire(mainPath);
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: ['/chosen'] }) };
  const app = { getPath: () => root, whenReady: () => ({ then() {} }), on() {} };
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return { app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, dialog, shell: {} };
      if (name === './local_pc.cjs') return { LocalPcStore: Store };
      if (name === './config.cjs') return { loadSettings() {}, saveSettings() {} };
      if (name === './titles.cjs') return { titleName: () => 'Demo title' };
      if (name === './paths.cjs') return { resourceRoot: root, oracleElf: '', workDir: root, pythonBin: () => 'python3' };
      return actualRequire(name);
    },
    __dirname: path.dirname(mainPath), process, console, Buffer, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context);
  return { root, context, handlers, calls, dialog };
}

test('PC source IPC returns title names and keeps folder, active mode and upload preparation in the store', async (t) => {
  const { handlers, calls, root } = mainFixture(t);
  const inventory = await handlers.get('local-pc:inventory')();
  assert.equal(inventory.entries[0].name, 'Demo title');
  assert.equal(inventory.root, root);
  await handlers.get('local-pc:choose-folder')();
  await handlers.get('local-pc:active')(null, false);
  const upload = await handlers.get('local-pc:prepare-upload')(null, { entryId: 'PPSA12345' });
  assert.equal(upload.folder, '/staged');
  assert.ok(calls.some(call => call[0] === 'setRoot' && call[1] === '/chosen'));
  assert.ok(calls.some(call => call[0] === 'setActive' && call[1] === false));
  assert.ok(calls.some(call => call[0] === 'prepareUpload' && call[1] === 'PPSA12345'));
  const configuration = calls.find(call => call[0] === 'constructor')[1];
  assert.equal(configuration.stateFile, path.join(root, 'local-pc.json'));
  assert.equal(configuration.backupRoot, path.join(root, 'local-pc', 'backups'));
});

test('PC export and replacement use the selected entry and leave the replacement source distinct from its mode', async (t) => {
  const { handlers, calls, dialog } = mainFixture(t);
  const options = { localSource: 'pc', entryId: 'Taylor/PPSA12345', filename: 'sdimg_DATA', source: '/replacement' };
  assert.equal((await handlers.get('local:export')(null, options)).destination, '/exported');
  await handlers.get('local:import')(null, options);
  assert.deepEqual(calls.find(call => call[0] === 'export'), ['export', 'Taylor/PPSA12345', 'sdimg_DATA', '/chosen']);
  assert.deepEqual(calls.find(call => call[0] === 'replace'), ['replace', 'Taylor/PPSA12345', 'sdimg_DATA', '/replacement']);
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal(await handlers.get('local-pc:choose-folder')(), null);
});

test('PC root changes, imports and upload staging reject an active transfer', async (t) => {
  const { handlers, context } = mainFixture(t);
  vm.runInContext("active = { kind: 'download' }", context);
  await assert.rejects(handlers.get('local-pc:choose-folder')(), /stop the active transfer/);
  await assert.rejects(handlers.get('local-pc:active')(null, true), /stop the active transfer/);
  assert.throws(() => handlers.get('local-pc:prepare-upload')(null, { entryId: 'PPSA12345' }), /stop the active transfer/);
  assert.throws(() => handlers.get('local:import')(null, { localSource: 'pc' }), /stop the active transfer/);
});

test('save editor routes PC decryption inputs and backups through the PC store without transfer manifests', async () => {
  const handlers = new Map(), calls = [];
  registerSaveEditor({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, app: { getPath: () => '/private' }, dialog: {}, shell: {},
    pcStore: {
      inputs: async (...args) => { calls.push(['inputs', ...args]); return ['/pc/save', '/pc/save.bin']; },
      backup: async (...args) => { calls.push(['backup', ...args]); return '/private/backup'; },
    },
  });
  const selected = { localSource: 'pc', entryId: 'PPSA12345', filename: 'save' };
  assert.deepEqual(await handlers.get('save-editor:local-file')(null, selected), ['/pc/save', '/pc/save.bin']);
  assert.equal(await handlers.get('save-editor:backup-local')(null, selected), '/private/backup');
  assert.deepEqual(calls, [['inputs', 'PPSA12345', 'save'], ['backup', 'PPSA12345', 'save']]);
});

test('preload exposes the four PC browsing APIs through their matching IPC channels', async () => {
  const exposed = {}, calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer: { invoke: async (...args) => { calls.push(args); } } }),
    process,
  });
  await exposed.saveTransfer.localPcInventory();
  await exposed.saveTransfer.chooseLocalPcFolder();
  await exposed.saveTransfer.setLocalPcActive(true);
  await exposed.saveTransfer.prepareLocalPcUpload({ entryId: 'PPSA12345' });
  assert.deepEqual(calls, [['local-pc:inventory'], ['local-pc:choose-folder'], ['local-pc:active', true], ['local-pc:prepare-upload', { entryId: 'PPSA12345' }]]);
});
