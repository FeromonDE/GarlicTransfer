const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createTree, createController, saveKey } = require('../electron/cmp_skin.js');

// Function Test Tree
function setup(t) {
  const dom = new JSDOM('<button id="outside">Outside</button><div id="tree"></div>');
  t.after(() => dom.window.close());
  const container = dom.window.document.getElementById('tree');
  return { dom, container, tree: createTree(container), document: dom.window.document };
}

// Function Test Options
function options(extra = {}) {
  return { entries: [{ id: 1, owner: 'aaaabbbb', title: 'PPSA12345', size: 5, files: [{ file: 'sdimg_DATA', path: '/save/sdimg_DATA', size: 5 }] }], ...extra };
}

test('unchanged tree reuses nodes and calls current actions and file callbacks', (t) => {
  const { tree, container } = setup(t), calls = [];
  tree.render(options({ actions: () => [{ label: 'Old action', run: () => calls.push('old') }], onOpen: () => calls.push('old file') }));
  const content = container.firstElementChild, action = container.querySelector('.cmp-tree-action'), file = container.querySelector('.cmp-file-open');
  tree.render(options({ actions: () => [{ label: 'New action', run: () => calls.push('new') }], onOpen: () => calls.push('new file') }));
  assert.equal(container.firstElementChild, content);
  assert.equal(action.textContent, 'New action');
  action.click(); file.click();
  assert.deepEqual(calls, ['new', 'new file']);
});

test('changed data preserves collapsed groups, scroll and matching focus', (t) => {
  const { tree, container, document } = setup(t);
  tree.render(options());
  const branch = container.querySelector('details'); branch.open = false;
  const focused = branch.querySelector('summary'); focused.focus();
  container.scrollTop = 80; container.scrollLeft = 15;
  const oldContent = container.firstElementChild;
  const changed = options(); changed.entries[0].files[0].size = 10;
  tree.render(changed);
  assert.notEqual(container.firstElementChild, oldContent);
  assert.equal(container.querySelector('details').open, false);
  assert.equal(document.activeElement.dataset.treeFocus, focused.dataset.treeFocus);
  assert.equal(container.scrollTop, 80); assert.equal(container.scrollLeft, 15);
});

test('refresh does not steal outside focus or focus a removed file', (t) => {
  const { tree, container, document } = setup(t);
  tree.render(options({ onOpen() {} }));
  const outside = document.getElementById('outside'); outside.focus();
  const changed = options({ onOpen() {} }); changed.entries[0].files[0].size = 11;
  tree.render(changed); assert.equal(document.activeElement, outside);
  container.querySelector('.cmp-file-open').focus();
  tree.render({ entries: [] });
  assert.equal(document.activeElement, document.body);
});

test('selection labels update without redraw and busy disables all tree actions', (t) => {
  const { tree, container } = setup(t); let selected = false;
  tree.render(options({ selected: () => selected ? ['1'] : [], onToggle: () => { selected = !selected; }, actions: () => [{ label: selected ? 'Unselect save' : 'Select save', run: () => {} }] }));
  const content = container.firstElementChild, action = container.querySelector('.cmp-tree-action');
  container.querySelector('.cmp-check').click();
  assert.equal(container.firstElementChild, content); assert.equal(action.textContent, 'Unselect save');
  tree.setBusy(true);
  assert.ok([...container.querySelectorAll('button,input')].every((element) => element.disabled));
});

test('keyboard file menu opens once despite nested row handlers', (t) => {
  const { tree, container, document, dom } = setup(t);
  tree.render(options({ fileActions: () => [{ label: 'Open', run() {} }] }));
  let opened = 0;
  const append = document.body.appendChild;
  document.body.appendChild = function(element) { if (element.classList.contains('cmp-context')) opened++; return append.call(this, element); };
  container.querySelector('.cmp-file-open').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(opened, 1);
});

// Function Test Controller
function controller(t) {
  const dom = new JSDOM('<select id="cmpUserSelect"></select><div id="cmpRemoteTree"></div><div id="cmpUploadTree"></div><div id="cmpLibraryTree"></div><div id="cmpConnection"></div><button class="nav-item" data-page="console">Console</button>');
  t.after(() => dom.window.close());
  return { document: dom.window.document, layout: createController(dom.window.document, { remoteSelection: () => [], toggleRemote() {}, download() {} }) };
}

test('downloaded files match normalized user, title and entry without cross-entry fallback', (t) => {
  const { document, layout } = controller(t);
  assert.equal(saveKey({ id: '001', owner: 'AAaaBBBB', title: 'ppsa12345' }), saveKey({ id: 1, owner: 'aaaabbbb', title: 'PPSA12345' }));
  layout.setRemote([{ id: 1, owner: 'aaaabbbb', title: 'PPSA12345' }, { id: 2, owner: 'aaaabbbb', title: 'PPSA12345' }], []);
  layout.setFiles([{ id: '001', owner: 'AAAABBBB', title: 'ppsa12345', files: [{ file: 'only-first', size: 5 }] }, { id: 2, owner: 'ccccdddd', title: 'PPSA12345', files: [{ file: 'wrong-user', size: 5 }] }]);
  const remote = document.getElementById('cmpRemoteTree');
  assert.equal(remote.querySelectorAll('.cmp-file').length, 1);
  assert.ok(remote.textContent.includes('only-first'));
  assert.ok(remote.textContent.includes('Save entry 2 · Download to view files'));
  assert.ok(!remote.textContent.includes('wrong-user'));
});

