#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
// Live verification of personal access tokens (Settings → Token minter) on
// the merged PAT × app-namespace tree — real API only, no mocks, no direct DB
// access (FUNDAMENTALS §2). Covers the scope catalog, use accounting, the
// onlyCreatedThings sandbox with tt:token grant layering, default-deny off
// the things family, and the seams the app-namespace merge introduced
// (shared routes resolving PATs and app tokens side by side).
//
//   node scripts/verify-pat-tokens.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or http://127.0.0.1:19582.

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:19582';

let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const api = async (path, { token, cookie, method = 'GET', body, origin, headers = {} } = {}) => {
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    });
  let response;
  try {
    response = await doFetch();
  } catch {
    // the oversized-payload check makes the server destroy a kept-alive
    // socket mid-upload; undici can hand the next request that poisoned
    // connection — one clean retry gets a fresh socket
    response = await doFetch();
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON response — callers assert on status
  }
  return { status: response.status, body: json, headers: response.headers };
};

const suffix = `${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;

// Register through the real registration path and keep the session cookie —
// the same credential the Settings UI mints with.
const registerSession = async (name) => {
  const username = `patv-${name}-${suffix}`;
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: `Verify-${suffix}-9!`,
      email: `${username}@example.com`
    })
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/tt_auth=[^;]+/);
  if (!res.ok || !match) throw new Error(`register failed: ${res.status} ${setCookie.slice(0, 80)}`);
  return { username, cookie: match[0] };
};

const mintPat = async (cookie, input) => {
  const res = await api('/api/v1/tokens', { cookie, method: 'POST', body: input });
  if (!res.body?.ok) throw new Error(`mint failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

console.log(`Verifying personal access tokens against ${BASE}\n`);

const session = await registerSession('main');

// ---------------------------------------------------------------------------
console.log('A. Scoped CRUD through the things family');
let fullToken;
{
  const minted = await mintPat(session.cookie, { name: 'full', scopes: ['things'] });
  fullToken = minted.token;
  check('mint returns the token exactly once', typeof fullToken === 'string' && fullToken.length > 20);

  const created = await api('/api/v1/things', {
    token: fullToken,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { note: 'pat-made' } }
  });
  const createdId = created.body?.thing?.id;
  check('PAT POST creates a thing', created.status === 200 && !!createdId);
  check(
    'creator auto-granted in tokenAcl (owner projection)',
    Array.isArray(created.body?.thing?.tokenAcl) &&
      created.body.thing.tokenAcl.some((e) => e.startsWith('tt:token/')),
    JSON.stringify(created.body?.thing?.tokenAcl)
  );

  const read = await api(`/api/v1/things?id=${createdId}`, { token: fullToken });
  check('PAT GET reads it back', read.status === 200 && read.body?.thing?.id === createdId);

  const patched = await api('/api/v1/things', {
    token: fullToken,
    method: 'PATCH',
    body: { id: createdId, crystal: { note: 'pat-edited' } }
  });
  check('PAT PATCH merges the crystal', patched.status === 200 && patched.body?.thing?.crystal?.note === 'pat-edited');

  const searched = await api('/api/v1/things/search', {
    token: fullToken,
    method: 'POST',
    body: { conditions: [{ field: 'crystal.note', op: 'eq', value: 'pat-edited' }] }
  });
  check(
    'PAT structured search finds it',
    searched.status === 200 && (searched.body?.things || []).some((t) => t.id === createdId)
  );

  const post = await api('/api/v1/things', {
    token: fullToken,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'pat post' }, acl: ['tt:user'] }
  });
  // post things come back as the post projection, not the generic thing
  const postId = post.body?.post?.id ?? post.body?.thing?.id;
  check('PAT creates a post thing', post.status === 200 && !!postId);

  const commented = await api('/api/v1/things/comment', {
    token: fullToken,
    method: 'POST',
    body: { id: postId, text: 'pat comment' }
  });
  check('PAT comments through the dedicated route', commented.status === 200 && commented.body?.ok === true);

  const reacted = await api('/api/v1/things/react', {
    token: fullToken,
    method: 'POST',
    body: { id: postId, emoji: '🪙' }
  });
  check('PAT reacts through the dedicated route', reacted.status === 200 && reacted.body?.ok === true);

  const removed = await api('/api/v1/things', { token: fullToken, method: 'DELETE', body: { id: createdId } });
  check('PAT DELETE removes it', removed.status === 200 && removed.body?.ok === true);
}

