import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { characterCoordinationPreflight } from './character-coordination-preflight';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from '../app/api/utils/capabilities/capabilityContract';

test('coordination discovery uses real HTTP and distinguishes edge, capability and account state', async () => {
  let reply: (response: ServerResponse) => void;
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    assert.equal(request.method, 'GET');
    assert.equal(request.url, THINGTIME_CAPABILITY_MANIFEST_PATH);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    reply(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const manifest = (version = '1.0.0', declaredOrigin = origin) => ({ schemaVersion: 1, origin: declaredOrigin, features: { 'api.auth-characters': { version } } });
  const json = (value: unknown) => { reply = res => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); }; };
  try {
    for (const version of ['1.0.0', '1.2.4']) {
      json(manifest(version));
      const result = await characterCoordinationPreflight(origin);
      assert.equal(result.ok, true);
      assert.equal(result.authentication, 'not_checked');
      assert.equal(result.membership, 'not_checked');
    }
    for (const version of ['0.9.0', '2.0.0', '1.0.0-beta', 'bad']) {
      json(manifest(version));
      assert.equal((await characterCoordinationPreflight(origin)).code, 'INCOMPATIBLE_CAPABILITY');
    }
    json({ ...manifest(), features: {} });
    assert.equal((await characterCoordinationPreflight(origin)).code, 'INCOMPATIBLE_CAPABILITY');
    json(manifest('1.0.0', 'https://other.example'));
    assert.equal((await characterCoordinationPreflight(origin)).code, 'INVALID_MANIFEST');
    for (const value of [null, { ...manifest(), schemaVersion: 2 }, { ...manifest(), features: [] }]) {
      json(value);
      assert.equal((await characterCoordinationPreflight(origin)).code, 'INVALID_MANIFEST');
    }
    reply = res => { res.writeHead(403, { server: 'cloudflare' }); res.end('error code: 1010 SECRET_BODY'); };
    const edge = await characterCoordinationPreflight(origin);
    assert.equal(edge.code, 'EDGE_REFUSED');
    assert.ok(!JSON.stringify(edge).includes('SECRET_BODY'));
    // Cloudflare also forwards application responses; its server header alone
    // must never turn an actual permission failure into an edge diagnosis.
    reply = res => { res.writeHead(403, { server: 'cloudflare', 'content-type': 'application/json' }); res.end('{"error":"Forbidden"}'); };
    assert.equal((await characterCoordinationPreflight(origin)).code, 'HTTP_ERROR');
    reply = res => { res.writeHead(302, { location: 'https://other.example/' }); res.end(); };
    const beforeRedirect = calls;
    assert.equal((await characterCoordinationPreflight(origin)).code, 'REDIRECT_REFUSED');
    assert.equal(calls, beforeRedirect + 1);
    reply = res => { res.setHeader('Content-Type', 'text/html'); res.end('<html>Sign in</html>'); };
    assert.equal((await characterCoordinationPreflight(origin)).code, 'INVALID_MANIFEST');
    reply = res => { res.setHeader('Content-Type', 'application/json'); res.end('{'); };
    assert.equal((await characterCoordinationPreflight(origin)).code, 'INVALID_MANIFEST');
    reply = () => {};
    assert.equal((await characterCoordinationPreflight(origin, { timeoutMs: 30 })).code, 'TIMEOUT');
    // A failed attempt must not poison later discovery.
    json(manifest());
    assert.equal((await characterCoordinationPreflight(origin)).ok, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  assert.equal((await characterCoordinationPreflight(origin)).code, 'NETWORK_ERROR');
});

test('rejects unsafe or ambiguous origins before sending a request', async () => {
  const noNetwork = async () => { throw new Error('must not request'); };
  for (const origin of ['https://user:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#secret', 'https://example.com/path', 'http://example.com', 'file:///tmp/example', 'not a URL']) {
    const result = await characterCoordinationPreflight(origin, { fetch: noNetwork });
    assert.equal(result.code, 'INVALID_ORIGIN');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
