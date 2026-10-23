import { createHash } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract';
import {
	parseAlgorithmWrite,
	parseAlgorithmWriteAcknowledgment,
	ALGORITHM_SYNC_MAX_BYTES,
	type AlgorithmWrite,
	type AlgorithmWriteAcknowledgment
} from './algorithmSyncContract';
const adapter = 'algorithm-write-receipt';
const invalid = (): never => {
	throw new Error('Algorithm save receipt does not match this operation.');
};
const digestValid = (value: unknown): value is string => typeof value === 'string' && /^algorithm-write-v1:[a-f0-9]{64}$/.test(value);
export function algorithmWriteDigest(ownerId: string, raw: AlgorithmWrite): string {
	if (!ownerId) return invalid();
	const request = copyBoundedJson(
		{ ownerId, storagePlane: 'home', command: parseAlgorithmWrite(raw) },
		{ maxBytes: ALGORITHM_SYNC_MAX_BYTES + 4096, maxDepth: 12, maxNodes: 65000, sortKeys: true }
	);
	return 'algorithm-write-v1:' + createHash('sha256').update('thingtime:algorithm-write:v1\0').update(JSON.stringify(request)).digest('hex');
}
export function algorithmWriteEventId(writeId: string) {
	parseAlgorithmWrite({
		id: '123e4567-e89b-42d3-a456-426614174000',
		writeId,
		expectedVersion: null,
		action: 'save',
		content: { name: 'Receipt', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null },
		description: ''
	});
	return 'algorithm-write-' + writeId;
}
export function createAlgorithmWriteReceipt(
	ownerId: string,
	raw: AlgorithmWriteAcknowledgment,
	requestDigest: string,
	occurredAt: string
): TimelineEvent {
	const receipt = parseAlgorithmWriteAcknowledgment(raw);
	if (!digestValid(requestDigest)) return invalid();
	return parseTimelineEvent({
		formatVersion: 1,
		id: algorithmWriteEventId(receipt.writeId),
		ownerId,
		thingId: receipt.id,
		branchId: 'main',
		parentIds: [],
		operationId: receipt.writeId,
		actorId: ownerId,
		source: 'api',
		clientId: null,
		occurredAt,
		mode: 'effect',
		operation: 'effect',
		label: 'Synchronized algorithm',
		before: null,
		after: { adapter, version: 1, value: { ...receipt, requestDigest } },
		dependencies: []
	});
}
export function readAlgorithmWriteReceipt(input: unknown, ownerId: string, raw: AlgorithmWrite, requestDigest: string): AlgorithmWriteAcknowledgment {
	const command = parseAlgorithmWrite(raw),
		event = parseTimelineEvent(input);
	if (
		!digestValid(requestDigest) ||
		event.id !== algorithmWriteEventId(command.writeId) ||
		event.ownerId !== ownerId ||
		event.actorId !== ownerId ||
		event.thingId !== command.id ||
		event.operationId !== command.writeId ||
		event.source !== 'api' ||
		event.clientId !== null ||
		event.mode !== 'effect' ||
		event.operation !== 'effect' ||
		event.branchId !== 'main' ||
		event.parentIds.length ||
		event.dependencies.length ||
		event.before !== null ||
		event.after?.adapter !== adapter ||
		event.after.version !== 1
	)
		return invalid();
	const value = event.after.value;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
	const { requestDigest: stored, ...fields } = value;
	if (stored !== requestDigest) return invalid();
	const receipt = parseAlgorithmWriteAcknowledgment(fields);
	if (
		receipt.id !== command.id ||
		receipt.writeId !== command.writeId ||
		receipt.action !== command.action ||
		receipt.expectedVersion !== command.expectedVersion
	)
		return invalid();
	return receipt;
}
