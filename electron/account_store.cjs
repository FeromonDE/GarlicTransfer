const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_ACCOUNT_NAME = 64;

// Function Account ID
function accountId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{16}$/i.test(value.trim())) {
    throw new Error('Enter a 16-character hexadecimal Account ID.');
  }
  return value.trim().toLowerCase();
}

// Function Account Name
function accountName(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(value)) {
    throw new Error('Account names cannot contain control characters.');
  }
  const name = value.trim();
  if (name.length > MAX_ACCOUNT_NAME) throw new Error(`Account names can contain up to ${MAX_ACCOUNT_NAME} characters.`);
  return name;
}

// Function Account Name Check
function checkName(accounts, id, name) {
  if (name && accounts.some(account => account.id !== id && account.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error('Name already in use.');
  }
}

// Function Account Reading
function readState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.accounts)
      || (value.version !== undefined && value.version !== 1)) throw new Error('Invalid saved account list.');
  const ids = new Set();
  const accounts = value.accounts.map(account => {
    const id = accountId(account?.id);
    if (ids.has(id)) throw new Error('Duplicate saved Account ID.');
    ids.add(id);
    return { id, name: accountName(account.name) };
  });
  const savedSelection = value.selectedId ?? '';
  if (typeof savedSelection !== 'string') throw new Error('Invalid selected account.');
  const selectedId = savedSelection ? accountId(savedSelection) : '';
  if (selectedId && !ids.has(selectedId)) throw new Error('The selected account is missing.');
  const displayMode = value.displayMode === undefined ? 'name' : value.displayMode;
  if (displayMode !== 'name' && displayMode !== 'id') throw new Error('Invalid account display mode.');
  if (value.useCurrent !== undefined && typeof value.useCurrent !== 'boolean') throw new Error('Invalid current account setting.');
  return { accounts, selectedId, displayMode, useCurrent: value.useCurrent ?? true };
}

class AccountStore {
  constructor(stateFile, { fileSystem = fs } = {}) {
    this.stateFile = path.resolve(stateFile);
    this.fs = fileSystem;
    this.state = { accounts: [], selectedId: '', displayMode: 'name', useCurrent: true };
    this.warning = '';
    this.recoveryRequired = false;
    this.recoveryFile = '';
    this.recoveryData = null;
    this.ready = this.load();
    this.pending = Promise.resolve();
  }

  // Function Account Loading
  async load() {
    try { this.state = readState(JSON.parse(await this.fs.readFile(this.stateFile, 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        this.recoveryRequired = true;
        this.warning = `Saved accounts could not be loaded: ${error.message}`;
      }
    }
  }

  // Function Account State
  snapshot() {
    return { accounts: this.state.accounts.map(account => ({ ...account })), selectedId: this.state.selectedId,
      displayMode: this.state.displayMode, useCurrent: this.state.useCurrent,
      ...(this.warning ? { warning: this.warning } : {}) };
  }

  // Function Account Queue
  serial(action) {
    const pending = this.pending.then(async () => { await this.ready; return action(); });
    this.pending = pending.catch(() => {});
    return pending;
  }

  async getState() { return this.serial(() => this.snapshot()); }

  // Function Account Recovery
  async preserve() {
    if (!this.recoveryRequired || this.recoveryFile) return;
    const data = await this.fs.readFile(this.stateFile);
    const recovery = `${this.stateFile}.recovery-${randomUUID()}.bak`;
    let handle;
    let owned = false;
    try {
      handle = await this.fs.open(recovery, 'wx', 0o600);
      owned = true;
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      handle = null;
      this.recoveryFile = recovery;
      this.recoveryData = Buffer.from(data);
      owned = false;
      this.warning += ` Recovery copy: ${recovery}`;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (owned) await this.fs.rm(recovery, { force: true }).catch(() => {});
      throw error;
    }
  }

  // Function Recovery Check
  async checkRecovery() {
    if (!this.recoveryRequired || !this.recoveryFile) return;
    const data = await this.fs.readFile(this.stateFile);
    if (!this.recoveryData || !Buffer.from(data).equals(this.recoveryData)) {
      throw new Error('The account list changed after recovery. Restart GarlicTransfer to reload it before saving.');
    }
  }

  // Function Account Writing
  async write(state) {
    await this.fs.mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
    let handle;
    let owned = false;
    try {
      handle = await this.fs.open(temporary, 'wx', 0o600);
      owned = true;
      await handle.writeFile(JSON.stringify({ version: 1, ...state }) + '\n');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.checkRecovery();
      await this.fs.rename(temporary, this.stateFile);
      owned = false;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (owned) await this.fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  // Function Account Updating
  update(change) {
    return this.serial(async () => {
      const next = { accounts: this.state.accounts.map(account => ({ ...account })),
        selectedId: this.state.selectedId, displayMode: this.state.displayMode, useCurrent: this.state.useCurrent };
      change(next);
      if (JSON.stringify(next) !== JSON.stringify(this.state)) {
        await this.preserve();
        await this.write(next);
        this.state = next;
        this.recoveryRequired = false;
        this.recoveryData = null;
        this.warning = '';
      }
      return this.snapshot();
    });
  }

  // Function Account Adding
  add(value, name = '') {
    return this.update(state => {
      const id = accountId(value);
      const label = accountName(name);
      if (!state.accounts.some(account => account.id === id)) {
        checkName(state.accounts, id, label);
        state.accounts.push({ id, name: label });
      }
    });
  }

  // Function Account Renaming
  rename(value, name) {
    return this.update(state => {
      const id = accountId(value);
      const account = state.accounts.find(account => account.id === id);
      if (!account) throw new Error('The saved account is missing.');
      const label = accountName(name);
      checkName(state.accounts, id, label);
      account.name = label;
    });
  }

  // Function Account Removing
  remove(value) {
    return this.update(state => {
      const id = accountId(value);
      state.accounts = state.accounts.filter(account => account.id !== id);
      if (state.selectedId === id) { state.selectedId = ''; state.useCurrent = true; }
    });
  }

  // Function Account Selection
  select(value) {
    return this.update(state => {
      const id = value === '' ? '' : accountId(value);
      if (id && !state.accounts.some(account => account.id === id)) throw new Error('The saved account is missing.');
      state.selectedId = id;
      if (id) state.useCurrent = false;
    });
  }

  // Function Account Display
  setDisplayMode(mode) {
    return this.update(state => {
      if (mode !== 'name' && mode !== 'id') throw new Error('Choose Display name or Account ID.');
      state.displayMode = mode;
    });
  }

  // Function Current Account
  setUseCurrent(value) {
    return this.update(state => {
      if (typeof value !== 'boolean') throw new Error('Choose whether to use the current Account ID.');
      state.useCurrent = value;
    });
  }
}

module.exports = { AccountStore, MAX_ACCOUNT_NAME };
