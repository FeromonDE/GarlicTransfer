const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function editorWithReads(reads) {
  const filename = path.resolve(__dirname, '../electron/save_editor.cjs');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const context = vm.createContext({ module, Buffer, require: name => {
    if (name === 'node:fs/promises') return { ...fs, readdir: async (...args) => {
      const selected = path.resolve(args[0]);
      reads.set(selected, (reads.get(selected) || 0) + 1);
      // Reversed traversal makes file-list sorting a different SFO order.
      return (await fs.readdir(...args)).sort((a, b) => b.name.localeCompare(a.name));
    } };
    return localRequire(name);
  } });
  new vm.Script(syncFs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
  return module.exports;
}

async function fixture(t, includeSfo = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-workspace-scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [folder, account] of [['A', '1122334455667788'], ['Z', '8877665544332211']]) {
    await fs.mkdir(path.join(root, folder, 'sce_sys'), { recursive: true });
    if (includeSfo) {
      const bytes = Buffer.alloc(0x1c0);
      Buffer.from(account, 'hex').copy(bytes, 0x1b8);
      await fs.writeFile(path.join(root, folder, 'sce_sys', 'param.sfo'), bytes);
    }
    await fs.writeFile(path.join(root, folder, 'save.dat'), 'payload');
  }
  await fs.writeFile(path.join(root, 'chives.json'), JSON.stringify({ title_id: 'PPSA24003' }));
  return root;
}

test('workspace scans each folder once and preserves standalone account selection', async t => {
  const root = await fixture(t);
  const reads = new Map();
  const editor = editorWithReads(reads);
  const account = await editor.accountIdFromSfo(root);
  assert.equal(account, '8877665544332211');
  reads.clear();
  const info = await editor.workspaceInfo(root);
  assert.equal(info.accountId, account);
  assert.equal(info.titleId, 'PPSA24003');
  assert.equal(info.files.length, 5);
  assert.equal(reads.size, 5);
  for (const count of reads.values()) assert.equal(count, 1);
});

test('workspace without SFO avoids another traversal and reads fresh metadata next time', async t => {
  const root = await fixture(t, false);
  const reads = new Map();
  const { workspaceInfo } = editorWithReads(reads);
  assert.equal((await workspaceInfo(root)).accountId, '');
  assert.equal(reads.size, 5);
  for (const count of reads.values()) assert.equal(count, 1);
  const bytes = Buffer.alloc(0x1c0);
  Buffer.from('aabbccddeeff0011', 'hex').copy(bytes, 0x15c);
  await fs.writeFile(path.join(root, 'A', 'sce_sys', 'PARAM.SFO'), bytes);
  await fs.writeFile(path.join(root, 'chives.json'), JSON.stringify({ title_id: 'PPSA99999' }));
  reads.clear();
  const info = await workspaceInfo(root);
  assert.equal(info.accountId, 'aabbccddeeff0011');
  assert.equal(info.titleId, 'PPSA99999');
  for (const count of reads.values()) assert.equal(count, 1);
});

test('editing refreshes current sizes and metadata in a single folder walk', async t => {
  const root = await fixture(t);
  const reads = new Map();
  const editor = editorWithReads(reads);
  const data = Buffer.from('changed payload length');
  const info = await editor.writeWorkspaceFile(root, 'A/save.dat', data.toString('base64'));
  assert.equal(info.files.find(file => file.path === 'A/save.dat').size, data.length);
  assert.equal(info.accountId, '8877665544332211');
  assert.equal(await fs.readFile(path.join(root, 'A', 'save.dat'), 'utf8'), data.toString());
  assert.equal(reads.size, 5);
  for (const count of reads.values()) assert.equal(count, 1);
});
