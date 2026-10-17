import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { normalizeUserVaultGroup, normalizeUserVaultSecret, normalizeUserVaultProvider, type PublicVaultGroup, type PublicVaultEntry } from './userVaultModel';

import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { projectUserVaultMetadata, USER_VAULT_SNAPSHOT_LIMIT } from './userVaultMetadata';
import { userVaultSnapshotVersion, type VaultSnapshotDocument } from './userVaultVersion';
import { createThing, deletePost, isFail, updateThing } from '../things/things';
import { ACL_OWNER } from '~/schemas/registry';
import {
	LOPU_PROVIDER_TEMPLATES,
	LOPU_USER_VAULT_SCHEMA_VERSION,
	LOPU_USER_VAULT_SYSTEM_TYPE,
	normalizeLopuProviderEndpoint,
	safeVaultId,
	type LopuProviderKind
} from './userVaultCore';

const VAULT_AAD_PREFIX = 'thingtime-user-vault:v1:';

type EncryptedValue = { cipherText: string; iv: string; tag: string };

type StoredVaultCrystal = {
	systemType: typeof LOPU_USER_VAULT_SYSTEM_TYPE;
	schemaVersion: number;
	recordKind: 'group' | 'secret' | 'provider';
	name: string;
	groupId?: string | null;
	key?: string;
	provider?: LopuProviderKind;
	endpoint?: string;
	// the connection's own provider-native model (optional — a row without one
	// runs on its kind's first catalog model, design note §1.3 / §6.2)
	model?: string;
	encryptedValue?: EncryptedValue;
	createdAt: string;
	updatedAt: string;
};

export type { PublicVaultGroup, PublicVaultEntry } from './userVaultModel';

type StoredVaultDoc = { shareId: string; ownerId: string; crystal: StoredVaultCrystal };

export const userVaultSourceKey = (): Buffer | null => {
	const source = (process.env.THINGTIME_USER_VAULT_KEY || process.env.THINGTIME_ADMIN_VAULT_KEY || '').trim();
	if (!source) return null;
	try {
		const decoded = Buffer.from(source, 'base64url');
		if (decoded.byteLength !== 32) return null;
		return createHmac('sha256', decoded).update(VAULT_AAD_PREFIX).digest();
	} catch {
		return null;
	}
};

export const userVaultConfigured = () => userVaultSourceKey() !== null;

const vaultAad = (ownerId: string, id: string) => Buffer.from(`${VAULT_AAD_PREFIX}${ownerId}:${id}`);

export const encryptUserVaultValue = (ownerId: string, id: string, value: string): EncryptedValue => {
	const key = userVaultSourceKey();
	if (!key) throw new Error('Secure Vault is unavailable. Configure THINGTIME_USER_VAULT_KEY or THINGTIME_ADMIN_VAULT_KEY.');
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(vaultAad(ownerId, id));
	const cipherText = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	return {
		cipherText: cipherText.toString('base64url'),
		iv: iv.toString('base64url'),
		tag: cipher.getAuthTag().toString('base64url')
	};
};

const decryptValue = (doc: StoredVaultDoc): string => {
	const key = userVaultSourceKey();
	const encrypted = doc.crystal.encryptedValue;
	if (!key || !encrypted) throw new Error('Stored provider credential is unavailable.');
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64url'));
		decipher.setAAD(vaultAad(doc.ownerId, doc.shareId));
		decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
		return Buffer.concat([decipher.update(Buffer.from(encrypted.cipherText, 'base64url')), decipher.final()]).toString('utf8');
	} catch {
		throw new Error('Stored provider credential cannot be decrypted with the configured vault key.');
	}
};

