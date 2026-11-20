const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Function Temporary Folders
class SaveTemps {
  constructor(root) {
    this.root = path.resolve(root);
    this.records = new Map();
  }

  // Function Temporary Creation
  async create(prefix = 'upload-') {
    await fs.mkdir(this.root, { recursive: true });
    const parent = await fs.realpath(this.root);
    const directory = await fs.mkdtemp(path.join(parent, prefix));
    const id = randomUUID();
    this.records.set(id, { directory, parent, uses: 0, released: false });
    return { id, directory };
  }

  // Function Temporary Use
  use(selected) {
    const target = selected ? path.resolve(selected) : '';
    const records = [...this.records.values()].filter(record => target === record.directory || target.startsWith(record.directory + path.sep));
    for (const record of records) {
      if (record.released) throw new Error('The temporary save workspace has already been closed.');
      record.uses++;
    }
    let retained = true;
    return async () => {
      if (!retained) return;
      retained = false;
      for (const record of records) {
        record.uses--;
        if (record.released && !record.uses) await this.remove(record);
      }
    };
  }

  // Function Temporary Release
  async release(id) {
    const record = typeof id === 'string' ? this.records.get(id) : null;
    if (!record) return false;
    record.released = true;
    if (record.uses) return false;
    await this.remove(record);
    return true;
  }

  // Function Temporary Removal
  async remove(record) {
    try {
      if ((await fs.realpath(record.parent)) !== record.parent) throw new Error('The temporary folder location has changed.');
      const stat = await fs.lstat(record.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(record.directory) !== record.directory) {
        throw new Error('The temporary save folder has changed.');
      }
      await fs.rm(record.directory, { recursive: true, force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const [id, item] of this.records) if (item === record) this.records.delete(id);
  }
}

module.exports = { SaveTemps };
