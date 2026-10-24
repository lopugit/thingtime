import {
	parseTimelineBranch,
	parseTimelineBranchHead,
	timelineBranchHeadId,
	type TimelineBranch,
	type TimelineBranchHead,
	type TimelineBranchCommand,
	type TimelineBranchResult
} from './branches.ts';
import { parseTimelineEvent, type TimelineEntry } from './contract.ts';
import { createVersionGraphTools, type TimelineGraphNode } from './versionGraph.ts';
/** The same immutable operation receipts, CAS and ancestry rules serve account
 * and isolated local authorities. This module has no storage or network access. */
export function createBranchMutationTools(refuse: (status: number, message: string) => never) {
	const { loadVersionGraph } = createVersionGraphTools(refuse);
	function replayBranch(
		prior: TimelineEntry | null | undefined,
		ownerId: string,
		command: TimelineBranchCommand,
		signature: string
	): TimelineBranchResult | null {
		if (prior) {
			if (
				prior.event.ownerId !== ownerId ||
				prior.event.operationId !== signature ||
				prior.event.source !== 'api' ||
				prior.event.actorId !== ownerId ||
				prior.event.after?.adapter !== 'timeline-branch'
			)
				refuse(409, 'This operation id was already used for another branch request.');
			const value = prior.event.after!.value as any;
			const branch = parseTimelineBranch(value.branch);
			const head = parseTimelineBranchHead(value.head);
			if (
				branch.ownerId !== ownerId ||
				head.ownerId !== ownerId ||
				head.branchId !== branch.id ||
				branch.id !== command.branchId ||
				head.thingId !== command.thingId
			)
				refuse(409, 'Invalid branch operation receipt');
			return { ok: true, branch, head, entry: prior };
		}
		return null;
	}
	async function planBranch({
		ownerId,
		command,
		signature,
		existing,
		current,
		readEntry,
		readNodes,
		now
	}: {
		ownerId: string;
		command: TimelineBranchCommand;
		signature: string;
		existing: TimelineBranch | null;
		current: TimelineBranchHead | null;
		readEntry: (id: string) => Promise<TimelineEntry | null>;
		readNodes: (ids: string[]) => Promise<TimelineGraphNode[]>;
		now: Date;
	}) {
		const eventId = `branch-op-${command.operationId}`;
		if (command.command === 'create-branch' && existing)
			refuse(409, 'This branch id already exists. Retry its original creation request or choose a new branch.');
		if (command.command === 'advance-branch' && !existing) refuse(404, 'Branch not found.');
		const branch = existing
			? existing
			: parseTimelineBranch({ formatVersion: 1, id: command.branchId, ownerId, name: command.name, createdAt: now.toISOString() });
		if (
			branch.ownerId !== ownerId ||
			branch.id !== command.branchId ||
			(current && (current.ownerId !== ownerId || current.branchId !== branch.id || current.thingId !== command.thingId))
		)
			refuse(409, 'Branch identity changed.');
		if ((current?.revision ?? 0) !== command.expectedRevision)
			refuse(409, 'This branch changed on another device. Pull its current version and compare before pushing.');
		const version = await readEntry(command.eventId);
		if (
			!version ||
			version.event.ownerId !== ownerId ||
			version.event.id !== command.eventId ||
			version.event.thingId !== command.thingId ||
			!version.event.after ||
			version.event.mode === 'effect'
		)
			refuse(404, 'The branch version is not available.');
		if (current && current.eventId !== command.eventId) {
			const graph = await loadVersionGraph([command.eventId], command.thingId, readNodes);
			if (!graph.has(current.eventId)) refuse(409, 'These versions diverged. Merge them before pushing; both versions remain in History.');
		}
		if ((current?.revision ?? 0) >= Number.MAX_SAFE_INTEGER) refuse(409, 'This branch revision limit has been reached. Create another branch.');
		const updatedAt = new Date(Math.max(now.getTime(), current ? Date.parse(current.updatedAt) + 1 : now.getTime())).toISOString();
		const head = parseTimelineBranchHead({
			formatVersion: 1,
			id: timelineBranchHeadId(branch.id, command.thingId),
			ownerId,
			branchId: branch.id,
			thingId: command.thingId,
			eventId: command.eventId,
			revision: (current?.revision ?? 0) + 1,
			createdAt: current?.createdAt ?? now.toISOString(),
			updatedAt
		});
		const event = parseTimelineEvent({
			formatVersion: 1,
			id: eventId,
			ownerId,
			thingId: command.thingId,
			branchId: branch.id,
			parentIds: [],
			operationId: signature,
			actorId: ownerId,
			source: 'api',
			clientId: null,
			occurredAt: now.toISOString(),
			mode: 'effect',
			operation: 'effect',
			label: command.command === 'create-branch' ? 'Created branch' : current ? 'Pushed branch version' : 'Added Thing to branch',
			before: current ? { adapter: 'timeline-branch', version: 1, value: { branch, head: current } } : null,
			after: { adapter: 'timeline-branch', version: 1, value: { branch, head } },
			dependencies: [{ thingId: command.thingId, eventId: command.eventId }]
		});
		return { branch, head, event };
	}
	return { replayBranch, planBranch };
}
