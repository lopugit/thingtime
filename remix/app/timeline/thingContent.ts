import { copyBoundedJson } from '../utils/boundedJson.ts';
import { TIMELINE_SNAPSHOT_MAX_BYTES } from './snapshotParts.ts';
import type { TimelineSnapshot } from './contract.ts';

/** Explicit content projection. Never copy a Mongo document wholesale: secure,
 * tokens, hidden-link keys, grants and platform ledger state are not revisions.
 * Dedicated protected families must supply their own approved snapshot adapter. */
export function thingContentSnapshot(doc: any): TimelineSnapshot | null {
	if (!doc) return null;
	return {
		adapter: 'thing-content', version: 1,
		value: copyBoundedJson({
			thingtime: doc.thingtime ?? ['data'], crystal: doc.crystal ?? null, extended: doc.extended ?? null,
			tags: doc.tags ?? [], acl: doc.acl ?? ['tt:user'], folderId: doc.folderId ?? null, targetId: doc.targetId ?? null,
			geo: doc.geo ?? null
		}, { maxBytes: TIMELINE_SNAPSHOT_MAX_BYTES, maxDepth: 90, maxNodes: 90_000, sortKeys: true }, 'Thing revision')
	};
}
