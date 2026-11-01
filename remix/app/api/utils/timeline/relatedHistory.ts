import { createHash } from 'node:crypto';
import { getThingsCollection } from '../mongodb/collections';
import { resolveSharedComposition } from '../actions/sharedComposition';
import { StorageMutationError } from '../storage/storageCore';
import { parseRelatedTimelineScope, timelineRelatedId, timelineRelatedRevision } from '../../../timeline/relatedHistory.ts';
import type { TimelinePageRequest } from '../../../timeline/sync.ts';
import { readTimelinePage } from './repository.ts';

const defaults = { collection: getThingsCollection, resolve: resolveSharedComposition, page: readTimelinePage };
/** Current stored composition, freshly authorized on every page/poll. Reading a
 * shared definition never grants access to its author's private event graph. */
export function createRelatedTimelineReader(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async (ownerId: string, request: TimelinePageRequest) => {
		if (
			!timelineRelatedId(request.thingId) ||
			!request.related ||
			(request.relatedRevision !== undefined && !timelineRelatedRevision(request.relatedRevision)) ||
			((request.before !== null || request.after !== null) && !request.relatedRevision)
		)
			throw new StorageMutationError(400, 'storage_invariant', 'Invalid related history request.');
		const things = await deps.collection();
		const root = await things.findOne({ ownerId, shareId: request.thingId, thingtime: 'webpage' }, { projection: { shareId: 1 } });
		if (!root) throw new StorageMutationError(404, 'storage_invariant', 'Open an owned page to see its related history.');
		const composition = await deps.resolve({ id: ownerId }, request.thingId);
		if ('ok' in composition && composition.ok === false) throw new StorageMutationError(composition.status, 'storage_invariant', composition.error);
		if (!('root' in composition) || composition.root.ownerId !== ownerId || !composition.root.thingtime.includes('webpage'))
			throw new StorageMutationError(404, 'storage_invariant', 'This page is no longer available.');
		const thingIds = [...composition.docs.values()]
			.filter((doc) => doc.ownerId === ownerId)
			.map((doc) => doc.shareId)
			.sort();
		const sharedCount = composition.docs.size - thingIds.length;
		const revision = createHash('sha256')
			.update(JSON.stringify([request.thingId, thingIds, sharedCount]))
			.digest('hex');
		const related = parseRelatedTimelineScope({ rootId: request.thingId, thingIds, revision, sharedCount }, request.thingId);
		// A changed membership invalidates both paging directions: a newly linked
		// Thing may have history older than the previous stream's cursor.
		const reset = request.relatedRevision !== undefined && request.relatedRevision !== revision;
		const page = await deps.page(things, ownerId, reset ? { ...request, before: null, after: null } : request, thingIds);
		return { ...page, related, ...(reset ? { reset: true as const } : {}) };
	};
}
export const getRelatedTimelinePage = createRelatedTimelineReader();
