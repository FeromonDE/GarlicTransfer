const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const sourceRoot = path.join(__dirname, '..');
const pause = () => new Promise(resolve => setTimeout(resolve, 15));
const plain = value => JSON.parse(JSON.stringify(value));

// Function Test Wait
async function until(condition, message) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await pause();
  }
}

// Function Test App
async function app() {
  const calls = { jobs: [], encrypt: [], imports: [] }, errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const info = { root: '/workspace', titleId: 'PPSA12345', accountId: '0000000000000001', files: [] };
  const entry = { id: 'PPSA12345', title: 'PPSA12345', name: 'PC Adventure', owner: 'unassigned', localSource: 'pc',
    files: [{ file: 'sdimg_DATA', path: 'PPSA12345/sdimg_DATA', size: 4096 }] };
  const dom = new JSDOM(fs.readFileSync(path.join(sourceRoot, 'electron/index.html'), 'utf8'), {
    url: `file://${path.join(sourceRoot, 'electron/index.html')}`,
    runScripts: 'dangerously', resources: 'usable', virtualConsole: console,
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.eval(fs.readFileSync(path.join(__dirname, 'fixtures/cmp_bridge.js'), 'utf8'));
      const loader = require('../electron/skins.cjs'), skins = path.join(sourceRoot, 'electron/skins');
      window.saveTransfer.getSkins = async () => loader.loadSkins(skins, '/nonexistent');
      window.saveTransfer.getSkinMascot = async id => loader.getSkinMascot(skins, '/nonexistent', id);
      window.saveTransfer.openSkinsFolder = async () => '/Skins';
      window.saveTransfer.localProfiles = async () => ({ profiles: [] });
      window.saveTransfer.localPcState = async () => ({ root: '/pc/Saves', active: true, warnings: [] });
      window.saveTransfer.localPcInventory = async () => ({ root: '/pc/Saves', active: true,
        entries: [plain(entry)], users: [{ id: 'unassigned', name: 'Unassigned' }], warnings: [] });
      window.saveTransfer.importLocalSave = async value => {
        calls.imports.push(plain(value)); return { backup: '/pc/backup' };
      };
      window.saveEditor.localFile = async () => ['/pc/Saves/PPSA12345/sdimg_DATA'];
      window.saveEditor.chooseInput = async () => ['/external/sdimg_DATA'];
      window.saveEditor.chooseOutput = async () => '/exports/save.zip';
      window.saveEditor.run = async value => {
        calls.jobs.push(plain(value));
        return value.operation === 'decrypt'
          ? { workspace: '/workspace', archivePath: '/decrypted.zip', info: plain(info) }
          : { output: value.output };
      };
      window.saveEditor.encryptLocal = async value => {
        calls.encrypt.push(plain(value)); return { output: '/encrypted/sdimg_DATA' };
      };
    },
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  await pause();
  assert.deepEqual(errors, []);
  return { dom, window: dom.window, document: dom.window.document, calls, errors };
}

for (const remote of [false, true]) {
  test(`${remote ? 'remote' : 'local'} worker selection reaches all save operations`, async () => {
    const context = await app();
    const { dom, window, document, calls, errors } = context;
    const byId = id => document.getElementById(id);
    const idle = () => until(() => !byId('refreshMySavesBtn').disabled, 'Save operation remained busy');
    const routed = job => {
      assert.equal(job.useRemoteOracle, remote);
      assert.equal(job.oracleHost, '192.168.0.42');
    };
    try {
      byId('cmpOracleHost').value = '192.168.0.42';
      byId('cmpOracleHost').dispatchEvent(new window.Event('input'));
      byId('cmpWorker').checked = remote;
      byId('cmpWorker').dispatchEvent(new window.Event('change'));
      assert.equal(byId('useRemoteOracle').checked, remote);
      document.querySelector('[data-page="library"]').click();
      await until(() => document.querySelector('#cmpLibraryTree .cmp-file-open'), 'PC save did not load');
      await idle();
      document.querySelector('#cmpLibraryTree .cmp-file-open').click();
      byId('mySaveDecryptBtn').click();
      await until(() => calls.jobs.length === 1, 'PC decrypt was not requested');
      await idle();
      assert.equal(calls.jobs[0].operation, 'decrypt');
      routed(calls.jobs[0]);
      byId('encryptSaveBtn').click();
      await until(() => calls.imports.length === 1, 'PC encryption was not written back');
      await idle();
      assert.equal(calls.encrypt.length, 1);
      routed(calls.encrypt[0]);
      assert.equal(calls.imports[0].localSource, 'pc');
      byId('mySaveResignBtn').click();
      byId('resignAccountId').value = '0000000000000001';
      byId('confirmResignBtn').click();
      await until(() => calls.jobs.some(job => job.operation === 'resign'), 'PC resign was not requested');
      await idle();
      routed(calls.jobs.find(job => job.operation === 'resign'));
      byId('decryptExternalBtn').click();
      await until(() => calls.jobs.filter(job => job.operation === 'decrypt').length === 2, 'External decrypt was not requested');
      await idle();
      routed(calls.jobs.at(-1));
      byId('encryptSaveBtn').click();
      await until(() => calls.jobs.some(job => job.operation === 'encrypt'), 'External encryption was not requested');
      await idle();
      routed(calls.jobs.find(job => job.operation === 'encrypt'));
      assert.deepEqual(errors, []);
    } finally { await pause(); dom.window.close(); }
  });
}
