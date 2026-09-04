import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { getAdminIntegrationClaimsCollection, getLopuCredentialsCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import {
  LOPU_CREDENTIAL_MAX_ITEMS,
  LOPU_CREDENTIAL_MAX_VALUE_BYTES,
  LOPU_CREDENTIAL_TYPE,
	credentialTypeForPlatform,
  normalizeCredentialName,
  normalizeCredentialOrder,
	normalizeCredentialPlatform,
  type LopuCredentialFetchRequest
} from './credentialVaultCore';

const VAULT_AAD_PREFIX = 'thingtime-lopu-credential:v1:';
const CLAIM_TTL_MS = 10 * 60 * 1000;

export type PublicLopuCredential = {
  id: string;
  name: string;
	platform: string;
	credentialType: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

type StoredLopuCredential = {
  id: string;
  name: string;
	platform?: string;
	credentialType: string;
  cipherText: string;
  iv: string;
  tag: string;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  schemaVersion: number;
};

const vaultKey = (): Buffer | null => {
  const source = process.env.THINGTIME_ADMIN_VAULT_KEY?.trim();
  if (!source) return null;
  try {
    const decoded = Buffer.from(source, 'base64url');
    return decoded.byteLength === 32 ? decoded : null;
  } catch {
    return null;
  }
};

export const lopuCredentialVaultConfigured = () => vaultKey() !== null;

const encrypt = (id: string, value: string) => {
  const key = vaultKey();
  if (!key) throw new Error('Lopu credential vault is unavailable. Configure THINGTIME_ADMIN_VAULT_KEY.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${VAULT_AAD_PREFIX}${id}`));
  const cipherText = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { cipherText: cipherText.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
};

const decrypt = (record: StoredLopuCredential) => {
  const key = vaultKey();
  if (!key) throw new Error('Lopu credential vault is unavailable.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${VAULT_AAD_PREFIX}${record.id}`));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(record.cipherText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(`Credential ${record.name} cannot be decrypted with the configured vault key.`);
  }
};

const publicCredential = (record: StoredLopuCredential): PublicLopuCredential => ({
  id: record.id,
  name: record.name,
	platform: record.platform ?? 'Anthropic',
  credentialType: record.credentialType,
  priority: record.priority,
  enabled: record.enabled,
  createdAt: new Date(record.createdAt).toISOString(),
  updatedAt: new Date(record.updatedAt).toISOString(),
  createdBy: record.createdBy
});

export const listLopuCredentials = async () => {
	const rows = await (
		await getLopuCredentialsCollection()
	)
    .find({}, { projection: { cipherText: 0, iv: 0, tag: 0 } })
    .sort({ priority: 1, createdAt: 1 })
    .limit(LOPU_CREDENTIAL_MAX_ITEMS)
    .toArray();
  return { vaultConfigured: lopuCredentialVaultConfigured(), credentials: rows.map((row: StoredLopuCredential) => publicCredential(row)) };
};

const requireValue = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > LOPU_CREDENTIAL_MAX_VALUE_BYTES) {
		throw new Error('A non-empty credential within the size limit is required.');
  }
  return value.trim();
};

export const createLopuCredential = async (input: { name?: unknown; platform?: unknown; value?: unknown; enabled?: unknown }, actorId: string) => {
  const name = normalizeCredentialName(input.name);
  if (!name) throw new Error('A credential name is required (80 characters maximum).');
	const platform = normalizeCredentialPlatform(input.platform ?? 'Anthropic');
	if (!platform) throw new Error('A platform name is required (80 characters maximum).');
  const value = requireValue(input.value);
  const collection = await getLopuCredentialsCollection();
  if (await collection.findOne({ name })) throw new Error('A credential with that name already exists.');
	if ((await collection.countDocuments({})) >= LOPU_CREDENTIAL_MAX_ITEMS)
		throw new Error(`At most ${LOPU_CREDENTIAL_MAX_ITEMS} credentials may be stored.`);
  const tail = await collection.find({}).sort({ priority: -1 }).limit(1).next();
  const id = `lopu_credential_${randomBytes(18).toString('base64url')}`;
  const now = new Date();
  const record: StoredLopuCredential = {
    id,
    name,
		platform,
		credentialType: credentialTypeForPlatform(platform),
    ...encrypt(id, value),
    priority: Math.max(0, Number(tail?.priority ?? -1) + 1),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.lopuCredentials
  };
  await collection.insertOne(record);
  return publicCredential(record);
};

export const rotateLopuCredential = async (id: unknown, value: unknown) => {
  if (typeof id !== 'string' || !id) throw new Error('Choose a credential to rotate.');
  const current = await (await getLopuCredentialsCollection()).findOne({ id });
  if (!current) throw new Error('Credential not found.');
  const encrypted = encrypt(id, requireValue(value));
  await (await getLopuCredentialsCollection()).updateOne({ id }, { $set: { ...encrypted, updatedAt: new Date() } });
};

export const setLopuCredentialEnabled = async (id: unknown, enabled: unknown) => {
  if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('Credential and enabled state are required.');
  const result = await (await getLopuCredentialsCollection()).updateOne({ id }, { $set: { enabled, updatedAt: new Date() } });
  if (!result.matchedCount) throw new Error('Credential not found.');
};

export const reorderLopuCredentials = async (order: unknown) => {
  const ids = normalizeCredentialOrder(order);
  if (!ids) throw new Error('Credential order must contain unique credential ids.');
  const collection = await getLopuCredentialsCollection();
  const rows = await collection.find({}, { projection: { id: 1 } }).toArray();
  if (ids.length !== rows.length || rows.some((row: any) => !ids.includes(String(row.id)))) {
    throw new Error('Credential order must include every stored credential exactly once.');
  }
  const now = new Date();
	if (ids.length)
		await collection.bulkWrite(ids.map((id, priority) => ({ updateOne: { filter: { id }, update: { $set: { priority, updatedAt: now } } } })));
};

export const deleteLopuCredential = async (id: unknown) => {
  if (typeof id !== 'string' || !id) throw new Error('Choose a credential to delete.');
  const collection = await getLopuCredentialsCollection();
  const result = await collection.deleteOne({ id });
  if (!result.deletedCount) throw new Error('Credential not found.');
  const remaining = await collection.find({}).sort({ priority: 1, createdAt: 1 }).toArray();
  await Promise.all(remaining.map((row: any, priority: number) => collection.updateOne({ id: row.id }, { $set: { priority } })));
};

export const claimLopuCredentialFetch = async (request: LopuCredentialFetchRequest) => {
  const collection = await getAdminIntegrationClaimsCollection();
  const endpointId = 'lopu-credential-fetch';
  const resourceKey = `${request.repository}:${request.runId}:${request.runAttempt}:${request.nonce}`;
  const now = new Date();
  try {
    await collection.insertOne({
      endpointId,
      resourceKey,
      createdAt: now,
      expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.adminIntegrationClaims
    });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

export const fetchLopuCredentialBundle = async (platform = 'Anthropic') => {
	const rows = await (
		await getLopuCredentialsCollection()
	)
		.find(
			platform.toLowerCase() === 'anthropic'
				? { enabled: true, $or: [{ platform: { $in: ['Anthropic', 'anthropic', 'Claude', 'claude'] } }, { platform: { $exists: false } }] }
				: { enabled: true, platform }
		)
    .sort({ priority: 1, createdAt: 1 })
    .limit(LOPU_CREDENTIAL_MAX_ITEMS)
    .toArray();
	return rows.map((row: StoredLopuCredential) => ({
		id: row.id,
		name: row.name,
		platform: row.platform ?? 'Anthropic',
		credentialType: row.credentialType,
		value: decrypt(row)
	}));
};

export const bootstrapLopuCredentialsIfEmpty = async (entries: Array<{ name: string; value: string }>, actorId: string) => {
  if (!entries.length) return false;
  const collection = await getLopuCredentialsCollection();
  if (await collection.findOne({})) return false;
  const claims = await getAdminIntegrationClaimsCollection();
  const now = new Date();
  try {
    await claims.insertOne({
      endpointId: 'lopu-credential-bootstrap',
      resourceKey: 'v1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.adminIntegrationClaims
    });
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
  if (await collection.findOne({})) return false;
  for (const entry of entries) await createLopuCredential({ ...entry, enabled: true }, actorId);
  return true;
};
