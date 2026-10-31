'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const FEATURES = Object.freeze({ 'agent.browsers': '1.0.0', 'agent.network-policy': '1.0.0' });
const PUBLIC_METHODS = Object.freeze(['manifest', 'status', 'claim', 'renew', 'launch', 'browser', 'release']);

async function dispatch(manager, request, { desktop = false } = {}) {
  const { method, params = {} } = request || {};
  // Local agents may use tasks approved in the app. Only the trusted desktop
  // control surface changes task/default security or installs executable code.
  if (!desktop && !PUBLIC_METHODS.includes(method)) throw new Error('Use Thingtime’s desktop controls for this operation.');
  switch (method) {
    case 'manifest': return { protocol: 'thingtime-agent-browser/1', features: FEATURES, methods: PUBLIC_METHODS };
    case 'status': return manager.snapshot();
    case 'defaults.set': return manager.setDefaults(params.network);
    case 'task.register': return manager.registerTask(params);
    case 'task.validate': return require('./network-policy.cjs').resolveTaskNetworkPolicy(manager.defaults, params);
    case 'catalog': return manager.bundles.catalog();
    case 'install': return manager.images.install(params);
    case 'install.cancel': return manager.images.cancel(params.id, params.taskId);
    case 'native.install': return manager.bundles.install(params);
    case 'native.cancel': return manager.bundles.cancel(params.id, params.taskId);
    case 'duplicate': return (manager.images.records.has(params.id) ? manager.images : manager.bundles).duplicate(params.id, params.taskId);
    case 'remove': return manager.removeInstall(params.id);
    case 'release.expired': return manager.releaseExpired(params);
    case 'claim': return manager.claim(params);
    case 'renew': return manager.leases.renew(params);
    case 'launch': return manager.launch(params);
    case 'browser': return manager.command(params, params.operation, params.args);
    case 'observe': {
      if (!['tabs', 'frame'].includes(params.operation)) throw new Error('The live viewer may only inspect pages.');
      const lease = manager.leases.list().find(value => value.id === params.leaseId && value.taskId === params.taskId && !value.expired);
      const session = lease && manager.sessions.get(lease.id);
      if (!session) throw new Error('This task has no active browser session.');
      return session.call(params.operation, params.args);
    }
    case 'release': return manager.release(params);
    default: throw new Error('Unsupported agent browser request.');
  }
}

async function startControlSocket(manager, socketPath) {
  const directory = path.dirname(socketPath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('Use a private, device-user-owned directory for the agent control socket.');
  const clients = new Set();
  const server = net.createServer(socket => {
    clients.add(socket); socket.once('close', () => clients.delete(socket));
    let queue = Promise.resolve();
    const lines = readline.createInterface({ input: socket, crlfDelay: Infinity });
    lines.on('line', line => {
      socket.pause();
      queue = queue.then(async () => {
        let request;
        try {
          request = JSON.parse(line);
          const result = await dispatch(manager, request);
          if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, result }) + '\n');
        } catch (error) {
          if (!socket.destroyed) socket.write(JSON.stringify({ id: request?.id ?? null, error: error.message }) + '\n');
        } finally { if (!socket.destroyed) socket.resume(); }
      });
    });
    socket.on('error', () => socket.destroy());
  });
  // The manager holds this state directory's exclusive process lock. A socket
  // left by a crashed owner can be removed only after a refused connection.
  try {
    const existing = await fs.lstat(socketPath);
    if (!existing.isSocket() || existing.uid !== process.getuid()) throw new Error('The agent socket path is not a device-owned socket.');
    const stale = await new Promise((resolve, reject) => {
      const probe = net.connect(socketPath);
      probe.once('connect', () => { probe.destroy(); resolve(false); });
      probe.once('error', error => error.code === 'ECONNREFUSED' ? resolve(true) : reject(error));
      probe.setTimeout(1500, () => { probe.destroy(); resolve(false); });
    });
    if (!stale) throw new Error('Another controller owns the agent socket.');
    await fs.unlink(socketPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await fs.chmod(socketPath, 0o600);
  return { close: () => new Promise(resolve => { for (const socket of clients) socket.destroy(); server.close(resolve); }) };
}
module.exports = { dispatch, startControlSocket, FEATURES };
