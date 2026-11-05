import { createHash } from 'node:crypto';
import { TIMELINE_BRANCH_KIND, TIMELINE_BRANCH_HEAD_KIND, parseTimelineBranchCommand, type TimelineBranch, type TimelineBranchCommand, type TimelineBranchResult, type TimelineBranchPage } from '../../../timeline/branches.ts';
import { timelineBranchThingId, timelineBranchHeadThingId, branchFromDoc, branchHeadFromDoc, readTimelineBranchHead, packTimelineBranchRecord as pack } from './branchEnvelope.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import { applyUserStorageDelta } from '../storage/userStorage';
import { StorageMutationError, thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore.ts';
import { appendTimelineEvent, readTimelineEntries, readTimelineNodes, timelineFolderId } from './repository.ts';
import { createBranchMutationTools } from '../../../timeline/branchMutation.ts';

export { timelineBranchThingId, timelineBranchHeadThingId, branchFromDoc, branchHeadFromDoc, readTimelineBranchHead } from './branchEnvelope.ts';

const digest = (parts: unknown) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const refuse = (status: number, message: string): never => { throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message); };
const { replayBranch, planBranch } = createBranchMutationTools(refuse);
export async function readTimelineBranchEntry(things: any, ownerId: string, branchId: string, thingId: string) {
	const [doc, head] = await Promise.all([
		things.findOne({ ownerId, thingtime: TIMELINE_BRANCH_KIND, shareId: timelineBranchThingId(ownerId, branchId) }),
		readTimelineBranchHead(things, ownerId, branchId, thingId)
	]);
	return doc && head ? { branch: branchFromDoc(doc), head } : null;
}

export async function readTimelineBranches(things: any, ownerId: string, thingId: string, before: number | null = null, limit = 40): Promise<TimelineBranchPage> {
	if (!ownerId || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(thingId) || !Number.isInteger(limit) || limit < 1 || limit > 40 || (before !== null && (!Number.isSafeInteger(before) || before < 1 || !Number.isFinite(new Date(before).getTime())))) refuse(400, 'Invalid branch page request.');
	const docs = await things.find({ ownerId, thingtime: TIMELINE_BRANCH_HEAD_KIND, targetId: thingId, parentId: { $ne: timelineBranchThingId(ownerId, 'main') }, ...(before !== null ? { createdAt: { $lt: new Date(before) } } : {}) }).sort({ createdAt: -1 }).limit(limit + 1).toArray();
	const selected = docs.slice(0, limit); const heads = selected.map(branchHeadFromDoc);
	const branches = heads.length ? await things.find({ ownerId, thingtime: TIMELINE_BRANCH_KIND, shareId: { $in: heads.map(head => timelineBranchThingId(ownerId, head.branchId)) } }).toArray() : [];
	const byId = new Map<string, TimelineBranch>(branches.map((doc: any) => { const branch = branchFromDoc(doc); return [branch.id, branch]; }));
	return { branches: heads.map(head => {
		const branch = byId.get(head.branchId); if (!branch) throw new Error('Timeline branch metadata is missing'); return { branch, head };
	}), nextBefore: docs.length > limit ? new Date(selected[selected.length - 1].createdAt).getTime() : null };
}

const dependencies = { collection: getThingsCollection, transaction: withMongoTransaction, debit: applyUserStorageDelta, billable: () => !isCustomMongoEndpointActive(), now: () => new Date() };
export function createBranchService(overrides: Partial<typeof dependencies> = {}) {
	const deps = { ...dependencies, ...overrides };
	return async (ownerId: string, input: TimelineBranchCommand): Promise<TimelineBranchResult> => {
		const command = parseTimelineBranchCommand(input); const things = await deps.collection(); const now = deps.now();
		const eventId = `branch-op-${command.operationId}`; const signature = digest(command);
		return deps.transaction(async session => {
			const prior = (await readTimelineEntries(things, ownerId, [eventId], session))[0];
			const replay = replayBranch(prior, ownerId, command, signature);
			if (replay) return replay;
			const branchShareId = timelineBranchThingId(ownerId, command.branchId);
			const branchDoc = await things.findOne({ ownerId, thingtime: TIMELINE_BRANCH_KIND, shareId: branchShareId }, { session });
			const current = await readTimelineBranchHead(things, ownerId, command.branchId, command.thingId, session);
			const { branch, head, event } = await planBranch({ ownerId, command, signature, existing: branchDoc ? branchFromDoc(branchDoc) : null, current,
				readEntry: async id => (await readTimelineEntries(things, ownerId, [id], session))[0] ?? null,
				readNodes: ids => readTimelineNodes(things, ownerId, ids), now });
			const updatedAt = head.updatedAt;
			const entry = await appendTimelineEvent(things, event, session, { debit: deps.debit, now });
			const common = { schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, ownerId, acl: ['tt:user'], folderId: timelineFolderId(ownerId), extended: null, tags: [] };
			if (!branchDoc) {
				const doc: any = { ...common, shareId: branchShareId, thingtime: [TIMELINE_BRANCH_KIND], targetId: null, crystal: { name: branch.name }, createdAt: new Date(entry.receipt.position), updatedAt: now, ...pack(branch) };
				if (deps.billable()) { doc.storageClass = 'content'; doc.storageAccountingVersion = USER_STORAGE_ACCOUNTING_VERSION; doc.sizeBytes = thingStorageSizeBytes(doc); await deps.debit(ownerId, doc.sizeBytes, session); }
				await things.insertOne(doc, { session });
			}
			const headId = timelineBranchHeadThingId(ownerId, branch.id, command.thingId);
			if (current) {
				const changed = await things.updateOne({ shareId: headId, ownerId, branchRevision: current.revision }, { $set: { ...pack(head), branchRevision: head.revision, updatedAt: new Date(updatedAt) } }, { session });
				if (changed.matchedCount !== 1) refuse(409, 'This branch changed while pushing. Pull and compare again.');
			} else {
				await things.insertOne({ ...common, shareId: headId, thingtime: [TIMELINE_BRANCH_HEAD_KIND], parentId: branchShareId, targetId: command.thingId,
					crystal: { name: 'Branch version', targetId: branchShareId, linkKind: TIMELINE_BRANCH_HEAD_KIND }, storageClass: 'control', branchRevision: head.revision,
					createdAt: new Date(entry.receipt.position), updatedAt: new Date(updatedAt), ...pack(head) }, { session });
			}
			return { ok: true, branch, head, entry };
		});
	};
}
export const handleBranchRequest = createBranchService();
export const getTimelineBranch = async (ownerId: string, branchId: string, thingId: string) => readTimelineBranchEntry(await getThingsCollection(), ownerId, branchId, thingId);
export const getTimelineBranches = async (ownerId: string, thingId: string, before: number | null, limit: number) => readTimelineBranches(await getThingsCollection(), ownerId, thingId, before, limit);
