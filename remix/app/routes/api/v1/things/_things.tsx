import { json } from '~/api/http';

import { actorCors, actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { appCorsHeaders, appDataPreflight } from '~/api/utils/apps/cors';
import {
  createReadyAttachmentPostInsertHook,
  inspectReadyAttachmentsForPost,
  prepareAttachmentCascadeForThing,
  syncReadyAttachmentsForTarget
} from '~/api/utils/attachments/attachments';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { bindOwnedWebpageAttachments } from '~/api/utils/webpages/webpageAttachments';
import {
  attachmentPostActorAllowed,
  postAttachmentRequest,
  postBodyWithoutAttachmentIds
} from '~/api/utils/attachments/postCreate';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import {
  appShapeProjections,
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

// The PAT scope each mutation needs (auth/patTokens.ts). Mirrors
// rateLimitKeyFor's body routing: a POST whose thingtime says it's a reaction
// or comment needs that specific permission, not blanket create. PUT is an
// upsert — it can create OR replace, so it needs both. Full sessions skip
// scope checks entirely (resolveThingsActor returns pat: null).
const patScopeFor = (method: string, body: any): string | string[] => {
  if (method === 'POST') {
    if (Array.isArray(body?.thingtime)) {
      if (body.thingtime.includes('reaction')) return 'things.react';
      if (body.thingtime.includes('comment')) return 'things.comment';
    }
    return 'things.create';
  }
  if (method === 'PUT') return ['things.create', 'things.update'];
  if (method === 'PATCH') return 'things.update';
  if (method === 'DELETE') return 'things.delete';
  return 'things.read';
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
// GET /api/v1/things?thingtime=&folder=&cursor=&limit= — list your own things
// (folder=root for unfiled things, folder=<folder shareId> for its children;
// session auth may add appId=<clientId> to browse ONE app's namespace).
//
// App-scoped tokens ("Login with Thingtime") work here too: every read is
// fenced to the app's own namespace (root appId stamp + audience acl +
// author-liveness — apps/namespace.ts), so an app sees its slice of the
// user's Thingtime and nothing else.
export const loader = async ({ request }: { request: Request }) => {
  const actor = await resolveActor(request, { thingsScope: 'things.read' });
  if (actor instanceof Response) return actor;
  const user = actorUser(actor);
  // pat context rides reads too: a visibility-restricted token (public-only /
  // private-only) must have its audience fence applied to everything it lists
  const viewer = viewerOf(user, actorPat(actor));
  const app = actor.kind === 'app' ? actor.scope : null;
  const cors = actorCors(actor);

  if (actor.kind === 'app') {
    // per-(user, app) buckets — an app never rides the user's own windows
    const limit = await enforceRateLimit(request, 'oauth.read', actor.rateIdentity);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json(
        { ok: false, error: 'Reading too fast — take a breather 🌸' },
        { ...init, headers: { ...init.headers, ...cors } }
      );
    }
  }

  const params = new URL(request.url).searchParams;

  const id = (params.get('id') || '').trim();
  if (id) {
    const result = await getThing(viewer, id, app);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
    }
    // comments project as posts too; parent/root carry their thread context
    // (post/parent/root are first-party projections — null under the app lens)
    return json(
      { ok: true, thing: result.thing, post: result.post, parent: result.parent, root: result.root },
      { headers: cors }
    );
  }

  const result = await listThings(
    viewer,
    {
      thingtime: csv(params.get('thingtime')),
      targetId: (params.get('target') || '').trim() || null,
      folder: (params.get('folder') || '').trim() || null,
      cursor: params.get('cursor'),
      limit: Number(params.get('limit')) || undefined,
      appId: actor.kind === 'user' || actor.kind === 'pat' ? (params.get('appId') || '').trim() || null : null
    },
    app
  );
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, things: result.things, nextCursor: result.nextCursor }, { headers: cors });
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
//
// App tokens get the same verbs inside their namespace: writes are stamped
// (root appId + sizeBytes), acl-clamped (private by default, app-audience only
// with the author's app-data.shared grant), byte-budgeted, and deletes carry
// the namespace stamp in the filter itself.
export const action = async ({ request }: { request: Request }) => {
  // cross-origin SDK calls preflight (Authorization header) — the catch-all
  // routes OPTIONS here
  const preflight = appDataPreflight(request, 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (preflight) return preflight;

  // The 413 fires before any actor resolution (an oversized payload must not
  // consume a PAT use), so its CORS headers come straight from the Origin.
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json(
      { ok: false, error: 'Post payload too large' },
      { status: 413, headers: appCorsHeaders(request.headers.get('Origin')) }
    );
  }

  // Body before auth: the PAT scope a mutation needs depends on what the body
  // says it is (a POST carrying thingtime ['reaction'] is a react, not a
  // create), and a missing scope must 403 BEFORE a use is consumed.
  const method = request.method.toUpperCase();
  const body = await request.json().catch(() => ({}));

  const actor = await resolveActor(request, { thingsScope: patScopeFor(method, body) });
  if (actor instanceof Response) return actor;
  if (actor.kind === 'anonymous') {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const user = actorUser(actor)!;
  // pat context rides the viewer: creates stamp the token's tt:token grant,
  // and a sandboxed token's writes stay inside its granted things (things.ts)
  const viewer = viewerOf(user, actorPat(actor));
  const app = actor.kind === 'app' ? actor.scope : null;
  const cors = actorCors(actor);

  // Every mutating verb is throttled — the generic endpoint must not be a way
  // around the per-op limits main added to the react/comment sub-routes. No
  // one is exempt (service-account provisioning is unauthenticated, so
  // accountKind confers no trust); service accounts just get a higher ceiling.
  // App actors consume their own per-(user, app) windows.
  const limit = await enforceRateLimit(
    request,
    rateLimitKeyFor(body, user.accountKind),
    actor.kind === 'app' ? actor.rateIdentity : `user:${user.id}`
  );
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'You’re doing that too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  const isUnifiedPostBody =
    method === 'POST' && body && typeof body === 'object' && ('thingtime' in body || 'crystal' in body);
  const attachmentRequest = postAttachmentRequest(method, body, !!isUnifiedPostBody);
  if (attachmentRequest.ok === false) {
    return json(
      { ok: false, error: attachmentRequest.error },
      { status: attachmentRequest.status, headers: cors }
    );
  }

  let bodyForCreate = body;
  let attachmentHooks:
    | {
        postAttachments: { hasAny: boolean; hasVisual: boolean };
        afterInsert?: ReturnType<typeof createReadyAttachmentPostInsertHook>;
      }
    | undefined;
  if (attachmentRequest.present) {
    if (!attachmentPostActorAllowed(actor.kind, user.accountKind)) {
      return json(
        { ok: false, error: 'Attachments require a full user session' },
        { status: 403, headers: cors }
      );
    }
    if (!isSameOriginAttachmentRequest(request)) {
      return json(
        { ok: false, error: 'Cross-origin attachment requests are not allowed' },
        { status: 403, headers: cors }
      );
    }
    const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return json(
        { ok: false, error: 'Content-Type must be application/json' },
        { status: 415, headers: cors }
      );
    }

    if (attachmentRequest.kind === 'create') {
      const inspected = await inspectReadyAttachmentsForPost(user.id, attachmentRequest.attachmentIds);
      if (inspected.ok === false) {
        return json({ ok: false, error: inspected.error }, { status: inspected.status, headers: cors });
      }
      const attachmentIds = attachmentRequest.attachmentIds as readonly string[];
      attachmentHooks = {
        postAttachments: { hasAny: inspected.hasAny, hasVisual: inspected.hasVisual },
        ...(attachmentIds.length ? { afterInsert: createReadyAttachmentPostInsertHook(attachmentIds) } : {})
      };
    }
    bodyForCreate = postBodyWithoutAttachmentIds(body as Record<string, unknown>);
  }

  if (method === 'POST') {
    // Unified shape whenever the body opts into the thing vocabulary: an
    // explicit `thingtime`, or a schema-less `crystal` (defaults to ["data"]).
    // Legacy post bodies carry neither key. Routing on key PRESENCE (not shape)
    // keeps the decision in one place — validateThingtimeCrystal raises the
    // right error for a malformed thingtime/crystal instead of the request
    // silently falling through to the legacy post path.
    const isUnified = !!isUnifiedPostBody;
    if (app && !isUnified) {
      // the legacy post path resolves audience through the first-party
      // defaults — app writes must always ride the clamped unified path
      return json(
        { ok: false, error: 'App writes use the unified shape: { thingtime, crystal, … }' },
        { status: 400, headers: cors }
      );
    }
    if (isUnified) {
      const result = await createThing(user.id, bodyForCreate, viewer, app, attachmentHooks);
      if (result.ok === false) {
        return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
      }
      // webpage saves claim the owner's referenced builder uploads so the
      // draft reaper can't take a page's media out from under it (tolerant:
      // foreign/external/expired references are simply not bound)
      if (actor.kind !== 'app' && user.accountKind === 'user' && (result.doc.thingtime || []).includes('webpage')) {
        await bindOwnedWebpageAttachments(user.id, result.doc.crystal, result.doc.shareId);
      }
      if (app) {
        const thing = (await toPublicThings([result.doc], viewer))[0];
        await appShapeProjections(app, [result.doc], [thing]);
        return json({ ok: true, thing }, { headers: cors });
      }
      const isPost = (result.doc.thingtime || []).includes('post');
      if (isPost) {
        return json({ ok: true, post: (await toPublicPosts([result.doc], viewer))[0] });
      }
      return json({ ok: true, thing: (await toPublicThings([result.doc], viewer))[0] });
    }
    const result = await createPost(user.id, bodyForCreate, viewer, attachmentHooks);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true, post: result.post });
  }

  if (method === 'PUT') {
    const result = await upsertThing(user.id, { ...body, shareId: body?.shareId ?? body?.id }, viewer, app);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
    }
    return json(
      { ok: true, created: result.created, thing: result.thing, post: result.post },
      { status: result.created ? 201 : 200, headers: cors }
    );
  }

  if (method === 'PATCH') {
    // Sync attachments before the document update so the projection the
    // client gets back already lists them in the new order — and so
    // updateThing's boundAttachmentPresence sees freshly added media when it
    // validates the crystal. The sync is idempotent (owner-fenced bind +
    // order stamp of the full desired list), so a failed updateThing after
    // it leaves nothing inconsistent and a retry re-applies the same list.
    if (attachmentRequest.present && attachmentRequest.kind === 'sync') {
      const synced = await syncReadyAttachmentsForTarget(user.id, body?.id, attachmentRequest.attachmentIds);
      if (synced.ok === false) {
        return json({ ok: false, error: synced.error }, { status: synced.status, headers: cors });
      }
    }
    const result = await updateThing(
      viewer,
      body?.id,
      bodyForCreate,
      { replaceCrystal: body?.replaceCrystal === true, expectedUpdatedAt: body?.expectedUpdatedAt },
      app
    );
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
    }
    const updatedThing = result.thing as { id?: unknown; thingtime?: unknown; crystal?: unknown } | undefined;
    if (
      actor.kind !== 'app' &&
      user.accountKind === 'user' &&
      Array.isArray(updatedThing?.thingtime) &&
      (updatedThing.thingtime as unknown[]).includes('webpage')
    ) {
      await bindOwnedWebpageAttachments(user.id, updatedThing.crystal, String(updatedThing.id || ''));
    }
    return json({ ok: true, thing: result.thing, post: result.post }, { headers: cors });
  }

  if (method === 'DELETE') {
    const id = (new URL(request.url).searchParams.get('id') || '').trim() || body?.id;
    const attachmentHooks =
      actor.kind !== 'app' && user.accountKind === 'user'
        ? { beforeCascade: prepareAttachmentCascadeForThing, expectedUpdatedAt: body?.expectedUpdatedAt }
        : { expectedUpdatedAt: body?.expectedUpdatedAt };
    const result = await deleteThing(viewer, id, app, attachmentHooks);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
    }
    return json({ ok: true }, { headers: cors });
  }

  return json(
    { ok: false, error: 'Method not allowed' },
    { status: 405, headers: { Allow: 'GET, POST, PUT, PATCH, DELETE', ...cors } }
  );
};
