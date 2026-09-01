import { randomUUID } from 'node:crypto';

import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { createSession, type SessionDoc } from '../auth/sessions';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { thingUniqueKeyFilter, thingUniqueKeys } from '../mongodb/uniqueKeys';
import { deleteAccountedThings, insertAccountedThing, updateAccountedThing } from '../storage/accountedThings';
import {
	DEVICE_SESSION_LIFETIME_MS,
	devicePairingProofHash,
	deviceCredentialHash,
	findPairingSession,
	generateDevicePairingNonce,
	normalizeDeviceCredential,
	normalizeDevicePairingNonce,
	normalizeDevicePairingPublicKey,
	normalizeDevicePairingSignature,
	normalizePairingSecret,
	verifyDevicePairingClaim
} from './deviceAuth';
import {
	decodeDeviceEventCursor,
	decideDeviceRevision,
	DEVICE_PERMISSION_MODES,
	deviceControlEventLogicalBytes,
	deviceFail,
	deviceHash,
	devicePayloadHash,
	deviceSnapshotHash,
	encodeDeviceEventCursor,
	normalizeDeviceConnectors,
	normalizeDeviceDescriptor,
	normalizeDevicePermissionMode,
	normalizeDeviceState,
	retainedDeviceControlEventCount,
	type DeviceConnectorSnapshot,
	type DeviceDescriptor,
	type DeviceFail,
	type DevicePermissionMode,
	type DeviceStateSnapshot
} from './deviceCore';

const HOME_ACCOUNTING = { accountedPlane: 'home' as const };
const ONLINE_WINDOW_MS = 45_000;
const MAX_DEVICES_PER_USER = 100;
export const DEVICE_CONNECTOR_FRESHNESS_MS = 2 * 60 * 1000;
export const DEVICE_CONTROL_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DEVICE_CONTROL_EVENT_MAX_COUNT = 4_096;
export const DEVICE_CONTROL_EVENT_MAX_BYTES = 8 * 1024 * 1024;
export const DEVICE_CONTROL_EVENT_MAX_ROW_BYTES = 16 * 1024;

type DeviceThingKind =
	| 'device'
	| 'device-state'
	| 'device-connector'
	| 'device-command'
	| 'device-command-event'
	| 'device-ai-live-state'
	| 'device-approval'
	| 'device-screen-session';

const DEVICE_UNIQUE_KEY_FIELDS = [
	'deviceKey',
	'deviceStateKey',
	'deviceConnectorKey',
	'deviceCommandKey',
	'deviceEventKey',
	'deviceAiLiveStateKey',
	'liveEventSequenceKey',
	'deviceApprovalKey',
	'deviceScreenKey'
] as const;

export const newDeviceThing = (
	kind: DeviceThingKind,
	fields: {
		ownerId: string;
		targetId?: string | null;
		crystal: Record<string, unknown>;
		shareId?: string;
		control?: boolean;
	}
) => {
	const now = new Date();
	const deviceUniqueKeys = [
		...new Set(
			DEVICE_UNIQUE_KEY_FIELDS.map((field) => fields.crystal[field]).filter((value): value is string => typeof value === 'string' && value.length > 0)
		)
	];
	const crystal: Record<string, unknown> = { ...fields.crystal };
	return {
		shareId: fields.shareId || randomUUID(),
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: [kind],
		crystal,
		...(deviceUniqueKeys.length ? { uniqueKeys: thingUniqueKeys('deviceUniqueKey', deviceUniqueKeys) } : {}),
		extended: null,
		ownerId: fields.ownerId,
		acl: ['tt:user'],
		targetId: fields.targetId ?? null,
		tags: [],
		...(fields.control ? { storageClass: 'control' } : {}),
		createdAt: now,
		updatedAt: now
	};
};

const iso = (value: unknown): string | null => {
	if (!value) return null;
	const date = new Date(value as any);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const safeCapabilities = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 64) : [];

const normalizeCapabilities = (value: unknown): string[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 64) return null;
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string') return null;
		const capability = entry.trim().slice(0, 100);
		if (!capability || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(capability)) return null;
		if (!out.includes(capability)) out.push(capability);
	}
	return out.sort();
};

export type PublicDeviceState = DeviceStateSnapshot & {
	id: string;
	revision: number;
	observedAt: string;
	updatedAt: string;
};

export type PublicDeviceConnector = DeviceConnectorSnapshot & {
	documentId: string;
	revision: number;
	updatedAt: string;
};

