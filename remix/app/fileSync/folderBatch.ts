import { canonicalResourceLimitFields } from './configuration';
import { parseCloudWrite, type CloudWrite } from './cloudWrite';
import { parseCloudFolder, type CloudFolder } from './cloudFolder';
import { parseBatchScopeConfiguration, UPLOAD_BATCH_DESCRIPTOR_BYTES, UPLOAD_BATCH_FILES, UPLOAD_BATCH_METADATA_BYTES } from './uploadBatch';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { createSyncIgnorePolicy } from './syncIgnore';
import { sameSyncScope, syncPathKey, validSyncEntry, type SyncEntry, type SyncScope } from './reconcile';

export const FOLDER_BATCH_REQUIREMENTS = { 'api.file-sync-batches': '1.1.0' } as const;
export type FolderParentRef = { kind: 'root' } | { kind: 'existing'; id: string } | { kind: 'member'; ordinal: number };
export type FolderBatchDescriptor = {
	version: 1;
	kind: 'folders';
	batchId: string;
	scope: SyncScope;
	configuration: SavedFileSyncConfiguration;
	members: { ordinal: number; write: CloudWrite; parent: FolderParentRef }[];
};
export type FolderBatchFailure = {
	ordinal: number;
	status: 'failed';
	statusCode: number;
	code:
		| 'dependency-unavailable'
		| 'target-changed'
		| 'authority-changed'
		| 'invalid-member'
		| 'source-changed'
		| 'temporarily-unavailable'
		| 'cancelled'
		| 'deadline';
	retryable: boolean;
};
export type FolderBatchConfirmed = { ordinal: number; status: 'confirmed'; folder: CloudFolder; replayed: boolean };
export type FolderBatchEnvelope<T> = { ok: true; version: 1; batchId: string; digest: string; results: T[] };
export type FolderBatchInput = { descriptor: FolderBatchDescriptor; digest: string };
export type FolderBatchRequest = (FolderBatchInput & { phase: 'folder-probe' }) | (FolderBatchInput & { phase: 'folder-commit'; ordinals: number[] });
export type FolderBatchProbeResponse = FolderBatchEnvelope<
	FolderBatchConfirmed | FolderBatchFailure | { ordinal: number; status: 'source-required' }
>;
export type FolderBatchCommitResponse = FolderBatchEnvelope<FolderBatchConfirmed | FolderBatchFailure>;
export type NativeFolderBatchInput = FolderBatchInput & { ordinals: number[]; remainingMs: number };
export type NativeFolderBatchResult = FolderBatchEnvelope<
	{ ordinal: number; status: 'validated' } | { ordinal: number; status: 'failed'; code: 'source-changed' | 'invalid-member'; retryable: false }