// ---------------------------------------------------------------------------
console.log('B. Scope gates (403s are free) and the PUT dual scope');
{
  const minted = await mintPat(session.cookie, { name: 'read2', scopes: ['things.read'], maxUses: 2 });
  const blocked = await api('/api/v1/things', {
    token: minted.token,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { nope: true } }
  });
  check('missing scope 403s', blocked.status === 403, `${blocked.status}`);

  const introspected = await api('/api/v1/tokens/self', { token: minted.token });
  check(
    'missing-scope 403 did not burn a use (free introspection agrees)',
    introspected.status === 200 && introspected.body?.token?.usesRemaining === 2,
    JSON.stringify(introspected.body?.token)
  );

  const read = await api('/api/v1/things/search', { token: minted.token, method: 'POST', body: {} });
  check('covered read succeeds and consumes', read.status === 200);
  const after = await api('/api/v1/tokens/self', { token: minted.token });
  check('use accounting decremented once', after.body?.token?.usesRemaining === 1, JSON.stringify(after.body?.token));

  const createOnly = await mintPat(session.cookie, { name: 'create-only', scopes: ['things.create'] });
  const putBlocked = await api('/api/v1/things', {
    token: createOnly.token,
    method: 'PUT',
    body: { id: `patv-upsert-${suffix}`, thingtime: ['data'], crystal: { v: 1 } }
  });
  check('PUT refuses create-only (upsert needs update too)', putBlocked.status === 403);

  const both = await mintPat(session.cookie, { name: 'upserter', scopes: ['things.create', 'things.update'] });
  const putOk = await api('/api/v1/things', {
    token: both.token,
    method: 'PUT',
    body: { id: `patv-upsert-${suffix}`, thingtime: ['data'], crystal: { v: 1 } }
  });
  check('PUT works with create+update', putOk.status === 201 || putOk.status === 200, `${putOk.status}`);
}

// ---------------------------------------------------------------------------
console.log('C. Lifetime dials, Bearer-only, default-deny, oversized bodies');
{
  const oneUse = await mintPat(session.cookie, { name: 'one', scopes: ['things.read'], maxUses: 1 });
  const first = await api('/api/v1/things/search', { token: oneUse.token, method: 'POST', body: {} });
  check('single use resolves once', first.status === 200);
  const second = await api('/api/v1/things/search', { token: oneUse.token, method: 'POST', body: {} });
  check('then reports no uses remaining', second.status === 401, `${second.status}`);

  const denied = await api('/api/v1/tokens', { token: fullToken });
  check('PAT default-denied off the things family (tokens list)', denied.status === 401, `${denied.status}`);

  const asCookie = await api('/api/v1/things?thingtime=data', { cookie: `tt_auth=${fullToken}` });
  check('PAT smuggled as a cookie stays anonymous', asCookie.status === 401, `${asCookie.status}`);

  const appData = await api('/api/v1/app-data', { token: fullToken });
  check('PAT rejected by the app-token-only surface (app-data)', appData.status === 401 || appData.status === 403);

  // 413 fires before actor resolution — an oversized payload must not spend
  // the token's last use.
  const lastUse = await mintPat(session.cookie, { name: 'big', scopes: ['things.create'], maxUses: 1 });
  const huge = await api('/api/v1/things', {
    token: lastUse.token,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { blob: 'x'.repeat(900 * 1024) } }
  });
  check('oversized body 413s', huge.status === 413, `${huge.status}`);
  const stillArmed = await api('/api/v1/tokens/self', { token: lastUse.token });
  check('413 did not consume the use', stillArmed.body?.token?.usesRemaining === 1, JSON.stringify(stillArmed.body?.token));

  const revokable = await mintPat(session.cookie, { name: 'revoke-me', scopes: ['things.read'] });
  const revoked = await api('/api/v1/tokens/revoke', {
    cookie: session.cookie,
    method: 'POST',
    body: { id: revokable.tokenInfo.id }
  });
  check('owner revokes', revoked.status === 200 && revoked.body?.token?.status === 'revoked');
  const dead = await api('/api/v1/things?thingtime=data', { token: revokable.token });
  check('revoked token stops resolving immediately', dead.status === 401, `${dead.status}`);
}

