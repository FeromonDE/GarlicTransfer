const test = require('node:test');
const assert = require('node:assert/strict');
const { matches } = require('../electron/download_search.js');

const entry = {
  id: 131,
  title: 'PPSA21564',
  name: 'ASTRO BOT',
  owner: '18c60ea2',
  files: [{ file: 'sdimg_sce_sdmemory', path: '/save/sdimg_sce_sdmemory' }],
};
const users = [{ id: '18c60ea2', name: 'Research User' }];

test('search is case-insensitive across title, ID, filename and entry ID', () => {
  assert.equal(matches(entry, 'astro', users), true);
  assert.equal(matches(entry, 'ppsa21564', users), true);
  assert.equal(matches(entry, 'SDIMG_SCE_SDMEMORY', users), true);
  assert.equal(matches(entry, '131', users), true);
  assert.equal(matches(entry, 'missing', users), false);
});

test('search matches users and multiple terms while preserving empty queries', () => {
  assert.equal(matches(entry, 'research 131', users), true);
  assert.equal(matches(entry, 'research missing', users), false);
  assert.equal(matches(entry, '', users), true);
  assert.equal(matches(entry, '   ', users), true);
});
