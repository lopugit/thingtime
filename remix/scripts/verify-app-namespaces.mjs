#!/usr/bin/env node
// Live verification of the full-power app-namespace surface
// (claude-todo/16), driven entirely through the real API with sandbox
// tokens — no registration, no mocks, no direct DB access (FUNDAMENTALS §2).
//
//   node scripts/verify-app-namespaces.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or http://127.0.0.1:19582 (the worktree
// nitro port). Exits non-zero when any check fails.

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

const api = async (path, { token, method = 'GET', body, origin } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON response — callers assert on status
  }
  return { status: response.status, body: json };
};

const mint = async (clientId, scope, opts = {}) => {
  const res = await api('/api/v1/oauth/sandbox', { method: 'POST', body: { clientId, scope, ...opts } });
  if (!res.body?.ok) throw new Error(`sandbox mint failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
};

const suffix = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

console.log(`Verifying app namespaces against ${BASE}\n`);

// ---------------------------------------------------------------------------
console.log('A. Single-namespace basics (isolated sandbox)');
{
  const cid = `ttapp_verify_a_${suffix}`;
  const t = await mint(cid, 'profile app-data app-data.shared');

  const created = await api('/api/v1/things', {
    token: t,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { kind: 'note', text: 'hello', rank: 3 }, shareId: `va-note-${suffix}` }
  });
  check('create data thing', created.body?.ok === true);
  check('private by default (never the public default)', created.body?.thing?.visibility === 'private');
  check('acl never leaks beyond own entries', (created.body?.thing?.acl || []).every((e) => e === 'tt:user'));

  const sharedPost = await api('/api/v1/things', {
    token: t,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'circle post' }, visibility: 'app', shareId: `va-post-${suffix}` }
  });
  check('shared write with visibility sugar', sharedPost.body?.ok === true && sharedPost.body?.thing?.visibility === 'app');

  const got = await api(`/api/v1/things?id=va-note-${suffix}`, { token: t });
  check('get by id inside namespace', got.body?.ok === true && got.body?.thing?.crystal?.text === 'hello');
  check('no PublicPost aggregation on app reads', got.body?.post === null);

  const listed = await api('/api/v1/things', { token: t });
  check('list own namespace', listed.body?.ok === true && listed.body?.things?.length === 2);

  const searched = await api('/api/v1/things/search', {
    token: t,
    method: 'POST',
    body: { conditions: [{ field: 'rank', op: 'gte', value: 2 }] }
  });
  check('structured search with value-path condition', searched.body?.ok === true && searched.body?.things?.length === 1);

  const kv = await api('/api/v1/app-data', { token: t, method: 'POST', body: { key: `log:${suffix}`, value: { n: 1 } } });
  check('KV write shares the namespace', kv.body?.ok === true);
  const kvList = await api(`/api/v1/app-data?prefix=log:&limit=1`, { token: t });
  check('KV private list prefix+limit', kvList.body?.ok === true && kvList.body?.entries?.length === 1);
  const kvViaThings = await api('/api/v1/things?thingtime=app-data', { token: t });
  check('KV entries visible through the things surface', kvViaThings.body?.things?.length === 1);

  const usageBefore = await api('/api/v1/app-data/usage', { token: t });
  check(
    'sandbox usage reports the explicit user ledger and no standing app aggregate',
    usageBefore.body?.usedBytes > 0 &&
      usageBefore.body?.budgetBytes > 0 &&
      usageBefore.body?.userStorage?.usedBytes === usageBefore.body?.usedBytes &&
      usageBefore.body?.userStorage?.remainingBytes >= 0 &&
      usageBefore.body?.appStorage === null &&
      usageBefore.body?.storageAccountingReady === true
  );

  const patched = await api('/api/v1/things', {
    token: t,
    method: 'PATCH',
    body: { id: `va-note-${suffix}`, crystal: { text: 'hello world, considerably longer now' } }
  });
  check('PATCH merge inside namespace', patched.body?.ok === true);
  const usageAfterPatch = await api('/api/v1/app-data/usage', { token: t });
  check('update charges the byte delta', usageAfterPatch.body?.usedBytes > usageBefore.body?.usedBytes);

  const removed = await api(`/api/v1/things?id=va-note-${suffix}`, { token: t, method: 'DELETE' });
  check('DELETE inside namespace', removed.body?.ok === true);
  const usageAfterDelete = await api('/api/v1/app-data/usage', { token: t });
  check('delete refunds the ledger', usageAfterDelete.body?.usedBytes < usageAfterPatch.body?.usedBytes);

  const deletedKv = await api('/api/v1/app-data/delete', {
    token: t,
    method: 'POST',
    body: { key: `log:${suffix}` }
  });
  const usageAfterKvDelete = await api('/api/v1/app-data/usage', { token: t });
  check(
    'explicit sandbox KV delete refunds the ephemeral ledger',
    deletedKv.body?.deleted === true && usageAfterKvDelete.body?.usedBytes < usageAfterDelete.body?.usedBytes
  );

  const save = await api('/api/v1/things', { token: t, method: 'POST', body: { thingtime: ['save'], targetId: `va-post-${suffix}` } });
  check('save things refused (first-party surface)', save.status === 403);
  const legacy = await api('/api/v1/things', { token: t, method: 'POST', body: { type: 'text', text: 'legacy shape' } });
  check('legacy post shape refused for app writes', legacy.status === 400);
  const pub = await api('/api/v1/things', {
    token: t,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'public?' }, acl: ['tt:all'] }
  });
  check('tt:all inexpressible (acl clamp)', pub.status === 400);
  const protectedKind = await api('/api/v1/things', { token: t, method: 'POST', body: { thingtime: ['user'], crystal: {} } });
  check('protected kinds refused', protectedKind.status === 403 || protectedKind.status === 400);
}

// ---------------------------------------------------------------------------
console.log('\nB. Cross-user space pool');
{
  const cid = `ttapp_verify_b_${suffix}`;
  const space = `verify-space-${suffix}`;
  const alice = await mint(cid, 'profile app-data app-data.shared', { space, username: 'alice' });
  const bob = await mint(cid, 'profile app-data app-data.shared', { space, username: 'bob' });
  const noShare = await mint(cid, 'profile app-data');

  const post = await api('/api/v1/things', {
    token: alice,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'alice to the circle' }, visibility: 'app' }
  });
  const postId = post.body?.thing?.id;
  await api('/api/v1/things', { token: alice, method: 'POST', body: { thingtime: ['data'], crystal: { secret: 'diary' } } });

  const bobList = await api('/api/v1/things', { token: bob });
  check('pool member sees shared entries only', bobList.body?.things?.length === 1);
  check('shared entry attributed to its author', bobList.body?.things?.[0]?.author?.username === 'sandbox-alice');
  check("private diary never crosses users", !JSON.stringify(bobList.body).includes('diary'));

  const noShareList = await api('/api/v1/things', { token: noShare });
  check('no app-data.shared grant → own entries only', noShareList.body?.things?.length === 0);

  const comment = await api('/api/v1/things/comment', { token: bob, method: 'POST', body: { id: postId, text: 'hi alice' } });
  check('cross-user comment through the namespace', comment.body?.ok === true && comment.body?.commentCount === 1);

  const aliceComments = await api(`/api/v1/things?target=${postId}&thingtime=comment`, { token: alice });
  check('inherit-chain comment visible to the author', aliceComments.body?.things?.length === 1);

  await api('/api/v1/things/react', { token: bob, method: 'POST', body: { id: postId, emoji: '💚' } });
  const aliceReact = await api('/api/v1/things/react', { token: alice, method: 'POST', body: { id: postId, emoji: '🌸' } });
  check(
    'per-viewer reaction state over shared counts',
    aliceReact.body?.reactionCounts?.['💚'] === 1 &&
      aliceReact.body?.reactionCounts?.['🌸'] === 1 &&
      aliceReact.body?.viewerReactions?.join() === '🌸'
  );
  check('no personal recents pollution from app reacts', aliceReact.body?.recentReactions === undefined);
}

// ---------------------------------------------------------------------------
console.log('\nC. Namespace + origin fencing');
{
  const cidA = `ttapp_verify_c1_${suffix}`;
  const cidB = `ttapp_verify_c2_${suffix}`;
  const a = await mint(cidA, 'profile app-data app-data.shared');
  const b = await mint(cidB, 'profile app-data app-data.shared');

  await api('/api/v1/things', {
    token: a,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { mine: true }, shareId: `vc-a-${suffix}`, visibility: 'app' }
  });

  const read = await api(`/api/v1/things?id=vc-a-${suffix}`, { token: b });
  check("another app can't read the thing (404)", read.status === 404);
  const patch = await api('/api/v1/things', { token: b, method: 'PATCH', body: { id: `vc-a-${suffix}`, crystal: { mine: false } } });
  check("another app can't update it (404)", patch.status === 404);
  const del = await api(`/api/v1/things?id=vc-a-${suffix}`, { token: b, method: 'DELETE' });
  check("another app can't delete it (404)", del.status === 404);
  const put = await api('/api/v1/things', { token: b, method: 'PUT', body: { id: `vc-a-${suffix}`, crystal: { squat: 1 } } });
  check("another app can't PUT-claim the id", put.status === 404 || put.status === 400);

  const wrongOrigin = await api('/api/v1/things', { token: a, origin: 'https://evil.example' });
  check('origin binding enforced on the things surface', wrongOrigin.status === 403);

  const grants = await api('/api/v1/oauth/grants', { token: a });
  check('app tokens never reach session surfaces (grants 401)', grants.status === 401);
  const summary = await api('/api/v1/apps/data-summary', { token: a });
  check('app tokens never reach the browse surface (401)', summary.status === 401);
}

console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join(' | ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