export type PublicDevice = {
	id: string;
	name: string;
	platform: DeviceDescriptor['platform'];
	model: string | null;
	osVersion: string | null;
	appVersion: string | null;
	capabilities: string[];
	pairedAt: string;
	online: boolean;
	lastSeenAt: string | null;
	locked: boolean | null;
	volume: number | null;
	brightness: number | null;
	battery: DeviceStateSnapshot['battery'];
	openApps: DeviceStateSnapshot['openApps'];
	state: PublicDeviceState | null;
	connectors: PublicDeviceConnector[];
	pendingCommandCount: number;
	pendingApprovalCount: number;
	permissionMode: DevicePermissionMode;
};

export const publicDeviceState = (doc: any): PublicDeviceState | null => {
	const state = normalizeDeviceState(doc?.crystal?.state);
	const revision = Number(doc?.crystal?.revision);
	if (!state || !Number.isSafeInteger(revision) || revision < 1) return null;
	return {
		id: String(doc.shareId),
		revision,
		...state,
		observedAt: iso(doc.crystal?.observedAt) || new Date(doc.updatedAt).toISOString(),
		updatedAt: new Date(doc.updatedAt).toISOString()
	};
};

export const publicDeviceConnector = (doc: any): PublicDeviceConnector | null => {
	const normalized = normalizeDeviceConnectors([doc?.crystal?.connector]);
	const revision = Number(doc?.crystal?.revision);
	if (!normalized?.[0] || !Number.isSafeInteger(revision) || revision < 1) return null;
	return {
		documentId: String(doc.shareId),
		revision,
		...normalized[0],
		updatedAt: new Date(doc.updatedAt).toISOString()
	};
};

const deviceOwnedBy = async (ownerId: string, deviceId: string, session?: any): Promise<any | null> =>
	(await getHomeThingsCollection()).findOne({ shareId: deviceId, thingtime: 'device', ownerId } as any, session ? { session } : undefined);

export const deviceControlEventScopeKey = (ownerId: string, deviceId: string): string => deviceHash('control-event-scope', ownerId, deviceId);

export const deviceConnectorIsFresh = (connector: any, now = new Date()): boolean => {
	const updatedAt = connector?.updatedAt ? new Date(connector.updatedAt) : null;
	return !!updatedAt && Number.isFinite(updatedAt.getTime()) && updatedAt.getTime() > now.getTime() - DEVICE_CONNECTOR_FRESHNESS_MS;
};

export const pruneDeviceControlEventScope = async (
	things: any,
	ownerId: string,
	deviceId: string,
	scopeField: 'deviceControlEventScopeKey' | 'liveControlEventScopeKey',
	scopeKey: string,
	maxCount: number,
	maxBytes: number,
	session: any
): Promise<number> => {
	// Every control-event append/prune runs in a transaction. Touching the one
	// existing device row gives all event scopes for that device a common write
	// fence, so concurrent snapshots cannot both commit beyond the count/byte
	// budgets. `updatedAt` is an existing fixed-width BSON Date, which keeps this
	// operational fence quota-neutral.
	const locked = await things.updateOne(
		{ shareId: deviceId, thingtime: 'device', ownerId } as any,
		{ $currentDate: { updatedAt: true } },
		{ session }
	);
	if (!locked.matchedCount) throw new Error('Device control-event scope is unavailable');
	const filter: any = {
		thingtime: 'device-command-event',
		ownerId,
		targetId: deviceId,
		[`crystal.${scopeField}`]: scopeKey
	};
	const docs = await things
		.find(filter, { projection: { _id: 1, 'crystal.retainedBytes': 1 }, session })
		.sort({ createdAt: -1, shareId: -1 })
		.limit(maxCount + 256)
		.toArray();
	const keepCount = retainedDeviceControlEventCount(
		docs.map((doc: any) => (Number.isSafeInteger(doc.crystal?.retainedBytes) ? Number(doc.crystal.retainedBytes) : Number.MAX_SAFE_INTEGER)),
		maxCount,
		maxBytes
	);
	if (keepCount === docs.length && docs.length <= maxCount) return 0;
	const keepIds = docs.slice(0, keepCount).map((doc: any) => doc._id);
	const removed = await things.deleteMany({ ...filter, ...(keepIds.length ? { _id: { $nin: keepIds } } : {}) }, { session });
	return Number(removed.deletedCount || 0);
};

