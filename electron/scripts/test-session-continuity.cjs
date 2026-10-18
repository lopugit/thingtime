'use strict';

// Real Chromium cookies/localStorage/IndexedDB, synthetic identities only.
// Both the renderer and its HTTP fixture inherit the same OS network sandbox.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { SessionAuthority } = require('../lib/session-authority.cjs');
const api = 'https://synthetic-account.example';
const ports = [19871, 19872];
const origins = ports.map(port => `http://127.0.0.1:${port}`);

async function electronPhase() {
 const { app, BrowserWindow, session } = require('electron');
 const root = process.env.TT_SESSION_TEST_ROOT;
 if (!root || !path.isAbsolute(root) || !['seed', 'recover'].includes(process.env.TT_SESSION_TEST_PHASE)) throw new Error('Explicit isolated fixture required.');
 app.setName('Thingtime Session Continuity Test');
 app.setPath('userData', path.join(root, 'profile'));
 app.commandLine.appendSwitch('use-mock-keychain');
 app.commandLine.appendSwitch('disable-background-networking');
 await app.whenReady();
 const manager = new SessionAuthority({ userData: app.getPath('userData') });
 await manager.initialize();
 if (process.env.TT_SESSION_TEST_PHASE === 'recover') {
  await manager.recover({ apiOrigin: api, contentOrigin: origins[0] }, async () => {});
  await manager.initialize();
 }
 const servers = [];
 for (const port of ports) {
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Isolated session fixture</title>'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  servers.push(server);
 }
 async function workspace(partition, origin, expected, seed) {
  const window = new BrowserWindow({ show: false, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadURL(origin);
  const chromiumSession = partition ? session.fromPartition(partition) : session.defaultSession;
  if (seed) await chromiumSession.cookies.set({ url: origin, name: 'synthetic-session', value: expected, expirationDate: Date.now() / 1000 + 3600 });
  const stored = await window.webContents.executeJavaScript(`(async () => {
   const seed=${JSON.stringify(seed)}, expected=${JSON.stringify(expected)};
   if (seed) localStorage.setItem('synthetic-draft', expected);
   const db = await new Promise((resolve,reject) => { const r=indexedDB.open('synthetic-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
   if(seed) await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(expected,'draft');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
   const indexed=await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get('draft');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   db.close();return {local:localStorage.getItem('synthetic-draft'),indexed};
  })()`);
  assert.deepEqual(stored, { local: expected, indexed: expected });
  const cookies = await chromiumSession.cookies.get({ url: origin, name: 'synthetic-session' });
  assert.equal(cookies[0]?.value, expected);
  await chromiumSession.cookies.flushStore(); chromiumSession.flushStorageData();
  window.destroy();
 }
 const { endpointPartition } = require('../lib/local-runtime.cjs');
 const seed = process.env.TT_SESSION_TEST_PHASE === 'seed';
 await workspace(seed ? '' : manager.partition(api), seed ? origins[0] : manager.rendererOrigin(api, origins[1]), 'legacy-synthetic', seed);
 await workspace(endpointPartition(api), origins[1], 'newer-synthetic', seed);
 for (const server of servers) await new Promise(resolve => server.close(resolve));
 console.log(`SESSION_PHASE_OK ${process.env.TT_SESSION_TEST_PHASE}`);
 app.quit();
}

async function run() {
 if (process.versions.electron) return electronPhase();
 if (process.platform !== 'darwin') throw new Error('Requires macOS sandbox-exec for the full browser/backend network boundary.');
 const root = await fs.mkdtemp(path.join(tmpdir(), 'tt-session-continuity-'));
 try {
  const policy = path.join(root, 'network.sb');
  await fs.writeFile(policy, `(version 1)(allow default)(deny network*)
   (allow network-inbound ${ports.map(port => `(local ip "localhost:${port}")`).join(' ')})
   (allow network-outbound ${ports.map(port => `(remote ip "localhost:${port}")`).join(' ')})`);
  const env = { PATH: process.env.PATH, HOME: root, TMPDIR: root, TT_SESSION_TEST_ROOT: root };
  const preflight = spawnSync('/usr/bin/sandbox-exec', ['-f', policy, process.execPath, '--input-type=module', '-e', `
   import http from 'node:http';
   async function blocked(url){try{await fetch(url,{signal:AbortSignal.timeout(2000)});throw Error('BOUNDARY_FAILED');}catch(e){if(e.cause?.code!=='EPERM')throw e;}}
   const s=http.createServer((q,r)=>{r.writeHead(307,{Location:'http://1.1.1.1/'});r.end();});await new Promise(r=>s.listen(${ports[0]},'127.0.0.1',r));
   await blocked('http://1.1.1.1/');await blocked('http://127.0.0.1:19873/');await blocked('${origins[0]}/');await new Promise(r=>s.close(r));
  `], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(preflight.status, 0, preflight.stderr);
  const electronPackage = path.dirname(require.resolve('electron/package.json'));
  const executable = (await fs.readFile(path.join(electronPackage, 'path.txt'), 'utf8')).trim();
  const electron = path.join(electronPackage, 'dist', executable);
  await fs.access(electron); // Dependency provisioning is separate from isolated acceptance.
  for (const phase of ['seed', 'recover']) {
   const result = spawnSync('/usr/bin/sandbox-exec', ['-f', policy, electron, __filename], { env: { ...env, TT_SESSION_TEST_PHASE: phase }, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', detached: true });
   if (result.error || result.status !== 0) { try { process.kill(-result.pid, 'SIGKILL'); } catch {} }
   assert.equal(result.status, 0, result.stderr.slice(-3000));
   assert.match(result.stdout, new RegExp(`SESSION_PHASE_OK ${phase}`));
  }
  console.log('Verified synthetic cookies, localStorage and IndexedDB across two Electron launches; both workspace stores preserved; direct IP, other loopback and redirect escape denied.');
 } finally { await fs.rm(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error.message); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