test('local busy state remains active when the global operation ends', (t) => {
  const { document, layout } = controller(t);
  layout.setLibrary({ entries: [{ id: 1, owner: 'aaaabbbb', title: 'PPSA12345' }], users: [{ id: 'aaaabbbb', name: 'A' }], busy: true });
  layout.setPage('library');
  const filter = document.getElementById('cmpUserSelect');
  layout.setBusy(true); layout.setBusy(false); assert.equal(filter.disabled, true);
  layout.setLibraryBusy(false); assert.equal(filter.disabled, false);
  layout.setRemote([{ id: 1, owner: 'aaaabbbb', title: 'PPSA12345' }], [{ id: 'aaaabbbb', name: 'A' }]);
  layout.setLibraryBusy(true); layout.setPage('download'); assert.equal(filter.disabled, false);
  layout.setBusy(true); assert.equal(filter.disabled, true);
});


test('local busy state is remembered before the first library data arrives', (t) => {
  const { document, layout } = controller(t);
  layout.setRemote([{ id: 1, owner: 'aaaabbbb', title: 'PPSA12345' }], [{ id: 'aaaabbbb', name: 'A' }]);
  layout.setPage('library'); layout.setLibraryBusy(true); layout.setBusy(false);
  assert.equal(document.getElementById('cmpUserSelect').disabled, true);
  layout.setLibrary({ entries: [{ id: 1, owner: 'aaaabbbb', title: 'PPSA12345' }], users: [{ id: 'aaaabbbb', name: 'A' }], busy: true });
  assert.equal(document.getElementById('cmpUserSelect').disabled, true);
  layout.setLibraryBusy(false);
  assert.equal(document.getElementById('cmpUserSelect').disabled, false);
});

test('user filters preserve collapsed branches until the profile resets', (t) => {
  const { document, layout } = controller(t);
  const entries = [
    { id: 1, owner: 'aaaabbbb', title: 'PPSA12345' },
    { id: 2, owner: 'ccccdddd', title: 'PPSA54321' },
  ];
  const users = [{ id: 'aaaabbbb', name: 'A' }, { id: 'ccccdddd', name: 'B' }];
  layout.setRemote(entries, users);
  const remote = document.getElementById('cmpRemoteTree');
  remote.querySelector('[data-tree-branch="g:ccccdddd:PPSA54321"]').open = false;
  const filter = document.getElementById('cmpUserSelect');
  filter.value = 'aaaabbbb'; filter.dispatchEvent(new document.defaultView.Event('change'));
  filter.value = ''; filter.dispatchEvent(new document.defaultView.Event('change'));
  assert.equal(remote.querySelector('[data-tree-branch="g:ccccdddd:PPSA54321"]').open, false);
  layout.reset(); layout.setRemote(entries, users);
  assert.equal(remote.querySelector('[data-tree-branch="g:ccccdddd:PPSA54321"]').open, true);
});

test('local profile reset clears only local branch state', (t) => {
  const { document, layout } = controller(t);
  const entries = [{ id: 1, owner: 'aaaabbbb', title: 'PPSA12345' }];
  layout.setRemote(entries, []); layout.setLibrary({ entries, users: [], busy: false });
  const remote = document.getElementById('cmpRemoteTree'), local = document.getElementById('cmpLibraryTree');
  remote.querySelector('details').open = false; local.querySelector('details').open = false;
  layout.resetLibrary(); layout.setLibrary({ entries, users: [], busy: false });
  assert.equal(local.querySelector('details').open, true);
  assert.equal(remote.querySelector('details').open, false);
});

test('Escape returns keyboard menu focus to its trigger without scrolling', (t) => {
  const { tree, container, document, dom } = setup(t);
  tree.render(options({ fileActions: () => [{ label: 'Open', run() {} }] }));
  const file = container.querySelector('.cmp-file-open'); file.focus(); container.scrollTop = 80;
  file.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement.getAttribute('role'), 'menuitem');
  const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(escape);
  assert.equal(document.querySelector('.cmp-context'), null);
  assert.equal(document.activeElement, file);
  assert.equal(container.scrollTop, 80);
  assert.equal(escape.defaultPrevented, true);
});

test('menu actions restore trigger focus before running their action', (t) => {
  const { tree, container, document, dom } = setup(t); let focusedDuringAction;
  tree.render(options({ fileActions: () => [{ label: 'Open', run() { focusedDuringAction = document.activeElement; } }] }));
  const file = container.querySelector('.cmp-file-open');
  file.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
  document.querySelector('.cmp-context button').click();
  assert.equal(focusedDuringAction, file);
  assert.equal(document.querySelector('.cmp-context'), null);
});

test('outside clicks, busy and removed triggers close menus without stealing focus', (t) => {
  const { tree, container, document, dom } = setup(t);
  tree.render(options({ fileActions: () => [{ label: 'Open', run() {} }] }));
  const file = container.querySelector('.cmp-file-open'), outside = document.getElementById('outside');
  const open = () => file.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
  open(); outside.focus(); outside.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(document.activeElement, outside); assert.equal(document.querySelector('.cmp-context'), null);
  open(); tree.setBusy(true);
  assert.notEqual(document.activeElement, file); assert.equal(document.querySelector('.cmp-context'), null);
  tree.setBusy(false); open(); file.remove();
  document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.notEqual(document.activeElement, file); assert.equal(document.querySelector('.cmp-context'), null);
});

test('Escape does not restore focus into a branch closed while its menu was open', (t) => {
  const { tree, container, document, dom } = setup(t);
  tree.render(options({ fileActions: () => [{ label: 'Open', run() {} }] }));
  const file = container.querySelector('.cmp-file-open');
  file.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
  container.querySelector('details').open = false;
  document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.notEqual(document.activeElement, file);
  assert.equal(document.querySelector('.cmp-context'), null);
});
