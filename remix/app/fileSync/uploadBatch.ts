import { parseFileSyncConfiguration, canonicalResourceLimitFields } from './configuration';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { parseCloudWrite, type CloudWrite } from './cloudWrite';
import { cloudFileSyncEntry, parseCloudFile, type CloudFile } from './cloudFile';
import { equalContentFingerprints, validContentFingerprint, type ContentFingerprint } from './contentFingerprint';
import { createSyncIgnorePolicy } from './syncIgnore';
import {
	sameSyncContent,
	sameSyncScope,
	syncPathKey,
	validSyncEntry,
	validSyncPath,
	validateSyncScope,
	type SyncEntry,
	type SyncScope
} from './reconcile';
import { parseCloudInventoryNode, type CloudInventoryNode } from './cloudInventory';

export const UPLOAD_BATCH_REQUIREMENTS = { 'api.file-sync-batches': '1.0.0' } as const;
export const UPLOAD_BATCH_FILES = 256;
export const UPLOAD_BATCH_FILE_BYTES = 256 * 1024;
export const UPLOAD_BATCH_BYTES = 32 * 1024 * 1024;
export const UPLOAD_BATCH_METADATA_BYTES = 512 * 1024;
/** Leave192KiB for the largest checksum/upload/content control envelope. */
export const UPLOAD_BATCH_DESCRIPTOR_BYTES = 320 * 1024;
/** Signed URLs remain in Electron, outside native metadata frames. */
export const UPLOAD_BATCH_RESPONSE_BYTES = 2 * 1024 * 1024;
export const UPLOAD_BATCH_PUT_CONCURRENCY = 16;
export const UPLOAD_BATCH_DISPATCH_MS = 30_000;
export const UPLOAD_BATCH_LIFETIME_MS = 180_000;

/** A closed, immutable operation list, never an authorization credential. */
export type UploadBatchDescriptor = {
	version: 1;
	batchId: string;
	scope: SyncScope;
	configuration: SavedFileSyncConfiguration;
	members: { ordinal: number; write: CloudWrite }[];
};
export type UploadBatchFailureCode =
	| 'conflict'
	| 'temporarily-unavailable'
	| 'authority-changed'
	| 'invalid-member'
	| 'source-changed'
	| 'cancelled'
	| 'deadline';
export type UploadBatchFailure = { ordinal: number; status: 'failed'; statusCode: number; code: UploadBatchFailureCode; retryable: boolean };
export type UploadBatchConfirmed = { ordinal: number; status: 'confirmed'; file: CloudFile; replayed: boolean };
export type UploadBatchPrepared = {
	ordinal: number;
	status: 'prepared';
	upload: { id: string; partSizeBytes: number; partCount: 1 };
	part: { partNumber: 1; url: string; expiresAt: string; headers: Record<string, string> };
};
export type UploadBatchContent = { ordinal: number; uploadId: string; version: string; size: number; fingerprint: ContentFingerprint };
export type UploadBatchVerified = { ordinal: number; status: 'verified'; content: UploadBatchContent };
export type UploadBatchSourceRequired = { ordinal: number; status: 'source-required' };
export type UploadBatchEnvelope<T> = { ok: true; version: 1; batchId: string; digest: string; results: T[] };
export type UploadBatchPrepareResponse = UploadBatchEnvelope<
	UploadBatchPrepared | UploadBatchConfirmed | UploadBatchVerified | UploadBatchSourceRequired | UploadBatchFailure
>;
export type UploadBatchVerifyResponse = UploadBatchEnvelope<UploadBatchVerified | UploadBatchFailure>;
export type UploadBatchCommitResponse = UploadBatchEnvelope<UploadBatchConfirmed | UploadBatchFailure>;
export type UploadBatchRequest =
	| UploadBatchObserveRequest
	| { phase: 'prepare'; descriptor: UploadBatchDescriptor; digest: string; checksums: { ordinal: number; sha256: string }[] }
	| { phase: 'verify'; descriptor: UploadBatchDescriptor; digest: string; uploads: { ordinal: number; uploadId: string }[] }
	| { phase: 'commit'; descriptor: UploadBatchDescriptor; digest: string; contents: UploadBatchContent[] };
