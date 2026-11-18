const myControls = {};
for (const id of [
  'mySavesTab', 'mySaveEntries', 'myTitleEntries', 'myTitleList', 'myTitleSaveList',
  'mySavesBackBtn', 'mySavesLibraryLabel', 'localConsoleSelect', 'localUserSelect',
  'refreshMySavesBtn', 'decryptExternalBtn', 'selectedSavePanel',
  'selectedSaveName', 'selectedSaveDetails', 'mySaveDecryptBtn', 'mySaveResignBtn', 'mySaveExportBtn',
  'saveMoreBtn', 'saveMoreOptions', 'decryptExportBtn', 'saveEncryptFileBtn',
  'uploadSaveBtn', 'uploadEncryptedBtn', 'workspaceMoreBtn', 'workspaceMoreOptions', 'fileMoreBtn', 'fileMoreOptions',
  'mySaveImportBtn', 'resignPanel', 'resignAccountId', 'confirmResignBtn', 'workspacePanel',
  'workspaceSummary', 'closeWorkspaceBtn', 'exportDecryptedBtn', 'addFilesBtn', 'encryptSaveBtn',
  'encryptPanel', 'encryptAccountId', 'confirmEncryptBtn', 'workspaceFiles', 'fileEditorPanel',
  'editorFileName', 'editorMode', 'fileEditor', 'editorHint', 'saveFileBtn', 'downloadFileBtn',
  'deleteFileBtn', 'mySavesStatus', 'mySavesLog',
]) myControls[id] = document.getElementById(id);
myControls.mySavesTab = document.getElementById('libraryPage');

let mySaves = [];
let localProfiles = [];
let selectedTitle = null;
let selectedLocalSave = null;
let decryptedWorkspace = null;
let decryptedArchive = null;
let workspaceDetails = null;
let selectedWorkspaceFile = null;
let selectedFileBytes = null;
let editorDirty = false;
let mySaveOperation = false;

function myStatus(message) {
  myControls.mySavesStatus.textContent = message;
}

function myLog(message) {
  myControls.mySavesLog.textContent += `${message}\n`;
  myControls.mySavesLog.scrollTop = myControls.mySavesLog.scrollHeight;
}

function setMyOperation(value) {
  mySaveOperation = value;
  for (const button of document.querySelectorAll('#mySavesTab button')) button.disabled = value;
  myControls.fileEditor.disabled = value;
  myControls.editorMode.disabled = value;
  myControls.resignAccountId.disabled = value;
  myControls.encryptAccountId.disabled = value;
  myControls.workspaceFiles.style.pointerEvents = value ? 'none' : '';
  if (!value) updateMyFileActions();
}

async function runMyOperation(action) {
  if (mySaveOperation || activeTransfer || browseSessionActive) {
    myStatus('Finish the current transfer or save operation first.');
    return null;
  }
  activeTransfer = 'save-editor';
  setMyOperation(true);
  busy(true);
  try {
    return await action();
  } catch (error) {
    myStatus(error.message);
    myLog(`Error: ${error.message}`);
    return null;
  } finally {
    activeTransfer = null;
    setMyOperation(false);
    busy(false);
  }
}

function localSaveKey(save) {
  return `${save.entry.id}:${save.file.file}`;
}

function myTitleGroups() {
  const groups = new Map();
  for (const save of mySaves) {
    const key = save.entry.title || save.entry.name;
    if (!groups.has(key)) groups.set(key, { key, name: save.entry.name || save.entry.title, titleId: save.entry.title, saves: [], bytes: 0 });
    const group = groups.get(key);
    group.saves.push(save);
    group.bytes += save.file.size;
  }
  return groups;
}

function selectMyTitle(title) {
  selectedTitle = title;
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  renderMySaves();
  const group = myTitleGroups().get(title);
  myStatus(`${group.name}: ${group.saves.length} save file(s). Select one to continue.`);
}

