import { createSecretKey, hkdfSync, randomUUID, type KeyObject } from 'node:crypto';
import { Binary } from 'mongodb';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import type { BackupJobView } from '../../../backups/workflow';
import { backupDigest, backupId, backupJson } from '../../../backups/manifest';
import { getAuthToken } from '../auth/authCookie';
import { verifyJwt } from '../auth/jwt';
import { getCurrentUser, isFullAccountSessionPurpose } from '../auth/getCurrentUser';
import { getLiveSession } from '../auth/sessions';
import { fenceAccountSession } from '../auth/fenceAccountSession';
import { withInternalAccountSession, type InternalAccountSession } from '../auth/internalAccountSession';
import { withUserVaultKey } from '../auth/vaultKeys';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { insertAccountedThing, updateAccountedThing } from '../storage/accountedThings';
import { StorageMutationError } from '../storage/storageCore';
import type { HashCheckpointCoordinator, HashCheckpointRef } from './resumableHash';
import {
	BACKUP_JOB_KIND, BACKUP_JOB_EVENT_KIND, BACKUP_JOB_LEASE_MS,
	backupJobDigest, backupJobView, initialBackupJobCursor, parseBackupJobCursor,
	parseBackupJobOperation, sameBackupJobValue, assertBackupHashReference,
	type BackupHashSlot, type BackupJobOperation, type BackupJobCursor, type BackupJobLease
} from './backupJobCore';

type Issue = BackupJobView['issue'];
type Row = Record<string, any>;
type Dependencies = {
	things(): Promise<any>; transaction<T>(work: (session: any) => Promise<T>): Promise<T>;
	fence: typeof fenceAccountSession; now(): number; customPlane(): boolean;
};
const defaults: Dependencies = { things: getHomeThingsCollection, transaction: withHomeMongoTransaction,
	fence: fenceAccountSession, now: Date.now, customPlane: isCustomMongoEndpointActive };
const fail = (status = 409): never => { throw new StorageMutationError(status, 'storage_conflict', 'The protected backup job is unavailable or changed'); };
const storage = (session: any) => ({ session, accountedPlane: 'home' as const });
const match = (id: string) => ({ shareId: id, thingtime: BACKUP_JOB_KIND });
const slots: BackupHashSlot[] = ['part', 'composite', 'manifest'];
const statusIssues: Issue[] = [null, 'execution-unavailable', 'authorization-changed', 'destination-changed', 'source-changed', 'snapshot-expired', 'snapshot-unavailable', 'step-failed'];
export const BACKUP_DISPATCH_WAIT_MS = 120_000;
const dispatchUnconfirmed = (row: Row, now: number) => !!row.backupDispatchId && !row.backupWorkflowRunId &&
 (row.backupDispatchUnconfirmed === true || new Date(row.backupDispatchStartedAt).getTime() + BACKUP_DISPATCH_WAIT_MS <= now);
