import { userCanManageApp } from '../accounts/accountLinks';
import { findUserById, toPublicUser } from '../auth/users';
import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { getSubscription, setSubscription } from '../subscriptions/subscriptions';
import { QUOTA_OVERRIDE_BOUNDS, type SubscriptionTierDescriptor } from '../subscriptions/tierCatalog';
import { getSubscriptionTierVersion, listLiveSubscriptionTiers } from '../subscriptions/tierCatalogStore';
import { appStoragePolicyOf, findAppByClientId } from './apps';
import { effectiveAppUserAllowance, remainingStorageBytes, storedByteCount } from './appStorageCore';
import { APP_STORAGE_KIND, setAppUserStorageAllowance } from './namespace';
import { scopeCovers, sessionScopes } from './scopes';

// App-owner storage management. This is deliberately separate from /admin:
// the registering owner and linked co-managers may manage only their own app,
// while platform admins retain the cross-app directory in PR #171.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const MAX_LISTED_APP_USERS = 200;
export const MAX_BULK_APP_USERS = MAX_LISTED_APP_USERS;
const MAX_USER_ALLOWANCE_BYTES = QUOTA_OVERRIDE_BOUNDS.appStorageBytes.max;

const asIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseAllowance = (value: unknown): number | null => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_USER_ALLOWANCE_BYTES) return null;
  return Number(value);
};

const resolveManagedApp = async (managerId: string, clientId: unknown) => {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (!id) return fail(400, 'clientId is required');
  const app = await findAppByClientId(id);
  if (!app || !(await userCanManageApp(managerId, app))) return fail(404, 'App not found');
  return { ok: true as const, app, clientId: id };
};

export type ManagedAppStorageUser = {
  userId: string;
  // Username is shown only when at least one grant shared profile.username.
  username: string | null;
  usedBytes: number;
  storageAllowanceBytes: number;
  storageRemainingBytes: number;
  storageAllowanceOverrideBytes: number | null;
  storageAllowanceSource: 'app-default' | 'custom';
  activeGrant: boolean;
  lastSeenAt: string | null;
};

export type ManagedAppStorage = {
  clientId: string;
  name: string;
  subscription: Awaited<ReturnType<typeof getSubscription>>;
  storageAllowanceBytes: number | null;
  storageUsedBytes: number;
  storageRemainingBytes: number | null;
  defaultUserStorageAllowanceBytes: number;
  storageAccountingReady: boolean;
  users: ManagedAppStorageUser[];
  usersTruncated: boolean;
  tiers: Array<SubscriptionTierDescriptor & { storageAllowanceBytes: number | null; selectable: boolean }>;
};

const loadUsernames = async (userIds: string[]): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  // Keep database fan-out bounded while the dual-era users store remains.
  for (let offset = 0; offset < userIds.length; offset += 25) {
    const batch = await Promise.all(userIds.slice(offset, offset + 25).map((id) => findUserById(id)));
    for (const user of batch) {
      if (!user) continue;
      const pub = toPublicUser(user);
      names.set(pub.id, pub.username);
    }
  }
  return names;
};

