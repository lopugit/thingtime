import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { transferCredential, parseImportArgs, importOrigin, ImportFailure, readCredentialInput } from './credential-import';
import type { CredentialImportTarget } from '../app/credentials/importContract';

const target: CredentialImportTarget = { destination: 'admin-provider-vault', format: 'text', label: 'synthetic-provider', environment: 'development', overwrite: { mode: 'create' } };
const makeReceipt = () => ({ credentialId: 'secret_1234567890123456789012_-', label: target.label, environment: target.environment, format: target.format, updatedAt: '2026-11-04T00:00:00.000Z' });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('CLI rejects unsafe origins and secret arguments before input', () => {
  for (const value of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/x', 'https://example.com/?token=secret']) assert.throws(() => importOrigin(value), ImportFailure);
  assert.equal(importOrigin('http://127.0.0.1:17883'), 'http://127.0.0.1:17883');
  const args = ['--origin','https://thingtime.com','--account','admin-id','--environment','production','--format','google-oauth','--file','/selected/client.json'];
  assert.equal(parseImportArgs(args).target.label, 'connections-google-oauth');
  assert.throws(() => parseImportArgs([...args, '--value', 'never-print-this']), ImportFailure);
  assert.throws(() => parseImportArgs([...args, '--stdin']), ImportFailure);
  assert.throws(() => parseImportArgs([...args, '--replace-id', 'secret_1234']), ImportFailure);
});

test('manifest, redirect and verification URL failures never read the selected credential', async () => {
  for (const mode of ['missing', 'breaking', 'wrong-origin', 'redirect', 'verification']) {
    let read = false;
    const fetcher: typeof fetch = async (_url, init) => {
      if (!init?.body) {
        if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid' } });
        return json({ schemaVersion: 1, origin: mode === 'wrong-origin' ? 'https://other.invalid' : 'https://thingtime.com', features: mode === 'missing' ? {} : { 'api.credentials-import': { version: mode === 'breaking' ? '2.0.0' : '1.0.0' } } });
      }
      const body = JSON.parse(String(init.body));
      return json({ ok: true, requestId: body.requestId, expiresAt: new Date(Date.now() + 10000).toISOString(), verificationUrl: 'https://attacker.invalid/approval' });
    };
    await assert.rejects(transferCredential({ origin: 'https://thingtime.com', expectedAccountId: 'admin-id', target, fetch: fetcher, readInput: async () => { read = true; return Buffer.from('private'); } }), ImportFailure);
    assert.equal(read, false, mode);
  }
});

test('real HTTP handoff waits for approval, binds proof, resolves an uncertain upload without duplication and prints only receipt', async () => {
  let started: { requestId: string; challenge: string; expectedAccountId: string; target: unknown };
  let polls = 0; let uploads = 0; let complete = false;
  const server = createServer(async (req, res) => {
    const respond = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    try {
      const raw: Buffer[] = [];
      for await (const chunk of req) raw.push(Buffer.from(chunk));
      const input = Buffer.concat(raw);
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.origin, origin);
      if (req.url === '/.well-known/thingtime-capabilities.json') return respond({ schemaVersion: 1, origin, features: { 'api.credentials-import': { version: '1.1.0' } } });
      if (req.url?.endsWith('/start')) {
        started = JSON.parse(input.toString());
        assert.equal(started.expectedAccountId, 'admin-id'); assert.deepEqual(started.target, target);
        return respond({ ok: true, requestId: started.requestId, expiresAt: new Date(Date.now() + 30000).toISOString(), verificationUrl: origin + '/credentials/import?requestId=' + started.requestId });
      }
      if (req.url?.endsWith('/status')) {
        const proof = JSON.parse(input.toString());
        assert.equal(proof.requestId, started.requestId);
        assert.equal(Buffer.from(proof.verifier, 'base64url').length, 32);
        assert.equal(createHash('sha256').update(proof.verifier).digest('base64url'), started.challenge);
        polls++;
        return respond({ ok: true, status: complete ? 'completed' : polls === 1 ? 'pending' : 'approved', ...(complete ? { receipt: { ...makeReceipt(), unexpectedSecret: 'SERVER-SECRET' } } : {}) });
      }
      if (req.url?.endsWith('/upload')) {
        assert.equal(polls, 2); uploads++;
        assert.equal(req.headers['x-thingtime-import-request'], started.requestId);
        assert.equal(createHash('sha256').update(String(req.headers['x-thingtime-import-verifier'])).digest('base64url'), started.challenge);
        assert.equal(input.toString(), 'SELECTED-SECRET');
        complete = true;
        res.destroy(); // Commit succeeded; transport response was lost.
        return;
      }
      res.writeHead(404); res.end();
    } catch { res.writeHead(500); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const events: unknown[] = []; const source = Buffer.from('SELECTED-SECRET'); let reads = 0;
  try {
    const saved = await transferCredential({ origin, target, expectedAccountId: 'admin-id', emit: event => events.push(event), wait: async () => {}, readInput: async () => { assert.equal(polls, 2); reads++; return source; } });
    assert.deepEqual(saved, makeReceipt()); assert.equal(uploads, 1); assert.equal(reads, 1);
    assert.equal(source.every(byte => byte === 0), true);
    assert(!JSON.stringify(events).includes('SECRET'));
    assert(!JSON.stringify(events).includes('verifier'));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('revocation refuses transfer and remote errors never echo secret-bearing bodies', async () => {
  for (const mode of ['revoked', 'server-error']) {
    let read = false;
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith('.json')) return json({ schemaVersion: 1, origin: 'https://thingtime.com', features: { 'api.credentials-import': { version: '1.0.0' } } });
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/start')) return json({ ok: true, requestId: body.requestId, expiresAt: new Date(Date.now() + 10000).toISOString(), verificationUrl: 'https://thingtime.com/credentials/import?requestId=' + body.requestId });
      if (mode === 'server-error') return json({ error: 'SECRET-CONTENT' }, 403);
      return json({ ok: true, status: 'revoked' });
    };
    await assert.rejects(transferCredential({ origin: 'https://thingtime.com', target, expectedAccountId: 'admin-id', fetch: fetcher, readInput: async () => { read = true; return Buffer.from('secret'); } }), error => {
      assert(error instanceof ImportFailure); assert(!error.message.includes('SECRET')); return true;
    });
    assert.equal(read, false);
  }
});

test('an idempotent start retry uses the original request ID and challenge', async () => {
  let firstStart = ''; let attempts = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('.json')) return json({ schemaVersion: 1, origin: 'https://thingtime.com', features: { 'api.credentials-import': { version: '1.0.0' } } });
    if (String(url).endsWith('/start')) {
      attempts++;
      if (!firstStart) { firstStart = String(init?.body); throw new Error('untrusted network details'); }
      assert.equal(String(init?.body), firstStart);
      const body = JSON.parse(firstStart);
      return json({ ok: true, requestId: body.requestId, expiresAt: new Date(Date.now() + 10000).toISOString(), verificationUrl: 'https://thingtime.com/credentials/import?requestId=' + body.requestId });
    }
    return json({ ok: true, status: 'revoked' });
  };
  await assert.rejects(transferCredential({ origin: 'https://thingtime.com', target, expectedAccountId: 'admin-id', fetch: fetcher, wait: async () => {}, readInput: async () => Buffer.from('secret') }), /REVOKED/);
  assert.equal(attempts, 2);
});

test('Ctrl-C cancels an open credential pipe and zeroes buffered chunks', async () => {
  const stream = new PassThrough();
  const controller = new AbortController();
  const input = Buffer.from('synthetic only');
  const pending = readCredentialInput(undefined, stream, controller.signal);
  stream.write(input);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /CANCELLED/);
  assert(stream.destroyed); assert(input.every(byte => byte === 0));
});

test('a lost exact retry is reconciled, without a third upload or remote timestamp text', async () => {
  let uploads = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('.json')) return json({ schemaVersion: 1, origin: 'https://thingtime.com', features: { 'api.credentials-import': { version: '1.0.0' } } });
    if (String(url).endsWith('/upload')) { uploads++; throw Error('private transport details'); }
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/start')) return json({ ok: true, requestId: body.requestId, expiresAt: new Date(Date.now() + 10000).toISOString(), verificationUrl: 'https://thingtime.com/credentials/import?requestId=' + body.requestId });
    return json({ ok: true, status: uploads >= 2 ? 'completed' : 'approved', ...(uploads >= 2 ? { receipt: { ...makeReceipt(), updatedAt: 'Nov 4 2026 GMT (PRIVATE-TEXT)' } } : {}) });
  };
  const result = await transferCredential({ origin: 'https://thingtime.com', target, expectedAccountId: 'admin-id', fetch: fetcher, readInput: async () => Buffer.from('private') });
  assert.equal(uploads, 2); assert.equal(result.updatedAt, '2026-11-04T00:00:00.000Z');
});

