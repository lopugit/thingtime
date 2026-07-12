import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import {
  createPost,
  createThing,
  deleteThing,
  getThing,
  listThings,
  toPublicPosts,
  toPublicThings,
  updateThing,
  upsertThing,
  viewerOf
} from '~/api/utils/things/things';

// Route a unified mutation to the rate-limit key its dedicated sub-route would
// use, so the generic endpoint can't be used to bypass the per-op limits.
// Reaction/comment limits are universal (they're the abuse-sensitive ones) and
// apply whatever verb creates them — POST or a PUT upsert carrying that
// thingtime — never the higher write ceiling. Only the general write ceiling
// is raised for service accounts (bulk sync).
const rateLimitKeyFor = (body: any, accountKind: string): string => {
  if (Array.isArray(body?.thingtime)) {
    if (body.thingtime.includes('reaction')) return 'things.react';
    if (body.thingtime.includes('comment')) return 'things.comment';
  }
  return accountKind === 'service' ? 'things.write.service' : 'things.write';
};

// Crystal payloads are small (text + image URLs + listing), but every thing
// also carries the schema-free `extended` sidecar (up to EXTENDED_MAX_BYTES =
// 512KB, enforced by sanitizeExtended) — the body cap leaves headroom for both.
const MAX_BODY_BYTES = 768 * 1024;

const csv = (value: string | null): string[] =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

// GET /api/v1/things?id=<shareId> — read one thing (post projection included
// for post things).
// GET /api/v1/things?target=<shareId>&thingtime=comment&cursor=&limit= — list
// things attached to a viewable thing (its comments/reactions).
// GET /api/v1/things?thingtime=&cursor=&limit= — list your own things.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const viewer = viewerOf(user);
  const params = new URL(request.url).searchParams;

  const id = (params.get('id') || '').trim();
  if (id) {
    const result = await getThing(viewer, id);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true, thing: result.thing, post: result.post });
  }

  const result = await listThings(viewer, {
    thingtime: csv(params.get('thingtime')),
    targetId: (params.get('target') || '').trim() || null,
    cursor: params.get('cursor'),
    limit: Number(params.get('limit')) || undefined
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, things: result.things, nextCursor: result.nextCursor });
};

// One endpoint, full CRUD (the GET loader above is the R):
// - POST   /api/v1/things — create. Unified shape { thingtime, crystal,
//   extended?, acl?, visibility?, targetId?, tags? } or the legacy post shape
//   { type, text, images, listing, visibility, tags } — same code path
//   underneath. thingtime may be omitted when a crystal is present: schema-less
//   crystals default to ["data"].
// - PUT    /api/v1/things — upsert by id: { id, thingtime, crystal, acl?, ... }
//   creates the thing at that id or replaces the owned thing's crystal whole.
// - PATCH  /api/v1/things — partial update: { id, crystal?, extended?, acl?,
//   visibility?, tags? } — crystal fields merge over the existing crystal;
//   extended replaces whole (null clears it).
// - DELETE /api/v1/things?id= (or body { id }) — delete an owned thing.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const viewer = viewerOf(user);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Post payload too large' }, { status: 413 });
  }

  const method = request.method.toUpperCase();
  const body = await request.json().catch(() => ({}));

  // Every mutating verb is throttled — the generic endpoint must not be a way
  // around the per-op limits main added to the react/comment sub-routes. No
  // one is exempt (service-account provisioning is unauthenticated, so
  // accountKind confers no trust); service accounts just get a higher ceiling.
  const limit = await enforceRateLimit(request, rateLimitKeyFor(body, user.accountKind), `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re doing that too fast — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  if (method === 'POST') {
    // unified shape: explicit thingtime, or a schema-less crystal (defaults to
    // ["data"] in validateThingtimeCrystal). Bodies with neither are the
    // legacy post shape.
    const isUnified =
      Array.isArray(body?.thingtime) || (body?.crystal && typeof body.crystal === 'object' && !Array.isArray(body.crystal));
    if (isUnified) {
      const result = await createThing(user.id, body, viewer);
      if (result.ok === false) {
        return json({ ok: false, error: result.error }, { status: result.status });
      }
      const isPost = (result.doc.thingtime || []).includes('post');
      if (isPost) {
        return json({ ok: true, post: (await toPublicPosts([result.doc], viewer))[0] });
      }
      return json({ ok: true, thing: (await toPublicThings([result.doc], viewer))[0] });
    }
    const result = await createPost(user.id, body, viewer);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true, post: result.post });
  }

  if (method === 'PUT') {
    const result = await upsertThing(user.id, { ...body, shareId: body?.shareId ?? body?.id }, viewer);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json(
      { ok: true, created: result.created, thing: result.thing, post: result.post },
      { status: result.created ? 201 : 200 }
    );
  }

  if (method === 'PATCH') {
    const result = await updateThing(viewer, body?.id, body, { replaceCrystal: false });
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true, thing: result.thing, post: result.post });
  }

  if (method === 'DELETE') {
    const id = (new URL(request.url).searchParams.get('id') || '').trim() || body?.id;
    const result = await deleteThing(viewer, id);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST, PUT, PATCH, DELETE' } });
};
