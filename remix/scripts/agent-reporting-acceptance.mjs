#!/usr/bin/env node
// Real HTTP and MCP acceptance with a fresh disposable replica set. The only
// direct database commands initialize that set and inspect operation metadata
// during cold registration. Mixed-version checks read physical fence metadata;
// application fixtures and mutations use APIs.
// Saved workspace definitions must be externally authored synthetic fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const configScale = process.argv.includes('--config-scale');
const tokenReactionScale = process.argv.includes('--token-reaction-scale');
const algorithmScale = process.argv.includes('--algorithm-scale');
const collectionsUiOnly = process.argv.includes('--collections-ui-only');
const collectionsScale = process.argv.includes('--relational-collections') || collectionsUiOnly;
const aclScale = process.argv.includes('--acl-scale');
const aclBoundaries = aclScale || process.argv.includes('--acl-boundaries');
const mixedLegacyAcl = process.argv.includes('--mixed-legacy-acl');
const preFloorAcl = process.argv.includes('--prefloor-legacy-acl');
const aclProvisioning = process.argv.includes('--acl-provisioning');
const reconnectOnly = process.argv.includes('--scoped-reconnect') || aclProvisioning;
const fixturePath = process.env.AGENT_REPORTING_AUTHORED_THINGS;
assert(fixturePath || reconnectOnly, 'Set AGENT_REPORTING_AUTHORED_THINGS to an external synthetic saved-workspace JSON fixture, or use --scoped-reconnect');
assert(!fixturePath || !resolve(fixturePath).startsWith(resolve(cwd, '..') + '/'), 'Authored workspace definitions must remain outside the repository');
const authored = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;
const roles = ['project', 'task', 'agent', 'todo', 'progress', 'question'];
assert(reconnectOnly || roles.every(role => authored.schemas?.[role]) && authored.pages?.overview && authored.pages?.taskDetail && authored.actions, 'External fixture must include all private workspace references');
// Keep latency-sensitive replica files on a local filesystem when builds and
// evidence use external scratch (for example an ExFAT archive volume).
const dir = await mkdtemp(join(process.env.AGENT_REPORTING_RUNTIME_TMPDIR || tmpdir(), 'tt-agent-reporting-'));
const evidenceDir = process.env.AGENT_REPORTING_EVIDENCE_DIR || join(tmpdir(), 'thingtime-agent-reporting-evidence');
const checks = [];
const sectionFailures = [];
async function runSection(name, work) {
  console.log(JSON.stringify({ event: 'section-start', name }));
  try {
    await work(); console.log(JSON.stringify({ event: 'section-passed', name }));
  } catch (error) {
    const failure = { name, failure: String(error.message).split('\n')[0].slice(0, 220),
      frames: String(error.stack).split('\n').filter(line => line.includes('.mjs:')).slice(0, 4) };
    sectionFailures.push(failure); console.log(JSON.stringify({ event: 'section-failed', ...failure }));
  }
}
const children = [];
const registrationDiagnostics = [];
const childDiagnostics = { mongo: { errorLines: 0, selectionTimeouts: 0 }, nitro: { errorLines: 0, selectionTimeouts: 0 } };
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
  THINGTIME_CHATGPT_ALLOWED_ENDPOINTS: origin, THINGTIME_DATA_ENV: 'development', THINGTIME_USER_VAULT_KEY: randomBytes(32).toString('base64url') };
