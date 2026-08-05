import { randomUUID } from 'node:crypto';

import { listLinkedAppClientIds, userCanManageApp } from '../accounts/accountLinks';
import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { getSubscription } from '../subscriptions/subscriptions';
import { DEFAULT_SUBSCRIPTION_TIER, subscriptionTierById, type SubscriptionTierId } from '../subscriptions/tierCatalog';
import { remainingStorageBytes, storageUsage, storedByteAllowance, storedByteCount } from './appStorageCore';
import {
  ACL_OWNER,
  APP_STORAGE_ACCOUNTING_VERSION,
  COLLECTION_SCHEMA_VERSIONS,
  DEFAULT_APP_STORAGE_ALLOWANCE_BYTES,
  DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES,
  MAX_APPS_PER_USER,
  MAX_APP_NAME_CHARS,
  MAX_APP_ORIGINS
} from '~/schemas/registry';

// Embed apps for "Login with Thingtime" (FUNDAMENTALS.md: everything is a
// thing) — a registered app is a `things` doc with thingtime ['app'] and a
// crystal containing its identity/origins plus server-owned storage allowance
// + usage fields, owned by the developer user. Apps are created ONLY here (the
// schema has no generic-route sanitizer), the server mints the clientId, and a
// partial unique index keeps clientId one-of-a-kind.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type PublicApp = {
  clientId: string;
  name: string;
  origins: string[];
  storageAllowanceBytes: number | null;
  storageUsedBytes: number;
  storageRemainingBytes: number | null;
  userStorageAllowanceBytes: number;
  storageAccountingReady: boolean;
  subscriptionTier: SubscriptionTierId;
  subscriptionMetered: boolean;
  subscriptionCustom: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Set while an admin has suspended the app: every token is refused at the
  // resolveAppToken choke point and the consent screen won't render.
  revokedAt: Date | null;
};

export type AppStoragePolicy = {
  storageAllowanceBytes: number | null;
  storageUsedBytes: number;
  userStorageAllowanceBytes: number;
  subscriptionTier: SubscriptionTierId;
  subscriptionCustom: boolean;
  ready: boolean;
};

// The shape shown to ANONYMOUS callers (the authorize popup before login):
// just enough to render a consent screen, nothing about the owner or the
// full origin allowlist.
export type EmbedApp = {
  clientId: string;
  name: string;
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Normalize a web origin: http(s), no path/query/hash/credentials, lowercased.
// Plain http is allowed only for localhost so dev sites can test the embed —
// production embeds must be https or tokens would travel in cleartext.
export const normalizeAppOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(trimmed.toLowerCase());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.protocol === 'http:' && !LOCAL_HOSTNAMES.has(url.hostname)) return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;

  return url.origin;
};

export const sanitizeAppName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_APP_NAME_CHARS) return null;
  return name;
};

export const sanitizeAppOrigins = (value: unknown): string[] | Fail => {
  if (!Array.isArray(value) || !value.length) {
    return fail(400, 'origins must be a non-empty list of web origins');
  }
  if (value.length > MAX_APP_ORIGINS) {
    return fail(400, `An app can have at most ${MAX_APP_ORIGINS} origins`);
  }

  const origins: string[] = [];
  for (const entry of value) {
    const normalized = normalizeAppOrigin(entry);
    if (!normalized) {
      return fail(
        400,
        'Origins must be bare https origins like https://example.com (http is allowed for localhost only)'
      );
    }
    if (!origins.includes(normalized)) origins.push(normalized);
  }
  return origins;
};

export const appStoragePolicyOf = (doc: any): AppStoragePolicy => {
  const crystal = doc?.crystal;
  const hasAllowance = !!crystal && Object.prototype.hasOwnProperty.call(crystal, 'storageAllowanceBytes');
  const allowanceValid =
    hasAllowance &&
    (crystal.storageAllowanceBytes === null ||
      (Number.isSafeInteger(crystal.storageAllowanceBytes) && Number(crystal.storageAllowanceBytes) >= 0));
  const subscriptionTier: SubscriptionTierId =
    crystal?.subscriptionTier && subscriptionTierById(crystal.subscriptionTier).id === crystal.subscriptionTier
      ? crystal.subscriptionTier
      : DEFAULT_SUBSCRIPTION_TIER;
  const ready =
    allowanceValid &&
    Number.isSafeInteger(crystal?.storageUsedBytes) &&
    Number(crystal.storageUsedBytes) >= 0 &&
    Number.isSafeInteger(crystal?.userStorageAllowanceBytes) &&
    Number(crystal.userStorageAllowanceBytes) >= 0 &&
    crystal?.storageAccountingVersion === APP_STORAGE_ACCOUNTING_VERSION;
  return {
    storageAllowanceBytes: storedByteAllowance(
      crystal?.storageAllowanceBytes,
      DEFAULT_APP_STORAGE_ALLOWANCE_BYTES
    ),
    storageUsedBytes: storedByteCount(crystal?.storageUsedBytes, 0),
    userStorageAllowanceBytes: storedByteCount(
      crystal?.userStorageAllowanceBytes,
      DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES
    ),
    subscriptionTier,
    subscriptionCustom: !!crystal && Object.prototype.hasOwnProperty.call(crystal, 'storageAllowanceOverrideBytes'),
    ready
  };
};

