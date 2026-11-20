const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { getEventListeners } = require('node:events');
const { runSaveJob } = require('../electron/save_editor.cjs');

// Function Test Signal
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Function Deadline Fixture
async function fixture(t, phase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-save-timeout-'));
  const source = path.join(root, 'sdimg_DATA');
  const output = path.join(root, 'existing-export.zip');
  await fs.writeFile(source, 'original save');
  await fs.writeFile(output, 'previous export');
  const started = gate(), disconnected = gate();
  const requests = [], events = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    request.on('error', () => {});
    request.resume();
    request.on('end', () => {
      const current = request.method === 'POST' ? 'upload' : request.url.endsWith('/result') ? 'result' : 'status';
      if (phase === current || phase === `${current}-body`) {
        if (phase.endsWith('-body')) {
          response.writeHead(200, { 'Content-Length': '100000' });
          response.write(current === 'status' ? '{"status":' : 'partial result bytes');
        }
        response.once('close', () => disconnected.resolve());
        started.resolve();
        return;
      }
      if (current === 'upload') response.end(JSON.stringify({ job_id: 'timeout-job' }));
      else if (current === 'result') response.end('completed export');
      else {
        response.end(JSON.stringify({ status: phase === 'poll-wait' ? 'queued' : 'done', logs: [] }));
        if (phase === 'poll-wait') started.resolve();
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const options = {
    operation: 'resign', inputs: [source], output, accountId: '0123456789abcdef',
    serverUrl: `http://127.0.0.1:${server.address().port}`, workerKey: 'deadline-key',
    userDataRoot: path.join(root, 'settings'), timeoutMs: 500, pollIntervalMs: 10000,
    sender: { isDestroyed: () => false, send: (_channel, event) => events.push(event) },
  };
  return { root, source, output, options, requests, events, started, disconnected,
    async unchanged() {
      assert.equal(await fs.readFile(source, 'utf8'), 'original save');
      assert.equal(await fs.readFile(output, 'utf8'), 'previous export');
      assert.deepEqual((await fs.readdir(root)).filter(name => name.includes('.download-')), []);
      assert.deepEqual(await fs.readdir(path.join(options.userDataRoot, 'save-editor')), []);
    },
  };
}

for (const phase of ['upload', 'status', 'status-body', 'result', 'result-body', 'poll-wait']) {
  test(`remote deadline stops a stalled ${phase} phase and preserves the existing export`, { timeout: 5000 }, async t => {
    const f = await fixture(t, phase);
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = runSaveJob({ ...f.options, signal: controller.signal });
    const rejected = assert.rejects(running, error => {
      assert.equal(error.name, 'TimeoutError');
      assert.equal(error.code, 'ETIMEDOUT');
      assert.match(error.message, /resign timed out/i);
      return true;
    });
    await f.started.promise;
    await rejected;
    assert.ok(Date.now() - startedAt < 3000);
    if (phase !== 'poll-wait') await f.disconnected.promise;
    assert.equal(controller.signal.aborted, false);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.ok(f.events.some(event => event.type === 'error' && /timed out/.test(event.message)));
    if (phase === 'poll-wait') assert.equal(f.requests.filter(url => url === '/api/v1/jobs/timeout-job').length, 1);
    await f.unchanged();
  });
}

test('user cancellation before a remote deadline keeps the cancellation error and releases listeners', { timeout: 5000 }, async t => {
  const f = await fixture(t, 'status-body');
  const controller = new AbortController();
  const running = runSaveJob({ ...f.options, timeoutMs: 1000, signal: controller.signal });
  const rejected = assert.rejects(running, error => error.name === 'AbortError' && error.code === 'ABORT_ERR' && /canceled/i.test(error.message));
  await f.started.promise;
  controller.abort();
  await rejected;
  await f.disconnected.promise;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await f.unchanged();
});

test('cancel after the atomic result commit preserves successful completion', { timeout: 5000 }, async t => {
  const f = await fixture(t, 'complete');
  const controller = new AbortController();
  const rename = fs.rename;
  fs.rename = async (...args) => {
    const result = await rename(...args);
    if (args[1] === f.output) controller.abort();
    return result;
  };
  t.after(() => { fs.rename = rename; });
  const result = await runSaveJob({ ...f.options, timeoutMs: 1000, signal: controller.signal });
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.output, f.output);
  assert.equal(await fs.readFile(f.output, 'utf8'), 'completed export');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(f.events.some(event => event.type === 'error'), false);
});

test('successful remote jobs remove their deadline and cancellation listener', { timeout: 5000 }, async t => {
  const f = await fixture(t, 'complete');
  const controller = new AbortController();
  const result = await runSaveJob({ ...f.options, timeoutMs: 1000, signal: controller.signal });
  assert.equal(result.output, f.output);
  assert.equal(await fs.readFile(f.output, 'utf8'), 'completed export');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  assert.equal(f.events.some(event => event.type === 'error'), false);
});