// No inherited application configuration, credentials, profile or network rules.
function start(command, args, overrides = {}) {
  const child = spawn(command, args, { cwd: command === process.execPath ? dir : cwd, env: { ...env, ...overrides }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const counters = command === process.execPath ? childDiagnostics.nitro : childDiagnostics.mongo;
  const observe = chunk => {
    // Whitelisted counters only: never retain or emit raw server messages,
    // command bodies, headers, connection URLs or synthetic secret values.
    const lines = chunk.toString('utf8').split('\n');
    for (const line of lines) {
      if (/error|exception|\"s\":\"E\"/i.test(line)) counters.errorLines++;
      if (/MongoServerSelectionError|server selection timed out/i.test(line)) counters.selectionTimeouts++;
    }
  };
  child.stdout.on('data', observe); child.stderr.on('data', observe);
  children.push(child); return child;
}
async function waitFor(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await delay(200); }
  throw Error(`Timed out: ${label}`);
}
async function request(path, { body, cookie, token, form, requestOrigin = origin, targetOrigin = origin, method = body === undefined && !form ? 'GET' : 'POST', status = 200, timeout = 45000 } = {}) {
  const response = await fetch(targetOrigin + path, { method, redirect: 'manual', headers: { Origin: requestOrigin,
    'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
    ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(form ? { body: form.toString() } : body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) }).catch(error => { throw new Error(`${method} ${path.split('?')[0]} failed (${error.name || 'request error'})`); });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = null; }
  // Never place raw response bodies into errors: OAuth/token responses carry secrets.
  if (status !== null) assert.equal(response.status, status, `${method} ${path.split('?')[0]} returned ${response.status}, expected ${status} (${data?.error ? String(data.error).slice(0, 160) : 'non-JSON or no error'})`);
  return { response, data, text, cookie: (response.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ') };
}
const oauthBase = '/api/v1/integrations/chatgpt/oauth';
const resource = origin + '/api/v1/integrations/chatgpt/mcp';
async function oauthAttempt(cookie, scope = 'thingtime offline_access', prior) {
  const callback = prior?.callback || `http://127.0.0.1:${await port()}/callback`;
  const clientId = prior?.clientId || (await request(`${oauthBase}/register`, { body: { redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'Synthetic private reporting acceptance' }, status: 201 })).data.client_id;
  const verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: callback, scope,
    state: randomBytes(32).toString('base64url'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource });
  const path = `${oauthBase}/authorize?` + params;
  const page = await request(path, { cookie });
  const signed = /name="request" value="([^"]+)"/.exec(page.text)?.[1]; assert(signed, 'OAuth form must contain a signed request');
  const exchange = async (code, overrides = {}, status = 200) => (await request(`${oauthBase}/token`, { form: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback, code, code_verifier: verifier, resource, ...overrides }), status })).data;
  return { signed, callback, clientId, authorizeUrl: origin + path, exchange, state: params.get('state'), page: page.text };
}
async function oauth(cookie, scopes) {
  const attempt = await oauthAttempt(cookie);
  const { signed } = attempt;
  const form = new URLSearchParams({ request: signed, intent: 'prepare', endpoint: origin }); scopes.forEach(scope => form.append('scope', scope));
  const prepared = (await request('/api/v1/integrations/chatgpt/oauth/authorize', { cookie, form })).data;
  const complete = (await request('/api/v1/integrations/chatgpt/oauth/authorize', { cookie, form: new URLSearchParams({ request: signed, intent: 'complete', label: 'Synthetic reporting owner', endpoint: origin, token: prepared.token }) })).data;
  const code = new URL(complete.redirectUri).searchParams.get('code');
  const exchange = await attempt.exchange(code);
  assert(exchange.access_token, 'Real PKCE exchange must return an MCP bearer');
  return { ...attempt, bridge: exchange.access_token, refresh: exchange.refresh_token, pat: prepared.token, patId: prepared.tokenId };
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
async function browserScopedConsent(cookie, attempt, username) {
  const modulePath = process.env.AGENT_REPORTING_PLAYWRIGHT_MODULE;
  const executablePath = process.env.AGENT_REPORTING_CHROMIUM_EXECUTABLE;
  if (!modulePath && !executablePath) return null;
  assert(modulePath && executablePath, 'Set both isolated Playwright and Chromium executable paths');
  const { chromium } = await import(modulePath);
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => { const index = pair.indexOf('='); return { name: pair.slice(0,index), value: pair.slice(index+1), url: origin }; }));
    const page = await context.newPage();
    await page.route(`${attempt.callback}?**`, route => route.fulfill({ status: 200, body: 'Synthetic OAuth callback received' }));
    for (const [name, width, height] of [['desktop',1440,960],['mobile',390,844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(attempt.authorizeUrl, { waitUntil: 'domcontentloaded' });
      await page.getByText(`Signed in as @${username}`, { exact: false }).waitFor();
      assert(await page.getByText('Private agent reporting', { exact: true }).isVisible());
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      await page.getByText('Optional access rules').click();
      assert.equal(await page.locator('input[value="things"]').isChecked(), false);
      await page.evaluate(async () => { for(let y=0;y<document.documentElement.scrollHeight;y+=Math.max(200,innerHeight-80)){scrollTo(0,y);await new Promise(r=>setTimeout(r,20));}scrollTo(0,document.documentElement.scrollHeight); });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Consent page must have no horizontal overflow');
      await page.screenshot({ path: join(evidenceDir, `scoped-consent-${name}.png`), fullPage: true });
    }
    const callback = page.waitForURL(`${attempt.callback}?**`);
    await page.getByRole('button', { name: 'Connect Thingtime' }).click();
    await callback;
    checks.push('isolated Chromium consent at desktop/mobile: identity, requested permission, optional Things unchecked, expanded content and one real approval click');
    return new URL(page.url());
  } finally { await browser.close(); }
}
let rpcId = 0;
async function mcp(token, name, args) {
  const started = Date.now();
  const { data } = await request('/api/v1/integrations/chatgpt/mcp', { token, body: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } } });
  assert(data?.result, 'MCP must return a JSON-RPC tool result');
  const result = data.result;
  const value = result.structuredContent || (() => { try { return JSON.parse(result.content?.find(c => c.type === 'text')?.text || '{}'); } catch { return {}; } })();
  if (value.status >= 500) console.log(JSON.stringify({ event: 'mcp-upstream-failure', name, status: value.status, elapsedMs: Date.now() - started }));
  else if (name === 'prepare_thingtime_agent_task' && Date.now() - started >= 5000)
    console.log(JSON.stringify({ event: 'slow-workspace-prepare', externalTaskId: args.externalTaskId, elapsedMs: Date.now() - started, status: value.status || 200 }));
  return { error: result.isError || !!value.error, value, challenge: result._meta?.['mcp/www_authenticate']?.[0] };
}
async function tool(token, name, args) {
  const result = await mcp(token, name, args);
  if (result.error && result.value.status >= 500 && ['report_thingtime_agent_task', 'coordinate_thingtime_agent_task'].includes(name)) {
    // An uncertain write is inspected once, never resubmitted. Keep output to
    // receipt metadata; no private record fields or returned credentials.
    const inspected = await mcp(token, 'get_thingtime_agent_task', { accountId: args.accountId, externalTaskId: args.externalTaskId }).catch(() => null);
    const state = inspected?.value?.result || inspected?.value;
    console.log(JSON.stringify({ event: 'uncertain-report-receipt', requestId: args.requestId,
      readStatus: inspected ? inspected.error ? state?.status || 'refused' : 'ok' : 'unavailable',
      activeOperation: state?.activeOperation ? { requestId: state.activeOperation.requestId, status: state.activeOperation.status } : null }));
  }
  assert(!result.error, `${name} refused (${String(result.value.error || 'tool error').slice(0, 180)})`);
  return result.value.result || result.value;
}
async function verifyCoordination(bridge, identity, subspaceId, owner, stranger) {
  const args = { ...identity, requestId: randomUUID(), title: 'Synthetic task coordination', text: 'Private acceptance started', renderComponent: { render: { tag: 'p', children: ['{text}'] } } };
  const coordinated = await tool(bridge, 'coordinate_thingtime_agent_task', args);
  const postId = coordinated.binding.coordinationPostId; assert(postId, 'Coordination returns a saved post ID');
  assert.deepEqual((await tool(bridge, 'coordinate_thingtime_agent_task', args)).receipt, coordinated.receipt);
  const updated = await tool(bridge, 'coordinate_thingtime_agent_task', { ...args, requestId: randomUUID(), text: 'Private acceptance updated' });
  assert.equal(updated.binding.coordinationPostId, postId, 'Coordination updates the existing post');
  const read = await tool(bridge, 'get_thingtime_agent_task', identity);
  assert.equal(read.coordinationPost?.id, postId); assert.equal(read.coordinationPost?.crystal?.text, 'Private acceptance updated');
  assert.equal(read.coordinationPost?.author?.id, coordinated.binding.characterId);
  assert.equal(read.activeOperation, null);
  const path = '/api/v1/things?id=' + encodeURIComponent(postId);
  const { data: exact } = await request(path, { cookie: owner.cookie });
  assert.equal(exact.post?.subspace?.id, subspaceId);
  assert.equal(exact.post?.subspace?.access, 'private');
  assert.equal(exact.post?.subspace?.viewerRole, 'owner');
  assert.deepEqual(exact.thing?.crystal?.renderComponent?.render, args.renderComponent.render);
  for (const cookie of [undefined, stranger.cookie]) {
    const denied = await request(path, { cookie, status: null });
    assert.equal(denied.response.status, 404); assert(!denied.data?.thing && !denied.data?.post);
  }
  checks.push('one Character-authored rendered coordination post retains the exact private subspace and is hidden from anonymous and outsider callers');
}