const toPublicApp = (doc: any): PublicApp => {
  const policy = appStoragePolicyOf(doc);
  const appUsage = storageUsage(
    policy.storageUsedBytes,
    policy.storageAllowanceBytes,
    DEFAULT_APP_STORAGE_ALLOWANCE_BYTES
  );
  return {
    clientId: doc.crystal?.clientId,
    name: doc.crystal?.name,
    origins: Array.isArray(doc.crystal?.origins) ? doc.crystal.origins : [],
    storageAllowanceBytes: appUsage.allowanceBytes,
    storageUsedBytes: appUsage.usedBytes,
    storageRemainingBytes: remainingStorageBytes(appUsage),
    userStorageAllowanceBytes: policy.userStorageAllowanceBytes,
    storageAccountingReady: policy.ready,
    subscriptionTier: policy.subscriptionTier,
    subscriptionMetered: subscriptionTierById(policy.subscriptionTier).metered,
    subscriptionCustom: policy.subscriptionCustom,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    revokedAt: doc.crystal?.revokedAt instanceof Date ? doc.crystal.revokedAt : null
  };
};

// Admin suspension state. Lives in crystal (like every app field) and is
// checked at the resolveAppToken choke point, so setting it kills every live
// token without needing the session sweep to have landed first.
export const appIsRevoked = (appDoc: any): boolean => !!appDoc?.crystal?.revokedAt;

export const findAppByClientId = async (clientId: string) => {
  if (typeof clientId !== 'string' || !clientId.trim()) return null;
  const things = await getThingsCollection();
  return things.findOne({ thingtime: 'app', 'crystal.clientId': clientId.trim() });
};

// Batch counterpart for grant listings: one indexed query instead of one
// findAppByClientId round-trip per connected app.
export const findAppsByClientIds = async (clientIds: string[]) => {
  const ids = clientIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim());
  if (!ids.length) return [];
  const things = await getThingsCollection();
  return things.find({ thingtime: 'app', 'crystal.clientId': { $in: ids } }).toArray();
};

export const appAllowsOrigin = (appDoc: any, origin: string): boolean => {
  const normalized = normalizeAppOrigin(origin);
  if (!normalized) return false;
  const origins = appDoc?.crystal?.origins;
  return Array.isArray(origins) && origins.includes(normalized);
};

export const createApp = async (
  ownerId: string,
  input: { name?: unknown; origins?: unknown }
): Promise<{ ok: true; app: PublicApp } | Fail> => {
  const name = sanitizeAppName(input.name);
  if (!name) return fail(400, `App name is required (max ${MAX_APP_NAME_CHARS} chars)`);

  const origins = sanitizeAppOrigins(input.origins);
  if (!Array.isArray(origins)) return origins;

  const things = await getThingsCollection();

  // Soft product cap (like the app-data key cap): racing registrations can
  // momentarily exceed it, which is harmless — listApps returns everything,
  // so nothing becomes invisible or undeletable. The cap is the owner's
  // subscription tier (null = unlimited, e.g. payg).
  const maxApps = (await getSubscription('user', ownerId)).effective.maxApps;
  if (maxApps !== null) {
    const count = await things.countDocuments({ thingtime: 'app', ownerId });
    if (count >= maxApps) {
      return fail(400, `You can register at most ${maxApps} apps on your current tier`);
    }
  }

  const now = new Date();
  const doc = {
    shareId: randomUUID(),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['app'],
    crystal: {
      clientId: `ttapp_${randomUUID()}`,
      name,
      origins,
      subscriptionTier: DEFAULT_SUBSCRIPTION_TIER,
      storageAllowanceBytes: DEFAULT_APP_STORAGE_ALLOWANCE_BYTES,
      storageUsedBytes: 0,
      userStorageAllowanceBytes: DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES,
      storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION
    },
    ownerId,
    acl: [ACL_OWNER],
    targetId: null,
    tags: [],
    createdAt: now,
    updatedAt: now
  };

  await things.insertOne(doc as any);
  return { ok: true, app: toPublicApp(doc) };
};

