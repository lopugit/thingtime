import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { folderThingMatch, isFolderThing } from '~/schemas/folderThing';
import { equalContentFingerprints, type ContentFingerprint, validContentFingerprint } from '~/fileSync/contentFingerprint';
import { readOwnedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { nativePhotoAssetKey } from '~/fileSync/nativeInventory';
import { ExactCloudSyncDestinationChanged, SYNC_DESTINATION_CHANGED } from '~/fileSync/cloudSyncDestination';
import type { PhotoUploadPublication } from '~/fileSync/contentFingerprint';
import { syncPathKey, validSyncPath } from '~/fileSync/reconcile';
import { createSyncIgnorePolicy } from '~/fileSync/syncIgnore';
import { parseFileSyncUploadOrigin, sameFileSyncUploadOrigin, type FileSyncUploadOrigin } from '~/fileSync/uploadOrigin';
import {
	attachmentIdForRequest,
	ATTACHMENT_UPLOAD_TTL_MS,
	completeAttachmentUpload,
	signAttachmentUploadParts,
	startAttachmentUpload,
	type AttachmentTransferAuthority
} from '../attachments/attachments';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import { StorageMutationError } from '../storage/storageCore';
import { cloudFiles } from './files';
import { attachmentStore, type AttachmentDoc } from '../attachments/attachmentStore';
import { getAuthToken } from '../auth/authCookie';
import { CHARACTER_HEADER } from '../auth/characterSession';
import { resolveSessionUser, resolveTokenUser } from '../auth/getCurrentUser';
import { fencePrivateUploadPermission } from '../auth/users';
import { getLiveSession, type SessionDoc } from '../auth/sessions';
import type { DeviceActor } from '../devices/deviceAuth';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoSnapshot, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { automaticThingCloudSyncAllowed } from '../things/thingStoragePolicy';
import { cloudInventoryAccess, readCloudInventoryRoot, readCloudPath } from './inventory';

const PHOTO_RUN_PURPOSE = 'file-sync-photo-run' as const;
export const TRANSFER_SESSION_PURPOSE = 'file-sync-transfer' as const;
const id = (value: unknown, max = 200): value is string =>
	typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const missing = () => fail(404, 'Transfer admission not found');
const changed = () => fail(409, 'Sync approval, configuration or destination changed');
const expired = () => fail(410, 'Transfer admission expired or was revoked');
const live = (session: SessionDoc, now: number) => !session.revokedAt && (session.expiresAt === null || session.expiresAt.getTime() > now);
const browser = (session: SessionDoc) => session.purpose == null || session.purpose === 'browser';
const parseHandle = (value: unknown) => (typeof value === 'string' ? /^(upload-admission_[a-f0-9]{64})\.[a-f0-9]{32}$/.exec(value)?.[1] : undefined);

export type TransferOwner = { userId: string; sessionId: string; credentialExpiresAt: number; uploadsEnabled: boolean };
export async function resolveTransferOwner(request: Request): Promise<TransferOwner | null> {
	const token = await getAuthToken(request);
	const resolved = token && (await resolveTokenUser(token, request.headers.get(CHARACTER_HEADER)));
	if (!resolved || resolved.user.id !== resolved.claims.sub || resolved.user.accountKind !== 'user') return null;
	const session = await getLiveSession(resolved.claims.jti);
	if (!session || !browser(session) || session.userId !== resolved.user.id) return null;
	return {
		userId: resolved.user.id,
		sessionId: session.jti,
		credentialExpiresAt: resolved.claims.exp === undefined ? Infinity : resolved.claims.exp * 1000,
		uploadsEnabled: resolved.user.privateUploadsEnabled
	};
}

type ConnectionBinding = {
	configurationId: string; configurationRevision: string; deviceId: string; localRootId: string; grantRevision: string;
};
type PhotoRunBinding = ConnectionBinding & {
	origin: string; ownerSessionId: string; deviceSessionId: string; configDigest: string; folderId: string; guardedReplacement?: true;
};
type PhotoRun = { binding: PhotoRunBinding; handle: string };
const photoRunKey = (value: unknown) => typeof value === 'string' ? /^(photo-run_[a-f0-9]{64})\.[a-f0-9]{32}$/.exec(value)?.[1] : undefined;
const photoRunFields = ['configurationId', 'configurationRevision', 'deviceId', 'localRootId', 'grantRevision', 'guardedReplacement'];
const validConfigurationRevision = (revision: unknown): revision is string =>
	typeof revision === 'string' && revision.length === 24 && Number.isFinite(Date.parse(revision));
const operationForOriginal = (value: unknown) => {
	const key = digest(value);
	return `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-8${key.slice(17, 20)}-${key.slice(20, 32)}`;
};
type AdmissionInput = ConnectionBinding & {
	uploadId: string;
	requestId: string;
	sourceVersion: string;
	fingerprint: ContentFingerprint;
	sizeBytes: number;
	publication?: PhotoUploadPublication;
};
type Admission = AdmissionInput & {
	origin: string;
	ownerSessionId: string;
	deviceSessionId: string;
	configDigest: string;
	provenance: FileSyncUploadOrigin;
	reservationFingerprint: string;
	reservationCreatedAt: string;
	providerUploadId: string;
	photoRun?: string;
};

type AdmissionRecord = { binding: Admission; handle: string; previousHandle: string | null; authorizationExpiresAt: Date };
const admissionLive = (row: SessionDoc, meta: AdmissionRecord) => live(row, Date.now()) && meta.authorizationExpiresAt.getTime() > Date.now();
const admitKeys = [
	'action',
	'uploadId',
	'requestId',
	'configurationId',
	'configurationRevision',
	'deviceId',
	'localRootId',
	'grantRevision',
	'sourceVersion',
	'fingerprint',
	'sizeBytes',
	'replacesAdmissionId',
	'publication'
];
const parseFingerprint = (value: unknown, sizeBytes: unknown): ContentFingerprint | null => {
	const f = value as Record<string, unknown> | undefined;
	if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 ||
		!f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).some(key => !['partSizeBytes', 'partCount', 'sha256'].includes(key)) || !sha256(f.sha256)) return null;
	const fingerprint = { algorithm: 'sha256-parts-v1', partSizeBytes: f.partSizeBytes, partCount: f.partCount, sha256: f.sha256 };
	return validContentFingerprint(fingerprint, sizeBytes) ? fingerprint : null;
};
const parseInput = (raw: Record<string, unknown>): AdmissionInput | null => {
	const { uploadId, requestId, configurationId, configurationRevision, deviceId, localRootId, grantRevision, sourceVersion, sizeBytes } = raw;
	const publication = raw.publication as Record<string, unknown> | undefined;
	const fingerprint = parseFingerprint(raw.fingerprint, sizeBytes);
	if (
		Object.keys(raw).some((key) => !admitKeys.includes(key)) ||
		!id(uploadId, 128) ||
		!id(requestId, 128) ||
		!id(configurationId) ||
		!id(deviceId) ||
		!id(localRootId) ||
		!sha256(grantRevision) ||
		!id(sourceVersion) ||
		!validConfigurationRevision(configurationRevision) || typeof sizeBytes !== 'number' || !fingerprint ||
		(publication !== undefined && (!publication || typeof publication !== 'object' || Array.isArray(publication) ||
			Object.keys(publication).length !== 1 || (publication.expectedRevision !== null && !id(publication.expectedRevision))))
	)
		return null;
	return { uploadId, requestId, configurationId, configurationRevision, deviceId, localRootId, grantRevision, sourceVersion, fingerprint, sizeBytes, ...(publication ? { publication: { expectedRevision: publication.expectedRevision as string | null } } : {}) };
};

