const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalHelper } = require('../electron/local_helper.cjs');
const { runLocalWorkerJob } = require('../electron/local_worker.cjs');
const { EventEmitter } = require('node:events');

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server.address().port;
}
async function close(server) {
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

function greeting(socket) {
  const body = Buffer.from(JSON.stringify({ type: 'hello', protocol: 'garlic-local-v1', platform: 'ps5' }));
  const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
  socket.end(Buffer.concat([header, body]));
}

test('running local helper is reused without deploying or changing console configuration', async t => {
  const service = net.createServer(greeting);
  const port = await listen(service);
  t.after(() => close(service));
  const helper = new LocalHelper({ elfPath: '/does-not-exist', port });
  t.after(() => helper.stop());
  await helper.ensure('127.0.0.1');
  await assert.rejects(helper.ensure('http://server'), /PS5 IPv4/);
});

test('closed helper port deploys the ELF once and waits for the local service', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-helper-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const elf = Buffer.from('test local ELF payload');
  const elfPath = path.join(dir, 'helper.elf');
  await fs.writeFile(elfPath, elf);
  const service = net.createServer(socket => setTimeout(() => greeting(socket), 25));
  const probe = net.createServer();
  const port = await listen(probe);
  await close(probe);
  let deployments = 0;
  const loader = net.createServer(socket => {
    deployments++;
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', async () => {
      assert.deepEqual(Buffer.concat(chunks), elf);
      await listen(service, port);
    });
  });
  const loaderPort = await listen(loader);
  const helper = new LocalHelper({ elfPath, port, loaderPort, readyTimeoutMs: 2000 });
  t.after(async () => { helper.stop(); await close(service); await close(loader); });
  await Promise.all([helper.ensure('127.0.0.1'), helper.ensure('127.0.0.1')]);
  assert.equal(deployments, 1);
});

async function vacantPort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, size = 245888) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'garlic-helper-'));
  const elfPath = path.join(dir, 'helper.elf');
  await fs.writeFile(elfPath, Buffer.alloc(Math.min(size, 245888), 0xa5));
  await fs.truncate(elfPath, size);
  const sockets = new Set();
  const servers = [];
  let helper;
  const logs = [];
  function server(handler) {
    const value = net.createServer(socket => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.once('close', () => sockets.delete(socket));
      handler(socket);
    });
    servers.push(value);
    return value;
  }
  t.after(async () => {
    helper?.stop();
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(close));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, elfPath, size, server, logs, make(options) {
    helper = new LocalHelper({ elfPath, onLog: message => logs.push(message),
      connectTimeoutMs: 200, uploadTimeoutMs: 500, readyTimeoutMs: 300,
      probeTimeoutMs: 20, retryIntervalMs: 5, ...options });
    return helper;
  } };
}

test('the actual ELF-sized upload completes before delayed helper readiness', async t => {
  const f = await fixture(t);
  await fs.copyFile(path.join(__dirname, '..', 'poc', 'local_worker', 'garlic-local-worker.elf'), f.elfPath);
  const service = f.server(greeting);
  const port = await vacantPort();
  const received = [];
  const loader = f.server(socket => {
    socket.on('data', chunk => received.push(chunk));
    socket.once('end', () => {
      const timer = setTimeout(() => listen(service, port).catch(error => service.emit('error', error)), 25);
      t.after(() => clearTimeout(timer));
    });
  });
  const helper = f.make({ port, loaderPort: await listen(loader) });
  await helper.ensure('127.0.0.1');
  assert.deepEqual(Buffer.concat(received), await fs.readFile(f.elfPath));
  const phases = ['Connecting to PS5', 'Connected; sending', 'Helper sent', 'Save helper ready'];
  const indices = phases.map(phase => f.logs.findIndex(message => message.includes(phase)));
  assert.ok(indices.every(index => index >= 0));
  assert.deepEqual([...indices].sort((a, b) => a - b), indices);
});

