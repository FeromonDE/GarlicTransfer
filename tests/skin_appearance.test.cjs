const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { create } = require('../electron/skin_appearance.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Function Skin Testing
async function setup(t, getSkinMascot = async (id) => ({ mascot: `data:image/png;base64,${id}`, warnings: [] })) {
  const dom = new JSDOM('<div class="cmp-brand"><img alt="Onion"><span>Onion</span></div><select id="uiLayout"></select><p id="layoutStatus"></p><details id="skinWarnings"><summary id="skinWarningSummary"></summary><ul id="skinWarningList"></ul></details><button id="reloadSkins"></button><button id="openSkinsFolder"></button>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const bridge = {
    getSkins: async () => ({ skins: ['alpha', 'beta'].map((id) => ({ id, name: id, mode: 'dark', colors: {}, mascotRevision: '1' })), warnings: [] }),
    getSkinMascot,
    getSettings: async () => ({}), saveSettings: async () => {}, openSkinsFolder: async () => {},
  };
  const api = create(document, bridge, () => {});
  await api.reload('alpha'); await tick();
  return { api, bridge, document, dom, image: () => document.querySelector('.cmp-brand img'), warnings: () => document.getElementById('skinWarningList').textContent };
}

test('a PNG decode error displays bundled fallback and a separate warning', async (t) => {
  const app = await setup(t);
  const corrupt = app.image();
  corrupt.dispatchEvent(new app.dom.window.Event('error'));
  assert.notEqual(app.image(), corrupt);
  assert.equal(app.image().getAttribute('src'), 'skins/cmp/mascot.png');
  assert.ok(app.warnings().includes('alpha: mascot image could not display'));
  assert.equal(app.document.getElementById('skinWarnings').hidden, false);
  assert.equal(app.image().style.visibility, 'hidden');
  app.image().dispatchEvent(new app.dom.window.Event('load'));
  assert.equal(app.image().style.visibility, 'visible');
});

test('a failed bundled fallback stops retrying and hides the broken image', async (t) => {
  const app = await setup(t);
  app.image().dispatchEvent(new app.dom.window.Event('error'));
  const fallback = app.image();
  fallback.dispatchEvent(new app.dom.window.Event('error'));
  assert.equal(app.image(), fallback);
  assert.equal(fallback.getAttribute('src'), null);
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.style.visibility, 'hidden');
  assert.ok(app.warnings().includes('Default mascot image could not display.'));
  const warning = app.warnings();
  fallback.dispatchEvent(new app.dom.window.Event('error'));
  assert.equal(app.image(), fallback);
  assert.equal(app.warnings(), warning);
});

test('stale decode errors cannot replace a newly selected mascot', async (t) => {
  const app = await setup(t);
  const old = app.image(), failOld = old.onerror;
  app.api.apply('beta'); await tick();
  const latest = app.image();
  failOld();
  assert.equal(app.image(), latest);
  assert.equal(latest.getAttribute('src'), 'data:image/png;base64,beta');
  assert.ok(!app.warnings().includes('could not display'));
});

test('classic cancels image failure callbacks and loads no new mascot', async (t) => {
  const calls = [];
  const app = await setup(t, async (id) => { calls.push(id); return { mascot: `data:image/png;base64,${id}`, warnings: [] }; });
  const old = app.image(), failOld = old.onerror;
  app.api.apply('classic');
  failOld();
  await app.api.reload('classic'); await tick();
  assert.deepEqual(calls, ['alpha']);
  assert.equal(app.image().getAttribute('src'), null);
  assert.ok(!app.warnings().includes('could not display'));
});

test('stale mascot requests cannot overwrite the latest selected image', async (t) => {
  const app = await setup(t);
  const requests = [];
  app.bridge.getSkinMascot = (id) => new Promise((resolve) => requests.push({ id, resolve }));
  app.api.apply('beta'); app.api.apply('alpha');
  requests[1].resolve({ mascot: 'data:image/png;base64,newest', warnings: [] }); await tick();
  requests[0].resolve({ mascot: 'data:image/png;base64,obsolete', warnings: ['Old failure'] }); await tick();
  assert.equal(app.image().getAttribute('src'), 'data:image/png;base64,newest');
  assert.ok(!app.warnings().includes('Old failure'));
});


test('mascot space stays reserved while pending and displays only after load', async (t) => {
  const app = await setup(t);
  const first = app.image();
  assert.equal(first.hidden, false);
  assert.equal(first.style.visibility, 'hidden');
  first.dispatchEvent(new app.dom.window.Event('load'));
  assert.equal(first.style.visibility, 'visible');
  await app.api.reload('alpha'); await tick();
  assert.equal(app.image(), first);
  assert.equal(first.style.visibility, 'visible');
  let finish;
  app.bridge.getSkinMascot = () => new Promise((resolve) => { finish = resolve; });
  app.api.apply('beta');
  assert.equal(app.image().hidden, false);
  assert.equal(app.image().style.visibility, 'hidden');
  finish({ mascot: 'data:image/png;base64,beta', warnings: [] }); await tick();
  const second = app.image();
  assert.equal(second.style.visibility, 'hidden');
  second.dispatchEvent(new app.dom.window.Event('load'));
  assert.equal(second.style.visibility, 'visible');
});

test('stale load events cannot reveal pending or Classic mascots', async (t) => {
  const app = await setup(t);
  const old = app.image(), loadedOld = old.onload;
  app.api.apply('beta'); await tick();
  loadedOld();
  assert.equal(app.image().style.visibility, 'hidden');
  const current = app.image(), loadedCurrent = current.onload;
  app.api.apply('classic'); loadedCurrent();
  assert.equal(current.style.visibility, 'hidden');
  assert.equal(current.getAttribute('src'), null);
});
