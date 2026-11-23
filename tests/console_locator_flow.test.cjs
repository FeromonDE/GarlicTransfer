const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const consoles = [
  { host: '192.168.0.42', hostId: 'HELPER', firmware: '13600000', name: 'JB PS5', type: 'PS5' },
  { host: '192.168.0.43', hostId: 'TARGET', firmware: '14220000', name: 'Transfer PS5', type: 'PS5' },
  { host: '192.168.0.44', hostId: 'OLDER', firmware: '12020000', name: 'Older PS5', type: 'PS5' },
  { host: '192.168.0.45', hostId: 'UNKNOWN', firmware: '', name: 'Unknown firmware PS5', type: 'PS5' },
  { host: '192.168.0.46', hostId: 'PS4', firmware: '11000000', name: 'PS4', type: 'PS4' },
];

// Function Test Waiting
async function until(condition, message) {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Function Test Locator
async function app(t, settings = {}) {
  const errors = [], calls = { discover: [], pairing: [], closeFlush: null, closeResume: null };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  let discover = async () => plain(consoles);
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'electron/index.html'), 'utf8'), {
    url: `file://${path.join(root, 'electron/index.html')}`, runScripts: 'dangerously', resources: 'usable', virtualConsole,
    beforeParse(window) {
      window.eval(fs.readFileSync(path.join(__dirname, 'fixtures/cmp_bridge.js'), 'utf8'));
      const loader = require('../electron/skins.cjs'), bundled = path.join(root, 'electron/skins');
      window.saveTransfer.getSkins = async () => loader.loadSkins(bundled, '/nonexistent');
      window.saveTransfer.getSkinMascot = async id => loader.getSkinMascot(bundled, '/nonexistent', id);
      window.saveTransfer.openSkinsFolder = async () => '/Skins';
      const getSettings = window.saveTransfer.getSettings;
      window.saveTransfer.getSettings = async () => ({ ...await getSettings(), oracleHost: '', jbFirmwareLimit: '13.60', ...settings });
      window.saveTransfer.discover = async value => { calls.discover.push(plain(value)); return discover(value); };
      window.saveTransfer.pairingStatus = async identity => { calls.pairing.push(plain(identity)); return true; };
      window.saveAccounts = {
        getState: async () => ({ accounts: [], selectedId: '', useCurrent: true, displayMode: 'name' }),
        onBeforeClose: (flush, resume) => { calls.closeFlush = flush; calls.closeResume = resume; },
      };
    },
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const document = dom.window.document;
  await until(() => document.getElementById('appVersion').textContent, 'The locator app did not load settings');
  const f = { dom, window: dom.window, document, errors, calls, setDiscover: callback => { discover = callback; } };
  f.find = async () => {
    const count = calls.discover.length;
    document.getElementById('discoverBtn').click();
    await until(() => calls.discover.length === count + 1 && !document.getElementById('discoverBtn').disabled,
      'Console discovery did not finish');
  };
  return f;
}

// Function Test Role
function radio(f, role, host) {
  return f.document.querySelector(`#consoleLocatorRows input[data-role="${role}"][data-host="${host}"]`);
}

// Function Test Limit
function setLimit(f, value) {
  const input = f.document.getElementById('jbFirmwareLimit');
  input.value = value; input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
}

