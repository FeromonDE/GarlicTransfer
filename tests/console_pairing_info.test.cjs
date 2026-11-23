const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pairingPrefixPath, existingPairingPrefix, pairingInfo } = require('../electron/pairing_store.cjs');

const identity = { hostId: '5c96661f7c1a', systemVersion: '13600007' };
const previousIdentity = { ...identity, systemVersion: '13600000' };

// Function Pairing Fixture
function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-pair-info-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (selected, size = 32) => {
    const file = pairingPrefixPath(root, selected);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(size, 0xa5));
    return file;
  };
  return { root, put };
}

// Function Pairing Module
function isolatedPairing(overrides) {
  const module = { exports: {} };
  const filename = path.join(__dirname, '../electron/pairing_store.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module,
    require: name => name === 'node:fs' ? { ...fs, ...overrides } : require(name) }, { filename });
  return module.exports;
}

test('pairing information reports unpaired, previous and current pairing without reusing another firmware', t => {
  const f = fixture(t);
  assert.deepEqual(pairingInfo(f.root, identity), { status: 'unpaired' });
  f.put(previousIdentity);
  assert.deepEqual(pairingInfo(f.root, identity), { status: 'previous' });
  assert.equal(existingPairingPrefix(f.root, identity), null);
  const current = f.put(identity);
  assert.deepEqual(pairingInfo(f.root, identity), { status: 'paired' });
  assert.equal(existingPairingPrefix(f.root, identity), current);
  assert.equal(existingPairingPrefix(f.root, previousIdentity), pairingPrefixPath(f.root, previousIdentity));
});

test('different console IDs never inherit another console pairing history', t => {
  const f = fixture(t);
  f.put({ ...identity, hostId: '000000000001' });
  f.put({ ...previousIdentity, hostId: '000000000001' });
  assert.deepEqual(pairingInfo(f.root, identity), { status: 'unpaired' });
});

test('malformed and missing row identities report unknown without reading files', t => {
  const f = fixture(t);
  const api = isolatedPairing({ realpathSync: () => assert.fail('Malformed identities must not read files') });
  for (const selected of [undefined, null, {}, [], { hostId: identity.hostId }, { systemVersion: identity.systemVersion },
    { ...identity, hostId: '../elsewhere' }, { ...identity, hostId: '5c96661f7c1a/..' },
    { ...identity, hostId: identity.hostId + '\n' }, { ...identity, systemVersion: identity.systemVersion + '\n' },
    { ...identity, hostId: 123 }, { ...identity, systemVersion: '../firmware' },
    { ...identity, systemVersion: '13.60' }, { ...identity, systemVersion: 13600007 },
    { ...identity, systemVersion: '13600007/../13600000' }]) {
    assert.equal(api.pairingInfo(f.root, selected).status, 'unknown');
  }
});

test('corrupt prefixes and malformed firmware directory names do not count as pairing history', t => {
  const f = fixture(t);
  f.put(identity, 31);
  f.put(previousIdentity, 33);
  const base = path.join(f.root, 'pairings');
  for (const name of ['5C96661F7C1A-136000', '5C96661F7C1A-13600000-extra', '5C96661F7C1AX-13600000']) {
    fs.mkdirSync(path.join(base, name));
    fs.writeFileSync(path.join(base, name, 'pairing-prefix.bin'), Buffer.alloc(32));
  }
  const directoryPrefix = pairingPrefixPath(f.root, { ...identity, systemVersion: '12600000' });
  fs.mkdirSync(directoryPrefix, { recursive: true });
  assert.deepEqual(pairingInfo(f.root, identity), { status: 'unpaired' });
  f.put(previousIdentity);
  assert.deepEqual(pairingInfo(f.root, identity), { status: 'previous' });
});

