(function expose(root, build) {
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConsoleLocator = api;
})(typeof window === 'object' ? window : globalThis, function build() {
  // Function Firmware Parsing
  function normalizeFirmware(value) {
    let major, minor;
    if (Array.isArray(value) && value.length === 2) [major, minor] = value;
    else {
      const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? String(value).padStart(8, '0') : typeof value === 'string' ? value.trim() : '';
      const dotted = /^(\d+)\.(\d{2})$/.exec(text);
      if (dotted) { major = Number(dotted[1]); minor = Number(dotted[2]); }
      else if (/^\d{8}$/.test(text)) { major = Number(text.slice(0, 2)); minor = Number(text.slice(2, 4)); }
      else return null;
    }
    return Number.isSafeInteger(major) && major > 0 && Number.isInteger(minor) && minor >= 0 && minor <= 99
      ? [major, minor] : null;
  }

  // Function Firmware Label
  function formatFirmware(value) {
    const version = normalizeFirmware(value);
    return version ? `${version[0]}.${String(version[1]).padStart(2, '0')}` : 'Unknown';
  }

  // Function Firmware Limit
  function firmwareEligible(value, limit = '13.60') {
    const version = normalizeFirmware(value), maximum = normalizeFirmware(limit);
    return Boolean(version && maximum && (version[0] < maximum[0] || (version[0] === maximum[0] && version[1] <= maximum[1])));
  }

  // Function IPv4 Parsing
  function canonicalIPv4(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return '';
    const parts = text.split('.').map(Number);
    return parts.every(part => part <= 255) ? parts.join('.') : '';
  }

  // Function Console Locator
  function create(document, tbody, { onSelect = () => {}, isBusy = () => false } = {}) {
    const rows = new Map();
    let consoles = new Map(), busy = false, firmwareLimit = '13.60';
    let selected = { jb: '', ofw: '' };
    const blocked = () => busy || isBusy();
    const ps5 = console => String(console.type || '').trim().toUpperCase() === 'PS5';
    const allowed = (role, console) => ps5(console) && (role === 'ofw' || firmwareEligible(console.firmware, firmwareLimit));
    const ipNumber = host => host.split('.').reduce((number, octet) => number * 256 + Number(octet), 0);
    const pairingLabels = new Map([['checking', 'Checking…'], ['paired', 'Paired'], ['previous', 'Pair again'], ['unpaired', 'Not paired'], ['unknown', 'Unknown']]);

    // Function Console Selection
    function update() {
      for (const [host, item] of rows) {
        const console = consoles.get(host);
        for (const role of ['jb', 'ofw']) {
          const input = item[role];
          const eligible = allowed(role, console);
          input.disabled = blocked() || !eligible;
          input.checked = selected[role] === host && eligible;
          const label = role === 'jb' ? 'JB helper' : 'OFW target';
          input.setAttribute('aria-label', `Use ${console.name} (${host}) as ${label}`);
          input.title = !ps5(console) ? `Select a discovered PS5; this device is ${console.type || 'unknown'}.`
            : role === 'jb' && !normalizeFirmware(console.firmware) ? 'JB selection requires known PS5 firmware.'
            : role === 'jb' && !eligible ? `JB selection requires firmware ${formatFirmware(firmwareLimit)} or below.`
            : `Use this PS5 as the ${label}.`;
          item.row.classList.toggle(`${role}-selected`, input.checked);
        }
      }
    }

    // Function Console Row
    function makeRow(host) {
      const row = document.createElement('tr'); row.dataset.host = host; row.className = 'console-locator-row';
      const name = document.createElement('td'), address = document.createElement('td'), firmware = document.createElement('td'), pairing = document.createElement('td');
      address.textContent = host; address.className = 'console-locator-address';
      const type = document.createElement('td'), id = document.createElement('td');
      type.className = 'console-locator-type'; id.className = 'console-locator-id';
      row.append(name, type, address, firmware, id, pairing);
      const item = { row, name, type, firmware, id, pairing };
      for (const role of ['jb', 'ofw']) {
        const cell = document.createElement('td'), input = document.createElement('input');
        input.type = 'radio'; input.name = `console-locator-${role}`; input.value = host;
        input.dataset.role = role; input.dataset.host = host;
        cell.className = 'console-locator-pick'; cell.appendChild(input); row.appendChild(cell); item[role] = input;
      }
      return item;
    }

    // Function Console Rendering
    function render(values = [], options = {}) {
      if (Object.hasOwn(options, 'jbHost')) selected.jb = canonicalIPv4(options.jbHost);
      if (Object.hasOwn(options, 'targetHost')) selected.ofw = canonicalIPv4(options.targetHost);
      if (Object.hasOwn(options, 'firmwareLimit')) firmwareLimit = options.firmwareLimit;
      const found = new Map();
      for (const value of Array.isArray(values) ? values : []) {
        const host = canonicalIPv4(value?.host);
        if (!host || found.has(host)) continue;
        const type = typeof value.type === 'string' ? value.type.trim() : '';
        const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : type || 'PlayStation';
        found.set(host, { ...value, host, name, type });
      }
      const ordered = [...found.values()].sort((a, b) => ipNumber(a.host) - ipNumber(b.host)
        || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      consoles = found;
      const active = tbody.contains(document.activeElement) ? document.activeElement : null;
      for (const [host, item] of rows) if (!found.has(host)) { item.row.remove(); rows.delete(host); }
      tbody.querySelector('.console-locator-empty')?.remove();
      for (const [index, console] of ordered.entries()) {
        let item = rows.get(console.host);
        if (!item) { item = makeRow(console.host); rows.set(console.host, item); }
        item.name.textContent = console.name; item.name.title = console.type || 'Unknown console type';
        item.type.textContent = console.type || 'Unknown';
        const hostId = typeof console.hostId === 'string' ? console.hostId.trim() : '';
        item.id.textContent = hostId || 'Unknown'; item.id.title = hostId || 'Unknown';
        item.firmware.textContent = formatFirmware(console.firmware);
        item.firmware.title = typeof console.firmware === 'string' || typeof console.firmware === 'number' ? String(console.firmware) : '';
        const pairingStatus = pairingLabels.has(console.pairing) ? console.pairing : 'unknown';
        item.pairing.className = `console-locator-pairing ${pairingStatus}`;
        item.pairing.dataset.pairing = pairingStatus;
        item.pairing.textContent = pairingLabels.get(pairingStatus);
        if (tbody.children[index] !== item.row) tbody.insertBefore(item.row, tbody.children[index] || null);
      }
      if (!ordered.length) {
        const row = document.createElement('tr'), cell = document.createElement('td');
        row.className = 'console-locator-empty'; cell.colSpan = 8; cell.className = 'empty';
        cell.textContent = 'No PlayStations found. Find PlayStations or connect by IPv4.';
        row.appendChild(cell); tbody.appendChild(row);
      }
      update();
      if (active?.isConnected && !active.disabled && document.activeElement !== active) active.focus({ preventScroll: true });
    }

    // Function Console Choice
    tbody.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"][data-role]');
      if (!input || !tbody.contains(input) || !input.checked) return;
      const role = input.dataset.role, host = canonicalIPv4(input.dataset.host), console = consoles.get(host);
      if (!['jb', 'ofw'].includes(role) || !console || blocked() || !allowed(role, console)) { update(); return; }
      selected = { ...selected, [role]: host }; update(); onSelect(role, console);
    });
    return {
      render,
      setBusy(value) { busy = Boolean(value); update(); },
      reset() { render([], { jbHost: '', targetHost: '' }); },
    };
  }
  return { normalizeFirmware, formatFirmware, firmwareEligible, canonicalIPv4, create };
});
