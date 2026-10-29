import { createHash } from 'node:crypto';
import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import { getLiveSession } from './sessions';
import { getSessionsCollection } from '../mongodb/collections';
import { fromBin, toBin } from './binary';
import { mutateUserVaultKey, readUserVaultKey } from './users';
import { decryptOwnerValue, encryptOwnerValue, ownerVaultConfigured, type EncryptedVaultValue } from './vaultCipher';
import {
  createVaultDataKey,
  openVaultValue,
  sealVaultValue,
  unwrapVaultKeyWithPassword,
  unwrapVaultKeyWithSession,
  wrapVaultKeyWithPassword,
  wrapVaultKeyWithSession,
  type PasswordKeyEnvelope,
  type SessionKeyEnvelope,
  type VaultDataKey,
  type VaultEnvelope
} from './vaultEnvelope';
import { vaultRequest } from './vaultRequest';

export type UserVaultKeyRegistry = {
  version: 1;
  mode: 'server-assisted';
  keyId: string;
  recovery: EncryptedVaultValue;
  password?: PasswordKeyEnvelope;
};
const RECOVERY = 'thingtime-vault-recovery:v1:';
const unavailable = () => new Error('The account vault could not be unlocked.');
const restore = (ownerId: string, registry: UserVaultKeyRegistry): VaultDataKey => {
  if (registry?.version !== 1 || registry.mode !== 'server-assisted') throw unavailable();
  const bytes = Buffer.from(decryptOwnerValue(RECOVERY, ownerId, registry.keyId, registry.recovery), 'base64url');
  if (bytes.length !== 32 || !/^vault-key-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(registry.keyId)) {
    bytes.fill(0);
    throw unavailable();
  }
  return { id: registry.keyId, bytes };
};
const freshRegistry = (ownerId: string): UserVaultKeyRegistry => {
  const key = createVaultDataKey();
  try {
    return {
      version: 1,
      mode: 'server-assisted',
      keyId: key.id,
      recovery: encryptOwnerValue(RECOVERY, ownerId, key.id, key.bytes.toString('base64url'))
    };
  } finally {
    key.bytes.fill(0);
  }
};
export const ensureUserVaultKey = async (ownerId: string): Promise<UserVaultKeyRegistry> => {
  const existing = await readUserVaultKey(ownerId);
  if (existing) return existing;
  // A competing first write selects ONE key. Never replace a damaged registry.
  return mutateUserVaultKey(ownerId, async (current) => ({ registry: current ?? freshRegistry(ownerId) }));
};

// Called only after successful password verification (or account creation).
// The hash guard prevents a slow old-password login overwriting a racing reset.
export const bindVaultPassword = async (ownerId: string, password: string, verifiedHash: string) => {
  if (!ownerVaultConfigured()) return;
  await mutateUserVaultKey(ownerId, async (existing, currentHash) => {
    if (currentHash !== verifiedHash) throw unavailable();
    const registry = existing ?? freshRegistry(ownerId);
    const key = registry.password ? await unwrapVaultKeyWithPassword(ownerId, password, registry.password) : restore(ownerId, registry);
    try {
      if (key.id !== registry.keyId) throw unavailable();
      return { registry: registry.password ? registry : { ...registry, password: await wrapVaultKeyWithPassword(ownerId, key, password) } };
    } finally {
      key.bytes.fill(0);
    }
  });
};

// Recovery changes the password wrapper and password hash in the SAME CAS,
// preserving the DEK and every saved credential. Caller revokes live sessions.
export const resetVaultPassword = async (ownerId: string, password: string, passwordHash: string) => {
  await mutateUserVaultKey(ownerId, async (existing) => {
    const registry = existing ?? freshRegistry(ownerId),
      key = restore(ownerId, registry);
    try {
      return { passwordHash, registry: { ...registry, password: await wrapVaultKeyWithPassword(ownerId, key, password) } };
    } finally {
      key.bytes.fill(0);
    }
  });
};

const sessionKey = async (ownerId: string, token: string, registry: UserVaultKeyRegistry): Promise<VaultDataKey> => {
  const claims = await verifyJwt(token);
  if (!claims || claims.sub !== ownerId) throw unavailable();
  const session = await getLiveSession(claims.jti);
  if (!session || String(session.userId) !== ownerId || ![undefined, 'browser', 'service'].includes(session.purpose)) throw unavailable();
  const now = Date.now();
  const tokenHash = createHash('sha256').update(token).digest('base64url');
  let saved: { tokenHash: string; envelope: SessionKeyEnvelope } | null = null;
  if (session.secureVaultKey) {
    try {
      saved = JSON.parse(fromBin(session.secureVaultKey));
    } catch {
      throw unavailable();
    }
  }
  if (saved?.tokenHash === tokenHash && saved.envelope.expiresAt > now) {
    if (saved.envelope.keyId !== registry.keyId) throw unavailable();
    return unwrapVaultKeyWithSession(ownerId, { id: session.jti, token, expiresAt: saved.envelope.expiresAt }, saved.envelope, now);
  }
  // Passkeys, account-switch JWT rotation and legacy sessions use the approved
  // recovery path after the SAME live-session check. No password is retained.
  const key = restore(ownerId, registry);
  try {
    const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : now + 86_400_000;
    const envelope = wrapVaultKeyWithSession(ownerId, key, { id: session.jti, token, expiresAt }, now);
    const result = await (
      await getSessionsCollection()
    ).updateOne(
      { jti: session.jti, userId: ownerId, revokedAt: null, expiresAt: session.expiresAt },
      { $set: { secureVaultKey: toBin(JSON.stringify({ tokenHash, envelope })) } }
    );
    if (!result.matchedCount) throw unavailable();
    return unwrapVaultKeyWithSession(ownerId, { id: session.jti, token, expiresAt }, envelope, now);
  } finally {
    key.bytes.fill(0);
  }
};

// Server-only primitive: caller must establish ownership/capability BEFORE
// invoking. A browser request additionally requires its matching live session.
// Trusted background jobs without a browser credential use the recovery wrap.
export const withUserVaultKey = async <T>(ownerId: string, work: (key: VaultDataKey) => T | Promise<T>): Promise<T> => {
  const request = vaultRequest();
  const token = request ? await getAuthToken(request) : null;
  const registry = await ensureUserVaultKey(ownerId);
  const key = token ? await sessionKey(ownerId, token, registry) : restore(ownerId, registry);
  try {
    return await work(key);
  } finally {
    key.bytes.fill(0);
  }
};
export const encryptUserVaultValue = (ownerId: string, recordId: string, purpose: 'oauth' | 'secret', value: string) =>
  withUserVaultKey(ownerId, (key) => sealVaultValue(ownerId, key, recordId, purpose, value));
export const decryptUserVaultValue = (ownerId: string, recordId: string, purpose: 'oauth' | 'secret', envelope: VaultEnvelope) =>
  withUserVaultKey(ownerId, (key) => openVaultValue(ownerId, key, recordId, purpose, envelope));
