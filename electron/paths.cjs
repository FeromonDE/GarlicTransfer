const { app } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const packaged = app.isPackaged;
const resourceRoot = packaged
  ? process.resourcesPath
  : path.resolve(__dirname, '..');

const pythonDir = path.join(resourceRoot, 'poc');
const dataDir = path.join(resourceRoot, 'data');
const localWorkerElf = path.join(pythonDir, 'local_worker', 'garlic-local-worker.elf');

// Python cwd must be writable and outside the asar virtual FS.
// resourcesPath on Windows contains app.asar — mkdir there throws FileExistsError.
const workDir = packaged ? app.getPath('userData') : path.resolve(__dirname, '..');

const defaultDownloads = packaged
  ? path.join(app.getPath('documents'), 'GarlicTransfer')
  : path.join(path.resolve(__dirname, '..'), 'dt_downloads');

let selectedMacPython = null;

function usableMacPython(python) {
  const result = spawnSync(python, [
    '-c', 'import sys; assert sys.version_info >= (3, 10); import cryptography',
  ], { stdio: 'ignore', timeout: 5000, windowsHide: true });
  return result.status === 0;
}

function pythonBin() {
  if (process.platform === 'win32') {
    const bundled = path.join(resourceRoot, 'python', 'python.exe');
    try { fs.accessSync(bundled); return bundled; } catch {}
    return 'python';
  }
  if (process.platform === 'darwin') {
    if (selectedMacPython) return selectedMacPython;
    const bundled = path.join(resourceRoot, 'python', 'bin', 'python3');
    const candidates = [
      bundled,
      '/opt/homebrew/bin/python3', '/usr/local/bin/python3',
      'python3', 'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10',
    ];
    for (const candidate of new Set(candidates)) {
      if (candidate === bundled && !fs.existsSync(bundled)) continue;
      if (usableMacPython(candidate)) {
        selectedMacPython = candidate;
        return selectedMacPython;
      }
    }
    selectedMacPython = 'python3';
  }
  return process.platform === 'darwin' ? selectedMacPython : 'python3';
}

module.exports = { resourceRoot, pythonDir, dataDir, localWorkerElf, workDir, defaultDownloads, pythonBin, packaged };
