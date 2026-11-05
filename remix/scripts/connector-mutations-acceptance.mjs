#!/usr/bin/env node
// Real HTTP and MCP acceptance with a fresh disposable replica set. The only
// direct database commands initialize that set; application fixtures use APIs.
// Run after building Nitro with the node-server preset. Never use a real account.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-connector-mutations-'));
const checks = [];
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = async () => {
  const server = createServer(); await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  const value = server.address().port; await new Promise(r => server.close(r)); return value;
};
const ports = { db: await port(), api: await port() };
const origin = `http://127.0.0.1:${ports.api}`;
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir, NODE_ENV: 'development',
  HOST: '127.0.0.1', PORT: String(ports.api), MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=connectormutations`,
  JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_CHATGPT_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
  THINGTIME_CHATGPT_ALLOWED_ENDPOINTS: origin, THINGTIME_DATA_ENV: 'development' };
// No inherited application configuration, credentials, profile or network rules.
function start(command, args) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: 'ignore' });
  children.push(child); return child;
}
async function waitFor(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await delay(200); }
  throw Error(`Timed out: ${label}`);
}
async function request(path, { body, cookie, token, form, method = body === undefined && !form ? 'GET' : 'POST', status = 200 } = {}) {
  const response = await fetch(origin + path, { method, redirect: 'manual', headers: { Origin: origin,
    'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
    ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(form ? { body: form.toString() } : body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = null; }
  // Never place raw response bodies into errors: OAuth/token responses carry secrets.
  if (status !== null) assert.equal(response.status, status, `${method} ${path.split('?')[0]} unexpected HTTP status (${data?.error ? String(data.error).slice(0, 180) : 'non-JSON or no error'})`);
  return { response, data, text, cookie: (response.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ') };
}
async function oauth(cookie, scopes) {
  const callback = `http://127.0.0.1:${await port()}/callback`;
  const registered = (await request('/api/v1/integrations/chatgpt/oauth/register', { body: { redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'Synthetic large mutation acceptance' }, status: 201 })).data;
  const verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: callback,
    state: randomBytes(32).toString('base64url'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/api/v1/integrations/chatgpt/mcp' });
  const page = await request('/api/v1/integrations/chatgpt/oauth/authorize?' + params, { cookie });
  const signed = /name="request" value="([^"]+)"/.exec(page.text)?.[1]; assert(signed, 'OAuth form must contain a signed request');
  const form = new URLSearchParams({ request: signed, intent: 'prepare', endpoint: origin }); scopes.forEach(scope => form.append('scope', scope));
  const prepared = (await request('/api/v1/integrations/chatgpt/oauth/authorize', { cookie, form })).data;
  const complete = (await request('/api/v1/integrations/chatgpt/oauth/authorize', { cookie, form: new URLSearchParams({ request: signed, intent: 'complete', label: 'Synthetic mutation owner', endpoint: origin, token: prepared.token }) })).data;
  const code = new URL(complete.redirectUri).searchParams.get('code');
  const exchange = (await request('/api/v1/integrations/chatgpt/oauth/token', { form: new URLSearchParams({ grant_type: 'authorization_code', client_id: registered.client_id, redirect_uri: callback, code, code_verifier: verifier, resource: origin + '/api/v1/integrations/chatgpt/mcp' }) })).data;
  assert(exchange.access_token, 'Real PKCE exchange must return an MCP bearer');
  return { bridge: exchange.access_token, pat: prepared.token, patId: prepared.tokenId, authorizeUrl: origin + '/api/v1/integrations/chatgpt/oauth/authorize?' + params };
}
const mcpPath = '/api/v1/integrations/chatgpt/mcp';
let rpcId = 0;
async function tool(token, name, args, status = 200) {
  const body = { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } };
  const result = await request(mcpPath, { token, body, status });
  return { bytes: Buffer.byteLength(JSON.stringify(body)), value: result.data?.result?.structuredContent, httpStatus: result.response.status };
}
const register = async () => request('/api/v1/auth/register', { body: {
  username: 'mutation' + randomBytes(6).toString('hex'), email: `mutation${randomUUID()}@example.invalid`,
  password: randomBytes(32).toString('hex')
} });
let client;
try {
  await mkdir(join(dir, 'db'));
  start(process.env.MONGOD_PATH || 'mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'connectormutations', '--nounixsocket']);
  client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await client.connect(); return true; } catch { return false; } }, 'disposable Mongo startup');
  await client.db('admin').command({ replSetInitiate: { _id: 'connectormutations', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  await waitFor(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await client.close();
  client = null;
  const server = start(process.execPath, [process.env.CONNECTOR_MUTATION_SERVER_ENTRY || '.output/server/index.mjs']);
  await waitFor(async () => {
    assert.equal(server.exitCode, null, 'Disposable Nitro server exited');
    try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; }
    catch { return false; }
  }, 'built Nitro HTTP server');
  const manifest = (await request('/.well-known/thingtime-chatgpt-capabilities.json')).data;
  assert.equal(manifest.features?.['chatgpt.mutations.preview'], '2.0.0');
  const owner = await register();
  const outsider = await register();
  const grant = await oauth(owner.cookie, ['things']);
  const other = await oauth(outsider.cookie, ['things']);
  const limited = await oauth(owner.cookie, ['things.read']);
  const pageId = randomUUID();
  const name = 'Synthetic private nested page';
  const original = [{ id: 'original-text', type: 'text', text: 'Original saved block' }];
  const created = (await request('/api/v1/things', { cookie: owner.cookie, body: { shareId: pageId, thingtime: ['webpage'], acl: ['tt:user'], crystal: { name, blocks: original } } })).data;
  assert.equal(created.thing?.id, pageId);
  const leaves = Array.from({ length: 600 }, (_, n) => ({ id: `editable-${n}`, type: 'text', text: `Block ${n}: ${'é'.repeat(110)}` }));
  let blocks = leaves;
  for (let depth = 0; depth < 10; depth++) blocks = [{ id: `nested-${depth}`, type: 'container', children: blocks }];
  const operation = { action: 'update', id: pageId, patch: { crystal: { name, blocks } } };
  const args = { operations: [operation] };
  assert.equal((await tool(undefined, 'preview_thingtime_mutation', args, 413)).httpStatus, 413);
  assert.equal((await tool(limited.bridge, 'preview_thingtime_mutation', args)).value.status, 403);
  const { bytes, value: preview } = await tool(grant.bridge, 'preview_thingtime_mutation', args);
  assert(bytes > 136 * 1024, 'Hosted MCP request crossed 136 KiB');
  assert(preview.receipt && preview.receipt.length < 1024, 'Receipt remains compact');
  assert(Buffer.byteLength(JSON.stringify(preview.preview)) > 48 * 1024, 'Review crossed old 48 KiB cap');
  assert.equal(JSON.stringify(preview.preview.operations[0].after.crystal.blocks), JSON.stringify(blocks));
  assert.equal((await tool(other.bridge, 'get_thingtime_mutation_preview', { receipt: preview.receipt, cursor: 0 })).value.status >= 400, true);
  const tampered = preview.receipt.slice(0, -8) + 'abcdefgh';
  assert.equal((await tool(grant.bridge, 'apply_thingtime_mutation', { receipt: tampered, confirmed: true })).value.status, 400);
  const competing = (await tool(grant.bridge, 'preview_thingtime_mutation', args)).value;
  assert(competing.receipt);
  const confirmation = { receipt: preview.receipt, confirmed: true };
  const attempts = await Promise.all([tool(grant.bridge, 'apply_thingtime_mutation', confirmation), tool(grant.bridge, 'apply_thingtime_mutation', confirmation)]);
  const applied = attempts.map(({ value }) => value).find((value) => value.applied === 1);
  assert(applied?.undoAvailable, 'Large update saved undo');
  assert.equal(attempts.filter(({ value }) => value.applied === 1).length, 1);
  assert.equal(attempts.filter(({ value }) => value.status === 409).length, 1);
  assert.equal((await tool(grant.bridge, 'apply_thingtime_mutation', { receipt: competing.receipt, confirmed: true })).value.status, 409);
  const exact = (await request('/api/v1/things?id=' + pageId, { cookie: owner.cookie })).data.thing;
  const flatten = (items) => items.flatMap((item) => [item, ...flatten(item.children || [])]);
  assert.deepEqual(flatten(exact.crystal.blocks).filter((item) => item.type === 'text').map(({ id, text }) => ({ id, text })), leaves.map(({ id, text }) => ({ id, text })));
  assert.equal((await request('/api/v1/things?id=' + pageId, { cookie: outsider.cookie, status: null })).response.ok, false);
  assert.equal((await tool(grant.bridge, 'get_thingtime_history', { historyId: applied.history.id })).value.history.undoAvailable, true);
  checks.push(`${bytes}-byte hosted MCP request; full editable private page write and independent readback; scoped receipts; stale and concurrent replay denied`);

  const id = randomUUID();
  const fullJson = JSON.stringify([{ ...operation, patch: { crystal: { name: 'Staged nested update', blocks } } }]);
  const parts = [];
  for (let i = 0; i < fullJson.length; i += 15_000) parts.push(fullJson.slice(i, i + 15_000));
  for (const [part, data] of parts.entries()) {
    assert.equal((await tool(grant.bridge, 'stage_thingtime_mutation_plan', { id, part, data })).value.staged, true);
  }
  assert.equal((await tool(grant.bridge, 'stage_thingtime_mutation_plan', { id, part: 0, data: parts[0] })).value.staged, true);
  assert.equal((await tool(grant.bridge, 'stage_thingtime_mutation_plan', { id, part: 0, data: 'different' })).value.status, 409);
  assert.equal((await tool(grant.bridge, 'preview_thingtime_mutation', { stagedPlan: { id, parts: parts.length + 1 } })).value.status, 409);
  const staged = (await tool(grant.bridge, 'preview_thingtime_mutation', { stagedPlan: { id, parts: parts.length } })).value;
  assert(staged.receipt);
  assert.equal(staged.preview.operations[0].after.crystal.name, 'Staged nested update');
  const stagedApplied = (await tool(grant.bridge, 'apply_thingtime_mutation', { receipt: staged.receipt, confirmed: true })).value;
  assert.equal(stagedApplied.applied, 1);
  const undo = (await tool(grant.bridge, 'undo_thingtime_mutation', { historyId: stagedApplied.history.id })).value;
  assert(undo.receipt && Buffer.byteLength(JSON.stringify(undo.preview)) > 256 * 1024, 'Large inverse survives encrypted storage');
  assert.equal((await tool(grant.bridge, 'apply_thingtime_mutation', { receipt: undo.receipt, confirmed: true })).value.applied, 1);
  assert.equal((await request('/api/v1/things?id=' + pageId, { cookie: owner.cookie })).data.thing.crystal.name, name);
  checks.push('single large operation spans immutable retryable text parts; missing and conflicting parts fail closed; large undo survives encrypted storage');

  const batch = Array.from({ length: 30 }, () => ({ action: 'create', thing: {
    shareId: randomUUID(), thingtime: ['data'], acl: ['tt:user'], crystal: { name: 'Review page', text: 'x'.repeat(20_000) }
  } }));
  const paged = (await tool(grant.bridge, 'preview_thingtime_mutation', { operations: batch })).value;
  assert.equal(paged.preview.total, batch.length);
  assert(Number.isInteger(paged.preview.nextCursor));
  let review = paged.preview;
  const seen = [];
  for (;;) {
    seen.push(...review.operations.map(({ id }) => id));
    if (review.nextCursor === null) break;
    review = (await tool(grant.bridge, 'get_thingtime_mutation_preview', { receipt: paged.receipt, cursor: review.nextCursor })).value.preview;
  }
  assert.deepEqual(seen, batch.map(({ thing }) => thing.shareId));
  const malformed = [{ action: 'update', id: pageId, patch: { id: batch[0].thing.shareId, crystal: { name: 'Wrong target' } } }];
  assert.equal((await tool(grant.bridge, 'preview_thingtime_mutation', { operations: malformed })).value.status, 400);
  checks.push('30-operation plan preserves exact order across review pages; target override denied');
  const firstId = randomUUID();
  const invalidId = randomUUID();
  const neverId = randomUUID();
  const partialPlan = (await tool(grant.bridge, 'preview_thingtime_mutation', { operations: [
    { action: 'create', thing: { shareId: firstId, thingtime: ['data'], acl: ['tt:user'], crystal: { name: 'First only' } } },
    { action: 'create', thing: { shareId: invalidId, thingtime: ['webpage'], acl: ['tt:user'], crystal: { blocks: [] } } },
    { action: 'create', thing: { shareId: neverId, thingtime: ['data'], acl: ['tt:user'], crystal: { name: 'Must not run' } } }
  ] })).value;
  const partial = (await tool(grant.bridge, 'apply_thingtime_mutation', { receipt: partialPlan.receipt, confirmed: true })).value;
  assert.equal(partial.history?.status, 'partial');
  assert.deepEqual(partial.history.results.map(({ ok }) => ok), [true, false, false]);
  assert.equal((await request('/api/v1/things?id=' + neverId, { cookie: owner.cookie, status: null })).response.status, 404);
  assert.equal((await tool(grant.bridge, 'apply_thingtime_mutation', { receipt: partialPlan.receipt, confirmed: true })).value.status, 409);
  const capabilityId = randomUUID();
  const workflowThing = (await request('/api/v1/things', { cookie: owner.cookie, body: {
    shareId: capabilityId, thingtime: ['data'], acl: ['tt:user'],
    crystal: { name: 'Cancel acceptance workflow', schema: 'Thingtime Capability', capabilityVersion: 1,
      operations: [{ action: 'update', id: pageId, patch: { crystal: { name: 'Cancelled and must never apply' } } }] }
  } })).data.thing;
  assert.equal(workflowThing.id, capabilityId);
  const workflow = (await tool(grant.bridge, 'start_thingtime_workflow', { capabilityThingId: capabilityId })).value;
  assert(workflow.run?.id && workflow.receipt);
  assert.equal((await tool(grant.bridge, 'cancel_thingtime_workflow', { runId: workflow.run.id, confirmed: true })).value.run.status, 'cancelled');
  assert.equal((await tool(grant.bridge, 'apply_thingtime_mutation', { receipt: workflow.receipt, confirmed: true })).value.status, 409);
  assert.equal((await request('/api/v1/things?id=' + pageId, { cookie: owner.cookie })).data.thing.crystal.name, name);
  checks.push('partial failures are recorded and stop later writes; cancelled workflow receipt cannot apply by omitting runId');
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  await client?.close().catch(() => {});
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
    await Promise.race([once(child, 'exit'), delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }
  }));
  await rm(dir, { recursive: true, force: true });
}
