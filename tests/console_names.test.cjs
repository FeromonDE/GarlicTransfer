const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadConsoleNames, recordConsoleNames } = require('../electron/console_names.cjs');

test('console names persist by host ID', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-console-names-'));
  recordConsoleNames(root, [{ hostId: 'aaa', name: 'fert', firmware: '13.60' }]);
  recordConsoleNames(root, [{ hostId: 'bbb', name: '1360', firmware: '13.60' }]);
  assert.deepEqual(loadConsoleNames(root), {
    aaa: { name: 'fert', firmware: '13.60' },
    bbb: { name: '1360', firmware: '13.60' },
  });
});
