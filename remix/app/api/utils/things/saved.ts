import { getThingsCollection } from '../mongodb/collections';
import {
  asViewer,
  canViewInherited,
  chronoCursorClause,
  fail,
  parseChronoCursor,
  postThingMatch,
  toPublicPosts,
  withFriendIds,
  withMatch,
  type Fail,
  type PublicPost,
  type ThingDoc,
  type Viewer
} from './things';

// The Saved library — the engine behind GET /api/v1/things/saved and /saved.
//
// Saves are relational child things (thingtime ['save'], targetId = the saved
// thing, acl ['tt:user']) written by toggleSave, so "posts I saved" is the
// viewer's own save things joined to their targets. The read is two batched
// queries (never N+1): the viewer's save page off the
// { thingtime, ownerId, createdAt desc, shareId } index, then one $in fetch of
// the post-shaped targets. Order is newest-SAVED-first (the save thing's
// createdAt, not the post's), and targets that no longer resolve — deleted,
// audience narrowed since the save, or not post-shaped (e.g. a saved schema) —
// are silently skipped: fail closed, no error rows. The cursor advances over
// the RAW save page, so skipped rows are dropped rather than resurfaced (the
// feed's exact convention).

const DEFAULT_SAVED_LIMIT = 30;
const MAX_SAVED_LIMIT = 50;

export const getSavedPosts = async (
  viewerInput: string | Viewer,
  cursor?: string | null,
  limit = DEFAULT_SAVED_LIMIT
): Promise<{ ok: true; posts: PublicPost[]; nextCursor: string | null } | Fail> => {
  const viewer = await withFriendIds(asViewer(viewerInput));
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const capped = Math.min(Math.max(1, limit), MAX_SAVED_LIMIT);

  const things = await getThingsCollection();

  // the viewer's saves, newest first — stable (createdAt, shareId) cursor
  // pagination over the save things themselves (savedAt order by construction)
  const parsed = parseChronoCursor(cursor);
  const saveMatch = { thingtime: 'save', ownerId: viewer.id };
  const pageMatch = parsed ? withMatch(saveMatch, chronoCursorClause(parsed)) : saveMatch;
  const saves = (await things
    .find(pageMatch as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(capped + 1)
    .project({ shareId: 1, targetId: 1, createdAt: 1 })
    .toArray()) as any as Pick<ThingDoc, 'shareId' | 'targetId' | 'createdAt'>[];

  const page = saves.slice(0, capped);
  const last = page[page.length - 1];
  const nextCursor = saves.length > capped && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  if (!page.length) return { ok: true, posts: [], nextCursor: null };

  // one batched fetch of the post-shaped targets (posts AND rich comments —
  // both render as cards); toggleSave dedupes, so ids are effectively unique
  const targetIds = [...new Set(page.map((save) => String(save.targetId || '')).filter(Boolean))];
  const targetDocs = targetIds.length
    ? ((await things.find(withMatch({ shareId: { $in: targetIds } }, postThingMatch()) as any).toArray()) as any as ThingDoc[])
    : [];
  const docsById = new Map(targetDocs.map((doc) => [doc.shareId, doc]));

  // exact per-doc acl evaluation with the real viewer (inherit chains
  // included) — a save whose target went private or vanished drops out here
  const visible: ThingDoc[] = [];
  const seen = new Set<string>();
  for (const save of page) {
    const doc = docsById.get(String(save.targetId || ''));
    if (!doc || seen.has(doc.shareId)) continue;
    if (await canViewInherited(doc, viewer)) {
      seen.add(doc.shareId);
      visible.push(doc);
    }
  }

  return { ok: true, posts: await toPublicPosts(visible, viewer), nextCursor };
};
