#!/usr/bin/env node
// Live verification of the admin management plane: subscription tiers +
// overrides (free/plus/pro/payg), quota enforcement (app caps + storage
// budgets resolving through tiers), app suspension (revoke/restore), and
// account/app ownership links (assume + co-management). Real API only, no
// mocks, no direct DB access (FUNDAMENTALS §2).
//
//   TT_VERIFY_ADMIN_USER=<env-admin username> TT_VERIFY_ADMIN_PASS=<password> \
//     node scripts/verify-admin-subscriptions.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or http://127.0.0.1:14342. The admin
// user must exist and be an admin (easiest: register a throwaway user, then
// restart the dev stack with ADMIN_USERNAMES=<that username> — registering a
// name ALREADY on the allowlist is refused, so register first).

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:14342';
const ADMIN_USER = process.env.TT_VERIFY_ADMIN_USER || '';
const ADMIN_PASS = process.env.TT_VERIFY_ADMIN_PASS || '';

if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('TT_VERIFY_ADMIN_USER and TT_VERIFY_ADMIN_PASS are required (an env-admin account on the target server).');
  process.exit(1);
}

let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const api = async (path, { cookie, token, method = 'GET', body, origin, headers = {} } = {}) => {
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  let response;
  try {
    response = await doFetch();
  } catch {
    response = await doFetch(); // one clean retry for a poisoned keep-alive socket
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON — callers assert on status
  }
  return { status: response.status, body: json, headers: response.headers };
};

const authCookieFrom = (headers) => {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie().join('\n') : headers.get('set-cookie') || '';
  const match = raw.match(/tt_auth=[^;]+/g);
  return match ? match[match.length - 1] : null;
};

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const GB = 1024 * 1024 * 1024;

const registerSession = async (name) => {
  const username = `admv-${name}-${suffix}`;
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `Verify-${suffix}-9!`, email: `${username}@example.com` })
  });
  const cookie = authCookieFrom(res.headers);
  if (!res.ok || !cookie) throw new Error(`register failed: ${res.status}`);
  const me = await api('/api/v1/auth/me', { cookie });
  if (!me.body?.user?.id) throw new Error('me lookup failed after register');
  return { username, cookie, id: me.body.user.id };
};

console.log(`Verifying the admin management plane against ${BASE}\n`);

// --- sessions ---------------------------------------------------------------
const loginRes = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
});
const adminCookie = authCookieFrom(loginRes.headers);
if (!adminCookie) {
  console.error(`Admin login failed (${loginRes.status}) — check TT_VERIFY_ADMIN_USER/PASS.`);
  process.exit(1);
}
const adminMe = await api('/api/v1/auth/me', { cookie: adminCookie });
if (!adminMe.body?.user?.isAdmin) {
  console.error(`${ADMIN_USER} is not an admin on ${BASE} — add it to ADMIN_USERNAMES and restart the server.`);
  process.exit(1);
}

const owner = await registerSession('owner'); // the human who owns things
const target = await registerSession('bot'); // the account that will be owned
const bystander = await registerSession('bystander');

let freeTier = null;
let plusTier = null;
let proTier = null;

