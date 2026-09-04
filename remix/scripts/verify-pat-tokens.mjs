#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
// Live verification of personal access tokens (Settings → Token minter) on
// the merged PAT × app-namespace tree — real API only, no mocks, no direct DB
// access (FUNDAMENTALS §2). Covers the scope catalog, use accounting, the
// onlyCreatedThings sandbox with tt:token grant layering, the visibility
// fence (public-only / private-only tokens), default-deny off the things
// family, and the seams the app-namespace merge introduced (shared routes
// resolving PATs and app tokens side by side).
//
//   node scripts/verify-pat-tokens.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or http://127.0.0.1:19582.

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:19582';
// search/feed responses key `posts` by thing id (develop) — older builds returned an array
const postRows = (body) => (Array.isArray(body?.posts) ? body.posts : Object.values(body?.posts || {}));


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
  const body = await res.json().catch(() => null);
  return { username, cookie: match[0], userId: body?.user?.id ? String(body.user.id) : '' };
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

  const postWithComment = await api(`/api/v1/things?id=${postId}`, { cookie: session.cookie });
  check(
    'session permalink read discovers the PAT-created comment relationally',
    postWithComment.status === 200 &&
      postWithComment.body?.post?.commentCount === 1 &&
      postWithComment.body?.post?.commentCounts?.direct === 1 &&
      postWithComment.body?.post?.commentCounts?.replies === 0 &&
      postWithComment.body?.post?.commentCounts?.total === 1 &&
      postWithComment.body?.post?.commentCounts?.loaded === 1 &&
      postWithComment.body?.post?.comments?.some((comment) => comment.id === commented.body?.comment?.id),
    JSON.stringify({
      status: postWithComment.status,
      commentCount: postWithComment.body?.post?.commentCount,
      commentCounts: postWithComment.body?.post?.commentCounts,
      commentIds: postWithComment.body?.post?.comments?.map((comment) => comment.id)
    })
  );

  const replied = await api('/api/v1/things/comment', {
    token: fullToken,
    method: 'POST',
    body: { id: commented.body?.comment?.id, text: 'pat reply' }
  });
  check('PAT replies to a comment through the dedicated route', replied.status === 200 && replied.body?.ok === true);

  const postWithReply = await api(`/api/v1/things?id=${postId}`, { cookie: session.cookie });
  check(
    'session permalink separates direct and reply count layers',
    postWithReply.status === 200 &&
      postWithReply.body?.post?.commentCount === 2 &&
      postWithReply.body?.post?.commentCounts?.direct === 1 &&
      postWithReply.body?.post?.commentCounts?.replies === 1 &&
      postWithReply.body?.post?.commentCounts?.total === 2 &&
      postWithReply.body?.post?.commentCounts?.loaded === 1 &&
      postWithReply.body?.post?.comments?.[0]?.comments?.some((comment) => comment.id === replied.body?.comment?.id),
    JSON.stringify({
      status: postWithReply.status,
      commentCount: postWithReply.body?.post?.commentCount,
      commentCounts: postWithReply.body?.post?.commentCounts,
      replyIds: postWithReply.body?.post?.comments?.[0]?.comments?.map((comment) => comment.id)
    })
  );

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
console.log('F. Visibility fence (public-only / private-only tokens)');
{
  // fresh user: clean listing state + fresh rate-limit buckets
  const owner = await registerSession('vis');

  const badMode = await api('/api/v1/tokens', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'typo', scopes: ['things'], visibility: 'sideways' }
  });
  check('mint rejects an unknown visibility', badMode.status === 400, `${badMode.status}`);

  // the fixture set, made by the full session: one public post, one private
  // post, one private data thing
  const publicPost = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'public fixture' } }
  });
  const publicPostId = publicPost.body?.post?.id;
  check('fixture: session creates a public post', publicPost.status === 200 && !!publicPostId);
  const privatePost = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'private fixture' }, acl: ['tt:user'] }
  });
  const privatePostId = privatePost.body?.post?.id;
  const privateData = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { secret: 'private fixture' }, acl: ['tt:user'] }
  });
  const privateDataId = privateData.body?.thing?.id;
  check('fixture: session creates private things', !!privatePostId && !!privateDataId);

  // --- public-only ---------------------------------------------------------
  const pub = await mintPat(owner.cookie, { name: 'public-only', scopes: ['things'], visibility: 'public' });
  check('mint records visibility', pub.tokenInfo?.visibility === 'public', JSON.stringify(pub.tokenInfo));
  const pubSelf = await api('/api/v1/tokens/self', { token: pub.token });
  check('introspection reports the fence', pubSelf.body?.token?.visibility === 'public');

  const seesPublic = await api(`/api/v1/things?id=${publicPostId}`, { token: pub.token });
  check('public-only sees a public post', seesPublic.status === 200);
  const blindPrivate = await api(`/api/v1/things?id=${privateDataId}`, { token: pub.token });
  check('public-only cannot see a private thing (owner or not)', blindPrivate.status === 404, `${blindPrivate.status}`);

  const pubList = await api('/api/v1/things?thingtime=data', { token: pub.token });
  check(
    'public-only listings omit private things',
    pubList.status === 200 && !(pubList.body?.things || []).some((t) => t.id === privateDataId),
    `${pubList.status}`
  );

  const pubCreatePrivate = await api('/api/v1/things', {
    token: pub.token,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { leak: true }, acl: ['tt:user'] }
  });
  check('public-only cannot create private things', pubCreatePrivate.status === 403, `${pubCreatePrivate.status}`);
  const pubCreate = await api('/api/v1/things', {
    token: pub.token,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { open: true } }
  });
  check(
    'public-only default create is public',
    pubCreate.status === 200 && pubCreate.body?.thing?.visibility === 'public',
    JSON.stringify(pubCreate.body?.thing?.visibility)
  );

  const pubHide = await api('/api/v1/things', {
    token: pub.token,
    method: 'PATCH',
    body: { id: publicPostId, acl: ['tt:user'] }
  });
  check('public-only cannot make a public thing private', pubHide.status === 403, `${pubHide.status}`);
  // tt:inherit is server-assigned. If it were accepted as input it would walk
  // straight past the fence, whose post-resolution check deliberately skips
  // inherit acls on the grounds that the target was already judged.
  const pubInherit = await api('/api/v1/things', {
    token: pub.token,
    method: 'PATCH',
    body: { id: publicPostId, acl: ['tt:inherit'] }
  });
  check(
    'public-only cannot hide a public thing behind an inherit acl',
    pubInherit.status === 400,
    `${pubInherit.status}`
  );
  const pubEditPrivate = await api('/api/v1/things', {
    token: pub.token,
    method: 'PATCH',
    body: { id: privateDataId, crystal: { sneaky: true } }
  });
  check('public-only cannot edit a private thing', pubEditPrivate.status === 403, `${pubEditPrivate.status}`);
  const pubDeletePrivate = await api('/api/v1/things', { token: pub.token, method: 'DELETE', body: { id: privateDataId } });
  check('public-only cannot delete a private thing', pubDeletePrivate.status === 403, `${pubDeletePrivate.status}`);

  const pubCommentPrivate = await api('/api/v1/things/comment', {
    token: pub.token,
    method: 'POST',
    body: { id: privatePostId, text: 'psst' }
  });
  check('public-only cannot comment on a private post', pubCommentPrivate.status === 404, `${pubCommentPrivate.status}`);
  const pubComment = await api('/api/v1/things/comment', {
    token: pub.token,
    method: 'POST',
    body: { id: publicPostId, text: 'public comment' }
  });
  check('public-only comments on a public post (inherit resolves)', pubComment.status === 200);
  const pubCommentList = await api(`/api/v1/things?target=${publicPostId}&thingtime=comment`, { token: pub.token });
  check(
    'public-only lists inherit-acl children of a public target',
    pubCommentList.status === 200 && (pubCommentList.body?.things || []).length > 0,
    `${pubCommentList.status}`
  );
  const pubReact = await api('/api/v1/things/react', {
    token: pub.token,
    method: 'POST',
    body: { id: publicPostId, emoji: '🌐' }
  });
  check('public-only reacts to a public post', pubReact.status === 200);

  // Profile listing: the fence rides /api/v1/things/user too. postCount is
  // computed from the same match, so an unfenced match would report the
  // owner's private posts to a token that must never learn they exist.
  const pubProfile = await api(`/api/v1/things/user?username=${owner.username}`, { token: pub.token });
  check(
    'public-only profile listing omits the owner’s private post',
    pubProfile.status === 200 && !(pubProfile.body?.posts || []).some((p) => p.id === privatePostId),
    `${pubProfile.status}`
  );
  check(
    'public-only profile postCount excludes private posts',
    pubProfile.body?.postCount === 1,
    `postCount=${pubProfile.body?.postCount}`
  );

  // --- private-only --------------------------------------------------------
  const priv = await mintPat(owner.cookie, { name: 'private-only', scopes: ['things'], visibility: 'private' });
  const privSeesPublic = await api(`/api/v1/things?id=${publicPostId}`, { token: priv.token });
  check('private-only cannot see a public post', privSeesPublic.status === 404, `${privSeesPublic.status}`);
  const privSeesPrivate = await api(`/api/v1/things?id=${privateDataId}`, { token: priv.token });
  check('private-only sees the owner’s private thing', privSeesPrivate.status === 200, `${privSeesPrivate.status}`);

  const privFeed = await api('/api/v1/things/feed', { token: priv.token });
  check(
    'private-only feed omits public posts',
    privFeed.status === 200 && !(privFeed.body?.posts || []).some((p) => p.id === publicPostId),
    `${privFeed.status}`
  );
  // anon=1 asks the feed/search loaders for the logged-out, edge-cacheable
  // view. It ignores cookies by design, but must NOT ignore a Bearer token:
  // skipping actor resolution would hand a fenced token the whole public
  // sphere its fence exists to keep it out of, one query parameter deep.
  const privFeedAnon = await api('/api/v1/things/feed?anon=1', { token: priv.token });
  check(
    'private-only cannot reach public posts through the anon feed view',
    privFeedAnon.status === 200 && !(privFeedAnon.body?.posts || []).some((p) => p.id === publicPostId),
    `${privFeedAnon.status}`
  );
  const privSearchAnon = await api('/api/v1/things/search?anon=1&q=public%20fixture', { token: priv.token });
  check(
    'private-only cannot reach public posts through the anon search view',
    privSearchAnon.status === 200 &&
      ![...postRows(privSearchAnon), ...(privSearchAnon.body?.things || [])].some((t) => t.id === publicPostId),
    `${privSearchAnon.status}`
  );
  // a genuinely credential-less anon=1 call still gets the cacheable public
  // view — the fence must not have cost logged-out traffic its edge cache
  const anonFeed = await api('/api/v1/things/feed?anon=1');
  check(
    'anon=1 without a credential still serves the public feed',
    anonFeed.status === 200 && (anonFeed.body?.posts || []).some((p) => p.id === publicPostId),
    `${anonFeed.status}`
  );
  // …and that cacheable entry must be keyed on Authorization. The two checks
  // above only prove the ORIGIN fences a Bearer credential; `public, s-maxage`
  // is precisely what licenses a shared cache to replay a stored response to
  // an Authorization-carrying request, so without this the warm anon body
  // reaches a fenced token without the origin ever being asked.
  const varies = (headers) =>
    (headers.get('vary') || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .includes('authorization');
  check('the cacheable anon feed varies on Authorization', varies(anonFeed.headers), anonFeed.headers.get('vary') || '(none)');
  const anonSearch = await api('/api/v1/things/search?anon=1&q=public%20fixture');
  check(
    'the cacheable anon search varies on Authorization',
    anonSearch.status === 200 && varies(anonSearch.headers),
    `${anonSearch.status} ${anonSearch.headers.get('vary') || '(none)'}`
  );
  // the fenced answers must stay uncacheable rather than sharing that key
  check(
    'a fenced anon=1 feed answer carries no shared-cache policy',
    !(privFeedAnon.headers.get('cache-control') || '').includes('s-maxage'),
    privFeedAnon.headers.get('cache-control') || '(none)'
  );

  const privCreate = await api('/api/v1/things', {
    token: priv.token,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { vaulted: true } }
  });
  check(
    'private-only default create is private',
    privCreate.status === 200 && privCreate.body?.thing?.visibility === 'private',
    JSON.stringify(privCreate.body?.thing?.visibility)
  );
  const privCreatePublic = await api('/api/v1/things', {
    token: priv.token,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'megaphone' }, acl: ['tt:all'] }
  });
  check('private-only cannot create public things', privCreatePublic.status === 403, `${privCreatePublic.status}`);

  const privEdit = await api('/api/v1/things', {
    token: priv.token,
    method: 'PATCH',
    body: { id: privateDataId, crystal: { vaulted: 'edited' } }
  });
  check('private-only edits private things', privEdit.status === 200, `${privEdit.status}`);
  const privPublish = await api('/api/v1/things', {
    token: priv.token,
    method: 'PATCH',
    body: { id: privateDataId, acl: ['tt:all'] }
  });
  check('private-only cannot publish a private thing', privPublish.status === 403, `${privPublish.status}`);
  // the mirror of the public-only inherit case: an inherit acl on a targeted
  // thing resolves to the target's audience, so accepting it as input would
  // let a private-only token publish by proxy
  const privInherit = await api('/api/v1/things', {
    token: priv.token,
    method: 'PATCH',
    body: { id: privateDataId, acl: ['tt:inherit'] }
  });
  check(
    'private-only cannot publish a private thing via an inherit acl',
    privInherit.status === 400,
    `${privInherit.status}`
  );
  const privReactPublic = await api('/api/v1/things/react', {
    token: priv.token,
    method: 'POST',
    body: { id: publicPostId, emoji: '🔒' }
  });
  check('private-only cannot react to a public post', privReactPublic.status === 404, `${privReactPublic.status}`);

  const privProfile = await api(`/api/v1/things/user?username=${owner.username}`, { token: priv.token });
  check(
    'private-only profile listing omits the owner’s public post',
    privProfile.status === 200 && !(privProfile.body?.posts || []).some((p) => p.id === publicPostId),
    `${privProfile.status}`
  );
  check(
    'private-only profile postCount excludes public posts',
    privProfile.body?.postCount === 1,
    `postCount=${privProfile.body?.postCount}`
  );

  // --- unrestricted stays unrestricted ------------------------------------
  const all = await mintPat(owner.cookie, { name: 'both', scopes: ['things'] });
  check('default mint stays visibility "all"', all.tokenInfo?.visibility === 'all', JSON.stringify(all.tokenInfo?.visibility));
  const allSees = await api(`/api/v1/things?id=${privateDataId}`, { token: all.token });
  const allSeesPublic = await api(`/api/v1/things?id=${publicPostId}`, { token: all.token });
  check('unrestricted token still sees both audiences', allSees.status === 200 && allSeesPublic.status === 200);
}

