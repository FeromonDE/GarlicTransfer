const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { LocalPcStore } = require('../electron/local_pc.cjs');

for (const withUser of [true, false]) {
  test(`PC ${withUser ? 'user' : 'unassigned'} folder prepares a complete upload for the destination user`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-pc-transfer-'));
    try {
      const saves = path.join(root, 'Saves');
      const game = path.join(saves, ...(withUser ? ['aabbccdd'] : []), 'PPSA12345');
      await fs.mkdir(game, { recursive: true });
      const payloads = { sdimg_DATA: 'encrypted-data', sdimg_sce_sdmemory: 'encrypted-memory' };
      for (const [name, data] of Object.entries(payloads)) await fs.writeFile(path.join(game, name), data);
      await fs.writeFile(path.join(game, 'notes.txt'), 'do not upload this');
      const store = new LocalPcStore({ stateFile: path.join(root, 'app/state.json'), backupRoot: path.join(root, 'app/backups'), stagingRoot: path.join(root, 'app/staging') });
      const inventory = await store.setRoot(saves);
      assert.equal(inventory.entries[0].owner, withUser ? 'aabbccdd' : 'unassigned');
      const staged = await store.prepareUpload(inventory.entries[0].id);
      const output = path.join(root, 'transfer.db'), manifest = path.join(root, 'transfer.json'), assets = path.join(root, 'assets');
      const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import json, sqlite3, sys
from contextlib import closing
from pathlib import Path
from poc.dt_metadata import create_external_save
create_external_save(Path(sys.argv[1]), '18c60ea2', 'PPSA12345', Path(sys.argv[2]), Path(sys.argv[3]), manifest_output=Path(sys.argv[4]))
with closing(sqlite3.connect(sys.argv[1])) as db:
    directory = db.execute('SELECT path, actual_size FROM dir_entry_info_tbl').fetchone()
    user = db.execute('SELECT user_id FROM user_info_tbl').fetchone()[0]
print(json.dumps({'directory':directory,'user':user,'manifest':json.loads(Path(sys.argv[4]).read_text())}))
`, output, staged.folder, assets, manifest], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const data = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
      const prefix = '/user/home/18c60ea2/savedata_prospero/PPSA12345/';
      assert.deepEqual(data.directory, [prefix, Object.values(payloads).reduce((sum, bytes) => sum + Buffer.byteLength(bytes), 0)]);
      assert.equal(data.user, parseInt('18c60ea2', 16));
      const entry = data.manifest['65536'];
      assert.deepEqual(entry.files.map(file => file.file).sort(), Object.keys(payloads).sort());
      for (const file of entry.files) {
        assert.equal(file.path, prefix + file.file);
        assert.equal(Buffer.from(file.header, 'hex').readUInt32LE(0), 0x35504647);
        assert.equal(await fs.readFile(path.join(assets, '65536', file.file), 'utf8'), payloads[file.file]);
        assert.equal(await fs.readFile(path.join(game, file.file), 'utf8'), payloads[file.file]);
      }
      assert.equal(Buffer.from(entry.final_header, 'hex')[274], 1);
      assert.deepEqual((await fs.readdir(game)).sort(), [...Object.keys(payloads), 'notes.txt'].sort());
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}
