'use strict';
// Real browser/backend in one enforced isolated namespace. Only HTTP bytes cross
// Docker stdio; neither a container port nor an external route is published.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { saveAcceptanceFailure, reportAcceptanceFailure } = require('./acceptance-diagnostics.cjs');
const { DockerEngine, BrowserContainer } = require('../lib/agent-browsers/containers.cjs');
const { BrowserImages } = require('../lib/agent-browsers/images.cjs');
const { AgentBrowserManager } = require('../lib/agent-browsers/manager.cjs');
const { startControlSocket } = require('../lib/agent-browsers/control.cjs');
const { applicationOptions } = require('../lib/agent-browsers/runtime/application.cjs');
const { probeEndpointCapabilities, supportsVersion } = require('../lib/endpoint-compatibility.cjs');

// This code runs in the existing task namespace, never in a second container.
const REMOTE_HTTP = `const http=require('node:http');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{const input=JSON.parse(text);const req=http.request({host:'127.0.0.1',port:input.port,path:input.path,method:input.method,headers:input.headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('base64')})));});req.on('error',()=>process.exit(1));req.end(Buffer.from(input.body,'base64'));});`;

function createRelay({ engine, task, port, active = () => !task.closed }) {
  return http.createServer(async (request, response) => {
    try {
      if (!active() || request.headers.host !== `127.0.0.1:${port}` || !request.url.startsWith('/') || request.url.startsWith('//')) throw new Error('Use the active private app path.');
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const headers = { ...request.headers, 'accept-encoding': 'identity' };
      for (const key of ['connection', 'transfer-encoding', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port']) delete headers[key];
      const result = JSON.parse(await engine.run(['exec', '-i', task.containerId, 'node', '-e', REMOTE_HTTP], {
        input: JSON.stringify({ port, path: request.url, method: request.method, headers, body: Buffer.concat(chunks).toString('base64') }), timeoutMs: 120000
      }));
      delete result.headers['transfer-encoding']; delete result.headers.connection;
      response.writeHead(result.status, result.headers); response.end(Buffer.from(result.body, 'base64'));
    } catch { if (!response.headersSent) response.writeHead(502); response.end('The private test app is unavailable.'); }
  });
}

async function main() {
  const [stateRoot, imageId, rawPort, fixtureUsername] = process.argv.slice(2), port = Number(rawPort);
  if (![5, 6].includes(process.argv.length) || (fixtureUsername !== undefined && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(fixtureUsername)) || !stateRoot || !path.isAbsolute(stateRoot) || !/^sha256:[a-f0-9]{64}$/.test(imageId || '')) throw new Error('Supply a fresh absolute private state directory, immutable full-app image ID and unused loopback port.');
  const origin = `http://127.0.0.1:${port}`;
  applicationOptions(randomUUID(), origin);
  await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(stateRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077 || (await fs.readdir(stateRoot)).length) throw new Error('Use a fresh empty device-user-owned mode-0700 directory.');
  const engine = await new DockerEngine({ executable: process.arch === 'arm64' ? '/opt/homebrew/bin/docker' : '/usr/local/bin/docker', socketPath: path.join(require('node:os').homedir(), '.colima/thingtime-agents/docker.sock'), stateRoot }).initialize();
  const images = new BrowserImages({ engine, stateRoot: path.join(stateRoot, 'images') });
  let task, server, control, closing;
  const manager = new AgentBrowserManager({ engine, images, stateRoot, createSession: options => {
    task = new BrowserContainer(engine, options);
    const call = task.call.bind(task);
    task.call = async (method, params, options) => {
      try { return await call(method, method === 'launch' ? { ...params, applicationOrigin: origin, ...(fixtureUsername ? { fixtureUsername } : {}) } : params, options); }
      catch (error) {
        if (method === 'launch' && task.containerId) {
          // Capture only public readiness fields before the manager tears down
          // the failed namespace. Never return child logs, environment or keys.
          try {
            const script = `fetch(${JSON.stringify(origin + '/api/v1/health/nitro')},{signal:AbortSignal.timeout(5000)}).then(async r=>{const v=await r.json();console.log(JSON.stringify({status:r.status,ok:v.ok,state:v.state,storageState:v.storageAccounting?.state,testMode:v.testEnvironment?.mode,sessionMatches:v.testEnvironment?.sessionId===${JSON.stringify(task.id)}}))}).catch(()=>console.log('Health unavailable'))`;
            const readiness = await engine.run(['exec', task.containerId, 'node', '-e', script], { timeoutMs: 10000 });
            await saveAcceptanceFailure(stateRoot, 'Private backend readiness', new Error(readiness));
          } catch { /* The original launch failure remains authoritative. */ }
        }
        throw error;
      }
    };
    return task;
  } });
  const marker = path.join(stateRoot, 'relay.json'), socketPath = path.join(stateRoot, 'browser.sock'), leaseFile = path.join(stateRoot, 'browser-lease.json');
  const close = () => closing ||= (async () => {
    await fs.rm(marker, { force: true });
    await control?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await manager.close();
    await fs.rm(leaseFile, { force: true });
  })();
  try {
    await manager.initialize();
    process.once('SIGINT', () => close().then(() => process.exit(0), () => process.exit(1)));
    process.once('SIGTERM', () => close().then(() => process.exit(0), () => process.exit(1)));
    const taskId = `desktop-acceptance-${randomUUID()}`, installId = randomUUID();
    await images.save({ id: installId, imageId, taskId, browser: 'chromium', buildId: 'playwright-1.64.0', platform: process.arch, includesApplication: true });
    manager.registerTask({ taskId, useCustomSecurity: true, network: { mode: 'isolated' } });
    const lease = manager.claim({ taskId, installId, agentId: 'desktop-acceptance' });
    const credentials = { leaseId: lease.id, token: lease.token };
    const launch = await manager.launch(credentials);
    if (!task.proof?.isolated || launch.application?.origin !== origin) throw new Error('Desktop acceptance requires the same origin and full isolated app. Rebuild an older image.');
    control = await startControlSocket(manager, socketPath);
    await fs.writeFile(leaseFile, JSON.stringify({ ...lease, socketPath }), { mode: 0o600, flag: 'wx' });
    server = createRelay({ engine, task, port, active: () => {
      try { manager.leases.require(credentials); return manager.sessions.get(lease.id) === task && !task.closed; } catch { return false; }
    } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const compatibility = await probeEndpointCapabilities(origin);
    if (compatibility.status !== 'compatible' || compatibility.manifest.dataEnvironment.kind !== 'custom' || compatibility.manifest.dataEnvironment.authorityOrigin !== origin) throw new Error('The test origin failed native capability negotiation.');
    const response = await fetch(`${origin}/.well-known/thingtime-capabilities.json`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    const value = await response.json();
    if (!response.ok || value.origin !== origin || !supportsVersion(value.features?.['api.devices-sync-control']?.version, '^1.0.0')) throw new Error('The test origin failed sync capability negotiation.');
    const descriptor = { ready: true, origin, sessionId: task.id, containerId: task.containerId, socketPath, leaseFile, taskId, imageId, browserTabs: launch.tabs, isolation: task.proof };
    await fs.writeFile(marker, JSON.stringify(descriptor), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ ready: true, origin, descriptorFile: marker, socketPath, leaseFile }));
  } catch (error) {
    error.diagnosticPath = await saveAcceptanceFailure(stateRoot, 'Isolated desktop acceptance', error);
    try { await close(); } catch (cleanupError) { await saveAcceptanceFailure(stateRoot, 'Acceptance cleanup', cleanupError); }
    throw error;
  }
}
if (require.main === module) main().catch(error => reportAcceptanceFailure(process.argv[2], 'Isolated desktop acceptance', error));
module.exports = { createRelay, main };