>;
export type NativeFolderBatch = (input: NativeFolderBatchInput, signal: AbortSignal) => Promise<NativeFolderBatchResult>;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, any> => object(v) && Object.keys(v).every((k) => keys.includes(k));
const invalid = () => Error('Invalid immutable folder batch.');
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const eligibleFolderBatchEntry = (e: SyncEntry) => validSyncEntry(e) && e.kind === 'folder';
export function eligibleFolderBatchWrite(value: unknown, scope?: SyncScope): value is CloudWrite {
	try {
		const w = parseCloudWrite(value as CloudWrite),
			m = w.operation.mutation;
		return (
			!w.operation.confirmed &&
			(!scope || sameSyncScope(scope, w.scope)) &&
			w.before === null &&
			typeof w.folderId === 'string' &&
			!!w.folderId &&
			typeof w.cloudRootId === 'string' &&
			m.kind === 'copy' &&
			m.from === 'local' &&
			m.expectedTarget === null &&
			eligibleFolderBatchEntry(m.source)
		);
	} catch {
		return false;
	}
}
export function parseFolderBatchDescriptor(value: unknown): FolderBatchDescriptor {
	if (
		!closed(value, ['version', 'kind', 'batchId', 'scope', 'configuration', 'members']) ||
		value.version !== 1 ||
		value.kind !== 'folders' ||
		typeof value.batchId !== 'string' ||
		!uuid.test(value.batchId) ||
		!Array.isArray(value.members) ||
		!value.members.length ||
		value.members.length > UPLOAD_BATCH_FILES
	)
		throw invalid();
	const { scope, configuration } = parseBatchScopeConfiguration(value.scope, value.configuration);
	const names = new Set<string>(),
		ids = new Set<string>(),
		inodes = new Set<string>(),
		destinations = new Set<string>();
	const ignore = createSyncIgnorePolicy(configuration.configuration.ignoreRules, configuration.configuration.excludedPaths);
	const members: FolderBatchDescriptor['members'] = [];
	for (const [ordinal, item] of value.members.entries()) {
		if (!closed(item, ['ordinal', 'write', 'parent']) || item.ordinal !== ordinal || !eligibleFolderBatchWrite(item.write, scope)) throw invalid();
		const write = parseCloudWrite(item.write),
			m = write.operation.mutation;
		if (
			m.kind !== 'copy' ||
			!closed(write, ['operation', 'scope', 'folderId', 'before', 'cloudRootId']) ||
			!closed(write.operation, ['id', 'mutation', 'confirmed']) ||
			!closed(m, ['kind', 'path', 'from', 'source', 'expectedTarget']) ||
			!closed(m.source, ['path', 'id', 'version', 'kind', 'size', 'sha256']) ||
			!closed(write.scope, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId'])
		)
			throw invalid();
		const path = syncPathKey(m.path),
			parentPath = m.path.split('/').slice(0, -1).join('/'),
			p = item.parent;
		const destination = JSON.stringify([write.folderId, syncPathKey(m.path.split('/').at(-1)!)]);
		if (
			names.has(path) ||
			ids.has(write.operation.id) ||
			inodes.has(m.source.id) ||
			destinations.has(destination) ||
			write.cloudRootId !== configuration.configuration.remoteFolderId ||
			ignore.ignored(m.path, 'folder')
		)
			throw invalid();
		let parent: FolderParentRef;
		if (closed(p, ['kind']) && p.kind === 'root') {
			if (parentPath || write.folderId !== write.cloudRootId) throw invalid();
			parent = { kind: 'root' };
		} else if (closed(p, ['kind', 'id']) && p.kind === 'existing' && typeof p.id === 'string' && p.id === write.folderId && parentPath) {
			if (members.some((v) => v.write.operation.id === p.id)) throw invalid();
			parent = { kind: 'existing', id: p.id };
		} else if (closed(p, ['kind', 'ordinal']) && p.kind === 'member' && Number.isInteger(p.ordinal) && p.ordinal >= 0 && p.ordinal < ordinal) {
			const previous = members[p.ordinal].write;
			if (previous.operation.mutation.path !== parentPath || previous.operation.id !== write.folderId) throw invalid();
			parent = { kind: 'member', ordinal: p.ordinal };
		} else throw invalid();
		names.add(path);
		ids.add(write.operation.id);
		inodes.add(m.source.id);
		destinations.add(destination);
		members.push({ ordinal, write, parent });
	}
	// An ancestor included in this batch must be an explicit earlier member,
	// never disguised as a current-existing reference or a forward dependency.
	for (const member of members) {
		const parentPath = member.write.operation.mutation.path.split('/').slice(0, -1).join('/');
		const parent = members.find((v) => syncPathKey(v.write.operation.mutation.path) === syncPathKey(parentPath));
		if (parent && (member.parent.kind !== 'member' || member.parent.ordinal !== parent.ordinal)) throw invalid();
	}
	const result: FolderBatchDescriptor = { version: 1, kind: 'folders', batchId: value.batchId, scope, configuration, members };
	if (new TextEncoder().encode(JSON.stringify(result)).length > UPLOAD_BATCH_DESCRIPTOR_BYTES) throw invalid();
	return result;
}
/** Ordered UTF-8 strings prefixed by decimal BYTE length, matching upload v1
 * encoding while using an independent domain and explicit parent dependency. */
export function folderBatchCanonicalBytes(value: unknown): Uint8Array {
	const d = parseFolderBatchDescriptor(value),
		s = d.scope,
		saved = d.configuration,
		c = saved.configuration;
	const fields = [
		c.resourceLimits ? 'thingtime-folder-batch-v2' : 'thingtime-folder-batch-v1',
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
	for (const { ordinal, write, parent } of d.members) {
		const m = write.operation.mutation;
		if (m.kind !== 'copy') throw invalid();
		fields.push(
			String(ordinal),
			write.operation.id,
			write.cloudRootId!,
			write.folderId!,
			m.path,
			m.source.id,
			m.source.version,
			parent.kind,
			parent.kind === 'member' ? String(parent.ordinal) : parent.kind === 'existing' ? parent.id : ''
		);
	}
	const encoder = new TextEncoder();
	return encoder.encode(fields.map((f) => `${encoder.encode(f).length}:${f}`).join(''));
}
export async function folderBatchDigest(value: unknown): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(folderBatchCanonicalBytes(value)))), (n) =>
		n.toString(16).padStart(2, '0')
	).join('');
}
export function parseFolderBatchOrdinals(value: unknown, count: number): number[] {
	if (
		!Array.isArray(value) ||
		!value.length ||
		value.length > count ||
		value.some((n, i) => !Number.isInteger(n) || n < 0 || n >= count || (i > 0 && n <= value[i - 1]))
	)
		throw invalid();
	return [...value];
}
const envelope = (value: unknown, input: FolderBatchInput, ordinals: number[]) => {
	const d = parseFolderBatchDescriptor(input.descriptor);
	if (
		!/^[a-f0-9]{64}$/.test(input.digest) ||
		!closed(value, ['ok', 'version', 'batchId', 'digest', 'results']) ||
		value.ok !== true ||
		value.version !== 1 ||
		value.batchId !== d.batchId ||
		value.digest !== input.digest ||
		!Array.isArray(value.results) ||
		value.results.length !== ordinals.length ||
		new TextEncoder().encode(JSON.stringify(value)).length > UPLOAD_BATCH_METADATA_BYTES ||
		value.results.some((r, i) => !object(r) || r.ordinal !== ordinals[i])
	)
		throw invalid();
	return { d, rows: value.results };
};
const failure = (r: any): FolderBatchFailure => {
	if (
		!closed(r, ['ordinal', 'status', 'statusCode', 'code', 'retryable']) ||
		r.status !== 'failed' ||
		!Number.isInteger(r.statusCode) ||
		r.statusCode < 400 ||
		r.statusCode > 599 ||
		![
			'dependency-unavailable',
			'target-changed',
			'authority-changed',
			'invalid-member',
			'source-changed',
			'temporarily-unavailable',
			'cancelled',
			'deadline'
		].includes(r.code) ||
		typeof r.retryable !== 'boolean'
	)
		throw invalid();
	return structuredClone(r) as FolderBatchFailure;
};
const confirmed = (r: any, d: FolderBatchDescriptor): FolderBatchConfirmed => {
	if (!closed(r, ['ordinal', 'status', 'folder', 'replayed']) || r.status !== 'confirmed' || typeof r.replayed !== 'boolean') throw invalid();
	const folder = parseCloudFolder(r.folder),
		w = d.members[r.ordinal].write;
	if (folder.id !== w.operation.id || folder.folderId !== w.folderId || folder.name !== w.operation.mutation.path.split('/').at(-1)) throw invalid();
	return { ordinal: r.ordinal, status: 'confirmed', folder, replayed: r.replayed };
};
export function parseFolderBatchProbeResponse(value: unknown, input: FolderBatchInput): FolderBatchProbeResponse {
	const { d, rows } = envelope(
		value,
		input,
		input.descriptor.members.map((m) => m.ordinal)
	);
	return {
		ok: true,
		version: 1,
		batchId: d.batchId,
		digest: input.digest,
		results: rows.map((r) =>
			r.status === 'confirmed'
				? confirmed(r, d)
				: r.status === 'failed'
				? failure(r)
				: closed(r, ['ordinal', 'status']) && r.status === 'source-required'
				? { ordinal: r.ordinal, status: 'source-required' as const }
				: (() => {
						throw invalid();
				  })()
		)
	};
}
export function parseFolderBatchCommitResponse(value: unknown, input: FolderBatchInput, ordinals: number[]): FolderBatchCommitResponse {
	const { d, rows } = envelope(value, input, parseFolderBatchOrdinals(ordinals, input.descriptor.members.length));
	return {
		ok: true,
		version: 1,
		batchId: d.batchId,
		digest: input.digest,
		results: rows.map((r) => (r.status === 'confirmed' ? confirmed(r, d) : failure(r)))
	};
}
export function parseNativeFolderBatchResult(value: unknown, input: NativeFolderBatchInput): NativeFolderBatchResult {
	if (!Number.isSafeInteger(input.remainingMs) || input.remainingMs < 1 || input.remainingMs > 180000) throw invalid();
	const { d, rows } = envelope(value, input, parseFolderBatchOrdinals(input.ordinals, input.descriptor.members.length));
	return {
		ok: true,
		version: 1,
		batchId: d.batchId,
		digest: input.digest,
		results: rows.map((r) => {
			if (closed(r, ['ordinal', 'status']) && r.status === 'validated') return { ordinal: r.ordinal, status: 'validated' as const };
			if (
				!closed(r, ['ordinal', 'status', 'code', 'retryable']) ||
				r.status !== 'failed' ||
				!['source-changed', 'invalid-member'].includes(r.code) ||
				r.retryable !== false
			)
				throw invalid();
			return { ordinal: r.ordinal, status: 'failed' as const, code: r.code, retryable: false as const };
		})
	};
}
