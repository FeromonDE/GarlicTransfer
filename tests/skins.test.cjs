const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSkins, getSkinMascot } = require('../electron/skins.cjs');
const bundled = path.join(__dirname, '../electron/skins');

// Function Test Skin.
function fixture(t, data) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-skins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'my-onion'));
  fs.writeFileSync(path.join(root, 'my-onion/skin.json'), JSON.stringify(data));
  return root;
}

test('all five bundled skins load with readable palettes', () => {
  const result = loadSkins(bundled, '/nonexistent');
  assert.equal(result.skins.length, 5);
  assert.deepEqual(result.warnings, []);
  for (const skin of result.skins) {
    assert.equal(skin.mascot, undefined);
    assert.ok(skin.mascotRevision);
  }
});

test('external partial skin gets defaults and fallback mascot', (t) => {
  const root = fixture(t, { version: 1, name: 'My Onion', mode: 'light', colors: { gold: '#987600' } });
  const result = loadSkins(bundled, root);
  const skin = result.skins.find((s) => s.id === 'ext-my-onion');
  assert.equal(skin.colors.gold, '#987600');
  assert.equal(skin.colors.text, '#191e23');
  assert.match(getSkinMascot(bundled, root, skin.id).mascot, /^data:image\/png;base64,/);
  assert.equal(result.warnings.length, 1);
});

test('invalid JSON and executable CSS color values are skipped independently', (t) => {
  const root = fixture(t, { version: 1, name: 'Bad', colors: { text: 'url(https://example.invalid)' } });
  fs.mkdirSync(path.join(root, 'broken'));
  fs.writeFileSync(path.join(root, 'broken/skin.json'), '{');
  const result = loadSkins(bundled, root);
  assert.equal(result.skins.length, 5);
  assert.equal(result.warnings.length, 2);
});

test('unreadable contrast falls back and mascot paths cannot escape', (t) => {
  const root = fixture(t, { version: 1, name: 'Contrast', mascot: '../secret.png', colors: { text: '#000000', 'bg-main': '#000000' } });
  const result = loadSkins(bundled, root);
  const skin = result.skins.find((s) => s.id === 'ext-my-onion');
  assert.equal(skin.colors.text, '#f0f4f7');
  assert.equal(result.warnings.length, 2);
  assert.match(getSkinMascot(bundled, root, skin.id).mascot, /^data:image\/png;base64,/);
});

test('symlinked skin folders and oversized metadata are ignored', (t) => {
  const root = fixture(t, { version: 1, name: 'Large' });
  fs.writeFileSync(path.join(root, 'my-onion/skin.json'), ' '.repeat(65537));
  fs.symlinkSync(path.join(bundled, 'cmp'), path.join(root, 'linked'));
  const result = loadSkins(bundled, root);
  assert.equal(result.skins.length, 5);
  assert.equal(result.warnings.length, 1);
});

test('external skins use executable root when packaged and project root in development', () => {
  const { externalSkinsFolder } = require('../electron/skins.cjs');
  const root = path.join(os.tmpdir(), 'GarlicTransfer');
  assert.equal(externalSkinsFolder(true, path.join(root, 'GarlicTransfer.exe'), '/unused'), path.join(root, 'Skins'));
  assert.equal(externalSkinsFolder(false, '/unused/electron', root), path.join(root, 'Skins'));
});


test('long names use NAME-TO-LONG while the skin and its palette still load', (t) => {
  const root = fixture(t, { version: 1, name: 'A'.repeat(41), mode: 'light', colors: { gold: '#987600' } });
  const result = loadSkins(bundled, root);
  const skin = result.skins.find((s) => s.id === 'ext-my-onion');
  assert.equal(skin.name, 'NAME-TO-LONG');
  assert.equal(skin.colors.gold, '#987600');
  assert.match(getSkinMascot(bundled, root, skin.id).mascot, /^data:image\/png;base64,/);
  assert.ok(result.warnings.some((message) => message.includes('NAME-TO-LONG')));
  fs.writeFileSync(path.join(root, 'my-onion/skin.json'), JSON.stringify({ version: 1, name: 'B'.repeat(40) }));
  assert.equal(loadSkins(bundled, root).skins.find((s) => s.id === 'ext-my-onion').name, 'B'.repeat(40));
});

test('invalid modes, colors objects and metadata roots report clear errors', (t) => {
  const root = fixture(t, {});
  for (const [data, expected] of [
    [null, 'JSON object'],
    [[], 'JSON object'],
    [{ version: 1, name: 'Bad Mode', mode: 'night' }, 'Mode must be light or dark'],
    [{ version: 1, name: 'Bad Colors', colors: [] }, 'Colors must be a JSON object'],
    [{ version: 1, name: 'Bad Colors', colors: null }, 'Colors must be a JSON object'],
  ]) {
    fs.writeFileSync(path.join(root, 'my-onion/skin.json'), JSON.stringify(data));
    const result = loadSkins(bundled, root);
    assert.equal(result.skins.length, 5);
    assert.ok(result.warnings.some((message) => message.includes(expected)));
  }
});

