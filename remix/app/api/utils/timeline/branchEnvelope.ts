import { createHash } from 'node:crypto';
import {
	TIMELINE_BRANCH_KIND,
	TIMELINE_BRANCH_HEAD_KIND,
	parseTimelineBranch,
	parseTimelineBranchHead,
	type TimelineBranch,
	type TimelineBranchHead
} from '../../../timeline/branches.ts';
import { binaryBytes, fromBin, toBin } from '../auth/binary.ts';
const digest = (parts: unknown) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const timelineBranchThingId = (ownerId: string, branchId: string) => `timeline-branch-${digest([ownerId, branchId])}`;
export const timelineBranchHeadThingId = (ownerId: string, branchId: string, thingId: string) =>
	`timeline-branch-head-${digest([ownerId, branchId, thingId])}`;
const unpack = (doc: any, kind: string) => {
	const bytes = binaryBytes(doc?.secure);
	if (!doc?.thingtime?.includes(kind) || doc.timelineBranchVersion !== 1 || bytes === null || bytes < 1 || bytes > 4096)
		throw new Error('Invalid Timeline branch envelope');
	return JSON.parse(fromBin(doc.secure));
};
export const packTimelineBranchRecord = (record: TimelineBranch | TimelineBranchHead) => ({
	timelineBranchVersion: 1,
	secure: toBin(JSON.stringify(record))
});
export const branchFromDoc = (doc: any): TimelineBranch => {
	const branch = parseTimelineBranch(unpack(doc, TIMELINE_BRANCH_KIND));
	if (doc.ownerId !== branch.ownerId || doc.shareId !== timelineBranchThingId(branch.ownerId, branch.id) || doc.crystal?.name !== branch.name)
		throw new Error('Timeline branch envelope does not match its record');
	return branch;
};
export const branchHeadFromDoc = (doc: any): TimelineBranchHead => {
	const head = parseTimelineBranchHead(unpack(doc, TIMELINE_BRANCH_HEAD_KIND));
	if (
		doc.ownerId !== head.ownerId ||
		doc.shareId !== timelineBranchHeadThingId(head.ownerId, head.branchId, head.thingId) ||
		doc.targetId !== head.thingId ||
		doc.parentId !== timelineBranchThingId(head.ownerId, head.branchId) ||
		doc.branchRevision !== head.revision
	)
		throw new Error('Timeline branch head envelope does not match its record');
	return head;
};

export async function readTimelineBranchHead(
	things: any,
	ownerId: string,
	branchId: string,
	thingId: string,
	session?: any
): Promise<TimelineBranchHead | null> {
	const doc = await things.findOne(
		{ ownerId, thingtime: TIMELINE_BRANCH_HEAD_KIND, shareId: timelineBranchHeadThingId(ownerId, branchId, thingId) },
		session ? { session } : {}
	);
	return doc ? branchHeadFromDoc(doc) : null;
}
