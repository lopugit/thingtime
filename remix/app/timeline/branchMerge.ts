import { copyBoundedJson } from '../utils/boundedJson.ts';
import { parseTimelineEvent, TIMELINE_EVENT_MAX_BYTES, type TimelineEvent, type TimelineSnapshot } from './contract.ts';
import { isTimelineBranchId, parseTimelineBranchEntry, parseTimelineBranchCommand, type TimelineBranchEntry, type TimelineBranchCommand } from './branches.ts';
import { versionContent, type VersionChoices, type VersionConflict } from './versions.ts';

export type BranchMergeRequest = {
	command: 'preview-branch-merge'; branchId: string; thingId: string; eventId: string;
	expectedHeadId: string; expectedRevision: number; choices: VersionChoices;
};
export type BranchMergePreview = TimelineBranchEntry & {
	incomingEventId: string; baseEventId: string;
	current: TimelineSnapshot; incoming: TimelineSnapshot; result: TimelineSnapshot; conflicts: VersionConflict[];
};
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: unknown, expected: string[]) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));

export function parseBranchMergeRequest(input: unknown): BranchMergeRequest {
	const value = copyBoundedJson(input, { maxBytes: 64 * 1024, maxDepth: 5, maxNodes: 2000, sortKeys: true }, 'Branch merge request') as any;
	if (!keys(value, ['command', 'branchId', 'thingId', 'eventId', 'expectedHeadId', 'expectedRevision', 'choices']) || value.command !== 'preview-branch-merge' || !isTimelineBranchId(value.branchId) || ![value.thingId, value.eventId, value.expectedHeadId].every(id) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1 || !object(value.choices) || Object.values(value.choices).some(choice => choice !== 'current' && choice !== 'incoming')) throw new Error('Invalid branch merge request');
	return value;
}

/** A bounded transport view. Durable changes still use the unchanged event,
 * link and branch-command schemas on both sides of synchronization. */
export function parseBranchMergePreview(input: unknown, ownerId: string, request: BranchMergeRequest): BranchMergePreview {
	const value = copyBoundedJson(input, { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 100, maxNodes: 200_000, sortKeys: true }, 'Branch merge preview') as any;
	if (!keys(value, ['branch', 'head', 'incomingEventId', 'baseEventId', 'current', 'incoming', 'result', 'conflicts'])) throw new Error('Invalid branch merge preview');
	const entry = parseTimelineBranchEntry(value);
	if (entry.branch.ownerId !== ownerId || entry.branch.id !== request.branchId || entry.head.thingId !== request.thingId || entry.head.eventId !== request.expectedHeadId || entry.head.revision !== request.expectedRevision || value.incomingEventId !== request.eventId || !id(value.baseEventId)) throw new Error('The branch comparison belongs to another version');
	for (const side of ['current', 'incoming', 'result']) {
		const snapshot = value[side];
		if (!keys(snapshot, ['adapter', 'version', 'value']) || snapshot.adapter !== 'thing-content' || snapshot.version !== 1 || !keys(snapshot.value, ['crystal', 'extended', 'tags', 'geo', 'acl', 'folderId'])) throw new Error('Invalid branch comparison content');
		versionContent(snapshot);
	}
	if (!Array.isArray(value.conflicts) || value.conflicts.length > 2000) throw new Error('Invalid branch conflicts');
	const paths = new Set<string>();
	for (const conflict of value.conflicts) {
		if (!keys(conflict, ['path', 'base', 'current', 'incoming']) || !Array.isArray(conflict.path) || conflict.path.length > 96 || conflict.path.some((part: unknown) => typeof part !== 'string')) throw new Error('Invalid branch conflict');
		const path = JSON.stringify(conflict.path); if (paths.has(path)) throw new Error('Duplicate branch conflict'); paths.add(path);
		for (const side of ['base', 'current', 'incoming']) {
			const field = conflict[side];
			if (!object(field) || (field.present === true ? !keys(field, ['present', 'value']) : field.present !== false || !keys(field, ['present']))) throw new Error('Invalid branch conflict value');
		}
	}
	return { ...value, ...entry };
}

export function createBranchMergeProposal(preview: BranchMergePreview, clientId: string, uuid = () => crypto.randomUUID(), now = () => new Date().toISOString()): { event: TimelineEvent; command: TimelineBranchCommand } {
	if (preview.conflicts.length || preview.head.eventId === preview.incomingEventId) throw new Error('Review and resolve this branch comparison before merging');
	const event = parseTimelineEvent({
		formatVersion: 1, id: uuid(), ownerId: preview.branch.ownerId, actorId: preview.branch.ownerId,
		thingId: preview.head.thingId, branchId: preview.branch.id, parentIds: [preview.head.eventId, preview.incomingEventId],
		operationId: uuid(), source: 'client', clientId, occurredAt: now(), mode: 'draft', operation: 'merge',
		label: `Merged versions in ${preview.branch.name}`, before: preview.current, after: preview.result, dependencies: []
	});
	const command = parseTimelineBranchCommand({ command: 'advance-branch', operationId: uuid(), branchId: preview.branch.id, thingId: preview.head.thingId, eventId: event.id, expectedRevision: preview.head.revision, name: null });
	return { event, command };
}
