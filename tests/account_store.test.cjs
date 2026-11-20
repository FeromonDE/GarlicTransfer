const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { AccountStore } = require('../electron/account_store.cjs');

const first = '00000000abcdef01';
const second = 'fedcba9876543210';

// Function Account Fixture
async function fixture(t, fileSystem = fs) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-accounts-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings', 'account-list.json');
  return { root, file, store: new AccountStore(file, { fileSystem }) };
}

test('accounts, names, target and display mode persist without changing hex identity', async t => {
  const { file, store } = await fixture(t);
  assert.deepEqual(await store.getState(), { accounts: [], selectedId: '', displayMode: 'name', useCurrent: true });
  await store.add(first.toUpperCase(), '  My account  ');
  await store.add(second, 'Other account');
  await store.select(first);
  await store.setDisplayMode('id');
  const state = await new AccountStore(file).getState();
  assert.deepEqual(state, { accounts: [{ id: first, name: 'My account' }, { id: second, name: 'Other account' }],
    selectedId: first, displayMode: 'id', useCurrent: false });
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, 1);
});

test('adding the current ID preserves another selected account and the existing name', async t => {
  const { store } = await fixture(t);
  await store.add(first, 'First');
  await store.select(first);
  let state = await store.add(second);
  assert.equal(state.selectedId, first);
  assert.equal(state.accounts[1].name, '');
  state = await store.add(first.toUpperCase(), 'Replacement name');
  assert.equal(state.accounts.length, 2);
  assert.equal(state.accounts[0].name, 'First');
  assert.equal(state.selectedId, first);
});

test('Add and Rename reject duplicate names regardless of case or surrounding spaces', async t => {
  const { store, file } = await fixture(t);
  await store.add(first, '  Family PS5  ');
  await store.add(second, 'Other PS5');
  await store.select(second);
  const bytes = await fs.readFile(file);
  const third = '0011223344556677';
  for (const name of ['Family PS5', 'family ps5', '  FAMILY PS5  ']) {
    await assert.rejects(store.add(third, name), { message: 'Name already in use.' });
    await assert.rejects(store.rename(second, name), { message: 'Name already in use.' });
  }
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal((await store.getState()).selectedId, second);
  const renamed = await store.rename(first, '  FAMILY PS5  ');
  assert.equal(renamed.accounts[0].name, 'FAMILY PS5');
  const unchanged = await store.add(first, 'Other PS5');
  assert.equal(unchanged.accounts[0].name, 'FAMILY PS5');
  assert.equal(unchanged.accounts.length, 2);
});

test('blank account names remain available and concurrent duplicate additions cannot both commit', async t => {
  const { store, file } = await fixture(t);
  const results = await Promise.allSettled([store.add(first, 'Console'), store.add(second, ' console ')]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.message, 'Name already in use.');
  await store.add(second, '   ');
  await store.rename(first, '');
  assert.deepEqual((await new AccountStore(file).getState()).accounts, [{ id: first, name: '' }, { id: second, name: '' }]);
});

test('historical duplicate names remain readable and can be renamed without migration', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const accounts = [{ id: first, name: 'Shared' }, { id: second, name: 'shared' }];
  await fs.writeFile(file, JSON.stringify({ version: 1, accounts }));
  const store = new AccountStore(file);
  const loaded = await store.getState();
  assert.equal(loaded.warning, undefined);
  assert.deepEqual(loaded.accounts, accounts);
  await assert.rejects(store.add('0011223344556677', 'SHARED'), { message: 'Name already in use.' });
  assert.equal((await store.rename(second, 'Other')).accounts[1].name, 'Other');
  assert.equal((await store.rename(first, 'SHARED')).accounts[0].name, 'SHARED');
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['account-list.json']);
});

