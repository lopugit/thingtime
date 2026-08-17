#!/usr/bin/env node
// Live verification of the third-party connections family — real API only,
// no mocks, no direct DB access (FUNDAMENTALS §2). Covers the provider
// catalog, connect/list/unlink (idempotency + many-to-many account sharing),
// feed sync + acl-gated reads, native Thingtime comments/reactions layered on
// external posts (incl. the /post permalink projection + external author),
// AI feed filters (warn/hide, verdict caching, prompt-revision re-classify),
// and the protection walls (reserved ext- shareIds, protected kinds, no
// generic-CRUD leaks). Uses the deterministic demo provider only, so the run
// needs no network egress; TT_VERIFY_LIVE=1 adds one real Hacker News pull.
//
//   node scripts/verify-connections.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or this worktree's nitro port.

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveDevContext } = require('./worktree-ports.cjs');

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || `http://127.0.0.1:${resolveDevContext(process.cwd()).ports.api}`;

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

const api = async (path, { cookie, method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON — callers assert on status
  }
  return { status: response.status, body: json };
};

const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

const register = async (name) => {
  const username = `${name}${suffix}`;
  const response = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Verify1234!pass', email: `${username}@example.com` })
  });
  const setCookie = response.headers.get('set-cookie') || '';
  const match = /tt_auth=[^;]+/.exec(setCookie);
  const body = await response.json();
  if (!response.ok || !match) throw new Error(`registration failed for ${username}: ${JSON.stringify(body)}`);
  return { username, id: body.user.id, cookie: match[0] };
};