const terminal = (row: Row) => ['cancelled', 'completed'].includes(row.backupStatus);
function sessionReference(row: Row): InternalAccountSession {
	if (!(row.backupSessionReference instanceof Binary)) return fail(401);
	try {
		const reference = JSON.parse(Buffer.from(row.backupSessionReference.value()).toString('utf8'));
		if (Object.keys(reference).sort().join(',') !== 'jti,origin,ownerId' || reference.ownerId !== row.ownerId ||
			reference.origin !== row.backupOrigin || typeof reference.jti !== 'string' || !reference.jti ||
			new URL(reference.origin).origin !== reference.origin) return fail(401);
		return reference;
	} catch { return fail(401); }
}
function visibleJob(row: Row, live: any, at: number): BackupJobView {
 const view = backupJobView(row);
 if (row.backupStatus === 'queued' || row.backupStatus === 'running') {
  const expiry = live?.expiresAt == null ? null : new Date(live.expiresAt).getTime();
  if (!live || live.revokedAt || live.userId !== row.ownerId || !isFullAccountSessionPurpose(live.purpose) ||
   (live.meta?.activeCharacterId != null && live.meta.activeCharacterId !== row.ownerId) ||
   (expiry !== null && (!Number.isFinite(expiry) || expiry <= at))) return {...view,status:'needs-attention',issue:'authorization-changed'};
 }
 if (row.backupStatus === 'queued' && dispatchUnconfirmed(row,at)) return {...view,status:'needs-attention',issue:'dispatch-unconfirmed'};
 return view;
}
function validateRow(row: Row | null): asserts row is Row {
	if (!row || !backupId(row.shareId) || row.storageClass !== 'control' || row.backupVersion !== 1 ||
		row.backupPlane !== 'home' || !Number.isSafeInteger(row.backupRevision) || !Number.isSafeInteger(row.backupGeneration) ||
		row.backupRevision < 0 || row.backupGeneration < 0 ||
		!['queued', 'running', 'paused', 'needs-attention', 'cancelled', 'completed'].includes(row.backupStatus) ||
		!statusIssues.includes(row.backupIssue ?? null) ||
		row.backupPayloadHash !== backupJobDigest({ operation: parseBackupJobOperation(row.backupOperation), destinationBinding: row.backupDestinationBinding }) ||
		!backupDigest(row.backupDestinationBinding)) return fail();
	parseBackupJobCursor(row.backupCursor);
	if (row.backupDispatchAttempts != null && (!Number.isSafeInteger(row.backupDispatchAttempts) || row.backupDispatchAttempts < 0 || row.backupDispatchAttempts > 5)) return fail();
	if (row.backupDispatchNextAt != null && !Number.isFinite(new Date(row.backupDispatchNextAt).getTime())) return fail();
	if (row.backupDispatchId != null && (!backupId(row.backupDispatchId) || !Number.isSafeInteger(row.backupDispatchGeneration) || row.backupDispatchGeneration < 0 || !Number.isFinite(new Date(row.backupDispatchStartedAt).getTime()) || typeof row.backupDispatchUnconfirmed !== 'boolean')) return fail();
	sessionReference(row);
}
export type BackupEngineOutcome = { kind: 'continue'; delayMs?: number } | { kind: 'complete' } | { kind: 'pause'; issue?: Issue };
export type CompletedBackupJob = Readonly<{
	jobId: string; operation: BackupJobOperation; cursor: BackupJobCursor; destinationBinding: string;
}>;
export type BackupEngineContext = {
	jobId: string; operation: BackupJobOperation; destinationBinding: string;
	/** Refreshed after every acknowledged checkpoint. No hash bytes/state. */
	readonly cursor: BackupJobCursor; readonly lease: BackupJobLease; request: Request;
	guard(): Promise<void>;
	checkpoint(next: BackupJobCursor, options?: { clearHashSlots?: BackupHashSlot[] }): Promise<void>;
	hashCoordinator(slot: BackupHashSlot, nextCursor: BackupJobCursor | ((ref: HashCheckpointRef) => BackupJobCursor)): HashCheckpointCoordinator;
	hashKeys: { current(): Promise<{ id: string; key: KeyObject }>; get(id: string): Promise<KeyObject | null> };
	withRequest<T>(request: Request, work: () => Promise<T>): Promise<T>;
	completedSource(jobId: string, kind: 'snapshot' | 'review'): Promise<CompletedBackupJob>;
};

/** Dedicated home-pinned coordinator. No ordinary Things/bulk API accepts its
 * operation, original session reference, cursor, hash references or leases. */
