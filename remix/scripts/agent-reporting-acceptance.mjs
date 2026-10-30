#!/usr/bin/env node
// Real HTTP and MCP acceptance with a fresh disposable replica set. The only
// direct database commands initialize that set; application fixtures use APIs.
// Saved workspace definitions must be externally authored synthetic fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = process.env.AGENT_REPORTING_AUTHORED_THINGS;
assert(fixturePath, 'Set AGENT_REPORTING_AUTHORED_THINGS to an external synthetic saved-workspace JSON fixture');
assert(!resolve(fixturePath).startsWith(resolve(cwd, '..') + '/'), 'Authored workspace definitions must remain outside the repository');
const authored = JSON.parse(await readFile(fixturePath, 'utf8'));
const roles = ['project', 'task', 'agent', 'todo', 'progress', 'question'];
assert(roles.every(role => authored.schemas?.[role]) && authored.pages?.overview && authored.pages?.taskDetail && authored.actions, 'External fixture must include all private workspace references');
const dir = await mkdtemp(join(tmpdir(), 'tt-agent-reporting-'));
const evidenceDir = process.env.AGENT_REPORTING_EVIDENCE_DIR || join(tmpdir(), 'thingtime-agent-reporting-evidence');
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
  HOST: '127.0.0.1', PORT: String(ports.api), MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=agentreporting`,
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
  const registered = (await request('/api/v1/integrations/chatgpt/oauth/register', { body: { redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'Synthetic private reporting acceptance' }, status: 201 })).data;
  const verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: callback,
    state: randomBytes(32).toString('base64url'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: origin + '/api/v1/integrations/chatgpt/mcp' });
  const page = await request('/api/v1/integrations/chatgpt/oauth/authorize?' + params, { cookie });
  const signed = /name="request" value="([^"]+)"/.exec(page.text)?.[1]; assert(signed, 'OAuth form must contain a signed request');
  const form = new URLSearchParams({ request: signed, intent: 'prepare', endpoint: origin }); scopes.forEach(scope => form.append('scope', scope));
  const prepared = (await request('/api/v1/integrations/chatgpt/oauth/authorize', { cookie, form })).data;
  const complete = (await request('/api/v1/integrations/chatgpt/oauth/authorize', { cookie, form: new URLSearchParams({ request: signed, intent: 'complete', label: 'Synthetic reporting owner', endpoint: origin, token: prepared.token }) })).data;
  const code = new URL(complete.redirectUri).searchParams.get('code');
  const exchange = (await request('/api/v1/integrations/chatgpt/oauth/token', { form: new URLSearchParams({ grant_type: 'authorization_code', client_id: registered.client_id, redirect_uri: callback, code, code_verifier: verifier, resource: origin + '/api/v1/integrations/chatgpt/mcp' }) })).data;
  assert(exchange.access_token, 'Real PKCE exchange must return an MCP bearer');
  return { bridge: exchange.access_token, pat: prepared.token, patId: prepared.tokenId, authorizeUrl: origin + '/api/v1/integrations/chatgpt/oauth/authorize?' + params };
}
async function browserQa(cookie, authorizeUrl) {
  const modulePath = process.env.AGENT_REPORTING_PLAYWRIGHT_MODULE;
  const executablePath = process.env.AGENT_REPORTING_CHROMIUM_EXECUTABLE;
  assert(modulePath && executablePath, 'Selector QA requires explicit isolated Playwright module and Chromium executable paths');
  const { chromium } = await import(modulePath);
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => { const index = pair.indexOf('='); return { name: pair.slice(0,index), value: pair.slice(index+1), url: origin }; }));
    const page = await context.newPage();
    for (const [name, width, height] of [['desktop',1440,960],['mobile',390,844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#advanced > summary').click();
      const label = page.locator('label.scope').filter({ has: page.locator('input[value="agents.report"]') });
      await label.waitFor({ state: 'visible' });
      assert.match(await label.innerText(), /Private agent reporting/);
      assert.match(await label.innerText(), /General account and Things access stays separate/);
      await label.locator('input').check(); assert(await label.locator('input').isChecked());
      await page.evaluate(async () => { for(let y=0;y<document.documentElement.scrollHeight;y+=Math.max(200,innerHeight-80)){scrollTo(0,y);await new Promise(r=>setTimeout(r,20));}scrollTo(0,document.documentElement.scrollHeight); });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'OAuth page must have no horizontal overflow');
      const bounds = await label.boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Permission selector stays within viewport');
      await label.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidenceDir, 'reporting-permission-' + name + '.png'), fullPage: true, mask: [page.locator('input[type="password"]')] });
    }
    await context.close();
  } finally { await browser.close(); }
  checks.push('isolated Chromium OAuth Advanced permission label, description and checkbox verified at desktop/mobile; full scroll, no horizontal overflow, credential fields masked');
}
let rpcId = 0;
async function mcp(token, name, args) {
  const { data } = await request('/api/v1/integrations/chatgpt/mcp', { token, body: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } } });
  assert(data?.result, 'MCP must return a JSON-RPC tool result');
  const result = data.result;
  const value = result.structuredContent || (() => { try { return JSON.parse(result.content?.find(c => c.type === 'text')?.text || '{}'); } catch { return {}; } })();
  return { error: result.isError || !!value.error, value };
}
async function tool(token, name, args) { const result = await mcp(token, name, args); assert(!result.error, `${name} refused (${String(result.value.error || 'tool error').slice(0, 180)})`); return result.value.result || result.value; }
let client;
try {
  await access(join(cwd, '.output/server/index.mjs')); await mkdir(join(dir, 'db')); await mkdir(evidenceDir, { recursive: true });
  start(process.env.MONGOD_PATH || '/opt/homebrew/bin/mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'agentreporting', '--nounixsocket']);
  client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await client.connect(); return true; } catch { return false; } }, 'disposable Mongo startup');
  await client.db('admin').command({ replSetInitiate: { _id: 'agentreporting', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  await waitFor(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await client.close(); client = null;
  const server = start(process.execPath, ['.output/server/index.mjs']);
  await waitFor(async () => { assert(server.exitCode === null, 'Disposable Nitro server exited'); try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }, 'built Nitro HTTP server');
  const manifest = (await request('/.well-known/thingtime-capabilities.json')).data;
  for (const [feature, version] of Object.entries({ 'api.agent-reporting': '1.0.0', 'api.agent-overview': '2.0.0', 'api.auth-characters': '1.0.0' })) assert.equal(manifest.features?.[feature]?.version, version);
  checks.push('built Nitro origin advertises reporting, overview and Character contracts');
  const register = async prefix => request('/api/v1/auth/register', { body: { username: prefix + randomBytes(6).toString('hex'), email: `${prefix}${randomUUID()}@example.invalid`, password: randomBytes(32).toString('hex') } });
  const owner = await register('reportowner'); const stranger = await register('reportstranger');
  const create = async (kind, crystal) => { const data = (await request('/api/v1/things', { cookie: owner.cookie, body: { thingtime: [kind], acl: ['tt:user'], crystal } })).data; assert(data.thing?.id || data.id, `Saved ${kind} returned an ID`); return data.thing?.id || data.id; };
  const workspace = { pages: {}, schemas: {}, actions: {} };
  for (const [key, crystal] of Object.entries(authored.schemas)) workspace.schemas[key] = await create('schema', crystal);
  for (const [key, crystal] of Object.entries(authored.pages)) workspace.pages[key] = await create('webpage', crystal);
  const bindFixtureSchemaIds = value => typeof value === 'string' && /^\{\{schema:[a-z]+\}\}$/.test(value) ? workspace.schemas[value.slice(9,-2)] : Array.isArray(value) ? value.map(bindFixtureSchemaIds) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,entry]) => [key,bindFixtureSchemaIds(entry)])) : value;
  for (const [key, crystal] of Object.entries(authored.actions)) workspace.actions[key] = await create('action', bindFixtureSchemaIds(crystal));
  const subspace = (await request('/api/v1/subspaces', { cookie: owner.cookie, body: { name: 'Thingtime Agents', slug: `reporting-${randomBytes(5).toString('hex')}`, access: 'private' }, status: 201 })).data;
  workspace.subspaceId = subspace.subspace?.id; assert(workspace.subspaceId, 'Private subspace returned ID');
  const plain = await oauth(owner.cookie, ['things']); const grant = await oauth(owner.cookie, ['agents.report']);
  const args = { externalTaskId: 'isolated-http-mcp-reporting-acceptance', displayName: 'Synthetic Reporting Character', workspace };
  const denied = await request('/api/v1/agents/reporting', { token: plain.pat, body: { ...args, origin, operation: 'prepare' }, status: null }); assert.equal(denied.response.status, 403);
  assert((await mcp(plain.bridge, 'prepare_thingtime_agent_task', args)).error, 'Generic things bridge must refuse independent reporting');
  checks.push('real DCR/authorize prepare+complete/PKCE bridge; generic things PAT and bridge refuse reporting');
  await browserQa(owner.cookie, grant.authorizeUrl);
  let prepared = await tool(grant.bridge, 'prepare_thingtime_agent_task', args);
  assert(prepared.binding?.characterId && prepared.binding.characterId !== owner.data.user.id, 'Task receives a distinct Character');
  const repeat = await tool(grant.bridge, 'prepare_thingtime_agent_task', args); assert.deepEqual(repeat.binding, prepared.binding);
  const changedWorkspace = { ...workspace, pages: { ...workspace.pages, overview: workspace.pages.taskDetail } };
  assert((await mcp(grant.bridge, 'prepare_thingtime_agent_task', { ...args, workspace: changedWorkspace })).error, 'Stable task cannot be rebound to another workspace');
  const wrongOrigin = await request('/api/v1/agents/reporting', { token: grant.pat, body: { operation: 'get', origin: 'https://example.invalid', externalTaskId: args.externalTaskId }, status: null }); assert.equal(wrongOrigin.response.status, 400);
  assert.deepEqual(prepared.binding.workspace.pages, workspace.pages); assert.deepEqual(prepared.binding.workspace.schemas, workspace.schemas);
  checks.push('stable external identity reuses distinct Character and exact private saved workspace');
  const coordinateArgs = { externalTaskId: args.externalTaskId, requestId: randomUUID(), title: 'Synthetic task coordination', text: 'Private acceptance started', renderComponent: { render: { tag: 'p', children: ['{text}'] } } };
  const coordinated = await tool(grant.bridge, 'coordinate_thingtime_agent_task', coordinateArgs);
  const postId = coordinated.binding.coordinationPostId; assert(postId, 'Coordination returns a saved post ID');
  assert.deepEqual((await tool(grant.bridge, 'coordinate_thingtime_agent_task', coordinateArgs)).receipt, coordinated.receipt);
  const updatedCoordination = await tool(grant.bridge, 'coordinate_thingtime_agent_task', { ...coordinateArgs, requestId: randomUUID(), text: 'Private acceptance updated' });
  assert.equal(updatedCoordination.binding.coordinationPostId, postId, 'Coordination updates the existing post');
  const coordinationRead = await tool(grant.bridge, 'get_thingtime_agent_task', { externalTaskId: args.externalTaskId });
  assert.equal(coordinationRead.coordinationPost?.id, postId); assert.equal(coordinationRead.coordinationPost?.crystal?.text, 'Private acceptance updated');
  assert.equal(coordinationRead.coordinationPost?.author?.id, coordinated.binding.characterId);
  for (const cookie of [undefined, stranger.cookie]) { const deniedPost = await request('/api/v1/things?id=' + encodeURIComponent(postId), { cookie, status: null }); assert([401, 403, 404].includes(deniedPost.response.status)); }
  checks.push('one Character-authored rendered private coordination post is reused, read back, and hidden from anonymous and outsider callers');
  const report = async (actionName, inputs, requestId = randomUUID()) => tool(grant.bridge, 'report_thingtime_agent_task', { externalTaskId: args.externalTaskId, requestId, actionName, inputs });
  for (const [action, title] of [['createProject', 'Synthetic reporting project'], ['createTask', 'Synthetic reporting task'], ['createAgent', 'Synthetic reporting agent']]) prepared = await report(action, { title, status: 'active' });
  const taskId = prepared.binding.records.taskId; assert(taskId);
  const parentBefore = (await request('/api/v1/things?id=' + encodeURIComponent(taskId), { cookie: owner.cookie })).data.thing;
  const childArgs = { ...args, externalTaskId: args.externalTaskId + '/child', displayName: 'Synthetic Child Character', parentExternalTaskId: args.externalTaskId };
  let child = await tool(grant.bridge, 'prepare_thingtime_agent_task', childArgs);
  assert.notEqual(child.binding.characterId, prepared.binding.characterId); assert.equal(child.binding.records.projectId, prepared.binding.records.projectId);
  assert.equal(child.binding.parentTaskId, taskId); assert.equal(child.binding.sharedTaskId, taskId);
  assert.deepEqual((await tool(grant.bridge, 'prepare_thingtime_agent_task', childArgs)).binding, child.binding);
  const childReport = async (actionName, inputs) => tool(grant.bridge, 'report_thingtime_agent_task', { externalTaskId: childArgs.externalTaskId, requestId: randomUUID(), actionName, inputs });
  child = await childReport('createTask', { title: 'Synthetic child task', status: 'active' });
  child = await childReport('createAgent', { title: 'Synthetic child agent', status: 'active' });
  const childRead = await tool(grant.bridge, 'get_thingtime_agent_task', { externalTaskId: childArgs.externalTaskId });
  const childTask = childRead.records.find(record => record.id === child.binding.records.taskId);
  const childAgent = childRead.records.find(record => record.id === child.binding.records.agentId);
  assert.equal(childTask.author?.id, child.binding.characterId); assert.equal(childTask.crystal.parentId, taskId); assert.equal(childTask.crystal.taskId, taskId);
  assert.equal(childAgent.author?.id, child.binding.characterId); assert.equal(childAgent.crystal.parentId, childTask.id); assert.equal(childAgent.crystal.taskId, taskId);
  assert((await mcp(grant.bridge, 'report_thingtime_agent_task', { externalTaskId: childArgs.externalTaskId, requestId: randomUUID(), actionName: 'updateTask', inputs: { id: taskId, title: 'Forbidden parent mutation', status: 'complete' } })).error);
  const parentAfter = (await request('/api/v1/things?id=' + encodeURIComponent(taskId), { cookie: owner.cookie })).data.thing;
  assert.deepEqual(parentAfter.crystal, parentBefore.crystal); assert.equal(parentAfter.author.id, parentBefore.author.id);
  checks.push('stable child Character inherits project and links child task/agent to actual parent and shared root; parent mutation refused without changing parent');
  const grandchildArgs = { ...childArgs, externalTaskId: childArgs.externalTaskId + '/grandchild', displayName: 'Synthetic Grandchild Character', parentExternalTaskId: childArgs.externalTaskId };
  let grandchild = await tool(grant.bridge, 'prepare_thingtime_agent_task', grandchildArgs);
  assert.notEqual(grandchild.binding.characterId, child.binding.characterId); assert.equal(grandchild.binding.records.projectId, prepared.binding.records.projectId);
  grandchild = await tool(grant.bridge, 'report_thingtime_agent_task', { externalTaskId: grandchildArgs.externalTaskId, requestId: randomUUID(), actionName: 'createTask', inputs: { title: 'Synthetic grandchild task', status: 'active' } });
  const grandchildRead = await tool(grant.bridge, 'get_thingtime_agent_task', { externalTaskId: grandchildArgs.externalTaskId });
  const grandchildTask = grandchildRead.records.find(record => record.id === grandchild.binding.records.taskId);
  assert.equal(grandchildTask.crystal.parentId, childTask.id); assert.equal(grandchildTask.crystal.taskId, taskId);
  assert.equal(grandchildTask.crystal.projectId, prepared.binding.records.projectId);
  checks.push('grandchild task inherits original project and shared root while linking to its immediate parent task');


  const startedAt = new Date().toISOString();
  await report('updateTask', { id: taskId, title: 'Synthetic reporting task', status: 'active', startedAt });
  const operationId = randomUUID(); const progress = await report('addProgress', { body: 'Real MCP private milestone', status: 'active' }, operationId);
  const repeated = await report('addProgress', { body: 'Real MCP private milestone', status: 'active' }, operationId); assert.deepEqual(progress.receipt, repeated.receipt);
  const question = await report('askQuestion', { body: 'Synthetic deferred question', status: 'open' });
  const questionId = question.receipt.result.ids[0]; await report('answerQuestion', { id: questionId, body: 'Synthetic deferred question', answer: 'Verified by acceptance', status: 'answered' });
  const todo = await report('addTodo', { title: 'Synthetic acceptance item', status: 'active' }); await report('completeTodo', { id: todo.receipt.result.ids[0], status: 'complete', done: true });
  await report('updateTask', { id: taskId, title: 'Synthetic reporting task', status: 'complete', startedAt, endedAt: new Date().toISOString() });
  const ids = [taskId, progress.receipt.result.ids[0], questionId];
  const exact = await tool(grant.bridge, 'get_thingtime_agent_task', { externalTaskId: args.externalTaskId, recordIds: ids });
  assert(ids.every(id => exact.records?.some(record => record.id === id)), 'Reporting exact readback includes each requested record');
  assert.equal(exact.records.find(record => record.id === taskId)?.crystal?.status, 'complete');
  assert.equal(exact.records.find(record => record.id === questionId)?.crystal?.answer, 'Verified by acceptance');
  assert.equal(exact.records.find(record => record.id === progress.receipt.result.ids[0])?.crystal?.body, 'Real MCP private milestone');
  assert.equal((await request('/api/v1/things?id=' + encodeURIComponent(taskId), { token: grant.pat, status: null })).response.status, 403, 'Independent reporting grant must not confer generic Things read access');
  for (const id of ids) {
    const read = (await request('/api/v1/things?id=' + encodeURIComponent(id), { cookie: owner.cookie })).data;
    assert.equal(read.thing?.author?.id, prepared.binding.characterId); assert(!read.thing?.acl?.includes('tt:all'));
    for (const cookie of [undefined, stranger.cookie]) { const forbidden = await request('/api/v1/things?id=' + encodeURIComponent(id), { cookie, status: null }); assert([401, 403, 404].includes(forbidden.response.status)); }
  }
  checks.push('saved Actions create and update relational lifecycle, progress, todo and answered question records; receipt reuse is idempotent');
  checks.push('exact source readback confirms Character ownership, owner access, anonymous and stranger refusal');
  await request('/api/v1/subspaces/update', { cookie: owner.cookie, body: { id: workspace.subspaceId, access: 'public' } });
  assert((await mcp(grant.bridge, 'get_thingtime_agent_task', { externalTaskId: args.externalTaskId })).error, 'Reporting refuses a subspace that is no longer private');
  assert((await mcp(grant.bridge, 'report_thingtime_agent_task', { externalTaskId: args.externalTaskId, requestId: randomUUID(), actionName: 'addProgress', inputs: { body: 'Must be refused', status: 'active' } })).error, 'Lifecycle writes refuse changed private-subspace prerequisite');
  await request('/api/v1/subspaces/update', { cookie: owner.cookie, body: { id: workspace.subspaceId, access: 'private' } });
  checks.push('reporting revalidates current private subspace visibility and refuses dependent reads and writes after visibility changes');
  await request('/api/v1/tokens/revoke', { cookie: owner.cookie, body: { id: grant.patId } });
  assert((await mcp(grant.bridge, 'get_thingtime_agent_task', { externalTaskId: args.externalTaskId })).error, 'Revoked upstream grant refuses bridge reads');
  checks.push('upstream token revocation stops private reporting through the real bridge');
  await writeFile(join(evidenceDir, 'agent-reporting-acceptance.json'), JSON.stringify({ passed: true, checks, fixtureSha256: createHash('sha256').update(await readFile(fixturePath)).digest('hex'), source: 'real isolated HTTP + OAuth PKCE + MCP built Nitro', completedAt: new Date().toISOString(), isolation: 'fresh replica set; throwaway accounts and memory-only generated credentials; normal networking; no inherited app env', ports }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, evidence: join(evidenceDir, 'agent-reporting-acceptance.json') }));
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'agent-reporting-acceptance.json'), JSON.stringify({ passed: false, checks, failure: String(error.message).split('\n')[0].slice(0, 250), at: new Date().toISOString() }, null, 2));
  console.error(String(error.message).split('\n')[0].slice(0, 250)); console.error(String(error.stack).split('\n').filter(line => line.includes('agent-reporting-acceptance.mjs:')).join('\n')); process.exitCode = 1;
} finally {
  if (client) await client.close().catch(() => {});
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, 'exit'); try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2500);
    await exited; clearTimeout(timer);
  }
  await rm(dir, { recursive: true, force: true });
}
