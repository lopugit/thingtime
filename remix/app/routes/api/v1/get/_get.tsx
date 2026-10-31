import { json } from '~/api/http';

import { resolveGetBridgeActor, resolveGetBridgeSelf } from '~/api/utils/auth/patTokens';
import { prepareAttachmentCascadeForThing } from '~/api/utils/attachments/attachments';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import {
  addComment,
  createThing,
  deleteThing,
  getFeed,
  getThing,
  isPostThing,
  listThings,
  sharePost,
  toggleReaction,
  toggleSave,
  toPublicPosts,
  toPublicThings,
  updateThing,
  upsertThing,
  viewerOf,
  withLinkKeys,
  type PostType,
  type PostVisibility
} from '~/api/utils/things/things';
import { searchThings } from '~/api/utils/things/search';

// GET /api/v1/get — the GET bridge: the whole PAT things surface as plain GET
// URLs, for agents that can browse but cannot send headers, bodies, or
// non-GET verbs. The token rides ?token= (URLs land in logs and history —
// a trade only tokens minted with the "Works via GET links" tick may make;
// resolveGetBridgeActor enforces meta.allowGet). Cookies are never read, so a
// mutating GET here can't be forged cross-site with ambient credentials: the
// unguessable token IS the request authorization.
//
//   /api/v1/get?token=<pat>&op=<op>[&body=<url-encoded JSON>][&<field>=…]
//
// op ∈ get | list | search | feed | self | create | update | upsert | delete
//      | react | comment | save | share — each the exact behaviour (scopes,
// use accounting, sandbox, visibility fence, rate limits) of its normal
// endpoint. Args come from the `body` param (a JSON object) with every other
// query param overlaid on top ({-, [- or "-prefixed values parse as JSON, the
// rest stay strings — numbers can ride the body). `key` additionally admits
// hidden-link things, exactly like ?key= on GET /api/v1/things.

const MAX_BODY_PARAM_BYTES = 64 * 1024;

// every param except these merges into the op's args
const RESERVED_PARAMS = new Set(['token', 'op', 'body', 'key']);

// Param NAMES are attacker-chosen here (unlike a JSON body, where the keys at
// least came through one parse). `args[name] = …` with name '__proto__' hits
// Object.prototype's setter and re-points the args object's prototype, and a
// '__proto__' key surviving JSON.parse of ?body= is an OWN property that any
// downstream recursive merge would walk straight onto Object.prototype. Drop
// the three unsafe names on both paths — no op has a legitimate field there.
const UNSAFE_ARG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const OPS = ['get', 'list', 'search', 'feed', 'self', 'create', 'update', 'upsert', 'delete', 'react', 'comment', 'save', 'share'] as const;
type BridgeOp = (typeof OPS)[number];

// responses must never be cached (they're per-token) nor leak the token
// onward through a Referer header
const BRIDGE_HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } as const;

const respond = (payload: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  json(payload, { status: init.status ?? 200, headers: { ...BRIDGE_HEADERS, ...(init.headers || {}) } });

const csv = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];

const isoDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

