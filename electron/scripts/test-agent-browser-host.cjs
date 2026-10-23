'use strict';
// Opt-in integration fixture. Uses the real manager, socket and containers;
// all mutable HTTP data is in each task namespace, with no host port/mount.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DockerEngine, BrowserContainer } = require('../lib/agent-browsers/containers.cjs');
const { BrowserImages } = require('../lib/agent-browsers/images.cjs');
const { AgentBrowserManager } = require('../lib/agent-browsers/manager.cjs');
const { startControlSocket } = require('../lib/agent-browsers/control.cjs');

async function main() {
  const stateRoot = process.argv[2], socketPath = process.argv[3], dockerSocket = process.argv[4];
  const applicationImage = process.argv[5];
  // Full-app acceptance may run a second fresh Chromium beside the manager's
  // viewer. Its test-only budget stays explicit and bounded; default unchanged.
  const memoryMb = process.argv[6] === undefined ? 2048 : Number(process.argv[6]);
  if (!Number.isSafeInteger(memoryMb) || memoryMb < 512 || memoryMb > 4096) throw new Error('Test runtime memory must be between 512 and 4096 MiB.');
  if (![stateRoot, socketPath, dockerSocket].every(value => value && path.isAbsolute(value))) throw new Error('Supply absolute fixture state, control socket and Docker socket paths.');
  const engine = await new DockerEngine({ executable: '/opt/homebrew/bin/docker', socketPath: dockerSocket, stateRoot }).initialize();
  const imageId = applicationImage || (await engine.run(['image', 'inspect', 'thingtime-agent-browser:chromium-1.64.0', '--format', '{{.Id}}'])).trim();
  const images = await new BrowserImages({ engine, stateRoot: path.join(stateRoot, 'images') }).initialize();
  const manager = await new AgentBrowserManager({ engine, images, stateRoot, createSession: options => {
    const session = new BrowserContainer(engine, { ...options, memoryMb }), start = session.start.bind(session);
    session.start = async () => {
      const proof = await start();
      if (applicationImage) return proof;
      const script = `const http=require('http');let value='empty';http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:'http://1.1.1.1/'});return res.end();}if(req.method==='PUT'){let body='';req.on('data',c=>body+=c);return req.on('end',()=>{value=body;res.end('saved')});}if(req.url==='/value'){res.setHeader('content-type','text/plain');return res.end(value);}res.setHeader('content-type','text/html');res.end('<title>Private task fixture</title><h1>Task-owned app</h1><p id="value">'+value+'</p>');}).listen(18721,'127.0.0.1');`;
      await engine.run(['exec', '--detach', session.containerId, 'node', '-e', script]);
      return proof;
    };
    return session;
  } }).initialize();
  const assignments = [];
  for (const agentId of ['alpha', 'beta']) {
    const taskId = `fixture-${agentId}`, installId = randomUUID();
    await images.save({ id: installId, imageId, taskId, browser: 'chromium', buildId: 'playwright-1.64.0', platform: 'arm64', includesApplication: Boolean(applicationImage) });
    manager.registerTask({ taskId }); assignments.push({ agentId, taskId, installId });
  }
  const controller = await startControlSocket(manager, socketPath);
  await fs.writeFile(path.join(stateRoot, 'assignments.json'), JSON.stringify({ socketPath, assignments }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ready: true, assignmentsFile: path.join(stateRoot, 'assignments.json') }));
  const close = async () => { await controller.close(); await manager.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