test('renaming updates labels while removing a selected account returns to current account', async t => {
  const { store, file } = await fixture(t);
  await store.add(first);
  await store.add(second);
  await store.select(second);
  assert.equal((await store.rename(second.toUpperCase(), '  New name  ')).accounts[1].name, 'New name');
  assert.equal((await store.rename(second, '   ')).accounts[1].name, '');
  assert.equal((await store.remove(first)).selectedId, second);
  const removed = await store.remove(second);
  assert.equal(removed.selectedId, '');
  assert.equal(removed.useCurrent, true);
  assert.deepEqual(removed.accounts, []);
  assert.deepEqual(await new AccountStore(file).getState(), removed);
});

test('a saved target can be cleared without deleting saved accounts', async t => {
  const { store } = await fixture(t);
  await store.add(first);
  await store.select(first);
  const state = await store.select('');
  assert.equal(state.selectedId, '');
  assert.equal(state.accounts.length, 1);
  state.accounts[0].name = 'external mutation';
  state.accounts.push({ id: second, name: 'not saved' });
  assert.deepEqual((await store.getState()).accounts, [{ id: first, name: '' }]);
});

test('using the current account remembers the saved target across sessions', async t => {
  const { store, file } = await fixture(t);
  await store.add(first);
  await store.select(first);
  let state = await store.setUseCurrent(true);
  assert.equal(state.selectedId, first);
  assert.equal(state.useCurrent, true);
  const restored = new AccountStore(file);
  assert.equal((await restored.getState()).selectedId, first);
  assert.equal((await restored.getState()).useCurrent, true);
  state = await restored.setUseCurrent(false);
  assert.equal(state.selectedId, first);
  assert.equal(state.useCurrent, false);
  const persisted = await fs.readFile(file, 'utf8');
  await assert.rejects(restored.setUseCurrent('false'), /current Account ID/);
  assert.equal(await fs.readFile(file, 'utf8'), persisted);
});

test('invalid account IDs, names and selections leave the persisted state unchanged', async t => {
  const { store, file } = await fixture(t);
  await store.add(first, 'Original');
  const original = await fs.readFile(file, 'utf8');
  for (const id of [null, undefined, 123, '', 'abc', '0123456789abcdeg', '0123456789abcdef0']) {
    await assert.rejects(store.add(id), /16-character hexadecimal/);
  }
  for (const name of [null, 'x'.repeat(65), 'bad\nname', 'bad\u0085name']) {
    await assert.rejects(store.rename(first, name), /Account names/);
  }
  await assert.rejects(store.select(second), /missing/);
  await assert.rejects(store.rename(second, 'Missing'), /missing/);
  await assert.rejects(store.setDisplayMode('other'), /Display name or Account ID/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.equal((await store.rename(first, 'x'.repeat(64))).accounts[0].name.length, 64);
});

test('queued changes do not lose concurrently added accounts or stale selections', async t => {
  const { store, file } = await fixture(t);
  const ids = Array.from({ length: 12 }, (_, index) => index.toString(16).padStart(16, '0'));
  await Promise.all(ids.map((id, index) => store.add(id, `Account ${index}`)));
  await Promise.all([store.select(ids[4]), store.rename(ids[4], 'Target'), store.remove(ids[4]), store.setDisplayMode('id')]);
  const state = await new AccountStore(file).getState();
  assert.equal(state.accounts.length, 11);
  assert.equal(state.selectedId, '');
  assert.equal(state.displayMode, 'id');
});

test('invalid stored data reports a warning and is preserved by reading', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const invalid = ['{invalid', JSON.stringify({ accounts: [{ id: first, name: '' }], selectedId: second }),
    JSON.stringify({ accounts: [{ id: first, name: '' }, { id: first.toUpperCase(), name: '' }] }),
    JSON.stringify({ accounts: [], selectedId: 5 }), JSON.stringify({ accounts: [], displayMode: 'invalid' }),
    JSON.stringify({ accounts: [], useCurrent: 'false' })];
  for (const data of invalid) {
    await fs.writeFile(file, data);
    const state = await new AccountStore(file).getState();
    assert.match(state.warning, /could not be loaded/i);
    assert.deepEqual(state.accounts, []);
    assert.equal(state.selectedId, '');
    assert.equal(await fs.readFile(file, 'utf8'), data);
  }
});