const run = async () => {
  console.log(`Connections verification against ${BASE}\n`);

  console.log('A. registration + walls');
  const ana = await register('vc-ana-');
  const bo = await register('vc-bo-');
  check('two users registered through the real path', !!(ana.id && bo.id));
  const providersAnon = await api('/api/v1/connections/providers');
  check(
    'provider catalog is public and lists the demo provider',
    providersAnon.status === 200 && providersAnon.body?.providers?.some((provider) => provider.id === 'demo')
  );
  check(
    'catalog spans a large provider set (9+)',
    (providersAnon.body?.providers?.length || 0) >= 9,
    `got ${providersAnon.body?.providers?.length}`
  );
  const wallList = await api('/api/v1/connections');
  check('GET /connections without auth is 401', wallList.status === 401);
  const wallFeed = await api('/api/v1/connections/feed');
  check('GET /connections/feed without auth is 401', wallFeed.status === 401);
  const docs = await api('/api/v1/connections-docs');
  check('docs twin endpoint is public and shaped', docs.status === 200 && docs.body?.docs?.endpoint === '/api/v1/connections');

  console.log('\nB. connect + many-to-many linking');
  const handle = `verify-${suffix}`;
  const anaConnect = await api('/api/v1/connections', {
    cookie: ana.cookie,
    method: 'POST',
    body: { provider: 'demo', fields: { handle } }
  });
  check('ana connects the demo provider', anaConnect.status === 200 && anaConnect.body?.ok === true);
  const anaAccountId = anaConnect.body?.connection?.account?.id;
  check('connection carries a deterministic ext-account id', typeof anaAccountId === 'string' && anaAccountId.startsWith('ext-account-'));
  const anaReconnect = await api('/api/v1/connections', {
    cookie: ana.cookie,
    method: 'POST',
    body: { provider: 'demo', fields: { handle } }
  });
  check('reconnecting the same identity is idempotent', anaReconnect.status === 200 && anaReconnect.body?.alreadyLinked === true);
  const boConnect = await api('/api/v1/connections', {
    cookie: bo.cookie,
    method: 'POST',
    body: { provider: 'demo', fields: { handle } }
  });
  check(
    'a second Thingtime account links the SAME external account (many-to-many)',
    boConnect.status === 200 && boConnect.body?.connection?.account?.id === anaAccountId
  );
  const anaList = await api('/api/v1/connections', { cookie: ana.cookie });
  check('ana lists exactly one connection', anaList.status === 200 && anaList.body?.connections?.length === 1);
  const badProvider = await api('/api/v1/connections', { cookie: ana.cookie, method: 'POST', body: { provider: 'nope' } });
  check('unknown provider is a 400', badProvider.status === 400);

  console.log('\nC. feed sync + acl-gated reads');
  const anaFeed = await api('/api/v1/connections/feed?limit=10', { cookie: ana.cookie });
  check('ana reads her synced feed', anaFeed.status === 200 && (anaFeed.body?.posts?.length || 0) > 0);
  const anaPost = anaFeed.body?.posts?.[0];
  check('external posts carry deterministic ext-post ids', typeof anaPost?.id === 'string' && anaPost.id.startsWith('ext-post-'));
  check(
    'external posts surface the third-party author',
    typeof anaPost?.author?.id === 'string' && anaPost.author.id.startsWith('ext:demo:')
  );
  check('external envelope rides extended.external', anaPost?.extended?.external?.provider === 'demo');
  const anaSync = anaFeed.body?.synced?.find((entry) => entry.provider === 'demo');
  check('sync report present for the demo connection', !!anaSync && anaSync.error === null);
  const cooldown = await api('/api/v1/connections/feed?limit=1', { cookie: ana.cookie });
  check(
    'second read within the cooldown skips the provider fetch',
    cooldown.status === 200 && cooldown.body?.synced?.every((entry) => entry.skipped === true)
  );
  const boFeed = await api('/api/v1/connections/feed?limit=10', { cookie: bo.cookie });
  check('bo reads the same account feed through his own link', boFeed.status === 200 && (boFeed.body?.posts?.length || 0) > 0);
  const outsider = await register('vc-out-');
  const outsiderView = await api(`/api/v1/things?id=${anaPost.id}`, { cookie: outsider.cookie });
  check('personal external posts stay invisible to non-linked users', outsiderView.status === 404);
  const linkedView = await api(`/api/v1/things?id=${anaPost.id}`, { cookie: bo.cookie });
  check('linked users resolve the external post permalink', linkedView.status === 200 && linkedView.body?.post?.id === anaPost.id);

  console.log('\nD. Thingtime features layered on external posts');
  const comment = await api('/api/v1/things/comment', {
    cookie: ana.cookie,
    method: 'POST',
    body: { id: anaPost.id, text: 'Thingtime comment on a third-party post ✨' }
  });
  check('native comment attaches to the external post', comment.status === 200 && comment.body?.ok === true);
  const reply = await api('/api/v1/things/comment', {
    cookie: bo.cookie,
    method: 'POST',
    body: { id: comment.body?.comment?.id, text: 'Cross-account reply 🎉' }
  });
  check('another linked user replies in the same thread', reply.status === 200 && reply.body?.ok === true);
  const react = await api('/api/v1/things/react', {
    cookie: bo.cookie,
    method: 'POST',
    body: { id: anaPost.id, emoji: '❤️' }
  });
  check('native reaction toggles on the external post', react.status === 200 && react.body?.reactionCounts?.['❤️'] === 1);
  const permalink = await api(`/api/v1/things?id=${anaPost.id}`, { cookie: ana.cookie });
  check(
    'permalink projects the post with comments + reactions aggregated',
    permalink.status === 200 && permalink.body?.post?.commentCount >= 2 && permalink.body?.post?.reactionCounts?.['❤️'] === 1
  );
  const refetch = await api('/api/v1/connections/feed?limit=10', { cookie: ana.cookie });
  const refetchedPost = refetch.body?.posts?.find((post) => post.id === anaPost.id);
  check('feed read aggregates the new engagement', !!refetchedPost && refetchedPost.commentCount >= 2);

  console.log('\nE. AI feed filters');
  const filter = await api('/api/v1/connections/filters', {
    cookie: ana.cookie,
    method: 'POST',
    body: { name: 'Sad news', prompt: 'warn for sad news', action: 'warn' }
  });
  check('warn filter created', filter.status === 200 && filter.body?.filter?.action === 'warn');
  const filterId = filter.body?.filter?.id;
  const filtered = await api('/api/v1/connections/feed?limit=20', { cookie: ana.cookie });
  const matches = (filtered.body?.posts || []).filter((post) => (post.feedFilterMatches || []).length > 0);
  check('filter matches demo posts (classification ran)', matches.length > 0, `matched ${matches.length}`);
  check(
    'matches carry name/action/reason/source',
    matches.every(
      (post) =>
        post.feedFilterMatches[0].name === 'Sad news' &&
        post.feedFilterMatches[0].action === 'warn' &&
        typeof post.feedFilterMatches[0].reason === 'string' &&
        ['claude', 'openai', 'heuristic'].includes(post.feedFilterMatches[0].source)
    )
  );
  const again = await api('/api/v1/connections/feed?limit=20', { cookie: ana.cookie });
  const againMatches = (again.body?.posts || []).filter((post) => (post.feedFilterMatches || []).length > 0);
  check('verdicts are cached and stable across reads', againMatches.length === matches.length);
  const toHide = await api('/api/v1/connections/filters', {
    cookie: ana.cookie,
    method: 'POST',
    body: { id: filterId, action: 'hide' }
  });
  check('filter updates to hide', toHide.status === 200 && toHide.body?.filter?.action === 'hide');
  const disabled = await api('/api/v1/connections/filters', {
    cookie: ana.cookie,
    method: 'POST',
    body: { id: filterId, enabled: false }
  });
  check('filter can be paused', disabled.status === 200 && disabled.body?.filter?.enabled === false);
  const quiet = await api('/api/v1/connections/feed?limit=20', { cookie: ana.cookie });
  check(
    'paused filters stop matching',
    (quiet.body?.posts || []).every((post) => (post.feedFilterMatches || []).length === 0)
  );
  const removed = await api('/api/v1/connections/filters', { cookie: ana.cookie, method: 'POST', body: { id: filterId, remove: true } });
  check('filter deletes', removed.status === 200 && removed.body?.removed === true);
  check('bo never sees ana filters', (await api('/api/v1/connections/filters', { cookie: bo.cookie })).body?.filters?.length === 0);

  console.log('\nF. protection walls');
  const squat = await api('/api/v1/things', {
    cookie: outsider.cookie,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'squat' }, shareId: 'ext-post-deadbeefdeadbeef' }
  });
  check('ext- shareIds are reserved against squatting', squat.status === 400);
  const forge = await api('/api/v1/things', {
    cookie: outsider.cookie,
    method: 'POST',
    body: { thingtime: ['external-account-link'], crystal: { accountId: anaAccountId } }
  });
  check('external-account-link cannot be minted via generic CRUD', forge.status === 400 || forge.status === 403);
  const genericUpdate = await api('/api/v1/things/update', {
    cookie: ana.cookie,
    method: 'POST',
    body: { id: anaPost.id, crystal: { text: 'defaced' } }
  });
  check('external posts refuse generic updates', genericUpdate.status !== 200);
  const ownThings = await api('/api/v1/things?limit=50', { cookie: ana.cookie });
  const leaked = (ownThings.body?.things || []).some((thing) => (thing.thingtime || []).some((id) => id.startsWith('external-') || id.startsWith('feed-filter')));
  check('connection kinds stay out of the generic things browser', !leaked);

  console.log('\nG. unlink lifecycle');
  const anaLinkId = anaList.body?.connections?.[0]?.id;
  const badUnlink = await api('/api/v1/connections/unlink', { cookie: outsider.cookie, method: 'POST', body: { id: anaLinkId } });
  check('only the link holder can unlink', badUnlink.status === 404);
  const anaUnlink = await api('/api/v1/connections/unlink', { cookie: ana.cookie, method: 'POST', body: { id: anaLinkId } });
  check('ana unlinks', anaUnlink.status === 200 && anaUnlink.body?.removed === true);
  const anaAfter = await api('/api/v1/connections', { cookie: ana.cookie });
  check('ana list is empty after unlink', anaAfter.body?.connections?.length === 0);
  const boStill = await api('/api/v1/connections/feed?limit=5', { cookie: bo.cookie });
  check('bo (still linked) keeps reading the shared account', boStill.status === 200 && (boStill.body?.posts?.length || 0) > 0);
  const boUnlink = await api('/api/v1/connections/unlink', {
    cookie: bo.cookie,
    method: 'POST',
    body: { id: boConnect.body?.connection?.id }
  });
  check('bo unlinks too (account retires with its last link)', boUnlink.status === 200);
  const boFeedAfter = await api('/api/v1/connections/feed', { cookie: bo.cookie });
  check('feed with no connections is an empty page, not an error', boFeedAfter.status === 200 && boFeedAfter.body?.posts?.length === 0);

  if (process.env.TT_VERIFY_LIVE === '1') {
    console.log('\nH. live network pull (TT_VERIFY_LIVE=1)');
    const hn = await api('/api/v1/connections', { cookie: bo.cookie, method: 'POST', body: { provider: 'hackernews', fields: { feed: 'top' } } });
    check('hackernews connects', hn.status === 200);
    const hnFeed = await api('/api/v1/connections/feed?limit=10&sync=force', { cookie: bo.cookie });
    const hnSync = hnFeed.body?.synced?.find((entry) => entry.provider === 'hackernews');
    check('hackernews feed pulls live stories', hnFeed.status === 200 && !!hnSync && hnSync.error === null && (hnFeed.body?.posts?.length || 0) > 0);
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((name) => `  ✗ ${name}`).join('\n'));
    process.exit(1);
  }
};

run().catch((error) => {
  console.error('verification crashed:', error);
  process.exit(1);
});
