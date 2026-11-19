const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { upload, library } = require('../electron/tree_bridge.js');

test('upload choices synchronize without rebuilding either tree', () => {
  const dom = new JSDOM('<select multiple><option value="11">First</option><option value="12">Second</option></select><input><p></p>');
  try {
    const document = dom.window.document, select = document.querySelector('select');
    const summary = document.querySelector('p'), title = document.querySelector('input');
    let options, uploadRenders = 0, syncs = 0;
    const entries = [{ id: 11, owner: 'a', title: 'PPSA11111' }, { id: 12, owner: 'b', title: 'PPSA22222' }];
    const adapter = upload({ select, title, summary, getEntries: () => entries, layout: {
      setUpload: (value) => { options = value; uploadRenders++; },
      syncSelection: () => syncs++,
      setRemote: () => assert.fail('Upload selection must not rebuild the remote tree'),
    } });
    adapter.render();
    assert.equal(uploadRenders, 1);
    options.onToggle([11], true);
    assert.deepEqual(options.selected(), ['11']);
    assert.equal(summary.textContent, '1 save entries selected across source users.');
    assert.equal(options.actions(entries[0])[0].label, 'Unselect save');
    options.actions(entries[0])[0].run();
    assert.deepEqual(options.selected(), []);
    assert.equal(options.actions(entries[0])[0].label, 'Select save');
    options.onToggle(['11', '12'], true);
    assert.deepEqual(options.selected(), ['11', '12']);
    assert.equal(summary.textContent, '2 save entries selected across source users.');
    assert.equal(uploadRenders, 1);
    assert.equal(syncs, 4);
  } finally { dom.window.close(); }
});

test('upload refresh adds external choices and refreshes its inventory index', () => {
  const dom = new JSDOM('<select multiple><option value="11">First</option></select><input><p></p>');
  try {
    const document = dom.window.document, select = document.querySelector('select'), title = document.querySelector('input');
    let options, entries = [{ id: 11, owner: 'a', title: 'PPSA11111', name: 'Old' }];
    const adapter = upload({ select, title, summary: document.querySelector('p'), getEntries: () => entries,
      layout: { setUpload: (value) => { options = value; }, syncSelection: () => {} } });
    adapter.render();
    assert.equal(options.entries[0].name, 'Old');
    const option = document.createElement('option'); option.value = 'external'; option.textContent = 'External: Folder'; select.appendChild(option);
    title.value = ' ppsa99999 ';
    entries = [{ ...entries[0], name: 'Updated' }];
    adapter.render();
    assert.equal(options.entries[0].name, 'Updated');
    assert.equal(options.entries[1].title, 'PPSA99999');
    assert.equal(options.entries[1].external, 'External: Folder');
    options.actions(options.entries[1])[0].run();
    assert.deepEqual(options.selected(), ['external']);
  } finally { dom.window.close(); }
});

test('local indexing keeps identical IDs, game titles and filenames separated', () => {
  const base = { id: 11, owner: 'a', title: 'PPSA11111' };
  const saves = [
    { entry: base, file: { file: 'DATA', path: '/one/DATA' } },
    { entry: base, file: { file: 'DATA', path: '/two/DATA' } },
    { entry: { ...base, owner: 'b' }, file: { file: 'DATA', path: '/one/DATA' } },
    { entry: { ...base, title: 'PPSA22222' }, file: { file: 'DATA', path: '/one/DATA' } },
  ];
  let options;
  const opened = [], actions = [];
  const adapter = library({ layout: { setLibrary: (value) => { options = value; } }, onOpen: (save) => opened.push(save), onAction: (action) => actions.push(action), isBusy: () => false });
  adapter.render({ saves, users: [], filter: '', busy: false, selected: saves[1] });
  assert.equal(options.entries.length, 3);
  const normalized = { ...base, id: '0011', owner: 'A', title: 'ppsa11111' };
  assert.equal(options.files(normalized).length, 2);
  assert.equal(options.files({ ...base, id: 12 }).length, 0);
  assert.equal(options.selectedFile(normalized, saves[0].file), false);
  assert.equal(options.selectedFile(normalized, saves[1].file), true);
  options.onOpen(normalized, saves[1].file);
  options.onOpen(saves[2].entry, saves[2].file);
  options.fileActions(saves[3].entry, saves[3].file).find((action) => action.label === 'Export original').run();
  assert.deepEqual(opened, [saves[1], saves[2], saves[3]]);
  assert.deepEqual(actions, ['mySaveExportBtn']);
});

test('local callbacks use refreshed records and block actions while busy', () => {
  const entry = { id: 11, owner: 'a', title: 'PPSA11111' };
  const old = { entry, file: { file: 'DATA', path: '/DATA', size: 1 } };
  const updated = { entry: { ...entry }, file: { ...old.file, size: 2 } };
  let options, busy = false;
  const opened = [], actions = [];
  const adapter = library({ layout: { setLibrary: (value) => { options = value; } }, onOpen: (save) => opened.push(save), onAction: (action) => actions.push(action), isBusy: () => busy });
  adapter.render({ saves: [old], users: [], filter: '', busy, selected: null });
  const originalOptions = options;
  const oldAction = options.fileActions(entry, old.file).find((action) => action.label === 'Import replacement');
  adapter.render({ saves: [updated], users: [], filter: '', busy, selected: updated });
  assert.equal(options.files(entry)[0], updated.file);
  originalOptions.onOpen(entry, old.file);
  oldAction.run();
  assert.deepEqual(opened, [updated, updated]);
  assert.deepEqual(actions, ['mySaveImportBtn']);
  busy = true;
  options.onOpen(entry, updated.file); oldAction.run();
  assert.equal(opened.length, 2);
  assert.equal(actions.length, 1);
  assert.ok(options.fileActions(entry, updated.file).every((action) => action.disabled));
  adapter.render({ saves: [], users: [], filter: '', busy: false, selected: null });
  busy = false; oldAction.run();
  assert.equal(options.entries.length, 0);
  assert.equal(opened.length, 2);
});
