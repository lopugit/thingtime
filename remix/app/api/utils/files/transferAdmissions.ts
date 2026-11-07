import { createHash, randomBytes } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { folderThingMatch, isFolderThing } from '~/schemas/folderThing';
import { type ContentFingerprint, validContentFingerprint } from '~/fileSync/contentFingerprint';
import { readOwnedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { syncPathKey } from '~/fileSync/reconcile';
import { createSyncIgnorePolicy } from '~/fileSync/syncIgnore';
import { parseFileSyncUploadOrigin, sameFileSyncUploadOrigin, type FileSyncUploadOrigin } from '~/fileSync/uploadOrigin';
import {
	attachmentIdForRequest,
	ATTACHMENT_UPLOAD_TTL_MS,
	completeAttachmentUpload,
	signAttachmentUploadParts,
	type AttachmentTransferAuthority
} from '../attachments/attachments';
import { attachmentStore, type AttachmentDoc } from '../attachments/attachmentStore';
import { getAuthToken } from '../auth/authCookie';
import { CHARACTER_HEADER } from '../auth/characterSession';
import { resolveSessionUser, resolveTokenUser } from '../auth/getCurrentUser';
import { getLiveSession, type SessionDoc } from '../auth/sessions';
import type { DeviceActor } from '../devices/deviceAuth';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoSnapshot } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { cloudInventoryAccess, readCloudInventoryRoot } from './inventory';

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

type AdmissionInput = {
	uploadId: string;
	requestId: string;
	configurationId: string;
	configurationRevision: string;
	deviceId: string;
	localRootId: string;
	grantRevision: string;
	sourceVersion: string;
	fingerprint: ContentFingerprint;
	sizeBytes: number;
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
	'replacesAdmissionId'
];
const parseInput = (raw: Record<string, unknown>): AdmissionInput | null => {
	const { uploadId, requestId, configurationId, configurationRevision, deviceId, localRootId, grantRevision, sourceVersion, sizeBytes } = raw;
	const f = raw.fingerprint as Record<string, unknown> | undefined;
	if (
		Object.keys(raw).some((key) => !admitKeys.includes(key)) ||
		!id(uploadId, 128) ||
		!id(requestId, 128) ||
		!id(configurationId) ||
		!id(deviceId) ||
		!id(localRootId) ||
		!sha256(grantRevision) ||
		!id(sourceVersion) ||
		typeof configurationRevision !== 'string' ||
		configurationRevision.length !== 24 ||
		!Number.isFinite(Date.parse(configurationRevision)) ||
		typeof sizeBytes !== 'number' ||
		!Number.isSafeInteger(sizeBytes) ||
		sizeBytes < 1 ||
		!f ||
		typeof f !== 'object' ||
		Array.isArray(f) ||
		Object.keys(f).some((key) => !['partSizeBytes', 'partCount', 'sha256'].includes(key)) ||
		!sha256(f.sha256)
	)
		return null;
	const fingerprint = { algorithm: 'sha256-parts-v1', partSizeBytes: f.partSizeBytes, partCount: f.partCount, sha256: f.sha256 };
	if (!validContentFingerprint(fingerprint, sizeBytes)) return null;
	return { uploadId, requestId, configurationId, configurationRevision, deviceId, localRootId, grantRevision, sourceVersion, fingerprint, sizeBytes };
};

const readConfiguration = async (owner: string, input: AdmissionInput, signal: AbortSignal) => {
	const row = await (await getHomeThingsCollection()).findOne({ shareId: input.configurationId, ownerId: owner }, { signal, maxTimeMS: 5000 });
	if (!row || row.sandbox != null || row.sandboxSpace != null) return null;
	try {
		const saved = readOwnedFileSyncConfiguration(
			{ ...row, id: row.shareId, author: { id: row.ownerId }, updatedAt: row.updatedAt?.toISOString() },
			owner
		);
		const c = saved.configuration;
		return saved.updatedAt === input.configurationRevision &&
			!c.paused &&
			c.mode !== 'download' &&
			c.deviceId === input.deviceId &&
			c.localRootId === input.localRootId
			? c
			: null;
	} catch {
		return null;
	}
};