function renderMySaves() {
  const groups = myTitleGroups();
  const selectedGroup = selectedTitle ? groups.get(selectedTitle) : null;
  if (selectedTitle && !selectedGroup) selectedTitle = null;
  myControls.myTitleList.hidden = Boolean(selectedTitle);
  myControls.myTitleSaveList.hidden = !selectedTitle;
  myControls.mySavesBackBtn.hidden = !selectedTitle;
  myControls.mySavesLibraryLabel.textContent = selectedGroup ? selectedGroup.name : 'All titles';
  myControls.myTitleEntries.replaceChildren();
  myControls.mySaveEntries.replaceChildren();
  if (!mySaves.length) {
    myControls.myTitleEntries.innerHTML = '<tr><td colspan="4" class="empty">No downloaded saves yet. Use the Transfer tab to download one.</td></tr>';
    return;
  }
  if (!selectedTitle) {
    for (const group of groups.values()) {
      const row = document.createElement('tr');
      const title = document.createElement('td');
      title.textContent = group.name;
      const count = document.createElement('td');
      count.textContent = `${group.saves.length}`;
      const size = document.createElement('td');
      size.textContent = `${(group.bytes / 0x100000).toFixed(1)} MiB`;
      const actions = document.createElement('td');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'secondary';
      open.textContent = 'View saves';
      open.addEventListener('click', () => selectMyTitle(group.key));
      actions.appendChild(open);
      row.append(title, count, size, actions);
      row.addEventListener('click', () => selectMyTitle(group.key));
      myControls.myTitleEntries.appendChild(row);
    }
    return;
  }
  for (const save of selectedGroup.saves) {
    const row = document.createElement('tr');
    if (selectedLocalSave && localSaveKey(selectedLocalSave) === localSaveKey(save)) row.className = 'selected';
    const file = document.createElement('td');
    file.textContent = save.file.file;
    const entryLabel = document.createElement('span');
    entryLabel.className = 'title-id';
    entryLabel.textContent = `Entry ${save.entry.id}`;
    file.appendChild(entryLabel);
    const size = document.createElement('td');
    size.textContent = `${(save.file.size / 0x100000).toFixed(1)} MiB`;
    const actions = document.createElement('td');
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'secondary';
    select.textContent = selectedLocalSave && localSaveKey(selectedLocalSave) === localSaveKey(save) ? 'Selected' : 'Select';
    select.addEventListener('click', () => selectMySave(save));
    actions.appendChild(select);
    row.append(file, size, actions);
    row.addEventListener('click', () => selectMySave(save));
    myControls.mySaveEntries.appendChild(row);
  }
}

myControls.mySavesBackBtn.addEventListener('click', () => {
  selectedTitle = null;
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  renderMySaves();
  myStatus('Select a title to see its saves.');
});

function selectMySave(save) {
  selectedLocalSave = save;
  myControls.selectedSavePanel.hidden = false;
  myControls.selectedSaveName.textContent = save.entry.name || save.entry.title;
  myControls.selectedSaveDetails.textContent = `${save.file.file} · Entry ${save.entry.id} · ${(save.file.size / 0x100000).toFixed(1)} MiB · ${save.entry.title}`;
  myControls.resignPanel.hidden = true;
  renderMySaves();
  myStatus(`${save.file.file} selected. Choose what you want to do next.`);
}

async function selectLocalConsole(profileId) {
  const profile = localProfiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    mySaves = [];
    renderMySaves();
    myStatus('No downloaded saves were found in this profile.');
    return;
  }
  if (decryptedWorkspace && !window.confirm('Switch profiles and close the current decrypted files?')) {
    myControls.localConsoleSelect.value = options().assets.split(/[\\/]/).pop();
    return;
  }
  if (decryptedWorkspace) closeMyWorkspace();
  selectedTitle = null;
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  controls.output.value = profile.path;
  controls.assets.value = profile.path;
  controls.metadata.value = '';
  const previousUser = myControls.localUserSelect.value;
  myControls.localUserSelect.replaceChildren();
  const allUsers = document.createElement('option');
  allUsers.value = '';
  allUsers.textContent = 'All users';
  myControls.localUserSelect.appendChild(allUsers);
  for (const owner of profile.users) {
    const option = document.createElement('option');
    option.value = owner;
    option.textContent = owner;
    myControls.localUserSelect.appendChild(option);
  }
  myControls.localUserSelect.value = profile.users.includes(previousUser) ? previousUser : '';
  await refreshMySaves();
  myStatus(`${profile.id}: ${mySaves.length} save file(s)${myControls.localUserSelect.value ? ` for ${myControls.localUserSelect.value}` : ''}.`);
}

