'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRelay } = require('../scripts/test-agent-desktop-relay.cjs');

test('relay retains the browser namespace and exact authority, rejects host spoofing and fails closed on expired ownership', async () => {
  let active = true, calls = [];
  const engine = { run: async (args, options) => {
    calls.push({ args, input: JSON.parse(options.input) });
    return JSON.stringify({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}').toString('base64') });
  } };
  const task = { containerId: 'owned-browser-and-backend', closed: false };
  // Reserve an ephemeral port for the unit-test transport; real acceptance uses
  // one explicitly selected durable port in both network namespaces.
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = createRelay({ engine, task, port, active: () => active });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const request = (headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/devices/sync-control', method: 'POST', headers }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject); req.end('{"action":"status"}');
  });
  try {
    assert.equal(await request({ 'x-forwarded-host': 'thingtime.com', 'x-forwarded-proto': 'https', forwarded: 'host=thingtime.com' }), 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(0, 4), ['exec', '-i', task.containerId, 'node']);
    assert.equal(calls[0].input.port, port);
    assert.equal(calls[0].input.headers.host, `127.0.0.1:${port}`);
    assert.equal(calls[0].input.headers['x-forwarded-host'], undefined);
    assert.equal(calls[0].input.headers['x-forwarded-proto'], undefined);
    assert.equal(calls[0].input.headers.forwarded, undefined);
    assert.equal(Buffer.from(calls[0].input.body, 'base64').toString(), '{"action":"status"}');
    assert.equal(await request({ host: 'thingtime.com' }), 502);
    active = false;
    assert.equal(await request(), 502);
    assert.equal(calls.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('failure diagnostics are bounded, private, exclusive artifacts and refuse unsafe directories', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { saveAcceptanceFailure } = require('../scripts/acceptance-diagnostics.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-acceptance-diagnostic-'));
  try {
    const error = new Error('fixture diagnostic ' + 'x'.repeat(17000));
    const one = await saveAcceptanceFailure(root, 'fixture', error);
    const two = await saveAcceptanceFailure(root, 'fixture', error);
    assert.notEqual(one, two);
    assert.equal((await fs.stat(one)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await fs.readFile(one, 'utf8')).message.length, 16000);
    await fs.chmod(root, 0o755);
    assert.equal(await saveAcceptanceFailure(root, 'fixture', error), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