export function createBackupJobCoordinator(overrides: Partial<Dependencies> = {}) {
	const deps = { ...defaults, ...overrides };
	const checkPlane = () => { if (deps.customPlane()) return fail(); };
	const now = () => new Date(deps.now());
	const read = async (id: string, session?: any): Promise<Row> => {
		if (!backupId(id)) return fail();
		const row = await (await deps.things()).findOne(match(id), session ? { session } : undefined);
		validateRow(row); return row;
	};
	const save = async (row: Row, fields: Row, session: any) => {
		const result = await updateAccountedThing(await deps.things(), { ...match(row.shareId), backupRevision: row.backupRevision },
			{ $set: { ...fields, backupRevision: row.backupRevision + 1, updatedAt: now() } }, storage(session));
		if (result.matchedCount !== 1) return fail();
	};
	const event = async (row: Row, type: string, session: any) => {
		const date = now();
		// One child per actual transition; retries that observe the completed
		// transition never append history again. No growing root event array.
		await insertAccountedThing(await deps.things(), { shareId: randomUUID(), ownerId: row.ownerId,
			thingtime: [BACKUP_JOB_EVENT_KIND], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			storageClass: 'control', acl: [ACL_OWNER], parentId: row.shareId, targetId: row.shareId,
			crystal: { transition: type, generation: row.backupGeneration, at: date.toISOString() }, extended: null, tags: [],
			createdAt: date, updatedAt: date }, storage(session));
	};
	const referenceRequest = async <T>(row: Row, fence: (session: any) => Promise<void>, work: (request: Request) => Promise<T>) => {
		const request = new Request(row.backupOrigin + '/api/v1/backups');
		return withInternalAccountSession(request, sessionReference(row), fence, () => work(request));
	};
	const assertSameRoot = (row: Row, original: Row) => {
		if (row.ownerId !== original.ownerId || row.backupOrigin !== original.backupOrigin ||
			row.backupPayloadHash !== original.backupPayloadHash ||
			!Buffer.from(row.backupSessionReference.value()).equals(Buffer.from(original.backupSessionReference.value()))) return fail();
	};
	const leaseRow = async (lease: BackupJobLease, original: Row, session?: any) => {
		checkPlane();
		const row = await read(lease.jobId, session); assertSameRoot(row, original);
		if (row.backupStatus !== 'running' || row.backupCancelRequested || row.backupGeneration !== lease.generation ||
			row.backupLeaseId !== lease.leaseId || !row.backupLeaseExpiresAt ||
			!Number.isFinite(new Date(row.backupLeaseExpiresAt).getTime()) || new Date(row.backupLeaseExpiresAt).getTime() <= deps.now()) return fail();
		return row;
	};
	return {
		/** Internal admission only. The fixed operation and destination binding
		 * must be selected by the actual engine's verified adapter, not HTTP input.
		 * A retry preserves the original job/snapshot/session identities. */
		async admit(request: Request, input: { requestId: string; operation: BackupJobOperation; destinationBinding: string }) {
			checkPlane();
			const operation = parseBackupJobOperation(input.operation), origin = new URL(request.url).origin;
			if (!backupId(input.requestId) || !backupDigest(input.destinationBinding)) return fail(400);
			const token = await getAuthToken(request), claims = token && await verifyJwt(token), user = await getCurrentUser(request);
			if (!claims || claims.sub !== user?.id || user.temporary || user.accountKind !== 'user') return fail(401);
			const payloadHash = backupJobDigest({ operation, destinationBinding: input.destinationBinding });
			const identity = backupJobDigest(['backup-admission-v1', user.id, origin, input.requestId]);
			const jobId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-8${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
			return deps.transaction(async session => {
				await deps.fence(request, user.id, session);
				const things = await deps.things(), previous = await things.findOne(match(jobId), { session });
				if (previous) {
					validateRow(previous);
					if (previous.ownerId !== user.id || previous.backupOrigin !== origin || previous.backupPayloadHash !== payloadHash ||
						sessionReference(previous).jti !== claims.jti) return fail();
					return backupJobView(previous);
				}
				const date = now(), row = { shareId: jobId, ownerId: user.id, thingtime: [BACKUP_JOB_KIND],
					schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, storageClass: 'control', acl: [ACL_OWNER],
					crystal: {}, extended: null, tags: [], createdAt: date, updatedAt: date,
					backupVersion: 1, backupOrigin: origin, backupPlane: 'home', backupOperation: operation,
					backupPayloadHash: payloadHash, backupDestinationBinding: input.destinationBinding,
					backupSessionReference: new Binary(Buffer.from(backupJson({ ownerId: user.id, jti: claims.jti, origin }))),
					backupStatus: 'queued', backupRevision: 0, backupGeneration: 0, backupCancelRequested: false,
					backupLeaseId: null, backupLeaseExpiresAt: null, backupCursor: initialBackupJobCursor(operation.kind),
					backupHashPart: null, backupHashComposite: null, backupHashManifest: null, backupIssue: null,
					backupWorkflowRunId: null, backupDispatchId: null, backupDispatchGeneration: null, backupDispatchStartedAt: null, backupDispatchUnconfirmed: false, backupDispatchAttempts: 0, backupDispatchNextAt: null };
				await insertAccountedThing(things, row, storage(session)); await event(row, 'admitted', session);
				return backupJobView(row);
			});
		},
		async current(request: Request, jobId: string) {
			checkPlane(); const user = await getCurrentUser(request), row = await read(jobId);
			if (row.ownerId !== user?.id || row.backupOrigin !== new URL(request.url).origin) return fail(404);
			const original = row.backupStatus === 'queued' || row.backupStatus === 'running' ? await getLiveSession(sessionReference(row).jti) : null;
			return visibleJob(row,original,deps.now());
		},
		/** Full current owner read, separate from a worker's execution lease. No
		 * original session, hash state, provider configuration or grant is exposed. */
		async readCompleted(request: Request, jobId: string, kind: 'snapshot' | 'review'): Promise<CompletedBackupJob> {
			checkPlane(); const user = await getCurrentUser(request), row = await read(jobId);
			if (!user || user.temporary || user.isCharacter || user.accountKind !== 'user' || row.ownerId !== user.id ||
				row.backupOrigin !== new URL(request.url).origin || row.backupStatus !== 'completed' || row.backupOperation.kind !== kind ||
				row.backupCursor.phase !== 'complete' || !row.backupCursor.planHash || !row.backupCursor.sealHash) return fail(404);
			if ((await getCurrentUser(request))?.id !== user.id) return fail(401);
			return Object.freeze({ jobId, operation: Object.freeze(parseBackupJobOperation(row.backupOperation)),
				cursor: Object.freeze(parseBackupJobCursor(row.backupCursor)), destinationBinding: row.backupDestinationBinding });
		},
		async catalog(request: Request, selection: 'snapshots' | 'jobs', after?: { at: number; id: string }) {
			checkPlane(); const user = await getCurrentUser(request), origin = new URL(request.url).origin;
			if (!user || user.temporary || user.isCharacter || user.accountKind !== 'user' || !['snapshots','jobs'].includes(selection)) return fail(401);
			if (after && (!Number.isSafeInteger(after.at) || !Number.isFinite(new Date(after.at).getTime()) || !backupId(after.id))) return fail(400);
			const query = { thingtime: BACKUP_JOB_KIND, ownerId: user.id, backupOrigin: origin,
				...(selection === 'snapshots' ? { backupStatus: 'completed', 'backupOperation.kind': 'snapshot' } : {}),
				...(after ? { $or: [{ createdAt: { $lt: new Date(after.at) } }, { createdAt: new Date(after.at), shareId: { $gt: after.id } }] } : {}) };
			const found = await (await deps.things()).find(query).sort({ createdAt: -1, shareId: 1 }).limit(51).toArray();
			const more = found.length > 50, rows: Row[] = found.slice(0,50); for (const row of rows) validateRow(row);
			const active = rows.filter(row => row.backupStatus === 'queued' || row.backupStatus === 'running');
			const ids = [...new Set(active.map(row => sessionReference(row).jti))];
			const sessions = ids.length ? await (await getSessionsCollection()).find({ jti: { $in: ids } }, { projection: { jti: 1, userId: 1, revokedAt: 1, expiresAt: 1, purpose: 1, 'meta.activeCharacterId': 1 } }).toArray() : [];
			const byId = new Map<string, any>(sessions.map(value => [String(value.jti),value] as [string, any]));
			const items = rows.map(row => {
				const view = visibleJob(row,byId.get(sessionReference(row).jti),deps.now());
				const source: CompletedBackupJob | null = row.backupStatus === 'completed' ? { jobId: row.shareId,
					operation: parseBackupJobOperation(row.backupOperation), cursor: parseBackupJobCursor(row.backupCursor), destinationBinding: row.backupDestinationBinding } : null;
				return { job: view, source };
			});
			if ((await getCurrentUser(request))?.id !== user.id) return fail(401);
			const last = rows.at(-1); return { items, next: more && last ? { at: new Date(last.createdAt).getTime(), id: last.shareId as string } : null };
		},
		/** Owner controls invalidate the lease before returning. Resume/retry
		 * retain the original session, snapshot, review and immutable selectors. */
		async control(request: Request, jobId: string, action: 'pause' | 'resume' | 'retry' | 'cancel') {
			checkPlane();
			if (!['pause', 'resume', 'retry', 'cancel'].includes(action)) return fail(400);
			const user = await getCurrentUser(request), original = await read(jobId);
			if (original.ownerId !== user?.id || original.backupOrigin !== new URL(request.url).origin) return fail(404);
			return referenceRequest(original, async () => {}, internal => deps.transaction(async session => {
				await deps.fence(request, original.ownerId, session);
				if (action === 'resume' || action === 'retry') await deps.fence(internal, original.ownerId, session);
				const row = await read(jobId, session); assertSameRoot(row, original);
				if (terminal(row)) return backupJobView(row);
				if ((action === 'retry' || action === 'resume') && row.backupIssue === 'snapshot-expired') return fail();
				const next = action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'queued';
				const retryDispatch = action === 'retry' && row.backupStatus === 'queued' && dispatchUnconfirmed(row, deps.now());
				if (row.backupStatus === next && !retryDispatch) return backupJobView(row);
				if ((action === 'resume' && row.backupStatus !== 'paused') || (action === 'retry' && row.backupStatus !== 'needs-attention' && !retryDispatch)) return fail();
				const fields = { backupStatus: next, backupCancelRequested: action === 'cancel',
					backupGeneration: row.backupGeneration + 1, backupLeaseId: null, backupLeaseExpiresAt: null, backupIssue: null,
					...((action === 'resume' || action === 'retry') ? { backupWorkflowRunId: null, backupDispatchId: null, backupDispatchGeneration: null, backupDispatchStartedAt: null, backupDispatchUnconfirmed: false, backupDispatchAttempts: 0, backupDispatchNextAt: null } : {}) };
				await save(row, fields, session); await event(row, next, session);
				return backupJobView({ ...row, ...fields, updatedAt: now() });
			}));
		},
		/** A step claims only after the prior lease expires. Replayed deliveries
		 * observe the durable cursor; they do not reset an uncertain operation. */
		async claim(jobId: string, workflowRunId?: string): Promise<{ lease: BackupJobLease | null; delayMs: number; status: BackupJobView['status'] }> {
			checkPlane(); const original = await read(jobId);
			return referenceRequest(original, async () => {}, request => deps.transaction(async session => {
				await deps.fence(request, original.ownerId, session);
				const row = await read(jobId, session); assertSameRoot(row, original);
				if (workflowRunId !== undefined && row.backupWorkflowRunId !== workflowRunId) return { lease: null, delayMs: 0, status: row.backupStatus };
				if (!['queued', 'running'].includes(row.backupStatus) || row.backupCancelRequested) return { lease: null, delayMs: 0, status: row.backupStatus };
				const expiry = new Date(row.backupLeaseExpiresAt ?? 0).getTime();
				if (row.backupStatus === 'running' && expiry > deps.now()) return { lease: null, delayMs: expiry - deps.now(), status: row.backupStatus };
				const lease = { jobId, generation: row.backupGeneration + 1, leaseId: randomUUID() };
				await save(row, { backupStatus: 'running', backupGeneration: lease.generation, backupLeaseId: lease.leaseId,
					backupLeaseExpiresAt: new Date(deps.now() + BACKUP_JOB_LEASE_MS), backupIssue: null }, session);
				return { lease, delayMs: 0, status: 'running' as const };
			}));
		},
		async withLease<T>(lease: BackupJobLease, work: (context: BackupEngineContext) => Promise<T>,
			options: { fenceDestination?: (session: any, binding: string) => Promise<void> } = {}): Promise<T> {
			checkPlane(); const original = await read(lease.jobId);
			let cursor = parseBackupJobCursor(original.backupCursor);
			const refs: Record<BackupHashSlot, HashCheckpointRef | null> = {
				part: original.backupHashPart ?? null, composite: original.backupHashComposite ?? null, manifest: original.backupHashManifest ?? null
			};
			// Every canonical content transaction writes this same job root. A
			// concurrent pause/cancel/takeover therefore conflicts at commit.
			const fence = async (session: any) => {
				const row = await leaseRow(lease, original, session);
				// Optional trusted adapter for a transaction-addressable vault
				// revision. No HTTP/Thing field can supply an executable hook.
				if (options.fenceDestination) await options.fenceDestination(session, original.backupDestinationBinding);
				const changed = await updateAccountedThing(await deps.things(), { ...match(lease.jobId), backupRevision: row.backupRevision,
					backupGeneration: lease.generation, backupLeaseId: lease.leaseId }, { $set: { backupEffectFence: randomUUID() } }, storage(session));
				if (changed.matchedCount !== 1) return fail();
			};
			return referenceRequest(original, fence, async request => {
				const transact = <R>(action: (row: Row, session: any) => Promise<R>) => deps.transaction(async session => {
					await deps.fence(request, original.ownerId, session);
					return action(await leaseRow(lease, original, session), session);
				});
				const slotField = (slot: BackupHashSlot) => {
					if (!slots.includes(slot)) return fail();
					return `backupHash${slot[0].toUpperCase()}${slot.slice(1)}`;
				};
				const guard = async () => {
					// Fresh reads, never cached authority. Provider reads and immutable
					// object IO do not mutate account content: writing/accounting a lease
					// for each before/after check would make census miss its history window.
					const reference = sessionReference(original);
					const [row, live, user] = await Promise.all([
						leaseRow(lease, original), getLiveSession(reference.jti), getCurrentUser(request)
					]);
					const sessionExpiry = live?.expiresAt ? new Date(live.expiresAt).getTime() : null;
					if (!live || live.userId !== original.ownerId || !isFullAccountSessionPurpose(live.purpose) ||
						(live.meta?.activeCharacterId != null && live.meta.activeCharacterId !== original.ownerId) ||
						(sessionExpiry !== null && (!Number.isFinite(sessionExpiry) || sessionExpiry <= Date.now())) ||
						user?.id !== original.ownerId || user.temporary || user.isCharacter || user.accountKind !== 'user') return fail(401);
					const expiry = new Date(row.backupLeaseExpiresAt).getTime();
					// Recheck wall time after all asynchronous reads. A slow authorization
					// lookup cannot turn an expired lease into a fresh provider window.
					if (expiry <= deps.now()) return fail();
					if (expiry - deps.now() > BACKUP_JOB_LEASE_MS / 2) return;
					// Only near-expiry renewal writes. The original-session/job fence is
					// still transactional here and for EVERY canonical content effect,
					// checkpoint and hash-reference CAS. It never revives an expired,
					// replaced or paused lease; an uncertain reply keeps its exact ID.
					await transact(async (current, session) => {
						if (new Date(current.backupLeaseExpiresAt).getTime() - deps.now() <= BACKUP_JOB_LEASE_MS / 2)
							await save(current, { backupLeaseExpiresAt: new Date(deps.now() + BACKUP_JOB_LEASE_MS) }, session);
					});
				};
				const resolveHashKey = async (expectedId?: string) => {
					await guard();
					const resolved = await withUserVaultKey(original.ownerId, key => {
						if (expectedId !== undefined && expectedId !== key.id) return null;
						const salt = Buffer.from(backupJobDigest([original.backupOrigin, original.ownerId, lease.jobId, original.backupDestinationBinding]), 'hex');
						const derived = Buffer.from(hkdfSync('sha256', key.bytes, salt, Buffer.from('thingtime-backup-hash-checkpoints-v1'), 32));
						try { return { id: key.id, key: createSecretKey(derived) }; }
						finally { derived.fill(0); }
					});
					await guard(); return resolved;
				};
				const context: BackupEngineContext = {
					jobId: lease.jobId, operation: Object.freeze(parseBackupJobOperation(original.backupOperation)),
					destinationBinding: original.backupDestinationBinding, get cursor() { return { ...cursor }; }, lease: Object.freeze({ ...lease }), request,
					guard,
					hashKeys: {
						current: async () => { const key = await resolveHashKey(); if (!key) return fail(); return key; },
						get: async id => (await resolveHashKey(id))?.key ?? null
					},
					async checkpoint(next, options = {}) {
						next = parseBackupJobCursor(next);
						const expected = { ...cursor };
						const clear = [...new Set(options.clearHashSlots ?? [])];
						for (const slot of clear) slotField(slot);
						const expectedRefs = { ...refs };
						await transact(async (row, session) => {
							if (sameBackupJobValue(row.backupCursor, next) && clear.every(slot => row[slotField(slot)] == null)) {
								cursor = next; for (const slot of clear) refs[slot] = null; return;
							}
							if (!sameBackupJobValue(row.backupCursor, expected)) return fail();
							const fields: Row = { backupCursor: next };
							for (const slot of clear) {
								const field = slotField(slot);
								if (!sameBackupJobValue(row[field] ?? null, expectedRefs[slot]) || (row[field] && !row[field].complete)) return fail();
								fields[field] = null;
							}
							await save(row, fields, session); cursor = next; for (const slot of clear) refs[slot] = null;
						});
					},
					hashCoordinator(slot, nextCursor) {
						const field = slotField(slot);
						return {
							current: bindingHash => transact(async row => {
								if (!backupDigest(bindingHash)) return fail();
								const ref = row[field] ?? null;
								if (ref) assertBackupHashReference(ref, bindingHash);
								cursor = parseBackupJobCursor(row.backupCursor); refs[slot] = ref; return ref;
							}),
							accept: async (bindingHash, previous, next) => {
								assertBackupHashReference(next, bindingHash);
								if (next.operationId === lease.jobId) return fail();
								if (previous) assertBackupHashReference(previous, bindingHash);
								const expectedCursor = { ...cursor };
								const acceptedCursor = parseBackupJobCursor(typeof nextCursor === 'function' ? nextCursor(next) : nextCursor);
								return transact(async (row, session) => {
									if (sameBackupJobValue(row[field] ?? null, next)) {
										if (!sameBackupJobValue(row.backupCursor, acceptedCursor)) return 'conflict';
										cursor = acceptedCursor; refs[slot] = next; return 'already-accepted';
									}
									if (!sameBackupJobValue(row[field] ?? null, previous) || !sameBackupJobValue(row.backupCursor, expectedCursor)) return 'conflict';
									if ((previous && (previous.complete || next.operationId !== previous.operationId || next.sequence !== previous.sequence + 1 ||
										next.previousDigest !== previous.stateDigest || BigInt(next.offset) < BigInt(previous.offset))) ||
										(!previous && (next.sequence !== 0 || next.previousDigest !== null || next.offset !== '0'))) return 'conflict';
									await save(row, { [field]: next, backupCursor: acceptedCursor }, session);
									cursor = acceptedCursor; refs[slot] = next; return 'accepted';
								});
							}
						};
					},
					withRequest: (child, action) => withInternalAccountSession(child, sessionReference(original), fence, action),
					completedSource: (jobId, kind) => transact(async (_row, session) => {
						if (!['snapshot', 'review'].includes(kind)) return fail();
						const source = await read(jobId, session);
						if (source.ownerId !== original.ownerId || source.backupOrigin !== original.backupOrigin ||
							source.backupStatus !== 'completed' || source.backupOperation.kind !== kind ||
							source.backupCursor.phase !== 'complete' || !source.backupCursor.planHash || !source.backupCursor.sealHash) return fail();
						return Object.freeze({ jobId, operation: Object.freeze(parseBackupJobOperation(source.backupOperation)),
							cursor: Object.freeze(parseBackupJobCursor(source.backupCursor)), destinationBinding: source.backupDestinationBinding });
					})
				};
				await context.guard(); return work(context);
			});
		},
		async finish(lease: BackupJobLease, outcome: BackupEngineOutcome) {
			checkPlane(); const original = await read(lease.jobId);
			const outcomeHash = backupJobDigest(outcome);
			return referenceRequest(original, async () => {}, request => deps.transaction(async session => {
				await deps.fence(request, original.ownerId, session);
				const current = await read(lease.jobId, session); assertSameRoot(current, original);
				if (current.backupLastLeaseId === lease.leaseId && current.backupLastGeneration === lease.generation && current.backupLastOutcomeHash === outcomeHash) return;
				const row = await leaseRow(lease, original, session);
				if (!['continue', 'complete', 'pause'].includes(outcome.kind)) return fail();
				if (outcome.kind === 'complete' && (row.backupCursor.phase !== 'complete' || !row.backupCursor.planHash || !row.backupCursor.sealHash ||
					[row.backupHashPart, row.backupHashComposite, row.backupHashManifest].some(ref => ref && !ref.complete))) return fail();
				const status = outcome.kind === 'continue' ? 'queued' : outcome.kind === 'complete' ? 'completed' : 'needs-attention';
				const issue = outcome.kind === 'pause' ? outcome.issue ?? 'step-failed' : null;
				if (!statusIssues.includes(issue)) return fail();
				await save(row, { backupStatus: status, backupLeaseId: null, backupLeaseExpiresAt: null, backupIssue: issue,
					backupLastLeaseId: lease.leaseId, backupLastGeneration: lease.generation, backupLastOutcomeHash: outcomeHash }, session);
				if (outcome.kind !== 'continue') await event(row, status, session);
			}));
		},
		/** Trusted bounded outbox reservation. Only a currently admitted original
		 * session can reserve. Retry/read of an existing attempt never starts SDK
		 * work again; the scheduler may supersede an expired unattached attempt. */
		async reserveDispatch(jobId: string, origin: string, recoverExpired = false) {
			checkPlane(); const original = await read(jobId);
			if (original.backupOrigin !== origin) return fail();
			return referenceRequest(original, async () => {}, request => deps.transaction(async session => {
				await deps.fence(request, original.ownerId, session);
				const row = await read(jobId, session); assertSameRoot(row, original);
				if (row.backupStatus !== 'queued' || row.backupCancelRequested || row.backupWorkflowRunId)
					return { start: false as const, dispatchId: null };
				const attempts = row.backupDispatchAttempts ?? 0;
				if (attempts >= 5) return { start: false as const, dispatchId: row.backupDispatchId as string | null };
				const expired = row.backupDispatchId && (row.backupDispatchNextAt ? new Date(row.backupDispatchNextAt).getTime() <= deps.now() : new Date(row.backupDispatchStartedAt).getTime() + BACKUP_DISPATCH_WAIT_MS <= deps.now());
				if (row.backupDispatchId && !(recoverExpired && expired)) return { start: false as const, dispatchId: row.backupDispatchId as string };
				const dispatchId = randomUUID(), generation = row.backupGeneration + (row.backupDispatchId ? 1 : 0);
				await save(row, { backupDispatchId: dispatchId, backupDispatchGeneration: generation,
					backupDispatchStartedAt: now(), backupDispatchUnconfirmed: false, backupDispatchAttempts: attempts + 1,
					backupDispatchNextAt: new Date(deps.now() + BACKUP_DISPATCH_WAIT_MS * Math.pow(2, attempts)), backupGeneration: generation,
					backupLeaseId: null, backupLeaseExpiresAt: null }, session);
				return { start: true as const, dispatchId };
			}));
		},
		async markDispatchUnconfirmed(jobId: string, dispatchId: string) {
			const original = await read(jobId);
			return referenceRequest(original, async () => {}, request => deps.transaction(async session => {
				await deps.fence(request, original.ownerId, session);
				const row = await read(jobId, session); assertSameRoot(row, original);
				if (row.backupDispatchId !== dispatchId || row.backupWorkflowRunId || row.backupStatus !== 'queued') return;
				await save(row, { backupDispatchUnconfirmed: true }, session);
			}));
		},
		/** Scheduling backoff carries fairness across scheduler invocations. It
         * changes no session, selector, generation, attempt or execution grant. */
        async deferDispatch(jobId:string,origin:string){
         checkPlane();const original=await read(jobId);if(original.backupOrigin!==origin)return fail();
         return deps.transaction(async session=>{const row=await read(jobId,session);assertSameRoot(row,original);
          if(row.backupStatus!=='queued'||row.backupWorkflowRunId||row.backupCancelRequested)return false;
          const until=deps.now()+BACKUP_DISPATCH_WAIT_MS;
          if(row.backupDispatchNextAt&&new Date(row.backupDispatchNextAt).getTime()>=until)return true;
          await save(row,{backupDispatchNextAt:new Date(until)},session);return true;
         });
        },
		/** Downward maintenance only: positively invalid original authority may
		 * retire an unattached queued job. A read/DB error never becomes revocation.
		 * This path cannot grant, resume, schedule or change archived selectors. */
		async retireInvalidAuthorization(jobId: string, origin: string) {
			checkPlane(); const original = await read(jobId);
			if (original.backupOrigin !== origin) return fail();
			const reference = sessionReference(original);
			return deps.transaction(async session => {
				const row = await read(jobId, session); assertSameRoot(row, original);
				if (row.backupStatus !== 'queued' || row.backupWorkflowRunId) return false;
				const live = await getLiveSession(reference.jti); // Errors propagate: never infer invalidity from an outage.
				const invalid = !live || live.userId !== row.ownerId || !isFullAccountSessionPurpose(live.purpose) ||
					(live.meta?.activeCharacterId != null && live.meta.activeCharacterId !== row.ownerId) ||
					(live.expiresAt != null && (!Number.isFinite(new Date(live.expiresAt).getTime()) || new Date(live.expiresAt).getTime() <= Date.now()));
				if (!invalid) return false;
				// Drop transient scheduling metadata. Normal logical-byte accounting
				// remains enforced; an unavailable ledger is not bypassed.
				const result = await updateAccountedThing(await deps.things(), { ...match(jobId), backupRevision: row.backupRevision }, {
					$set: { backupStatus: 'needs-attention', backupIssue: 'authorization-changed', backupGeneration: row.backupGeneration + 1,
						backupRevision: row.backupRevision + 1, backupLeaseId: null, backupLeaseExpiresAt: null, updatedAt: now() },
					$unset: { backupDispatchId: '', backupDispatchGeneration: '', backupDispatchStartedAt: '', backupDispatchUnconfirmed: '', backupDispatchAttempts: '', backupDispatchNextAt: '' }
				}, storage(session));
				if (result.matchedCount !== 1) return fail(); return true;
			});
		},
		/** Recorded only by the real first Workflow step, not API scheduling ACK. */
		async confirmWorkflowExecution(jobId: string, dispatchId: string, runId: string, deploymentId: string) {
			if (!backupId(dispatchId) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(deploymentId)) return fail();
			const original = await read(jobId);
			return referenceRequest(original, async () => {}, request => deps.transaction(async session => {
				await deps.fence(request, original.ownerId, session);
				const row = await read(jobId, session); assertSameRoot(row, original);
				if (row.backupDispatchId !== dispatchId || row.backupWorkflowRunId !== runId || row.backupCancelRequested || !['queued','running'].includes(row.backupStatus)) return false;
				if (row.backupWorkflowConfirmedDeployment === deploymentId && row.backupWorkflowExecutionConfirmedAt) return true;
				await save(row, { backupWorkflowConfirmedDeployment: deploymentId, backupWorkflowExecutionConfirmedAt: now() }, session); return true;
			}));
		},
		async executionConfirmation(origin: string, deploymentId: string): Promise<string | null> {
			checkPlane(); if (new URL(origin).origin !== origin || !/^[A-Za-z0-9_.:-]{1,200}$/.test(deploymentId)) return null;
			const found = await (await deps.things()).findOne({ thingtime: BACKUP_JOB_KIND, backupVersion: 1, backupOrigin: origin,
				backupWorkflowConfirmedDeployment: deploymentId, backupWorkflowExecutionConfirmedAt: { $type: 'date' } },
				{ projection: { _id: 0, backupWorkflowExecutionConfirmedAt: 1 } });
			return found ? new Date(found.backupWorkflowExecutionConfirmedAt).toISOString() : null;
		},
		/** SDK receipt / first-step attachment is tied to the reserved attempt.
		 * Late old runs cannot attach after retry, pause/resume or outbox recovery. */
		async attachWorkflow(jobId: string, dispatchId: string, runId: string) {
			if (!backupId(dispatchId) || typeof runId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(runId)) return fail();
			const original = await read(jobId);
			return referenceRequest(original, async () => {}, request => deps.transaction(async session => {
				await deps.fence(request, original.ownerId, session);
				const row = await read(jobId, session); assertSameRoot(row, original);
				if (row.backupDispatchId !== dispatchId) return false;
				if (row.backupWorkflowRunId === runId) return true;
				if (row.backupWorkflowRunId || row.backupGeneration !== row.backupDispatchGeneration ||
					!['queued', 'running'].includes(row.backupStatus) || row.backupCancelRequested) return false;
				await save(row, { backupWorkflowRunId: runId, backupDispatchUnconfirmed: false }, session); return true;
			}));
		}
	};
}
export const backupJobs = createBackupJobCoordinator();