export type UploadBatchObserveRequest = { phase: 'observe'; scope: SyncScope; configuration: SavedFileSyncConfiguration; paths: string[] };
export type UploadBatchObserveResponse = {
	ok: true;
	version: 1;
	observations: { path: string; node: CloudInventoryNode | null; parent: CloudInventoryNode | null }[];
};

/** Electron retains signed URLs. Native receives only the immutable descriptor,
 * bounded bytes/control callbacks and verified stored identities. */
export type NativeUploadBatchInput = { descriptor: UploadBatchDescriptor; digest: string };
export type NativeUploadBatchResult = UploadBatchEnvelope<UploadBatchVerified | UploadBatchConfirmed | UploadBatchFailure> & {
	payloads: { ordinal: number; bytes: number | null }[];
};
export type NativeUploadBatchCallbacks = {
	progress?(ordinal: number, bytes: number, size: number): void;
	/** Acknowledged PUT payload only; null means an accepted response was lost. */
	transferred?(ordinal: number, bytes: number | null): void;
};
export type NativeUploadBatch = (
	input: NativeUploadBatchInput,
	callbacks: NativeUploadBatchCallbacks,
	signal: AbortSignal
) => Promise<NativeUploadBatchResult>;

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const closed = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const invalid = () => Error('Invalid immutable upload batch.');

export const eligibleUploadBatchEntry = (entry: SyncEntry): boolean =>
	validSyncEntry(entry) &&
	entry.kind === 'file' &&
	entry.size > 0 &&
	entry.size <= UPLOAD_BATCH_FILE_BYTES &&
	entry.sha256 === null &&
	entry.fingerprint?.partCount === 1;

export function eligibleUploadBatchWrite(value: unknown, scope?: SyncScope): value is CloudWrite {
	try {
		const write = parseCloudWrite(value as CloudWrite),
			mutation = write.operation.mutation;
		return (
			!write.operation.confirmed &&
			(!scope || sameSyncScope(scope, write.scope)) &&
			write.before === null &&
			typeof write.folderId === 'string' &&
			!!write.folderId &&
			typeof write.cloudRootId === 'string' &&
			mutation.kind === 'copy' &&
			mutation.from === 'local' &&
			mutation.expectedTarget === null &&
			eligibleUploadBatchEntry(mutation.source)
		);
	} catch {
		return false;
	}
}

