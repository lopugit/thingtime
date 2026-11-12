import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';

import { createSession } from '../auth/sessions';
import { findUserById, findUserByUsername, toPublicUser, toPublicUserWithStorage, type PublicUser } from '../auth/users';
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

const WATCH_PAIRING_LIFETIME_MS = 5 * 60 * 1000;
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
	return /^\d{4}$/.test(code) || /^[A-Z0-9]{8}$/.test(code) ? code : null;
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
	verificationEntryPath: string;
	approvalToken: string;
};

type Failure = { ok: false; status: number; error: string; code?: string };

export const startWatchPairing = async (input: unknown): Promise<{ ok: true; pairing: WatchPairingStart } | Failure> => {
	const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
	const descriptor = normalizeDeviceDescriptor(raw.device);
	if (!descriptor || descriptor.platform !== 'watchos') {
		return { ok: false, status: 400, error: 'A valid Apple Watch descriptor is required' };
	}

	const deviceCode = `ttwatch_${randomBytes(32).toString('base64url')}`;
	const numeric = raw.codeFormat === 'numeric-4';
	if (raw.codeFormat != null && raw.codeFormat !== 'numeric-4') return { ok: false, status: 400, error: 'Unsupported Watch code format' };
	const targetUsername = typeof raw.targetUsername === 'string' ? raw.targetUsername.trim().replace(/^@/, '').toLowerCase().slice(0, 80) : '';
	const targetDoc = targetUsername ? await findUserByUsername(targetUsername) : null;
	const target = targetDoc ? toPublicUser(targetDoc) : null;
	const recipientUserId = target?.accountKind === 'user' ? target.id : null;
	if (targetUsername && !recipientUserId) {
		return {
			ok: false,
			status: 400,
			error: 'That username could not receive a Watch request. Check the spelling and selected Thingtime domain, or use the paired iPhone or a code.'
		};
	}
	const approvalToken = `ttapprove_${randomBytes(32).toString('base64url')}`;
	const expiresAt = new Date(Date.now() + WATCH_PAIRING_LIFETIME_MS);
	const sessions = await getSessionsCollection();
	// Release expired PIN reservations. The partial unique index prevents two
	// concurrent starts from assigning the same active four-digit code.
	await sessions.updateMany(
		{ purpose: 'watch-pairing', 'meta.shortCodeActive': true, expiresAt: { $lte: new Date() } },
		{ $set: { 'meta.shortCodeActive': false } }
	);
	for (let attempt = 0; attempt < 8; attempt++) {
		const userCode = numeric ? String(randomInt(10_000)).padStart(4, '0') : randomWatchCode();
		let session;
		try {
			session = await createSession(WATCH_PAIRING_PENDING_USER, {
				purpose: 'watch-pairing',
				expiresAt,
				meta: {
					deviceCodeHash: hash('device-code', deviceCode),
					userCodeHash: hash('user-code', userCode),
					approvalTokenHash: hash('approval-token', approvalToken),
					shortCodeActive: numeric,
					recipientUserId,
					offeredUserCode: recipientUserId ? userCode : null,
					descriptor,
					capabilities: [...WATCH_CAPABILITIES],
					approvedAt: null,
					consumedAt: null,
					deviceId: null,
					credentialHash: null
				}
			});
		} catch (error: any) {
			if (numeric && error?.code === 11000) continue;
			throw error;
		}

		return {
			ok: true,
			pairing: {
				pairingId: session.jti,
				deviceCode,
				userCode,
				approvalToken,
				expiresAt: expiresAt.toISOString(),
				verificationEntryPath: '/watch/pair',
				verificationPath: `/watch/pair?pairing=${encodeURIComponent(session.jti)}&code=${encodeURIComponent(userCode)}`
			}
		};
	}
	return { ok: false, status: 503, error: 'Short codes are busy. Please create a new code in a moment.' };
};

/** A paired phone can offer a request, but cannot approve it. The independent
 * 256-bit handoff token prevents PIN guessing from assigning someone else's
 * request to an account. No device credential leaves the Watch. */
