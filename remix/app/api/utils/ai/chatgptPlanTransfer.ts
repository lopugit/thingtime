import {
	createCipheriv,
	createDecipheriv,
	createPrivateKey,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
	hkdfSync,
	randomBytes,
	randomUUID
} from 'node:crypto';

export interface ChatGPTTransferRecipient {
	version: 1;
	id: string;
	targetOrigin: string;
	targetOwnerId: string;
	publicKey: string;
	nonce: string;
	expiresAt: number;
}
export interface ChatGPTTransferBundle {
	version: 1;
	recipientId: string;
	sourceOrigin: string;
	ephemeralPublicKey: string;
	iv: string;
	tag: string;
	ciphertext: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid encrypted ChatGPT transfer.');
	return value as Record<string, unknown>;
};
const bytes = (value: unknown, length?: number): Buffer => {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encrypted ChatGPT transfer.');
	const result = Buffer.from(value, 'base64url');
	if ((length !== undefined && result.length !== length) || result.toString('base64url') !== value)
		throw new Error('Invalid encrypted ChatGPT transfer.');
	return result;
};
function origin(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Invalid transfer origin.');
	const url = new URL(value);
	if (
		url.origin !== value ||
		!['http:', 'https:'].includes(url.protocol) ||
		(url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
	)
		throw new Error('Use HTTPS or a local loopback transfer origin.');
	return value;
}
export function validateTransferRecipient(value: unknown, now: number): ChatGPTTransferRecipient {
	const data = object(value);
	if (
		data.version !== 1 ||
		typeof data.id !== 'string' ||
		!uuid.test(data.id) ||
		typeof data.targetOwnerId !== 'string' ||
		!data.targetOwnerId ||
		typeof data.expiresAt !== 'number' ||
		!Number.isSafeInteger(data.expiresAt) ||
		data.expiresAt <= now ||
		data.expiresAt > now + 30 * 60_000
	)
		throw new Error('ChatGPT transfer recipient is invalid or expired.');
	const key = createPublicKey({ key: bytes(data.publicKey, 44), type: 'spki', format: 'der' });
	if (key.asymmetricKeyType !== 'x25519') throw new Error('Invalid transfer recipient key.');
	bytes(data.nonce, 32);
	return {
		version: 1,
		id: data.id,
		targetOrigin: origin(data.targetOrigin),
		targetOwnerId: data.targetOwnerId,
		publicKey: data.publicKey as string,
		nonce: data.nonce as string,
		expiresAt: data.expiresAt
	};
}
export function createTransferRecipient(targetOrigin: string, targetOwnerId: string, now: number) {
	const pair = generateKeyPairSync('x25519');
	return {
		descriptor: {
			version: 1 as const,
			id: randomUUID(),
			targetOrigin: origin(targetOrigin),
			targetOwnerId,
			publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
			nonce: randomBytes(32).toString('base64url'),
			expiresAt: now + 15 * 60_000
		},
		privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url')
	};
}
export function validateTransferBundle(value: unknown): ChatGPTTransferBundle {
	const data = object(value);
	if (data.version !== 1 || typeof data.recipientId !== 'string' || !uuid.test(data.recipientId))
		throw new Error('Invalid encrypted ChatGPT transfer.');
	bytes(data.ephemeralPublicKey, 44);
	bytes(data.iv, 12);
	bytes(data.tag, 16);
	bytes(data.ciphertext);
	return {
		version: 1,
		recipientId: data.recipientId,
		sourceOrigin: origin(data.sourceOrigin),
		ephemeralPublicKey: data.ephemeralPublicKey as string,
		iv: data.iv as string,
		tag: data.tag as string,
		ciphertext: data.ciphertext as string
	};
}
function aad(recipient: ChatGPTTransferRecipient, sourceOrigin: string) {
	return Buffer.from(JSON.stringify({ purpose: 'thingtime-chatgpt-plan-move-v1', recipient, sourceOrigin }));
}
export function sealTransfer(recipient: ChatGPTTransferRecipient, sourceOrigin: string, value: unknown): ChatGPTTransferBundle {
	const pair = generateKeyPairSync('x25519');
	const publicKey = createPublicKey({ key: bytes(recipient.publicKey, 44), type: 'spki', format: 'der' });
	const shared = diffieHellman({ privateKey: pair.privateKey, publicKey });
	const associated = aad(recipient, origin(sourceOrigin));
	const key = Buffer.from(hkdfSync('sha256', shared, bytes(recipient.nonce, 32), associated, 32));
	const iv = randomBytes(12);
	try {
		const cipher = createCipheriv('aes-256-gcm', key, iv);
		cipher.setAAD(associated);
		const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
		return {
			version: 1,
			recipientId: recipient.id,
			sourceOrigin,
			ephemeralPublicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
			iv: iv.toString('base64url'),
			tag: cipher.getAuthTag().toString('base64url'),
			ciphertext: encrypted.toString('base64url')
		};
	} finally {
		key.fill(0);
		shared.fill(0);
	}
}
export function openTransfer(recipient: ChatGPTTransferRecipient, privateKey: string, bundle: ChatGPTTransferBundle): unknown {
	const privateObject = createPrivateKey({ key: bytes(privateKey, 48), type: 'pkcs8', format: 'der' });
	const publicKey = createPublicKey({ key: bytes(bundle.ephemeralPublicKey, 44), type: 'spki', format: 'der' });
	if (privateObject.asymmetricKeyType !== 'x25519' || publicKey.asymmetricKeyType !== 'x25519' || bundle.recipientId !== recipient.id)
		throw new Error('Invalid encrypted ChatGPT transfer.');
	const shared = diffieHellman({ privateKey: privateObject, publicKey });
	const associated = aad(recipient, bundle.sourceOrigin);
	const key = Buffer.from(hkdfSync('sha256', shared, bytes(recipient.nonce, 32), associated, 32));
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, bytes(bundle.iv, 12));
		decipher.setAAD(associated);
		decipher.setAuthTag(bytes(bundle.tag, 16));
		return JSON.parse(Buffer.concat([decipher.update(bytes(bundle.ciphertext)), decipher.final()]).toString('utf8'));
	} finally {
		key.fill(0);
		shared.fill(0);
	}
}
