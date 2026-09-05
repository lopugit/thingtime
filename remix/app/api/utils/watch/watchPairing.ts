import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';

import { createSession } from '../auth/sessions';
import { findUserById, toPublicUserWithStorage, type PublicUser } from '../auth/users';
import {
	DEVICE_SESSION_LIFETIME_MS,
	deviceCredentialHash,
	normalizeDeviceCredential,
	resolveDeviceActor,
	type DeviceActor
} from '../devices/deviceAuth';
import { deviceHash, normalizeDeviceDescriptor, type DeviceDescriptor } from '../devices/deviceCore';
import { newDeviceThing } from '../devices/devices';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { insertAccountedThing } from '../storage/accountedThings';

const WATCH_PAIRING_LIFETIME_MS = 10 * 60 * 1000;
const WATCH_PAIRING_PENDING_USER = 'watch-pairing:pending';
const WATCH_USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WATCH_USER_CODE_CHARS = 8;
const WATCH_CAPABILITIES = ['watch.notifications.read', 'watch.notifications.write', 'watch.things.create', 'watch.push'] as const;
const HOME_ACCOUNTING = { accountedPlane: 'home' as const };

const hash = (namespace: string, value: string): string =>
	createHash('sha256').update(`thingtime-watch:${namespace}:v1\0`).update(value).digest('hex');

// randomInt rejection-samples, so every alphabet position stays equally
// likely whatever the alphabet length is. `byte % length` was only unbiased
// here because the alphabet happens to be exactly 32 long — adding or
// dropping a single character would have silently skewed the code the user
// reads off their Watch. Matches crypto/passwordHasher.server.ts.
const randomWatchCode = (): string => {
	let code = '';
	for (let index = 0; index < WATCH_USER_CODE_CHARS; index++) {
		code += WATCH_USER_CODE_ALPHABET[randomInt(WATCH_USER_CODE_ALPHABET.length)];
	}
	return code;
};

const normalizeUserCode = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
	return code.length === WATCH_USER_CODE_CHARS ? code : null;
};

const normalizePairingId = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value.trim()) return null;
	return value.trim().slice(0, 160);
};

const normalizeDeviceCode = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const code = value.trim();
	return /^ttwatch_[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
};

export type WatchAccountProfile = Pick<PublicUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>;

export type WatchPairingStart = {
	pairingId: string;
	deviceCode: string;
	userCode: string;
	expiresAt: string;
	verificationPath: string;
};

type Failure = { ok: false; status: number; error: string; code?: string };

export const startWatchPairing = async (input: unknown): Promise<{ ok: true; pairing: WatchPairingStart } | Failure> => {
	const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
	const descriptor = normalizeDeviceDescriptor(raw.device);
	if (!descriptor || descriptor.platform !== 'watchos') {
		return { ok: false, status: 400, error: 'A valid Apple Watch descriptor is required' };
	}

	const deviceCode = `ttwatch_${randomBytes(32).toString('base64url')}`;
	const userCode = randomWatchCode();
	const expiresAt = new Date(Date.now() + WATCH_PAIRING_LIFETIME_MS);
	const session = await createSession(WATCH_PAIRING_PENDING_USER, {
		purpose: 'watch-pairing',
		expiresAt,
		meta: {
			deviceCodeHash: hash('device-code', deviceCode),
			userCodeHash: hash('user-code', userCode),
			descriptor,
			capabilities: [...WATCH_CAPABILITIES],
			approvedAt: null,
			consumedAt: null,
			deviceId: null,
			credentialHash: null
		}
	});

	return {
		ok: true,
		pairing: {
			pairingId: session.jti,
			deviceCode,
			userCode,
			expiresAt: expiresAt.toISOString(),
			verificationPath: `/watch/pair?pairing=${encodeURIComponent(session.jti)}&code=${encodeURIComponent(userCode)}`
		}
	};
};