const readConfiguration = async (owner: string, input: ConnectionBinding, signal: AbortSignal, fence?: { session: any; token: string }) => {
	const things = await getHomeThingsCollection();
	const row = await things.findOne({ shareId: input.configurationId, ownerId: owner }, { signal, maxTimeMS: 5000, session: fence?.session });
	if (!row || row.sandbox != null || row.sandboxSpace != null) return null;
	let configuration: ReturnType<typeof readOwnedFileSyncConfiguration>['configuration'];
	try {
		const saved = readOwnedFileSyncConfiguration(
			{ ...row, id: row.shareId, author: { id: row.ownerId }, updatedAt: row.updatedAt?.toISOString() },
			owner
		);
		const c = saved.configuration;
		if (saved.updatedAt !== input.configurationRevision || c.paused || c.mode === 'download' ||
			c.deviceId !== input.deviceId || c.localRootId !== input.localRootId) return null;
		configuration = c;
	} catch {
		return null;
	}
	if (fence) {
		const locked = await things.updateOne({ _id: row._id, ownerId: owner, updatedAt: row.updatedAt },
			{ $set: { fileSyncPublicationFence: fence.token } }, { session: fence.session, signal });
		if (locked.matchedCount !== 1) return null;
	}
	return configuration;
};

const readReservation = async (owner: string, input: AdmissionInput, publishedFileId?: string, session?: any) => {
	const doc = session ? await (await getHomeThingsCollection()).findOne({ shareId: input.uploadId, ownerId: owner, thingtime: 'attachment' }, { session }) as AttachmentDoc | null :
		await attachmentStore.getOwned(owner, input.uploadId);
	if (
		!doc ||
		(doc.targetId != null && doc.targetId !== publishedFileId) ||
		doc.attachmentImportDraft ||
		doc.attachmentPurpose !== 'file' ||
		doc.objectSizeBytes !== input.sizeBytes ||
		doc.objectKey !== 'objects/' + input.uploadId ||
		!doc.attachmentRequestFingerprint ||
		!['pending', 'finalizing', 'ready'].includes(doc.attachmentState)
	)
		return null;
	try {
		const provenance = parseFileSyncUploadOrigin(doc.attachmentFileSyncOrigin);
		return provenance.deviceId === input.deviceId &&
			provenance.localRootId === input.configurationId &&
			!!provenance.cloudRootId &&
			!!provenance.folderId
			? { doc, provenance }
			: null;
	} catch {
		return null;
	}
};

/** Validate the exact private folder chain between this attachment's parent
 * and the current configured root, including its reviewed root-relative path. */