export const appendDeviceEvent = async (
	fields: {
		ownerId: string;
		deviceId: string;
		eventType: string;
		resourceId?: string | null;
		revision?: number | null;
		payload?: Record<string, unknown>;
		idempotencyKey: string;
	},
	session: any
): Promise<void> => {
	const things = await getHomeThingsCollection();
	const eventType = typeof fields.eventType === 'string' ? fields.eventType.trim() : '';
	const resourceId = fields.resourceId == null ? null : String(fields.resourceId).trim();
	const revision = fields.revision ?? null;
	const payload = fields.payload ?? {};
	if (!eventType || eventType.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(eventType)) {
		throw new Error('Device control event type is invalid');
	}
	if (resourceId && resourceId.length > 512) throw new Error('Device control event resource is too large');
	if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error('Device control event revision is invalid');
	const retainedBytes = deviceControlEventLogicalBytes({ eventType, resourceId, revision, payload });
	if (retainedBytes > DEVICE_CONTROL_EVENT_MAX_ROW_BYTES) throw new Error('Device control event exceeds its strict byte budget');
	const eventKey = deviceHash('event', fields.ownerId, fields.deviceId, fields.idempotencyKey);
	const scopeKey = deviceControlEventScopeKey(fields.ownerId, fields.deviceId);
	const expiresAt = new Date(Date.now() + DEVICE_CONTROL_EVENT_RETENTION_MS);
	const event = newDeviceThing('device-command-event', {
		ownerId: fields.ownerId,
		targetId: fields.deviceId,
		control: true,
		crystal: {
			deviceEventKey: eventKey,
			deviceControlEventScopeKey: scopeKey,
			retainedBytes,
			eventType,
			resourceId,
			revision,
			payload,
			expiresAt,
			deviceTtlAt: expiresAt
		}
	});
	try {
		await things.insertOne(event, { session });
		await pruneDeviceControlEventScope(
			things,
			fields.ownerId,
			fields.deviceId,
			'deviceControlEventScopeKey',
			scopeKey,
			DEVICE_CONTROL_EVENT_MAX_COUNT,
			DEVICE_CONTROL_EVENT_MAX_BYTES,
			session
		);
	} catch (error: any) {
		if (error?.code !== 11000) throw error;
	}
};

type PrepareDevicePairingInput = {
	op?: unknown;
	pairingSecret?: unknown;
	publicKey?: unknown;
	nonce?: unknown;
};

type CompleteDevicePairingInput = {
	op?: unknown;
	pairingSecret?: unknown;
	credential?: unknown;
	device?: unknown;
	capabilities?: unknown;
	proof?: unknown;
};

type ClaimDeviceInput = PrepareDevicePairingInput | CompleteDevicePairingInput;

type ClaimDeviceResult =
	| DeviceFail
	| { ok: true; op: 'prepare'; proof: { pairingId: string; serverNonce: string; expiresAt: string } }
	| { ok: true; device: PublicDevice; credentialStored: true };

const minimalPublicDevice = (doc: any): PublicDevice => ({
	id: String(doc.shareId),
	name: String(doc.crystal?.name || 'Computer'),
	platform: doc.crystal?.platform === 'windows' || doc.crystal?.platform === 'linux' ? doc.crystal.platform : 'macos',
	model: typeof doc.crystal?.model === 'string' ? doc.crystal.model : null,
	osVersion: typeof doc.crystal?.osVersion === 'string' ? doc.crystal.osVersion : null,
	appVersion: typeof doc.crystal?.appVersion === 'string' ? doc.crystal.appVersion : null,
	capabilities: safeCapabilities(doc.crystal?.capabilities),
	pairedAt: iso(doc.crystal?.pairedAt) || new Date(doc.createdAt).toISOString(),
	online: false,
	lastSeenAt: null,
	locked: null,
	volume: null,
	brightness: null,
	battery: null,
	openApps: [],
	state: null,
	connectors: [],
	pendingCommandCount: 0,
	pendingApprovalCount: 0,
	permissionMode: normalizeDevicePermissionMode(doc.crystal?.permissionMode)
});

const exactObjectKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
	Object.keys(value).every((key) => allowed.includes(key));

