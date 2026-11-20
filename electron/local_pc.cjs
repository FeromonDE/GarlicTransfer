const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const TITLE = /^PPSA[0-9]{5}$/i;
const EXTENSIONS = new Set(['', '.bin', '.img', '.save', '.dat']);
const STAGING_MARKER = 'GarlicTransfer Local PC upload 1';

// Function Local File Name
function saveName(name) {
  if (typeof name !== 'string' || !name || path.basename(name) !== name || /[\\/:\x00-\x1f]/.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower.startsWith('.') || /(?:\.backup(?:[-.]|$)|\.bak(?:[-.]|$)|\.(?:part|tmp|temp)(?:[-.]|$))/.test(lower)) return false;
  if (/\.(?:json|db|sqlite3?|log|txt|ini|xml|csv)$/.test(lower)) return false;
  return lower.startsWith('sdimg_') || EXTENSIONS.has(path.extname(lower));
}

// Function Local Path Check
function inside(root, selected) {
  const relative = path.relative(root, selected);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Function Local File Copy
async function copySynced(source, destination, exclusive = false) {
  await fsp.copyFile(source, destination, exclusive ? fs.constants.COPYFILE_EXCL : 0);
  let handle;
  try {
    handle = await fsp.open(destination, 'r+');
    await handle.sync();
    await handle.close();
    handle = null;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (exclusive) await fsp.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}

class LocalPcStore {
  constructor({ stateFile, backupRoot, stagingRoot }) {
    this.stateFile = path.resolve(stateFile);
    this.backupRoot = path.resolve(backupRoot);
    this.stagingRoot = path.resolve(stagingRoot);
    this.state = { root: '', active: false };
    this.stateWarning = '';
    this.pending = Promise.resolve();
    this.stages = new Map();
    this.ready = this.loadState();
  }

  // Function Local Settings
  async loadState() {
    try {
      const value = JSON.parse(await fsp.readFile(this.stateFile, 'utf8'));
      if (typeof value.root !== 'string' || (value.root && !path.isAbsolute(value.root))) throw new Error('invalid folder');
      this.state = { root: value.root, active: value.active === true };
    } catch (error) {
      if (error.code !== 'ENOENT') this.stateWarning = 'The saved Local PC folder could not be read. Choose it again.';
    }
  }

  // Function Local Settings Save
  async saveState() {
    await fsp.mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, JSON.stringify(this.state) + '\n', { mode: 0o600, flag: 'wx' });
      await fsp.rename(temporary, this.stateFile);
    } finally { await fsp.rm(temporary, { force: true }); }
  }

  // Function Local Operation
  serial(action) {
    const result = this.pending.then(async () => { await this.ready; return action(); });
    this.pending = result.catch(() => {});
    return result;
  }

  // Function Local Folder
  async setRoot(folder) {
    return this.serial(async () => {
      const root = await fsp.realpath(path.resolve(folder));
      if (!(await fsp.stat(root)).isDirectory()) throw new Error('Choose a folder containing PS5 saves.');
      const previous = this.state;
      this.state = { root, active: true };
      try { await this.saveState(); }
      catch (error) { this.state = previous; throw error; }
      this.stateWarning = '';
      return (await this.scan()).result;
    });
  }

  // Function Local Selection
  async setActive(active) {
    return this.serial(async () => {
      const previous = this.state.active;
      this.state.active = active === true;
      try { await this.saveState(); }
      catch (error) { this.state.active = previous; throw error; }
      return this.state.active;
    });
  }

  // Function Local State
  async status() {
    await this.ready;
    return { root: this.state.root, active: this.state.active,
      warnings: this.stateWarning ? [this.stateWarning] : [] };
  }

  // Function Local Children
  async children(folder) {
    return (await fsp.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Function Local Path Info
  async checkedInfo(root, selected, directory = false, allowEmpty = false) {
    if (!inside(root, selected)) throw new Error('The selected save is outside the Local PC folder.');
    let current = selected;
    let selectedStat;
    while (inside(root, current)) {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Linked save paths are not supported.');
      if (current === selected) {
        selectedStat = stat;
        if (directory ? !stat.isDirectory() : !stat.isFile() || (!allowEmpty && !stat.size)) {
          throw new Error(directory ? 'The save folder is unavailable.' : 'The save file is missing or empty.');
        }
      }
      if (current === root) break;
      current = path.dirname(current);
    }
    const real = await fsp.realpath(selected);
    if (!inside(root, real)) throw new Error('The selected save leaves the Local PC folder.');
    return { path: real, stat: selectedStat };
  }

  // Function Local Path
  async checked(root, selected, directory = false) {
    return (await this.checkedInfo(root, selected, directory)).path;
  }

  // Function Local Layout
  async layout(selectedRoot) {
    await this.ready;
    const root = selectedRoot === undefined ? this.state.root : selectedRoot;
    if (!root || (await fsp.realpath(root)) !== root || !(await fsp.lstat(root)).isDirectory()) {
      throw new Error('The Local PC folder is unavailable. Choose it again.');
    }
    let base = root;
    let children = [];
    if (!TITLE.test(path.basename(root))) {
      children = await this.children(root);
      const candidates = children.filter(entry => entry.name.toLowerCase() === 'saves');
      if (candidates.length === 1 && candidates[0].isDirectory()) {
        base = await this.checked(root, path.join(root, candidates[0].name), true);
        children = await this.children(base);
      }
    }
    const single = TITLE.test(path.basename(base));
    const userRoot = !single && path.basename(path.dirname(base)).toLowerCase() === 'saves'
      && path.basename(base).toLowerCase() !== 'saves';
    return { root, base, children, single, userRoot };
  }

  // Function Local Title
  title(folder, owner) {
    return { folder, owner: owner.toLowerCase(), title: path.basename(folder).toUpperCase() };
  }

  // Function Local Title Files
  async readTitle(root, candidate, warnings) {
    const folder = await this.checked(root, candidate.folder, true);
    const all = [];
    const paths = new Map();
    let ignored = 0;
    for (const entry of await this.children(folder)) {
      const file = path.join(folder, entry.name);
      if (!entry.isFile() || !saveName(entry.name)) { ignored++; continue; }
      const selected = await this.checkedInfo(root, file, false, true);
      if (!selected.stat.size) { ignored++; continue; }
      paths.set(entry.name, selected.path);
      all.push({ file: entry.name, path: path.relative(root, selected.path).split(path.sep).join('/'),
        size: selected.stat.size, sha256: '' });
    }
    const counts = new Map();
    for (const file of all) counts.set(file.file.toLowerCase(), (counts.get(file.file.toLowerCase()) || 0) + 1);
    const conflicts = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
    const unique = all.filter(file => !conflicts.has(file.file.toLowerCase()));
    if (unique.length !== all.length) warnings.push(`Skipped case-conflicting save names in ${path.relative(root, folder) || candidate.title}.`);
    const names = new Set(unique.map(file => file.file.toLowerCase()));
    const files = unique.filter(file => !file.file.toLowerCase().endsWith('.bin') || !names.has(file.file.slice(0, -4).toLowerCase()));
    if (ignored) warnings.push(`Skipped ${ignored} unsupported file(s) or subfolder(s) in ${path.relative(root, folder) || candidate.title}.`);
    if (!files.length) return null;
    const id = path.relative(root, folder).split(path.sep).join('/') || candidate.title;
    const entry = { id, title: candidate.title, owner: candidate.owner, localSource: 'pc', files };
    return { entry, folder, files: unique, paths, conflicts };
  }

  // Function Local Scan
  async scan() {
    const result = { ...await this.status(), entries: [], users: [] };
    if (!result.root) return { result };
    try {
      const { root, base, children, single, userRoot } = await this.layout(result.root);
      const warnings = result.warnings;
      const titles = [];
      if (single) {
        const parent = path.dirname(base);
        titles.push(this.title(base, path.basename(path.dirname(parent)).toLowerCase() === 'saves' ? path.basename(parent) : 'unassigned'));
      } else {
        for (const entry of children) {
          const selected = path.join(base, entry.name);
          if (entry.isSymbolicLink()) { warnings.push(`Skipped linked folder or file: ${entry.name}`); continue; }
          if (!entry.isDirectory()) continue;
          if (TITLE.test(entry.name)) { titles.push(this.title(selected, userRoot ? path.basename(base) : 'unassigned')); continue; }
          if (userRoot || entry.name.startsWith('.') || /[\\/:\x00-\x1f]/.test(entry.name)) continue;
          let nested;
          try { nested = await this.children(selected); }
          catch (error) { warnings.push(`Skipped ${entry.name}: ${error.message}`); continue; }
          for (const title of nested) {
            if (title.isSymbolicLink()) { warnings.push(`Skipped linked path: ${entry.name}/${title.name}`); continue; }
            if (title.isDirectory() && TITLE.test(title.name)) titles.push(this.title(path.join(selected, title.name), entry.name));
          }
        }
      }
      for (const candidate of titles) {
        try {
          const record = await this.readTitle(root, candidate, warnings);
          if (!record) continue;
          result.entries.push(record.entry);
        } catch (error) { warnings.push(`Skipped ${candidate.title}: ${error.message}`); }
      }
      const owners = [...new Set(result.entries.map(entry => entry.owner))].sort();
      result.users = owners.map(id => ({ id, name: id === 'unassigned' ? 'Unassigned' : id }));
      result.entries.sort((a, b) => a.owner.localeCompare(b.owner) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    } catch (error) { result.warnings.push(`The Local PC folder is unavailable: ${error.message}`); }
    return { result };
  }

  // Function Local Inventory
  async inventory() { return (await this.scan()).result; }

  // Function Local Title Selection
  async selectedTitle(entryId) {
    const unavailable = () => new Error('The selected Local PC save is no longer available. Refresh the folder.');
    const id = String(entryId);
    const { root, base, children, single, userRoot } = await this.layout();
    let candidate;
    if (single) {
      if (id !== path.basename(base).toUpperCase()) throw unavailable();
      const parent = path.dirname(base);
      candidate = this.title(base, path.basename(path.dirname(parent)).toLowerCase() === 'saves' ? path.basename(parent) : 'unassigned');
    } else {
      const parts = id.split('/');
      if (parts.some(part => !part || part === '.' || part === '..' || /[\\/:\x00-\x1f]/.test(part))) throw unavailable();
      const selected = path.resolve(root, ...parts);
      if (!inside(base, selected)) throw unavailable();
      const relative = path.relative(base, selected).split(path.sep);
      if (relative.length !== 1 && (relative.length !== 2 || userRoot)) throw unavailable();
      const first = children.find(entry => entry.name === relative[0]);
      if (!first || !first.isDirectory() || first.isSymbolicLink()) throw unavailable();
      if (relative.length === 1) {
        if (!TITLE.test(first.name)) throw unavailable();
        candidate = this.title(path.join(base, first.name), userRoot ? path.basename(base) : 'unassigned');
      } else {
        if (TITLE.test(first.name) || first.name.startsWith('.') || /[\\/:\x00-\x1f]/.test(first.name)) throw unavailable();
        const owner = await this.checked(root, path.join(base, first.name), true);
        const title = (await this.children(owner)).find(entry => entry.name === relative[1]);
        if (!title || !title.isDirectory() || title.isSymbolicLink() || !TITLE.test(title.name)) throw unavailable();
        candidate = this.title(path.join(owner, title.name), first.name);
      }
    }
    const record = await this.readTitle(root, candidate, []);
    if (!record || record.entry.id !== id) throw unavailable();
    return { root, record };
  }

  // Function Local Save
  async selection(entryId, filename) {
    const { root, record } = await this.selectedTitle(entryId);
    const item = record.entry.files.find(file => file.file === filename);
    if (!item || !saveName(filename)) throw new Error('Choose a save file listed in the Local PC folder.');
    if (record.conflicts.has(`${filename}.bin`.toLowerCase())) throw new Error('The selected save has ambiguous sidecar names.');
    const selected = record.paths.get(filename);
    const companion = record.files.find(file => file.file.toLowerCase() === `${filename}.bin`.toLowerCase());
    const inputs = [selected];
    if (companion) inputs.push(record.paths.get(companion.file));
    return { root, record, selected, inputs };
  }

  // Function Local File
  async file(entryId, filename) { return (await this.selection(entryId, filename)).selected; }

  // Function Local Inputs
  async inputs(entryId, filename) { return (await this.selection(entryId, filename)).inputs; }

  // Function Local Backup
  async backupFiles(selection) {
    await fsp.mkdir(this.backupRoot, { recursive: true, mode: 0o700 });
    const directory = await fsp.mkdtemp(path.join(this.backupRoot, `${selection.record.entry.title}-${Date.now()}-`));
    try {
      for (const selected of selection.inputs) await copySynced(selected, path.join(directory, path.basename(selected)), true);
    } catch (error) { await fsp.rm(directory, { recursive: true, force: true }); throw error; }
    return path.join(directory, path.basename(selection.selected));
  }

  // Function Save Backup
  async backup(entryId, filename) { return this.serial(async () => this.backupFiles(await this.selection(entryId, filename))); }

  // Function Local Export
  async export(entryId, filename, destinationDir) {
    return this.serial(async () => {
      const selection = await this.selection(entryId, filename);
      const destination = await fsp.realpath(path.resolve(destinationDir));
      if (!(await fsp.stat(destination)).isDirectory()) throw new Error('Choose an export folder.');
      const targets = selection.inputs.map(file => path.join(destination, path.basename(file)));
      for (const file of targets) {
        try { await fsp.lstat(file); throw new Error(`The export file already exists: ${path.basename(file)}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const created = [];
      try {
        for (let index = 0; index < targets.length; index++) {
          await copySynced(selection.inputs[index], targets[index], true); created.push(targets[index]);
        }
      } catch (error) { for (const file of created) await fsp.rm(file, { force: true }); throw error; }
      return { destination: targets[0], files: targets };
    });
  }

  // Function Local Replacement
  async replace(entryId, filename, source) {
    return this.serial(async () => {
      const selection = await this.selection(entryId, filename);
      const sourcePath = path.resolve(source);
      const sourceStat = await fsp.lstat(sourcePath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !sourceStat.size) throw new Error('Choose a nonempty encrypted replacement file.');
      if (await fsp.realpath(sourcePath) === selection.selected) throw new Error('The replacement is the same as the selected save.');
      const siblings = await fsp.readdir(path.dirname(sourcePath));
      const sourceCompanions = siblings.filter(name => name.toLowerCase() === `${path.basename(sourcePath)}.bin`.toLowerCase());
      if (sourceCompanions.length > 1) throw new Error('The replacement has ambiguous sidecar names.');
      const sourceFiles = [sourcePath];
      if (sourceCompanions.length) {
        const companion = path.join(path.dirname(sourcePath), sourceCompanions[0]);
        const stat = await fsp.lstat(companion);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('The replacement sidecar is missing or empty.');
        sourceFiles.push(companion);
      }
      if (selection.inputs.length === 2 && sourceFiles.length !== 2) throw new Error('Choose the replacement with its matching .bin sidecar.');
      const targets = [...selection.inputs];
      if (sourceFiles.length === 2 && targets.length === 1) targets.push(`${selection.selected}.bin`);
      const backup = await this.backupFiles(selection);
      const temporary = targets.map(file => path.join(path.dirname(file), `.garlic-pc-${randomUUID()}.tmp`));
      const committed = [];
      try {
        for (let index = 0; index < targets.length; index++) await copySynced(sourceFiles[index], temporary[index], true);
        for (let index = 0; index < targets.length; index++) {
          await this.checked(selection.root, path.dirname(targets[index]), true);
          const targetStat = await fsp.lstat(targets[index]).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (targetStat?.isSymbolicLink() || (targetStat && !targetStat.isFile())) throw new Error('The selected save path changed. Refresh the folder.');
          if (index >= selection.inputs.length && targetStat) throw new Error('A sidecar appeared while replacing the save. Refresh the folder.');
          await fsp.rename(temporary[index], targets[index]); committed.push(index);
        }
      } catch (error) {
        for (const index of committed.reverse()) {
          if (index >= selection.inputs.length) { await fsp.rm(targets[index], { force: true }); continue; }
          const rollback = path.join(path.dirname(targets[index]), `.garlic-pc-${randomUUID()}.tmp`);
          try {
            await copySynced(path.join(path.dirname(backup), path.basename(targets[index])), rollback, true);
            await fsp.rename(rollback, targets[index]);
          } finally { await fsp.rm(rollback, { force: true }); }
        }
        throw error;
      } finally { for (const file of temporary) await fsp.rm(file, { force: true }); }
      return { destination: selection.selected, backup, files: targets };
    });
  }

  // Function Upload Staging
  async prepareUpload(entryId) {
    return this.serial(async () => {
      const { root, record } = await this.selectedTitle(entryId);
      if (record.conflicts.size) throw new Error('The selected save folder has case-conflicting names.');
      await fsp.mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
      const stagingRoot = await fsp.realpath(this.stagingRoot);
      for (const entry of await fsp.readdir(stagingRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('local-pc-upload-')) continue;
        const selected = path.join(stagingRoot, entry.name);
        try {
          const marker = path.join(selected, '.garlic-local-pc-upload');
          if ((await fsp.lstat(marker)).isSymbolicLink()) continue;
          if ((await fsp.readFile(marker, 'utf8')) === STAGING_MARKER) {
            const retained = [...this.stages.values()].some(stage => stage.root === selected && stage.uses);
            if (retained) continue;
            await fsp.rm(selected, { recursive: true, force: true });
            for (const [id, stage] of this.stages) if (stage.root === selected) this.stages.delete(id);
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const stage = await fsp.mkdtemp(path.join(stagingRoot, 'local-pc-upload-'));
      const folder = path.join(stage, record.entry.title);
      try {
        await fsp.mkdir(folder);
        await fsp.writeFile(path.join(stage, '.garlic-local-pc-upload'), STAGING_MARKER, { mode: 0o600 });
        for (const item of record.files) {
          const selected = await this.checked(root, path.join(record.folder, item.file));
          await copySynced(selected, path.join(folder, item.file), true);
        }
      } catch (error) { await fsp.rm(stage, { recursive: true, force: true }); throw error; }
      const stageId = randomUUID();
      this.stages.set(stageId, { root: stage, folder, parent: stagingRoot, uses: 0, released: false });
      return { folder, titleId: record.entry.title, files: record.files.map(file => file.file), stageId };
    });
  }

  // Function Upload Retaining
  retainUpload(id, folder) {
    const stage = typeof id === 'string' ? this.stages.get(id) : null;
    if (!stage || stage.released || stage.folder !== path.resolve(folder || '')) {
      throw new Error('The prepared Local PC upload is no longer available. Select the save again.');
    }
    stage.uses++;
    let retained = true;
    return async () => this.serial(async () => {
      if (!retained) return;
      retained = false;
      stage.uses--;
      stage.released = true;
      if (!stage.uses) await this.removeUpload(id, stage);
    });
  }

  // Function Upload Release
  releaseUpload(id) {
    return this.serial(async () => {
      const stage = typeof id === 'string' ? this.stages.get(id) : null;
      if (!stage) return false;
      stage.released = true;
      if (stage.uses) return false;
      await this.removeUpload(id, stage);
      return true;
    });
  }

  // Function Upload Removal
  async removeUpload(id, stage) {
    try {
      const parent = await fsp.realpath(this.stagingRoot);
      const stat = await fsp.lstat(stage.root);
      if (parent !== stage.parent || !inside(parent, stage.root) ||
          !stat.isDirectory() || stat.isSymbolicLink() || await fsp.realpath(stage.root) !== stage.root) {
        throw new Error('The upload staging folder has changed.');
      }
      const marker = path.join(stage.root, '.garlic-local-pc-upload');
      if ((await fsp.lstat(marker)).isSymbolicLink() || await fsp.readFile(marker, 'utf8') !== STAGING_MARKER) {
        throw new Error('The upload staging marker has changed.');
      }
      await fsp.rm(stage.root, { recursive: true, force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.stages.delete(id);
  }

}

module.exports = { LocalPcStore };