async function loadLocalProfiles() {
  const root = profileRoot || options().output;
  const result = await window.saveTransfer.localProfiles(root);
  localProfiles = result.profiles || [];
  const current = options().assets.split(/[\\/]/).pop();
  const selected = localProfiles.find((profile) => profile.id === current) || localProfiles[0];
  myControls.localConsoleSelect.replaceChildren();
  for (const profile of localProfiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.name ? `${profile.name} — ` : ''}${profile.id} (${profile.save_count} saves)`;
    myControls.localConsoleSelect.appendChild(option);
  }
  if (selected) {
    myControls.localConsoleSelect.value = selected.id;
    await selectLocalConsole(selected.id);
  } else {
    await selectLocalConsole('');
  }
}

myControls.localConsoleSelect.addEventListener('change', () => runMyOperation(() => selectLocalConsole(myControls.localConsoleSelect.value)));
myControls.localUserSelect.addEventListener('change', () => runMyOperation(async () => {
  selectedTitle = null;
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  await refreshMySaves();
  myStatus(`${mySaves.length} save file(s) in this view.`);
}));

async function refreshMySaves() {
  const result = await window.saveTransfer.localSaves(options().assets);
  const owner = myControls.localUserSelect.value.toLowerCase();
  mySaves = (result.entries || [])
    .filter((entry) => !owner || entry.owner.toLowerCase() === owner)
    .flatMap((entry) => entry.files.map((file) => ({ entry, file })));
  if (selectedLocalSave) {
    selectedLocalSave = mySaves.find((save) => localSaveKey(save) === localSaveKey(selectedLocalSave)) || null;
    myControls.selectedSavePanel.hidden = !selectedLocalSave;
  }
  renderMySaves();
  for (const warning of result.warnings || []) myLog(`Skipped invalid save metadata: ${warning}`);
  return mySaves.length;
}

function updateMyFileActions() {
  const protectedSelection = selectedWorkspaceFile?.protected;
  myControls.deleteFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile || protectedSelection;
  myControls.saveFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile;
  myControls.saveEncryptFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile;
  myControls.downloadFileBtn.disabled = mySaveOperation || !selectedWorkspaceFile;
}

function renderWorkspace() {
  myControls.workspacePanel.hidden = !decryptedWorkspace;
  if (!decryptedWorkspace || !workspaceDetails) return;
  myControls.workspaceSummary.textContent = `${workspaceDetails.files.length} file(s)${workspaceDetails.titleId ? ` · ${workspaceDetails.titleId}` : ''}${workspaceDetails.accountId ? ` · Account ID ${workspaceDetails.accountId}` : ''}`;
  myControls.encryptAccountId.value = workspaceDetails.accountId || myControls.encryptAccountId.value;
  myControls.workspaceFiles.replaceChildren();
  for (const file of workspaceDetails.files) {
    const row = document.createElement('tr');
    if (selectedWorkspaceFile?.path === file.path) row.className = 'selected';
    const name = document.createElement('td');
    name.textContent = file.path;
    const size = document.createElement('td');
    size.textContent = file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KiB`;
    row.append(name, size);
    row.addEventListener('click', () => runMyOperation(() => openWorkspaceFile(file)));
    myControls.workspaceFiles.appendChild(row);
  }
}