const prepareDevicePairingClaim = async (input: PrepareDevicePairingInput): Promise<ClaimDeviceResult> => {
	const raw = input as Record<string, unknown>;
	if (!exactObjectKeys(raw, ['op', 'pairingSecret', 'publicKey', 'nonce'])) {
		return deviceFail(400, 'Pairing prepare contains an unknown field');
	}
	const pairingSecret = normalizePairingSecret(input.pairingSecret);
	const publicKey = normalizeDevicePairingPublicKey(input.publicKey);
	const nonce = normalizeDevicePairingNonce(input.nonce);
	if (!pairingSecret || !publicKey || !nonce) {
		return deviceFail(400, 'prepare requires a valid pairingSecret, 32-byte Ed25519 publicKey and 32-byte nonce');
	}
	const pairing = await findPairingSession(pairingSecret);
	if (!pairing) return deviceFail(404, 'Pairing challenge not found');
	if (pairing.revokedAt || pairing.meta?.consumedAt) return deviceFail(409, 'This pairing challenge was already completed');
	const now = new Date();
	if (pairing.expiresAt && new Date(pairing.expiresAt).getTime() <= now.getTime()) {
		return deviceFail(410, 'Pairing challenge expired');
	}
	const publicKeyHash = devicePairingProofHash('public-key', publicKey);
	const nonceHash = devicePairingProofHash('node-nonce', nonce);
	const bindingHash = devicePayloadHash({ publicKeyHash, nonceHash });
	if (pairing.meta?.claimBindingHash) {
		if (pairing.meta.claimBindingHash !== bindingHash || typeof pairing.meta?.claimServerNonce !== 'string') {
			return deviceFail(409, 'This pairing challenge is already bound to a different native key');
		}
		return {
			ok: true,
			op: 'prepare',
			proof: {
				pairingId: pairing.jti,
				serverNonce: pairing.meta.claimServerNonce,
				expiresAt: new Date(pairing.expiresAt!).toISOString()
			}
		};
	}
	const serverNonce = generateDevicePairingNonce();
	const sessions = await getSessionsCollection();
	const bound = await sessions.updateOne(
		{
			jti: pairing.jti,
			purpose: 'device-pairing',
			revokedAt: null,
			expiresAt: { $gt: now },
			$or: [{ 'meta.claimBindingHash': null }, { 'meta.claimBindingHash': { $exists: false } }]
		},
		{
			$set: {
				'meta.claimBindingHash': bindingHash,
				'meta.claimPublicKeyHash': publicKeyHash,
				'meta.claimNonceHash': nonceHash,
				'meta.claimServerNonce': serverNonce,
				'meta.claimServerNonceHash': devicePairingProofHash('server-nonce', serverNonce),
				'meta.claimPreparedAt': now
			}
		}
	);
	if (!bound.modifiedCount) return prepareDevicePairingClaim(input);
	return {
		ok: true,
		op: 'prepare',
		proof: { pairingId: pairing.jti, serverNonce, expiresAt: new Date(pairing.expiresAt!).toISOString() }
	};
};