async function destinationLive(owner: string, rootId: string, provenance: FileSyncUploadOrigin, signal: AbortSignal) {
	if (provenance.cloudRootId !== rootId || !provenance.folderId) return false;
	const things = await getHomeThingsCollection();
	try {
		return await withHomeMongoSnapshot(async (session) => {
			await readCloudInventoryRoot(things, session, owner, rootId, () => 5000, signal);
			const parents = provenance.path.split('/').slice(0, -1);
			if (parents.length >= MAX_FOLDER_DEPTH) return false;
			let parent: string | null = provenance.folderId;
			for (let index = parents.length - 1; index >= 0; index--) {
				signal.throwIfAborted();
				if (!parent || parent === rootId) return false;
				const folder = await things.findOne(
					{ shareId: parent, ownerId: owner, ...folderThingMatch() },
					{ session, projection: cloudInventoryAccess.projection, signal, maxTimeMS: 5000, readPreference: 'primary' }
				);
				if (
					!folder ||
					!cloudInventoryAccess.owned(folder, owner) ||
					!cloudInventoryAccess.privateAudience(folder, true) ||
					!isFolderThing(folder) ||
					folder.thingtime?.includes('file') ||
					folder.crystal?.trashed === true ||
					typeof folder.crystal?.name !== 'string' ||
					syncPathKey(folder.crystal.name) !== syncPathKey(parents[index])
				)
					return false;
				parent = typeof folder.folderId === 'string' ? folder.folderId : null;
			}
			return parent === rootId;
		});
	} catch (error) {
		if ([404, 409].includes((error as { status?: number } | null)?.status ?? 0)) return false;
		throw error;
	}
}

const reservationMatches = (doc: AttachmentDoc, admission: Admission) =>
	doc.attachmentRequestFingerprint === admission.reservationFingerprint &&
	doc.createdAt.toISOString() === admission.reservationCreatedAt &&
	(doc.attachmentState === 'ready' || doc.uploadId === admission.providerUploadId) &&
	sameFileSyncUploadOrigin(doc.attachmentFileSyncOrigin, admission.provenance);

const isPhotoBackup = (config: NonNullable<Awaited<ReturnType<typeof readConfiguration>>>) =>
	config.sourceKind === 'photos' && config.mode === 'backup' && !config.propagateDeletes;
const publicationAllowed = (config: NonNullable<Awaited<ReturnType<typeof readConfiguration>>>, provenance: FileSyncUploadOrigin) =>
	isPhotoBackup(config) &&
	provenance.cloudRootId === config.remoteFolderId && provenance.folderId === config.remoteFolderId &&
	!provenance.path.includes('/') && !!nativePhotoAssetKey(provenance.path);

