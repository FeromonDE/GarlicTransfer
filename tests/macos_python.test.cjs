const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');


test('macOS selects and caches Python 3.10+ with cryptography', () => {
  const attempts = [];
  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const pathsModule = require.resolve('../electron/paths.cjs');
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return { app: { isPackaged: false, getPath: () => '/unused', } };
    }
    if (request === 'node:child_process') {
      return {
        spawnSync: (python, args) => {
          attempts.push({ python, args });
          if (python === 'python3') return { status: 1 };
          if (python === 'python3.12') return { status: 0 };
          return { status: null };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    delete require.cache[pathsModule];
    const { pythonBin } = require(pathsModule);
    assert.equal(pythonBin(), 'python3.12');
    const count = attempts.length;
    assert.equal(pythonBin(), 'python3.12');
    assert.equal(attempts.length, count);
    assert.ok(attempts.some(attempt => attempt.python === 'python3'));
    assert.ok(attempts.some(attempt => attempt.python === 'python3.12'));
    assert.ok(!attempts.some(attempt => attempt.python === 'python3.11'));
    const compatible = attempts.find(attempt => attempt.python === 'python3.12');
    assert.equal(compatible.args[0], '-c');
    assert.match(compatible.args[1], /sys\.version_info >= \(3, 10\)/);
    assert.match(compatible.args[1], /import cryptography/);
  } finally {
    delete require.cache[pathsModule];
    Module._load = originalLoad;
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});
