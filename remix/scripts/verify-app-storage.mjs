#!/usr/bin/env node
// Live, public-API-only verification for registered-app storage accounting.
// Creates one app and two users against the supplied disposable environment,
// proves owner plan/default/single/bulk sub-tier management, then proves the
// app aggregate and each per-user ledger reserve/refund together. Never point
// this at production: the verifier intentionally creates accounts, an app,
// grants, and app-data entries.
//
//   node scripts/verify-app-storage.mjs http://127.0.0.1:18280

// The URL is mandatory so an accidental invocation cannot default to a live
// Thingtime deployment.

const BASE = process.argv[2];

if (!BASE || !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/i.test(BASE)) {
  console.error('Usage: node scripts/verify-app-storage.mjs http://127.0.0.1:<port>');
  process.exit(2);
}

const ORIGIN = 'http://localhost:4545';
const APP_ALLOWANCE = 5 * 1024 * 1024 * 1024;
const PLUS_APP_ALLOWANCE = 25 * 1024 * 1024 * 1024;
const USER_ALLOWANCE = 50 * 1024 * 1024;
const MANAGED_DEFAULT_ALLOWANCE = 64 * 1024 * 1024;
const MANAGED_USER_ALLOWANCE = 80 * 1024 * 1024;
const MANAGED_SINGLE_USER_ALLOWANCE = 96 * 1024 * 1024;
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

let passed = 0;
const failures = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
    return;
  }

  failures.push(name);
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const api = async (path, { cookie, token, method = 'GET', body, origin } = {}) => {
  const response = await fetch(`${BASE.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    // Call sites assert status and the expected JSON body.
  }

  return { status: response.status, body: json };
};

const register = async (label) => {
  const username = `quota-${label}-${suffix}`;
  const response = await fetch(`${BASE.replace(/\/$/, '')}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: `Quota-${suffix}-9!`,
      email: `${username}@example.com`
    })
  });
  const cookie = (response.headers.get('set-cookie') || '').match(/tt_auth=[^;]+/)?.[0];

  if (!response.ok || !cookie) {
    throw new Error(`Could not register ${label}: HTTP ${response.status}`);
  }

  const me = await api('/api/v1/auth/me', { cookie });
  if (me.status !== 200 || typeof me.body?.user?.id !== 'string') {
    throw new Error(`Could not resolve ${label}'s user id: HTTP ${me.status}`);
  }

  return { cookie, username, id: me.body.user.id };
};