// ---------------------------------------------------------------------------
console.log('A. Subscription tiers + overrides');
{
  const publicCatalog = await api('/api/v1/tiers');
  const publicTiers = Array.isArray(publicCatalog.body?.tiers) ? publicCatalog.body.tiers : [];
  check(
    'public catalog exposes only live, immutable tier-card revisions',
    publicCatalog.status === 200 &&
      publicCatalog.body?.ok === true &&
      publicTiers.length >= 4 &&
      new Set(publicTiers.map((tier) => tier.versionId)).size === publicTiers.length &&
      publicTiers.every(
        (tier) =>
          typeof tier?.id === 'string' &&
          typeof tier?.versionId === 'string' &&
          Number.isSafeInteger(tier?.version) &&
          tier.version > 0 &&
          tier.status === 'live' &&
          tier.prices &&
          tier.discounts &&
          tier.inclusions?.kind === 'rich-text' &&
          Array.isArray(tier.inclusions.blocks) &&
          tier.quotas &&
          typeof tier.quotas === 'object'
      )
  );

  const tierVersions = await api('/api/v1/admin/tiers', { cookie: adminCookie });
  const allTierVersions = Array.isArray(tierVersions.body?.tiers) ? tierVersions.body.tiers : [];
  const liveTierVersions = Array.isArray(tierVersions.body?.live) ? tierVersions.body.live : [];
  const draftTierVersions = Array.isArray(tierVersions.body?.drafts) ? tierVersions.body.drafts : [];
  const archivedTierVersions = Array.isArray(tierVersions.body?.archived) ? tierVersions.body.archived : [];
  check(
    'admin tier catalog separates live, draft, and archived immutable revisions',
    tierVersions.status === 200 &&
      tierVersions.body?.ok === true &&
      allTierVersions.length === liveTierVersions.length + draftTierVersions.length + archivedTierVersions.length &&
      liveTierVersions.every((tier) => tier.status === 'live') &&
      draftTierVersions.every((tier) => tier.status === 'draft') &&
      archivedTierVersions.every((tier) => tier.status === 'archived') &&
      new Set(allTierVersions.map((tier) => tier.versionId)).size === allTierVersions.length
  );

  const catalog = await api('/api/v1/admin/subscriptions', { cookie: adminCookie });
  const pickerTiers = Array.isArray(catalog.body?.catalog) ? catalog.body.catalog : [];
  check(
    'subscription picker matches the dynamic public live catalog',
    catalog.body?.ok === true &&
      pickerTiers
        .map((tier) => tier.versionId)
        .sort()
        .join('\0') ===
        publicTiers
          .map((tier) => tier.versionId)
          .sort()
          .join('\0')
  );

  freeTier = publicTiers.find((tier) => tier.id === 'free') ?? null;
  plusTier = publicTiers.find((tier) => tier.id === 'plus') ?? null;
  proTier = publicTiers.find((tier) => tier.id === 'pro') ?? null;
  const paygTier = publicTiers.find((tier) => tier.id === 'payg') ?? null;
  check('core tiers remain addressable by stable id', !!freeTier && !!plusTier && !!proTier && !!paygTier);
  if (!freeTier || !plusTier || !proTier || !paygTier) {
    throw new Error('The verifier requires live free, plus, pro, and payg tier revisions.');
  }

  const tierCatalogDenied = await api('/api/v1/admin/tiers', { cookie: owner.cookie });
  check('non-admin cannot inspect tier version history', tierCatalogDenied.status === 403);

  const tierMutationDenied = await api('/api/v1/admin/tiers', {
    cookie: owner.cookie,
    method: 'POST',
    body: { action: 'archive', versionId: `missing-tier-version-${suffix}` }
  });
  check('non-admin cannot mutate tier lifecycle', tierMutationDenied.status === 403);

  const denied = await api('/api/v1/admin/subscriptions', {
    cookie: owner.cookie,
    method: 'POST',
    body: { subjectType: 'user', subjectId: owner.id, tier: proTier.id, tierVersionId: proTier.versionId }
  });
  check('non-admin cannot assign tiers', denied.status === 403);

  const badTier = await api('/api/v1/admin/subscriptions', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      subjectType: 'user',
      subjectId: owner.id,
      tier: `missing-tier-${suffix}`,
      tierVersionId: `missing-tier-version-${suffix}`
    }
  });
  check('unknown tier is 400', badTier.status === 400);

  const mismatchedTierVersion = await api('/api/v1/admin/subscriptions', {
    cookie: adminCookie,
    method: 'POST',
    body: { subjectType: 'user', subjectId: owner.id, tier: proTier.id, tierVersionId: plusTier.versionId }
  });
  check('tier assignment rejects a revision belonging to another tier', mismatchedTierVersion.status === 400);

  const assign = await api('/api/v1/admin/subscriptions', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      subjectType: 'user',
      subjectId: owner.id,
      tier: proTier.id,
      tierVersionId: proTier.versionId,
      overrides: { maxApps: 1 },
      note: 'verify suite'
    }
  });
  check(
    'assign exact live Pro revision + maxApps override',
    assign.body?.ok === true &&
      assign.body?.subscription?.tier === proTier.id &&
      assign.body?.subscription?.tierVersionId === proTier.versionId &&
      assign.body?.subscription?.tierVersion === proTier.version &&
      assign.body?.subscription?.effective?.maxApps === 1
  );

  const read = await api(`/api/v1/admin/subscriptions?subjectType=user&subjectId=${owner.id}`, { cookie: adminCookie });
  check(
    'read-back keeps the exact tier revision and note',
    read.body?.subscription?.isDefault === false &&
      read.body?.subscription?.tierVersionId === proTier.versionId &&
      read.body?.subscription?.note === 'verify suite'
  );

  const spoof = await api('/api/v1/things', {
    cookie: owner.cookie,
    method: 'POST',
    body: {
      thingtime: ['subscription'],
      crystal: {
        tier: proTier.id,
        tierVersionId: proTier.versionId,
        subjectType: 'user',
        subjectId: owner.id
      }
    }
  });
  check('subscription kind is protected from generic CRUD', spoof.status >= 400, `status ${spoof.status}`);
}