test('compatible readiness wins while ELF writes are stalled and concurrent ensures deploy once', async t => {
  const f = await fixture(t, 16 * 1024 * 1024);
  const port = await vacantPort();
  const service = f.server(greeting);
  let deployments = 0;
  let bytes = 0;
  const loader = f.server(socket => {
    deployments++;
    socket.once('data', chunk => {
      bytes += chunk.length;
      socket.pause();
      listen(service, port).catch(error => service.emit('error', error));
    });
  });
  const helper = f.make({ port, loaderPort: await listen(loader), uploadTimeoutMs: 1000 });
  await Promise.all([helper.ensure('127.0.0.1'), helper.ensure('127.0.0.1')]);
  await helper.ensure('127.0.0.1');
  assert.equal(deployments, 1);
  assert.ok(bytes > 0 && bytes < f.size);
  assert.equal(f.logs.some(message => message.includes('Helper sent')), false);
  assert.ok(f.logs.some(message => message.includes('Save helper ready')));
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.reads.size, 0);
});

test('a different service on the helper port cannot count as successful startup', async t => {
  const f = await fixture(t);
  const service = f.server(socket => socket.end(Buffer.from([0, 0, 0, 2, 123, 125])));
  let deployments = 0;
  const loader = f.server(socket => { deployments++; socket.resume(); });
  const helper = f.make({ port: await listen(service), loaderPort: await listen(loader), readyTimeoutMs: 40 });
  await assert.rejects(helper.ensure('127.0.0.1'), /no compatible save helper answered/);
  assert.equal(deployments, 0);
  assert.equal(f.logs.some(message => message.includes('Helper sent')), false);
  assert.equal(f.logs.some(message => message.includes('Save helper ready')), false);
});

test('canceling a job and retrying waits for the busy helper without deploying again', async t => {
  const f = await fixture(t);
  const jobStarted = deferred();
  const waiting = deferred();
  const blocked = new Set();
  let busy = false;
  let first = true;
  const service = f.server(socket => {
    if (busy) {
      blocked.add(socket);
      socket.once('close', () => blocked.delete(socket));
      return;
    }
    if (!first) return greeting(socket);
    first = false;
    const hello = Buffer.from(JSON.stringify({ type: 'hello', protocol: 'garlic-local-v1', platform: 'ps5' }));
    const header = Buffer.alloc(4); header.writeUInt32BE(hello.length);
    socket.write(Buffer.concat([header, hello]));
    socket.once('data', () => { busy = true; jobStarted.resolve(); });
  });
  const port = await listen(service);
  const controller = new AbortController();
  const task = runLocalWorkerJob({ host: '127.0.0.1', port, operation: 'decrypt',
    inputArchive: f.elfPath, resultPath: path.join(f.dir, 'result.zip'), signal: controller.signal });
  await jobStarted.promise;
  controller.abort();
  await assert.rejects(task, { name: 'AbortError' });
  let deployments = 0;
  const loader = f.server(socket => { deployments++; socket.resume(); });
  const helper = f.make({ elfPath: '/does-not-exist', port, loaderPort: await listen(loader),
    onLog: message => { f.logs.push(message); if (message.includes('Waiting for')) waiting.resolve(); } });
  const retry = helper.ensure('127.0.0.1');
  await waiting.promise;
  busy = false;
  for (const socket of blocked) if (!socket.destroyed) greeting(socket);
  await retry;
  assert.equal(deployments, 0);
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.hostTasks.size, 0);
  assert.equal(helper.controllers.size, 0);
  assert.equal(f.logs.some(message => message.includes('Save helper ready')), true);
});

test('a silent occupied helper port fails within the readiness budget without deployment', async t => {
  const f = await fixture(t);
  const service = f.server(socket => socket.resume());
  let deployments = 0;
  const loader = f.server(socket => { deployments++; socket.resume(); });
  const helper = f.make({ elfPath: '/does-not-exist', port: await listen(service),
    loaderPort: await listen(loader), readyTimeoutMs: 40 });
  const started = Date.now();
  await assert.rejects(helper.ensure('127.0.0.1'), /port .* is open, but no compatible save helper answered/);
  assert.ok(Date.now() - started < 1500);
  assert.equal(deployments, 0);
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.hostTasks.size, 0);
  assert.equal(helper.controllers.size, 0);
});

