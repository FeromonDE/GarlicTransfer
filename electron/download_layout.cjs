const fs = require('node:fs');
const path = require('node:path');
const { FOLDERS, profileRootPath, metadataPath, otherDataPath } = require('./folder_paths.js');

// Find profile folder.
function profileRoot(directory) {
  return profileRootPath(path.resolve(directory));
}

// Find new or legacy database.
function profileMetadata(directory) {
  const root = profileRoot(directory);
  const organized = metadataPath(root, 'metadata.db');
  const legacy = path.join(root, 'metadata.db');
  return fs.existsSync(organized) || !fs.existsSync(legacy) ? organized : legacy;
}

// Resolve selected database.
function resolveMetadata(selected, output) {
  if (selected && fs.existsSync(selected)) return selected;
  if (selected && path.basename(selected) !== 'metadata.db') return selected;
  return profileMetadata(selected ? path.dirname(selected) : output);
}

// Order new and legacy manifests.
function manifestCandidates(directory, entryId) {
  const root = profileRoot(directory);
  const id = String(Number(entryId));
  return [metadataPath(root, 'manifest.json'), metadataPath(root, id, 'manifest.json'),
    path.join(root, 'manifest.json'), path.join(root, id, 'manifest.json')];
}

// Find entry with index fallback.
function readManifestEntry(directory, entryId) {
  const id = String(Number(entryId));
  const errors = [];
  for (const manifestPath of manifestCandidates(directory, entryId)) {
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const document = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!document || Array.isArray(document) || typeof document !== 'object') throw new Error('manifest must be an object');
      const entry = document[id] ?? (String(document.entry_id ?? '') === id ? document : null);
      if (entry && Array.isArray(entry.files) && entry.files.length) return entry;
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(`save manifest for entry ${id} contains no files${errors.length ? ` (${errors[0]})` : ''}`);
}

// Build payload folder.
function payloadDirectory(directory, entryId, sourcePath) {
  const root = profileRoot(directory);
  const match = /^\/user\/home\/([0-9a-fA-F]{8})\/(?:savedata_prospero|savedata)\/(PPSA[0-9]{5}|CUSA[0-9]{5})(?:\/|$)/.exec(sourcePath || '');
  if (!match) return otherDataPath(root, String(Number(entryId)));
  const relative = sourcePath.slice(match[0].length);
  if (relative.startsWith('/')) throw new Error('invalid save subdirectory');
  const suffix = path.posix.dirname(relative);
  const parts = suffix === '.' ? [] : suffix.split('/');
  if (parts.some((part) => part === '..' || /[\\:]/.test(part))) throw new Error('invalid save subdirectory');
  return path.join(root, FOLDERS.saves, match[1], match[2], ...parts);
}

// Find new or legacy payloads.
function payloadCandidates(directory, entryId, item) {
  const root = profileRoot(directory);
  return [path.join(payloadDirectory(root, entryId, item.path), item.file),
    path.join(root, String(Number(entryId)), item.file), path.join(root, item.file)];
}

// Find selected save file.
function localSaveFile(directory, entryId, filename) {
  const root = profileRoot(directory);
  if (!Number.isSafeInteger(Number(entryId)) || Number(entryId) < 0 || !filename
      || filename === '.' || filename === '..' || /[\\/:]/.test(filename)) {
    throw new Error('invalid save entry or filename');
  }
  let item;
  try {
    item = readManifestEntry(root, entryId).files.find((file) => file && file.file === filename);
  } catch (error) {
    // Keep old captures without manifests readable.
    if (manifestCandidates(root, entryId).some((candidate) => fs.existsSync(candidate))) throw error;
    item = { file: filename, path: '' };
  }
  if (!item) throw new Error('the selected file is not listed in the save manifest');
  const selected = payloadCandidates(root, entryId, item).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!selected) throw new Error('the downloaded save file no longer exists');
  return selected;
}

module.exports = { profileRoot, profileMetadata, resolveMetadata, localSaveFile,
  manifestCandidates, readManifestEntry, payloadDirectory, payloadCandidates };
