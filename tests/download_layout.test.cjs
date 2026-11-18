const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { localSaveFile, profileMetadata, resolveMetadata } = require('../electron/download_layout.cjs');

test('save editor resolves organized files, PS4 companions, and legacy files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-layout-'));
  try {
    const savedir = path.join(root, 'Saves', '18c60ea2', 'PPSA12345');
    const metadir = path.join(root, 'Transfer-Metadata', '122');
    fs.mkdirSync(savedir, { recursive: true }); fs.mkdirSync(metadir, { recursive: true });
    const manifest = { '122': { files: [{ file: 'sdimg_DATA', path: '/user/home/18c60ea2/savedata_prospero/PPSA12345/sdimg_DATA' }] } };
    fs.writeFileSync(path.join(metadir, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(savedir, 'sdimg_DATA'), 'save');
    assert.equal(localSaveFile(root, 122, 'sdimg_DATA'), path.join(savedir, 'sdimg_DATA'));
    assert.equal(localSaveFile(path.join(root, 'Transfer-Metadata'), 122, 'sdimg_DATA'), path.join(savedir, 'sdimg_DATA'));
    const old = path.join(root, '123'); fs.mkdirSync(old); fs.writeFileSync(path.join(old, 'old'), 'old');
    assert.equal(localSaveFile(root, 123, 'old'), path.join(old, 'old'));
    assert.throws(() => localSaveFile(root, 122, '../outside'), /invalid/);
    assert.equal(profileMetadata(root), path.join(root, 'Transfer-Metadata', 'metadata.db'));
    fs.writeFileSync(path.join(root, 'metadata.db'), 'legacy');
    assert.equal(resolveMetadata(path.join(root, 'Transfer-Metadata', 'metadata.db'), root), path.join(root, 'metadata.db'));
    fs.writeFileSync(path.join(root, 'Transfer-Metadata', 'metadata.db'), 'new');
    assert.equal(profileMetadata(root), path.join(root, 'Transfer-Metadata', 'metadata.db'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('editor backup stays outside the save folder and PS4 companion lookup works', async () => {
  const { registerSaveEditor } = require('../electron/save_editor.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-backup-'));
  try {
    const savedir = path.join(root, 'Saves', '18c60ea2', 'CUSA12345');
    const metadir = path.join(root, 'Transfer-Metadata', '12');
    fs.mkdirSync(savedir, { recursive: true }); fs.mkdirSync(metadir, { recursive: true });
    fs.writeFileSync(path.join(metadir, 'manifest.json'), JSON.stringify({ '12': { files: [{ file: 'SAVE', path: '/user/home/18c60ea2/savedata/CUSA12345/SAVE' }] } }));
    fs.writeFileSync(path.join(savedir, 'SAVE'), 'save'); fs.writeFileSync(path.join(savedir, 'SAVE.bin'), 'key');
    const handlers = new Map();
    registerSaveEditor({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, app: { getPath: () => root }, dialog: {}, shell: {}, python: 'python3', resourceRoot: root, workDir: root });
    const args = { assets: root, entryId: 12, filename: 'SAVE' };
    const files = await handlers.get('save-editor:local-file')(null, args);
    assert.deepEqual(files, [path.join(savedir, 'SAVE'), path.join(savedir, 'SAVE.bin')]);
    const backup = await handlers.get('save-editor:backup-local')(null, args);
    assert.equal(path.dirname(backup), path.join(root, 'Other Needed Data', 'Backups', '12'));
    assert.equal(fs.readFileSync(backup, 'utf8'), 'save');
    assert.deepEqual(fs.readdirSync(savedir).sort(), ['SAVE', 'SAVE.bin']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stale or damaged index falls back to the individual manifest', () => {
  const { readManifestEntry } = require('../electron/download_layout.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garlic-index-'));
  try {
    const directory = path.join(root, 'Transfer-Metadata', '122');
    fs.mkdirSync(directory, { recursive: true });
    const entry = { files: [{ file: 'DATA', path: '/user/home/18c60ea2/savedata_prospero/PPSA12345/DATA' }], final_header: 'saved' };
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ '122': entry }));
    const index = path.join(root, 'Transfer-Metadata', 'manifest.json');
    fs.writeFileSync(index, JSON.stringify({ '999': { files: [] } }));
    assert.deepEqual(readManifestEntry(root, 122), entry);
    fs.writeFileSync(index, '{');
    assert.deepEqual(readManifestEntry(root, 122), entry);
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ '122': { files: [{ file: 'OLD' }] } }));
    assert.deepEqual(readManifestEntry(root, 122), entry);
    fs.writeFileSync(index, JSON.stringify({ '122': { files: [{ file: 'CURRENT' }] } }));
    assert.equal(readManifestEntry(root, 122).files[0].file, 'CURRENT');
    const savedir = path.join(root, 'Saves', '18c60ea2', 'PPSA12345');
    fs.mkdirSync(savedir, { recursive: true });
    fs.writeFileSync(index, '{}');
    assert.throws(() => localSaveFile(root, 122, 'DATA'), /no longer exists/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('folder helpers work in the sandboxed renderer and Windows paths', () => {
  const vm = require('node:vm');
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/folder_paths.js'), 'utf8'), { window });
  const folders = window.transferFolders;
  assert.equal(folders.metadataPath('D:\\Saves\\Console'), 'D:\\Saves\\Console\\Transfer-Metadata');
  assert.equal(folders.metadataPath('D:\\Saves\\Console\\Transfer-Metadata', 'metadata.db'), 'D:\\Saves\\Console\\Transfer-Metadata\\metadata.db');
  assert.equal(folders.metadataPath('/profile/', 'metadata.db'), '/profile/Transfer-Metadata/metadata.db');
  assert.equal(folders.metadataPath('/', 'metadata.db'), '/Transfer-Metadata/metadata.db');
  assert.equal(folders.metadataPath('D:\\', 'metadata.db'), 'D:\\Transfer-Metadata\\metadata.db');
  assert.equal(folders.profileRootPath('D:\\Transfer-Metadata'), 'D:\\');
  const html = fs.readFileSync(path.join(__dirname, '../electron/index.html'), 'utf8');
  assert.ok(html.indexOf('src="folder_paths.js"') < html.indexOf('src="renderer.js"'));
});