test('stop cancels an occupied-port wait without deployment', async t => {
  const f = await fixture(t);
  const waiting = deferred();
  const service = f.server(socket => socket.resume());
  let deployments = 0;
  const loader = f.server(socket => { deployments++; socket.resume(); });
  const helper = f.make({ elfPath: '/does-not-exist', port: await listen(service),
    loaderPort: await listen(loader), onLog: message => { if (message.includes('Waiting for')) waiting.resolve(); } });
  const task = helper.ensure('127.0.0.1');
  await waiting.promise;
  helper.stop();
  await assert.rejects(task, /stopped/);
  assert.equal(deployments, 0);
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.hostTasks.size, 0);
  assert.equal(helper.controllers.size, 0);
});

test('refused loader connection identifies the listener and never logs Sending', async t => {
  const f = await fixture(t);
  const loaderPort = await vacantPort();
  const helper = f.make({ port: await vacantPort(), loaderPort });
  await assert.rejects(helper.ensure('127.0.0.1'), error => {
    assert.match(error.message, /Could not connect to the PS5 payload listener/);
    assert.ok(error.message.includes(`127.0.0.1:${loaderPort}`));
    return true;
  });
  assert.equal(f.logs.some(message => message.includes('Connected; sending')), false);
});

class ConnectingSocket extends EventEmitter {
  destroy() {
    if (!this.destroyed) {
      this.destroyed = true;
      setImmediate(() => this.emit('close'));
    }
    return this;
  }
}

async function stalledConnection(t, stop) {
  const f = await fixture(t);
  const loaderPort = await vacantPort();
  const original = net.createConnection;
  const created = deferred();
  net.createConnection = options => {
    if (options.port !== loaderPort) return original(options);
    const socket = new ConnectingSocket();
    created.resolve(socket);
    return socket;
  };
  try {
    const helper = f.make({ port: await vacantPort(), loaderPort, connectTimeoutMs: 40 });
    const task = helper.ensure('127.0.0.1');
    const socket = await created.promise;
    if (stop) helper.stop();
    await assert.rejects(task, stop ? /stopped/ : /Could not connect.*within 40 ms/);
    assert.equal(socket.destroyed, true);
    assert.equal(f.logs.some(message => message.includes('Connected; sending')), false);
  } finally { net.createConnection = original; }
}

test('a stalled TCP connection uses the connection budget', t => stalledConnection(t, false));
test('stop cancels a pending connection and its timers', t => stalledConnection(t, true));

test('a stalled ELF transfer uses an upload error with progress', async t => {
  const f = await fixture(t, 16 * 1024 * 1024);
  const loader = f.server(socket => socket.pause());
  const helper = f.make({ port: await vacantPort(), loaderPort: await listen(loader), uploadTimeoutMs: 40 });
  await assert.rejects(helper.ensure('127.0.0.1'), /Timed out uploading.*bytes written/);
  assert.ok(f.logs.some(message => message.includes('Connected; sending')));
  assert.equal(helper.reads.size, 0);
});

test('stop cancels a backpressured upload and closes its input file', async t => {
  const f = await fixture(t, 16 * 1024 * 1024);
  const received = deferred();
  const loader = f.server(socket => socket.once('data', () => { socket.pause(); received.resolve(); }));
  const helper = f.make({ port: await vacantPort(), loaderPort: await listen(loader), uploadTimeoutMs: 1000 });
  const task = helper.ensure('127.0.0.1');
  await received.promise;
  helper.stop();
  await assert.rejects(task, /stopped/);
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.reads.size, 0);
  await fs.rm(f.elfPath);
});

test('a loader disconnect during a backpressured upload preserves the upload stage', async t => {
  const f = await fixture(t, 16 * 1024 * 1024);
  const loader = f.server(socket => socket.once('data', () => socket.destroy()));
  const helper = f.make({ port: await vacantPort(), loaderPort: await listen(loader) });
  await assert.rejects(helper.ensure('127.0.0.1'), /during upload|Could not send.*bytes written/);
  assert.equal(helper.reads.size, 0);
});