test('buttons, hover and selected text adapt to bright backgrounds', (t) => {
  const { contrast } = require('../electron/skins.cjs');
  const root = fixture(t, { version: 1, name: 'Bright', colors: {
    primary: '#ffff00', 'primary-hover': '#00ffff',
    'skin-hover': '#ffffff', 'skin-selected': '#ffffff',
    'primary-text': '#ffffff',
  } });
  const result = loadSkins(bundled, root);
  const skin = result.skins.find((s) => s.id === 'ext-my-onion');
  for (const [fg, bg] of [['primary-text', 'primary'], ['primary-hover-text', 'primary-hover'], ['skin-hover-text', 'skin-hover'], ['skin-selected-text', 'skin-selected']]) {
    assert.ok(contrast(skin.colors[fg], skin.colors[bg]) >= 4.5);
  }
  assert.equal(skin.colors.primary, '#ffff00');
  assert.ok(result.warnings.some((message) => message.includes('primary-text adjusted')));
});


test('catalog reload caches definitions and reads artwork only when selected', (t) => {
  const root = fixture(t, { version: 1, name: 'Cached Onion', mascot: 'mascot.png' });
  const metadata = path.join(root, 'my-onion/skin.json'), image = path.join(root, 'my-onion/mascot.png');
  fs.copyFileSync(path.join(bundled, 'cmp/mascot.png'), image);
  const originalRead = fs.readFileSync;
  let jsonReads = 0, imageReads = 0;
  fs.readFileSync = function(file, ...args) {
    if (file === metadata) jsonReads++;
    if (file === image) imageReads++;
    return originalRead.call(this, file, ...args);
  };
  t.after(() => { fs.readFileSync = originalRead; });
  const first = loadSkins(bundled, root);
  loadSkins(bundled, root);
  assert.equal(jsonReads, 1);
  assert.equal(imageReads, 0);
  assert.ok(!JSON.stringify(first).includes('data:image'));
  const mascot = getSkinMascot(bundled, root, 'ext-my-onion');
  assert.match(mascot.mascot, /^data:image\/png;base64,/);
  assert.deepEqual(getSkinMascot(bundled, root, 'ext-my-onion'), mascot);
  assert.equal(imageReads, 1);
  assert.equal(jsonReads, 1);
  fs.appendFileSync(image, Buffer.from([0]));
  const changed = getSkinMascot(bundled, root, 'ext-my-onion');
  assert.equal(imageReads, 2);
  assert.notEqual(changed.revision, mascot.revision);
  assert.notEqual(changed.mascot, mascot.mascot);
});

test('same-size metadata edits with restored mtime invalidate the definition cache', (t) => {
  const root = fixture(t, { version: 1, name: 'Onion A' });
  const metadata = path.join(root, 'my-onion/skin.json');
  const previous = fs.statSync(metadata);
  assert.equal(loadSkins(bundled, root).skins.find((s) => s.id === 'ext-my-onion').name, 'Onion A');
  fs.writeFileSync(metadata, JSON.stringify({ version: 1, name: 'Onion B' }));
  fs.utimesSync(metadata, previous.atime, previous.mtime);
  assert.equal(loadSkins(bundled, root).skins.find((s) => s.id === 'ext-my-onion').name, 'Onion B');
});

test('display names determine catalog ordering and duplicate names use IDs', (t) => {
  const root = fixture(t, { version: 1, name: 'Zulu' });
  for (const folder of ['z-folder', 'a-folder']) {
    fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, folder, 'skin.json'), JSON.stringify({ version: 1, name: 'Alpha' }));
  }
  const skins = loadSkins(bundled, root).skins;
  assert.equal(skins[0].id, 'ext-a-folder');
  assert.equal(skins[1].id, 'ext-z-folder');
  assert.equal(skins.at(-1).name, 'Zulu');
});

test('invalid artwork is lazy and a deleted selected skin gets the default mascot', (t) => {
  const root = fixture(t, { version: 1, name: 'Broken PNG', mascot: 'mascot.png' });
  fs.writeFileSync(path.join(root, 'my-onion/mascot.png'), 'not a png');
  assert.deepEqual(loadSkins(bundled, root).warnings, []);
  const broken = getSkinMascot(bundled, root, 'ext-my-onion');
  assert.ok(broken.warnings.some((message) => message.includes('Invalid PNG')));
  assert.match(broken.mascot, /^data:image\/png;base64,/);
  assert.ok(broken.revision.startsWith('fallback|'));
  fs.rmSync(path.join(root, 'my-onion'), { recursive: true });
  const removed = getSkinMascot(bundled, root, 'ext-my-onion');
  assert.equal(removed.mascot, broken.mascot);
  assert.ok(removed.warnings.some((message) => message.includes('Selected skin unavailable')));
});

test('artwork cache evicts old images instead of growing for every selected skin', (t) => {
  const root = fixture(t, { version: 1, name: 'Unused' });
  for (let i = 0; i < 9; i++) {
    const folder = path.join(root, `onion-${i}`); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'skin.json'), JSON.stringify({ version: 1, name: `Onion ${i}`, mascot: 'mascot.png' }));
    fs.copyFileSync(path.join(bundled, 'cmp/mascot.png'), path.join(folder, 'mascot.png'));
  }
  const originalRead = fs.readFileSync; let imageReads = 0;
  fs.readFileSync = function(file, ...args) {
    if (String(file).startsWith(root) && String(file).endsWith('mascot.png')) imageReads++;
    return originalRead.call(this, file, ...args);
  };
  t.after(() => { fs.readFileSync = originalRead; });
  for (let i = 0; i < 9; i++) getSkinMascot(bundled, root, `ext-onion-${i}`);
  assert.equal(imageReads, 9);
  getSkinMascot(bundled, root, 'ext-onion-8');
  assert.equal(imageReads, 9);
  getSkinMascot(bundled, root, 'ext-onion-0');
  assert.equal(imageReads, 10);
});
