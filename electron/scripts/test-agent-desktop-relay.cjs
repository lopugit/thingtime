'use strict';
// Opt-in desktop acceptance transport. HTTP bytes enter a task namespace over
// Docker stdin/stdout, never a published container port or outbound route.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { DockerEngine, BrowserContainer } = require('../lib/agent-browsers/containers.cjs');

async function main() {
  const [stateRoot, imageId, rawPort] = process.argv.slice(2), port = Number(rawPort);
  if (!stateRoot || !path.isAbsolute(stateRoot) || !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Supply absolute private state, immutable image ID and an unused test port.');
  const engine = await new DockerEngine({ executable: process.arch === 'arm64' ? '/opt/homebrew/bin/docker' : '/usr/local/bin/docker', socketPath: path.join(require('node:os').homedir(), '.colima/thingtime-agents/docker.sock'), stateRoot }).initialize();
  const task = new BrowserContainer(engine, { imageId });
  let server;
  const close = async () => { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); await task.close(); };
  try {
    const proof = await task.start();
    const launch = await task.call('launch', {}, { timeoutMs: 330000 });
    if (!proof.proof.isolated || !launch.application) throw new Error('Desktop acceptance requires the full isolated app.');
    await task.call('close');
    const remote = `const http=require('node:http');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{const input=JSON.parse(text);const req=http.request({host:'127.0.0.1',port:18721,path:input.path,method:input.method,headers:input.headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('base64')})));});req.on('error',()=>process.exit(1));req.end(Buffer.from(input.body,'base64'));});`;
    server = http.createServer(async (request, response) => {
      try {
        if (!request.url.startsWith('/') || request.url.startsWith('//')) throw new Error('Use the private app path.');
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const headers = { ...request.headers, host: '127.0.0.1:18721', 'accept-encoding': 'identity' };
        if (headers.origin === `http://127.0.0.1:${port}`) headers.origin = 'http://127.0.0.1:18721';
        if (headers.referer?.startsWith(`http://127.0.0.1:${port}/`)) headers.referer = headers.referer.replace(`http://127.0.0.1:${port}/`, 'http://127.0.0.1:18721/');
        delete headers.connection; delete headers['transfer-encoding'];
        const result = JSON.parse(await engine.run(['exec', '-i', task.containerId, 'node', '-e', remote], { input: JSON.stringify({ path: request.url, method: request.method, headers, body: Buffer.concat(chunks).toString('base64') }), timeoutMs: 120000 }));
        delete result.headers['transfer-encoding']; delete result.headers.connection;
        if (result.headers.location?.startsWith('http://127.0.0.1:18721/')) result.headers.location = result.headers.location.replace('http://127.0.0.1:18721/', `http://127.0.0.1:${port}/`);
        response.writeHead(result.status, result.headers); response.end(Buffer.from(result.body, 'base64'));
      } catch { if (!response.headersSent) response.writeHead(502); response.end('The private test app is unavailable.'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(stateRoot, 'relay.json'), JSON.stringify({ origin: `http://127.0.0.1:${port}`, sessionId: task.id, containerId: task.containerId }), { mode: 0o600 });
    console.log(JSON.stringify({ ready: true, origin: `http://127.0.0.1:${port}`, sessionId: task.id }));
    process.once('SIGINT', () => close().finally(() => process.exit()));
    process.once('SIGTERM', () => close().finally(() => process.exit()));
  } catch (error) { await close(); throw error; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
