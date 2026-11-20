const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Function Account Bridge Fixture
function fixture() {
  const exposed = {}, sent = [];
  const ipc = new EventEmitter();
  ipc.send = (...args) => sent.push(args);
  ipc.invoke = async () => {};
  const context = vm.createContext({ process, require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: ipc };
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), context);
  return { bridge: exposed.saveAccounts, ipc, sent };
}

test('account close bridge acknowledges only after pending saves finish and can resume editing', async () => {
  const f = fixture();
  let finish, resumed = 0;
  const dispose = f.bridge.onBeforeClose(() => new Promise(resolve => { finish = resolve; }), () => { resumed++; });
  assert.deepEqual(f.sent, [['accounts:ready']]);
  f.ipc.emit('accounts:flush', {}, 'close-1');
  assert.equal(f.sent.length, 1);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sent[1][0], 'accounts:flushed');
  assert.equal(f.sent[1][1], 'close-1');
  assert.equal(f.sent[1][2].ok, true);
  f.ipc.emit('accounts:close-cancelled', {});
  assert.equal(resumed, 1);
  dispose();
  assert.equal(f.ipc.listenerCount('accounts:flush'), 0);
  assert.equal(f.ipc.listenerCount('accounts:close-cancelled'), 0);
});

test('account close bridge reports a failed save with its request token', async () => {
  const f = fixture();
  f.bridge.onBeforeClose(async () => { throw new Error('Name already in use.'); }, () => {});
  f.ipc.emit('accounts:flush', {}, 'close-2');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sent[1][0], 'accounts:flushed');
  assert.equal(f.sent[1][1], 'close-2');
  assert.equal(f.sent[1][2].ok, false);
  assert.equal(f.sent[1][2].error, 'Name already in use.');
});

test('account close bridge rejects missing callbacks and ignores malformed requests', async () => {
  const f = fixture();
  assert.throws(() => f.bridge.onBeforeClose(null, () => {}), /callbacks are required/);
  assert.throws(() => f.bridge.onBeforeClose(() => {}, null), /callbacks are required/);
  let calls = 0;
  f.bridge.onBeforeClose(() => { calls++; }, () => {});
  f.ipc.emit('accounts:flush', {}, null);
  f.ipc.emit('accounts:flush', {}, 'x'.repeat(129));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(f.sent.length, 1);
});