// ---------------------------------------------------------------------------
console.log('D. Sandbox (onlyCreatedThings) + tt:token grant layering');
{
  const boxed = await mintPat(session.cookie, { name: 'boxed', scopes: ['things'], onlyCreatedThings: true });
  const boxedEntry = `tt:token/${boxed.tokenInfo.id}`;

  const own = await api('/api/v1/things', {
    token: boxed.token,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { mine: true } }
  });
  const ownId = own.body?.thing?.id;
  check('sandboxed token creates', own.status === 200 && !!ownId);
  const ownEdit = await api('/api/v1/things', {
    token: boxed.token,
    method: 'PATCH',
    body: { id: ownId, crystal: { mine: 'still' } }
  });
  check('sandboxed token edits its own creation', ownEdit.status === 200);

  const foreign = await api('/api/v1/things', {
    cookie: session.cookie,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { sessionMade: true } }
  });
  const foreignId = foreign.body?.thing?.id;
  check('session creates an ungranted thing', foreign.status === 200 && !!foreignId);

  const blockedEdit = await api('/api/v1/things', {
    token: boxed.token,
    method: 'PATCH',
    body: { id: foreignId, crystal: { sneaky: true } }
  });
  check('sandbox blocks editing ungranted things', blockedEdit.status === 403, `${blockedEdit.status}`);
  const blockedDelete = await api('/api/v1/things', { token: boxed.token, method: 'DELETE', body: { id: foreignId } });
  check('sandbox blocks deleting ungranted things', blockedDelete.status === 403, `${blockedDelete.status}`);

  const granted = await api('/api/v1/things', {
    cookie: session.cookie,
    method: 'PATCH',
    body: { id: foreignId, tokenAcl: [boxedEntry] }
  });
  check('owner layers the token grant on', granted.status === 200);
  const nowAllowed = await api('/api/v1/things', {
    token: boxed.token,
    method: 'PATCH',
    body: { id: foreignId, crystal: { granted: true } }
  });
  check('grant admits the sandboxed token', nowAllowed.status === 200, `${nowAllowed.status}`);

  const lockout = await api('/api/v1/things', {
    token: boxed.token,
    method: 'PATCH',
    body: { id: foreignId, tokenAcl: null }
  });
  check('token can drop its own grant (chmod-style)', lockout.status === 200);
  const lockedOut = await api('/api/v1/things', {
    token: boxed.token,
    method: 'PATCH',
    body: { id: foreignId, crystal: { locked: true } }
  });
  check('and is locked out afterwards', lockedOut.status === 403, `${lockedOut.status}`);

  const badGrammar = await api('/api/v1/things', {
    cookie: session.cookie,
    method: 'PATCH',
    body: { id: foreignId, tokenAcl: ['tt:token:colon-form'] }
  });
  check('tokenAcl grammar 400s on the colon form', badGrammar.status === 400, `${badGrammar.status}`);
}

// ---------------------------------------------------------------------------
console.log('E. Merged seams — PATs and app tokens on the shared routes');
{
  // The routes the app-namespace PR opened to apps resolve PATs through the
  // same resolveActor call now — prove an app credential still walks the app
  // path (origin binding) while a PAT ignores Origin entirely.
  const originful = await api('/api/v1/things/search', {
    token: fullToken,
    method: 'POST',
    body: {},
    origin: 'https://anywhere.example'
  });
  check('PAT unaffected by Origin (no app binding applies)', originful.status === 200, `${originful.status}`);

  const preflight = await fetch(`${BASE}/api/v1/things`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://sdk.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type'
    }
  });
  check(
    'OPTIONS preflight still served for app SDKs',
    preflight.status === 204 || preflight.status === 200,
    `${preflight.status}`
  );
  check(
    'preflight allows the Authorization header',
    /authorization/i.test(preflight.headers.get('access-control-allow-headers') || '')
  );

  const patBrowse = await api(`/api/v1/things?thingtime=app-data&appId=ttapp_nonexistent_${suffix}`, {
    token: fullToken
  });
  check(
    'PAT may browse an app namespace by appId (first-party read)',
    patBrowse.status === 200 && Array.isArray(patBrowse.body?.things) && patBrowse.body.things.length === 0,
    `${patBrowse.status}`
  );

  const anon = await api(`/api/v1/things/search?anon=1&limit=1`, {});
  check('anon=1 edge-cacheable search skips actor resolution', anon.status === 200);
}

// ---------------------------------------------------------------------------
console.log('');
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} FAILED:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