type TransferAdmissionResult = { ok: true; [field: string]: unknown } | { ok: false; status: number; error: string; [field: string]: unknown };
export async function transferAdmission(input: {
	raw: Record<string, unknown>;
	origin: string;
	owner?: TransferOwner | null;
	device?: DeviceActor | null;
	signal: AbortSignal;
	/** Internal only. Device actions cannot supply this field directly. */
	photoRun?: string;
}): Promise<TransferAdmissionResult> {
	const { raw, origin, owner, device, signal, photoRun } = input;
	if (isCustomMongoEndpointActive()) return fail(409, 'Background file transfers require the selected home data plane');
	const now = Date.now();
	const sessions = await getSessionsCollection();
	const things = await getHomeThingsCollection();
	const byId = (jti: string) => ({ jti, purpose: TRANSFER_SESSION_PURPOSE });
	const read = (jti: string): Promise<SessionDoc | null> => sessions.findOne(byId(jti), { signal, maxTimeMS: 5000 });
	const deviceThing = (userId: string, deviceId: string, iosOnly = false) =>
		things.findOne({ shareId: deviceId, ownerId: userId, thingtime: 'device', ...(iosOnly ? { 'crystal.platform': 'ios' } : {}) }, { signal, maxTimeMS: 5000, projection: { _id: 1 } });
	const paired = (userId: string, deviceId: string, jti?: string): Promise<SessionDoc | null> =>
		sessions.findOne(
			{
				...(jti ? { jti } : {}),
				purpose: 'device',
				userId,
				'meta.deviceId': deviceId,
				revokedAt: null,
				expiresAt: { $gt: new Date() }
			},
			{ signal, maxTimeMS: 5000 }
		);
	const originalOwner = async (userId: string, jti: string) => {
		const [session, user] = await Promise.all([getLiveSession(jti), resolveSessionUser(jti, userId, null)]);
		return session &&
			browser(session) &&
			session.userId === userId &&
			user?.id === userId &&
			user.accountKind === 'user' &&
			user.privateUploadsEnabled
			? session
			: null;
	};
	const runFilter = (jti: string) => ({ jti, purpose: PHOTO_RUN_PURPOSE });
	const readRun = async (handle: unknown) => {
		const jti = photoRunKey(handle);
		if (!jti) return null;
		const row = await sessions.findOne(runFilter(jti), { signal, maxTimeMS: 5000 });
		const meta = row?.meta as PhotoRun | undefined;
		return row && meta?.handle === handle && meta.binding.origin === origin ? { row, meta } : null;
	};
	const liveRun = async (handle: string, ownerId: string, deviceSessionId: string) => {
		const found = await readRun(handle);
		if (!found || found.row.userId !== ownerId || found.meta.binding.deviceSessionId !== deviceSessionId || !live(found.row, Date.now())) return null;
		return found;
	};
	if (raw.action === 'open-photo-run') {
		if (!owner) return fail(401, 'An owning browser session is required');
		if (!owner.uploadsEnabled) return fail(403, 'Private uploads are not approved for this account');
		const { configurationId, configurationRevision, deviceId, localRootId, grantRevision, guardedReplacement } = raw;
		if (Object.keys(raw).some(key => key !== 'action' && !photoRunFields.includes(key)) || !id(configurationId) ||
			!validConfigurationRevision(configurationRevision) || !id(deviceId) || !id(localRootId) || !sha256(grantRevision) ||
			(guardedReplacement !== undefined && guardedReplacement !== true))
			return fail(400, 'Invalid Photos run request');
		const scope = { configurationId, configurationRevision, deviceId, localRootId, grantRevision };
		const [config, pairing, attached, browserSession] = await Promise.all([
			readConfiguration(owner.userId, scope, signal), paired(owner.userId, deviceId),
			deviceThing(owner.userId, deviceId, true), originalOwner(owner.userId, owner.sessionId)
		]);
		if (!config || !isPhotoBackup(config) || config.resourceLimits || config.ignoreRules || !pairing || !attached || !browserSession) return changed();
		try {
			await withHomeMongoSnapshot(session => readCloudInventoryRoot(things, session, owner.userId, config.remoteFolderId, () => 5000, signal));
		} catch (error) {
			if (error instanceof StorageMutationError && [404, 409].includes(error.status)) return changed();
			throw error;
		}
		const expiresAt = new Date(Math.min(owner.credentialExpiresAt, browserSession.expiresAt?.getTime() ?? Infinity, pairing.expiresAt!.getTime()));
		if (!(expiresAt.getTime() > now)) return expired();
		const jti = 'photo-run_' + digest(['file-sync-photo-run-v1', origin, owner.userId, deviceId, configurationId]);
		const binding: PhotoRunBinding = { ...scope, origin, ownerSessionId: owner.sessionId, deviceSessionId: pairing.jti,
			configDigest: digest(config), folderId: config.remoteFolderId, ...(guardedReplacement ? { guardedReplacement: true as const } : {}) };
		const current = await sessions.findOne(runFilter(jti), { signal, maxTimeMS: 5000 });
		const prior = current?.meta as PhotoRun | undefined;
		const receipt = (handle: string, expiry: Date) => ({ ok: true as const, runId: handle, expiresAt: expiry.toISOString() });
		if (current && prior && current.expiresAt && live(current, now) && digest(prior.binding) === digest(binding))
			return receipt(prior.handle, current.expiresAt);
		const meta: PhotoRun = { binding, handle: jti + '.' + randomBytes(16).toString('hex') };
		try {
			return await withHomeMongoTransaction(async session => {
				const fresh = await readConfiguration(owner.userId, scope, signal, { session, token: randomUUID() });
				if (!fresh || digest(fresh) !== binding.configDigest) return changed();
				if (current && prior) {
					const replaced = await sessions.updateOne({ ...runFilter(jti), 'meta.handle': prior.handle },
						{ $set: { meta, expiresAt, revokedAt: null } }, { session, signal });
					if (replaced.matchedCount !== 1) return changed();
				} else {
					await sessions.insertOne({ jti, userId: owner.userId, type: 'tt.session', schemaVersion: COLLECTION_SCHEMA_VERSIONS.sessions,
						purpose: PHOTO_RUN_PURPOSE, createdAt: new Date(now), expiresAt, revokedAt: null, meta }, { session });
				}
				return receipt(meta.handle, expiresAt);
			});
		} catch (error) {
			if ((error as { code?: number })?.code === 11000) return changed();
			throw error;
		}
	}
	if (raw.action === 'reserve-photo-original' || raw.action === 'revoke-photo-run' || raw.action === 'check-photo-run') {
		const revoking = raw.action === 'revoke-photo-run';
		const checking = raw.action === 'check-photo-run';
		const allowed = revoking || checking ? ['action', 'runId'] : ['action', 'runId', 'path', 'sourceVersion', 'sizeBytes', 'fingerprint', 'guardedReplacement'];
		if (Object.keys(raw).some(key => !allowed.includes(key)) || !photoRunKey(raw.runId)) return fail(400, 'Invalid Photos run request');
		const handle = raw.runId as string, found = await readRun(handle);
		if (!found) return missing();
		const { row, meta: { binding } } = found;
		if (!(device ? device.userId === row.userId && device.deviceId === binding.deviceId && device.sessionId === binding.deviceSessionId :
			revoking && owner?.userId === row.userId && owner.sessionId === binding.ownerSessionId)) return missing();
		if (revoking) {
			const revoked = await sessions.updateOne({ ...runFilter(row.jti), 'meta.handle': handle }, { $set: { revokedAt: new Date() } }, { signal });
			return revoked.matchedCount ? { ok: true as const, revoked: true } : missing();
		}
		if (!live(row, now) || !row.expiresAt) return expired();
		const [config, ownerSession, pairing, attached] = await Promise.all([
			readConfiguration(row.userId, binding, signal), originalOwner(row.userId, binding.ownerSessionId),
			paired(row.userId, binding.deviceId, binding.deviceSessionId), deviceThing(row.userId, binding.deviceId, true)
		]);
		if (!ownerSession || !pairing || !attached) return expired();
		if (!config || digest(config) !== binding.configDigest || !isPhotoBackup(config) || config.resourceLimits || config.ignoreRules) return changed();
		if (checking) {
			try {
				await withHomeMongoSnapshot(session => readCloudInventoryRoot(things, session, row.userId, binding.folderId, () => 5000, signal));
			} catch (error) {
				if (error instanceof StorageMutationError && [404, 409].includes(error.status)) return changed();
				throw error;
			}
			return (await liveRun(handle, row.userId, binding.deviceSessionId)) ? { ok: true } : expired();
		}
		const { path, sourceVersion, sizeBytes, guardedReplacement } = raw, fingerprint = parseFingerprint(raw.fingerprint, sizeBytes);
		if (!validSyncPath(path) || path.includes('/') || !nativePhotoAssetKey(path) || !id(sourceVersion) || typeof sizeBytes !== 'number' || !fingerprint ||
			(guardedReplacement !== undefined && guardedReplacement !== true)) return fail(400, 'Invalid Photos original');
		if (guardedReplacement && !binding.guardedReplacement) return fail(403, 'This Photos run does not authorize managed replacements');
		if (createSyncIgnorePolicy(config.ignoreRules, config.excludedPaths).ignored(path, 'file')) return changed();
		const observation = await readCloudPath(row.userId, binding.folderId, path, signal);
		if (!observation.ok) return observation;
		const existing = observation.observation.entry;
		if (existing?.kind === 'file' && !existing.symbolicLink && existing.size === sizeBytes && existing.fingerprint &&
			equalContentFingerprints(existing.fingerprint, fingerprint)) {
			if (!(await liveRun(handle, row.userId, binding.deviceSessionId))) return expired();
			return { ok: true as const, state: 'already-backed' as const };
		}
		if (existing) {
			const conflict = () => ({ ...fail(409, 'The Photos destination path requires review'), code: 'photo_path_conflict' });
			if (!guardedReplacement || existing.kind !== 'file' || existing.symbolicLink) return conflict();
			const current = await cloudFiles.read(row.userId, existing.id);
			if (!current.ok || !('file' in current) || !current.file || current.file.revision !== existing.version ||
				current.file.folderId !== binding.folderId || current.file.name !== path || current.file.trashed) return conflict();
			const doc = await attachmentStore.getOwned(row.userId, current.file.content.attachmentId);
			const provenance = { version: 1, deviceId: binding.deviceId, localRootId: binding.configurationId, cloudRootId: binding.folderId,
				fileId: existing.id, folderId: binding.folderId, path };
			if (!doc || doc.targetId !== existing.id || doc.attachmentState !== 'ready' ||
				!sameFileSyncUploadOrigin(doc.attachmentFileSyncOrigin, provenance)) return conflict();
			let proof = doc.fileSyncSourceGrant;
			if (!proof) {
				// Earlier scoped publication may have an immutable admission
				// even if the protected grant stamp has not been backfilled.
				const priorId = 'upload-admission_' + digest(['file-sync-transfer-v1', row.userId, doc.shareId]);
				const prior = await read(priorId), old = (prior?.meta as AdmissionRecord | undefined)?.binding;
				if (prior?.userId === row.userId && old?.origin === origin && old.publication &&
					reservationMatches(doc, old) && equalContentFingerprints(old.fingerprint, current.file.content.fingerprint))
					proof = { localRootId: old.localRootId, grantRevision: old.grantRevision };
			}
			if (proof?.localRootId !== binding.localRootId || proof.grantRevision !== binding.grantRevision) return conflict();
		}
		if (!(await liveRun(handle, row.userId, binding.deviceSessionId))) return expired();
		const requestId = operationForOriginal(['file-sync-photo-original-v1', handle, path, sourceVersion, fingerprint,
			...(existing ? [existing.id, existing.version] : [])]);
		const fileId = existing?.id ?? requestId;
		const reservation = await startAttachmentUpload(row.userId, { filename: path, contentType: 'application/octet-stream', sizeBytes,
			requestId, purpose: 'file', contentFingerprint: fingerprint, fileSyncOrigin: { version: 1, deviceId: binding.deviceId, localRootId: binding.configurationId,
				cloudRootId: binding.folderId, fileId, folderId: binding.folderId, path } });
		if (!reservation.ok) return reservation;
		const uploadId = reservation.upload.id, publication = { expectedRevision: existing?.version ?? null };
		const { algorithm: _algorithm, ...digestFields } = fingerprint;
		const admitRequest = { action: 'admit', uploadId, requestId, configurationId: binding.configurationId,
			configurationRevision: binding.configurationRevision, deviceId: binding.deviceId, localRootId: binding.localRootId,
			grantRevision: binding.grantRevision, sourceVersion, sizeBytes, fingerprint: digestFields, publication };
		const issuingOwner = { userId: row.userId, sessionId: binding.ownerSessionId, credentialExpiresAt: row.expiresAt.getTime(), uploadsEnabled: true };
		const admitOriginal = (raw: Record<string, unknown>) =>
			transferAdmission({ raw, origin, owner: issuingOwner, signal, photoRun: handle });
		let admission = await admitOriginal(admitRequest);
		if (!admission.ok && 'code' in admission && admission.code === 'admission_renewal_required' && 'admissionId' in admission)
			admission = await admitOriginal({ ...admitRequest, replacesAdmissionId: admission.admissionId });
		if (!admission.ok) return admission;
		if (typeof admission.admissionId !== 'string' || typeof admission.expiresAt !== 'string') throw Error('Unexpected original admission result');
		return { ok: true as const, state: 'reserved' as const, requestId, uploadId, admissionId: admission.admissionId,
			expiresAt: admission.expiresAt, publication, ...(guardedReplacement ? { fileId } : {}), ...(reservation.upload.state === 'ready' ? { staged: true as const } : {}) };
	}
	if (raw.action === 'admit') {
		if (!owner) return fail(401, 'An owning browser session is required');
		if (!owner.uploadsEnabled) return fail(403, 'Private uploads are not approved for this account');
		const admitted = parseInput(raw);
		if (!admitted || attachmentIdForRequest(owner.userId, admitted.requestId) !== admitted.uploadId)
			return fail(400, 'Invalid transfer admission request');
		// A shared home database can serve multiple origins. The immutable
		// binding contains the origin; those origins share one reservation lock.
		const jti = 'upload-admission_' + digest(['file-sync-transfer-v1', owner.userId, admitted.uploadId]);
		const replacement = raw.replacesAdmissionId;
		if (replacement !== undefined && parseHandle(replacement) !== jti) return fail(400, 'Invalid transfer admission replacement');
		const [config, reservation, pairing, attachedDevice, browserSession, existing] = await Promise.all([
			readConfiguration(owner.userId, admitted, signal),
			readReservation(owner.userId, admitted),
			paired(owner.userId, admitted.deviceId),
			deviceThing(owner.userId, admitted.deviceId),
			originalOwner(owner.userId, owner.sessionId),
			read(jti)
		]);
		if (
			!browserSession ||
			!pairing ||
			!attachedDevice ||
			!config ||
			!reservation ||
			(admitted.publication !== undefined && !publicationAllowed(config, reservation.provenance)) ||
			createSyncIgnorePolicy(config.ignoreRules, config.excludedPaths).ignored(reservation.provenance.path, 'file') ||
			!(await destinationLive(owner.userId, config.remoteFolderId, reservation.provenance, signal))
		)
			return changed();
		if (photoRun && !(await liveRun(photoRun, owner.userId, pairing.jti))) return expired();
		const { doc, provenance } = reservation;
		const binding = (providerUploadId: string): Admission => ({
			...admitted,
			origin,
			ownerSessionId: owner.sessionId,
			deviceSessionId: pairing.jti,
			configDigest: digest(config),
			provenance,
			reservationFingerprint: doc.attachmentRequestFingerprint!,
			reservationCreatedAt: doc.createdAt.toISOString(),
			providerUploadId,
			...(photoRun ? { photoRun } : {})
		});
		const receipt = (meta: AdmissionRecord) => ({
			ok: true as const,
			admissionId: meta.handle,
			expiresAt: meta.authorizationExpiresAt.toISOString()
		});
		const matchesOriginal = (row: SessionDoc, prior: Admission) =>
			row.userId === owner.userId &&
			prior.origin === origin &&
			(reservationMatches(doc, prior) || (photoRun && !admissionLive(row, row.meta as AdmissionRecord) &&
				prior.reservationFingerprint === doc.attachmentRequestFingerprint && sameFileSyncUploadOrigin(provenance, prior.provenance))) &&
			prior.requestId === admitted.requestId &&
			prior.configurationId === admitted.configurationId &&
			prior.deviceId === admitted.deviceId &&
			prior.deviceSessionId === pairing.jti &&
			prior.localRootId === admitted.localRootId &&
			prior.grantRevision === admitted.grantRevision && prior.photoRun === photoRun &&
			prior.sourceVersion === admitted.sourceVersion &&
			digest(prior.fingerprint) === digest(admitted.fingerprint) &&
			JSON.stringify(prior.publication) === JSON.stringify(admitted.publication);
		const replay = (row: SessionDoc) => {
			const meta = row.meta as AdmissionRecord;
			const prior = meta.binding;
			if (!matchesOriginal(row, prior)) return changed();
			if (!admissionLive(row, meta)) {
				// Queue loss may hide the exact prior handle. An authenticated
				// owner with the original source and live policy can recover it
				// without creating a new authorization or enumerating admissions.
				return replacement === undefined && (doc.attachmentState === 'pending' || (photoRun && doc.attachmentState === 'ready'))
					? { ...expired(), code: 'admission_renewal_required', admissionId: meta.handle }
					: expired();
			}
			return (replacement === undefined || meta.previousHandle === replacement) && digest(prior) === digest(binding(prior.providerUploadId))
				? receipt(meta)
				: changed();
		};
		if (existing && (replacement === undefined || replacement !== (existing.meta as AdmissionRecord).handle)) return replay(existing);
		if (replacement !== undefined && !existing) return missing();
		const ready = !!photoRun && doc.attachmentState === 'ready';
		if (!ready && (doc.attachmentState !== 'pending' || !doc.uploadId || !doc.attachmentExpiresAt)) return changed();
		const authorizationExpiresAt = new Date(
			Math.min(
				now + ATTACHMENT_UPLOAD_TTL_MS,
				doc.attachmentExpiresAt?.getTime() ?? Infinity,
				owner.credentialExpiresAt,
				browserSession.expiresAt?.getTime() ?? Infinity,
				pairing.expiresAt?.getTime() ?? Infinity
			)
		);
		if (!(authorizationExpiresAt.getTime() > Date.now())) return expired();
		const meta: AdmissionRecord = {
			binding: binding(doc.uploadId ?? 'verified-ready'),
			handle: jti + '.' + randomBytes(16).toString('hex'),
			previousHandle: typeof replacement === 'string' ? replacement : null,
			authorizationExpiresAt
		};
		if (existing) {
			const previous = (existing.meta as AdmissionRecord).binding;
			if (!matchesOriginal(existing, previous)) return changed();
			const result = await sessions.updateOne(
				{ ...byId(jti), 'meta.handle': replacement, $or: [{ revokedAt: { $ne: null } }, { 'meta.authorizationExpiresAt': { $lte: new Date() } }] },
				{ $set: { meta, revokedAt: null } },
				{ signal }
			);
			if (result.matchedCount) return receipt(meta);
			const raced = await read(jti);
			return raced ? replay(raced) : changed();
		}
		// Keep the authorization record until the original reservation expires.
		// A fresh generation cannot make any previous handle usable again.
		const row: SessionDoc = {
			jti,
			userId: owner.userId,
			type: 'tt.session',
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.sessions,
			purpose: TRANSFER_SESSION_PURPOSE,
			createdAt: new Date(now),
			expiresAt: doc.attachmentExpiresAt ?? authorizationExpiresAt,
			revokedAt: null,
			meta
		};
		try {
			await sessions.insertOne(row);
		} catch (error) {
			if ((error as { code?: number } | null)?.code !== 11000) throw error;
			const prior = await read(jti);
			return prior ? replay(prior) : changed();
		}
		return receipt(meta);
	}
	const jti = parseHandle(raw.admissionId);
	if (
		!['parts', 'complete', 'publish', 'revoke'].includes(String(raw.action)) ||
		!jti ||
		Object.keys(raw).some((key) => key !== 'action' && key !== 'admissionId' && !(raw.action === 'parts' && (key === 'parts' || key === 'transport'))) ||
		(raw.transport !== undefined && raw.transport !== 'background-file-v1')
	)
		return fail(400, 'Invalid admitted transfer request');
	if (!device && !(raw.action === 'revoke' && owner)) return fail(401, 'The paired device credential is required');
	const row = await read(jti);
	const meta = row?.meta as AdmissionRecord | undefined;
	const a = meta?.binding;
	if (
		!row ||
		!meta ||
		!a ||
		meta.handle !== raw.admissionId ||
		a.origin !== origin ||
		!(device
			? row.userId === device.userId && a.deviceId === device.deviceId && a.deviceSessionId === device.sessionId
			: row.userId === owner?.userId && a.ownerSessionId === owner.sessionId)
	)
		return missing();
	if (raw.transport === 'background-file-v1' && !a.photoRun) return fail(400, 'Background file transport requires a Photos run');
	if (raw.action === 'revoke') {
		const revoked = await sessions.updateOne(
			{ ...byId(row.jti), 'meta.handle': meta.handle, revokedAt: null },
			{ $set: { revokedAt: new Date() } },
			{ signal }
		);
		if (!revoked.matchedCount && (await read(row.jti))?.meta?.handle !== meta.handle) return missing();
		return { ok: true as const, revoked: true };
	}
	const publishing = raw.action === 'publish';
	if (publishing && !a.publication) return fail(403, 'This transfer admission only stages bytes');
	const check: AttachmentTransferAuthority['check'] = async () => {
		signal.throwIfAborted();
		const [current, session, attachment, config, deviceSession, attachedDevice] = await Promise.all([
			read(row.jti),
			originalOwner(row.userId, a.ownerSessionId),
			readReservation(row.userId, a, publishing ? a.provenance.fileId : undefined),
			readConfiguration(row.userId, a, signal),
			paired(row.userId, a.deviceId, a.deviceSessionId),
			deviceThing(row.userId, a.deviceId, !!a.photoRun)
		]);
		const currentMeta = current?.meta as AdmissionRecord | undefined;
		if (
			!current ||
			!currentMeta ||
			currentMeta.handle !== meta.handle ||
			!admissionLive(current, currentMeta) ||
			!session ||
			!deviceSession ||
			!attachedDevice
		)
			return expired();
		if (a.photoRun && !(await liveRun(a.photoRun, row.userId, a.deviceSessionId))) return expired();
		if (!(await automaticThingCloudSyncAllowed(await getHomeThingsCollection(), row.userId, a.provenance.fileId)))
			return fail(409, 'Cloud sync is paused for this file');
		if (
			!attachment ||
			!reservationMatches(attachment.doc, a) ||
			!config ||
			digest(config) !== a.configDigest ||
			!(await destinationLive(row.userId, config.remoteFolderId, a.provenance, signal))
		)
			return changed();
		return null;
	};
	if (publishing) {
		const refused = await check();
		if (refused) return refused;
		const ownerId = row.userId, provenance = a.provenance;
		const refuse = (result: ReturnType<typeof fail>): never => { throw new StorageMutationError(result.status, 'storage_conflict', result.error); };
		try {
			return await withHomeMongoTransaction(async session => {
				signal.throwIfAborted();
				const token = randomUUID(), date = new Date();
				// Touch each exact authority row so a concurrent revoke, pause,
				// account switch, settings edit or unpair forces a fresh snapshot.
				for (const filter of [
					{ ...byId(row.jti), userId: ownerId, 'meta.handle': meta.handle, 'meta.authorizationExpiresAt': { $gt: date }, expiresAt: { $gt: date } },
					{ jti: a.deviceSessionId, userId: ownerId, purpose: 'device' as const, 'meta.deviceId': a.deviceId, expiresAt: { $gt: date } },
					{ jti: a.ownerSessionId, userId: ownerId, purpose: { $in: ['browser', null] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: date } }] }
				]) {
					const result = await sessions.updateOne({ ...filter, revokedAt: null } as any,
						{ $set: { 'meta.fileSyncPublicationFence': token } }, { session, signal });
					if (result.matchedCount !== 1) return refuse(expired());
				}
				if (a.photoRun) {
					const key = photoRunKey(a.photoRun);
					if (!key) return refuse(expired());
					const locked = await sessions.updateOne({ ...runFilter(key), userId: ownerId, 'meta.handle': a.photoRun,
						'meta.binding.deviceSessionId': a.deviceSessionId, revokedAt: null, expiresAt: { $gt: date } },
						{ $set: { 'meta.fileSyncPublicationFence': token } }, { session, signal });
					if (locked.matchedCount !== 1) return refuse(expired());
				}
				if (!(await originalOwner(ownerId, a.ownerSessionId)) ||
					!(await fencePrivateUploadPermission(ownerId, token, session, signal))) return refuse(expired());
				const attached = await things.updateOne({ shareId: a.deviceId, ownerId, thingtime: 'device', ...(a.photoRun ? { 'crystal.platform': 'ios' } : {}) },
					{ $set: { fileSyncPublicationFence: token } }, { session, signal });
				if (attached.matchedCount !== 1) return refuse(expired());
				const config = await readConfiguration(ownerId, a, signal, { session, token });
				if (!config || digest(config) !== a.configDigest || !publicationAllowed(config, provenance) ||
					createSyncIgnorePolicy(config.ignoreRules, config.excludedPaths).ignored(provenance.path, 'file')) return refuse(changed());
				const reservation = await readReservation(ownerId, a, provenance.fileId, session), doc = reservation?.doc;
				if (!doc || doc.attachmentState !== 'ready' || !doc.objectVersionId || !reservationMatches(doc, a)) return refuse(changed());
				signal.throwIfAborted();
				const result = await cloudFiles.commit(ownerId, {
					id: provenance.fileId, operationId: a.requestId, expectedRevision: a.publication!.expectedRevision,
					name: provenance.path, folderId: provenance.folderId, attachmentId: a.uploadId,
					contentVersion: attachmentContentVersion(a.uploadId, doc.objectKey, doc.objectVersionId),
					trashed: false, syncDestination: { rootId: config.remoteFolderId, path: provenance.path }
				}, { session, expectedFingerprint: a.fingerprint, syncSourceGrant: { localRootId: a.localRootId, grantRevision: a.grantRevision } });
				if (!result.ok) return refuse(fail(result.status, result.error));
				if (meta.authorizationExpiresAt.getTime() <= Date.now()) return refuse(expired());
				signal.throwIfAborted();
				return { ok: true as const, file: result.file, replayed: result.replayed };
			});
		} catch (error) {
			if (error instanceof ExactCloudSyncDestinationChanged) return { ...changed(), code: SYNC_DESTINATION_CHANGED };
			if (error instanceof StorageMutationError) return fail(error.status, error.message);
			throw error;
		}
	}
	const authority = { expiresAt: meta.authorizationExpiresAt, expectedFingerprint: a.fingerprint, check,
		...(a.photoRun && raw.transport === 'background-file-v1' ? { backgroundFileTransport: true } : {}) };
	return raw.action === 'parts'
		? signAttachmentUploadParts(row.userId, { uploadId: a.uploadId, parts: raw.parts }, authority)
		: completeAttachmentUpload(row.userId, { uploadId: a.uploadId }, authority);
}
