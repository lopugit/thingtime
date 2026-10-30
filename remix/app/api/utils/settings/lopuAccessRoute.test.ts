import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript route through the repo's tsx test loader.
import { createLopuAccessSettingsHandlers } from '../../../routes/api/v1/settings/lopu-access/_lopu-access.tsx';
import { createLopuAccessStore, DEFAULT_LOPU_ACCESS_SETTINGS } from './lopuAccess';

// /api/v1/settings/lopu-access (design note §1): public GET of the rules,
// admin-only partial POST through the real store, the JSON fence, and the
// fail-closed limiter wiring.

const endpoint = 'https://thingtime.test/api/v1/settings/lopu-access';
const allowed = { allowed: true, limit: 30, remaining: 29, resetAt: new Date(Date.now() + 60_000).toISOString() };
const blocked = { allowed: false, limit: 30, remaining: 0, resetAt: new Date(Date.now() + 30_000).toISOString() };

const postRequest = (body: unknown, contentType = 'application/json') =>
  new Request(endpoint, { method: 'POST', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const createHandlers = (overrides: Record<string, unknown> = {}) => {
  let stored: unknown = undefined;
  const writes: Array<{ settings: unknown; updatedBy: string }> = [];
  const store = createLopuAccessStore({
    readStoredSettings: async () => stored,
    writeStoredSettings: async (settings, updatedBy) => {
      writes.push({ settings, updatedBy });
      stored = settings;
    }
  });
  const limits: Array<{ name: string; identity: string | null; options: unknown }> = [];
  const handlers = createLopuAccessSettingsHandlers({
    requireAdmin: async () => ({ error: { status: 401, message: 'Unauthorized' } }),
    getCurrentUser: async () => null,
    enforceRateLimit: async (_request: Request, name: string, identity: string | null, options: unknown) => {
      limits.push({ name, identity, options });
      return allowed;
    },
    getStoredSettings: store.getSettings,
    setStoredSettings: store.setSettings,
    ...overrides
  } as any);
  return { limits, writes, ...handlers };
};

test('public GET returns the locked default and never checks admin auth', async () => {
  const { limits, loader } = createHandlers({
    requireAdmin: async () => {
      throw new Error('GET must remain public');
    }
  });
  const response = await loader({ request: new Request(endpoint) });
  const body: any = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(body, { ok: true, key: 'Thingtime.LopuAccess', settings: DEFAULT_LOPU_ACCESS_SETTINGS });
  assert.deepEqual(limits, [{ name: 'settings.lopu-access', identity: null, options: undefined }]);
  assert.equal((await loader({ request: new Request(endpoint, { method: 'DELETE' }) })).status, 405);
  const keyed = createHandlers({ getCurrentUser: async () => ({ id: 'user-1' }) });
  await keyed.loader({ request: new Request(endpoint) });
  assert.equal(keyed.limits[0].identity, 'user:user-1');
  const throttled = createHandlers({ enforceRateLimit: async () => blocked });
  assert.equal((await throttled.loader({ request: new Request(endpoint) })).status, 429);
});

test('POST rejects anonymous and non-admin callers and non-JSON bodies before writing', async () => {
  for (const gate of [{ error: { status: 401, message: 'Unauthorized' } }, { error: { status: 403, message: 'Admins only' } }]) {
    const { writes, limits, action } = createHandlers({ requireAdmin: async () => gate });
    const response = await action({ request: postRequest({ requireVerification: false }) });
    assert.equal(response.status, gate.error.status);
    assert.equal(writes.length, 0);
    assert.equal(limits.length, 0);
  }
  const { writes, limits, action } = createHandlers({ requireAdmin: async () => ({ user: { id: 'admin-1' } }) });
  const form = await action({ request: postRequest('requireVerification=false', 'text/plain') });
  assert.equal(form.status, 415);
  assert.equal(writes.length, 0);
  assert.equal(limits.length, 0, 'the fence runs before the bucket is spent');
});

test('admin POST merges a partial patch over the stored rules, validates strictly and persists with the actor', async () => {
  const { writes, limits, action, loader } = createHandlers({ requireAdmin: async () => ({ user: { id: 'admin-1' } }) });
  const response = await action({ request: postRequest({ starterCredits: 2 }) });
  const body: any = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, key: 'Thingtime.LopuAccess', settings: { ...DEFAULT_LOPU_ACCESS_SETTINGS, starterCredits: 2 } });
  assert.deepEqual(writes, [{ settings: { ...DEFAULT_LOPU_ACCESS_SETTINGS, starterCredits: 2 }, updatedBy: 'admin-1' }]);
  assert.deepEqual(limits[0], { name: 'settings.lopu-access', identity: 'user:admin-1', options: { failClosed: true } });
  // the wrapped shape and a second field keep the first
  const wrapped: any = await (await action({ request: postRequest({ settings: { allowByoUnverified: true } }) })).json();
  assert.deepEqual(wrapped.settings, { ...DEFAULT_LOPU_ACCESS_SETTINGS, starterCredits: 2, allowByoUnverified: true });
  // the public GET reads the saved value straight away
  const read: any = await (await loader({ request: new Request(endpoint) })).json();
  assert.deepEqual(read.settings, wrapped.settings);
  // bad values are 400 and never written (a JSON string literal is a valid
  // body that is not an object; malformed JSON reads as {} — an empty patch)
  for (const bad of [{ requireVerification: 'nope' }, { starterCredits: -1 }, { starterCredits: 1001 }, { lowBalanceWarningCredits: 'x' }, { bogus: 1 }, '"not-an-object"', '[1]']) {
    const refused = await action({ request: postRequest(bad) });
    assert.equal(refused.status, 400, JSON.stringify(bad));
  }
  assert.equal(writes.length, 2);
  const throttled = createHandlers({ requireAdmin: async () => ({ user: { id: 'admin-1' } }), enforceRateLimit: async () => blocked });
  assert.equal((await throttled.action({ request: postRequest({ starterCredits: 1 }) })).status, 429);
  assert.equal(throttled.writes.length, 0);
});