for (const remote of [false, true]) {
  test(`JB and OFW choices keep separate identities and preserve ${remote ? 'remote' : 'local'} worker mode`, async t => {
    const f = await app(t, { useRemoteOracle: remote });
    const { document, window } = f;
    await f.find();
    assert.equal(document.querySelectorAll('#consoleLocatorRows tr[data-host]').length, 5);
    assert.equal(document.querySelectorAll('#consoleLocatorRows input:checked').length, 0);
    assert.equal(document.getElementById('consoleSelect').value, '');
    assert.equal(document.getElementById('transferConsoleHost').value, '');
    assert.equal(radio(f, 'jb', consoles[0].host).disabled, false);
    assert.equal(radio(f, 'jb', consoles[2].host).disabled, false);
    assert.equal(radio(f, 'jb', consoles[1].host).disabled, true);
    assert.equal(radio(f, 'jb', consoles[3].host).disabled, true);
    assert.equal(radio(f, 'ofw', consoles[4].host).disabled, true);
    radio(f, 'ofw', consoles[1].host).click();
    const output = document.getElementById('output').value;
    assert.match(output, /TARGET$/);
    document.getElementById('metadata').value = '/profiles/TARGET/custom-metadata.db';
    const filter = document.getElementById('cmpUserSelect'), user = document.createElement('option');
    user.value = 'remembered-user'; user.textContent = 'Remembered user'; filter.appendChild(user); filter.value = user.value;
    radio(f, 'jb', consoles[0].host).click();
    assert.equal(document.getElementById('oracleHost').value, consoles[0].host);
    assert.equal(document.getElementById('cmpOracleHost').value, consoles[0].host);
    assert.equal(document.getElementById('consoleSelect').value, consoles[1].host);
    assert.equal(document.getElementById('transferConsoleHost').value, consoles[1].host);
    assert.equal(document.getElementById('transferConsoleHost').readOnly, true);
    assert.equal(document.getElementById('output').value, output);
    assert.equal(document.getElementById('metadata').value, '/profiles/TARGET/custom-metadata.db');
    assert.equal(filter.value, 'remembered-user');
    assert.equal(document.getElementById('useRemoteOracle').checked, remote);
    assert.equal(document.getElementById('cmpWorker').checked, remote);
    document.getElementById('downloadBtn').click();
    await until(() => window.cmpFixture.calls.downloads.length === 1, 'The selected source did not reach browsing');
    const job = window.cmpFixture.calls.downloads[0];
    assert.equal(job.clientHost, consoles[1].host);
    assert.equal(job.hostId, 'TARGET');
    assert.equal(job.systemVersion, '14220000');
    assert.equal(job.oracleHost, consoles[0].host);
    assert.equal(job.useRemoteOracle, remote);
    assert.deepEqual(f.errors, []);
  });
}

test('transfer labels follow direction without changing the selected console', async t => {
  const f = await app(t); await f.find();
  radio(f, 'ofw', consoles[1].host).click();
  for (const [page, label] of [['download', 'Source PS5'], ['upload', 'Receiving PS5'], ['settings', 'Source/Receiving PS5']]) {
    f.document.querySelector(`[data-page="${page}"]`).click();
    assert.equal(f.document.getElementById('transferConsoleLabel').textContent, label);
    assert.equal(f.document.getElementById('cmpTargetLabel').textContent, label);
    assert.equal(f.document.getElementById('transferConsoleHost').value, consoles[1].host);
    assert.equal(f.document.getElementById('consoleSelect').value, consoles[1].host);
  }
  assert.deepEqual(f.errors, []);
});

test('maximum JB firmware is inclusive, validates before saving, and persists for reload', async t => {
  const f = await app(t); await f.find();
  const { document, window } = f;
  for (const invalid of ['', '13.6', '13600000', 'abc']) {
    setLimit(f, invalid);
    assert.equal(radio(f, 'jb', consoles[0].host).disabled, true);
    document.getElementById('settingsSave').click();
    assert.match(document.getElementById('settingsStatus').textContent, /maximum JB firmware/);
    assert.equal(window.cmpFixture.calls.settings.length, 0);
    assert.equal(document.getElementById('jbFirmwareLimit').value, invalid);
  }
  setLimit(f, '14.22');
  assert.equal(radio(f, 'jb', consoles[1].host).disabled, false);
  radio(f, 'jb', consoles[1].host).click();
  document.getElementById('settingsSave').click();
  await until(() => window.cmpFixture.calls.settings.length === 1, 'The firmware maximum was not saved');
  assert.equal(window.cmpFixture.calls.settings[0].jbFirmwareLimit, '14.22');
  const reloaded = await app(t, plain(window.cmpFixture.settings));
  await reloaded.find();
  assert.equal(reloaded.document.getElementById('jbFirmwareLimit').value, '14.22');
  assert.equal(radio(reloaded, 'jb', consoles[1].host).disabled, false);
  assert.equal(reloaded.document.getElementById('oracleHost').value, consoles[1].host);
  setLimit(f, '13.60');
  assert.equal(document.getElementById('oracleHost').value, '');
  assert.equal(document.getElementById('cmpOracleHost').value, '');
  assert.equal(radio(f, 'jb', consoles[1].host).checked, false);
  document.getElementById('oracleHost').value = '192.168.0.99';
  document.getElementById('oracleHost').dispatchEvent(new window.Event('input', { bubbles: true }));
  setLimit(f, '12.00');
  assert.equal(document.getElementById('oracleHost').value, '192.168.0.99', 'A manual helper IP must not be erased by the locator');
  assert.deepEqual(f.errors, []); assert.deepEqual(reloaded.errors, []);
});