// ---------------------------------------------------------------------------
console.log('B. Tier quotas enforce (maxApps)');
let appA = null;
{
  const first = await api('/api/v1/apps', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Verify App A', origins: ['http://localhost:5599'] }
  });
  appA = first.body?.app ?? null;
  check(
    'first app registers under maxApps=1 with its own Free aggregate plan',
    first.body?.ok === true &&
      !!appA?.clientId &&
      appA?.subscriptionTier === 'free' &&
      appA?.storageAllowanceBytes === freeTier.quotas.appStorageBytes
  );

  const second = await api('/api/v1/apps', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Verify App B', origins: ['http://localhost:5599'] }
  });
  check('second app is refused at the override cap', second.status === 400, JSON.stringify(second.body)?.slice(0, 120));

  await api('/api/v1/admin/subscriptions', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      subjectType: 'user',
      subjectId: owner.id,
      tier: proTier.id,
      tierVersionId: proTier.versionId,
      overrides: { maxApps: null }
    }
  });
  const third = await api('/api/v1/apps', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Verify App C', origins: ['http://localhost:5599'] }
  });
  check('null override = unlimited apps', third.body?.ok === true);

  const customAppPlan = await api('/api/v1/admin/subscriptions', {
    cookie: adminCookie,
    method: 'POST',
    body: {
      subjectType: 'app',
      subjectId: appA.clientId,
      tier: plusTier.id,
      tierVersionId: plusTier.versionId,
      overrides: { appStorageBytes: 6 * GB },
      note: 'verify custom app plan'
    }
  });
  check(
    'admin app subscription updates the same aggregate allowance atomically',
    customAppPlan.body?.ok === true &&
      customAppPlan.body?.subscription?.tier === plusTier.id &&
      customAppPlan.body?.subscription?.tierVersionId === plusTier.versionId &&
      customAppPlan.body?.subscription?.effective?.appStorageBytes === 6 * GB
  );

  const ownerBlockedByCustomPlan = await api('/api/v1/apps/storage', {
    cookie: owner.cookie,
    method: 'POST',
    body: { action: 'set-tier', clientId: appA.clientId, tier: proTier.id, tierVersionId: proTier.versionId }
  });
  check('custom admin app plan locks owner self-service tier changes', ownerBlockedByCustomPlan.status === 409);

  const resetAppPlan = await api('/api/v1/admin/subscriptions', {
    cookie: adminCookie,
    method: 'POST',
    body: { subjectType: 'app', subjectId: appA.clientId, clear: true }
  });
  check(
    'admin reset returns the app aggregate to Free without a second ledger',
    resetAppPlan.body?.ok === true &&
      resetAppPlan.body?.subscription?.tier === freeTier.id &&
      resetAppPlan.body?.subscription?.tierVersionId === freeTier.versionId &&
      resetAppPlan.body?.subscription?.effective?.appStorageBytes === freeTier.quotas.appStorageBytes
  );
}

