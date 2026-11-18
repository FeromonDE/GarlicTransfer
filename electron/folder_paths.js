/* Shared browser and main-process paths. */
(function expose(root, build) {
  const helpers = build();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else root.transferFolders = helpers;
})(typeof window === 'object' ? window : globalThis, function buildPaths() {
  const FOLDERS = Object.freeze({ metadata: 'Transfer-Metadata', saves: 'Saves', other: 'Other Needed Data' });

  // Find profile folder.
  function profileRootPath(directory) {
    let clean = directory.replace(/[\\/]+$/, '');
    if (clean.endsWith(`/${FOLDERS.metadata}`) || clean.endsWith(`\\${FOLDERS.metadata}`)) {
      clean = clean.slice(0, -FOLDERS.metadata.length - 1);
    }
    if (/^[A-Za-z]:$/.test(clean)) return `${clean}${directory.includes('\\') ? '\\' : '/'}`;
    return clean || (directory.startsWith('/') ? '/' : '\\');
  }

  // Join profile path.
  function joinProfilePath(directory, ...parts) {
    const separator = directory.includes('\\') ? '\\' : '/';
    return [directory.replace(/[\\/]+$/, ''), ...parts].join(separator);
  }

  // Build metadata path.
  function metadataPath(directory, ...parts) {
    return joinProfilePath(profileRootPath(directory), FOLDERS.metadata, ...parts);
  }

  // Build auxiliary path.
  function otherDataPath(directory, ...parts) {
    return joinProfilePath(profileRootPath(directory), FOLDERS.other, ...parts);
  }

  return Object.freeze({ FOLDERS, profileRootPath, joinProfilePath, metadataPath, otherDataPath });
});