export const getManagedAppStorage = async (managerId: string, clientId: unknown): Promise<{ ok: true; storage: ManagedAppStorage } | Fail> => {
  const managed = await resolveManagedApp(managerId, clientId);
  if (managed.ok === false) return managed;

  const { app, clientId: id } = managed;
  const things = await getThingsCollection();
  const sessions = await getSessionsCollection();
  const now = new Date();

  const [subscription, counters, sessionUsers, liveTiers] = await Promise.all([
    getSubscription('app', id),
    things
      .find(
        { 'crystal.quotaKind': APP_STORAGE_KIND, 'crystal.appId': id },
        {
          projection: {
            ownerId: 1,
            updatedAt: 1,
            'crystal.usedBytes': 1,
            'crystal.storageAllowanceBytes': 1
          }
        }
      )
      .sort({ updatedAt: -1 })
      .limit(MAX_LISTED_APP_USERS + 1)
      .toArray(),
    sessions
      .aggregate([
        { $match: { purpose: 'app', 'meta.clientId': id } },
        {
          $group: {
            _id: '$userId',
            lastSeenAt: { $max: '$createdAt' },
            activeGrant: {
              $max: {
                $cond: [
                  {
                    $and: [{ $eq: ['$revokedAt', null] }, { $or: [{ $eq: ['$expiresAt', null] }, { $gt: ['$expiresAt', now] }] }]
                  },
                  1,
                  0
                ]
              }
            }
          }
        },
        { $sort: { lastSeenAt: -1 } },
        { $limit: MAX_LISTED_APP_USERS + 1 }
      ])
      .toArray(),
    listLiveSubscriptionTiers()
  ]);

  // An app may still be pinned to an archived revision. Keep that exact card
  // visible as "current" without making archived revisions newly selectable.
  const assignedTier = await getSubscriptionTierVersion(subscription.tierVersionId);
  const visibleTiers = [...liveTiers];
  if (assignedTier && !visibleTiers.some((tier) => tier.versionId === assignedTier.versionId)) {
    visibleTiers.push(assignedTier);
  }

  const byUser = new Map<
    string,
    {
      userId: string;
      usedBytes: number;
      overrideBytes: number | null;
      updatedAt: Date | null;
      activeGrant: boolean;
      lastSeenAt: Date | null;
    }
  >();
  for (const counter of counters) {
    const userId = String(counter.ownerId ?? '');
    if (!userId) continue;
    const rawOverride = counter.crystal?.storageAllowanceBytes;
    byUser.set(userId, {
      userId,
      usedBytes: storedByteCount(counter.crystal?.usedBytes, 0),
      overrideBytes: parseAllowance(rawOverride),
      updatedAt: counter.updatedAt instanceof Date ? counter.updatedAt : null,
      activeGrant: false,
      lastSeenAt: null
    });
  }
  for (const row of sessionUsers) {
    const userId = String(row._id ?? '');
    if (!userId) continue;
    const current = byUser.get(userId) ?? {
      userId,
      usedBytes: 0,
      overrideBytes: null,
      updatedAt: null,
      activeGrant: false,
      lastSeenAt: null
    };
    current.activeGrant = row.activeGrant === 1;
    current.lastSeenAt = row.lastSeenAt instanceof Date ? row.lastSeenAt : null;
    byUser.set(userId, current);
  }

  const usersTruncated = counters.length > MAX_LISTED_APP_USERS || sessionUsers.length > MAX_LISTED_APP_USERS;
  const selected = [...byUser.values()]
    .sort((a, b) => {
      const aTime = a.lastSeenAt?.getTime() ?? a.updatedAt?.getTime() ?? 0;
      const bTime = b.lastSeenAt?.getTime() ?? b.updatedAt?.getTime() ?? 0;
      return bTime - aTime || a.userId.localeCompare(b.userId);
    })
    .slice(0, MAX_LISTED_APP_USERS);
  const selectedIds = selected.map((row) => row.userId);
  const grantSessions = selectedIds.length
    ? await sessions
        .find(
          {
            purpose: 'app',
            'meta.clientId': id,
            userId: { $in: selectedIds },
            revokedAt: null,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
          },
          { projection: { userId: 1, 'meta.scopes': 1 } }
        )
        .toArray()
    : [];
  const mayShowUsername = new Set<string>();
  for (const session of grantSessions) {
    if (scopeCovers(sessionScopes(session.meta), 'profile.username')) mayShowUsername.add(String(session.userId));
  }
  const usernames = await loadUsernames(selectedIds.filter((userId) => mayShowUsername.has(userId)));

  const policy = appStoragePolicyOf(app);
  const users: ManagedAppStorageUser[] = selected.map((row) => {
    const allowanceBytes = effectiveAppUserAllowance(policy.userStorageAllowanceBytes, row.overrideBytes, policy.storageAllowanceBytes);
    return {
      userId: row.userId,
      username: usernames.get(row.userId) ?? null,
      usedBytes: row.usedBytes,
      storageAllowanceBytes: allowanceBytes,
      storageRemainingBytes: remainingStorageBytes({ usedBytes: row.usedBytes, allowanceBytes }) ?? 0,
      storageAllowanceOverrideBytes: row.overrideBytes,
      storageAllowanceSource: row.overrideBytes === null ? 'app-default' : 'custom',
      activeGrant: row.activeGrant,
      lastSeenAt: asIso(row.lastSeenAt ?? row.updatedAt)
    };
  });
  const aggregateRemaining = remainingStorageBytes({
    usedBytes: policy.storageUsedBytes,
    allowanceBytes: policy.storageAllowanceBytes
  });

  return {
    ok: true,
    storage: {
      clientId: id,
      name: String(app.crystal?.name ?? ''),
      subscription,
      storageAllowanceBytes: policy.storageAllowanceBytes,
      storageUsedBytes: policy.storageUsedBytes,
      storageRemainingBytes: aggregateRemaining,
      defaultUserStorageAllowanceBytes: policy.userStorageAllowanceBytes,
      storageAccountingReady: policy.ready,
      users,
      usersTruncated,
      tiers: visibleTiers
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || b.version - a.version)
        .map((tier) => ({
          ...tier,
          storageAllowanceBytes: tier.quotas.appStorageBytes,
          selectable: tier.status === 'live'
        }))
    }
  };
};