// ---------------------------------------------------------------------------
console.log('G. Hidden visibility — unlisted things behind random link keys');
{
  const owner = await registerSession('hid');
  const peeker = await registerSession('peek');

  const created = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'hidden fixture' }, visibility: 'hidden' }
  });
  const hiddenId = created.body?.post?.id;
  const linkKey = created.body?.post?.linkKey;
  check('hidden create returns visibility "hidden"', created.status === 200 && created.body?.post?.visibility === 'hidden');
  check('owner projection carries the random linkKey', typeof linkKey === 'string' && linkKey.length >= 20, String(linkKey).slice(0, 8));

  const anonBlind = await api(`/api/v1/things?id=${hiddenId}`, {});
  check('anonymous without the key sees nothing', anonBlind.status === 404, `${anonBlind.status}`);
  const anonKeyed = await api(`/api/v1/things?id=${hiddenId}&key=${encodeURIComponent(linkKey)}`, {});
  check('anonymous WITH the key views it', anonKeyed.status === 200 && anonKeyed.body?.post?.id === hiddenId, `${anonKeyed.status}`);
  check('the key never leaks the linkKey back (non-owner projection)', anonKeyed.body?.post?.linkKey === undefined);
  const wrongKey = await api(`/api/v1/things?id=${hiddenId}&key=not-the-key`, {});
  check('a wrong key stays blind', wrongKey.status === 404, `${wrongKey.status}`);

  const anonFeed = await api('/api/v1/things/feed?limit=50', {});
  check(
    'hidden posts never enter the public feed',
    anonFeed.status === 200 && !(anonFeed.body?.posts || []).some((p) => p.id === hiddenId)
  );
  const ownerFeed = await api('/api/v1/things/feed?limit=50', { cookie: owner.cookie });
  check(
    'the owner still sees it in their own feed',
    ownerFeed.status === 200 && (ownerFeed.body?.posts || []).some((p) => p.id === hiddenId),
    `${ownerFeed.status}`
  );
  const profile = await api(`/api/v1/things/user?username=${owner.username}`, { cookie: peeker.cookie });
  check(
    'profile listings hide it from other users',
    profile.status === 200 && !(profile.body?.posts || []).some((p) => p.id === hiddenId)
  );

  const blindComment = await api('/api/v1/things/comment', {
    cookie: peeker.cookie,
    method: 'POST',
    body: { id: hiddenId, text: 'sneaky' }
  });
  check('another user without the key cannot comment', blindComment.status === 404, `${blindComment.status}`);
  const keyedComment = await api('/api/v1/things/comment', {
    cookie: peeker.cookie,
    method: 'POST',
    body: { id: hiddenId, text: 'found you via the link', key: linkKey }
  });
  check('the key admits engagement (comment)', keyedComment.status === 200, `${keyedComment.status}`);
  const keyedReact = await api('/api/v1/things/react', {
    cookie: peeker.cookie,
    method: 'POST',
    body: { id: hiddenId, emoji: '🕵️', key: linkKey }
  });
  check('the key admits engagement (react)', keyedReact.status === 200, `${keyedReact.status}`);

  const unhide = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'PATCH',
    body: { id: hiddenId, visibility: 'private' }
  });
  check('owner can move it out of hidden', unhide.status === 200 && unhide.body?.thing?.visibility === 'private');
  const retiredKey = await api(`/api/v1/things?id=${hiddenId}&key=${encodeURIComponent(linkKey)}`, {});
  check('leaving hidden retires the link instantly', retiredKey.status === 404, `${retiredKey.status}`);

  const rehide = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'PATCH',
    body: { id: hiddenId, visibility: 'hidden' }
  });
  const newKey = rehide.body?.thing?.linkKey;
  check('re-hiding mints a FRESH key', rehide.status === 200 && typeof newKey === 'string' && newKey !== linkKey);
  const oldKeyDead = await api(`/api/v1/things?id=${hiddenId}&key=${encodeURIComponent(linkKey)}`, {});
  check('the old key stays dead after re-hide', oldKeyDead.status === 404, `${oldKeyDead.status}`);
  const newKeyWorks = await api(`/api/v1/things?id=${hiddenId}&key=${encodeURIComponent(newKey)}`, {});
  check('the fresh key works', newKeyWorks.status === 200, `${newKeyWorks.status}`);
}

