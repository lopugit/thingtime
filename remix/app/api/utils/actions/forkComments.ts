import { getThingsCollection } from '../mongodb/collections';
import { canViewInherited, fail, isFail, type ThingDoc, type Viewer } from '../things/things';
import { listForkBoundMediaDocuments } from './forkBoundMedia';
import { resolveSharedComposition, type SharedComposition } from './sharedComposition';

export const MAX_FORK_THINGS = 512;

// Read the stored thread, not the paginated/eager preview in the post response.
// One query per level keeps wide threads bounded without N+1 child queries.
export const includeForkComments = async (
	viewer: Viewer, composition: SharedComposition,
	collection = getThingsCollection,
	visible = canViewInherited,
	media = listForkBoundMediaDocuments
) => {
	const result = { ...composition, docs: new Map(composition.docs) };
	const things = await collection();
	let parents = [...result.docs.keys()];
	while (parents.length) {
  // Attachments are Things too: include their own comment threads. They are
  // copied through the file lifecycle, never generic createThing.
  let files: ThingDoc[];
  try { files = await media(parents.map(id => result.docs.get(id)!).filter(doc => !doc.thingtime.includes('attachment'))); }
  catch { return fail(422, 'Attached files could not be read completely'); }
  for (const file of files) {
   if (result.docs.has(file.shareId)) continue;
   if (result.docs.size >= MAX_FORK_THINGS) return fail(422, 'This copy has too many Things, files and comments');
   if (!await visible(file, viewer, async id => result.docs.get(id) || null)) continue;
   result.docs.set(file.shareId, file);
   parents.push(file.shareId);
  }

		const children = await things.find({ thingtime: 'comment', targetId: { $in: parents } } as any)
			.sort({ createdAt: 1, shareId: 1 }).limit(MAX_FORK_THINGS + 1).toArray() as unknown as ThingDoc[];
		if (children.length > MAX_FORK_THINGS) return fail(422, 'This copy has too many comments');
		const next: string[] = [];
		for (const child of children) {
			if (result.docs.has(child.shareId)) return fail(422, 'The comment thread contains a cycle');
			if (!child.thingtime.every((kind) => kind === 'post' || kind === 'comment')) continue;
			// Only stored, readable children participate. A hidden/blocked parent
			// is never enqueued, so none of its replies can be pulled in indirectly.
			if (!await visible(child, viewer, async (id) => result.docs.get(id) || null)) continue;
			if (result.docs.size >= MAX_FORK_THINGS) return fail(422, 'This copy has too many Things and comments');
			result.docs.set(child.shareId, child);
			next.push(child.shareId);
		}
		parents = next;
	}
	return result;
};

export const resolveForkComposition = async (viewer: Viewer, id: string) => {
	const composition = await resolveSharedComposition(viewer, id, { contentRoot: true });
	return isFail(composition) ? composition : includeForkComments(viewer, composition);
};

