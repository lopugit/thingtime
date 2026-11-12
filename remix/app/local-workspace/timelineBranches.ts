import {
	parseTimelineBranch,
	parseTimelineBranchHead,
	timelineBranchHeadId,
	type TimelineBranch,
	type TimelineBranchHead,
	type TimelineBranchCommand,
	type TimelineBranchEntry
} from '../timeline/branches';
import { parseBranchCheckout, type BranchCheckoutRequest } from '../timeline/branchCheckout';
import { createBranchMutationTools } from '../timeline/branchMutation';
import { createVersionGraphTools, type TimelineGraphNode } from '../timeline/versionGraph';
import type { TimelineEntry, TimelineEvent } from '../timeline/contract';
import { WorkspaceError, type WorkspaceTransaction } from './storage';

const BRANCHES = 'timeline-branches',
	HEADS = 'timeline-branch-heads',
	INDEX = 'timeline-branch-index';
const refuse = (status: number, message: string): never => {
	throw new WorkspaceError('LOCAL_BRANCH', message, status);
};
const damaged = (): never => refuse(409, 'Local branch metadata is damaged.');
const { replayBranch, planBranch } = createBranchMutationTools(refuse);
const { loadVersionGraph, createVersionContentReader } = createVersionGraphTools(refuse);
type Read = (id: string) => Promise<TimelineEntry | null>;
type Index = { id: string; thingId: string; position: number };
function branchValue(value: unknown, id: string, ownerId: string) {
	const branch = parseTimelineBranch(value);
	if (branch.id !== id || branch.ownerId !== ownerId || branch.id === 'main') damaged();
	return branch;
}
function headValue(value: unknown, id: string, ownerId: string) {
	const head = parseTimelineBranchHead(value);
	if (head.id !== id || head.ownerId !== ownerId || head.branchId === 'main') damaged();
	return head;
}
function indexValue(value: Index | undefined, head: TimelineBranchHead) {
	if (
		!value ||
		Object.keys(value).length !== 3 ||
		value.id !== head.id ||
		value.thingId !== head.thingId ||
		!Number.isSafeInteger(value.position) ||
		value.position < 1
	)
		damaged();
	return value!;
}
async function readBranch(tx: WorkspaceTransaction, ownerId: string, id: string) {
	const row = await tx.get(BRANCHES, id);
	return row ? branchValue(row, id, ownerId) : null;
}
async function readHead(tx: WorkspaceTransaction, ownerId: string, branchId: string, thingId: string) {
	const id = timelineBranchHeadId(branchId, thingId),
		row = await tx.get(HEADS, id);
	if (!row) {
		if (await tx.get(INDEX, id)) damaged();
		return null;
	}
	const head = headValue(row, id, ownerId);
	indexValue(await tx.get<Index>(INDEX, id), head);
	return head;
}
export async function readLocalBranch(tx: WorkspaceTransaction, ownerId: string, branchId: string, thingId: string): Promise<TimelineBranchEntry> {
	const branch = await readBranch(tx, ownerId, branchId),
		head = await readHead(tx, ownerId, branchId, thingId);
	if (head && !branch) damaged();
	if (!branch || !head) return refuse(404, 'Branch not found.');
	return { branch, head };
}
/** Batch the three normalized collections once; no per-branch remote lookups. */
export async function readLocalBranches(tx: WorkspaceTransaction, ownerId: string, thingId: string, before: number | null, limit: number) {
	if (
		!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(thingId) ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 40 ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1))
	)
		refuse(400, 'Invalid branch page request.');
	const branches = new Map((await tx.list<TimelineBranch>(BRANCHES)).map((row) => [row.id, branchValue(row.value, row.id, ownerId)]));
	const indices = new Map((await tx.list<Index>(INDEX)).map((row) => [row.id, row.value]));
	const heads = (await tx.list<TimelineBranchHead>(HEADS)).map((row) => {
		const head = headValue(row.value, row.id, ownerId),
			index = indexValue(indices.get(head.id), head),
			branch = branches.get(head.branchId);
		if (!branch) damaged();
		return { branch: branch!, head, position: index.position };
	});
	if (indices.size !== heads.length || new Set(heads.map((row) => row.position)).size !== heads.length) damaged();
	const selected = heads
		.filter((row) => row.head.thingId === thingId && (before === null || row.position < before))
		.sort((a, b) => b.position - a.position);
	const page = selected.slice(0, limit);
	return { branches: page.map(({ branch, head }) => ({ branch, head })), nextBefore: selected.length > limit ? page.at(-1)!.position : null };
}
async function readNodes(ids: string[], read: Read): Promise<TimelineGraphNode[]> {
	const nodes: TimelineGraphNode[] = [];
	for (const id of ids) {
		const entry = await read(id);
		if (entry)
			nodes.push({
				id: entry.event.id,
				thingId: entry.event.thingId,
				parentIds: entry.event.parentIds,
				afterAdapter: entry.event.after?.adapter ?? null
			});
	}
	return nodes;
}
export async function writeLocalBranch(
	tx: WorkspaceTransaction,
	ownerId: string,
	command: TimelineBranchCommand,
	signature: string,
	read: Read,
	append: (event: TimelineEvent) => Promise<TimelineEntry>,
	now: string
) {
	const replay = replayBranch(await read(`branch-op-${command.operationId}`), ownerId, command, signature);
	if (replay) return replay;
	const existing = await readBranch(tx, ownerId, command.branchId),
		current = await readHead(tx, ownerId, command.branchId, command.thingId);
	if (current && !existing) damaged();
	const { branch, head, event } = await planBranch({
		ownerId,
		command,
		signature,
		existing,
		current,
		readEntry: read,
		readNodes: (ids) => readNodes(ids, read),
		now: new Date(now)
	});
	const entry = await append(event);
	if (!existing) await tx.put(BRANCHES, branch.id, branch);
	await tx.put(HEADS, head.id, head);
	if (!current) await tx.put(INDEX, head.id, { id: head.id, thingId: head.thingId, position: entry.receipt.position } satisfies Index);
	return { ok: true as const, branch, head, entry };
}
/** Materialize only this fixed, recorded head. Never borrow the current Thing. */
export async function checkoutLocalBranch(tx: WorkspaceTransaction, ownerId: string, request: BranchCheckoutRequest, read: Read) {
	const target = await readLocalBranch(tx, ownerId, request.branchId, request.thingId);
	if (target.head.revision !== request.expectedRevision || target.head.eventId !== request.expectedHeadId)
		refuse(409, 'This branch changed. Pull its latest version before opening it.');
	const entry = await read(target.head.eventId);
	if (!entry || entry.event.ownerId !== ownerId || entry.event.thingId !== request.thingId || entry.event.mode === 'effect' || !entry.event.after)
		return refuse(404, 'This branch version is unavailable.');
	const graph =
		entry.event.after.adapter === 'thing-content'
			? new Map<string, TimelineGraphNode>()
			: await loadVersionGraph([entry.event.id], request.thingId, (ids) => readNodes(ids, read));
	const content = await createVersionContentReader(
		graph,
		async (ids) => {
			const entries: TimelineEntry[] = [];
			for (const id of ids) {
				const found = await read(id);
				if (found) entries.push(found);
			}
			return entries;
		},
		async (item) => item.event.after
	)(entry);
	return {
		ok: true as const,
		checkout: parseBranchCheckout({ ...target, entry, snapshot: { adapter: 'thing-content', version: 1, value: content } }, ownerId, request)
	};
}