export const inspectWatchPairing = async (
	pairingIdValue: unknown,
	userCodeValue: unknown
): Promise<{ ok: true; device: DeviceDescriptor; expiresAt: string; approved: boolean } | Failure> => {
	const pairingId = normalizePairingId(pairingIdValue);
	const userCode = normalizeUserCode(userCodeValue);
	if (!pairingId || !userCode) return { ok: false, status: 400, error: 'Pairing link is invalid' };
	const session = await (await getSessionsCollection()).findOne({
		jti: pairingId,
		purpose: 'watch-pairing',
		'meta.userCodeHash': hash('user-code', userCode)
	});
	if (!session) return { ok: false, status: 404, error: 'Pairing link was not found' };
	if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
		return { ok: false, status: 410, error: 'Pairing link expired' };
	}
	const descriptor = normalizeDeviceDescriptor(session.meta?.descriptor);
	if (!descriptor || descriptor.platform !== 'watchos') return { ok: false, status: 409, error: 'Pairing details are invalid' };
	return {
		ok: true,
		device: descriptor,
		expiresAt: new Date(session.expiresAt).toISOString(),
		approved: !!session.meta?.approvedAt
	};
};

export const approveWatchPairing = async (
	userId: string,
	input: unknown
): Promise<{ ok: true; approved: true; device: DeviceDescriptor } | Failure> => {
	const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
	const pairingId = normalizePairingId(raw.pairingId);
	const userCode = normalizeUserCode(raw.userCode);
	if (!pairingId || !userCode) return { ok: false, status: 400, error: 'Pairing code is invalid' };
	const sessions = await getSessionsCollection();
	const now = new Date();
	const session = await sessions.findOne({
		jti: pairingId,
		purpose: 'watch-pairing',
		'meta.userCodeHash': hash('user-code', userCode)
	});
	if (!session) return { ok: false, status: 404, error: 'Pairing code was not found' };
	if (!session.expiresAt || new Date(session.expiresAt).getTime() <= now.getTime()) {
		return { ok: false, status: 410, error: 'Pairing code expired' };
	}
	if (session.meta?.consumedAt) return { ok: false, status: 409, error: 'This Watch is already paired' };
	if (session.meta?.approvedAt && String(session.userId) !== userId) {
		return { ok: false, status: 409, error: 'This pairing was approved for a different account' };
	}
	const descriptor = normalizeDeviceDescriptor(session.meta?.descriptor);
	if (!descriptor || descriptor.platform !== 'watchos') return { ok: false, status: 409, error: 'Pairing details are invalid' };
	const approved = await sessions.updateOne(
		{
			jti: pairingId,
			purpose: 'watch-pairing',
			userId: { $in: [WATCH_PAIRING_PENDING_USER, userId] },
			'meta.consumedAt': null,
			expiresAt: { $gt: now }
		},
		{ $set: { userId, 'meta.approvedAt': now } }
	);
	if (!approved.modifiedCount) return { ok: false, status: 409, error: 'This pairing was approved for a different account' };
	return { ok: true, approved: true, device: descriptor };
};