for (const linked of ['prefix', 'console-folder', 'pairings-folder']) {
  test(`a symbolic ${linked} link cannot report a paired console`, t => {
    const f = fixture(t);
    const outside = path.join(f.root, 'outside');
    fs.mkdirSync(outside);
    const source = path.join(outside, 'pairing-prefix.bin');
    fs.writeFileSync(source, Buffer.alloc(32));
    const current = pairingPrefixPath(f.root, identity);
    let selected, target, type;
    if (linked === 'prefix') {
      fs.mkdirSync(path.dirname(current), { recursive: true });
      selected = current; target = source; type = 'file';
    } else if (linked === 'console-folder') {
      fs.mkdirSync(path.join(f.root, 'pairings'));
      selected = path.dirname(current); target = outside; type = process.platform === 'win32' ? 'junction' : 'dir';
    } else {
      const consoleFolder = path.join(outside, path.basename(path.dirname(current)));
      fs.mkdirSync(consoleFolder);
      fs.writeFileSync(path.join(consoleFolder, 'pairing-prefix.bin'), Buffer.alloc(32));
      selected = path.join(f.root, 'pairings'); target = outside; type = process.platform === 'win32' ? 'junction' : 'dir';
    }
    try { fs.symlinkSync(target, selected, type); }
    catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is unavailable');
      throw error;
    }
    assert.deepEqual(pairingInfo(f.root, identity), { status: 'unpaired' });
    assert.equal(fs.statSync(source).size, 32);
  });
}

test('a symbolic previous-firmware directory is ignored', t => {
  const f = fixture(t);
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'pairing-prefix.bin'), Buffer.alloc(32));
  fs.mkdirSync(path.join(f.root, 'pairings'));
  try { fs.symlinkSync(outside, path.dirname(pairingPrefixPath(f.root, previousIdentity)), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is unavailable');
    throw error;
  }
  assert.deepEqual(pairingInfo(f.root, identity), { status: 'unpaired' });
});

test('filesystem permission failures propagate instead of claiming no pairing', t => {
  const f = fixture(t);
  const prefix = f.put(identity);
  const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  assert.throws(() => isolatedPairing({ realpathSync: () => { throw failure; } }).pairingInfo(f.root, identity), error => error === failure);
  assert.throws(() => isolatedPairing({ lstatSync: selected => {
    if (selected === prefix) throw failure;
    return fs.lstatSync(selected);
  } }).pairingInfo(f.root, identity), error => error === failure);
  fs.unlinkSync(prefix);
  assert.throws(() => isolatedPairing({ readdirSync: () => { throw failure; } }).pairingInfo(f.root, identity), error => error === failure);
});

test('pairing-info IPC forwards identity and preserves the existing boolean pairing-status channel', t => {
  const f = fixture(t);
  const filename = path.join(__dirname, '../electron/main.cjs');
  const actualRequire = createRequire(filename);
  const routes = new Map(), calls = [];
  const app = { getPath: () => f.root, whenReady: () => ({ then() {} }), on() {} };
  class Store {}
  let failure;
  const context = vm.createContext({ __dirname: path.dirname(filename), process, console, Buffer, setTimeout, clearTimeout,
    require: name => {
      if (name === 'electron') return { app, ipcMain: { handle: (name, handler) => routes.set(name, handler) }, dialog: {}, shell: {} };
      if (name === './local_pc.cjs') return { LocalPcStore: Store };
      if (name === './account_store.cjs') return { AccountStore: Store };
      if (name === './config.cjs') return { loadSettings() {}, saveSettings() {} };
      if (name === './titles.cjs') return { titleName: () => '' };
      if (name === './paths.cjs') return { resourceRoot: f.root, localWorkerElf: '', workDir: f.root, pythonBin: () => 'python3' };
      if (name === './pairing_store.cjs') return { pairingPrefixPath, existingPairingPrefix: () => 'current-prefix', pairingInfo: (root, selected) => {
        calls.push({ root, selected });
        if (failure) throw failure;
        return { status: 'previous' };
      } };
      return actualRequire(name);
    } });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const result = routes.get('transfer:pair-info')({}, identity);
  assert.equal(result.status, 'previous');
  assert.deepEqual(calls, [{ root: f.root, selected: identity }]);
  assert.equal(routes.get('transfer:pair-status')({}, identity), true);
  assert.equal(routes.get('transfer:pair-status')({}, {}), false);
  failure = new Error('permission denied');
  assert.throws(() => routes.get('transfer:pair-info')({}, identity), error => error === failure);
});

test('preload exposes per-console pairing information separately from boolean status', async () => {
  const exposed = {}, calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), { process,
    require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); return { status: 'previous' }; } } }) });
  assert.equal((await exposed.saveTransfer.pairingInfo(identity)).status, 'previous');
  await exposed.saveTransfer.pairingStatus(identity);
  assert.deepEqual(calls, [['transfer:pair-info', identity], ['transfer:pair-status', identity]]);
});
