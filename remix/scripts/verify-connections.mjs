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
  // regression (code-review): partial updates must not clobber other fields
  const hideFilter = await api('/api/v1/connections/filters', {
    cookie: ana.cookie,
    method: 'POST',
    body: { name: 'Hider', prompt: 'hide test topics', action: 'hide' }
  });
  await api('/api/v1/connections/filters', { cookie: ana.cookie, method: 'POST', body: { id: hideFilter.body?.filter?.id, enabled: false } });
  const afterToggle = await api('/api/v1/connections/filters', { cookie: ana.cookie });
  const toggled = (afterToggle.body?.filters || []).find((entry) => entry.id === hideFilter.body?.filter?.id);
  check('enabled-only toggle preserves the hide action', toggled?.action === 'hide' && toggled?.enabled === false);
  await api('/api/v1/connections/filters', { cookie: ana.cookie, method: 'POST', body: { id: hideFilter.body?.filter?.id, remove: true } });

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
  // regression (code-review): membership IS the authorization — unlinking
  // revokes the ex-member's acl grants on the personal posts
  const anaRevoked = await api(`/api/v1/things?id=${anaPost.id}`, { cookie: ana.cookie });
  check('unlink revokes the ex-member post access', anaRevoked.status === 404);
  const boStill = await api('/api/v1/connections/feed?limit=5', { cookie: bo.cookie });
  check('bo (still linked) keeps reading the shared account', boStill.status === 200 && (boStill.body?.posts?.length || 0) > 0);
  const boKeeps = await api(`/api/v1/things?id=${anaPost.id}`, { cookie: bo.cookie });
  check('remaining members keep their access', boKeeps.status === 200);
  const boUnlink = await api('/api/v1/connections/unlink', {
    cookie: bo.cookie,
    method: 'POST',
    body: { id: boConnect.body?.connection?.id }
  });
  check('bo unlinks too (account retires with its last link)', boUnlink.status === 200);
  const boFeedAfter = await api('/api/v1/connections/feed', { cookie: bo.cookie });
  check('feed with no connections is an empty page, not an error', boFeedAfter.status === 200 && boFeedAfter.body?.posts?.length === 0);

  console.log('\nH. SSO (OAuth) guardrails');
  const beginWall = await api('/api/v1/connections/oauth/begin', { method: 'POST', body: { provider: 'facebook' } });
  check('oauth begin without auth is 401', beginWall.status === 401);
  const beginUnknown = await api('/api/v1/connections/oauth/begin', { cookie: bo.cookie, method: 'POST', body: { provider: 'nope' } });
  check('oauth begin with unknown provider is 400', beginUnknown.status === 400);
  const beginNonOauth = await api('/api/v1/connections/oauth/begin', { cookie: bo.cookie, method: 'POST', body: { provider: 'demo' } });
  check('oauth begin with a non-SSO provider is 400', beginNonOauth.status === 400);
  const catalog = await api('/api/v1/connections/providers');
  const ssoProviders = (catalog.body?.providers || []).filter((provider) => provider.auth === 'oauth2');
  check('catalog carries the SSO providers (facebook/instagram/tiktok/youtube-account)',
    ['facebook', 'instagram', 'tiktok', 'youtube-account'].every((id) => ssoProviders.some((provider) => provider.id === id)));
  for (const provider of ssoProviders) {
    const begin = await api('/api/v1/connections/oauth/begin', { cookie: bo.cookie, method: 'POST', body: { provider: provider.id } });
    if (provider.configured) {
      check(`${provider.id}: begin mints an authorize URL`, begin.status === 200 && /^https:\/\//.test(begin.body?.authorizeUrl || ''));
    } else {
      check(`${provider.id}: begin explains the missing credentials`, begin.status === 400 && /not configured/.test(begin.body?.error || ''));
    }
  }
  const fbConnect = await api('/api/v1/connections', { cookie: bo.cookie, method: 'POST', body: { provider: 'facebook', fields: {} } });
  check('fields-based connect refuses SSO providers', fbConnect.status === 400 && /sign-in/.test(fbConnect.body?.error || ''));
  check(
    'catalog carries the real home-timeline providers',
    ['reddit-account', 'mastodon-account', 'bluesky-account'].every((id) => (catalog.body?.providers || []).some((provider) => provider.id === id))
  );
  check(
    'catalog carries the remaining SSO scaffolds',
    ['x', 'twitch', 'tumblr', 'pinterest', 'linkedin', 'spotify'].every((id) => (catalog.body?.providers || []).some((provider) => provider.id === id && provider.auth === 'oauth2'))
  );
  // stale-while-revalidate: a defer read serves the stored page with ZERO
  // provider fan-out (synced is empty), so first paint never blocks on I/O
  const deferRead = await api('/api/v1/connections/feed?limit=5&sync=defer', { cookie: bo.cookie });
  check('sync=defer read skips the provider fan-out', deferRead.status === 200 && (deferRead.body?.synced || []).length === 0);
  const bskyCatalog = (catalog.body?.providers || []).find((provider) => provider.id === 'bluesky-account');
  check(
    'bluesky-account is credential-auth with a masked app-password field',
    bskyCatalog?.auth === 'credential' && bskyCatalog?.configured === true && bskyCatalog?.fields?.some((field) => field.key === 'appPassword' && field.secret === true)
  );
  const bskyMissing = await api('/api/v1/connections', { cookie: bo.cookie, method: 'POST', body: { provider: 'bluesky-account', fields: { handle: 'someone.bsky.social' } } });
  check('bluesky-account requires the app password field', bskyMissing.status === 400 && /App password/i.test(bskyMissing.body?.error || ''));
  const badState = await fetch(`${BASE}/api/v1/connections/oauth/callback?code=x&state=garbage`, {
    headers: { Cookie: bo.cookie },
    redirect: 'manual'
  });
  check('callback with a forged state redirects with oauthError', badState.status === 302 && /oauthError=/.test(badState.headers.get('location') || ''));
  const anonCallback = await fetch(`${BASE}/api/v1/connections/oauth/callback?code=x&state=y`, { redirect: 'manual' });
  check('callback without a session redirects to /login', anonCallback.status === 302 && /\/login/.test(anonCallback.headers.get('location') || ''));

  console.log('\nI. virtual YouTube subscription list');
  const CH_A = { id: 'UCXuqSBlHAE6Xw-yeJA0Tunw', title: 'Linus Tech Tips', thumbnail: null };
  const CH_B = { id: 'UCsXVk37bltHxD1rDPwtNM8Q', title: 'Kurzgesagt', thumbnail: null };
  const sub1 = await api('/api/v1/connections/youtube/channels', { cookie: bo.cookie, method: 'POST', body: { add: CH_A } });
  check('first subscribe auto-creates the virtual connection', sub1.status === 200 && sub1.body?.channels?.length === 1);
  const sub2 = await api('/api/v1/connections/youtube/channels', { cookie: bo.cookie, method: 'POST', body: { add: CH_B } });
  check('second channel joins the list', sub2.status === 200 && sub2.body?.channels?.length === 2);
  const dupSub = await api('/api/v1/connections/youtube/channels', { cookie: bo.cookie, method: 'POST', body: { add: CH_A } });
  check('re-subscribing the same channel is idempotent', dupSub.status === 200 && dupSub.body?.channels?.length === 2);
  const listWithChannels = await api('/api/v1/connections', { cookie: bo.cookie });
  const ytConnection = (listWithChannels.body?.connections || []).find((connection) => connection.provider === 'youtube');
  check('connections list carries the channel list + handle', ytConnection?.channels?.length === 2 && /2 channels/.test(ytConnection?.account?.handle || ''));
  const badChannel = await api('/api/v1/connections/youtube/channels', { cookie: bo.cookie, method: 'POST', body: { add: { id: 'not-a-channel' } } });
  check('invalid channel ids are refused', badChannel.status === 400);
  // regression (code-review): re-connecting the provider must MERGE, never
  // wipe, the managed channel list
  const reconnect = await api('/api/v1/connections', { cookie: bo.cookie, method: 'POST', body: { provider: 'youtube', fields: {} } });
  check('youtube reconnect preserves the channel list', reconnect.status === 200 && (reconnect.body?.connection?.channels?.length || 0) === 2);
  const unsub = await api('/api/v1/connections/youtube/channels', { cookie: bo.cookie, method: 'POST', body: { remove: CH_B.id } });
  check('unsubscribe removes the channel', unsub.status === 200 && unsub.body?.channels?.length === 1);
  const otherList = await api('/api/v1/connections', { cookie: outsider.cookie });
  check('virtual lists are per-user (outsider has none)', (otherList.body?.connections || []).every((connection) => connection.provider !== 'youtube'));
  const searchWall = await api('/api/v1/connections/youtube/search?q=test');
  check('channel search requires auth', searchWall.status === 401);
  await api('/api/v1/connections/unlink', { cookie: bo.cookie, method: 'POST', body: { id: ytConnection?.id } });

  console.log('\nJ. relational source membership (§3: no unbounded arrays on the post)');
  // Section G retired the earlier demo account, so establish a fresh shared
  // identity: ana and bo both link the SAME demo handle, meaning one account
  // sources the posts for two members. The post doc must not grow per linker,
  // and its acl must never name an account (PublicPost.acl reaches every
  // reader, so a per-source entry would disclose the other members' accounts).
  const sharedHandle = `shared-${suffix}`;
  const anaShare = await api('/api/v1/connections', {
    cookie: ana.cookie,
    method: 'POST',
    body: { provider: 'demo', fields: { handle: sharedHandle } }
  });
  const boShare = await api('/api/v1/connections', {
    cookie: bo.cookie,
    method: 'POST',
    body: { provider: 'demo', fields: { handle: sharedHandle } }
  });
  check(
    'two members converge on one shared external account',
    anaShare.status === 200 &&
      boShare.status === 200 &&
      anaShare.body?.connection?.account?.id === boShare.body?.connection?.account?.id
  );
  const anaShape = await api('/api/v1/connections/feed?limit=5', { cookie: ana.cookie });
  const shapePost = anaShape.body?.posts?.[0];
  check('external post still resolves after the relational refactor', anaShape.status === 200 && !!shapePost);
  check(
    'personal post carries the CONSTANT tt:extsourced audience',
    Array.isArray(shapePost?.acl) && shapePost.acl.includes('tt:extsourced')
  );
  check(
    'post acl names NO external account (no tt:extacct/ leak to readers)',
    Array.isArray(shapePost?.acl) && shapePost.acl.every((entry) => !String(entry).includes('tt:extacct/'))
  );
  check(
    'post acl stays bounded (a constant audience, not one entry per linker)',
    Array.isArray(shapePost?.acl) && shapePost.acl.length <= 2
  );
  check('the embedded sourceIds array is gone from the wire shape', shapePost?.sourceIds === undefined);
  // bo reaches the SAME post doc through his own link — one post, many sources
  const boShape = await api('/api/v1/connections/feed?limit=5', { cookie: bo.cookie });
  const boSame = (boShape.body?.posts || []).some((post) => post.id === shapePost?.id);
  check('a second linked user reaches the SAME post doc (one post, many sources)', boSame);
  // membership is the live authorization: an outsider with no link is denied
  const outsiderShape = await api(`/api/v1/things?id=${shapePost?.id}`, { cookie: outsider.cookie });
  check('tt:extsourced denies a viewer who sources nothing', outsiderShape.status === 404);
  check('tt:extsourced denies an anonymous viewer', (await api(`/api/v1/things?id=${shapePost?.id}`)).status === 404);
  // paging must not double-count a post reachable through more than one row
  const paged = await api('/api/v1/connections/feed?limit=10', { cookie: ana.cookie });
  const pagedIds = (paged.body?.posts || []).map((post) => post.id);
  check('feed page contains no duplicate posts', pagedIds.length === new Set(pagedIds).size);
  check('feed page honours its limit', pagedIds.length <= 10);
  // unlinking revokes instantly — links, not materialized grants, are the truth
  const anaLinks = await api('/api/v1/connections', { cookie: ana.cookie });
  const demoLink = (anaLinks.body?.connections || []).find((connection) => connection.provider === 'demo');
  await api('/api/v1/connections/unlink', { cookie: ana.cookie, method: 'POST', body: { id: demoLink?.id } });
  check(
    'unlink revokes tt:extsourced instantly (no grant sweep)',
    (await api(`/api/v1/things?id=${shapePost?.id}`, { cookie: ana.cookie })).status === 404
  );
  check(
    'the other linked user still sees the post after their peer unlinks',
    (await api(`/api/v1/things?id=${shapePost?.id}`, { cookie: bo.cookie })).status === 200
  );

  if (process.env.TT_VERIFY_LIVE === '1') {
    console.log('\nK. live network pull (TT_VERIFY_LIVE=1)');
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