export const offerWatchPairing = async (userId: string, input: any) => {
	const pairingId = normalizePairingId(input?.pairingId);
	const userCode = normalizeUserCode(input?.userCode);
	const token = typeof input?.approvalToken === 'string' ? input.approvalToken : '';
	if (!pairingId || !userCode || !/^ttapprove_[A-Za-z0-9_-]{43}$/.test(token))
		return { ok: false as const, status: 400, error: 'Invalid Watch approval handoff' };
	const result = await (
		await getSessionsCollection()
	).updateOne(
		{
			jti: pairingId,
			purpose: 'watch-pairing',
			revokedAt: null,
			'meta.userCodeHash': hash('user-code', userCode),
			'meta.approvalTokenHash': hash('approval-token', token),
			'meta.recipientUserId': { $in: [null, userId] },
			userId: { $in: [WATCH_PAIRING_PENDING_USER, userId] },
			'meta.consumedAt': null,
			expiresAt: { $gt: new Date() }
		},
		{ $set: { 'meta.recipientUserId': userId, 'meta.offeredUserCode': userCode } }
	);
	if (!result.matchedCount) return { ok: false as const, status: 404, error: 'This Watch request expired or belongs to another account.' };
	return { ok: true as const, offered: true };
};

export const pendingWatchPairings = async (userId: string) => {
	const sessions = await (
		await getSessionsCollection()
	)
		.find({
			purpose: 'watch-pairing',
			revokedAt: null,
			'meta.recipientUserId': userId,
			'meta.approvedAt': null,
			'meta.consumedAt': null,
			expiresAt: { $gt: new Date() }
		})
		.sort({ createdAt: -1 })
		.limit(5)
		.toArray();
	return {
		ok: true as const,
		requests: sessions.flatMap((session) => {
			const device = normalizeDeviceDescriptor(session.meta?.descriptor);
			const userCode = normalizeUserCode(session.meta?.offeredUserCode);
			return device && userCode ? [{ pairingId: session.jti, userCode, device, expiresAt: new Date(session.expiresAt!).toISOString() }] : [];
		})
	};
};

// Only called after a full browser session and strict code-guess limits.
// Fail closed on the unlikely event of two active requests sharing a code.
export const lookupWatchPairing = async (userCodeValue: unknown, userId: string) => {
	const userCode = normalizeUserCode(userCodeValue);
	if (!userCode)
		return { ok: false as const, status: 400, error: 'Enter the four-digit code shown on your Watch (older eight-character codes also work).' };
	const matches = await (
		await getSessionsCollection()
	)
		.find({
			purpose: 'watch-pairing',
			'meta.userCodeHash': hash('user-code', userCode),
			'meta.consumedAt': null,
			'meta.recipientUserId': { $in: [null, userId] },
			expiresAt: { $gt: new Date() }
		})
		.limit(2)
		.toArray();
	if (matches.length !== 1) {
		return {
			ok: false as const,
			status: 404,
			error: 'Code not found or expired. Create a new code on your Watch and check that both devices use the same Thingtime domain.'
		};
	}
	const result = await inspectWatchPairing(matches[0].jti, userCode);
	return result.ok ? { ...result, pairingId: matches[0].jti } : result;
};

export const inspectWatchPairing = async (
	pairingIdValue: unknown,
	userCodeValue: unknown
): Promise<{ ok: true; device: DeviceDescriptor; expiresAt: string; approved: boolean } | Failure> => {
	const pairingId = normalizePairingId(pairingIdValue);
	const userCode = normalizeUserCode(userCodeValue);
	if (!pairingId || !userCode) return { ok: false, status: 400, error: 'Pairing link is invalid' };
	const session = await (
		await getSessionsCollection()
	).findOne({
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
	if (session.meta?.recipientUserId && session.meta.recipientUserId !== userId) {
		return { ok: false, status: 403, error: 'Sign in to the account selected on your Watch or paired iPhone.' };
	}
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
			'meta.recipientUserId': { $in: [null, userId] },
			expiresAt: { $gt: now }
		},
		{ $set: { userId, 'meta.approvedAt': now } }
	);
	if (!approved.matchedCount) return { ok: false, status: 409, error: 'This pairing was approved for a different account' };
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
						'meta.shortCodeActive': false,
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
	const batteryLevel =
		typeof input.batteryLevel === 'number' && Number.isFinite(input.batteryLevel) ? Math.max(0, Math.min(1, input.batteryLevel)) : null;
	await (
		await getSessionsCollection()
	).updateOne(
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