const completeDevicePairingClaim = async (input: CompleteDevicePairingInput): Promise<ClaimDeviceResult> => {
	const raw = input as Record<string, unknown>;
	if (!exactObjectKeys(raw, ['op', 'pairingSecret', 'credential', 'device', 'capabilities', 'proof'])) {
		return deviceFail(400, 'Pairing complete contains an unknown field');
	}
	const pairingSecret = normalizePairingSecret(input.pairingSecret);
	const credential = normalizeDeviceCredential(input.credential);
	const descriptor = normalizeDeviceDescriptor(input.device);
	const capabilities = normalizeCapabilities(input.capabilities);
	const proofRaw = input.proof && typeof input.proof === 'object' && !Array.isArray(input.proof) ? (input.proof as Record<string, unknown>) : null;
	if (!pairingSecret) return deviceFail(400, 'A valid pairingSecret is required');
	if (!credential) return deviceFail(400, 'credential must be a locally generated ttnode_ token with at least 256 bits of randomness');
	if (!descriptor) return deviceFail(400, 'A valid device name and platform are required');
	if (!capabilities) return deviceFail(400, 'capabilities must be a bounded list of identifiers');
	if (!proofRaw || !exactObjectKeys(proofRaw, ['pairingId', 'publicKey', 'nonce', 'serverNonce', 'signature'])) {
		return deviceFail(400, 'complete requires an exact proof envelope');
	}
	const pairingId = typeof proofRaw.pairingId === 'string' ? proofRaw.pairingId : '';
	const publicKey = normalizeDevicePairingPublicKey(proofRaw.publicKey);
	const nonce = normalizeDevicePairingNonce(proofRaw.nonce);
	const serverNonce = normalizeDevicePairingNonce(proofRaw.serverNonce);
	const signature = normalizeDevicePairingSignature(proofRaw.signature);
	if (!pairingId || !publicKey || !nonce || !serverNonce || !signature) {
		return deviceFail(400, 'Pairing proof fields are invalid');
	}

	const pairing = await findPairingSession(pairingSecret);
	if (!pairing) return deviceFail(404, 'Pairing challenge not found');
	const publicKeyHash = devicePairingProofHash('public-key', publicKey);
	const nonceHash = devicePairingProofHash('node-nonce', nonce);
	const bindingHash = devicePayloadHash({ publicKeyHash, nonceHash });
	if (
		pairing.jti !== pairingId ||
		pairing.meta?.claimBindingHash !== bindingHash ||
		pairing.meta?.claimPublicKeyHash !== publicKeyHash ||
		pairing.meta?.claimNonceHash !== nonceHash ||
		pairing.meta?.claimServerNonceHash !== devicePairingProofHash('server-nonce', serverNonce)
	) {
		return deviceFail(409, 'Pairing proof does not match the prepared native challenge');
	}
	if (
		!verifyDevicePairingClaim(
			{
				pairingId,
				pairingSecret,
				credential,
				publicKey,
				nonce,
				serverNonce,
				device: descriptor,
				capabilities
			},
			signature
		)
	) {
		return deviceFail(401, 'Pairing claim signature is invalid');
	}
	const credentialHash = deviceCredentialHash(credential);
	const claimHash = devicePayloadHash({
		descriptor,
		capabilities,
		credentialHash,
		bindingHash,
		serverNonceHash: devicePairingProofHash('server-nonce', serverNonce),
		signatureHash: devicePairingProofHash('signature', signature)
	});

	// A response may disappear after the transaction commits. The node can send
	// the same locally-generated credential + claim again and recover without a
	// second device row or a second quota charge.
	if (pairing.revokedAt || pairing.meta?.consumedAt) {
		if (pairing.meta?.claimHash !== claimHash || typeof pairing.meta?.deviceId !== 'string') {
			return deviceFail(409, 'This pairing challenge was already claimed with different device data');
		}
		const sessions = await getSessionsCollection();
		const deviceSession = await sessions.findOne({
			purpose: 'device',
			userId: pairing.userId,
			'meta.deviceId': pairing.meta.deviceId,
			'meta.deviceCredentialHash': credentialHash,
			revokedAt: null
		});
		const existing = deviceSession ? await deviceOwnedBy(String(pairing.userId), String(pairing.meta.deviceId)) : null;
		return existing
			? { ok: true, device: minimalPublicDevice(existing), credentialStored: true }
			: deviceFail(409, 'The prior pairing claim is no longer active');
	}
	if (pairing.expiresAt && new Date(pairing.expiresAt).getTime() <= Date.now()) {
		return deviceFail(410, 'Pairing challenge expired');
	}

	const deviceId = randomUUID();
	const ownerId = String(pairing.userId);
	const now = new Date();
	const device = newDeviceThing('device', {
		shareId: deviceId,
		ownerId,
		crystal: {
			deviceKey: deviceHash('device', ownerId, deviceId),
			...descriptor,
			capabilities,
			permissionMode: 'always-allow',
			pairedAt: now
		}
	});

	try {
		await withHomeMongoTransaction(async (session) => {
			const sessions = await getSessionsCollection();
			const consumed = await sessions.updateOne(
				{
					jti: pairing.jti,
					purpose: 'device-pairing',
					revokedAt: null,
					expiresAt: { $gt: now }
				},
				{
					$set: {
						revokedAt: now,
						'meta.consumedAt': now,
						'meta.claimHash': claimHash,
						'meta.deviceId': deviceId
					}
				},
				{ session }
			);
			if (!consumed.modifiedCount) throw Object.assign(new Error('pairing_claim_race'), { status: 409 });
			await insertAccountedThing(await getHomeThingsCollection(), device, {
				...HOME_ACCOUNTING,
				session
			});
			await createSession(ownerId, {
				purpose: 'device',
				expiresAt: new Date(now.getTime() + DEVICE_SESSION_LIFETIME_MS),
				session,
				meta: {
					deviceId,
					deviceCredentialHash: credentialHash,
					pairingPublicKeyHash: publicKeyHash,
					capabilities,
					lastSeenAt: now,
					createdVia: 'device-pairing'
				}
			});
			await appendDeviceEvent(
				{
					ownerId,
					deviceId,
					eventType: 'device.paired',
					resourceId: deviceId,
					payload: { name: descriptor.name, platform: descriptor.platform },
					idempotencyKey: `paired:${pairing.jti}`
				},
				session
			);
		});
	} catch (error: any) {
		if (error?.status === 409 || error?.message === 'pairing_claim_race') {
			return completeDevicePairingClaim(input);
		}
		throw error;
	}

	return { ok: true, device: minimalPublicDevice(device), credentialStored: true };
};

