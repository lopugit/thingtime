import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createFixtureHttpObserver } from './mac-fixture-http-observer.mjs';
const network = createRequire(import.meta.url)('../../electron/lib/folder-network-io.cjs');
test('actual native network PUT is observed and selected by append barrier without signed data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mac-fixture-observer-'));
  const file = join(directory, 'events.jsonl'), observe = createFixtureHttpObserver(file);
  const server = createServer(async (request, response) => {
    observe(request);
    // Delayed body consumption must retain every byte in the readable buffer.
    await new Promise(resolve => setTimeout(resolve, 20));
    const received = []; for await (const chunk of request) received.push(chunk);
    assert.equal(Buffer.concat(received).toString(), 'synthetic-native-body');
    response.writeHead(204); response.end();
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(), bytes = Buffer.from('synthetic-native-body');
    const target = `http://127.0.0.1:${address.port}/api/v1/attachments/local-object?op=part&sig=must-not-appear`;
    const body = async function* () { yield bytes; };
    observe({ method: 'PUT', url: '/api/v1/attachments/local-object?sig=earlier-seed' });
    const baseline = (await readFile(file, 'utf8')).trim().split('\n').length;
    const before = Date.now();
    const response = await network.put(target, {}, body(), bytes.length, new AbortController().signal, () => {});
    assert.equal(response.status, 204);
    const raw = await readFile(file, 'utf8'), events = raw.trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(e => e.operation === 'attachment-object-put').length, 2); const selected = events.slice(baseline).filter(e => e.operation === 'attachment-object-put');
    assert.equal(selected.length, 1); assert.equal(selected[0].operation, 'attachment-object-put');
    assert.ok(selected[0].at >= before);
    const first = events.find(e => e.sequence === selected[0].sequence && e.operation === 'attachment-object-put-first-byte');
    const completed = events.find(e => e.sequence === selected[0].sequence && e.operation === 'attachment-object-put-body');
    assert.ok(first.firstByteAt >= selected[0].at); assert.equal(completed.firstByteAt, first.firstByteAt);
    assert.equal(completed.payloadBytes, bytes.length);
    assert.ok(!raw.includes('must-not-appear')); assert.ok(!raw.includes('synthetic-native-body'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
test('observer normalizes absolute-form and slash targets while retaining only closed categories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mac-fixture-observer-')), file = join(directory, 'events.jsonl');
  try {
    const observe = createFixtureHttpObserver(file, () => 42);
    observe({ method: 'POST', url: '/api/v1/attachments/local-object?secret=excluded' });
    observe({ method: 'PUT', url: 'http://localhost/api/v1/attachments/local-object/?secret=excluded' });
    observe({ method: 'PUT', url: '/unrelated?secret=excluded' });
    const raw = await readFile(file, 'utf8'), rows = raw.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(r => r.operation), ['attachment-object-put', 'other-put']);
    assert.deepEqual(rows.map(r => r.sequence), [1, 2]); assert.ok(!raw.includes('excluded'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