test('a read error is reported without an unhandled rejection', async t => {
  const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const { store } = await fixture(t, { ...fs, readFile: async () => { throw failure; } });
  assert.match((await store.getState()).warning, /permission denied/);
});

test('a failed load is preserved byte for byte before the first replacement', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = Buffer.from([0xff, 0xfe, 0x7b, 0x62, 0x61, 0x64, 0x7d, 0x0a]);
  await fs.writeFile(file, original);
  const store = new AccountStore(file);
  assert.match((await store.getState()).warning, /could not be loaded/);
  await store.add(first, 'New account');
  const backups = (await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^account-list\.json\.recovery-[0-9a-f-]+\.bak$/);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(file), backups[0])), original);
  assert.equal((await store.getState()).warning, undefined);
  assert.equal((await new AccountStore(file).getState()).accounts[0].name, 'New account');
  await store.setDisplayMode('id');
  await store.rename(first, 'Renamed');
  assert.equal((await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.bak')).length, 1);
});

test('no-op and rejected changes do not replace or back up an invalid account list', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = JSON.stringify({ accounts: [{ id: first, name: 'Valid' }, { id: 'invalid', name: '' }] });
  await fs.writeFile(file, original);
  const store = new AccountStore(file);
  await store.setDisplayMode('name');
  await assert.rejects(store.add(first, 'bad\nname'), /Account names/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['account-list.json']);
  assert.match((await store.getState()).warning, /could not be loaded/);
  await store.setDisplayMode('id');
  const backups = (await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(path.dirname(file), backups[0]), 'utf8'), original);
});

test('an unreadable source cannot be replaced and missing files do not require recovery', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = '{bad accounts';
  await fs.writeFile(file, original);
  const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  let denied = true;
  const store = new AccountStore(file, { fileSystem: { ...fs, readFile: async (...args) => {
    if (denied) throw failure;
    return fs.readFile(...args);
  } } });
  await assert.rejects(store.add(first), error => error === failure);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['account-list.json']);
  assert.match((await store.getState()).warning, /permission denied/);
  denied = false;
  await store.add(first);
  const backups = (await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(path.dirname(file), backups[0]), 'utf8'), original);
  const missing = path.join(path.dirname(file), 'new-accounts.json');
  await new AccountStore(missing).add(first);
  assert.equal((await fs.readdir(path.dirname(file))).filter(name => name.startsWith('new-accounts.json.')).length, 0);
});

test('a committed recovery copy is reused after replacement fails', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = '{invalid accounts';
  await fs.writeFile(file, original);
  const failure = new Error('replacement failed');
  let fail = true;
  const store = new AccountStore(file, { fileSystem: { ...fs, rename: async (...args) => {
    if (fail) throw failure;
    return fs.rename(...args);
  } } });
  await assert.rejects(store.add(first), error => error === failure);
  const beforeRetry = await fs.readdir(path.dirname(file));
  const backups = beforeRetry.filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.match((await store.getState()).warning, /Recovery copy:/);
  assert.deepEqual((await store.getState()).accounts, []);
  fail = false;
  await store.add(first);
  assert.deepEqual(await fs.readdir(path.dirname(file)), beforeRetry);
  assert.equal((await store.getState()).warning, undefined);
});

