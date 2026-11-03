'use strict';
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const readline = require('node:readline');
const { BrowserDriver } = require('./browser-driver.cjs');
const { startApplication, stopApplication, requireFixtureIsolation } = require('./application.cjs');

const driver = new BrowserDriver();
const networkMode = process.env.THINGTIME_NETWORK_MODE || 'isolated';
if (!['isolated', 'restricted', 'unrestricted'].includes(networkMode)) throw new Error('Invalid task network mode.');
const probe = (host, port) => new Promise(resolve => {
  const socket = net.connect({ host, port });
  const done = result => { socket.destroy(); resolve(result); };
  socket.setTimeout(1200);
  socket.once('connect', () => done('connected'));
  socket.once('error', error => done(error.code));
  socket.once('timeout', () => done('timeout'));
});

async function preflight() {
  if (networkMode !== 'isolated') {
    // The native manager verifies the restricted kernel rules before exposing
    // this runtime. This flag alone is never evidence of production isolation.
    return { isolated: false, mode: networkMode };
  }
  const interfaces = Object.entries(os.networkInterfaces()).filter(([, addresses]) => addresses.some(address => !address.internal));
  const routes = (await fs.readFile('/proc/net/route', 'utf8')).trim().split('\n');
  const [ipv4, ipv6] = await Promise.all([probe('1.1.1.1', 443), probe('2606:4700:4700::1111', 443)]);
  if (interfaces.length || routes.length !== 1 || !['ENETUNREACH', 'EACCES', 'EPERM'].includes(ipv4) || !['ENETUNREACH', 'EACCES', 'EPERM', 'EAFNOSUPPORT'].includes(ipv6)) {
    throw new Error('The test namespace is not isolated. Browser launch refused.');
  }
  return { isolated: true, interfaces: ['loopback'], ipv4, ipv6, externalRoutes: 0 };
}

async function dispatch(method, params = {}) {
  if (method === 'preflight') return preflight();
  if (method === 'launch') {
    const proof = await preflight();
    requireFixtureIsolation(params.fixtureUsername, params.applicationOrigin, proof);
    if (params.applicationOrigin !== undefined && networkMode !== 'isolated') throw new Error('Desktop acceptance requires isolated networking.');
    const application = await startApplication(process.env.THINGTIME_AGENT_SESSION, params.applicationOrigin, params.fixtureUsername);
    const descriptor = JSON.parse(await fs.readFile('/opt/thingtime-browser/browser.json', 'utf8'));
    const result = await driver.launch({ executable: descriptor.executable, root: '/home/pwuser', build: descriptor });
    if (application) await driver.call('navigate', { pageId: result.tabs[0].id, url: application.origin }, { navigationTimeoutMs: 60000 });
    return { ...result, application, tabs: await driver.call('tabs') };
  }
  if (method === 'close') { await driver.close(); return { closed: true }; }
  if (method === 'probe') return { result: await probe(params.host, params.port) };
  return driver.call(method, params);
}

// The only control transport is stdin/stdout attached by the native owner.
// No network listener, Docker socket, host path, or credential is exposed here.
let queue = Promise.resolve();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  queue = queue.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
      const result = await dispatch(request.method, request.params);
      process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
    } catch (error) {
      // Error messages may include navigation URLs. Strip query/fragment data
      // before returning diagnostics to a task log or viewer.
      const message = String(error.message).replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1');
      process.stdout.write(JSON.stringify({ id: request?.id ?? null, error: message }) + '\n');
    }
  });
});
input.on('close', () => queue.finally(async () => { await driver.close(); await stopApplication(); process.exit(0); }));
