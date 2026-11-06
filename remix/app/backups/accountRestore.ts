import { timelineScopeKey, type TimelineScope } from '../timeline/contract';

export const ACCOUNT_RESTORE_PLAN_FORMAT = 'thingtime-account-restore-plan-v1' as const;
export const ACCOUNT_RESTORE_FAMILIES = ['ordinary', 'files', 'attachments', 'drafts', 'themes', 'account-content', 'timeline', 'other-managed', 'credentials-security', 'external-settings', 'device-local'] as const;
export type AccountRestoreFamily = (typeof ACCOUNT_RESTORE_FAMILIES)[number];
export type AccountRestoreDestination = {
	scope: TimelineScope;
	rootId: string;
	rootRevision: string;
	/** Negotiated values supplied by the host, bound into review, never authority. */
	capabilities: Record<string, string>;
};
export type AccountRestoreIssue = {
	kind: 'issue';
	code: 'unsupported-adapter' | 'unavailable-dependency' | 'ambiguous-dependency' | 'structural-cycle' | 'unverified-coverage' | 'writers-unavailable' | 'incomplete-reference-discovery';
	sourceId: string | null;
	reference: string | null;
};
export type AccountRestoreEntry = {
	kind: 'entry'; sourceId: string; targetId: string; ordinal: number;
	family: AccountRestoreFamily; adapter: string; version: number; itemHash: string;
};
export type AccountRestoreDependency = {
	kind: 'dependency'; sourceId: string; reference: string; referenceKind: string;
	targetSourceId: string | null; targetId: string | null;
};
export type AccountRestoreRecord = AccountRestoreEntry | AccountRestoreDependency | AccountRestoreIssue;
export type AccountRestoreCoverage = {
	formatVersion: 1;
	selection: 'whole-account';
	/** v1 BackupHeader coverage is prose, never machine-verifiable completeness. */
	sourceCoverage: 'unknown';
	referenceDiscovery: 'partial';
	requiredFamilies: readonly AccountRestoreFamily[];
	observedFamilies: Partial<Record<AccountRestoreFamily, number>>;
	sourceFormatLimitations: { adapter: 'thing-content|backup-thing-content'; reason: 'legacy-record-json-processing-budget'; maxNodes: number; maxPayloadBytes: number }[];
	writerReadiness: 'unavailable';
	wholeAccountReady: false;
};
export function accountRestoreDestination(input: AccountRestoreDestination): AccountRestoreDestination {
	if (!input || Object.keys(input).sort().join(',') !== 'capabilities,rootId,rootRevision,scope') throw Error('Invalid restore destination');
	const scope = { ...input.scope };
	timelineScopeKey(scope);
	if (Object.keys(scope).sort().join(',') !== 'apiOrigin,dataPlane,ownerId' || scope.dataPlane !== 'home' ||
		![input.rootId, input.rootRevision].every(value => typeof value === 'string' && !!value.trim()) ||
		!input.capabilities || typeof input.capabilities !== 'object' || Array.isArray(input.capabilities)) throw Error('Invalid restore destination');
	const capabilities: Record<string, string> = {};
	for (const key of Object.keys(input.capabilities).sort()) {
		if (!/^api\.[a-z0-9-]+$/.test(key) || !/^\d+\.\d+\.\d+$/.test(input.capabilities[key])) throw Error('Invalid restore capability contract');
		capabilities[key] = input.capabilities[key];
	}
	return { scope, rootId: input.rootId, rootRevision: input.rootRevision, capabilities };
}

/** Reviewed object-store records are data, never destination write authority. */
export function parseAccountRestoreRecord(input: unknown): AccountRestoreRecord {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid restore review record');
	const record = input as Record<string, any>;
	const fields: Record<string, string[]> = {
		entry: ['kind', 'sourceId', 'targetId', 'ordinal', 'family', 'adapter', 'version', 'itemHash'],
		dependency: ['kind', 'sourceId', 'reference', 'referenceKind', 'targetSourceId', 'targetId'],
		issue: ['kind', 'code', 'sourceId', 'reference']
	};
	const expected = Object.prototype.hasOwnProperty.call(fields, record.kind) ? fields[record.kind] : null;
	if (!expected || Object.keys(record).sort().join(',') !== [...expected].sort().join(',')) throw Error('Invalid restore review fields');
	const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
	if (record.kind === 'entry') {
		if (![record.sourceId, record.targetId, record.adapter].every(text) || !ACCOUNT_RESTORE_FAMILIES.includes(record.family) ||
			!Number.isSafeInteger(record.ordinal) || record.ordinal < 0 || !Number.isSafeInteger(record.version) || record.version < 1 ||
			!/^[a-f0-9]{64}$/.test(record.itemHash)) throw Error('Invalid restore review entry');
	} else if (record.kind === 'dependency') {
		if (![record.sourceId, record.reference, record.referenceKind].every(text) ||
			!((record.targetSourceId === null && record.targetId === null) || (text(record.targetSourceId) && text(record.targetId)))) throw Error('Invalid restore review dependency');
	} else if (!['unsupported-adapter', 'unavailable-dependency', 'ambiguous-dependency', 'structural-cycle', 'unverified-coverage', 'writers-unavailable', 'incomplete-reference-discovery'].includes(record.code) ||
		(record.sourceId !== null && !text(record.sourceId)) || (record.reference !== null && !text(record.reference))) throw Error('Invalid restore review issue');
	return record as AccountRestoreRecord;
}
