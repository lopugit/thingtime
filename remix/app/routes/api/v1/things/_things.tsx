import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import {
  createPost,
  createThing,
  getThing,
  listThings,
  toPublicPosts,
  toPublicThings
} from '~/api/utils/things/things';

// Things are small JSON payloads (crystal fields: text + image URLs + listing).
const MAX_BODY_BYTES = 256 * 1024;

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
  const params = new URL(request.url).searchParams;

  const id = (params.get('id') || '').trim();
  if (id) {
    const result = await getThing(user ? user.id : null, id);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true, thing: result.thing, post: result.post });
  }

  const result = await listThings(user ? user.id : null, {
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

// POST /api/v1/things — create a thing as the current user. Two body shapes,
// one code path underneath:
// - unified: { thingtime: ['post'|...], crystal: {...}, visibility?, targetId?, tags? }
// - legacy post: { type, text?, images?, listing?, visibility?, tags? }
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Post payload too large' }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));

  if (Array.isArray(body?.thingtime)) {
    const result = await createThing(user.id, body);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    const isPost = (result.doc.thingtime || []).includes('post');
    if (isPost) {
      return json({ ok: true, post: (await toPublicPosts([result.doc], user.id))[0] });
    }
    return json({ ok: true, thing: (await toPublicThings([result.doc], user.id))[0] });
  }

  const result = await createPost(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, post: result.post });
};