export const setDevicePermissionMode = async (
	ownerId: string,
	input: { deviceId?: unknown; mode?: unknown }
): Promise<DeviceFail | { ok: true; deviceId: string; mode: DevicePermissionMode }> => {
	const deviceId = typeof input?.deviceId === 'string' ? input.deviceId.trim().slice(0, 160) : '';
	if (!deviceId) return deviceFail(400, 'deviceId is required');
	if (!(DEVICE_PERMISSION_MODES as readonly unknown[]).includes(input?.mode)) {
		return deviceFail(400, 'mode must be always-allow, ask-every-time or deny');
	}
	const mode = input.mode as DevicePermissionMode;
	const things = await getHomeThingsCollection();
	const now = new Date();
	const result = await updateAccountedThing(
		things,
		{ shareId: deviceId, thingtime: 'device', ownerId } as any,
		{ $set: { 'crystal.permissionMode': mode, updatedAt: now } },
		HOME_ACCOUNTING
	);
	if (!result.modifiedCount) return deviceFail(404, 'Device not found');
	return { ok: true, deviceId, mode };
};

export const claimDevicePairing = async (input: ClaimDeviceInput): Promise<ClaimDeviceResult> => {
	if (!input || typeof input !== 'object') return deviceFail(400, 'A pairing operation is required');
	if (input.op === 'prepare') return prepareDevicePairingClaim(input);
	if (input.op === 'complete') return completeDevicePairingClaim(input);
	return deviceFail(400, 'Pairing claim op must be prepare or complete; legacy unproved claims are rejected');
};

export const listDevices = async (
	ownerId: string,
	requestedDeviceId?: unknown
): Promise<DeviceFail | { ok: true; devices: PublicDevice[]; device?: PublicDevice }> => {
	const deviceId = typeof requestedDeviceId === 'string' ? requestedDeviceId.trim() : '';
	const things = await getHomeThingsCollection();
	const deviceFilter: any = { thingtime: 'device', ownerId };
	if (deviceId) deviceFilter.shareId = deviceId;
	const docs = await things.find(deviceFilter).sort({ updatedAt: -1, shareId: 1 }).limit(MAX_DEVICES_PER_USER).toArray();
	if (deviceId && !docs.length) return deviceFail(404, 'Device not found');
	const ids = docs.map((doc: any) => String(doc.shareId));
	if (!ids.length) return { ok: true, devices: [] };

	const sessions = await getSessionsCollection();
	const [states, connectors, commands, approvals, liveSessions] = await Promise.all([
		things.find({ thingtime: 'device-state', ownerId, targetId: { $in: ids } } as any).toArray(),
		things
			.find({ thingtime: 'device-connector', ownerId, targetId: { $in: ids } } as any)
			.sort({ updatedAt: -1 })
			.toArray(),
		things
			.find(
				{
					thingtime: 'device-command',
					ownerId,
					targetId: { $in: ids },
					'crystal.status': { $in: ['queued', 'claimed', 'running', 'needs-approval'] }
				} as any,
				{ projection: { targetId: 1 } }
			)
			.toArray(),
		things
			.find(
				{
					thingtime: 'device-approval',
					ownerId,
					targetId: { $in: ids },
					'crystal.status': 'pending',
					'crystal.expiresAt': { $gt: new Date() }
				} as any,
				{ projection: { targetId: 1 } }
			)
			.toArray(),
		sessions
			.find(
				{ purpose: 'device', userId: ownerId, 'meta.deviceId': { $in: ids }, revokedAt: null },
				{
					projection: { 'meta.deviceId': 1, 'meta.lastSeenAt': 1, expiresAt: 1 }
				}
			)
			.toArray()
	]);

	const stateByDevice = new Map(states.map((doc: any) => [String(doc.targetId), doc]));
	const connectorsByDevice = new Map<string, PublicDeviceConnector[]>();
	for (const doc of connectors as any[]) {
		const connector = publicDeviceConnector(doc);
		if (!connector) continue;
		const key = String(doc.targetId);
		const bucket = connectorsByDevice.get(key) ?? [];
		bucket.push(connector);
		connectorsByDevice.set(key, bucket);
	}
	const commandCounts = new Map<string, number>();
	for (const doc of commands as any[]) commandCounts.set(String(doc.targetId), (commandCounts.get(String(doc.targetId)) ?? 0) + 1);
	const approvalCounts = new Map<string, number>();
	for (const doc of approvals as any[]) approvalCounts.set(String(doc.targetId), (approvalCounts.get(String(doc.targetId)) ?? 0) + 1);
	const lastSeenByDevice = new Map<string, Date>();
	for (const session of liveSessions as any[]) {
		if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) continue;
		const id = typeof session.meta?.deviceId === 'string' ? session.meta.deviceId : '';
		const lastSeenAt = session.meta?.lastSeenAt ? new Date(session.meta.lastSeenAt) : null;
		if (!id || !lastSeenAt || !Number.isFinite(lastSeenAt.getTime())) continue;
		const previous = lastSeenByDevice.get(id);
		if (!previous || previous < lastSeenAt) lastSeenByDevice.set(id, lastSeenAt);
	}

	const publicDevices = docs.map((doc: any) => {
		const base = minimalPublicDevice(doc);
		const state = publicDeviceState(stateByDevice.get(base.id));
		const lastSeenAt = lastSeenByDevice.get(base.id) ?? null;
		return {
			...base,
			online: !!lastSeenAt && Date.now() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS,
			lastSeenAt: lastSeenAt?.toISOString() ?? null,
			locked: state?.locked ?? null,
			volume: state?.volume ?? null,
			brightness: state?.brightness ?? null,
			battery: state?.battery ?? null,
			openApps: state?.openApps ?? [],
			state,
			connectors: connectorsByDevice.get(base.id) ?? [],
			pendingCommandCount: commandCounts.get(base.id) ?? 0,
			pendingApprovalCount: approvalCounts.get(base.id) ?? 0
		};
	});
	return deviceId ? { ok: true, devices: publicDevices, device: publicDevices[0] } : { ok: true, devices: publicDevices };
};