test('a settings write error is shown without losing the firmware maximum', async t => {
  const f = await app(t);
  f.window.saveTransfer.saveSettings = async () => { throw new Error('Test settings write failed'); };
  setLimit(f, '14.22'); f.document.getElementById('settingsSave').click();
  await until(() => f.document.getElementById('settingsStatus').textContent.includes('Test settings write failed'), 'Settings error was not displayed');
  assert.equal(f.document.getElementById('jbFirmwareLimit').value, '14.22');
  assert.deepEqual(f.errors, []);
});

test('rescanning preserves a chosen target profile and detects a changed console identity', async t => {
  const f = await app(t); await f.find();
  const { document, window } = f;
  radio(f, 'ofw', consoles[1].host).click();
  document.getElementById('downloadBtn').click();
  await until(() => window.cmpFixture.calls.downloads.length === 1, 'The original target did not open its browse session');
  window.cmpFixture.emit({ type: 'done', message: 'Original console browse closed' });
  window.cmpFixture.calls.downloads.length = 0;
  document.getElementById('metadata').value = '/profiles/TARGET/keep.db';
  document.getElementById('assets').value = '/profiles/TARGET/custom-saves';
  const output = document.getElementById('output').value;
  await f.find();
  assert.equal(document.getElementById('metadata').value, '/profiles/TARGET/keep.db');
  assert.equal(document.getElementById('assets').value, '/profiles/TARGET/custom-saves');
  assert.equal(document.getElementById('output').value, output);
  f.setDiscover(async () => [{ ...consoles[1], hostId: 'CHANGED' }]); await f.find();
  assert.equal(document.getElementById('consoleSelect').selectedOptions[0].dataset.hostId, 'TARGET');
  assert.equal(document.getElementById('output').value, output);
  assert.equal(document.getElementById('metadata').value, '/profiles/TARGET/keep.db');
  assert.equal(radio(f, 'ofw', consoles[1].host).checked, false);
  assert.match(document.getElementById('consoleLocatorStatus').textContent, /different console/);
  const started = { pairing: 0, inventory: 0 };
  window.saveTransfer.pair = async () => { started.pairing++; };
  window.saveTransfer.inventory = async () => { started.inventory++; return { entries: [], users: [] }; };
  for (const id of ['downloadBtn', 'uploadBtn', 'confirmUploadBtn', 'pairBtn']) {
    assert.equal(document.getElementById(id).disabled, true, `${id} allowed a console identity mismatch`);
    document.getElementById(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  }
  assert.deepEqual(started, { pairing: 0, inventory: 0 });
  assert.equal(window.cmpFixture.calls.downloads.length, 0);
  assert.equal(window.cmpFixture.calls.uploads.length, 0);
  radio(f, 'ofw', consoles[1].host).click();
  assert.match(document.getElementById('output').value, /CHANGED$/);
  assert.equal(document.getElementById('metadata').value, '');
  document.getElementById('downloadBtn').click();
  await until(() => window.cmpFixture.calls.downloads.length === 1, 'The explicitly changed target was not used');
  assert.equal(window.cmpFixture.calls.downloads[0].hostId, 'CHANGED');
  assert.equal(window.cmpFixture.calls.downloads[0].skipLaunch, false);
  assert.deepEqual(f.errors, []);
});

test('pairing labels use the legacy bool fallback and handle lookup errors independently', async t => {
  const f = await app(t); await f.find();
  await until(() => f.document.querySelector('#consoleLocatorRows tr[data-host="192.168.0.42"] [data-pairing="paired"]'),
    'Legacy paired status was not displayed');
  f.window.saveTransfer.pairingInfo = async identity => {
    if (identity.hostId === 'HELPER') throw new Error('Test pairing status unavailable');
    return { status: identity.hostId === 'TARGET' ? 'unpaired' : 'previous' };
  };
  await f.find();
  await until(() => f.document.querySelector('#consoleLocatorRows tr[data-host="192.168.0.42"] [data-pairing="unknown"]')
    && f.document.querySelector('#consoleLocatorRows tr[data-host="192.168.0.43"] [data-pairing="unpaired"]'),
  'One pairing status error prevented other row results');
  assert.equal(radio(f, 'ofw', consoles[0].host).disabled, false);
  assert.deepEqual(f.errors, []);
});

test('missing scan replies preserve role IPs, while upgraded selected helpers are cleared', async t => {
  const f = await app(t); await f.find();
  const { document } = f;
  radio(f, 'ofw', consoles[1].host).click(); radio(f, 'jb', consoles[0].host).click();
  const output = document.getElementById('output').value;
  f.setDiscover(async () => []); await f.find();
  assert.equal(document.getElementById('consoleSelect').value, consoles[1].host);
  assert.equal(document.getElementById('oracleHost').value, consoles[0].host);
  assert.equal(document.getElementById('output').value, output);
  assert.equal(document.querySelectorAll('#consoleLocatorRows input:checked').length, 0);
  f.setDiscover(async () => [{ ...consoles[0], firmware: '14220000' }, consoles[1]]); await f.find();
  assert.equal(document.getElementById('oracleHost').value, '');
  assert.equal(document.getElementById('cmpOracleHost').value, '');
  assert.equal(radio(f, 'jb', consoles[0].host).disabled, true);
  assert.equal(radio(f, 'ofw', consoles[1].host).checked, true);
  assert.equal(document.getElementById('output').value, output);
  assert.deepEqual(f.errors, []);
});

test('a later manual scan selects its OFW target and ignores the older broadcast reply', async t => {
  const f = await app(t);
  const { document } = f;
  let release;
  f.setDiscover(value => value.targetHost ? Promise.resolve([consoles[1]]) : new Promise(resolve => { release = resolve; }));
  document.getElementById('discoverBtn').click();
  await until(() => typeof release === 'function', 'Broadcast discovery did not start');
  document.getElementById('manualHost').value = consoles[1].host;
  document.getElementById('manualConnectBtn').click();
  await until(() => !document.getElementById('manualConnectBtn').disabled && document.getElementById('consoleSelect').value === consoles[1].host,
    'Manual discovery did not select the responding target');
  release([consoles[0]]);
  await until(() => !document.getElementById('discoverBtn').disabled, 'The stale scan did not settle');
  assert.equal(document.getElementById('consoleSelect').value, consoles[1].host);
  assert.equal(radio(f, 'ofw', consoles[1].host).checked, true);
  assert.equal(radio(f, 'ofw', consoles[0].host), null);
  assert.equal(document.getElementById('oracleHost').value, '');
  assert.equal(f.calls.discover[1].targetHost, consoles[1].host);
  assert.deepEqual(f.errors, []);
});

test('invalid and unsupported manual addresses do not select a target', async t => {
  const f = await app(t);
  const { document } = f;
  document.getElementById('manualHost').value = '192.168.0.999'; document.getElementById('manualConnectBtn').click();
  assert.equal(f.calls.discover.length, 0);
  assert.match(document.getElementById('consoleLocatorStatus').textContent, /valid PS5 IPv4/);
  f.setDiscover(async () => [consoles[4]]);
  document.getElementById('manualHost').value = consoles[4].host; document.getElementById('manualConnectBtn').click();
  await until(() => f.calls.discover.length === 1 && !document.getElementById('manualConnectBtn').disabled, 'Unsupported manual discovery did not settle');
  assert.equal(document.getElementById('consoleSelect').value, '');
  assert.match(document.getElementById('consoleLocatorStatus').textContent, /No PS5 responded/);
  assert.deepEqual(f.errors, []);
});

test('scan errors retain selected roles and recover on retry', async t => {
  const f = await app(t); await f.find();
  const { document } = f;
  radio(f, 'ofw', consoles[1].host).click(); radio(f, 'jb', consoles[0].host).click();
  f.setDiscover(async () => { throw new Error('Test discovery failed'); }); await f.find();
  assert.match(document.getElementById('consoleLocatorStatus').textContent, /Test discovery failed/);
  assert.equal(radio(f, 'ofw', consoles[1].host).checked, true);
  assert.equal(radio(f, 'jb', consoles[0].host).checked, true);
  f.setDiscover(async () => plain(consoles)); await f.find();
  assert.equal(radio(f, 'ofw', consoles[1].host).checked, true);
  assert.equal(document.getElementById('discoverBtn').disabled, false);
  assert.deepEqual(f.errors, []);
});

test('transfer, browse and close locks reject forced role and discovery events', async t => {
  const f = await app(t); await f.find();
  const { document, window } = f;
  radio(f, 'ofw', consoles[1].host).click();
  let release;
  window.saveTransfer.download = value => {
    window.cmpFixture.calls.downloads.push(plain(value));
    return new Promise(resolve => { release = resolve; });
  };
  document.getElementById('downloadBtn').click();
  await until(() => typeof release === 'function', 'The transfer did not begin');
  async function assertLocked() {
    const count = f.calls.discover.length;
    for (const role of ['jb', 'ofw']) {
      const input = radio(f, role, consoles[0].host);
      assert.equal(input.disabled, true); input.checked = true;
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    document.getElementById('discoverBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.getElementById('manualHost').value = consoles[0].host;
    document.getElementById('manualConnectBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(f.calls.discover.length, count);
    assert.equal(document.getElementById('consoleSelect').value, consoles[1].host);
    assert.equal(document.getElementById('oracleHost').value, '');
  }
  await assertLocked();
  window.cmpFixture.emit({ type: 'ready', message: 'Browse open', users: window.cmpFixture.users });
  await assertLocked();
  release(); window.cmpFixture.emit({ type: 'done', message: 'Browse closed' });
  assert.equal(radio(f, 'ofw', consoles[0].host).disabled, false);
  await f.calls.closeFlush(); await assertLocked();
  f.calls.closeResume();
  assert.equal(radio(f, 'jb', consoles[0].host).disabled, false);
  radio(f, 'jb', consoles[0].host).click();
  assert.equal(document.getElementById('oracleHost').value, consoles[0].host);
  assert.deepEqual(f.errors, []);
});

test('a discovery response superseded by a transfer cannot replace the locator list', async t => {
  const f = await app(t); await f.find();
  const { document, window } = f;
  radio(f, 'ofw', consoles[1].host).click();
  let release;
  f.setDiscover(() => new Promise(resolve => { release = resolve; }));
  document.getElementById('discoverBtn').click();
  await until(() => typeof release === 'function', 'The delayed scan did not start');
  document.getElementById('downloadBtn').click();
  window.cmpFixture.emit({ type: 'done', message: 'Transfer completed before scan response' });
  release([{ ...consoles[1], hostId: 'STALE' }]);
  await until(() => !document.getElementById('discoverBtn').disabled, 'The discarded discovery did not settle');
  assert.equal(document.getElementById('consoleSelect').selectedOptions[0].dataset.hostId, 'TARGET');
  assert.match(document.getElementById('output').value, /TARGET$/);
  assert.equal(document.querySelectorAll('#consoleLocatorRows tr[data-host]').length, consoles.length);
  assert.deepEqual(f.errors, []);
});

test('per-console pairing details ignore stale results and refresh after pairing', async t => {
  const f = await app(t);
  const { document, window } = f;
  const requests = [], responses = [];
  window.saveTransfer.pairingInfo = identity => {
    requests.push(plain(identity));
    return new Promise(resolve => { responses.push(resolve); });
  };
  f.setDiscover(async () => [consoles[0]]); await f.find();
  await until(() => responses.length === 1, 'The first console pairing status was not requested');
  f.setDiscover(async () => [{ ...consoles[0], firmware: '14220000' }]); await f.find();
  await until(() => responses.length === 2, 'The changed firmware pairing status was not requested');
  assert.deepEqual(requests, [{ hostId: 'HELPER', systemVersion: '13600000' }, { hostId: 'HELPER', systemVersion: '14220000' }]);
  responses[1]({ status: 'previous' });
  await until(() => document.querySelector('#consoleLocatorRows tr[data-host]').textContent.includes('Pair again'), 'Previous-version pairing was not displayed');
  responses[0]({ status: 'paired' });
  await until(() => !document.getElementById('discoverBtn').disabled, 'Discovery remained disabled');
  assert.match(document.querySelector('#consoleLocatorRows tr[data-host]').textContent, /Pair again/);
  radio(f, 'ofw', consoles[0].host).click();
  window.cmpFixture.emit({ type: 'paired', message: 'Paired successfully' });
  await until(() => responses.length === 3, 'A pairing event did not refresh the row status');
  responses[2]({ status: 'paired' });
  await until(() => document.querySelector('#consoleLocatorRows tr[data-host]').textContent.includes('Paired'), 'The paired status did not refresh');
  assert.deepEqual(f.errors, []);
});
