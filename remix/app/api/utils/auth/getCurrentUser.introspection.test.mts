import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

// introspectToken IS the answer POST /api/v1/auth/introspect gives an external
// platform, and every branch in it is a security decision: signature, live
// session, session↔subject binding, the app-sandbox owner carve-out, and the
// service-account gate. The API suite (app/tests/api/apiTests.ts) issues one
// request per test and cannot carry a freshly minted token from one to the
// next, so it can only reach the 400 and the bare { active: false } — the live
// revocation behaviour the endpoint exists for is covered here instead.
//
// The Mongo-backed collaborators are mocked, not seeded: nothing below writes
// to a database, so FUNDAMENTALS §1/§2 still hold. `namedExports` is the
// portable option key (plain `exports` is only understood by Node >= 24.19).

let claims: { sub: string; jti: string } | null = null;
let sessions: Record<string, any> = {};
let users: Record<string, any> = {};
let userLookups: string[] = [];

mock.module(new URL('./jwt.ts', import.meta.url).href, {
  namedExports: {
    verifyJwt: async () => claims
  }
});

mock.module(new URL('./sessions.ts', import.meta.url).href, {
  namedExports: {
    getLiveSession: async (jti: string) => sessions[jti] ?? null
  }
});

mock.module(new URL('./users.ts', import.meta.url).href, {
  namedExports: {
    findUserById: async (id: string) => {
      userLookups.push(id);
      return users[id] ?? null;
    },
    toPublicUser: (doc: any) => doc
  }
});

mock.module(new URL('../subscriptions/subscriptions.ts', import.meta.url).href, {
  namedExports: {
    getSubscription: async () => null
  }
});

const { introspectToken } = await import('./getCurrentUser.ts');

const USER_ID = '64f000000000000000000001';
const CREATED_AT = new Date('2026-07-01T00:00:00.000Z');
const EXPIRES_AT = new Date('2026-07-31T00:00:00.000Z');
const IAT = Math.floor(CREATED_AT.getTime() / 1000);
const EXP = Math.floor(EXPIRES_AT.getTime() / 1000);

const session = (overrides: Record<string, any> = {}) => ({
  jti: 'session-jti',
  userId: USER_ID,
  purpose: 'browser',
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
  revokedAt: null,
  ...overrides
});

beforeEach(() => {
  claims = { sub: USER_ID, jti: 'session-jti' };
  sessions = { 'session-jti': session() };
  users = { [USER_ID]: { _id: USER_ID, accountKind: 'user', emailVerified: true, createdAt: CREATED_AT } };
  userLookups = [];
});

test('a live browser session is active, with iat/exp read from the session record', async () => {
  assert.deepEqual(await introspectToken('token'), {
    active: true,
    sub: USER_ID,
    jti: 'session-jti',
    purpose: 'browser',
    iat: IAT,
    exp: EXP
  });
});

test('an unverifiable token is inactive and never reaches the session or user reads', async () => {
  claims = null;

  assert.deepEqual(await introspectToken('not-a-real-jwt'), { active: false });
  assert.deepEqual(userLookups, []);
});

test('a revoked or expired session is inactive — getLiveSession is the kill switch', async () => {
  // getLiveSession already filters revokedAt/expiresAt, so both revocation
  // (logout) and expiry arrive here as a missing session.
  sessions = {};

  assert.deepEqual(await introspectToken('token'), { active: false });
});

test('a session owned by another user is inactive — a live jti alone never proves the subject', async () => {
  sessions['session-jti'] = session({ userId: '64f000000000000000000002' });

  assert.deepEqual(await introspectToken('token'), { active: false });
});

test('a deleted owner is inactive even while the session record survives', async () => {
  users = {};

  assert.deepEqual(await introspectToken('token'), { active: false });
});

test('a service account past its email-verification deadline is inactive', async () => {
  users[USER_ID] = {
    _id: USER_ID,
    accountKind: 'service',
    emailVerified: false,
    createdAt: CREATED_AT,
    emailVerificationRequiredBy: new Date('2020-01-01T00:00:00.000Z')
  };

  assert.deepEqual(await introspectToken('token'), { active: false });
});

test('a legacy session with no purpose reports browser, matching sessionPurposeCanActAsAccount', async () => {
  sessions['session-jti'] = session({ purpose: undefined });

  assert.deepEqual(await introspectToken('token'), {
    active: true,
    sub: USER_ID,
    jti: 'session-jti',
    purpose: 'browser',
    iat: IAT,
    exp: EXP
  });
});

test('a non-expiring session reports exp: null rather than dropping the field', async () => {
  sessions['session-jti'] = session({ purpose: 'service', expiresAt: null });

  assert.deepEqual(await introspectToken('token'), {
    active: true,
    sub: USER_ID,
    jti: 'session-jti',
    purpose: 'service',
    iat: IAT,
    exp: null
  });
});

test('app-scoped tokens report active even though resolveSessionUser rejects them', async () => {
  // The deliberate difference from the session→user path: introspection reports
  // status for scoped credentials (external "Login with Thingtime" platforms are
  // the main caller) without granting them any capability.
  sessions['session-jti'] = session({ purpose: 'app' });

  assert.deepEqual(await introspectToken('token'), {
    active: true,
    sub: USER_ID,
    jti: 'session-jti',
    purpose: 'app',
    iat: IAT,
    exp: EXP
  });
});

test('sandbox tokens stay active without an owner document and skip the user read', async () => {
  // apps/sandbox.ts mints against a synthetic 'sandbox:<uuid>' owner that no
  // user document ever backs, so requiring one would report every live sandbox
  // token as inactive.
  const ownerId = 'sandbox:0d1b6f6e-1f2c-4c1d-9b4e-8f0f1c2d3e4f';
  claims = { sub: ownerId, jti: 'sandbox-jti' };
  sessions = { 'sandbox-jti': session({ jti: 'sandbox-jti', userId: ownerId, purpose: 'app-sandbox' }) };
  users = {};

  assert.deepEqual(await introspectToken('token'), {
    active: true,
    sub: ownerId,
    jti: 'sandbox-jti',
    purpose: 'app-sandbox',
    iat: IAT,
    exp: EXP
  });
  assert.deepEqual(userLookups, []);
});