// ---------------------------------------------------------------------------
console.log('H. GET bridge — CRUD over plain GET URLs (allowGet tokens)');
{
  const owner = await registerSession('getb');
  const bridge = (query) => `/api/v1/get?${new URLSearchParams(query)}`;

  const plain = await mintPat(owner.cookie, { name: 'no-get', scopes: ['things'] });
  const refused = await api(bridge({ token: plain.token, op: 'self' }), {});
  check('tokens without the tick are refused', refused.status === 403, `${refused.status}`);

  const minted = await mintPat(owner.cookie, { name: 'get-bridge', scopes: ['things'], maxUses: 20, allowGet: true });
  check('mint records allowGet', minted.tokenInfo?.allowGet === true);

  const self = await api(bridge({ token: minted.token, op: 'self' }), {});
  check('op=self introspects', self.status === 200 && self.body?.token?.allowGet === true, `${self.status}`);
  check('op=self is free (no use burned)', self.body?.token?.usesRemaining === 20, JSON.stringify(self.body?.token?.usesRemaining));
  check('bridge responses are no-store', /no-store/.test(self.headers.get('cache-control') || ''), self.headers.get('cache-control'));
  check('bridge responses never leak a referrer', self.headers.get('referrer-policy') === 'no-referrer');

  const created = await api(
    bridge({ token: minted.token, op: 'create', thingtime: '["post"]', crystal: '{"type":"text","text":"hello from a GET-only agent"}' }),
    {}
  );
  const postId = created.body?.post?.id;
  check('op=create makes a post', created.status === 200 && !!postId, `${created.status}`);

  const fetched = await api(bridge({ token: minted.token, op: 'get', id: postId }), {});
  check('op=get reads it back', fetched.status === 200 && fetched.body?.post?.id === postId);

  const dataMade = await api(bridge({ token: minted.token, op: 'create', thingtime: 'data', crystal: '{"note":"csv thingtime"}' }), {});
  const dataId = dataMade.body?.thing?.id;
  check('bare csv thingtime works', dataMade.status === 200 && !!dataId, `${dataMade.status}`);

  const patched = await api(bridge({ token: minted.token, op: 'update', id: dataId, crystal: '{"note":"edited via GET"}' }), {});
  check('op=update PATCHes', patched.status === 200 && patched.body?.thing?.crystal?.note === 'edited via GET');

  const reacted = await api(bridge({ token: minted.token, op: 'react', id: postId, emoji: '🌍' }), {});
  check('op=react toggles (emoji stays a string)', reacted.status === 200, `${reacted.status}`);
  const commented = await api(bridge({ token: minted.token, op: 'comment', id: postId, text: 'GET comment' }), {});
  check('op=comment comments', commented.status === 200 && commented.body?.comment?.text === 'GET comment', `${commented.status}`);

  const listed = await api(bridge({ token: minted.token, op: 'list', thingtime: 'data' }), {});
  check('op=list lists', listed.status === 200 && (listed.body?.things || []).some((t) => t.id === dataId));

  const removed = await api(bridge({ token: minted.token, op: 'delete', id: dataId }), {});
  check('op=delete deletes', removed.status === 200 && removed.body?.ok === true, `${removed.status}`);

  // 8 consuming calls so far (create, get, create, update, react, comment,
  // list, delete) — self stays free and proves the accounting
  const after = await api(bridge({ token: minted.token, op: 'self' }), {});
  check('use accounting matches the call count', after.body?.token?.usesRemaining === 12, JSON.stringify(after.body?.token?.usesRemaining));

  const badOp = await api(bridge({ token: minted.token, op: 'teleport' }), {});
  check('unknown ops 400', badOp.status === 400, `${badOp.status}`);

  const readOnly = await mintPat(owner.cookie, { name: 'get-read', scopes: ['things.read'], maxUses: 5, allowGet: true });
  const scopeBlocked = await api(bridge({ token: readOnly.token, op: 'create', thingtime: 'data', crystal: '{"nope":true}' }), {});
  check('missing scope 403s on the bridge too', scopeBlocked.status === 403, `${scopeBlocked.status}`);
  const scopeFree = await api(bridge({ token: readOnly.token, op: 'self' }), {});
  check('bridge scope 403s burn nothing', scopeFree.body?.token?.usesRemaining === 5);

  const cookieOnly = await api(bridge({ op: 'get', id: postId }), { cookie: owner.cookie });
  check('cookies alone never authorize the bridge', cookieOnly.status === 401, `${cookieOnly.status}`);

  // fence × bridge: a public-only GET token cannot be walked into private data
  const fenced = await mintPat(owner.cookie, { name: 'get-public', scopes: ['things'], visibility: 'public', allowGet: true });
  const privateData = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { secret: true }, acl: ['tt:user'] }
  });
  const fencedBlind = await api(bridge({ token: fenced.token, op: 'get', id: privateData.body?.thing?.id }), {});
  check('visibility fence rides the bridge', fencedBlind.status === 404, `${fencedBlind.status}`);
  const fencedSees = await api(bridge({ token: fenced.token, op: 'get', id: postId }), {});
  check('…while public things stay reachable', fencedSees.status === 200, `${fencedSees.status}`);
}

