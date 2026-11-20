const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saveTransfer', {
  getSkins: () => ipcRenderer.invoke('skins:list'),
  getSkinMascot: (id) => ipcRenderer.invoke('skins:mascot', id),
  openSkinsFolder: () => ipcRenderer.invoke('skins:open'),
  pairingAvailable: true,
  firewallAvailable: process.platform === 'win32',
  runFirewallHelper: () => ipcRenderer.invoke('windows:firewall-helper'),
  chooseOutput: () => ipcRenderer.invoke('dialog:output'),
  chooseMetadata: () => ipcRenderer.invoke('dialog:metadata'),
  chooseAssets: () => ipcRenderer.invoke('dialog:assets'),
  chooseExternalFolder: () => ipcRenderer.invoke('dialog:external-folder'),
  chooseExternalSave: () => ipcRenderer.invoke('dialog:external-save'),
  pair: (options) => ipcRenderer.invoke('transfer:pair', options),
  pairingStatus: (identity) => ipcRenderer.invoke('transfer:pair-status', identity),
  download: (options) => ipcRenderer.invoke('transfer:download', options),
  select: (entryIds) => ipcRenderer.invoke('transfer:select', entryIds),
  finish: () => ipcRenderer.invoke('transfer:finish'),
  upload: (options) => ipcRenderer.invoke('transfer:upload', options),
  users: (metadataPath) => ipcRenderer.invoke('transfer:users', metadataPath),
  inventory: (metadataPath) => ipcRenderer.invoke('transfer:inventory', metadataPath),
  localSaves: (assets) => ipcRenderer.invoke('local:inventory', assets),
  localProfiles: (assets) => ipcRenderer.invoke('local:profiles', assets),
  localPcState: () => ipcRenderer.invoke('local-pc:state'),
  localPcInventory: () => ipcRenderer.invoke('local-pc:inventory'),
  chooseLocalPcFolder: () => ipcRenderer.invoke('local-pc:choose-folder'),
  setLocalPcActive: (selected) => ipcRenderer.invoke('local-pc:active', selected),
  prepareLocalPcUpload: (options) => ipcRenderer.invoke('local-pc:prepare-upload', options),
  releaseLocalPcUpload: (id) => ipcRenderer.invoke('local-pc:release-upload', id),
  exportLocalSave: (options) => ipcRenderer.invoke('local:export', options),
  importLocalSave: (options) => ipcRenderer.invoke('local:import', options),
  discover: (options) => ipcRenderer.invoke('transfer:discover', options),
  power: () => ipcRenderer.invoke('transfer:power'),
  cancel: () => ipcRenderer.invoke('transfer:cancel'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  version: () => ipcRenderer.invoke('app:version'),
  onEvent: (callback) => {
    const listener = (_event, detail) => callback(detail);
    ipcRenderer.on('transfer:event', listener);
    return () => ipcRenderer.removeListener('transfer:event', listener);
  },
});

contextBridge.exposeInMainWorld('saveEditor', {
  cancel: () => ipcRenderer.invoke('save-editor:cancel'),
  chooseInput: () => ipcRenderer.invoke('save-editor:choose-input'),
  chooseWorkspace: () => ipcRenderer.invoke('save-editor:choose-workspace'),
  chooseOutput: (defaultPath) => ipcRenderer.invoke('save-editor:choose-output', defaultPath),
  localFile: (options) => ipcRenderer.invoke('save-editor:local-file', options),
  backupLocal: (options) => ipcRenderer.invoke('save-editor:backup-local', options),
  encryptLocal: (options) => ipcRenderer.invoke('save-editor:encrypt-local', options),
  info: (root) => ipcRenderer.invoke('save-editor:info', root),
  read: (options) => ipcRenderer.invoke('save-editor:read', options),
  write: (options) => ipcRenderer.invoke('save-editor:write', options),
  add: (root) => ipcRenderer.invoke('save-editor:add', { root }),
  delete: (options) => ipcRenderer.invoke('save-editor:delete', options),
  downloadFile: (options) => ipcRenderer.invoke('save-editor:download-file', options),
  downloadArchive: (archivePath) => ipcRenderer.invoke('save-editor:download-archive', { archivePath }),
  show: (path) => ipcRenderer.invoke('save-editor:show', path),
  run: (options) => ipcRenderer.invoke('save-editor:job', options),
  releaseTemporary: (id) => ipcRenderer.invoke('save-editor:release-temporary', id),
  onEvent: (callback) => {
    const listener = (_event, detail) => callback(detail);
    ipcRenderer.on('save-editor:event', listener);
    return () => ipcRenderer.removeListener('save-editor:event', listener);
  },
});