// ---------------------------------------------------------------------------
console.log('C. App suspension (revoke / restore)');
{
  const ORIGIN = 'http://localhost:5599';
  const grant = await api('/api/v1/oauth/authorize', {
    cookie: owner.cookie,
    method: 'POST',
    origin: ORIGIN,
    body: { clientId: appA.clientId, origin: ORIGIN, scopes: ['profile', 'app-data'] }
  });
  const appToken = grant.body?.token;
  check('authorize mints an app token', grant.body?.ok === true && !!appToken);

  const before = await api('/api/v1/app-data', { token: appToken, origin: ORIGIN });
  check('app token works before suspension', before.status === 200);

  const revoke = await api('/api/v1/admin/apps/revoke', {
    cookie: adminCookie,
    method: 'POST',
    body: { clientId: appA.clientId, revoked: true }
  });
  check('admin suspends the app', revoke.body?.ok === true && !!revoke.body?.app?.revokedAt);

  const after = await api('/api/v1/app-data', { token: appToken, origin: ORIGIN });
  check('existing token dies with the suspension', after.status === 401, `status ${after.status}`);

  const consent = await api(`/api/v1/apps/public?clientId=${appA.clientId}&origin=${encodeURIComponent(ORIGIN)}`, {});
  check('consent screen refuses while suspended', consent.status === 403);

  const reauth = await api('/api/v1/oauth/authorize', {
    cookie: owner.cookie,
    method: 'POST',
    origin: ORIGIN,
    body: { clientId: appA.clientId, origin: ORIGIN, scopes: ['profile', 'app-data'] }
  });
  check('authorize refuses while suspended', reauth.status === 403);

  const restore = await api('/api/v1/admin/apps/revoke', {
    cookie: adminCookie,
    method: 'POST',
    body: { clientId: appA.clientId, revoked: false }
  });
  check('admin restores the app', restore.body?.ok === true && restore.body?.app?.revokedAt === null);

  const reauth2 = await api('/api/v1/oauth/authorize', {
    cookie: owner.cookie,
    method: 'POST',
    origin: ORIGIN,
    body: { clientId: appA.clientId, origin: ORIGIN, scopes: ['profile', 'app-data'] }
  });
  check('re-authorize works after restore (old token stays dead)', reauth2.body?.ok === true && !!reauth2.body?.token);
}