// No .limit(): if racing registrations ever exceed the soft cap, the overflow
// apps must still show up here so the owner can see and delete them. The list
// is the union of apps the user registered and apps assigned to them via
// 'app' account-links (many-to-many co-management).
export const listApps = async (ownerId: string): Promise<PublicApp[]> => {
  const things = await getThingsCollection();
  const linked = await listLinkedAppClientIds(ownerId);
  const docs = await things
    .find({
      thingtime: 'app',
      $or: [{ ownerId }, ...(linked.length ? [{ 'crystal.clientId': { $in: linked } }] : [])]
    })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(toPublicApp);
};

export const updateApp = async (
  ownerId: string,
  clientId: unknown,
  input: { name?: unknown; origins?: unknown }
): Promise<{ ok: true; app: PublicApp } | Fail> => {
  if (typeof clientId !== 'string' || !clientId.trim()) return fail(400, 'clientId is required');

  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const name = sanitizeAppName(input.name);
    if (!name) return fail(400, `App name is required (max ${MAX_APP_NAME_CHARS} chars)`);
    set['crystal.name'] = name;
  }

  if (input.origins !== undefined) {
    const origins = sanitizeAppOrigins(input.origins);
    if (!Array.isArray(origins)) return origins;
    set['crystal.origins'] = origins;
  }

  // Managers = the registering owner or any 'app' account-link holder; both
  // resolve through the same check so a linked co-owner has the full surface.
  const app = await findAppByClientId(clientId);
  if (!app || !(await userCanManageApp(ownerId, app))) return fail(404, 'App not found');

  const things = await getThingsCollection();
  const updated = await things.findOneAndUpdate(
    { thingtime: 'app', 'crystal.clientId': clientId.trim() },
    { $set: set },
    { returnDocument: 'after' }
  );

  if (!updated) return fail(404, 'App not found');
  return { ok: true, app: toPublicApp(updated) };
};

// Deleting an app revokes every app-scoped session minted for it, so tokens
// held by embedding sites die immediately. End users' app-data things are
// KEPT — that data belongs to the users, not the app developer.
export const deleteApp = async (ownerId: string, clientId: unknown): Promise<{ ok: true } | Fail> => {
  if (typeof clientId !== 'string' || !clientId.trim()) return fail(400, 'clientId is required');
  const id = clientId.trim();

  const app = await findAppByClientId(id);
  if (!app || !(await userCanManageApp(ownerId, app))) return fail(404, 'App not found');

  const things = await getThingsCollection();
  const deleted = await things.deleteOne({ thingtime: 'app', 'crystal.clientId': id });
  if (!deleted.deletedCount) return fail(404, 'App not found');

  await (await getSessionsCollection()).updateMany(
    { purpose: 'app', 'meta.clientId': id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  return { ok: true };
};

export const toEmbedApp = (appDoc: any): EmbedApp => ({
  clientId: appDoc.crystal?.clientId,
  name: appDoc.crystal?.name
});

// Admin-plane suspend/restore (callers gate with requireAdmin). Revoking also
// sweeps the app's live sessions (same sweep as deleteApp) so holders lose
// access even before the choke-point check lands; restoring never resurrects
// swept sessions — users re-authorize, which is the point of a suspension.
export const setAppRevoked = async (
  clientId: unknown,
  revoked: boolean,
  adminId: string
): Promise<{ ok: true; app: PublicApp } | Fail> => {
  if (typeof clientId !== 'string' || !clientId.trim()) return fail(400, 'clientId is required');
  const id = clientId.trim();

  const things = await getThingsCollection();
  const updated = await things.findOneAndUpdate(
    { thingtime: 'app', 'crystal.clientId': id },
    revoked
      ? { $set: { 'crystal.revokedAt': new Date(), 'crystal.revokedBy': adminId, updatedAt: new Date() } }
      : { $unset: { 'crystal.revokedAt': '', 'crystal.revokedBy': '' }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!updated) return fail(404, 'App not found');

  if (revoked) {
    await (await getSessionsCollection()).updateMany(
      { purpose: 'app', 'meta.clientId': id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  return { ok: true, app: toPublicApp(updated) };
};
