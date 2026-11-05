import { parseBranchMergeRequest, type BranchMergeRequest } from '../../../timeline/branchMerge.ts';
import { createBranchMergePreviewService } from '../../../timeline/branchMergePreview.ts';
import { readRecordedComponentEntries } from './service.ts';
import { getThingsCollection } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore';
import { readTimelineBranchEntry } from './branches.ts';
import { readTimelineEntries, readTimelineNodes } from './repository.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';

const defaults = {
	collection: getThingsCollection,
	branch: readTimelineBranchEntry,
	entries: readTimelineEntries,
	nodes: readTimelineNodes,
	snapshot: readTimelineSnapshot
};
export function createBranchMergeService(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async (ownerId: string, input: BranchMergeRequest) => {
		const request = parseBranchMergeRequest(input),
			things = await deps.collection();
		return createBranchMergePreviewService({
			branch: (owner, branch, thing) => deps.branch(things, owner, branch, thing),
			entries: (owner, ids) => deps.entries(things, owner, ids),
			nodes: (owner, ids) => deps.nodes(things, owner, ids),
			snapshot: (owner, entry) => deps.snapshot(things, owner, entry.event.id, 'after', entry.event.after),
			recorded: (owner, wanted, bytes) => readRecordedComponentEntries(things, owner, wanted, deps.entries, bytes),
			refuse: (status, message): never => {
				throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message);
			}
		})(ownerId, request);
	};
}
export const previewBranchMerge = createBranchMergeService();