// ---------------------------------------------------------------------------
console.log('I. Custom audiences (capabilities + groups) and the hidden-only fence');
{
  const owner = await registerSession('cma');
  const reader = await registerSession('cmr');
  const writer = await registerSession('cmw');

  // --- hidden-only token fence --------------------------------------------
  const hiddenTok = await mintPat(owner.cookie, { name: 'hidden-only', scopes: ['things'], visibility: 'hidden' });
  check('mint records the hidden fence', hiddenTok.tokenInfo?.visibility === 'hidden');
  const hidMade = await api('/api/v1/things', {
    token: hiddenTok.token,
    method: 'POST',
    body: { thingtime: ['data'], crystal: { born: 'hidden' } }
  });
  check(
    'hidden-only creates are born hidden with a link key',
    hidMade.status === 200 && hidMade.body?.thing?.visibility === 'hidden' && !!hidMade.body?.thing?.linkKey,
    JSON.stringify(hidMade.body?.thing?.visibility)
  );
  const hidPublic = await api('/api/v1/things', {
    token: hiddenTok.token,
    method: 'POST',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'loud' }, acl: ['tt:all'] }
  });
  check('hidden-only cannot create public things', hidPublic.status === 403, `${hidPublic.status}`);

  // --- custom acl: per-user capability matrix ------------------------------
  const post = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: {
      thingtime: ['post'],
      crystal: { type: 'text', text: 'custom audience fixture' },
      acl: ['tt:custom', 'tt:user', `tt:user/${reader.username}`, `tt:user/${writer.username}/write`]
    }
  });
  const postId = post.body?.post?.id;
  check('custom create round-trips visibility "custom"', post.status === 200 && post.body?.post?.visibility === 'custom');

  const readerSees = await api(`/api/v1/things?id=${postId}`, { cookie: reader.cookie });
  check('read grant admits viewing', readerSees.status === 200, `${readerSees.status}`);
  const anonBlind = await api(`/api/v1/things?id=${postId}`, {});
  check('private baseline hides it from everyone else', anonBlind.status === 404, `${anonBlind.status}`);

  const readerComment = await api('/api/v1/things/comment', { cookie: reader.cookie, method: 'POST', body: { id: postId, text: 'hi' } });
  check('read-only users cannot comment (403)', readerComment.status === 403, `${readerComment.status}`);
  const readerReact = await api('/api/v1/things/react', { cookie: reader.cookie, method: 'POST', body: { id: postId, emoji: '👀' } });
  check('read-only users cannot react', readerReact.status === 403, `${readerReact.status}`);

  const writerComment = await api('/api/v1/things/comment', { cookie: writer.cookie, method: 'POST', body: { id: postId, text: 'editor here' } });
  check('write implies comment', writerComment.status === 200, `${writerComment.status}`);
  const writerEdit = await api('/api/v1/things', {
    cookie: writer.cookie,
    method: 'PATCH',
    body: { id: postId, crystal: { text: 'custom audience fixture — edited by writer ✏️' } }
  });
  check('write grant allows shared crystal editing', writerEdit.status === 200, `${writerEdit.status}`);
  const writerAclChange = await api('/api/v1/things', {
    cookie: writer.cookie,
    method: 'PATCH',
    body: { id: postId, acl: ['tt:all'] }
  });
  check('writers can never change the audience', writerAclChange.status === 403, `${writerAclChange.status}`);
  const writerDelete = await api('/api/v1/things', { cookie: writer.cookie, method: 'DELETE', body: { id: postId } });
  check('writers can never delete', writerDelete.status === 404 || writerDelete.status === 403, `${writerDelete.status}`);
  const readerEdit = await api('/api/v1/things', {
    cookie: reader.cookie,
    method: 'PATCH',
    body: { id: postId, crystal: { text: 'sneaky' } }
  });
  check('read grant does not edit', readerEdit.status === 403, `${readerEdit.status}`);

  // --- baseline toggles ----------------------------------------------------
  const toPublicBase = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'PATCH',
    body: { id: postId, acl: ['tt:custom', 'tt:user', 'tt:all', `tt:user/${writer.username}/write`] }
  });
  check('owner sets a public baseline', toPublicBase.status === 200 && toPublicBase.body?.thing?.visibility === 'custom');
  const anonReads = await api(`/api/v1/things?id=${postId}`, {});
  check('public baseline: everyone may read', anonReads.status === 200, `${anonReads.status}`);
  const readerCommentStill = await api('/api/v1/things/comment', {
    cookie: reader.cookie,
    method: 'POST',
    body: { id: postId, text: 'still?' }
  });
  check('…but general viewers still cannot comment (custom gate)', readerCommentStill.status === 403, `${readerCommentStill.status}`);

  const toHiddenBase = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'PATCH',
    body: { id: postId, acl: ['tt:custom', 'tt:user', 'tt:hidden', `tt:user/${writer.username}/write`] }
  });
  const customKey = toHiddenBase.body?.thing?.linkKey;
  check('hidden baseline mints a link key on a custom thing', toHiddenBase.status === 200 && !!customKey);
  const keyedRead = await api(`/api/v1/things?id=${postId}&key=${encodeURIComponent(customKey)}`, {});
  check('link-key holders read the custom thing', keyedRead.status === 200, `${keyedRead.status}`);
  const keyedComment = await api('/api/v1/things/comment', {
    cookie: reader.cookie,
    method: 'POST',
    body: { id: postId, text: 'via key', key: customKey }
  });
  check('…and a key alone still never grants comment', keyedComment.status === 403, `${keyedComment.status}`);

  // --- groups ---------------------------------------------------------------
  const group = await api('/api/v1/groups', { cookie: owner.cookie, method: 'POST', body: { name: 'QA circle', memberIds: [reader.userId] } });
  const groupId = group.body?.group?.id;
  check('group create returns the group', group.status === 201 && !!groupId, JSON.stringify(group.body));
  const sources = await api('/api/v1/groups/audience-sources', { cookie: owner.cookie });
  check('audience-sources lists the group', sources.status === 200 && (sources.body?.groups || []).some((g) => g.id === groupId));

  const grantGroup = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'PATCH',
    body: { id: postId, acl: ['tt:custom', 'tt:user', `tt:group/${groupId}/comment`] }
  });
  check('owner grants via group', grantGroup.status === 200);
  const memberComment = await api('/api/v1/things/comment', { cookie: reader.cookie, method: 'POST', body: { id: postId, text: 'as group member' } });
  check('group members inherit the group capability', memberComment.status === 200, `${memberComment.status}`);

  const feed = await api('/api/v1/things/feed?limit=50', { cookie: reader.cookie });
  check(
    'granted things land in the grantee’s feed',
    feed.status === 200 && (feed.body?.posts || []).some((p) => p.id === postId),
    `${feed.status}`
  );

  const shrink = await api('/api/v1/groups', { cookie: owner.cookie, method: 'PATCH', body: { id: groupId, memberIds: [] } });
  check('member list replaces whole', shrink.status === 200 && shrink.body?.group?.memberCount === 0);
  const exMemberComment = await api('/api/v1/things/comment', { cookie: reader.cookie, method: 'POST', body: { id: postId, text: 'still in?' } });
  check('membership removal revokes instantly', exMemberComment.status === 403 || exMemberComment.status === 404, `${exMemberComment.status}`);
  const exMemberSees = await api(`/api/v1/things?id=${postId}`, { cookie: reader.cookie });
  check('…including view (baseline private again)', exMemberSees.status === 404, `${exMemberSees.status}`);

  const dropGroup = await api('/api/v1/groups', { cookie: owner.cookie, method: 'DELETE', body: { id: groupId } });
  check('group delete works', dropGroup.status === 200);
  const generic = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: { thingtime: ['group'], crystal: { name: 'forged' } }
  });
  // 403 = protected-kind refusal, 400 = unregistered-thingtime refusal —
  // either way the generic path can never mint a group
  check('generic CRUD refuses group things (protected kind)', generic.status === 403 || generic.status === 400, `${generic.status}`);
}

// ---------------------------------------------------------------------------
console.log('');
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} FAILED:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
