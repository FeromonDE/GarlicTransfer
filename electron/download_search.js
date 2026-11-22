(function expose(root, build) {
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DownloadSearch = api;
})(typeof window === 'object' ? window : globalThis, function build() {
  function matches(entry, query, users = []) {
    const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const owner = String(entry.owner || '').toLowerCase();
    const userNames = users.filter(user => String(user.id).toLowerCase() === owner).map(user => user.name);
    const values = [entry.name, entry.title, entry.id, entry.owner, ...userNames];
    for (const file of entry.files || []) values.push(file.file, file.path);
    const haystack = values.filter(value => value !== undefined && value !== null).join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
  }
  return { matches };
});