async function scopedReconnect(owner, stranger, plain) {
  const old = await tool(plain.bridge, 'list_thingtime_accounts', {});
  const accountId = old.defaultAccountId;
  const requestArgs = { accountId, externalTaskId: 'scoped-oauth-acceptance' };
  const refusal = await mcp(plain.bridge, 'get_thingtime_agent_task', requestArgs);
  assert(refusal.error); assert.equal(refusal.value.status, 403);
  assert.match(refusal.challenge, /error="insufficient_scope"/);
  assert.equal((await mcp(plain.bridge, 'login_thingtime', { accountId, requiredScopes: ['agents.report'] })).challenge, refusal.challenge);
  const scope = /scope="([^"]+)"/.exec(refusal.challenge)?.[1];
  assert.equal(scope, 'thingtime offline_access agents.report');
  const metadata = (await request('/.well-known/oauth-authorization-server')).data;
  assert.equal(metadata.issuer, origin); assert(metadata.scopes_supported.includes('agents.report'));
  assert(!(await request('/.well-known/oauth-protected-resource')).data.scopes_supported.includes('agents.report'));
  const refresh = async (token, override, status = 200) => (await request(`${oauthBase}/token`, { form: new URLSearchParams({ grant_type: 'refresh_token', client_id: plain.clientId, refresh_token: token, resource, ...override }), status })).data;
  assert.equal((await refresh(plain.refresh, { scope }, 400)).error, 'invalid_scope');
  const baseRefresh = await refresh(plain.refresh, {});
  assert.equal(baseRefresh.scope, 'thingtime offline_access');
  const listPatIds = async () => (await request('/api/v1/tokens', { cookie: owner.cookie })).data.tokens.map(token => token.id).sort();
  const before = await listPatIds();
  const consent = (signed, intent, cookie = owner.cookie, status = 200, requestOrigin = origin) => request(`${oauthBase}/authorize`, { cookie, status, requestOrigin, form: new URLSearchParams({ request: signed, intent }) });
  const cancelled = await oauthAttempt(owner.cookie, scope, plain);
  const preCancel = (await consent(cancelled.signed, 'prepare')).data;
  assert(!('token' in preCancel));
  const cancelledCallback = new URL((await consent(preCancel.request, 'cancel')).data.redirectUri);
  assert.equal(cancelledCallback.searchParams.get('error'), 'access_denied');
  assert.equal(cancelledCallback.searchParams.get('state'), cancelled.state);
  assert.equal(cancelledCallback.searchParams.has('code'), false);
  await consent(preCancel.request, 'complete', owner.cookie, 409);
  assert.deepEqual(await listPatIds(), before);

  const signedOut = await oauthAttempt(owner.cookie, scope, plain);
  const rejected = new URL((await consent(signedOut.signed, 'cancel', '')).data.redirectUri);
  assert.equal(rejected.searchParams.get('error'), 'access_denied');
  await consent(signedOut.signed, 'prepare', owner.cookie, 409);

  const upgrade = await oauthAttempt(owner.cookie, scope, plain);
  assert.match(upgrade.page, /Requested permissions[\s\S]*Private agent reporting/);
  const prepared = (await consent(upgrade.signed, 'prepare')).data;
  assert(!('token' in prepared));
  assert.equal(prepared.username, owner.data.user.username);
  await consent(upgrade.signed, 'complete', owner.cookie, 400);
  await consent(prepared.request, 'complete', stranger.cookie, 409);
  const crossOrigin = await consent(prepared.request, 'complete', owner.cookie, null, 'https://other.invalid');
  assert([400, 403].includes(crossOrigin.response.status), 'Cross-origin approval is refused by ingress or the handler');
  assert.deepEqual(await listPatIds(), before);
  const callback = await browserScopedConsent(owner.cookie, upgrade, prepared.username) || new URL((await consent(prepared.request, 'complete')).data.redirectUri);
  assert.equal(callback.searchParams.get('state'), upgrade.state);
  assert.equal(callback.searchParams.get('iss'), origin);
  const code = callback.searchParams.get('code'); assert(code);
  await consent(prepared.request, 'complete', owner.cookie, 409);
  await consent(upgrade.signed, 'prepare', owner.cookie, 409);
  const spentPage = new URL(upgrade.authorizeUrl);
  spentPage.searchParams.set('scope', 'offline_access agents.report thingtime');
  await request(spentPage.pathname + spentPage.search, { cookie: owner.cookie, status: 409 });
  assert.equal((await upgrade.exchange(code, { code_verifier: randomBytes(48).toString('base64url') }, 400)).error, 'invalid_grant');
  assert.equal((await upgrade.exchange(code, { resource: 'https://other.invalid/api/v1/integrations/chatgpt/mcp' }, 400)).error, 'invalid_grant');
  assert.deepEqual(await listPatIds(), before);
  const exchanged = await upgrade.exchange(code);
  assert.equal(exchanged.scope, scope); assert(exchanged.access_token && exchanged.refresh_token);
  assert.equal((await upgrade.exchange(code, {}, 400)).error, 'invalid_grant');
  const minted = (await listPatIds()).filter(id => !before.includes(id));
  assert.equal(minted.length, 1);
  const rotated = await refresh(exchanged.refresh_token, { scope });
  assert.equal(rotated.scope, scope);
  assert.equal((await refresh(exchanged.refresh_token, {}, 400)).error, 'invalid_grant');
  assert.deepEqual(await tool(baseRefresh.access_token, 'list_thingtime_accounts', {}), old, 'New authorization must preserve the old grant');
  assert((await mcp(baseRefresh.access_token, 'get_thingtime_agent_task', requestArgs)).error);
  const linked = await tool(rotated.access_token, 'list_thingtime_accounts', {});
  assert.notEqual(linked.defaultAccountId, accountId);
  assert.equal(linked.accounts.length, 1);
  const profile = await tool(rotated.access_token, 'get_thingtime_profile', { accountId: linked.defaultAccountId });
  assert.equal(profile.user.id, owner.data.user.id);
  assert.deepEqual(profile.token.scopes, ['agents.report']);
  assert.equal(linked.accounts[0].endpoint, origin);
  assert((await mcp(rotated.access_token, 'get_thingtime_agent_task', requestArgs)).error, 'Old account id must not silently fall back to the new account');
  const refusedWrite = await mcp(rotated.access_token, 'prepare_thingtime_agent_task', { externalTaskId: 'wrong-implicit-default' });
  assert.match(refusedWrite.value.error, /verified connected accountId/);
  const missing = await mcp(rotated.access_token, 'get_thingtime_agent_task', { ...requestArgs, accountId: linked.defaultAccountId });
  assert.match(missing.value.error, /Prepare this stable task identity first/);
  checks.push('real native-style scope challenge, explicit consent, cancel and wrong browser/origin refusal, PKCE/replay fencing, single PAT, rotation, least privilege and unchanged old grant');
  return { bridge: rotated.access_token, refresh: rotated.refresh_token, patId: minted[0], accountId: linked.defaultAccountId, refreshGrant: refresh };
}
async function verifyAlgorithmScale(owner, stranger) {
  const created = [];
  for (let n = 0; n < 51; n++) {
    const name = `Synthetic interest profile ${n} ` + 'full name '.repeat(9);
    const description = 'Synthetic description '.repeat(20);
    const result = (await request('/api/v1/algorithms', { cookie: owner.cookie, body: { name, description } })).data;
    assert(result.algorithm?.id); assert.equal(result.algorithm.name, name.trim()); assert.equal(result.algorithm.description, description.trim());
    created.push(result.algorithm.id);
  }
  const listed = (await request('/api/v1/algorithms', { cookie: owner.cookie })).data.algorithms;
  assert(created.every(id => listed.some(entry => entry.id === id)));
  assert.equal((await request('/api/v1/algorithms', { cookie: stranger.cookie })).data.algorithms.length, 0);
  const weights = { types: { text: 1 }, tags: Object.fromEntries(Array.from({ length: 10001 }, (_, n) => [`interest-${n}`, 1])), authors: {} };
  const manifest = { format: 'thingtime.transfer', version: 1, roots: ['synthetic-profile'], files: [], things: [{ id: 'synthetic-profile', thingtime: ['feed-algorithm'],
    crystal: { name: 'Imported complete synthetic profile', emoji: '🧠', weights, eventCount: 0, lastTrainedAt: null } }] };
  const imported = (await request('/api/v1/things/import', { cookie: owner.cookie, body: { manifest } })).data;
  assert(imported.ok); const id = imported.roots[0]; assert(id);
  const exported = (await request('/api/v1/things/export', { cookie: owner.cookie, body: { ids: [id] } })).data;
  const profile = exported.plan.things.find(thing => thing.id === id);
  assert.deepEqual(profile.crystal.weights, weights);
  const foreign = await request('/api/v1/things/export', { cookie: stranger.cookie, body: { ids: [id] }, status: null });
  assert(foreign.response.status >= 400 && foreign.data?.ok === false);
  await request('/api/v1/algorithms/update', { cookie: owner.cookie, body: { id, name: 'Preserved learned profile after metadata edit', shared: true } });
  const copied = (await request('/api/v1/algorithms', { cookie: stranger.cookie, body: { name: 'Authorized synthetic branch', branchFrom: id } })).data.algorithm;
  assert(copied?.id);
  const branch = (await request('/api/v1/things/export', { cookie: stranger.cookie, body: { ids: [copied.id] } })).data.plan.things.find(thing => thing.id === copied.id);
  assert.deepEqual(branch.crystal.weights, weights);
  checks.push('51 algorithms and10001 imported relational weights roundtrip through owner export, metadata edits and explicitly consented branching; foreign export refuses');
  const post = (await request('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['post'], crystal: { type: 'text', text: 'Synthetic algorithm training fixture' }, acl: ['tt:user'] } })).data;
  const postId = post.post?.id || post.thing?.id || post.id; assert(postId);
  const trained = (await request('/api/v1/algorithms/track', { cookie: owner.cookie, body: { algorithmId: id, events: Array.from({ length: 101 }, () => ({ thingId: postId, signal: 'view' })) } })).data;
  assert.equal(trained.applied, 101); assert.equal(trained.eventCount, 101);
  const after = (await request('/api/v1/things/export', { cookie: owner.cookie, body: { ids: [id] } })).data.plan.things.find(thing => thing.id === id);
  assert.equal(Object.keys(after.crystal.weights.tags).length, 10001);
  await request('/api/v1/algorithms/delete', { cookie: owner.cookie, body: { id } });
  assert(!(await request('/api/v1/algorithms', { cookie: owner.cookie })).data.algorithms.some(entry => entry.id === id));
  checks.push('51 algorithms and10001 relational learned weights survive real HTTP creation, import/export, metadata edits, consented branching and deletion;101 events apply without truncation and foreign export refuses');
}

async function verifyAccountConfigurationScale(owner, stranger) {
  const endpointIds = [];
  for (let n = 0; n < 21; n++) {
    const url = `mongodb://127.0.0.1:${ports.db}/config_fixture_${n}?replicaSet=agentreporting`;
    const name = `Synthetic endpoint ${n} ` + 'descriptive '.repeat(9);
    const saved = await request('/api/v1/mongodb/endpoints', { cookie: owner.cookie, body: { name, url } });
    assert(saved.data.endpoint?.id); assert.equal(saved.data.endpoint.name, name.trim());
    assert(!Object.hasOwn(saved.data.endpoint, 'url')); assert(!saved.text.includes(url));
    endpointIds.push(saved.data.endpoint.id);
  }
  const endpoints = (await request('/api/v1/mongodb/endpoints', { cookie: owner.cookie })).data;
  assert.equal(endpoints.endpoints.length, 21); assert(endpoints.endpoints.every(entry => !Object.hasOwn(entry, 'url')));
  const strangerEndpoints = (await request('/api/v1/mongodb/endpoints', { cookie: stranger.cookie })).data;
  assert.equal(strangerEndpoints.endpoints.length, 0);
  const selected = await request('/api/v1/mongodb/endpoint', { cookie: owner.cookie, body: { savedId: endpointIds[20] } });
  assert.equal(selected.data.endpoint.savedId, endpointIds[20]);
  await request('/api/v1/mongodb/endpoints', { cookie: owner.cookie, method: 'DELETE', body: { id: endpointIds[0] } });
  assert.equal((await request('/api/v1/mongodb/endpoints', { cookie: owner.cookie })).data.endpoints.length, 20);
  checks.push('21 saved Mongo endpoints survive real HTTP save/list/selected activation/deletion, long names stay exact, other accounts and raw URLs remain private');

  // This is an independent local synthetic remote HTTP contract, with generated
  // memory-only bearer values. It does not claim real provider acceptance.
  const remote = createHttpServer((req, res) => {
    const token = req.headers.authorization || '';
    const identity = createHash('sha256').update(token).digest('hex').slice(0, 24);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/me') res.end(JSON.stringify({ ok: true, user: { id: identity, username: `synthetic${identity}`, displayName: 'Synthetic remote' } }));
    else if (req.url === '/api/v1/logout') res.end(JSON.stringify({ ok: true }));
    else { res.statusCode = 404; res.end(JSON.stringify({ ok: false })); }
  });
  await new Promise((resolve, reject) => { remote.once('error', reject); remote.listen(0, '127.0.0.1', resolve); });
  let waited = false;
  try {
    const baseUrl = `http://127.0.0.1:${remote.address().port}`;
    const links = [];
    for (let n = 0; n < 11; n++) {
      const token = randomBytes(32).toString('base64url');
      const body = { baseUrl, name: `Synthetic remote ${n}`, token, syncMode: 'off' };
      let response = await request('/api/v1/deployment-links', { cookie: owner.cookie, body, status: null });
      if (response.response.status === 429 && !waited) {
        const seconds = Number(response.response.headers.get('Retry-After'));
        assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 305);
        waited = true;
        console.log(JSON.stringify({ event: 'waiting-for-deployment-rate-window', seconds }));
        await delay(seconds * 1000 + 500);
        response = await request('/api/v1/deployment-links', { cookie: owner.cookie, body, status: null });
      }
      assert.equal(response.response.status, 201, 'Synthetic deployment link creation');
      assert(!Object.hasOwn(response.data.link, 'token')); assert(!response.text.includes(token));
      links.push(response.data.link);
    }
    assert.equal((await request('/api/v1/deployment-links', { cookie: owner.cookie })).data.links.length, 11);
    assert.equal((await request('/api/v1/deployment-links', { cookie: stranger.cookie })).data.links.length, 0);
    const pathRules = Array.from({ length: 70 }, (_, n) => ({ path: `things/synthetic-kind-${n}`, mode: 'push' }));
    const patched = (await request('/api/v1/deployment-links', { cookie: owner.cookie, method: 'PATCH', body: { id: links[0].id, pathRules } })).data;
    assert.equal(patched.link.pathRules.length, 70);
    const reloaded = (await request('/api/v1/deployment-links', { cookie: owner.cookie })).data.links.find(link => link.id === links[0].id);
    assert.deepEqual(reloaded.pathRules, pathRules); assert(!Object.hasOwn(reloaded, 'token'));
    await request('/api/v1/deployment-links', { cookie: owner.cookie, method: 'PATCH', body: { id: links[0].id, pathRules: [] } });
    assert.equal((await request('/api/v1/deployment-links', { cookie: owner.cookie })).data.links.find(link => link.id === links[0].id).pathRules.length, 0);
    checks.push('11 deployment links and70 relational rules roundtrip through real HTTP with an independent synthetic remote; deletion stays empty, tokens never project, rate controls remain enabled');
  } finally { await new Promise(resolve => remote.close(resolve)); }
}

let client;
let diagnosticClient;
try {
  await access(join(cwd, '.output/server/index.mjs')); await mkdir(join(dir, 'db')); await mkdir(evidenceDir, { recursive: true });
  start(process.env.MONGOD_PATH || '/opt/homebrew/bin/mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'agentreporting', '--nounixsocket']);
  client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await client.connect(); return true; } catch { return false; } }, 'disposable Mongo startup');
  await client.db('admin').command({ replSetInitiate: { _id: 'agentreporting', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  await waitFor(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await client.close(); client = null;
  const server = start(process.execPath, [join(cwd, '.output/server/index.mjs')]);
  await waitFor(async () => { assert(server.exitCode === null, 'Disposable Nitro server exited'); try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }, 'built Nitro HTTP server');
  const manifest = (await request('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, origin);
  for (const [feature, minimum] of Object.entries({ 'api.agent-reporting': '1.2.0', ...(aclScale ? { 'api.things-acl': '1.0.0' } : {}), ...(configScale ? { 'api.mongodb-endpoint': '1.2.0', 'api.mongodb-endpoints': '1.1.0', 'api.deployment-links': '1.1.0' } : {}), 'api.agent-overview': '2.0.0', 'api.auth-characters': '1.0.0', 'api.chatgpt-mcp': '2.2.0', 'api.chatgpt-oauth-authorize': '1.3.0', 'api.chatgpt-oauth-token': '1.1.0' })) {
    const version = manifest.features?.[feature]?.version;
    const [major, minor, patch] = (version || '').split('.').map(Number);
    const [expectedMajor, minMinor, minPatch] = minimum.split('.').map(Number);
    assert(major === expectedMajor && (minor > minMinor || (minor === minMinor && patch >= minPatch)), `Built manifest ${feature}: got ${version}, expected compatible ${minimum}`);
  }
  const pluginManifest = (await request('/.well-known/thingtime-chatgpt-capabilities.json')).data;
  assert.equal(pluginManifest.origin, origin); assert.equal(pluginManifest.features['chatgpt.oauth'], '1.12.0');
  checks.push('built Nitro origin advertises reporting, overview and Character contracts');
  const register = async prefix => request('/api/v1/auth/register', { body: { username: prefix + randomBytes(6).toString('hex'), email: `${prefix}${randomUUID()}@example.invalid`, password: randomBytes(32).toString('hex') }, timeout: 120000 });
  console.log(JSON.stringify({ event: 'registration-start', freshReplica: true }));
  diagnosticClient = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
  await diagnosticClient.connect();
  let diagnosticsActive = true;
  const diagnose = (async () => {
    while (diagnosticsActive) {
      // Never retain command arguments, namespace, document contents or values.
      const operations = await diagnosticClient.db('admin').command({ currentOp: 1, active: true }).catch(() => null);
      const summary = {};
      for (const op of operations?.inprog || []) {
        if (op.appName !== 'thingtime-api') continue;
        const command = ['createIndexes', 'listIndexes', 'find', 'aggregate', 'insert', 'update', 'commitTransaction', 'hello'].find(name => Object.hasOwn(op.command || {}, name)) || 'other';
        const entry = summary[command] ||= { count: 0, maxSeconds: 0, waitingForLock: 0 };
        entry.count++; entry.maxSeconds = Math.max(entry.maxSeconds, Number(op.secs_running) || 0);
        if (op.waitingForLock) entry.waitingForLock++;
      }
      const sample = { elapsedSeconds: registrationDiagnostics.length * 10, operations: summary };
      registrationDiagnostics.push(sample); console.log(JSON.stringify({ event: 'registration-operations', ...sample }));
      for (let n = 0; n < 10 && diagnosticsActive; n++) await delay(1000);
    }
  })();
  let owner, stranger;
  try { owner = await register('reportowner'); stranger = await register('reportstranger'); }
  finally { diagnosticsActive = false; await diagnose; await diagnosticClient.close(); diagnosticClient = null; }
  console.log(JSON.stringify({ event: 'registration-complete' }));
  const selectedOrigin = (await request('/api/v1/mongodb/endpoint', { cookie: owner.cookie })).data;
  assert.equal(selectedOrigin.defaultHost, `127.0.0.1:${ports.db}`);
  assert.equal(selectedOrigin.endpoint.custom, false);
  checks.push('standalone server runs from a fresh synthetic cwd with explicit disposable home Mongo host, no active data override and generated-only environment credentials');
  if (aclProvisioning) {
    const { runAclProvisioningAcceptance } = await import('./acl-validator-provisioning-acceptance.mjs');
    await runAclProvisioningAcceptance({ request, owner, stranger, checks, env, start, port, waitFor, cwd, ports });
  } else {
  if (preFloorAcl) await runSection('pre-floor-relational-ACL-upgrade', async () => {
    const { runPreFloorAclAcceptance } = await import('./relational-acl-prefloor-acceptance.mjs');
    await runPreFloorAclAcceptance({ request, owner, stranger, checks, evidenceDir, env, start, port, waitFor, MongoClient });
  });
  if (mixedLegacyAcl) await runSection('mixed-legacy-ACL-write-fence', async () => {
    const { runMixedLegacyAclAcceptance } = await import('./relational-acl-legacy-acceptance.mjs');
    await runMixedLegacyAclAcceptance({ request, owner, stranger, checks, evidenceDir, dir, env, start, port, waitFor, MongoClient });
  });
  const create = async (kind, crystal) => { const data = (await request('/api/v1/things', { cookie: owner.cookie, body: { thingtime: [kind], acl: ['tt:user'], crystal } })).data; assert(data.thing?.id || data.id, `Saved ${kind} returned an ID`); return data.thing?.id || data.id; };
  const plain = await oauth(owner.cookie, ['things']);
  const upgraded = await scopedReconnect(owner, stranger, plain);
  if (configScale) await runSection('account-configuration', () => verifyAccountConfigurationScale(owner, stranger));
  if (algorithmScale) await runSection('algorithm-profiles', () => verifyAlgorithmScale(owner, stranger));
  if (collectionsScale) await runSection('relational-collections', async () => {
    const { runRelationalCollectionsAcceptance } = await import('./relational-collections-acceptance.mjs');
    await runRelationalCollectionsAcceptance({ request, owner, stranger, origin, ports, checks, evidenceDir, targetedUi: collectionsUiOnly, skipOwnershipScale: process.argv.includes('--skip-ownership-scale') });
  });
  if (tokenReactionScale) await runSection('token-grants-and-reactions', async () => {
    const { runTokenReactionAcceptance } = await import('./relational-token-reaction-acceptance.mjs');
    await runTokenReactionAcceptance({ request, owner, stranger, checks, origin, evidenceDir });
  });
  if (reconnectOnly) {
    const syntheticWorkspace = { pages: {}, schemas: {}, actions: {} };
    for (const role of ['overview', 'taskDetail']) syntheticWorkspace.pages[role] = await create('webpage', { name: `OAuth test ${role}`, blocks: [{ id: 'label', type: 'text', text: 'Synthetic OAuth acceptance' }] });
    for (const role of roles) syntheticWorkspace.schemas[role] = await create('schema', { name: `oauth-acceptance-${role}`, fields: [{ name: 'title', type: 'string' }] });
    syntheticWorkspace.actions.createTask = await create('action', { name: 'Create synthetic task', inputs: [{ name: 'title', type: 'string', required: true }], steps: [
      { op: 'things.create', schema: syntheticWorkspace.schemas.task, values: { title: '$input.title' } }, { op: 'return', value: '$step.1' }
    ], capabilities: [{ capability: 'things.create', schemas: [syntheticWorkspace.schemas.task] }] });
    const space = (await request('/api/v1/subspaces', { cookie: owner.cookie, body: { name: 'OAuth test space', slug: `oauth-test-${randomBytes(6).toString('hex')}`, access: 'private' }, status: 201 })).data;
    syntheticWorkspace.subspaceId = space.subspace?.id; assert(syntheticWorkspace.subspaceId);
    const identity = { externalTaskId: 'scoped-oauth-acceptance', accountId: upgraded.accountId };
    const prepared = await tool(upgraded.bridge, 'prepare_thingtime_agent_task', { ...identity, displayName: 'Synthetic OAuth reporter', workspace: syntheticWorkspace });
    assert(prepared.binding?.characterId && prepared.binding.characterId !== owner.data.user.id);
    if (aclBoundaries) await runSection('relational-ACL-boundaries', async () => {
      const createAudience = async acl => {
        const result = await request('/api/v1/things', { cookie: owner.cookie,
          body: { thingtime: ['data'], acl, crystal: { name: 'Synthetic ACL boundary' } } });
        assert(result.data.thing?.id); return result.data.thing;
      };
      const publicThing = await createAudience(['tt:all']);
      const allowedPublicReader = await register('allowedreader');
      const excluded = `-tt:user/${stranger.data.user.username}`;
      await request('/api/v1/things/acl', { cookie: owner.cookie,
        body: { id: publicThing.id, operation: 'add', entries: [excluded] } });
      const readAudience = (id, options = {}) => request('/api/v1/things?id=' + encodeURIComponent(id), options);
      await readAudience(publicThing.id);
      await readAudience(publicThing.id, { cookie: allowedPublicReader.cookie });
      await readAudience(publicThing.id, { cookie: stranger.cookie, status: 404 });
      await request('/api/v1/things/update', { cookie: owner.cookie,
        body: { id: publicThing.id, crystal: { name: 'Edited public relational audience' } } });
      const publicRead = (await readAudience(publicThing.id, { cookie: owner.cookie })).data.thing;
      assert(publicRead.acl.includes('tt:all') && publicRead.acl.includes(excluded));
      await readAudience(publicThing.id); await readAudience(publicThing.id, { cookie: stranger.cookie, status: 404 });
      await readAudience(publicThing.id, { cookie: allowedPublicReader.cookie });
      const privateExcluded = await createAudience(['tt:user', '-tt:all']);
      await request('/api/v1/things/acl', { cookie: owner.cookie,
        body: { id: privateExcluded.id, operation: 'add', entries: ['tt:user/synthetic-private-reader'] } });
      const mintVisibilityToken = async visibility => (await request('/api/v1/tokens', {
        cookie: owner.cookie, status: 201, body: { name: `Synthetic ${visibility} ACL query`,
          scopes: ['things.read'], visibility, onlyCreatedThings: false, allowGet: true }
      })).data.token;
      const privateToken = await mintVisibilityToken('private');
      const publicToken = await mintVisibilityToken('public');
      assert(privateToken && publicToken, 'Disposable visibility tokens were issued');
      await readAudience(privateExcluded.id, { token: privateToken });
      const privateList = (await request('/api/v1/things?thingtime=data&limit=50', { token: privateToken })).data.things;
      assert(privateList.some(thing => thing.id === privateExcluded.id), 'Negative public marker remains discoverable with a private-only token');
      assert(!privateList.some(thing => thing.id === publicThing.id), 'Private-only token excludes a positive public audience');
      const publicList = (await request('/api/v1/things?thingtime=data&limit=50', { token: publicToken })).data.things;
      assert(publicList.some(thing => thing.id === publicThing.id), 'Public-only token retains a positive public audience');
      assert(!publicList.some(thing => thing.id === privateExcluded.id), 'Public-only token excludes the negative-only public marker');
      checks.push('built HTTP visibility-filtered tokens distinguish signed relational baseline markers in exact reads and database listings');
      const hidden = await createAudience(['tt:hidden']); assert(hidden.linkKey);
      await request('/api/v1/things/acl', { cookie: owner.cookie,
        body: { id: hidden.id, operation: 'add', entries: ['tt:user/synthetic-hidden-reader'] } });
      // Canonical exact IDs are the current unlisted capability; hidden roots
      // stay out of ordinary discovery, while legacy keyed URLs still work.
      await readAudience(hidden.id);
      await request('/api/v1/things?thingtime=data&limit=50', { status: 401 });
      const ordinaryList = (await request('/api/v1/things?thingtime=data&limit=50', { cookie: allowedPublicReader.cookie })).data;
      assert(!ordinaryList.things.some(thing => thing.id === hidden.id), 'Unlisted root stays out of ordinary discovery');
      const hiddenPath = '/api/v1/things?' + new URLSearchParams({ id: hidden.id, key: hidden.linkKey });
      await request(hiddenPath);
      await request('/api/v1/things/update', { cookie: owner.cookie,
        body: { id: hidden.id, crystal: { name: 'Edited hidden relational audience' } } });
      await request(hiddenPath); await readAudience(hidden.id);
      const hiddenRead = (await readAudience(hidden.id, { cookie: owner.cookie })).data.thing;
      assert(hiddenRead.acl.includes('tt:hidden') && hiddenRead.acl.includes('tt:user/synthetic-hidden-reader'));
      assert(hiddenRead.linkKey === hidden.linkKey, 'Hidden link identity survives the generic edit');
      await request('/api/v1/things/update', { cookie: owner.cookie,
        body: { id: hidden.id, acl: ['tt:user'], expectedAclRevision: hiddenRead.aclRevision } });
      await readAudience(hidden.id, { status: 404 }); await request(hiddenPath, { status: 404 });
      const custom = await createAudience(['tt:user']);
      const writer = `tt:user/${stranger.data.user.username}/write`;
      await request('/api/v1/things/acl', { cookie: owner.cookie,
        body: { id: custom.id, operation: 'add', entries: ['tt:custom', writer] } });
      await readAudience(custom.id, { cookie: stranger.cookie });
      await request('/api/v1/things/update', { cookie: stranger.cookie,
        body: { id: custom.id, crystal: { name: 'Authorized custom capability edit' } } });
      await request('/api/v1/things/acl', { cookie: owner.cookie,
        body: { id: custom.id, operation: 'remove', entries: [writer] } });
      await request('/api/v1/things/update', { cookie: stranger.cookie, status: 404,
        body: { id: custom.id, crystal: { name: 'Revoked capability must refuse' } } });
      checks.push('built HTTP relational ACL preserves anonymous/allowed-user public access, explicit exclusion, hidden-link proof, direct custom write/revoke and ordinary crystal edits without dropping audience or rotating link identity');
    });
    if (aclScale) await runSection('large-workspace-ACL', async () => {
      // Exercise the real saved-workspace path beyond the former 64-entry cap.
      // Distinct batches concurrently grant the same references; each task must
      // still read its exact refs after all later grants have committed.
      const preparedTasks = [];
      let conflictRetries = 0;
      const prepareWorkspaceTask = async (args) => {
        let result = await mcp(upgraded.bridge, 'prepare_thingtime_agent_task', args);
        if (result.error && result.value.status === 409 && result.value.error === 'Reporting reference access changed while it was being read; retry the same task request') {
          conflictRetries++;
          console.log(JSON.stringify({ event: 'workspace-prepare-conflict-retry', externalTaskId: args.externalTaskId, attempt: 1 }));
          await delay(250);
          result = await mcp(upgraded.bridge, 'prepare_thingtime_agent_task', args);
        }
        assert(!result.error, `prepare_thingtime_agent_task refused status=${result.value.status || 'unknown'} (${String(result.value.error || 'tool error').slice(0, 180)})`);
        return result.value.result || result.value;
      };
      for (let n = 0; n < 2; n++) {
        preparedTasks.push(await prepareWorkspaceTask({ accountId: upgraded.accountId,
          externalTaskId: `shared-workspace-scale-${n}`, displayName: `Synthetic workspace reporter ${n}`, workspace: syntheticWorkspace }));
        console.log(JSON.stringify({ event: 'workspace-prepare-sequential', taskIndex: n, passed: true }));
      }
      for (let offset = 2; offset < 70; offset += 5) {
        const batch = await Promise.all(Array.from({ length: Math.min(5, 70 - offset) }, (_, n) => {
          const externalTaskId = `shared-workspace-scale-${offset + n}`;
          return prepareWorkspaceTask({ accountId: upgraded.accountId, externalTaskId,
            displayName: `Synthetic workspace reporter ${offset + n}`, workspace: syntheticWorkspace }).catch(error => {
              throw new Error(`Workspace taskIndex=${offset + n} concurrentBatch=${offset}: ${String(error.message).split('\n')[0]}`);
            });
        }));
        preparedTasks.push(...batch);
      }
      console.log(JSON.stringify({ event: 'workspace-prepare-complete', tasks: preparedTasks.length, conflictRetries }));
      assert.equal(new Set(preparedTasks.map(task => task.binding.characterId)).size, 70);
      for (const task of preparedTasks) {
        const exact = await tool(upgraded.bridge, 'get_thingtime_agent_task', { accountId: upgraded.accountId,
          externalTaskId: task.binding.externalTaskId });
        assert.equal(exact.binding.id, task.binding.id); assert.equal(exact.binding.characterId, task.binding.characterId);
      }
      const last = preparedTasks.at(-1);
      const strangerRead = await request('/api/v1/agents/reporting', { cookie: stranger.cookie, status: null,
        body: { origin, operation: 'get', externalTaskId: last.binding.externalTaskId } });
      assert.equal(strangerRead.response.status, 404);
      const changed = await mcp(upgraded.bridge, 'prepare_thingtime_agent_task', { accountId: upgraded.accountId,
        externalTaskId: last.binding.externalTaskId, displayName: 'Changed immutable workspace',
        workspace: { ...syntheticWorkspace, pages: { ...syntheticWorkspace.pages, overview: syntheticWorkspace.pages.taskDetail } } });
      assert(changed.error);
      const ownerRead = (await request('/api/v1/things?id=' + encodeURIComponent(syntheticWorkspace.pages.overview), { cookie: owner.cookie })).data;
      assert(ownerRead.thing); assert(!ownerRead.thing.acl.includes('tt:all'));
      const outsider = await request('/api/v1/things?id=' + encodeURIComponent(syntheticWorkspace.pages.overview), { cookie: stranger.cookie, status: null });
      assert.equal(outsider.response.status, 404);
      const aclPath = '/api/v1/things/acl';
      const aclId = syntheticWorkspace.pages.overview;
      const loadAcl = async () => {
        const entries = []; const cursors = new Set(); let cursor; let revision;
        do {
          const page = (await request(aclPath + '?' + new URLSearchParams({ id: aclId, limit: '17', ...(cursor ? { cursor } : {}) }), { cookie: owner.cookie })).data;
          assert.deepEqual(Object.keys(page).sort(), ['entries', 'nextCursor', 'ok', 'revision']);
          assert.equal(page.ok, true); assert(Array.isArray(page.entries));
          if (revision !== undefined) assert.equal(page.revision, revision);
          revision = page.revision; entries.push(...page.entries); cursor = page.nextCursor;
          if (cursor) { assert(!cursors.has(cursor), 'ACL pagination must advance'); cursors.add(cursor); }
        } while (cursor);
        assert.equal(new Set(entries).size, entries.length);
        return { entries, revision };
      };
      const beforeAcl = await loadAcl(); assert(beforeAcl.entries.length > 64);
      const extra = Array.from({ length: 25 }, (_, n) => `tt:user/synthetic-reader-${n}`);
      await Promise.all(extra.map(entry => request(aclPath, { cookie: owner.cookie, body: { id: aclId, operation: 'add', entries: [entry] } })));
      const afterAcl = await loadAcl(); assert(extra.every(entry => afterAcl.entries.includes(entry)));
      const stale = await request(aclPath, { cookie: owner.cookie, status: 409,
        body: { id: aclId, operation: 'add', entries: ['tt:user/stale-reader'], expectedAclRevision: beforeAcl.revision } });
      assert.equal(stale.data.ok, false);
      const reader = `tt:user/${stranger.data.user.username}`;
      const modify = (operation, entries) => request(aclPath, { cookie: owner.cookie, body: { id: aclId, operation, entries } });
      await modify('add', [reader]);
      assert.equal((await request('/api/v1/things?id=' + encodeURIComponent(aclId), { cookie: stranger.cookie })).response.status, 200);
      await modify('add', ['-' + reader]);
      await request('/api/v1/things?id=' + encodeURIComponent(aclId), { cookie: stranger.cookie, status: 404 });
      await modify('remove', ['-' + reader]);
      await request('/api/v1/things?id=' + encodeURIComponent(aclId), { cookie: stranger.cookie });
      await modify('remove', [reader]);
      await request('/api/v1/things?id=' + encodeURIComponent(aclId), { cookie: stranger.cookie, status: 404 });
      await request(aclPath, { cookie: stranger.cookie, status: 404, body: { id: aclId, operation: 'add', entries: [reader] } });
      const finalAcl = await loadAcl();
      const finalOwner = (await request('/api/v1/things?id=' + encodeURIComponent(aclId), { cookie: owner.cookie })).data.thing;
      assert.equal(finalOwner.acl.length, finalAcl.entries.length); assert.equal(finalOwner.aclRevision, finalAcl.revision);
      assert(finalOwner.aclEntryCount >= 95);
      assert(!finalAcl.entries.includes(reader)); assert(!finalAcl.entries.includes('-' + reader)); assert(!finalAcl.entries.includes('tt:user/stale-reader'));
      checks.push('paged ACL reads preserve more than64 grants;25 concurrent adds, stale revisions, explicit exclusions/removal and owner-only mutations work through real HTTP');
      checks.push('70 distinct task Characters concurrently share one private saved workspace, all exact bindings remain readable, immutable identities and outsider refusal hold');
    });
    const created = await tool(upgraded.bridge, 'report_thingtime_agent_task', { ...identity, requestId: randomUUID(), actionName: 'createTask', inputs: { title: 'Created after scoped OAuth' } });
    const id = created.binding.records.taskId; assert(id);
    const read = await tool(upgraded.bridge, 'get_thingtime_agent_task', { ...identity, recordIds: [id] });
    assert.equal(read.records[0]?.crystal?.title, 'Created after scoped OAuth');
    assert.equal(read.records[0]?.author?.id, prepared.binding.characterId);
    await verifyCoordination(upgraded.bridge, identity, syntheticWorkspace.subspaceId, owner, stranger);
    const privateGrant = (await request('/api/v1/tokens', { cookie: owner.cookie, status: 201, body: {
      name: 'Synthetic private reporting acceptance', scopes: ['agents.report'], visibility: 'private'
    } })).data;
    assert.deepEqual(privateGrant.tokenInfo.scopes, ['agents.report']); assert.equal(privateGrant.tokenInfo.visibility, 'private');
    const reportWithPrivateGrant = async (operation, extra = {}) => (await request('/api/v1/agents/reporting', { token: privateGrant.token,
      body: { origin, externalTaskId: identity.externalTaskId, operation, ...extra } })).data;
    const privateRead = await reportWithPrivateGrant('get');
    assert.equal(privateRead.coordinationPost.id, privateRead.binding.coordinationPostId);
    const privateWrite = await reportWithPrivateGrant('coordinate', { requestId: randomUUID(), title: 'Private token coordination',
      text: 'Reporting scope only', renderComponent: { render: { tag: 'p', children: ['{text}'] } } });
    assert.equal(privateWrite.binding.coordinationPostId, privateRead.coordinationPost.id);
    assert.equal((await reportWithPrivateGrant('get')).coordinationPost.crystal.text, 'Reporting scope only');
    const generalThing = await request('/api/v1/things?id=' + encodeURIComponent(privateRead.coordinationPost.id), { token: privateGrant.token, status: null });
    assert.equal(generalThing.response.status, 403); assert(!generalThing.data?.thing);
    checks.push('a private-only reporting token can read and update only its bound coordination post without general Things access');
    assert((await mcp(upgraded.bridge, 'get_thingtime_thing', { accountId: upgraded.accountId, id })).error);
    const legacy = await oauth(owner.cookie, ['agents.report']);
    assert.equal((await tool(legacy.bridge, 'get_thingtime_agent_task', { externalTaskId: identity.externalTaskId })).binding.id, prepared.binding.id);
    await request('/api/v1/tokens/revoke', { cookie: owner.cookie, body: { id: upgraded.patId } });
    assert.equal((await upgraded.refreshGrant(upgraded.refresh, {}, 400)).error, 'invalid_grant');
    assert((await mcp(upgraded.bridge, 'get_thingtime_agent_task', identity)).error);
    checks.push('the upgraded grant runs a saved Action as the private task Character, exact record readback works, legacy reporting can resume it, and revoked backing access cannot refresh');
  } else {
  const workspace = { pages: {}, schemas: {}, actions: {} };
  for (const [key, crystal] of Object.entries(authored.schemas)) workspace.schemas[key] = await create('schema', crystal);
  for (const [key, crystal] of Object.entries(authored.pages)) workspace.pages[key] = await create('webpage', crystal);
  const bindFixtureSchemaIds = value => typeof value === 'string' && /^\{\{schema:[a-z]+\}\}$/.test(value) ? workspace.schemas[value.slice(9,-2)] : Array.isArray(value) ? value.map(bindFixtureSchemaIds) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,entry]) => [key,bindFixtureSchemaIds(entry)])) : value;
  for (const [key, crystal] of Object.entries(authored.actions)) workspace.actions[key] = await create('action', bindFixtureSchemaIds(crystal));
  const subspace = (await request('/api/v1/subspaces', { cookie: owner.cookie, body: { name: 'Thingtime Agents', slug: `reporting-${randomBytes(5).toString('hex')}`, access: 'private' }, status: 201 })).data;
  workspace.subspaceId = subspace.subspace?.id; assert(workspace.subspaceId, 'Private subspace returned ID');
  const grant = await oauth(owner.cookie, ['agents.report']);
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
  await verifyCoordination(grant.bridge, { externalTaskId: args.externalTaskId }, workspace.subspaceId, owner, stranger);
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
  }
  }
  if (sectionFailures.length) throw new Error(`${sectionFailures.length} independent acceptance section(s) failed: ${sectionFailures.map(failure => failure.name).join(', ')}`);
  await writeFile(join(evidenceDir, 'agent-reporting-acceptance.json'), JSON.stringify({ passed: true, checks, fixtureSha256: fixturePath ? createHash('sha256').update(await readFile(fixturePath)).digest('hex') : null, source: 'real isolated HTTP + OAuth PKCE + MCP built Nitro', completedAt: new Date().toISOString(), isolation: 'fresh replica set; throwaway accounts and memory-only generated credentials; normal networking; no inherited app env', ports }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, evidence: join(evidenceDir, 'agent-reporting-acceptance.json') }));
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'agent-reporting-acceptance.json'), JSON.stringify({ passed: false, checks, sectionFailures, childDiagnostics, registrationDiagnostics, serverCwd: 'synthetic task directory', failure: String(error.message).split('\n')[0].slice(0, 250), at: new Date().toISOString() }, null, 2));
  console.error(String(error.message).split('\n')[0].slice(0, 250)); console.error(String(error.stack).split('\n').filter(line => line.includes('agent-reporting-acceptance.mjs:')).join('\n')); process.exitCode = 1;
} finally {
  if (client) await client.close().catch(() => {});
  if (diagnosticClient) await diagnosticClient.close().catch(() => {});
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, 'exit'); try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2500);
    await exited; clearTimeout(timer);
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'acceptance-cleanup.json'), JSON.stringify({
    completedAt: new Date().toISOString(), temporaryReplicaRemoved: true,
    children: children.map(child => ({ pid: child.pid, exited: child.exitCode !== null || child.signalCode !== null, exitCode: child.exitCode, signal: child.signalCode }))
  }, null, 2));
}