export const setManagedAppStorageTier = async (
  managerId: string,
  clientId: unknown,
  tier: unknown,
  tierVersionId?: unknown
): Promise<{ ok: true } | Fail> => {
  const managed = await resolveManagedApp(managerId, clientId);
  if (managed.ok === false) return managed;
  const current = await getSubscription('app', managed.clientId);
  if (current.overrides) {
    return fail(409, 'This app has a custom storage plan — ask a Thingtime administrator to change it');
  }
  const result = await setSubscription({
    subjectType: 'app',
    subjectId: managed.clientId,
    ownerId: String(managed.app.ownerId),
    tier,
    tierVersionId,
    overrides: null,
    updatedBy: managerId
  });
  return result.ok ? { ok: true } : result;
};

export const setManagedAppDefaultUserAllowance = async (
  managerId: string,
  clientId: unknown,
  allowanceInput: unknown
): Promise<{ ok: true } | Fail> => {
  const allowanceBytes = parseAllowance(allowanceInput);
  if (allowanceBytes === null) {
    return fail(400, `allowanceBytes must be an integer from 0 to ${MAX_USER_ALLOWANCE_BYTES}`);
  }
  const managed = await resolveManagedApp(managerId, clientId);
  if (managed.ok === false) return managed;
  const policy = appStoragePolicyOf(managed.app);
  if (policy.storageAllowanceBytes !== null && allowanceBytes > policy.storageAllowanceBytes) {
    return fail(400, 'The default app-user allowance cannot exceed the app’s total storage allowance');
  }
  const updated = await (
    await getThingsCollection()
  ).updateOne(
    {
      thingtime: 'app',
      'crystal.clientId': managed.clientId,
      // Re-check the aggregate ceiling in the same atomic write. A concurrent
      // plan downgrade must not leave a newly-saved default above the app's
      // total, even though runtime admission would still clamp it safely.
      $expr: {
        $or: [{ $eq: ['$crystal.storageAllowanceBytes', null] }, { $gte: ['$crystal.storageAllowanceBytes', allowanceBytes] }]
      }
    },
    {
      $set: { 'crystal.userStorageAllowanceBytes': allowanceBytes, updatedAt: new Date() }
    }
  );
  return updated.matchedCount ? { ok: true } : fail(409, 'The app storage plan changed — refresh and choose a cap within its current total');
};

export const setManagedAppUserAllowances = async (
  managerId: string,
  clientId: unknown,
  userIdsInput: unknown,
  allowanceInput: unknown
): Promise<{ ok: true; updated: number } | Fail> => {
  if (!Array.isArray(userIdsInput)) return fail(400, 'userIds must be a list');
  const userIds = [...new Set(userIdsInput.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean))];
  if (!userIds.length) return fail(400, 'Select at least one app user');
  if (userIds.length > MAX_BULK_APP_USERS) {
    return fail(400, `At most ${MAX_BULK_APP_USERS} app users can be changed at once`);
  }
  const clearing = allowanceInput === null;
  const allowanceBytes = clearing ? null : parseAllowance(allowanceInput);
  if (!clearing && allowanceBytes === null) {
    return fail(400, `allowanceBytes must be an integer from 0 to ${MAX_USER_ALLOWANCE_BYTES}, or null`);
  }
  const managed = await resolveManagedApp(managerId, clientId);
  if (managed.ok === false) return managed;
  const policy = appStoragePolicyOf(managed.app);
  if (allowanceBytes !== null && policy.storageAllowanceBytes !== null && allowanceBytes > policy.storageAllowanceBytes) {
    return fail(400, 'An app-user allowance cannot exceed the app’s total storage allowance');
  }

  const [counterUsers, sessionUsers] = await Promise.all([
    (
      await getThingsCollection()
    ).distinct('ownerId', {
      'crystal.quotaKind': APP_STORAGE_KIND,
      'crystal.appId': managed.clientId,
      ownerId: { $in: userIds }
    }),
    (
      await getSessionsCollection()
    ).distinct('userId', {
      purpose: 'app',
      'meta.clientId': managed.clientId,
      userId: { $in: userIds }
    })
  ]);
  const known = new Set([...counterUsers, ...sessionUsers].map(String));
  const unknown = userIds.filter((userId) => !known.has(userId));
  if (unknown.length) return fail(404, `${unknown.length} selected account(s) are not users of this app`);

  let updated = 0;
  for (let offset = 0; offset < userIds.length; offset += 10) {
    const results = await Promise.all(
      userIds.slice(offset, offset + 10).map((userId) => setAppUserStorageAllowance(userId, managed.clientId, allowanceBytes))
    );
    updated += results.length;
  }
  return { ok: true, updated };
};