function bytesToHex(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = [...bytes.slice(offset, offset + 16)];
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${chunk.map((byte) => byte.toString(16).padStart(2, '0')).join(' ')}`);
  }
  return lines.join('\n');
}

function editorBytes() {
  if (myControls.editorMode.value === 'text') return new TextEncoder().encode(myControls.fileEditor.value);
  const text = myControls.fileEditor.value.replace(/^[0-9a-f]{8}\s+/gm, '').replace(/\s+/g, '');
  if (text.length % 2 || /[^0-9a-f]/i.test(text)) throw new Error('Hex mode requires complete bytes written as two hexadecimal digits.');
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function renderEditor() {
  if (!selectedWorkspaceFile || selectedFileBytes === null) {
    myControls.fileEditorPanel.hidden = true;
    return;
  }
  myControls.fileEditorPanel.hidden = false;
  myControls.editorFileName.textContent = selectedWorkspaceFile.path;
  myControls.fileEditor.value = myControls.editorMode.value === 'hex'
    ? bytesToHex(selectedFileBytes)
    : new TextDecoder().decode(selectedFileBytes);
  editorDirty = false;
  myControls.saveFileBtn.textContent = 'Save changes';
  updateMyFileActions();
}

async function openWorkspaceFile(file) {
  if (editorDirty && !window.confirm('Discard unsaved changes to this file?')) return;
  selectedWorkspaceFile = file;
  selectedFileBytes = null;
  myControls.fileEditorPanel.hidden = true;
  const result = await window.saveEditor.read({ root: decryptedWorkspace, path: file.path });
  selectedFileBytes = Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0));
  if ([...selectedFileBytes.slice(0, 256)].includes(0)) myControls.editorMode.value = 'hex';
  renderEditor();
  renderWorkspace();
}

function closeMyWorkspace() {
  if (editorDirty && !window.confirm('Close the decrypted files and discard unsaved editor changes?')) return;
  decryptedWorkspace = null;
  decryptedArchive = null;
  workspaceDetails = null;
  selectedWorkspaceFile = null;
  selectedFileBytes = null;
  editorDirty = false;
  myControls.workspacePanel.hidden = true;
  myControls.encryptPanel.hidden = true;
  myStatus('Decrypted files closed. Your original save is still selected.');
}

async function decryptInputs(inputs) {
  if (!inputs.length) return;
  myStatus('Decrypting your save…');
  const result = await window.saveEditor.run({
    operation: 'decrypt',
    inputs,
    platform: 'ps5',
    serverUrl: options().serverUrl,
    workerKey: options().workerKey,
  });
  if (!result) return;
  decryptedWorkspace = result.workspace;
  decryptedArchive = result.archivePath;
  workspaceDetails = result.info;
  selectedWorkspaceFile = null;
  selectedFileBytes = null;
  editorDirty = false;
  renderWorkspace();
  myStatus('Your save is decrypted. Select a file to edit, or export the decrypted ZIP.');
  myLog('Decrypted files are ready to edit.');
}

myControls.refreshMySavesBtn.addEventListener('click', () => runMyOperation(async () => {
  await loadLocalProfiles();
  myStatus(mySaves.length ? `Found ${mySaves.length} local save file(s).` : 'No downloaded saves yet. Use the Transfer tab to download one.');
}));

myControls.decryptExternalBtn.addEventListener('click', () => runMyOperation(async () => {
  selectedLocalSave = null;
  myControls.selectedSavePanel.hidden = true;
  const inputs = await window.saveEditor.chooseInput();
  await decryptInputs(inputs);
}));

myControls.mySaveDecryptBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!selectedLocalSave) return;
  const inputs = await window.saveEditor.localFile({
    assets: options().assets,
    entryId: selectedLocalSave.entry.id,
    filename: selectedLocalSave.file.file,
  });
  await decryptInputs(inputs);
}));

async function uploadCurrentSave() {
  if (!selectedLocalSave) return;
  pendingUploadEntryIds = [selectedLocalSave.entry.id];
  pendingUploadUserId = selectedLocalSave.entry.owner;
  document.querySelector('[data-page="upload"]').click();
  await startUpload();
}

myControls.uploadSaveBtn.addEventListener('click', uploadCurrentSave);
myControls.uploadEncryptedBtn.addEventListener('click', uploadCurrentSave);

function closeExportMenu() {
  for (const [button, options] of [
    ['saveMoreBtn', 'saveMoreOptions'],
    ['workspaceMoreBtn', 'workspaceMoreOptions'],
    ['fileMoreBtn', 'fileMoreOptions'],
  ]) {
    myControls[options].hidden = true;
    myControls[button].setAttribute('aria-expanded', 'false');
  }
}

for (const [button, options] of [
  ['saveMoreBtn', 'saveMoreOptions'],
  ['workspaceMoreBtn', 'workspaceMoreOptions'],
  ['fileMoreBtn', 'fileMoreOptions'],
]) {
  myControls[button].addEventListener('click', (event) => {
    event.stopPropagation();
    const wasOpen = !myControls[options].hidden;
    closeExportMenu();
    myControls[options].hidden = wasOpen;
    myControls[button].setAttribute('aria-expanded', String(!wasOpen));
  });
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('.dropdown')) closeExportMenu();
});

myControls.decryptExportBtn.addEventListener('click', () => runMyOperation(async () => {
  closeExportMenu();
  if (!selectedLocalSave) return;
  const inputs = await window.saveEditor.localFile({
    assets: options().assets,
    entryId: selectedLocalSave.entry.id,
    filename: selectedLocalSave.file.file,
  });
  await decryptInputs(inputs);
  if (!decryptedArchive) return;
  const destination = await window.saveEditor.downloadArchive(decryptedArchive);
  if (destination) {
    closeMyWorkspace();
    myStatus(`Decrypted save exported to ${destination}`);
  }
}));

myControls.mySaveExportBtn.addEventListener('click', () => runMyOperation(async () => {
  closeExportMenu();
  if (!selectedLocalSave) return;
  const result = await window.saveTransfer.exportLocalSave({
    assets: options().assets,
    entryId: selectedLocalSave.entry.id,
    filename: selectedLocalSave.file.file,
  });
  if (result) myStatus(`Original save exported to ${result.destination}`);
}));

myControls.mySaveImportBtn.addEventListener('click', () => {
  if (selectedLocalSave) chooseImportReplacement(selectedLocalSave.entry, selectedLocalSave.file);
});

myControls.mySaveResignBtn.addEventListener('click', () => {
  if (!selectedLocalSave) return;
  myControls.resignPanel.hidden = !myControls.resignPanel.hidden;
});

myControls.confirmResignBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!selectedLocalSave) return;
  const accountId = myControls.resignAccountId.value.trim();
  if (!/^[0-9a-f]{16}$/i.test(accountId)) {
    myStatus('Enter a 16-digit hexadecimal account ID before resigning.');
    return;
  }
  const output = await window.saveEditor.chooseOutput(`${selectedLocalSave.file.file}-resigned.zip`);
  if (!output) return;
  const inputs = await window.saveEditor.localFile({
    assets: options().assets,
    entryId: selectedLocalSave.entry.id,
    filename: selectedLocalSave.file.file,
  });
  myStatus('Resigning your save…');
  const result = await window.saveEditor.run({
    operation: 'resign', inputs, accountId, output, platform: 'ps5',
    serverUrl: options().serverUrl, workerKey: options().workerKey,
  });
  if (result) {
    myControls.resignPanel.hidden = true;
    myStatus(`Resigned save exported to ${result.output}`);
    myLog(`Resigned copy: ${result.output}`);
  }
}));

myControls.exportDecryptedBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!decryptedArchive) return;
  const destination = await window.saveEditor.downloadArchive(decryptedArchive);
  if (destination) myStatus(`Decrypted ZIP exported to ${destination}`);
}));

myControls.addFilesBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!decryptedWorkspace) return;
  const result = await window.saveEditor.add(decryptedWorkspace);
  if (result) {
    workspaceDetails = result;
    renderWorkspace();
    myStatus('Files added to the decrypted workspace.');
  }
}));

myControls.encryptSaveBtn.addEventListener('click', () => runMyOperation(encryptWorkspace));

async function encryptWorkspace() {
  if (!decryptedWorkspace) return null;
  const accountId = myControls.encryptAccountId.value.trim();
  if (!/^[0-9a-f]{16}$/i.test(accountId)) {
    myStatus('Enter a 16-digit hexadecimal account ID before encrypting.');
    return null;
  }
  myStatus('Encrypting your edited save…');
  let result;
  if (selectedLocalSave) {
    if (!window.confirm(`Replace ${selectedLocalSave.file.file} with your edited save? A backup will be created first.`)) return null;
    const backup = await window.saveEditor.backupLocal({
      assets: options().assets,
      entryId: selectedLocalSave.entry.id,
      filename: selectedLocalSave.file.file,
    });
    result = await window.saveEditor.encryptLocal({
      workspace: decryptedWorkspace, accountId, platform: 'ps5',
      serverUrl: options().serverUrl, workerKey: options().workerKey,
    });
    await window.saveTransfer.importLocalSave({
      assets: options().assets,
      entryId: selectedLocalSave.entry.id,
      filename: selectedLocalSave.file.file,
      source: result.output,
    });
    await refreshMySaves();
    myLog(`Backup: ${backup}`);
  } else {
    const output = await window.saveEditor.chooseOutput(`${workspaceDetails.titleId || 'save'}-encrypted.zip`);
    if (!output) return null;
    result = await window.saveEditor.run({
      operation: 'encrypt', workspace: decryptedWorkspace, accountId, output, platform: 'ps5',
      serverUrl: options().serverUrl, workerKey: options().workerKey,
    });
  }
  if (result) {
    myControls.encryptPanel.hidden = true;
    myStatus(selectedLocalSave
      ? `${selectedLocalSave.file.file} was replaced with your edited save. A backup is available.`
      : `Encrypted save exported to ${result.output}`);
    myLog(`Encrypted copy: ${result.output}`);
  }
  return result;
}

myControls.confirmEncryptBtn.addEventListener('click', () => runMyOperation(encryptWorkspace));

myControls.closeWorkspaceBtn.addEventListener('click', closeMyWorkspace);
myControls.editorMode.addEventListener('change', () => {
  if (!selectedFileBytes) return;
  const previousMode = myControls.editorMode.value === 'hex' ? 'text' : 'hex';
  try {
    if (editorDirty) {
      selectedFileBytes = editorBytes();
      editorDirty = false;
    }
    renderEditor();
  } catch (error) {
    myControls.editorMode.value = previousMode;
    myStatus(error.message);
  }
});
myControls.fileEditor.addEventListener('input', () => {
  editorDirty = true;
  myControls.saveFileBtn.textContent = 'Save changes *';
});
async function saveCurrentEditorFile() {
  if (!selectedWorkspaceFile) return false;
  const bytes = editorBytes();
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  workspaceDetails = await window.saveEditor.write({
    root: decryptedWorkspace,
    path: selectedWorkspaceFile.path,
    data: btoa(binary),
  });
  selectedFileBytes = bytes;
  editorDirty = false;
  myControls.saveFileBtn.textContent = 'Save changes';
  renderWorkspace();
  return true;
}

myControls.saveFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (await saveCurrentEditorFile()) myStatus(`${selectedWorkspaceFile.path} updated in the decrypted workspace.`);
}));
myControls.saveEncryptFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (await saveCurrentEditorFile()) await encryptWorkspace();
}));
myControls.downloadFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!selectedWorkspaceFile) return;
  const destination = await window.saveEditor.downloadFile({ root: decryptedWorkspace, path: selectedWorkspaceFile.path });
  if (destination) myStatus(`File exported to ${destination}`);
}));
myControls.deleteFileBtn.addEventListener('click', () => runMyOperation(async () => {
  if (!selectedWorkspaceFile || selectedWorkspaceFile.protected) return;
  if (!window.confirm(`Delete ${selectedWorkspaceFile.path} from the decrypted workspace?`)) return;
  workspaceDetails = await window.saveEditor.delete({ root: decryptedWorkspace, path: selectedWorkspaceFile.path });
  myLog(`Deleted ${selectedWorkspaceFile.path} from the decrypted workspace.`);
  selectedWorkspaceFile = null;
  selectedFileBytes = null;
  myControls.fileEditorPanel.hidden = true;
  renderWorkspace();
}));

for (const tab of document.querySelectorAll('.nav-item')) {
  tab.addEventListener('click', () => {
    myControls.mySavesTab.hidden = tab.dataset.page !== 'library';
    if (tab.dataset.page === 'library') {
      runMyOperation(async () => {
        await loadLocalProfiles();
        myStatus(mySaves.length ? 'Select a save to get started.' : 'Download a save with the Transfer tab, or decrypt another save.');
      });
    }
  });
}

document.addEventListener('local-save-replaced', async () => {
  await refreshMySaves();
  myStatus('Save replaced and its upload metadata refreshed.');
});

window.saveEditor.onEvent((event) => {
  if (event.type === 'status') myStatus(event.message);
  if (event.type === 'log') myLog(event.message);
  if (event.type === 'error') myStatus(event.message);
});