const authorize = async (cookie, clientId) => {
  const result = await api('/api/v1/oauth/authorize', {
    cookie,
    method: 'POST',
    body: {
      clientId,
      origin: ORIGIN,
      scope: 'app-data',
      optionalScope: '',
      extra: '0',
      scopes: ['profile.username', 'app-data']
    }
  });

  if (result.status !== 200 || typeof result.body?.token !== 'string') {
    throw new Error(`Could not authorize app: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  }

  return result.body.token;
};

const usage = (token) => api('/api/v1/app-data/usage', { token, origin: ORIGIN });
const setEntry = (token, key, value) =>
  api('/api/v1/app-data', { token, origin: ORIGIN, method: 'POST', body: { key, value } });
const deleteEntry = (token, key) =>
  api('/api/v1/app-data/delete', { token, origin: ORIGIN, method: 'POST', body: { key } });

console.log(`Verifying registered-app storage against ${BASE}\n`);

const developer = await register('developer');
const secondUser = await register('member');

const created = await api('/api/v1/apps', {
  cookie: developer.cookie,
  method: 'POST',
  body: { name: `Quota verification ${suffix}`, origins: [ORIGIN] }
});
const app = created.body?.app;
const clientId = app?.clientId;

check('registered app exposes the 5 GiB app allowance', app?.storageAllowanceBytes === APP_ALLOWANCE);
check('registered app exposes the 50 MiB per-user allowance', app?.userStorageAllowanceBytes === USER_ALLOWANCE);
check('new app aggregate starts at zero and ready', app?.storageUsedBytes === 0 && app?.storageAccountingReady === true);

if (created.status !== 200 || typeof clientId !== 'string') {
  throw new Error(`Could not create app: HTTP ${created.status} ${JSON.stringify(created.body)}`);
}

const ignoredQuotaUpdate = await api('/api/v1/apps/update', {
  cookie: developer.cookie,
  method: 'POST',
  body: {
    clientId,
    name: app.name,
    storageAllowanceBytes: 1,
    storageUsedBytes: APP_ALLOWANCE,
    userStorageAllowanceBytes: 1
  }
});
check(
  'developer updates cannot self-raise or rewrite server-owned quotas',
  ignoredQuotaUpdate.body?.app?.storageAllowanceBytes === APP_ALLOWANCE &&
    ignoredQuotaUpdate.body?.app?.storageUsedBytes === 0 &&
    ignoredQuotaUpdate.body?.app?.userStorageAllowanceBytes === USER_ALLOWANCE
);

const developerToken = await authorize(developer.cookie, clientId);
const memberToken = await authorize(secondUser.cookie, clientId);

const managementPath = `/api/v1/apps/storage?clientId=${encodeURIComponent(clientId)}`;
const initialManagement = await api(managementPath, { cookie: developer.cookie });
check(
  'app owner can open storage management for both known app users',
  initialManagement.status === 200 &&
    initialManagement.body?.storage?.subscription?.tier === 'free' &&
    initialManagement.body?.storage?.users?.some((row) => row.userId === developer.id) &&
    initialManagement.body?.storage?.users?.some((row) => row.userId === secondUser.id)
);

const nonManagerView = await api(managementPath, { cookie: secondUser.cookie });
check('an app user who is not a manager cannot inspect app-wide storage', nonManagerView.status === 404);

const upgraded = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: { action: 'set-tier', clientId, tier: 'plus' }
});
check(
  'app owner upgrades the aggregate plan to Plus atomically',
  upgraded.status === 200 &&
    upgraded.body?.storage?.subscription?.tier === 'plus' &&
    upgraded.body?.storage?.storageAllowanceBytes === PLUS_APP_ALLOWANCE
);

const defaultUpdated = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: { action: 'set-default-user-cap', clientId, allowanceBytes: MANAGED_DEFAULT_ALLOWANCE }
});
check(
  'app owner changes the default app-user cap',
  defaultUpdated.status === 200 &&
    defaultUpdated.body?.storage?.defaultUserStorageAllowanceBytes === MANAGED_DEFAULT_ALLOWANCE &&
    defaultUpdated.body?.storage?.users?.every((row) => row.storageAllowanceBytes === MANAGED_DEFAULT_ALLOWANCE)
);

const bulkUpdated = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: {
    action: 'set-user-cap',
    clientId,
    userIds: [developer.id, secondUser.id],
    allowanceBytes: MANAGED_USER_ALLOWANCE
  }
});
check(
  'multi-select assigns a custom sub-tier to both app users',
  bulkUpdated.status === 200 &&
    bulkUpdated.body?.updated === 2 &&
    bulkUpdated.body?.storage?.users?.filter((row) => [developer.id, secondUser.id].includes(row.userId))
      .every((row) => row.storageAllowanceSource === 'custom' && row.storageAllowanceBytes === MANAGED_USER_ALLOWANCE)
);

const oneUpdated = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: {
    action: 'set-user-cap',
    clientId,
    userIds: [secondUser.id],
    allowanceBytes: MANAGED_SINGLE_USER_ALLOWANCE
  }
});
const individuallyManaged = oneUpdated.body?.storage?.users?.find((row) => row.userId === secondUser.id);
check(
  'an individual app user can be moved to a different sub-tier',
  oneUpdated.status === 200 &&
    individuallyManaged?.storageAllowanceSource === 'custom' &&
    individuallyManaged?.storageAllowanceBytes === MANAGED_SINGLE_USER_ALLOWANCE
);

const badDefault = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: { action: 'set-default-user-cap', clientId, allowanceBytes: PLUS_APP_ALLOWANCE + 1 }
});
check('default user cap cannot exceed the whole-app plan', badDefault.status === 400);

const badIndividual = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: {
    action: 'set-user-cap',
    clientId,
    userIds: [secondUser.id],
    allowanceBytes: PLUS_APP_ALLOWANCE + 1
  }
});
check('individual sub-tier cannot exceed the whole-app plan', badIndividual.status === 400);

const usersReset = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: {
    action: 'set-user-cap',
    clientId,
    userIds: [developer.id, secondUser.id],
    allowanceBytes: null
  }
});
check(
  'multi-select reset returns both users to the app default',
  usersReset.status === 200 &&
    usersReset.body?.storage?.users?.filter((row) => [developer.id, secondUser.id].includes(row.userId))
      .every((row) => row.storageAllowanceSource === 'app-default' && row.storageAllowanceBytes === MANAGED_DEFAULT_ALLOWANCE)
);

await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: { action: 'set-default-user-cap', clientId, allowanceBytes: USER_ALLOWANCE }
});
const planReset = await api('/api/v1/apps/storage', {
  cookie: developer.cookie,
  method: 'POST',
  body: { action: 'set-tier', clientId, tier: 'free' }
});
check(
  'owner can return the app to Free without disturbing its user-ledger usage',
  planReset.status === 200 &&
    planReset.body?.storage?.subscription?.tier === 'free' &&
    planReset.body?.storage?.storageAllowanceBytes === APP_ALLOWANCE &&
    planReset.body?.storage?.defaultUserStorageAllowanceBytes === USER_ALLOWANCE
);

const initial = await usage(developerToken);
check(
  'usage returns backward-compatible aliases plus both ledgers',
  initial.status === 200 &&
    initial.body?.usedBytes === 0 &&
    initial.body?.budgetBytes === USER_ALLOWANCE &&
    initial.body?.userStorage?.usedBytes === 0 &&
    initial.body?.appStorage?.usedBytes === 0
);

const firstWrite = await setEntry(developerToken, 'first', { owner: developer.username, note: 'one' });
check('first app user can write', firstWrite.status === 200 && firstWrite.body?.ok === true);

const afterFirst = await usage(developerToken);
const firstBytes = afterFirst.body?.userStorage?.usedBytes;
check(
  'first write reserves the same bytes in user and app ledgers',
  Number.isSafeInteger(firstBytes) && firstBytes > 0 && afterFirst.body?.appStorage?.usedBytes === firstBytes
);

const secondBefore = await usage(memberToken);
check(
  'second user starts with an independent empty user ledger but sees the app aggregate',
  secondBefore.body?.userStorage?.usedBytes === 0 && secondBefore.body?.appStorage?.usedBytes === firstBytes
);

const secondWrite = await setEntry(memberToken, 'second', { owner: secondUser.username, note: 'two-two' });
check('second app user can write', secondWrite.status === 200 && secondWrite.body?.ok === true);

const afterSecondForMember = await usage(memberToken);
const secondBytes = afterSecondForMember.body?.userStorage?.usedBytes;
check(
  'whole-app usage is the sum while the second user keeps a separate ledger',
  Number.isSafeInteger(secondBytes) &&
    secondBytes > 0 &&
    afterSecondForMember.body?.appStorage?.usedBytes === firstBytes + secondBytes
);

const listedApps = await api('/api/v1/apps', { cookie: developer.cookie });
const listedApp = listedApps.body?.apps?.find((candidate) => candidate.clientId === clientId);
check(
  'app owner list exposes current aggregate usage and remaining bytes',
  listedApp?.storageUsedBytes === firstBytes + secondBytes &&
    listedApp?.storageRemainingBytes === APP_ALLOWANCE - firstBytes - secondBytes
);

const deleteFirst = await deleteEntry(developerToken, 'first');
check('deleting the first entry succeeds', deleteFirst.status === 200 && deleteFirst.body?.deleted === true);

const afterDelete = await usage(developerToken);
check(
  'delete refunds both the first user and whole-app ledgers',
  afterDelete.body?.userStorage?.usedBytes === 0 && afterDelete.body?.appStorage?.usedBytes === secondBytes
);
check(
  'remaining-byte fields agree with the persisted ledgers',
  afterDelete.body?.userStorage?.remainingBytes === USER_ALLOWANCE &&
    afterDelete.body?.appStorage?.remainingBytes === APP_ALLOWANCE - secondBytes
);

const racingValues = [
  { winner: 'large', payload: 'x'.repeat(8192) },
  { winner: 'small', payload: 'y' }
];
const racingWrites = await Promise.all(
  racingValues.map((value) => setEntry(developerToken, 'same-key-race', value))
);
check(
  'concurrent writes to one new key both resolve without leaking a reservation',
  racingWrites.every((result) => result.status === 200 && result.body?.ok === true)
);

const raceRead = await api('/api/v1/app-data?key=same-key-race', {
  token: developerToken,
  origin: ORIGIN
});
const finalRaceValue = raceRead.body?.entry?.value;
const finalRaceBytes = Buffer.byteLength(
  JSON.stringify({
    crystal: { appId: clientId, key: 'same-key-race', value: finalRaceValue },
    extended: null,
    tags: []
  }),
  'utf8'
);
const afterRace = await usage(developerToken);
check(
  'same-key compare-and-swap leaves both ledgers equal to the winning stored size',
  raceRead.status === 200 &&
    racingValues.some((value) => JSON.stringify(value) === JSON.stringify(finalRaceValue)) &&
    afterRace.body?.userStorage?.usedBytes === finalRaceBytes &&
    afterRace.body?.appStorage?.usedBytes === secondBytes + finalRaceBytes,
  JSON.stringify({
    raceStatus: raceRead.status,
    finalRaceBytes,
    userUsedBytes: afterRace.body?.userStorage?.usedBytes,
    appUsedBytes: afterRace.body?.appStorage?.usedBytes,
    expectedAppUsedBytes: secondBytes + finalRaceBytes
  })
);

await deleteEntry(developerToken, 'same-key-race');
const afterRaceDelete = await usage(developerToken);
check(
  'deleting the raced key returns both ledgers to their exact baselines',
  afterRaceDelete.body?.userStorage?.usedBytes === 0 &&
    afterRaceDelete.body?.appStorage?.usedBytes === secondBytes
);

const genericCreated = await api('/api/v1/things', {
  token: developerToken,
  origin: ORIGIN,
  method: 'POST',
  body: { thingtime: ['data'], crystal: { note: 'seed' } }
});
const genericThingId = genericCreated.body?.thing?.id;
check(
  'an app-token generic Thing write is charged to both ledgers',
  genericCreated.status === 200 && typeof genericThingId === 'string'
);

const genericBeforeOwnerEdit = await usage(developerToken);
const ownerEdited = await api('/api/v1/things', {
  cookie: developer.cookie,
  method: 'PATCH',
  body: { id: genericThingId, crystal: { note: 'grown-by-owner-'.repeat(256) } }
});
const genericAfterOwnerEdit = await usage(developerToken);
check(
  'first-party owner growth remains charged to the app and app-user allowances',
  ownerEdited.status === 200 &&
    genericAfterOwnerEdit.body?.userStorage?.usedBytes > genericBeforeOwnerEdit.body?.userStorage?.usedBytes &&
    genericAfterOwnerEdit.body?.appStorage?.usedBytes - secondBytes ===
      genericAfterOwnerEdit.body?.userStorage?.usedBytes
);

const ownerDeleted = await api(`/api/v1/things?id=${encodeURIComponent(genericThingId)}`, {
  cookie: developer.cookie,
  method: 'DELETE'
});
const afterOwnerDelete = await usage(developerToken);
check(
  'first-party owner delete atomically refunds both ledgers',
  ownerDeleted.status === 200 &&
    afterOwnerDelete.body?.userStorage?.usedBytes === 0 &&
    afterOwnerDelete.body?.appStorage?.usedBytes === secondBytes
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