const readReservation = async (owner: string, input: AdmissionInput) => {
	const doc = await attachmentStore.getOwned(owner, input.uploadId);
	if (
		!doc ||
		doc.targetId != null ||
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

export async function transferAdmission(input: {
	raw: Record<string, unknown>;
	origin: string;
	owner?: TransferOwner | null;
	device?: DeviceActor | null;
	signal: AbortSignal;
}) {
	const { raw, origin, owner, device, signal } = input;
	if (isCustomMongoEndpointActive()) return fail(409, 'Background file transfers require the selected home data plane');
	const now = Date.now();
	const sessions = await getSessionsCollection();
	const things = await getHomeThingsCollection();
	const byId = (jti: string) => ({ jti, purpose: TRANSFER_SESSION_PURPOSE });
	const read = (jti: string): Promise<SessionDoc | null> => sessions.findOne(byId(jti), { signal, maxTimeMS: 5000 });
	const deviceThing = (userId: string, deviceId: string) =>
		things.findOne({ shareId: deviceId, ownerId: userId, thingtime: 'device' }, { signal, maxTimeMS: 5000, projection: { _id: 1 } });
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
			createSyncIgnorePolicy(config.ignoreRules, config.excludedPaths).ignored(reservation.provenance.path, 'file') ||
			!(await destinationLive(owner.userId, config.remoteFolderId, reservation.provenance, signal))
		)
			return changed();
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
			providerUploadId
		});
		const receipt = (meta: AdmissionRecord) => ({
			ok: true as const,
			admissionId: meta.handle,
			expiresAt: meta.authorizationExpiresAt.toISOString()
		});
		const matchesOriginal = (row: SessionDoc, prior: Admission) =>
			row.userId === owner.userId &&
			prior.origin === origin &&
			reservationMatches(doc, prior) &&
			prior.requestId === admitted.requestId &&
			prior.configurationId === admitted.configurationId &&
			prior.deviceId === admitted.deviceId &&
			prior.deviceSessionId === pairing.jti &&
			prior.localRootId === admitted.localRootId &&
			prior.grantRevision === admitted.grantRevision &&
			prior.sourceVersion === admitted.sourceVersion &&
			digest(prior.fingerprint) === digest(admitted.fingerprint);
		const replay = (row: SessionDoc) => {
			const meta = row.meta as AdmissionRecord;
			const prior = meta.binding;
			if (!matchesOriginal(row, prior)) return changed();
			if (!admissionLive(row, meta)) {
				// Queue loss may hide the exact prior handle. An authenticated
				// owner with the original source and live policy can recover it
				// without creating a new authorization or enumerating admissions.
				return replacement === undefined && doc.attachmentState === 'pending'
					? { ...expired(), code: 'admission_renewal_required', admissionId: meta.handle }
					: expired();
			}
			return (replacement === undefined || meta.previousHandle === replacement) && digest(prior) === digest(binding(prior.providerUploadId))
				? receipt(meta)
				: changed();
		};
		if (existing && (replacement === undefined || replacement !== (existing.meta as AdmissionRecord).handle)) return replay(existing);
		if (replacement !== undefined && !existing) return missing();
		if (doc.attachmentState !== 'pending' || !doc.uploadId || !doc.attachmentExpiresAt) return changed();
		const authorizationExpiresAt = new Date(
			Math.min(
				now + ATTACHMENT_UPLOAD_TTL_MS,
				doc.attachmentExpiresAt.getTime(),
				owner.credentialExpiresAt,
				browserSession.expiresAt?.getTime() ?? Infinity,
				pairing.expiresAt?.getTime() ?? Infinity
			)
		);
		if (!(authorizationExpiresAt.getTime() > Date.now())) return expired();
		const meta: AdmissionRecord = {
			binding: binding(doc.uploadId),
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
			expiresAt: doc.attachmentExpiresAt,
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
		!['parts', 'complete', 'revoke'].includes(String(raw.action)) ||
		!jti ||
		Object.keys(raw).some((key) => key !== 'action' && key !== 'admissionId' && !(raw.action === 'parts' && key === 'parts'))
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
	if (raw.action === 'revoke') {
		const revoked = await sessions.updateOne(
			{ ...byId(row.jti), 'meta.handle': meta.handle, revokedAt: null },
			{ $set: { revokedAt: new Date() } },
			{ signal }
		);
		if (!revoked.matchedCount && (await read(row.jti))?.meta?.handle !== meta.handle) return missing();
		return { ok: true as const, revoked: true };
	}
	const check: AttachmentTransferAuthority['check'] = async () => {
		signal.throwIfAborted();
		const [current, session, attachment, config, deviceSession, attachedDevice] = await Promise.all([
			read(row.jti),
			originalOwner(row.userId, a.ownerSessionId),
			readReservation(row.userId, a),
			readConfiguration(row.userId, a, signal),
			paired(row.userId, a.deviceId, a.deviceSessionId),
			deviceThing(row.userId, a.deviceId)
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
	const authority = { expiresAt: meta.authorizationExpiresAt, expectedFingerprint: a.fingerprint, check };
	return raw.action === 'parts'
		? signAttachmentUploadParts(row.userId, { uploadId: a.uploadId, parts: raw.parts }, authority)
		: completeAttachmentUpload(row.userId, { uploadId: a.uploadId }, authority);
}
