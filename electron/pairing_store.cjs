const fs = require('node:fs');
const path = require('node:path');

function pairingPrefixPath(userData, { hostId, systemVersion }) {
  if (typeof hostId !== 'string' || !/^[0-9a-f]{12}$/i.test(hostId)) {
    throw new Error('Discover a console with a valid host ID before pairing');
  }
  if (typeof systemVersion !== 'string' || !/^[0-9a-f]{8}$/i.test(systemVersion)) {
    throw new Error('Discover the console firmware before pairing');
  }
  return path.join(userData, 'pairings', `${hostId.toUpperCase()}-${systemVersion.toUpperCase()}`, 'pairing-prefix.bin');
}

function existingPairingPrefix(userData, identity) {
  const file = pairingPrefixPath(userData, identity);
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size === 32 ? file : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Function Pairing Containment
function insideDirectory(root, selected) {
  const relative = path.relative(root, selected);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Function Pairing Folder
function pairingDirectory(root, selected) {
  try {
    const stat = fs.lstatSync(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const actual = fs.realpathSync(selected);
    return insideDirectory(root, actual) ? actual : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Function Pairing File
function pairingFile(root, selected) {
  try {
    const stat = fs.lstatSync(selected);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === 32 && insideDirectory(root, fs.realpathSync(selected));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Function Pairing Information
function pairingInfo(userData, identity) {
  if (!identity || typeof identity.hostId !== 'string' || identity.hostId.length !== 12 || !/^[0-9a-f]{12}$/i.test(identity.hostId)
      || typeof identity.systemVersion !== 'string' || identity.systemVersion.length !== 8 || !/^[0-9a-f]{8}$/i.test(identity.systemVersion)) {
    return { status: 'unknown' };
  }
  let base;
  try { base = fs.realpathSync(userData); }
  catch (error) {
    if (error.code === 'ENOENT') return { status: 'unpaired' };
    throw error;
  }
  const folder = pairingDirectory(base, path.join(userData, 'pairings'));
  if (!folder) return { status: 'unpaired' };
  const current = pairingPrefixPath(userData, identity);
  const currentFolder = pairingDirectory(folder, path.dirname(current));
  if (currentFolder && existingPairingPrefix(userData, identity) && pairingFile(currentFolder, current)) {
    return { status: 'paired' };
  }
  const host = identity.hostId.toUpperCase();
  const firmware = identity.systemVersion.toUpperCase();
  for (const name of fs.readdirSync(folder)) {
    if (name.length !== 21) continue;
    const match = /^([0-9a-f]{12})-([0-9a-f]{8})$/i.exec(name);
    if (!match || match[1].toUpperCase() !== host || match[2].toUpperCase() === firmware) continue;
    const previous = pairingDirectory(folder, path.join(folder, name));
    if (previous && pairingFile(previous, path.join(previous, 'pairing-prefix.bin'))) return { status: 'previous' };
  }
  return { status: 'unpaired' };
}

module.exports = { pairingPrefixPath, existingPairingPrefix, pairingInfo };