export const claimWatchPairing = async (
	input: unknown
): Promise<{ ok: true; credentialStored: true; device: { id: string; name: string }; user: WatchAccountProfile } | Failure> => {
	const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
	const pairingId = normalizePairingId(raw.pairingId);
	const deviceCode = normalizeDeviceCode(raw.deviceCode);
	const credential = normalizeDeviceCredential(raw.credential);
	if (!pairingId || !deviceCode || !credential) {
		return { ok: false, status: 400, error: 'Pairing claim is invalid' };
	}
	const sessions = await getSessionsCollection();
	const session = await sessions.findOne({
		jti: pairingId,
		purpose: 'watch-pairing',
		'meta.deviceCodeHash': hash('device-code', deviceCode)
	});
	if (!session) return { ok: false, status: 404, error: 'Pairing request was not found' };
	const ownerId = String(session.userId);
	const credentialHash = deviceCredentialHash(credential);
	if (session.meta?.consumedAt) {
		if (session.meta?.credentialHash !== credentialHash || typeof session.meta?.deviceId !== 'string') {
			return { ok: false, status: 409, error: 'This pairing request was already claimed' };
		}
		const [device, userDoc] = await Promise.all([
			(await getHomeThingsCollection()).findOne({ shareId: session.meta.deviceId, thingtime: 'device', ownerId } as any),
			findUserById(ownerId)
		]);
		if (!device || !userDoc) return { ok: false, status: 409, error: 'The paired Watch account is no longer available' };
		const user = await toPublicUserWithStorage(userDoc);
		return {
			ok: true,
			credentialStored: true,
			device: { id: String(device.shareId), name: String(device.crystal?.name || 'Apple Watch') },
			user: { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
		};
	}
	if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
		return { ok: false, status: 410, error: 'Pairing request expired' };
	}
	if (!session.meta?.approvedAt || session.userId === WATCH_PAIRING_PENDING_USER) {
		return { ok: false, status: 428, error: 'Approve this Watch in Thingtime first', code: 'authorization_pending' };
	}

	const descriptor = normalizeDeviceDescriptor(session.meta?.descriptor);
	if (!descriptor || descriptor.platform !== 'watchos') return { ok: false, status: 409, error: 'Pairing details are invalid' };
	const capabilities = [...WATCH_CAPABILITIES];
	const deviceId = randomUUID();
	const now = new Date();
	const deviceThing = newDeviceThing('device', {
		shareId: deviceId,
		ownerId,
		crystal: {
			deviceKey: deviceHash('device', ownerId, deviceId),
			...descriptor,
			deviceKind: 'apple-watch',
			capabilities,
			permissionMode: 'always-allow',
			pairedAt: now
		}
	});

	try {
		await withHomeMongoTransaction(async (mongoSession) => {
			const consumed = await sessions.updateOne(
				{
					jti: pairingId,
					purpose: 'watch-pairing',
					'meta.deviceCodeHash': hash('device-code', deviceCode),
					'meta.consumedAt': null,
					expiresAt: { $gt: now }
				},
				{
					$set: {
						revokedAt: now,
						'meta.consumedAt': now,
						'meta.deviceId': deviceId,
						'meta.credentialHash': credentialHash
					}
				},
				{ session: mongoSession }
			);
			if (!consumed.modifiedCount) throw Object.assign(new Error('watch_pairing_race'), { status: 409 });
			await insertAccountedThing(await getHomeThingsCollection(), deviceThing, { ...HOME_ACCOUNTING, session: mongoSession });
			await createSession(ownerId, {
				purpose: 'device',
				expiresAt: new Date(now.getTime() + DEVICE_SESSION_LIFETIME_MS),
				session: mongoSession,
				meta: {
					deviceId,
					deviceCredentialHash: credentialHash,
					capabilities,
					lastSeenAt: now,
					lastSyncAt: null,
					lastSyncStatus: 'paired',
					createdVia: 'watch-pairing'
				}
			});
		});
	} catch (error: any) {
		if (error?.status === 409 || error?.message === 'watch_pairing_race') return claimWatchPairing(input);
		throw error;
	}

	const userDoc = await findUserById(ownerId);
	if (!userDoc) return { ok: false, status: 409, error: 'The approved account no longer exists' };
	const user = await toPublicUserWithStorage(userDoc);
	return {
		ok: true,
		credentialStored: true,
		device: { id: deviceId, name: descriptor.name },
		user: { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
	};
};

export type WatchDeviceContext = { actor: DeviceActor; user: PublicUser };

export const resolveWatchDevice = async (request: Request, capability: (typeof WATCH_CAPABILITIES)[number]): Promise<WatchDeviceContext | null> => {
	const actor = await resolveDeviceActor(request);
	if (!actor || !actor.capabilities.includes(capability)) return null;
	const userDoc = await findUserById(actor.userId);
	if (!userDoc) return null;
	const user = await toPublicUserWithStorage(userDoc);
	if (user.accountKind !== 'user') return null;
	return { actor, user };
};

export const recordWatchSync = async (
	actor: DeviceActor,
	input: { status: 'healthy' | 'error'; batteryLevel?: number | null; lowPowerMode?: boolean | null; error?: string | null }
): Promise<void> => {
	const now = new Date();
	const batteryLevel = typeof input.batteryLevel === 'number' && Number.isFinite(input.batteryLevel)
		? Math.max(0, Math.min(1, input.batteryLevel))
		: null;
	await (await getSessionsCollection()).updateOne(
		{ jti: actor.sessionId, purpose: 'device', userId: actor.userId, 'meta.deviceId': actor.deviceId, revokedAt: null },
		{
			$set: {
				'meta.lastSeenAt': now,
				'meta.lastSyncAt': now,
				'meta.lastSyncStatus': input.status,
				'meta.watchHealth': {
					batteryLevel,
					lowPowerMode: input.lowPowerMode === true,
					...(input.error ? { error: String(input.error).slice(0, 200) } : {}),
					updatedAt: now
				}
			}
		}
	);
};
