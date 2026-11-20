const fs = require('node:fs/promises');
const { constants, createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');

// Function Workspace Writing
async function writeEditedFile(selectedPath, data) {
  const selected = path.resolve(selectedPath);
  const temporary = path.join(path.dirname(selected), `.garlic-edit-${randomUUID()}.tmp`);
  let handle;
  let owned = false;
  let failure;
  try {
    handle = await fs.open(temporary, 'wx');
    owned = true;
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, selected);
    owned = false;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (handle) await handle.close().catch(error => { failure ||= error; });
    if (owned) {
      try { await fs.rm(temporary, { force: true }); }
      catch (error) { if (!failure) throw error; }
    }
  }
}

// Function Workspace Adding
async function addWorkspaceFiles(root, selectedPaths, complete = () => undefined) {
  const workspace = path.resolve(root);
  const nameKey = name => name.normalize('NFC').replace(/[. ]+$/u, '').toLowerCase();
  const existing = new Set((await fs.readdir(workspace)).map(nameKey));
  const selected = new Set();
  const files = selectedPaths.map(source => {
    const name = path.basename(source);
    const key = nameKey(name);
    if (selected.has(key)) {
      throw Object.assign(new Error(`More than one selected file is named "${name}".`), { code: 'EEXIST' });
    }
    if (existing.has(key)) {
      throw Object.assign(new Error(`A workspace item named "${name}" already exists.`), { code: 'EEXIST' });
    }
    selected.add(key);
    return { source: path.resolve(source), destination: path.join(workspace, name) };
  });
  if (!files.length) return complete();

  let staging;
  const owned = [];
  try {
    staging = await fs.mkdtemp(path.join(workspace, '.garlic-add-'));
    for (const [index, file] of files.entries()) {
      file.staged = path.join(staging, String(index));
      await fs.copyFile(file.source, file.staged, constants.COPYFILE_EXCL);
    }
    for (const file of files) {
      const handle = await fs.open(file.destination, 'wx');
      owned.push(file.destination);
      try {
        await pipeline(createReadStream(file.staged), handle.createWriteStream());
      } finally {
        await handle.close().catch(() => {});
      }
    }
    await fs.rm(staging, { recursive: true, force: true });
    staging = null;
    return await complete();
  } catch (error) {
    for (const destination of owned.reverse()) {
      await fs.rm(destination, { force: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { writeEditedFile, addWorkspaceFiles };