test('a recovery retry cannot overwrite an externally repaired account list', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = Buffer.from('{corrupt A\n');
  await fs.writeFile(file, original);
  const failure = new Error('replacement failed');
  let fail = true;
  const store = new AccountStore(file, { fileSystem: { ...fs, rename: async (...args) => {
    if (fail) throw failure;
    return fs.rename(...args);
  } } });
  await assert.rejects(store.add(first, 'New account'), error => error === failure);
  const beforeRetry = await fs.readdir(path.dirname(file));
  const backups = beforeRetry.filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  const repaired = Buffer.from(JSON.stringify({ version: 1, accounts: [{ id: second, name: 'Repaired account' }] }) + '\n');
  await fs.writeFile(file, repaired);
  fail = false;
  await assert.rejects(store.add(first, 'Retry'), /account list changed.*Restart GarlicTransfer to reload/i);
  assert.deepEqual(await fs.readFile(file), repaired);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(file), backups[0])), original);
  assert.deepEqual(await fs.readdir(path.dirname(file)), beforeRetry);
  assert.deepEqual((await store.getState()).accounts, []);
  assert.match((await store.getState()).warning, /Recovery copy:/);
  assert.deepEqual((await new AccountStore(file).getState()).accounts, [{ id: second, name: 'Repaired account' }]);
});

test('a repair made while staging is checked before the first recovery replacement', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = '{corrupt A';
  const repaired = JSON.stringify({ version: 1, accounts: [{ id: second, name: 'Repaired during save' }] });
  await fs.writeFile(file, original);
  let renameCalls = 0;
  const store = new AccountStore(file, { fileSystem: { ...fs,
    open: async (...args) => {
      const handle = await fs.open(...args);
      if (!args[0].endsWith('.tmp')) return handle;
      return {
        writeFile: data => handle.writeFile(data),
        sync: () => handle.sync(),
        close: async () => { await handle.close(); await fs.writeFile(file, repaired); },
      };
    },
    rename: async (...args) => { renameCalls++; return fs.rename(...args); },
  } });
  await assert.rejects(store.add(first), /account list changed.*reload/i);
  assert.equal(renameCalls, 0);
  assert.equal(await fs.readFile(file, 'utf8'), repaired);
  const files = await fs.readdir(path.dirname(file));
  const backups = files.filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(path.dirname(file), backups[0]), 'utf8'), original);
  assert.equal(files.some(name => name.endsWith('.tmp')), false);
});

test('a failed recovery recheck cannot replace the source or create repeated backups', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = '{corrupt accounts';
  await fs.writeFile(file, original);
  const failure = Object.assign(new Error('recovery source is unreadable'), { code: 'EACCES' });
  let sourceReads = 0;
  const store = new AccountStore(file, { fileSystem: { ...fs, readFile: async (...args) => {
    sourceReads++;
    if (sourceReads >= 3) throw failure;
    return fs.readFile(...args);
  } } });
  await assert.rejects(store.add(first), error => error === failure);
  await assert.rejects(store.add(first), error => error === failure);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  const files = await fs.readdir(path.dirname(file));
  assert.equal(files.filter(name => name.endsWith('.bak')).length, 1);
  assert.equal(files.some(name => name.endsWith('.tmp')), false);
  assert.deepEqual((await store.getState()).accounts, []);
});

for (const phase of ['open', 'write', 'sync', 'close']) {
  test(`failed recovery ${phase} preserves the source and can be retried`, async t => {
    const { file } = await fixture(t);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const original = '{unreadable account data';
    await fs.writeFile(file, original);
    const failure = new Error(`recovery ${phase} failed`);
    let fail = true, handles = 0;
    const store = new AccountStore(file, { fileSystem: { ...fs, open: async (...args) => {
      if (!args[0].endsWith('.bak')) return fs.open(...args);
      if (fail && phase === 'open') throw failure;
      const handle = await fs.open(...args);
      handles++;
      let closed = false;
      return {
        writeFile: async data => { if (fail && phase === 'write') throw failure; return handle.writeFile(data); },
        sync: async () => { if (fail && phase === 'sync') throw failure; return handle.sync(); },
        close: async () => {
          if (!closed) { closed = true; handles--; await handle.close(); }
          if (fail && phase === 'close') throw failure;
        },
      };
    } } });
    await assert.rejects(store.add(first), error => error === failure);
    assert.equal(handles, 0);
    assert.equal(await fs.readFile(file, 'utf8'), original);
    assert.deepEqual(await fs.readdir(path.dirname(file)), ['account-list.json']);
    assert.match((await store.getState()).warning, /could not be loaded/);
    assert.deepEqual((await store.getState()).accounts, []);
    fail = false;
    await store.add(first);
    assert.equal(handles, 0);
    const backups = (await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.bak'));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(path.dirname(file), backups[0]), 'utf8'), original);
  });
}

test('a recovery filename collision never deletes an unrelated file', async t => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const original = '{invalid accounts';
  await fs.writeFile(file, original);
  let collision;
  const store = new AccountStore(file, { fileSystem: { ...fs, open: async (...args) => {
    if (!args[0].endsWith('.bak')) return fs.open(...args);
    collision = args[0];
    await fs.writeFile(collision, 'unrelated data');
    throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
  } } });
  await assert.rejects(store.add(first), error => error.code === 'EEXIST');
  assert.equal(await fs.readFile(collision, 'utf8'), 'unrelated data');
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.deepEqual((await store.getState()).accounts, []);
});