export function parseBatchScopeConfiguration(scopeValue: unknown, savedValue: unknown): { scope: SyncScope; configuration: SavedFileSyncConfiguration } {
	if (!object(savedValue) || !closed(savedValue, ['id', 'updatedAt', 'configuration'])) throw invalid();
	const scope = structuredClone(scopeValue) as SyncScope;
	validateSyncScope(scope);
	const saved = savedValue as Record<string, any>,
		configuration = parseFileSyncConfiguration(saved.configuration);
	if (
		!object(scopeValue) ||
		!closed(scopeValue, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']) ||
		!object(saved.configuration) ||
		!closed(saved.configuration, [
			'configurationVersion',
			'name',
			'deviceId',
			'localRootId',
			'sourceKind',
			'remoteFolderId',
			'mode',
			'paused',
			'propagateDeletes',
			'network',
			'chargingOnly',
			'excludedPaths',
			'ignoreRules',
			'resourceLimits'
		]) ||
		scope.dataPlane !== 'home' ||
		saved.id !== scope.rootId ||
		configuration.deviceId !== scope.deviceId ||
		typeof saved.updatedAt !== 'string' ||
		!Number.isFinite(Date.parse(saved.updatedAt)) ||
		!['backup', 'upload'].includes(configuration.mode) ||
		configuration.paused ||
		configuration.propagateDeletes ||
		configuration.sourceKind === 'photos'
	)
		throw invalid();
	return { scope, configuration: { id: saved.id as string, updatedAt: saved.updatedAt as string, configuration } };
}

export function parseUploadBatchDescriptor(value: unknown): UploadBatchDescriptor {
	if (
		!object(value) ||
		!closed(value, ['version', 'batchId', 'scope', 'configuration', 'members']) ||
		value.version !== 1 ||
		typeof value.batchId !== 'string' ||
		!uuid.test(value.batchId) ||
		!object(value.configuration) ||
		!closed(value.configuration, ['id', 'updatedAt', 'configuration']) ||
		!Array.isArray(value.members) ||
		value.members.length < 1 ||
		value.members.length > UPLOAD_BATCH_FILES
	)
		throw invalid();
	const { scope, configuration: saved } = parseBatchScopeConfiguration(value.scope, value.configuration);
	const configuration = saved.configuration;
	const paths = new Set<string>(),
		ids = new Set<string>(),
		sourceIds = new Set<string>(),
		destinations = new Set<string>();
	const ignore = createSyncIgnorePolicy(configuration.ignoreRules, configuration.excludedPaths);
	let total = 0;
	const members = value.members.map((member, ordinal) => {
		if (!object(member) || !closed(member, ['ordinal', 'write']) || member.ordinal !== ordinal || !eligibleUploadBatchWrite(member.write, scope))
			throw invalid();
		const write = parseCloudWrite(member.write),
			mutation = write.operation.mutation;
		if (mutation.kind !== 'copy') throw invalid();
		if (
			!closed(write as unknown as Record<string, unknown>, ['operation', 'scope', 'folderId', 'before', 'cloudRootId']) ||
			!closed(write.operation as unknown as Record<string, unknown>, ['id', 'mutation', 'confirmed']) ||
			!closed(mutation as unknown as Record<string, unknown>, ['kind', 'path', 'from', 'source', 'expectedTarget']) ||
			!closed(mutation.source as unknown as Record<string, unknown>, ['path', 'id', 'version', 'kind', 'size', 'sha256', 'fingerprint']) ||
			!closed(mutation.source.fingerprint as unknown as Record<string, unknown>, ['algorithm', 'partSizeBytes', 'partCount', 'sha256']) ||
			!closed(write.scope as unknown as Record<string, unknown>, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId'])
		)
			throw invalid();
		const key = syncPathKey(mutation.path);
		const destination = JSON.stringify([write.folderId, syncPathKey(mutation.path.split('/').at(-1)!)]);
		if (
			paths.has(key) ||
			ids.has(write.operation.id) ||
			sourceIds.has(mutation.source.id) ||
			write.cloudRootId !== configuration.remoteFolderId ||
			destinations.has(destination) ||
			ignore.ignored(mutation.path, 'file')
		)
			throw invalid();
		paths.add(key);
		ids.add(write.operation.id);
		sourceIds.add(mutation.source.id);
		destinations.add(destination);
		total += mutation.source.size;
		return { ordinal, write };
	});
	if (total > UPLOAD_BATCH_BYTES) throw invalid();
	const result: UploadBatchDescriptor = {
		version: 1,
		batchId: value.batchId,
		scope,
		configuration: { id: saved.id as string, updatedAt: saved.updatedAt, configuration },
		members
	};
	if (new TextEncoder().encode(JSON.stringify(result)).length > UPLOAD_BATCH_DESCRIPTOR_BYTES) throw invalid();
	return result;
}

/** Cross-language canonical encoding: ordered UTF-8 strings, each prefixed by
 * its decimal BYTE length and ':'. No JSON escaping/dictionary ordering rules. */
export function uploadBatchCanonicalBytes(value: unknown): Uint8Array {
	const d = parseUploadBatchDescriptor(value),
		s = d.scope,
		saved = d.configuration,
		c = saved.configuration;
	const fields = [
		c.resourceLimits ? 'thingtime-upload-batch-v2' : 'thingtime-upload-batch-v1',
		d.batchId,
		s.origin,
		s.ownerId,
		s.dataPlane,
		s.rootId,
		s.deviceId,
		saved.id,
		saved.updatedAt,
		String(c.configurationVersion),
		c.name,
		c.deviceId,
		c.localRootId,
		c.sourceKind ?? 'folder',
		c.remoteFolderId,
		c.mode,
		c.paused ? '1' : '0',
		c.propagateDeletes ? '1' : '0',
		c.network,
		c.chargingOnly ? '1' : '0',
		String(c.excludedPaths.length),
		...c.excludedPaths,
		c.ignoreRules ?? '',
		...(c.resourceLimits ? canonicalResourceLimitFields(c.resourceLimits) : []),
		String(d.members.length)
	];
	for (const { ordinal, write } of d.members) {
		const m = write.operation.mutation;
		if (m.kind !== 'copy' || !m.source.fingerprint) throw invalid();
		const e = m.source,
			f = e.fingerprint;
		fields.push(
			String(ordinal),
			write.operation.id,
			write.cloudRootId!,
			write.folderId!,
			m.path,
			e.id,
			e.version,
			String(e.size),
			e.sha256 ?? '',
			f.algorithm,
			String(f.partSizeBytes),
			String(f.partCount),
			f.sha256
		);
	}
	const encoder = new TextEncoder();
	return encoder.encode(fields.map((field) => `${encoder.encode(field).length}:${field}`).join(''));
}

export async function uploadBatchDigest(value: unknown): Promise<string> {
	const bytes = uploadBatchCanonicalBytes(value);
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (n) => n.toString(16).padStart(2, '0')).join('');
}

export function parseNativeUploadBatchResult(value: unknown, input: NativeUploadBatchInput): NativeUploadBatchResult {
	const d = parseUploadBatchDescriptor(input.descriptor);
	if (
		!object(value) ||
		!closed(value, ['ok', 'version', 'batchId', 'digest', 'results', 'payloads']) ||
		value.ok !== true ||
		value.version !== 1 ||
		value.batchId !== d.batchId ||
		value.digest !== input.digest ||
		!/^[a-f0-9]{64}$/.test(input.digest) ||
		!Array.isArray(value.results) ||
		value.results.length !== d.members.length ||
		!Array.isArray(value.payloads) ||
		value.payloads.length !== d.members.length
	)
		throw invalid();
	const results = value.results.map((result, ordinal): NativeUploadBatchResult['results'][number] => {
		if (!object(result) || result.ordinal !== ordinal) throw invalid();
		const { write } = d.members[ordinal],
			m = write.operation.mutation;
		if (m.kind !== 'copy' || !m.source.fingerprint) throw invalid();
		if (result.status === 'confirmed') {
			if (!closed(result, ['ordinal', 'status', 'file', 'replayed']) || typeof result.replayed !== 'boolean') throw invalid();
			const file = parseCloudFile(result.file);
			if (
				file.id !== write.operation.id ||
				file.name !== m.path.split('/').at(-1) ||
				file.folderId !== write.folderId ||
				file.trashed ||
				!sameSyncContent(cloudFileSyncEntry(file, m.path), m.source)
			)
				throw invalid();
			return { ordinal, status: 'confirmed', file, replayed: result.replayed };
		}
		if (result.status === 'verified') {
			const c = result.content;
			if (
				!closed(result, ['ordinal', 'status', 'content']) ||
				!object(c) ||
				!closed(c, ['ordinal', 'uploadId', 'version', 'size', 'fingerprint']) ||
				c.ordinal !== ordinal ||
				typeof c.uploadId !== 'string' ||
				!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(c.uploadId) ||
				typeof c.version !== 'string' ||
				!/^[a-f0-9]{64}$/.test(c.version) ||
				c.size !== m.source.size ||
				!validContentFingerprint(c.fingerprint, c.size as number) ||
				!equalContentFingerprints(c.fingerprint, m.source.fingerprint)
			)
				throw invalid();
			return { ordinal, status: 'verified', content: structuredClone(c) as UploadBatchContent };
		}
		const codes: UploadBatchFailureCode[] = [
			'conflict',
			'temporarily-unavailable',
			'authority-changed',
			'invalid-member',
			'source-changed',
			'cancelled',
			'deadline'
		];
		if (
			result.status !== 'failed' ||
			!closed(result, ['ordinal', 'status', 'statusCode', 'code', 'retryable']) ||
			!Number.isInteger(result.statusCode) ||
			Number(result.statusCode) < 0 ||
			Number(result.statusCode) > 599 ||
			!codes.includes(result.code as UploadBatchFailureCode) ||
			typeof result.retryable !== 'boolean' ||
			(result.retryable && !['temporarily-unavailable', 'deadline'].includes(result.code as string))
		)
			throw invalid();
		return structuredClone(result) as UploadBatchFailure;
	});
	const payloads = value.payloads.map((payload, ordinal) => {
		const m = d.members[ordinal].write.operation.mutation;
		if (
			!object(payload) ||
			!closed(payload, ['ordinal', 'bytes']) ||
			payload.ordinal !== ordinal ||
			(results[ordinal].status === 'confirmed' && payload.bytes !== 0) ||
			m.kind !== 'copy' ||
			(payload.bytes !== null && payload.bytes !== 0 && payload.bytes !== m.source.size)
		)
			throw invalid();
		return { ordinal, bytes: payload.bytes as number | null };
	});
	return { ok: true, version: 1, batchId: d.batchId, digest: input.digest, results, payloads };
}

export function parseUploadBatchCommitResponse(value: unknown, input: NativeUploadBatchInput, ordinals: number[]): UploadBatchCommitResponse {
	if (
		!object(value) ||
		!closed(value, ['ok', 'version', 'batchId', 'digest', 'results']) ||
		!Array.isArray(value.results) ||
		value.results.length !== ordinals.length ||
		new Set(ordinals).size !== ordinals.length
	)
		throw invalid();
	const results: unknown[] = input.descriptor.members.map(({ ordinal }) => ({
		ordinal,
		status: 'failed',
		statusCode: 0,
		code: 'invalid-member',
		retryable: false
	}));
	for (const [i, ordinal] of ordinals.entries()) {
		const r = value.results[i];
		if (
			!Number.isInteger(ordinal) ||
			ordinal < 0 ||
			ordinal >= results.length ||
			!object(r) ||
			r.ordinal !== ordinal ||
			!['confirmed', 'failed'].includes(r.status as string)
		)
			throw invalid();
		results[ordinal] = r;
	}
	const parsed = parseNativeUploadBatchResult(
		{ ...value, results, payloads: input.descriptor.members.map(({ ordinal }) => ({ ordinal, bytes: 0 })) },
		input
	);
	return {
		ok: true,
		version: 1,
		batchId: parsed.batchId,
		digest: parsed.digest,
		results: ordinals.map((ordinal) => parsed.results[ordinal] as UploadBatchConfirmed | UploadBatchFailure)
	};
}

export function parseUploadBatchObservations(value: unknown, paths: string[]): UploadBatchObserveResponse {
	if (
		!paths.length ||
		paths.length > UPLOAD_BATCH_FILES ||
		paths.some((path) => !validSyncPath(path)) ||
		new Set(paths.map(syncPathKey)).size !== paths.length ||
		!object(value) ||
		!closed(value, ['ok', 'version', 'observations']) ||
		value.ok !== true ||
		value.version !== 1 ||
		!Array.isArray(value.observations) ||
		value.observations.length !== paths.length ||
		new TextEncoder().encode(JSON.stringify(value)).length > UPLOAD_BATCH_METADATA_BYTES
	)
		throw invalid();
	const observations = value.observations.map((o, i) => {
		if (!object(o) || !closed(o, ['path', 'node', 'parent']) || o.path !== paths[i]) throw invalid();
		const parentPath = paths[i].split('/').slice(0, -1).join('/');
		const node = o.node === null ? null : parseCloudInventoryNode(o.node as CloudInventoryNode);
		const parent = o.parent === null ? null : parseCloudInventoryNode(o.parent as CloudInventoryNode);
		if (
			(node && node.path !== paths[i]) ||
			(parent && (parent.kind !== 'folder' || parent.path !== parentPath)) ||
			(!parentPath && parent !== null) ||
			(node && parentPath && !parent)
		)
			throw invalid();
		if (node && parent?.kind === 'folder') {
			const folderId = node.kind === 'file' ? node.file.folderId : node.folderId;
			if (folderId !== parent.id) throw invalid();
		}
		return { path: paths[i], node, parent };
	});
	return { ok: true, version: 1, observations };
}
