const fs = require('node:fs');
const path = require('node:path');
const defaults = require('./skin_defaults.json');

const definitions = new Map(), artwork = new Map();
const directoryName = /^[a-z][a-z0-9-]{0,47}$/;

// Function File Cache.
function cacheEntry(cache, key, signature, build, limit) {
  let entry = cache.get(key);
  if (!entry || entry.signature !== signature) {
    try { entry = { signature, value: build() }; }
    catch (error) { entry = { signature, error: error.message }; }
  }
  cache.delete(key); cache.set(key, entry);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  if (entry.error) throw new Error(entry.error);
  return entry.value;
}

// Function File Details.
function fileDetails(folder, name, limit) {
  if (typeof name !== 'string' || path.basename(name) !== name || name.includes('\\')) throw new Error('Use a filename inside the skin folder');
  const file = path.join(folder, name), real = fs.realpathSync(file);
  if (path.dirname(real) !== fs.realpathSync(folder)) throw new Error('Skin file leaves its folder');
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('Skin file must be a regular file');
  if (stat.size > limit) throw new Error('Skin file is too large');
  const signature = [real, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join('|');
  return { file, signature };
}

// Function Skin Metadata.
function definition(folder) {
  const info = fileDetails(folder, 'skin.json', 65536);
  return cacheEntry(definitions, info.file, info.signature,
    () => JSON.parse(fs.readFileSync(info.file, 'utf8')), 256);
}

// Function Text Contrast.
function contrast(a, b) {
  const luminance = (color) => {
    const rgb = color.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Function Skin Loading.
function readSkin(folder, id, warnings) {
  const raw = definition(folder);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Skin metadata must be a JSON object');
  if (raw.version !== 1 || typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Expected version 1 and a non-empty name');
  const name = raw.name.trim().length > 40 ? 'NAME-TO-LONG' : raw.name.trim();
  if (name === 'NAME-TO-LONG' && raw.name.trim().length > 40) warnings.push('Skin name exceeds 40 characters; displaying NAME-TO-LONG.');
  if (raw.mode !== undefined && !['light', 'dark'].includes(raw.mode)) throw new Error('Mode must be light or dark');
  if (raw.colors !== undefined && (!raw.colors || typeof raw.colors !== 'object' || Array.isArray(raw.colors))) throw new Error('Colors must be a JSON object');
  const mode = raw.mode || 'dark';
  const colors = { ...defaults[mode] };
  for (const [key, value] of Object.entries(raw.colors || {})) {
    if (!Object.hasOwn(colors, key) && !['primary-text', 'primary-hover-text', 'skin-hover-text', 'skin-selected-text'].includes(key)) continue;
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid color: ${key}; use #RRGGBB`);
    colors[key] = value;
  }
  const pairs = [['text', 'bg-main'], ['text', 'bg-card'], ['text-2', 'bg-card'], ['text', 'bg-input'], ['text', 'bg-sidebar'], ['text', 'skin-panel'], ['skin-text', 'skin-input'], ['skin-muted', 'skin-input'], ['skin-link', 'skin-input']];
  if (pairs.some(([fg, bg]) => contrast(colors[fg], colors[bg]) < 4.5)) {
    Object.assign(colors, defaults[mode]); warnings.push(`${name}: low-contrast colors replaced with readable ${mode} defaults.`);
  }
  // Function Text Colors.
  for (const [key, background, preferred] of [
    ['primary-text', 'primary', '#ffffff'],
    ['primary-hover-text', 'primary-hover', '#ffffff'],
    ['skin-hover-text', 'skin-hover', colors['skin-text']],
    ['skin-selected-text', 'skin-selected', colors['skin-text']],
  ]) {
    const requested = colors[key] || preferred;
    if (contrast(requested, colors[background]) >= 4.5) colors[key] = requested;
    else {
      colors[key] = contrast('#ffffff', colors[background]) >= contrast('#000000', colors[background]) ? '#ffffff' : '#000000';
      if (raw.colors && Object.hasOwn(raw.colors, key)) warnings.push(`${name}: ${key} adjusted for readability.`);
    }
  }
  let image;
  try {
    if (typeof raw.mascot !== 'string' || !/\.png$/i.test(raw.mascot)) throw new Error('Mascot must be PNG');
    image = fileDetails(folder, raw.mascot, 4 * 1024 * 1024);
  } catch (error) { warnings.push(`${name}: ${error.message}; using default mascot.`); }
  return { skin: { id, name, mode, colors }, image };
}

// Function Skin Discovery.
function discoverSkins(bundled, external) {
  const records = [], warnings = [];
  const scan = (root, prefix) => {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') warnings.push(`Cannot read skin folder: ${error.message}`); return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !directoryName.test(entry.name)) continue;
      try { records.push(readSkin(path.join(root, entry.name), prefix + entry.name, warnings)); }
      catch (error) { warnings.push(`${entry.name}: ${error.message}`); }
    }
  };
  scan(bundled, ''); scan(external, 'ext-');
  records.sort((a, b) => a.skin.name.localeCompare(b.skin.name, undefined, { sensitivity: 'base', numeric: true }) || a.skin.id.localeCompare(b.skin.id));
  return { records, warnings };
}

// Function Skin Catalog.
function loadSkins(bundled, external) {
  const { records, warnings } = discoverSkins(bundled, external);
  const fallback = records.find((record) => record.skin.id === 'cmp')?.image?.signature || 'none';
  const skins = records.map(({ skin, image }) => ({ ...skin, mascotRevision: `${image?.signature || 'fallback'}|${fallback}` }));
  return { skins, warnings, folder: external };
}

// Function Mascot Loading.
function loadMascot(image) {
  return cacheEntry(artwork, image.file, image.signature, () => {
    const bytes = fs.readFileSync(image.file);
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }, 8);
}

// Function Selected Mascot.
function getSkinMascot(bundled, external, id) {
  const warnings = [];
  const externalId = typeof id === 'string' && id.startsWith('ext-');
  const folderName = externalId ? id.slice(4) : id;
  let selected;
  try {
    if (typeof folderName !== 'string' || !directoryName.test(folderName)) throw new Error('Invalid skin ID');
    const folder = path.join(externalId ? external : bundled, folderName);
    if (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) throw new Error('Invalid skin folder');
    const imageWarnings = [];
    selected = readSkin(folder, id, imageWarnings);
    // Metadata warnings remain in the catalog; selected artwork warnings stay here.
    warnings.push(...imageWarnings.filter((message) => message.includes('using default mascot')));
    if (selected.image) {
      try { return { mascot: loadMascot(selected.image), warnings, revision: selected.image.signature }; }
      catch (error) { warnings.push(`${selected.skin.name}: ${error.message}; using default mascot.`); }
    }
  } catch (error) { warnings.push(`Selected skin unavailable: ${error.message}; using default mascot.`); }
  try {
    const fallback = readSkin(path.join(bundled, 'cmp'), 'cmp', []);
    if (!fallback.image) throw new Error('Default mascot unavailable');
    return { mascot: loadMascot(fallback.image), warnings, revision: `fallback|${fallback.image.signature}` };
  } catch (error) {
    warnings.push(`Default mascot unavailable: ${error.message}`);
    return { mascot: undefined, warnings, revision: 'none' };
  }
}

// Function Skins Folder.
function externalSkinsFolder(packaged, executable, sourceRoot) {
  return path.join(packaged ? path.dirname(executable) : sourceRoot, 'Skins');
}

module.exports = { loadSkins, getSkinMascot, contrast, externalSkinsFolder };