type UpdateDeviceStateInput = {
	revision?: unknown;
	state?: unknown;
	connectors?: unknown;
};

export const updateDeviceState = async (
	ownerId: string,
	deviceId: string,
	input: UpdateDeviceStateInput
): Promise<DeviceFail | { ok: true; revision: number; applied: boolean; stale: boolean }> => {
	const revision = Number(input?.revision);
	if (!Number.isSafeInteger(revision) || revision < 1) return deviceFail(400, 'revision must be a positive safe integer');
	const state = normalizeDeviceState(input?.state);
	if (!state) return deviceFail(400, 'state is invalid or exceeds its bounds');
	if (!Array.isArray(input?.connectors)) return deviceFail(400, 'connectors must be a complete bounded snapshot');
	const connectors = normalizeDeviceConnectors(input.connectors);
	if (!connectors) return deviceFail(400, 'connectors are invalid or exceed their bounds');
	if (!(await deviceOwnedBy(ownerId, deviceId))) return deviceFail(404, 'Device not found');

	const things = await getHomeThingsCollection();
	const stateKey = deviceHash('state', ownerId, deviceId);
	const connectorKeys = connectors.map((connector) => deviceHash('connector', ownerId, deviceId, connector.id));
	const [existingState, existingConnectors] = await Promise.all([
		things.findOne(thingUniqueKeyFilter('deviceUniqueKey', stateKey) as any),
		things.find({ thingtime: 'device-connector', ownerId, targetId: deviceId } as any).toArray()
	]);
	const stateHash = devicePayloadHash(state);
	const snapshotHash = deviceSnapshotHash(state, connectors);
	const stateDecision = decideDeviceRevision(
		Number.isSafeInteger(existingState?.crystal?.revision) ? Number(existingState.crystal.revision) : null,
		typeof existingState?.crystal?.snapshotHash === 'string' ? existingState.crystal.snapshotHash : null,
		revision,
		snapshotHash
	);
	if (stateDecision === 'conflict') {
		return deviceFail(409, 'The same complete device snapshot revision was already used for different content');
	}
	if (stateDecision === 'stale') return { ok: true, revision, applied: false, stale: true };
	if (stateDecision === 'same') return { ok: true, revision, applied: false, stale: false };

	const existingConnectorByKey = new Map((existingConnectors as any[]).map((doc) => [String(doc.crystal?.deviceConnectorKey), doc]));
	const connectorEntries = connectors.map((connector, index) => {
		const key = connectorKeys[index];
		return {
			connector,
			key,
			hash: devicePayloadHash(connector),
			existing: existingConnectorByKey.get(key)
		};
	});

	const now = new Date();
	try {
		await withHomeMongoTransaction(async (session) => {
			if (stateDecision === 'insert') {
				await insertAccountedThing(
					things,
					newDeviceThing('device-state', {
						ownerId,
						targetId: deviceId,
						crystal: { deviceStateKey: stateKey, revision, stateHash, snapshotHash, state, observedAt: now }
					}),
					{ ...HOME_ACCOUNTING, session }
				);
			} else if (stateDecision === 'update') {
				const updated = await updateAccountedThing(
					things,
					{
						_id: existingState._id,
						'crystal.revision': existingState.crystal.revision,
						...(typeof existingState.crystal?.snapshotHash === 'string'
							? { 'crystal.snapshotHash': existingState.crystal.snapshotHash }
							: { 'crystal.snapshotHash': { $exists: false } })
					} as any,
					{
						$set: {
							'crystal.revision': revision,
							'crystal.stateHash': stateHash,
							'crystal.snapshotHash': snapshotHash,
							'crystal.state': state,
							'crystal.observedAt': now,
							updatedAt: now
						}
					},
					{ ...HOME_ACCOUNTING, session }
				);
				if (!updated.modifiedCount) throw Object.assign(new Error('device_snapshot_race'), { status: 409 });
			}
			await deleteAccountedThings(
				things,
				{
					thingtime: 'device-connector',
					ownerId,
					targetId: deviceId,
					'crystal.deviceConnectorKey': { $nin: connectorKeys }
				} as any,
				{ ...HOME_ACCOUNTING, session }
			);
			for (const entry of connectorEntries) {
				if (!entry.existing) {
					await insertAccountedThing(
						things,
						newDeviceThing('device-connector', {
							ownerId,
							targetId: deviceId,
							crystal: {
								deviceConnectorKey: entry.key,
								revision,
								connectorHash: entry.hash,
								connector: entry.connector
							}
						}),
						{ ...HOME_ACCOUNTING, session }
					);
				} else {
					await updateAccountedThing(
						things,
						{ _id: entry.existing._id } as any,
						{ $set: { 'crystal.revision': revision, 'crystal.connectorHash': entry.hash, 'crystal.connector': entry.connector, updatedAt: now } },
						{ ...HOME_ACCOUNTING, session }
					);
				}
			}
			await appendDeviceEvent(
				{
					ownerId,
					deviceId,
					eventType: 'device.state',
					resourceId: existingState?.shareId ? String(existingState.shareId) : deviceId,
					revision,
					payload: { connectorIds: connectors.map((connector) => connector.id) },
					idempotencyKey: `state:${revision}:${snapshotHash}`
				},
				session
			);
		});
	} catch (error: any) {
		if (error?.code === 11000 || error?.status === 409 || error?.message === 'device_snapshot_race') {
			return updateDeviceState(ownerId, deviceId, input);
		}
		throw error;
	}
	return { ok: true, revision, applied: true, stale: false };
};