test('a partial JSON save receipt is reconciled against the same request', async () => {
  for (const recoverable of [true, false]) {
    let uploads = 0;
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith('.json')) return json({ schemaVersion: 1, origin: 'https://thingtime.com', features: { 'api.credentials-import': { version: '1.0.0' } } });
      if (String(url).endsWith('/upload')) { uploads++; return json({ ok: true, receipt: {} }); }
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/start')) return json({ ok: true, requestId: body.requestId, expiresAt: new Date(Date.now() + 10000).toISOString(), verificationUrl: 'https://thingtime.com/credentials/import?requestId=' + body.requestId });
      return json({ ok: true, status: uploads ? 'completed' : 'approved', receipt: recoverable ? makeReceipt() : {} });
    };
    const transfer = transferCredential({ origin: 'https://thingtime.com', target, expectedAccountId: 'admin-id', fetch: fetcher, readInput: async () => Buffer.from('private') });
    if (recoverable) assert.deepEqual(await transfer, makeReceipt());
    else await assert.rejects(transfer, /TRANSFER_UNCONFIRMED/);
    assert.equal(uploads, 1);
  }
});

test('uncertain uploads reconcile HTTP 500, null status and wrong replacement IDs safely', async () => {
  for (const mode of ['http500', 'null-status', 'wrong-replacement']) {
    const replacement: CredentialImportTarget = { ...target, overwrite: { mode: 'replace', expectedId: makeReceipt().credentialId, expectedUpdatedAt: makeReceipt().updatedAt } };
    let uploads = 0;
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith('.json')) return json({ schemaVersion: 1, origin: 'https://thingtime.com', features: { 'api.credentials-import': { version: '1.0.0' } } });
      if (String(url).endsWith('/upload')) {
        uploads++;
        if (mode === 'http500') return json({ error: 'PRIVATE' }, 500);
        return json({ ok: true, receipt: mode === 'wrong-replacement' ? { ...makeReceipt(), credentialId: 'secret_abcdefghijklmnopqrstuvwx' } : {} });
      }
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/start')) return json({ ok: true, requestId: body.requestId, expiresAt: new Date(Date.now() + 10000).toISOString(), verificationUrl: 'https://thingtime.com/credentials/import?requestId=' + body.requestId });
      if (uploads && mode === 'null-status') return json(null);
      return json({ ok: true, status: uploads ? 'completed' : 'approved', receipt: { ...makeReceipt(), ...(mode === 'wrong-replacement' ? { credentialId: 'secret_abcdefghijklmnopqrstuvwx' } : {}) } });
    };
    const pending = transferCredential({ origin: 'https://thingtime.com', target: replacement, expectedAccountId: 'admin-id', fetch: fetcher, readInput: async () => Buffer.from('private') });
    if (mode === 'http500') assert.deepEqual(await pending, makeReceipt());
    else await assert.rejects(pending, /TRANSFER_UNCONFIRMED/);
    assert.equal(uploads, 1);
  }
});