for (const phase of ['write', 'sync', 'close', 'rename']) {
  test(`failed ${phase} leaves saved accounts and selection unchanged and closes its stage`, async t => {
    const { file } = await fixture(t);
    const original = new AccountStore(file);
    await original.add(first, 'Original');
    await original.select(first);
    const bytes = await fs.readFile(file, 'utf8');
    const failure = new Error(`${phase} failed`);
    let handles = 0;
    const overridden = { ...fs,
      open: async (...args) => {
        const handle = await fs.open(...args);
        handles++;
        let closed = false;
        return {
          writeFile: async data => { if (phase === 'write') throw failure; return handle.writeFile(data); },
          sync: async () => { if (phase === 'sync') throw failure; return handle.sync(); },
          close: async () => {
            if (!closed) { closed = true; handles--; await handle.close(); }
            if (phase === 'close') throw failure;
          },
        };
      },
      rename: async (...args) => { if (phase === 'rename') throw failure; return fs.rename(...args); },
    };
    const store = new AccountStore(file, { fileSystem: overridden });
    await assert.rejects(store.add(second), error => error === failure);
    assert.equal(handles, 0);
    assert.equal(await fs.readFile(file, 'utf8'), bytes);
    assert.deepEqual((await store.getState()).accounts, [{ id: first, name: 'Original' }]);
    assert.equal((await store.getState()).selectedId, first);
    assert.deepEqual(await fs.readdir(path.dirname(file)), ['account-list.json']);
  });
}

test('exclusive stage collision never removes an unrelated file', async t => {
  const { file } = await fixture(t);
  let collision;
  const store = new AccountStore(file, { fileSystem: { ...fs, open: async selected => {
    collision = selected;
    await fs.writeFile(selected, 'unrelated data');
    throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
  } } });
  await assert.rejects(store.add(first), error => error.code === 'EEXIST');
  assert.equal(await fs.readFile(collision, 'utf8'), 'unrelated data');
  assert.deepEqual((await store.getState()).accounts, []);
});

test('account preload bridge forwards supported actions with exact IDs and names', async () => {
  const exposed = {}, calls = [];
  const context = vm.createContext({ process, require: name => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); return { accounts: [] }; } } };
  } });
  vm.runInContext(syncFs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), context);
  await exposed.saveAccounts.getState();
  await exposed.saveAccounts.add(first, 'Saved');
  await exposed.saveAccounts.rename(first, 'Renamed');
  await exposed.saveAccounts.select(first);
  await exposed.saveAccounts.setDisplayMode('id');
  await exposed.saveAccounts.setUseCurrent(true);
  await exposed.saveAccounts.remove(first);
  assert.deepEqual(calls, [['accounts:get'], ['accounts:add', first, 'Saved'], ['accounts:rename', first, 'Renamed'],
    ['accounts:select', first], ['accounts:display-mode', 'id'], ['accounts:use-current', true], ['accounts:remove', first]]);
});