export type PublicDeviceEvent = {
	cursor: string;
	id: string;
	type: string;
	deviceId: string;
	resourceId: string | null;
	revision: number | null;
	at: string;
	payload: Record<string, unknown>;
};

const publicEvent = (doc: any): PublicDeviceEvent => ({
	cursor: encodeDeviceEventCursor({ at: new Date(doc.createdAt), id: String(doc.shareId) }),
	id: String(doc.shareId),
	type: typeof doc.crystal?.eventType === 'string' ? doc.crystal.eventType : 'device.event',
	deviceId: String(doc.targetId),
	resourceId: typeof doc.crystal?.resourceId === 'string' ? doc.crystal.resourceId : null,
	revision: Number.isSafeInteger(doc.crystal?.revision) ? Number(doc.crystal.revision) : null,
	at: new Date(doc.createdAt).toISOString(),
	payload: doc.crystal?.payload && typeof doc.crystal.payload === 'object' ? doc.crystal.payload : {}
});

export const listDeviceEvents = async (
	ownerId: string,
	deviceId: unknown,
	cursorValue: unknown,
	limitValue: unknown
): Promise<DeviceFail | { ok: true; events: PublicDeviceEvent[]; nextCursor: string | null }> => {
	const id = typeof deviceId === 'string' ? deviceId.trim() : '';
	if (!id) return deviceFail(400, 'deviceId is required');
	if (!(await deviceOwnedBy(ownerId, id))) return deviceFail(404, 'Device not found');
	const cursor = cursorValue ? decodeDeviceEventCursor(cursorValue) : null;
	if (cursorValue && !cursor) return deviceFail(400, 'cursor is invalid');
	const requestedLimit = Number(limitValue);
	const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.floor(requestedLimit))) : 100;
	// Every device-command-event is stamped with this deterministic scope key.
	// Supplying it here lets pagination reuse the retention index (Mongo can
	// reverse-scan its createdAt/shareId suffix), avoiding a second index over
	// the same event partition and preserving MongoDB upgrade headroom.
	const filter: any = {
		thingtime: 'device-command-event',
		ownerId,
		targetId: id,
		'crystal.deviceControlEventScopeKey': deviceControlEventScopeKey(ownerId, id)
	};
	if (cursor) {
		filter.$or = [{ createdAt: { $gt: cursor.at } }, { createdAt: cursor.at, shareId: { $gt: cursor.id } }];
	}
	const docs = await (await getHomeThingsCollection()).find(filter).sort({ createdAt: 1, shareId: 1 }).limit(limit).toArray();
	const events = docs.map(publicEvent);
	return { ok: true, events, nextCursor: events.at(-1)?.cursor ?? (typeof cursorValue === 'string' ? cursorValue : null) };
};

export const deviceExistsForOwner = deviceOwnedBy;
export type { SessionDoc };
