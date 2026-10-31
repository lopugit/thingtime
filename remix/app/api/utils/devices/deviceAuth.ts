import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

import { getSessionsCollection } from '../mongodb/collections';
import { createSession, type SessionDoc } from '../auth/sessions';
import type { DeviceDescriptor } from './deviceCore';

const PAIRING_LIFETIME_MS = 10 * 60 * 1000;
export const DEVICE_SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
export const DEVICE_PAIRING_PROOF_VERSION = 'thingtime-device-pairing-claim-v1';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const secretHash = (namespace: 'pairing' | 'credential', value: string): string =>
	createHash('sha256').update(`thingtime-device-${namespace}-v1\0`).update(value).digest('hex');

export const pairingSecretHash = (secret: string): string => secretHash('pairing', secret);
export const deviceCredentialHash = (credential: string): string => secretHash('credential', credential);

export const generateDeviceCredential = (): string => `ttnode_${randomBytes(32).toString('base64url')}`;
export const generatePairingSecret = (): string => `ttpair_${randomBytes(32).toString('base64url')}`;
export const generateDevicePairingNonce = (): string => randomBytes(32).toString('base64url');

export const normalizeDeviceCredential = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const token = value.trim();
	return /^ttnode_[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null;
};

export const normalizePairingSecret = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const token = value.trim();
	return /^ttpair_[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};

const normalizeBase64UrlBytes = (value: unknown, bytes: number): string | null => {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
	try {
		const decoded = Buffer.from(value, 'base64url');
		return decoded.length === bytes && decoded.toString('base64url') === value ? value : null;
	} catch {
		return null;
	}
};

export const normalizeDevicePairingPublicKey = (value: unknown): string | null => normalizeBase64UrlBytes(value, 32);
export const normalizeDevicePairingNonce = (value: unknown): string | null => normalizeBase64UrlBytes(value, 32);
export const normalizeDevicePairingSignature = (value: unknown): string | null => normalizeBase64UrlBytes(value, 64);

export const devicePairingProofHash = (namespace: string, value: string): string =>
	createHash('sha256').update(`thingtime-device-pairing-proof:${namespace}:v1\0`).update(value).digest('hex');

export type CanonicalDevicePairingClaim = {
	pairingId: string;
	pairingSecret: string;
	credential: string;
	publicKey: string;
	nonce: string;
	serverNonce: string;
	device: DeviceDescriptor;
	capabilities: string[];
};

const lengthPrefixedUtf8 = (value: string): Buffer => {
	const bytes = Buffer.from(value, 'utf8');
	return Buffer.concat([Buffer.from(`${bytes.length}:`, 'ascii'), bytes]);
};

export const canonicalDevicePairingClaimBytes = (claim: CanonicalDevicePairingClaim): Buffer => {
	const fields = [
		DEVICE_PAIRING_PROOF_VERSION,
		claim.pairingId,
		claim.pairingSecret,
		claim.credential,
		claim.publicKey,
		claim.nonce,
		claim.serverNonce,
		claim.device.name,
		claim.device.platform,
		claim.device.model ?? '',
		claim.device.osVersion ?? '',
		claim.device.appVersion ?? '',
		String(claim.capabilities.length),
		...claim.capabilities
	];
	return Buffer.concat(fields.map(lengthPrefixedUtf8));
};

export const verifyDevicePairingClaim = (claim: CanonicalDevicePairingClaim, signatureValue: unknown): boolean => {
	const publicKey = normalizeDevicePairingPublicKey(claim.publicKey);
	const signature = normalizeDevicePairingSignature(signatureValue);
	if (!publicKey || !signature) return false;
	try {
		const key = createPublicKey({
			key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'base64url')]),
			format: 'der',
			type: 'spki'
		});
		return verifySignature(null, canonicalDevicePairingClaimBytes(claim), key, Buffer.from(signature, 'base64url'));
	} catch {
		return false;
	}
};

export type PublicPairingChallenge = {
	pairingId: string;
	pairingSecret: string;
	expiresAt: string;
};

export const createDevicePairingSession = async (userId: string): Promise<PublicPairingChallenge> => {
	const pairingSecret = generatePairingSecret();
	const expiresAt = new Date(Date.now() + PAIRING_LIFETIME_MS);
	const session = await createSession(userId, {
		purpose: 'device-pairing',
		expiresAt,
		meta: {
			pairingSecretHash: pairingSecretHash(pairingSecret),
			claimHash: null,
			deviceId: null,
			consumedAt: null,
			claimBindingHash: null,
			claimPublicKeyHash: null,
			claimNonceHash: null,
			claimServerNonce: null,
			claimServerNonceHash: null
		}
	});
	return { pairingId: session.jti, pairingSecret, expiresAt: expiresAt.toISOString() };
};

export const findPairingSession = async (secret: string): Promise<SessionDoc | null> => {
	const sessions = await getSessionsCollection();
	return sessions.findOne({ purpose: 'device-pairing', 'meta.pairingSecretHash': pairingSecretHash(secret) }) as Promise<SessionDoc | null>;
};

const bearerCredential = (request: Request): string | null => {
	const authorization = request.headers.get('authorization')?.trim() || '';
	const match = /^Bearer\s+(.+)$/i.exec(authorization);
	return normalizeDeviceCredential(match?.[1]);
};

export type DeviceActor = {
	userId: string;
	deviceId: string;
	sessionId: string;
	capabilities: string[];
};

export const resolveDeviceActor = async (request: Request): Promise<DeviceActor | null> => {
	const credential = bearerCredential(request);
	if (!credential) return null;
	const now = new Date();
	const sessions = await getSessionsCollection();
	const hash = deviceCredentialHash(credential);
	const session = await sessions.findOne({
		purpose: 'device',
		'meta.deviceCredentialHash': hash,
		revokedAt: null,
		$or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
	});
	const userId = typeof session?.userId === 'string' ? session.userId : '';
	const deviceId = typeof session?.meta?.deviceId === 'string' ? session.meta.deviceId : '';
	if (!session || !userId || !deviceId) return null;
	await sessions.updateOne({ jti: session.jti, purpose: 'device', revokedAt: null }, { $set: { 'meta.lastSeenAt': now } });
	return {
		userId,
		deviceId,
		sessionId: String(session.jti),
		capabilities: Array.isArray(session.meta?.capabilities)
			? session.meta.capabilities.filter((entry: unknown): entry is string => typeof entry === 'string').slice(0, 64)
			: []
	};
};