// ---------------------------------------------------------------------------
console.log('D. Ownership links: assume + app co-management');
{
  const denied = await api('/api/v1/auth/accounts/assume', {
    cookie: owner.cookie,
    method: 'POST',
    body: { accountId: target.id }
  });
  check('assume without a link is 403', denied.status === 403);

  const link = await api('/api/v1/admin/links', {
    cookie: adminCookie,
    method: 'POST',
    body: { action: 'add', linkKind: 'account', userId: owner.id, targetId: target.id }
  });
  check('admin links the account', link.body?.ok === true);

  const owned = await api('/api/v1/auth/accounts/owned', { cookie: owner.cookie });
  check('owned list shows the linked account', owned.body?.ok === true && owned.body?.accounts?.some((account) => account.id === target.id));

  const assume = await api('/api/v1/auth/accounts/assume', {
    cookie: owner.cookie,
    method: 'POST',
    body: { accountId: target.id }
  });
  const assumedCookie = authCookieFrom(assume.headers);
  check('assume succeeds with the link', assume.body?.ok === true && !!assumedCookie);

  const assumedMe = await api('/api/v1/auth/me', { cookie: assumedCookie });
  check('assumed session IS the target account', assumedMe.body?.user?.id === target.id);

  const bystanderAssume = await api('/api/v1/auth/accounts/assume', {
    cookie: bystander.cookie,
    method: 'POST',
    body: { accountId: target.id }
  });
  check('links do not leak to other users', bystanderAssume.status === 403);

  // app co-management: bystander is linked to owner's app
  const before = await api('/api/v1/apps', { cookie: bystander.cookie });
  check('app absent from non-manager list', !(before.body?.apps ?? []).some((a) => a.clientId === appA.clientId));

  await api('/api/v1/admin/links', {
    cookie: adminCookie,
    method: 'POST',
    body: { action: 'add', linkKind: 'app', userId: bystander.id, targetId: appA.clientId }
  });
  const after = await api('/api/v1/apps', { cookie: bystander.cookie });
  check(
    'linked app appears in the co-manager list',
    (after.body?.apps ?? []).some((a) => a.clientId === appA.clientId)
  );

  const coManagerStorage = await api(`/api/v1/apps/storage?clientId=${encodeURIComponent(appA.clientId)}`, {
    cookie: bystander.cookie
  });
  check('linked co-manager can inspect the app storage policy', coManagerStorage.body?.ok === true);

  const coManagerUpdatesDefault = await api('/api/v1/apps/storage', {
    cookie: bystander.cookie,
    method: 'POST',
    body: { action: 'set-default-user-cap', clientId: appA.clientId, allowanceBytes: 72 * 1024 * 1024 }
  });
  check(
    'linked co-manager can update the default app-user cap',
    coManagerUpdatesDefault.body?.storage?.defaultUserStorageAllowanceBytes === 72 * 1024 * 1024
  );

  const rename = await api('/api/v1/apps/update', {
    cookie: bystander.cookie,
    method: 'POST',
    body: { clientId: appA.clientId, name: 'Verify App A (co-managed)' }
  });
  check('co-manager can update the app', rename.body?.ok === true);

  await api('/api/v1/admin/links', {
    cookie: adminCookie,
    method: 'POST',
    body: { action: 'remove', linkKind: 'app', userId: bystander.id, targetId: appA.clientId }
  });
  const gone = await api('/api/v1/apps/update', {
    cookie: bystander.cookie,
    method: 'POST',
    body: { clientId: appA.clientId, name: 'nope' }
  });
  check('removing the link removes access', gone.status === 404);

  const storageGone = await api(`/api/v1/apps/storage?clientId=${encodeURIComponent(appA.clientId)}`, {
    cookie: bystander.cookie
  });
  check('removing the link also removes storage-management access', storageGone.status === 404);
}

// ---------------------------------------------------------------------------
console.log('E. Admin overview endpoints');
{
  const users = await api(`/api/v1/admin/users/overview?q=${owner.username}`, { cookie: adminCookie });
  const row = users.body?.users?.find((entry) => entry.id === owner.id);
  check('users overview finds the owner with pro tier', row?.subscription?.tier === 'pro');
  check('users overview carries counts', typeof row?.counts?.apps === 'number' && row.counts.apps >= 2);

  const apps = await api('/api/v1/admin/apps?q=Verify%20App%20A', { cookie: adminCookie });
  const appRow = apps.body?.apps?.find((entry) => entry.clientId === appA.clientId);
  check('apps overview finds the app with its owner', appRow?.owner?.id === owner.id);
  check('apps overview reports live status', appRow?.revokedAt === null);

  const nonAdmin = await api('/api/v1/admin/apps', { cookie: owner.cookie });
  check('overviews are admin-only', nonAdmin.status === 403);
}

// ---------------------------------------------------------------------------
console.log('');
console.log(`${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((name) => `  ✗ ${name}`).join('\n'));
  process.exit(1);
}