test('missing local payload fails clearly and stopped helpers reject new work', async () => {
  const helper = new LocalHelper({ elfPath: '/does-not-exist' });
  await assert.rejects(helper.ensure('127.0.0.1'), /local save helper payload is missing/);
  helper.stop();
  await assert.rejects(helper.ensure('127.0.0.1'), /stopped/);
});

test('an existing PPR listener is reused without requiring the save helper or ELF', async t => {
  const service = net.createServer(socket => socket.end());
  const pprPort = await listen(service);
  t.after(() => close(service));
  const helper = new LocalHelper({ elfPath: '/does-not-exist' });
  t.after(() => helper.stop());
  await helper.ensureTransfer('127.0.0.1', pprPort);
  await assert.rejects(helper.ensureTransfer('127.0.0.1', 0), /valid local helper port/);
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.hostTasks.size, 0);
});

test('PPR and save startup requests share one deployment while the save greeting is delayed', async t => {
  const f = await fixture(t);
  const port = await vacantPort();
  const pprPort = await vacantPort();
  let saveReady = false;
  let timer;
  let deployments = 0;
  const service = f.server(socket => { if (saveReady) greeting(socket); else socket.resume(); });
  const ppr = f.server(socket => socket.end());
  const loader = f.server(socket => {
    deployments++;
    socket.resume();
    socket.once('end', () => {
      Promise.all([listen(service, port), listen(ppr, pprPort)])
        .then(() => { timer = setTimeout(() => { saveReady = true; }, 100); })
        .catch(error => loader.emit('error', error));
    });
  });
  t.after(() => clearTimeout(timer));
  const helper = f.make({ port, loaderPort: await listen(loader), readyTimeoutMs: 500 });
  await Promise.all([helper.ensureTransfer('127.0.0.1', pprPort), helper.ensure('127.0.0.1')]);
  assert.equal(deployments, 1);
  assert.equal(saveReady, true);
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.hostTasks.size, 0);
  assert.ok(f.logs.some(message => message.includes(`Transfer helper ready at 127.0.0.1:${pprPort}`)));
  assert.ok(f.logs.some(message => message.includes(`Save helper ready at 127.0.0.1:${port}`)));
});

test('a transfer uses the shared readiness-wins uploader when the loader stops reading', async t => {
  const f = await fixture(t, 16 * 1024 * 1024);
  const pprPort = await vacantPort();
  const ppr = f.server(socket => socket.end());
  let deployments = 0;
  let bytes = 0;
  const loader = f.server(socket => {
    deployments++;
    socket.once('data', chunk => {
      bytes += chunk.length;
      socket.pause();
      listen(ppr, pprPort).catch(error => ppr.emit('error', error));
    });
  });
  const helper = f.make({ loaderPort: await listen(loader), uploadTimeoutMs: 1000 });
  await helper.ensureTransfer('127.0.0.1', pprPort);
  assert.equal(deployments, 1);
  assert.ok(bytes > 0 && bytes < f.size);
  assert.equal(f.logs.some(message => message.includes('Helper sent')), false);
  assert.equal(helper.reads.size, 0);
});

test('stop cancels both the active and queued service startup', async t => {
  const f = await fixture(t, 16 * 1024 * 1024);
  const accepted = deferred();
  const loader = f.server(socket => { socket.pause(); accepted.resolve(); });
  const helper = f.make({ port: await vacantPort(), loaderPort: await listen(loader), uploadTimeoutMs: 1000 });
  const pprPort = await vacantPort();
  const outcomes = Promise.allSettled([helper.ensure('127.0.0.1'), helper.ensureTransfer('127.0.0.1', pprPort)]);
  await accepted.promise;
  helper.stop();
  for (const result of await outcomes) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /stopped/);
  }
  assert.equal(helper.pending.size, 0);
  assert.equal(helper.hostTasks.size, 0);
  assert.equal(helper.reads.size, 0);
});