const publicEntry = (doc: StoredVaultDoc): PublicVaultEntry => ({
	id: doc.shareId,
	kind: doc.crystal.recordKind === 'provider' ? 'provider' : 'secret',
	name: doc.crystal.name,
	groupId: doc.crystal.groupId || null,
	...(doc.crystal.key ? { key: doc.crystal.key } : {}),
	...(doc.crystal.provider ? { provider: doc.crystal.provider } : {}),
	...(doc.crystal.endpoint ? { endpoint: doc.crystal.endpoint } : {}),
	...(doc.crystal.model ? { model: doc.crystal.model } : {}),
	hasValue: true,
	createdAt: doc.crystal.createdAt,
	updatedAt: doc.crystal.updatedAt
});

const ownVaultDoc = async (ownerId: string, id: unknown): Promise<StoredVaultDoc | null> => {
	const shareId = safeVaultId(id);
	if (!shareId) return null;
	return (await (
		await getThingsCollection()
	).findOne({ shareId, ownerId, thingtime: 'data', 'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE } as any)) as StoredVaultDoc | null;
};

const assertGroup = async (ownerId: string, groupId: unknown): Promise<string | null> => {
	if (groupId === undefined || groupId === null || groupId === '') return null;
	const group = await ownVaultDoc(ownerId, groupId);
	if (!group || group.crystal.recordKind !== 'group') throw new Error('Vault environment was not found.');
	return group.shareId;
};

export const revealUserVaultValue = async (ownerId: string, id: string): Promise<string | null> => {
	const doc = await ownVaultDoc(ownerId, id);
	return doc && ['secret', 'provider'].includes(doc.crystal.recordKind) && doc.crystal.encryptedValue ? decryptValue(doc) : null;
};

/** Optional device metadata read; it neither decrypts nor publishes entries. */
export const listUserVaultMetadata = async (ownerId: string) => {
 const things = await getThingsCollection();
 return withMongoTransaction(async session => {
  const cursor = things.find({ ownerId, thingtime: 'data', 'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE } as any, { session, maxTimeMS: 10_000 })
   .limit(USER_VAULT_SNAPSHOT_LIMIT + 1).batchSize(10);
  try { return await projectUserVaultMetadata(ownerId, cursor as any); }
  finally { await cursor.close(); }
 });
};

/** Version and selected plaintext come from exactly the same stored document.
 * Only the existing freshly verified reveal route may call this function. */
export const revealUserVaultValueVersion = async (ownerId: string, id: string) => {
 const doc = await ownVaultDoc(ownerId, id);
 if (!doc || !['secret', 'provider'].includes(doc.crystal.recordKind) || !doc.crystal.encryptedValue) return null;
 const version = userVaultSnapshotVersion(doc as unknown as VaultSnapshotDocument);
 return { version, value: decryptValue(doc) };
};

export const listUserVault = async (ownerId: string) => {
	const docs = (await (
		await getThingsCollection()
	)
		.find(
			{ ownerId, thingtime: 'data', 'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE } as any,
			{
				projection: {
					shareId: 1,
					ownerId: 1,
					'crystal.recordKind': 1,
					'crystal.name': 1,
					'crystal.groupId': 1,
					'crystal.key': 1,
					'crystal.provider': 1,
					'crystal.endpoint': 1,
					'crystal.model': 1,
					'crystal.createdAt': 1,
					'crystal.updatedAt': 1
				}
			}
		)
		.sort({ 'crystal.name': 1 })
		.limit(500)
		.toArray()) as unknown as StoredVaultDoc[];
	return {
		vaultConfigured: userVaultConfigured(),
		providerTemplates: LOPU_PROVIDER_TEMPLATES,
		groups: docs
			.filter((doc) => doc.crystal.recordKind === 'group')
			.map((doc): PublicVaultGroup => ({ id: doc.shareId, name: doc.crystal.name, createdAt: doc.crystal.createdAt, updatedAt: doc.crystal.updatedAt })),
		entries: docs.filter((doc) => doc.crystal.recordKind !== 'group').map(publicEntry)
	};
};

const createVaultThing = async (ownerId: string, shareId: string, crystal: StoredVaultCrystal) => {
	const result = await createThing(ownerId, { shareId, thingtime: ['data'], crystal, acl: [ACL_OWNER] }, { id: ownerId });
	if (isFail(result)) throw new Error(result.error);
	return result;
};

export const createUserVaultGroup = async (ownerId: string, input: { name?: unknown }): Promise<PublicVaultGroup> => {
	const { name } = normalizeUserVaultGroup(input);
	const now = new Date().toISOString();
	const shareId = randomUUID();
	await createVaultThing(ownerId, shareId, {
		systemType: LOPU_USER_VAULT_SYSTEM_TYPE,
		schemaVersion: LOPU_USER_VAULT_SCHEMA_VERSION,
		recordKind: 'group',
		name,
		createdAt: now,
		updatedAt: now
	});
	return { id: shareId, name, createdAt: now, updatedAt: now };
};

export const saveUserVaultSecret = async (
	ownerId: string,
	input: { id?: unknown; name?: unknown; key?: unknown; value?: unknown; groupId?: unknown }
): Promise<PublicVaultEntry> => {
	const { name, key, value } = normalizeUserVaultSecret(input);
	const groupId = await assertGroup(ownerId, input.groupId);
	const existing = input.id ? await ownVaultDoc(ownerId, input.id) : null;
	if (input.id && (!existing || existing.crystal.recordKind !== 'secret')) throw new Error('Vault secret was not found.');
	const shareId = existing?.shareId || randomUUID();
	const now = new Date().toISOString();
	const patch: StoredVaultCrystal = {
		systemType: LOPU_USER_VAULT_SYSTEM_TYPE,
		schemaVersion: LOPU_USER_VAULT_SCHEMA_VERSION,
		recordKind: 'secret',
		name,
		key,
		groupId,
		encryptedValue: encryptUserVaultValue(ownerId, shareId, value),
		createdAt: existing?.crystal.createdAt || now,
		updatedAt: now
	};
	if (existing) {
		const result = await updateThing({ id: ownerId }, shareId, { crystal: patch }, { replaceCrystal: true });
		if (isFail(result)) throw new Error(result.error);
	} else {
		await createVaultThing(ownerId, shareId, patch);
	}
	return publicEntry({ shareId, ownerId, crystal: patch });
};

export const saveUserVaultProvider = async (
	ownerId: string,
	input: { id?: unknown; name?: unknown; provider?: unknown; endpoint?: unknown; model?: unknown; token?: unknown; groupId?: unknown }
): Promise<PublicVaultEntry> => {
	const { name, provider, endpoint, token, model } = normalizeUserVaultProvider(input, normalizeLopuProviderEndpoint);
	const groupId = await assertGroup(ownerId, input.groupId);
	const existing = input.id ? await ownVaultDoc(ownerId, input.id) : null;
	if (input.id && (!existing || existing.crystal.recordKind !== 'provider')) throw new Error('AI provider was not found.');
	if (!existing && !token) throw new Error('A provider token is required when creating a connection.');
	const shareId = existing?.shareId || randomUUID();
	const now = new Date().toISOString();
	const encryptedValue = token ? encryptUserVaultValue(ownerId, shareId, token) : existing?.crystal.encryptedValue;
	if (!encryptedValue) throw new Error('Provider token is required.');
	const patch: StoredVaultCrystal = {
		systemType: LOPU_USER_VAULT_SYSTEM_TYPE,
		schemaVersion: LOPU_USER_VAULT_SCHEMA_VERSION,
		recordKind: 'provider',
		name,
		provider,
		endpoint,
		...(model ? { model } : {}),
		groupId,
		encryptedValue,
		createdAt: existing?.crystal.createdAt || now,
		updatedAt: now
	};
	if (existing) {
		const result = await updateThing({ id: ownerId }, shareId, { crystal: patch }, { replaceCrystal: true });
		if (isFail(result)) throw new Error(result.error);
	} else {
		await createVaultThing(ownerId, shareId, patch);
	}
	return publicEntry({ shareId, ownerId, crystal: patch });
};

// A metadata-only move never decrypts, replaces or returns the credential.
export const createVaultEnvironmentMover = (deps = { ownVaultDoc, assertGroup, updateThing }) => async (
 ownerId: string, input: { id?: unknown; groupId?: unknown }
): Promise<PublicVaultEntry> => {
 const doc = await deps.ownVaultDoc(ownerId, input.id);
 if (!doc || !['secret', 'provider'].includes(doc.crystal.recordKind)) throw new Error('Vault entry was not found.');
 if (input.groupId === undefined) throw new Error('Choose an environment or Ungrouped.');
 const groupId = await deps.assertGroup(ownerId, input.groupId);
 const updatedAt = new Date().toISOString();
 const result = await deps.updateThing({ id: ownerId }, doc.shareId, { crystal: { groupId, updatedAt } });
 if (isFail(result)) throw new Error(result.error);
 return publicEntry({ ...doc, crystal: { ...doc.crystal, groupId, updatedAt } });
};
export const moveUserVaultEntry = createVaultEnvironmentMover();

export const deleteUserVaultRecord = async (ownerId: string, id: unknown) => {
	const doc = await ownVaultDoc(ownerId, id);
	if (!doc) throw new Error('Vault record was not found.');
	if (doc.crystal.recordKind === 'group') {
		const child = await (
			await getThingsCollection()
		).findOne({ ownerId, thingtime: 'data', 'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE, 'crystal.groupId': doc.shareId } as any, { projection: { shareId: 1 } });
		if (child) throw new Error('Move or delete the entries in this environment first.');
	}
	const result = await deletePost({ id: ownerId }, doc.shareId);
	if (isFail(result)) throw new Error(result.error);
};

export const getUserVaultProvider = async (ownerId: string, id: unknown) => {
	const doc = await ownVaultDoc(ownerId, id);
	if (!doc || doc.crystal.recordKind !== 'provider' || !doc.crystal.provider || !doc.crystal.endpoint) {
		throw new Error('Selected AI provider was not found.');
	}
	return {
		id: doc.shareId,
		name: doc.crystal.name,
		provider: doc.crystal.provider,
		endpoint: doc.crystal.endpoint,
		model: doc.crystal.model || null,
		token: decryptValue(doc)
	};
};

export type ResolvedUserVaultProvider = Awaited<ReturnType<typeof getUserVaultProvider>>;

// ── read-only helpers (never load encrypted fields) ──

const VAULT_PROVIDER_LIST_PROJECTION = {
	shareId: 1,
	ownerId: 1,
	'crystal.recordKind': 1,
	'crystal.name': 1,
	'crystal.groupId': 1,
	'crystal.provider': 1,
	'crystal.endpoint': 1,
	'crystal.model': 1,
	'crystal.createdAt': 1,
	'crystal.updatedAt': 1
} as const;

// The viewer's AI provider connections as redacted metadata (the shape
// GET /api/v1/lopu/vault lists) — what the model catalog projects into
// `vaultProviders` for the chat picker.
export const listUserVaultProviders = async (ownerId: string): Promise<PublicVaultEntry[]> => {
	const docs = (await (
		await getThingsCollection()
	)
		.find({ ownerId, thingtime: 'data', 'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE, 'crystal.recordKind': 'provider' } as any, { projection: VAULT_PROVIDER_LIST_PROJECTION })
		.sort({ 'crystal.name': 1 })
		.limit(200)
		.toArray()) as unknown as StoredVaultDoc[];
	return docs.map(publicEntry);
};

// True when `id` names one of the viewer's own provider connections — the
// existence check a Lopu chat's stored providerId setting runs through.
export const hasUserVaultProvider = async (ownerId: string, id: unknown): Promise<boolean> => {
	const shareId = safeVaultId(id);
	if (!shareId) return false;
	const doc = await (
		await getThingsCollection()
	).findOne({ shareId, ownerId, thingtime: 'data', 'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE, 'crystal.recordKind': 'provider' } as any, {
		projection: { shareId: 1 }
	});
	return !!doc;
};
