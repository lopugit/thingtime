import { copyBoundedJson } from '../../../utils/boundedJson';
import { parseAlgorithmTransfer, type AlgorithmTransferContent } from './algorithmTransferCore';
export const ALGORITHM_SYNC_MAX_BYTES = 2 * 1024 * 1024;
export const ALGORITHM_VERSION_PREFIX = 'algorithm-state-v1:';
export const validAlgorithmVersion = (value: unknown): value is string =>
	typeof value === 'string' && /^algorithm-state-v1:[a-f0-9]{64}$/.test(value);
const identity = (value: unknown): value is string =>
	typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) && !value.startsWith('timeline-');
const freshId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (): never => {
	throw new Error('Invalid algorithm synchronization command.');
};
export type AlgorithmWrite = { id: string; writeId: string; expectedVersion: string | null } & (
	| { action: 'save'; content: AlgorithmTransferContent; description: string; parentId?: string | null; folderId?: string | null }
	| { action: 'delete'; expectedVersion: string }
);
export type AlgorithmWriteAcknowledgment = {
	id: string;
	writeId: string;
	action: 'save' | 'delete';
	expectedVersion: string | null;
	resultVersion: string | null;
};
/** Profiles are validated portable content, never events to replay or fields
 * that can publish a profile or grant access to another owner's data. */
export function parseAlgorithmWrite(input: unknown): AlgorithmWrite {
	const value = copyBoundedJson(input, { maxBytes: ALGORITHM_SYNC_MAX_BYTES, maxDepth: 10, maxNodes: 65000, sortKeys: true });
	if (
		!object(value) ||
		!identity(value.id) ||
		!identity(value.writeId) ||
		value.writeId.length > 160 ||
		(value.expectedVersion !== null && !validAlgorithmVersion(value.expectedVersion)) ||
		(value.expectedVersion === null && !freshId(value.id))
	)
		return fail();
	const base = { id: value.id, writeId: value.writeId, expectedVersion: value.expectedVersion as string | null };
	if (value.action === 'delete') {
		if (value.expectedVersion === null || Object.keys(value).some((key) => !['id', 'writeId', 'expectedVersion', 'action'].includes(key)))
			return fail();
		return { ...base, action: 'delete', expectedVersion: value.expectedVersion as string };
	}
	if (
		value.action !== 'save' ||
		Object.keys(value).some(
			(key) => !['id', 'writeId', 'expectedVersion', 'action', 'content', 'description', 'parentId', 'folderId'].includes(key)
		) ||
		typeof value.description !== 'string' ||
		value.description.length > 300 ||
		value.description !== value.description.trim() ||
		('folderId' in value && value.folderId !== null && (!identity(value.folderId) || value.folderId === value.id)) ||
		('parentId' in value &&
			(value.expectedVersion !== null || (value.parentId !== null && (!identity(value.parentId) || value.parentId === value.id))))
	)
		return fail();
	return {
		...base,
		action: 'save',
		content: parseAlgorithmTransfer(value.content),
		description: value.description,
		...('parentId' in value ? { parentId: value.parentId as string | null } : {}),
		...('folderId' in value ? { folderId: value.folderId as string | null } : {})
	};
}
export function parseAlgorithmWriteAcknowledgment(input: unknown): AlgorithmWriteAcknowledgment {
	if (
		!object(input) ||
		Object.keys(input).length !== 5 ||
		Object.keys(input).some((key) => !['id', 'writeId', 'action', 'expectedVersion', 'resultVersion'].includes(key)) ||
		!identity(input.id) ||
		!identity(input.writeId) ||
		input.writeId.length > 160 ||
		!['save', 'delete'].includes(String(input.action)) ||
		(input.expectedVersion !== null && !validAlgorithmVersion(input.expectedVersion)) ||
		(input.expectedVersion === null && !freshId(input.id)) ||
		(input.action === 'delete' ? input.expectedVersion === null || input.resultVersion !== null : !validAlgorithmVersion(input.resultVersion))
	)
		return fail();
	return {
		id: input.id,
		writeId: input.writeId,
		action: input.action as 'save' | 'delete',
		expectedVersion: input.expectedVersion as string | null,
		resultVersion: input.resultVersion as string | null
	};
}
