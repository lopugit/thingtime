import { createHash } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract';
import {
	parseThemeWrite,
	parseThemeWriteAcknowledgment,
	THEME_SYNC_MAX_BYTES,
	type ThemeWrite,
	type ThemeWriteAcknowledgment
} from './themeSyncContract';
const adapter = 'theme-write-receipt';
const invalid = (): never => {
	throw new Error('Theme save receipt does not match this operation.');
};
const digestValid = (value: unknown): value is string => typeof value === 'string' && /^theme-write-v1:[a-f0-9]{64}$/.test(value);
export function themeWriteDigest(ownerId: string, selectedPlane: string, raw: ThemeWrite): string {
	if (!ownerId || !selectedPlane) return invalid();
	const request = copyBoundedJson(
		{ ownerId, selectedPlane, storagePlane: 'home', command: parseThemeWrite(raw) },
		{ maxBytes: THEME_SYNC_MAX_BYTES + 4096, maxDepth: 12, maxNodes: 4096, sortKeys: true }
	);
	return 'theme-write-v1:' + createHash('sha256').update('thingtime:theme-write:v1\0').update(JSON.stringify(request)).digest('hex');
}
export function themeWriteEventId(writeId: string) {
	parseThemeWrite({
		id: '123e4567-e89b-42d3-a456-426614174000',
		writeId,
		expectedVersion: null,
		action: 'save',
		name: 'Receipt',
		theme: {},
		visibility: 'private'
	});
	return 'theme-write-' + writeId;
}
export function createThemeWriteReceipt(ownerId: string, raw: ThemeWriteAcknowledgment, requestDigest: string, occurredAt: string): TimelineEvent {
	const receipt = parseThemeWriteAcknowledgment(raw);
	if (!digestValid(requestDigest)) return invalid();
	return parseTimelineEvent({
		formatVersion: 1,
		id: themeWriteEventId(receipt.writeId),
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
		label: 'Synchronized theme',
		before: null,
		after: { adapter, version: 1, value: { ...receipt, requestDigest } },
		dependencies: []
	});
}
export function readThemeWriteReceipt(input: unknown, ownerId: string, raw: ThemeWrite, requestDigest: string): ThemeWriteAcknowledgment {
	const command = parseThemeWrite(raw),
		event = parseTimelineEvent(input);
	if (
		!digestValid(requestDigest) ||
		event.id !== themeWriteEventId(command.writeId) ||
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
	const receipt = parseThemeWriteAcknowledgment(fields);
	if (
		receipt.id !== command.id ||
		receipt.writeId !== command.writeId ||
		receipt.action !== command.action ||
		receipt.expectedVersion !== command.expectedVersion
	)
		return invalid();
	return receipt;
}