// Only unambiguous JSON markers parse — bare words, numbers and emoji stay
// strings, so ?text=hello and ?emoji=🔥 mean what they look like. Structured
// values ride {…}/[…]/"…" params or the body JSON.
const overlayValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (/^[[{"]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
};

// The PAT scope each op needs — mirrors patScopeFor in the things route (a
// create whose thingtime says reaction/comment needs that permission, not
// blanket create; upserts can create OR replace).
const scopeForOp = (op: BridgeOp, args: Record<string, any>): string | string[] => {
  if (op === 'create') {
    if (Array.isArray(args?.thingtime)) {
      if (args.thingtime.includes('reaction')) return 'things.react';
      if (args.thingtime.includes('comment')) return 'things.comment';
    }
    return 'things.create';
  }
  if (op === 'upsert') return ['things.create', 'things.update'];
  if (op === 'update') return 'things.update';
  if (op === 'delete') return 'things.delete';
  if (op === 'react') return 'things.react';
  if (op === 'comment') return 'things.comment';
  if (op === 'save') return 'things.save';
  if (op === 'share') return 'things.share';
  return 'things.read';
};

// mutation rate-limit keys mirror the normal routes; reads ride free like the
// things GET loader, search keeps its dedicated window
const rateLimitKeyForOp = (op: BridgeOp, args: Record<string, any>, accountKind: string): string | null => {
  if (op === 'react') return 'things.react';
  if (op === 'comment') return 'things.comment';
  if (op === 'create' && Array.isArray(args?.thingtime)) {
    if (args.thingtime.includes('reaction')) return 'things.react';
    if (args.thingtime.includes('comment')) return 'things.comment';
  }
  if (op === 'search') return 'things.search';
  if (['create', 'update', 'upsert', 'delete', 'save', 'share'].includes(op)) {
    return accountKind === 'service' ? 'things.write.service' : 'things.write';
  }
  return null;
};

export const loader = async ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;

  const opRaw = (params.get('op') || '').trim();
  if (!OPS.includes(opRaw as BridgeOp)) {
    return respond(
      { ok: false, error: `op must be one of ${OPS.join(', ')} — see /api/docs (endpoint /api/v1/get)` },
      { status: 400 }
    );
  }
  const op = opRaw as BridgeOp;

  // ?token= is the point of this route; a Bearer header works too for parity
  const header = request.headers.get('Authorization');
  const token = (params.get('token') || '').trim() || (header?.startsWith('Bearer ') ? header.slice(7).trim() : '');

  // free introspection — the natural first call for an agent handed a URL
  if (op === 'self') {
    const self = await resolveGetBridgeSelf(token);
    if (self.ok === false) return respond({ ok: false, error: self.error }, { status: self.status });
    return respond({ ok: true, token: self.token, user: self.user });
  }

  // args: body JSON base + every non-reserved param overlaid
  const bodyParam = params.get('body') || '';
  if (bodyParam.length > MAX_BODY_PARAM_BYTES) {
    return respond({ ok: false, error: 'body param too large' }, { status: 413 });
  }
  // null-prototype base: even if an unsafe key slipped through, it could not
  // reach Object.prototype from here
  let args: Record<string, any> = Object.create(null);
  if (bodyParam.trim()) {
    try {
      const parsed = JSON.parse(bodyParam);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      for (const [name, value] of Object.entries(parsed as Record<string, any>)) {
        if (UNSAFE_ARG_KEYS.has(name)) continue;
        args[name] = value;
      }
    } catch {
      return respond({ ok: false, error: 'body must be a URL-encoded JSON object' }, { status: 400 });
    }
  }
  for (const [name, value] of params.entries()) {
    if (RESERVED_PARAMS.has(name) || UNSAFE_ARG_KEYS.has(name)) continue;
    args[name] = overlayValue(value);
  }
  // thingtime commonly arrives as a bare csv ("post,comment") — normalize
  if (typeof args.thingtime === 'string') args.thingtime = csv(args.thingtime);
  // tags the same way: sanitizeTags (things.ts) hard-400s a non-array, so a
  // plain ?tags=a,b — the natural spelling on a URL-only surface — would fail
  // every create/update/share instead of meaning what it looks like. A JSON
  // ?tags=["a","b"] already arrives parsed and passes through untouched.
  if (typeof args.tags === 'string') args.tags = csv(args.tags);

  // scope check + use consumption happen inside the resolver (403s are free,
  // exactly like the Bearer path)
  const auth = await resolveGetBridgeActor(token, scopeForOp(op, args));
  if (auth.ok === false) return respond({ ok: false, error: auth.error }, { status: auth.status });
  const { user, pat } = auth.actor;
  if (!user) return respond({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const limitKey = rateLimitKeyForOp(op, args, user.accountKind);
  if (limitKey) {
    const limit = await enforceRateLimit(request, limitKey, `user:${user.id}`);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return respond({ ok: false, error: 'You’re doing that too fast — take a breather 🌸' }, { status: init.status, headers: init.headers as Record<string, string> });
    }
  }

  // hidden-link keys ride the viewer here exactly like ?key= on /api/v1/things
  const viewer = withLinkKeys(viewerOf(user, pat), [(params.get('key') || '').trim()]);

  if (op === 'get') {
    const result = await getThing(viewer, args.id);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, thing: result.thing, post: result.post, parent: result.parent, root: result.root });
  }

  if (op === 'list') {
    const result = await listThings(viewer, {
      thingtime: csv(args.thingtime),
      targetId: typeof args.target === 'string' && args.target ? args.target : typeof args.targetId === 'string' ? args.targetId : null,
      folder: typeof args.folder === 'string' && args.folder ? args.folder : null,
      cursor: typeof args.cursor === 'string' ? args.cursor : null,
      limit: Number(args.limit) || undefined,
      appId: typeof args.appId === 'string' && args.appId ? args.appId : null
    });
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, things: result.things, nextCursor: result.nextCursor });
  }

  if (op === 'search') {
    const result = await searchThings(viewer, args);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, things: result.things, posts: result.posts, nextCursor: result.nextCursor });
  }

  if (op === 'feed') {
    const result = await getFeed(viewer, {
      types: csv(args.types) as PostType[],
      circles: csv(args.circles) as PostVisibility[],
      from: isoDate(args.from),
      to: isoDate(args.to),
      cursor: typeof args.cursor === 'string' ? args.cursor : null,
      limit: Number(args.limit) || undefined,
      weights: null
    });
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, posts: result.posts, nextCursor: result.nextCursor, ranked: result.ranked });
  }

  if (op === 'create') {
    const result = await createThing(user.id, args, viewer);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    if (isPostThing(result.doc)) {
      return respond({ ok: true, post: (await toPublicPosts([result.doc], viewer))[0] });
    }
    return respond({ ok: true, thing: (await toPublicThings([result.doc], viewer))[0] });
  }

  if (op === 'upsert') {
    const result = await upsertThing(user.id, { ...args, shareId: args.shareId ?? args.id }, viewer);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, created: result.created, thing: result.thing, post: result.post }, { status: result.created ? 201 : 200 });
  }

  // `expectedUpdatedAt` is the optimistic-concurrency guard PATCH/DELETE take
  // on /api/v1/things: both compare it against the stored updatedAt and anchor
  // it into the write filter, so a losing racer gets a 409 instead of silently
  // clobbering. Dropping it here didn't merely lose a feature — it turned a
  // compare-and-swap the caller asked for into an unguarded write that still
  // answers 200. That matters more on this branch than it used to: custom
  // audiences grant tt:user/<name>/write to OTHER people, so one thing now has
  // genuinely concurrent writers. It rides the URL natively (an ISO string
  // stays a string through overlayValue) and updateThing/deleteThing already
  // 400 a malformed one, so a mis-encoded timestamp fails loudly, never open.
  const expectedUpdatedAt = args.expectedUpdatedAt;

  if (op === 'update') {
    const result = await updateThing(viewer, args.id, args, { replaceCrystal: false, expectedUpdatedAt });
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, thing: result.thing, post: result.post });
  }

  if (op === 'delete') {
    const hooks = {
      ...(user.accountKind === 'user' ? { beforeCascade: prepareAttachmentCascadeForThing } : {}),
      expectedUpdatedAt
    };
    const result = await deleteThing(viewer, args.id, null, hooks as any);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true });
  }

  if (op === 'react') {
    const result = await toggleReaction(viewer, args.id, args.emoji ?? null);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, reactionCounts: result.reactionCounts, viewerReactions: result.viewerReactions });
  }

  if (op === 'comment') {
    const result = await addComment(viewer, args.id, args);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, comment: result.comment, commentCount: result.commentCount });
  }

  if (op === 'save') {
    const result = await toggleSave(viewer, args.id);
    if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
    return respond({ ok: true, saved: result.saved });
  }

  // share — `tags` carries the quoter's own hashtags exactly like the body on
  // POST /api/v1/things/share; without it the bridge silently dropped them and
  // the share kept only the original's tags (sharePost sanitizes input.tags)
  const result = await sharePost(viewer, args.id, { text: args.text, tags: args.tags, acl: args.acl, visibility: args.visibility });
  if (result.ok === false) return respond({ ok: false, error: result.error }, { status: result.status });
  return respond({ ok: true, post: result.post });
};

// the bridge is GET by definition — everything else belongs on the normal routes
export const action = async () =>
  json({ ok: false, error: 'The GET bridge only speaks GET — use the normal /api/v1 routes for other verbs' }, { status: 405, headers: { Allow: 'GET', ...BRIDGE_HEADERS } });
