import { copyBoundedJson } from '../utils/boundedJson.ts';
import type { TimelineEntry } from './contract.ts';

export const TIMELINE_BRANCH_KIND = 'timeline-branch';
export const TIMELINE_BRANCH_HEAD_KIND = 'timeline-branch-head';
export type TimelineBranch = { formatVersion: 1; id: string; ownerId: string; name: string; createdAt: string };
/** One current-version pointer per branch/Thing pair, never a heads array. */
export type TimelineBranchHead = { formatVersion: 1; id: string; ownerId: string; branchId: string; thingId: string; eventId: string; revision: number; createdAt: string; updatedAt: string };
export type TimelineBranchEntry = { branch: TimelineBranch; head: TimelineBranchHead };
export type TimelineBranchCommand = {
	command: 'create-branch' | 'advance-branch'; operationId: string; branchId: string;
	thingId: string; eventId: string; expectedRevision: number; name: string | null;
};
export type TimelineBranchResult = { ok: true; branch: TimelineBranch; head: TimelineBranchHead; entry: TimelineEntry };
export type TimelineBranchPage = { branches: TimelineBranchEntry[]; nextBefore: number | null };
export type TimelineBranchLookup = { branchId: string; thingId: string };
export const timelineBranchHeadId = (branchId: string, thingId: string) => `${branchId}/thing/${thingId}`;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const uuid = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const branchId = (value: unknown): boolean => typeof value === 'string' && value.startsWith('branch-') && uuid(value.slice(7));
export const isTimelineBranchId = branchId;
const date = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const name = (value: unknown): boolean => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
function record(input: unknown, keys: string[]): Record<string, any> {
	const value = copyBoundedJson(input, { maxBytes: 4096, maxDepth: 2, maxNodes: 16, sortKeys: true }, 'Timeline branch') as Record<string, any>;
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error('Invalid Timeline branch fields');
	return value;
}
export function parseTimelineBranch(input: unknown): TimelineBranch {
	const value = record(input, ['formatVersion', 'id', 'ownerId', 'name', 'createdAt']);
	if (value.formatVersion !== 1 || !branchId(value.id) || !identifier(value.ownerId) || !name(value.name) || !date(value.createdAt)) throw new Error('Invalid Timeline branch');
	return value as TimelineBranch;
}
export function parseTimelineBranchHead(input: unknown): TimelineBranchHead {
	const value = record(input, ['formatVersion', 'id', 'ownerId', 'branchId', 'thingId', 'eventId', 'revision', 'createdAt', 'updatedAt']);
	if (value.formatVersion !== 1 || !branchId(value.branchId) || !identifier(value.ownerId) || !identifier(value.thingId) || !identifier(value.eventId) || value.id !== timelineBranchHeadId(value.branchId, value.thingId) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !date(value.createdAt) || !date(value.updatedAt) || value.updatedAt < value.createdAt) throw new Error('Invalid Timeline branch head');
	return value as TimelineBranchHead;
}
export function parseTimelineBranchEntry(input: TimelineBranchEntry): TimelineBranchEntry {
	const branch = parseTimelineBranch(input?.branch); const head = parseTimelineBranchHead(input?.head);
	if (head.ownerId !== branch.ownerId || head.branchId !== branch.id) throw new Error('Timeline branch does not match its head');
	return { branch, head };
}
/** A transient lookup, not another durable branch or history format. */
export function parseTimelineBranchLookup(input: unknown): TimelineBranchLookup {
	const value = record(input, ['branchId', 'thingId']);
	if (!branchId(value.branchId) || !identifier(value.thingId)) throw new Error('Invalid Timeline branch lookup');
	return value as TimelineBranchLookup;
}
export function parseTimelineBranchLookupResult(input: TimelineBranchEntry, ownerId: string, lookup: TimelineBranchLookup): TimelineBranchEntry {
	const expected = parseTimelineBranchLookup(lookup);
	const entry = parseTimelineBranchEntry(input);
	if (entry.branch.ownerId !== ownerId || entry.branch.id !== expected.branchId || entry.head.thingId !== expected.thingId) throw new Error('Server returned another branch or Thing');
	return entry;
}
export function parseTimelineBranchCommand(input: unknown): TimelineBranchCommand {
	const value = record(input, ['command', 'operationId', 'branchId', 'thingId', 'eventId', 'expectedRevision', 'name']);
	if (!['create-branch', 'advance-branch'].includes(value.command) || !uuid(value.operationId) || !branchId(value.branchId) || !identifier(value.thingId) || !identifier(value.eventId) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw new Error('Invalid Timeline branch command');
	if (value.command === 'create-branch' ? !name(value.name) || value.expectedRevision !== 0 : value.name !== null) throw new Error('Invalid Timeline branch command fields');
	return value as TimelineBranchCommand;
}
