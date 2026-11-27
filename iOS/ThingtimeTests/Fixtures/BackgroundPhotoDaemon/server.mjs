import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [directory, runId] = process.argv.slice(2);
assert.ok(directory && /^\/tmp\/thingtime-background-daemon\.[a-zA-Z0-9]+$/.test(resolve(directory)));
assert.match(runId, /^[a-f0-9-]{36}$/);
const expectedBytes = 8 * 1024 * 1024;
const receiptPath = resolve(directory, 'server-receipt.json');
assert.equal(existsSync(receiptPath), false, 'Reuse the original receipt after an uncertain operation');
let requests = 0;
let receipt = { phase: 'listening', requests, bytes: 0 };
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
save();

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/receipt') {
    let appDetached = false;
    let appVerified = false;
    const pointer = resolve(directory, 'container-path');
    if (existsSync(pointer)) {
      const container = readFileSync(pointer, 'utf8').trim();
      assert.match(container, /\/CoreSimulator\/Devices\/F246703C-C1F5-43FA-8609-C9E6F17245DA\/data\/Containers\/Data\/Application\/[A-F0-9-]+$/);
      const status = resolve(container, 'Documents/status.json');
      if (existsSync(status)) {
        const phase = JSON.parse(readFileSync(status, 'utf8')).stage;
        appDetached = phase === 'detached';
        appVerified = phase === 'verified';
      }
    }
    response.writeHead(receipt.phase === 'received' ? 200 : 409, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ...receipt, appDetached, appVerified }));
    return;
  }
  if (request.method !== 'PUT' || request.url !== '/part/' + runId) {
    response.writeHead(404).end();
    return;
  }
  requests += 1;
  if (requests !== 1 || Number(request.headers['content-length']) !== expectedBytes) {
    receipt = { ...receipt, phase: 'unexpected-request', requests };
    save();
    response.writeHead(409).end();
    return;
  }
  const hash = createHash('sha256');
  let bytes = 0;
  let held = false;
  let releaseTimer;
  request.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > expectedBytes) {
      request.destroy(new Error('Fixture body exceeded its immutable length'));
      return;
    }
    hash.update(chunk);
    receipt = { ...receipt, requests, bytes };
    if (!held) {
      held = true;
      request.pause();
      receipt = { ...receipt, phase: 'held', heldAt: new Date().toISOString() };
      save();
      releaseTimer = setInterval(() => {
        if (!existsSync(resolve(directory, 'release'))) return;
        clearInterval(releaseTimer);
        receipt = { ...receipt, phase: 'receiving', releasedAt: new Date().toISOString() };
        save();
        request.resume();
      }, 100);
    }
  });
  request.on('end', () => {
    clearInterval(releaseTimer);
    receipt = { ...receipt, phase: 'received', bytes, sha256: hash.digest('hex'), receivedAt: new Date().toISOString() };
    save();
    response.writeHead(200, { 'Content-Length': '0', Connection: 'close' }).end();
  });
  request.on('error', () => {
    clearInterval(releaseTimer);
    receipt = { ...receipt, phase: 'failed', bytes };
    save();
  });
});
server.requestTimeout = 240_000;
server.listen(19759, '127.0.0.1', () => console.log('BACKGROUND_FIXTURE_READY'));
const deadline = setTimeout(() => server.close(), 10 * 60_000);
process.on('SIGTERM', () => {
  clearTimeout(deadline);
  server.close(() => process.exit(0));
});
