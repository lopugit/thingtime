import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript route through the repo's tsx test loader.
import { createAiModelsHandlers } from '../../../routes/api/v1/ai/models/_models.tsx';
// @ts-ignore Node executes this TypeScript route through the repo's tsx test loader.
import { createAdminAiModelsHandlers } from '../../../routes/api/v1/admin/ai/models/_models.tsx';

const publicEndpoint = 'https://thingtime.test/api/v1/ai/models';
const adminEndpoint = 'https://thingtime.test/api/v1/admin/ai/models';

const allowed = { allowed: true, limit: 120, remaining: 119, resetAt: new Date(Date.now() + 60_000).toISOString() };
const blocked = { allowed: false, limit: 120, remaining: 0, resetAt: new Date(Date.now() + 30_000).toISOString() };

const sampleList = () => ({
  ok: true as const,
  models: [
    {
      id: 'claude-opus-5',
      label: 'Claude Opus 5',
      provider: 'anthropic' as const,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'] as any[],
      speeds: ['normal', 'fast'] as any[],
      family: 'claude' as const,
      enabled: true,
      available: true,
      isDefault: true
    }
  ],
  defaults: { model: 'claude-opus-5', effort: 'high' as const, speed: 'normal' as const },
  providers: { anthropic: { configured: true }, openai: { configured: false } }
});

const postRequest = (body: unknown) =>
  new Request(adminEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

const sampleVaultProvider = () => ({
  id: 'prov-0123456789',
  name: 'My Claude',
  kind: 'anthropic' as const,
  model: 'claude-sonnet-4-6',
  endpointHost: 'api.anthropic.com',
  available: true
});

test('GET /api/v1/ai/models is public, no-store, and keys the rate limit by the session when present', async () => {
  const limits: Array<{ name: string; identity: string | null }> = [];
  let viewer: any = null;
  const { loader } = createAiModelsHandlers({
    getCurrentUser: async () => viewer,
    enforceRateLimit: async (_request: Request, name: string, identity: string | null) => {
      limits.push({ name, identity });
      return allowed;
    },
    listAiModels: async () => sampleList(),
    listVaultProviders: async () => [],
    vaultConfigured: () => false
  } as any);

  const anonymous = await loader({ request: new Request(publicEndpoint) });
  const body: any = await anonymous.json();
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Object.keys(body).sort(), ['defaults', 'models', 'ok', 'providers', 'vault', 'vaultProviders']);
  assert.equal(body.models[0].id, 'claude-opus-5');
  assert.deepEqual(limits, [{ name: 'ai.models', identity: null }]);

  viewer = { id: 'user-1' };
  await loader({ request: new Request(publicEndpoint) });
  assert.deepEqual(limits[1], { name: 'ai.models', identity: 'user:user-1' });

  const wrongMethod = await loader({ request: new Request(publicEndpoint, { method: 'DELETE' }) });
  assert.equal(wrongMethod.status, 405);
});

test('GET /api/v1/ai/models lists the viewer’s own Secure Vault providers (redacted) only for a session, and degrades to none', async () => {
  const listed: string[] = [];
  const logged: string[] = [];
  let viewer: any = null;
  let providers: () => Promise<any[]> = async () => [sampleVaultProvider()];
  const { loader } = createAiModelsHandlers({
    getCurrentUser: async () => viewer,
    enforceRateLimit: async () => allowed,
    listAiModels: async () => sampleList(),
    listVaultProviders: async (viewerId: string) => {
      listed.push(viewerId);
      return providers();
    },
    vaultConfigured: () => true,
    log: (message: string) => logged.push(message)
  } as any);

  // anonymous: the vault status is reported, the list stays empty and is never read
  const anonymous: any = await (await loader({ request: new Request(publicEndpoint) })).json();
  assert.deepEqual(anonymous.vault, { configured: true });
  assert.deepEqual(anonymous.vaultProviders, []);
  assert.deepEqual(listed, []);

  // a session: the redacted list — id, name, kind, model, endpoint hostname, availability — nothing else
  viewer = { id: 'user-1' };
  const signedIn: any = await (await loader({ request: new Request(publicEndpoint) })).json();
  assert.deepEqual(listed, ['user-1']);
  assert.deepEqual(signedIn.vaultProviders, [sampleVaultProvider()]);
  assert.equal(signedIn.ok, true);
  assert.equal(signedIn.models[0].id, 'claude-opus-5');
  assert.doesNotMatch(JSON.stringify(signedIn), /token|endpoint"|sk-/);

  // a vault read failure never fails the catalog
  providers = async () => {
    throw new Error('mongo down');
  };
  const degraded: any = await (await loader({ request: new Request(publicEndpoint) })).json();
  assert.equal(degraded.ok, true);
  assert.deepEqual(degraded.vaultProviders, []);
  assert.deepEqual(degraded.vault, { configured: true });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Secure Vault providers unavailable/);
});

test('GET /api/v1/ai/models answers 429 with Retry-After when the limiter blocks', async () => {
  let listed = false;
  const { loader } = createAiModelsHandlers({
    getCurrentUser: async () => null,
    enforceRateLimit: async () => blocked,
    listAiModels: async () => {
      listed = true;
      return sampleList();
    },
    listVaultProviders: async () => [],
    vaultConfigured: () => false
  } as any);

  const response = await loader({ request: new Request(publicEndpoint) });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) >= 1);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(listed, false);
});

const createAdmin = (overrides: Record<string, unknown> = {}) => {
  const calls: Record<string, unknown[]> = { setAiModelEnabled: [], ensure: [], limits: [] };
  const handlers = createAdminAiModelsHandlers({
    requireAdmin: async () => ({ user: { id: 'admin-1' } }),
    enforceRateLimit: async (_request: Request, name: string, identity: string | null, options: unknown) => {
      calls.limits.push({ name, identity, options });
      return allowed;
    },
    listAiModels: async () => sampleList(),
    setAiModelEnabled: async (id: string, enabled: boolean) => {
      calls.setAiModelEnabled.push({ id, enabled });
      const list = sampleList();
      return { ok: true, model: { ...list.models[0], enabled, available: enabled }, defaults: list.defaults };
    },
    ensureAiModelCatalog: async (options: unknown) => {
      calls.ensure.push(options);
      return { ok: true, total: 1, created: 0, refreshed: 1, unchanged: 0, skipped: 0, notes: [] };
    },
    ...overrides
  } as any);
  return { calls, ...handlers };
};

test('admin routes refuse anonymous and non-admin callers before any write, with private cache headers', async () => {
  for (const gate of [
    { error: { status: 401, message: 'Unauthorized' } },
    { error: { status: 403, message: 'Admins only' } }
  ]) {
    const { calls, loader, action } = createAdmin({ requireAdmin: async () => gate });
    const read = await loader({ request: new Request(adminEndpoint) });
    assert.equal(read.status, gate.error.status);
    assert.equal(read.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    const write = await action({ request: postRequest({ id: 'claude-opus-5', enabled: false }) });
    assert.equal(write.status, gate.error.status);
    assert.equal(calls.setAiModelEnabled.length, 0);
    assert.equal(calls.ensure.length, 0);
    assert.equal(calls.limits.length, 0);
  }
});

test('admin GET lists the catalog; POST { id, enabled } toggles one model through a fail-closed limit', async () => {
  const { calls, loader, action } = createAdmin();

  const read = await loader({ request: new Request(adminEndpoint) });
  const listBody: any = await read.json();
  assert.equal(read.status, 200);
  assert.equal(listBody.models[0].id, 'claude-opus-5');
  assert.equal(read.headers.get('Cache-Control'), 'private, no-store, max-age=0');

  const response = await action({ request: postRequest({ id: 'claude-opus-5', enabled: false }) });
  const body: any = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(calls.setAiModelEnabled, [{ id: 'claude-opus-5', enabled: false }]);
  assert.deepEqual(calls.limits, [{ name: 'admin.ai.models', identity: 'user:admin-1', options: { failClosed: true } }]);
  assert.equal(body.ok, true);
  assert.equal(body.model.enabled, false);
  assert.deepEqual(body.defaults, { model: 'claude-opus-5', effort: 'high', speed: 'normal' });
  assert.equal(calls.ensure.length, 0);
});

test('admin POST { seed: true } forces a catalog re-run and returns the report with the fresh list', async () => {
  const { calls, action } = createAdmin();
  const response = await action({ request: postRequest({ seed: true }) });
  const body: any = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(calls.ensure, [{ force: true }]);
  assert.equal(body.seeded, 1);
  assert.equal(body.report.refreshed, 1);
  assert.equal(body.models[0].id, 'claude-opus-5');
  assert.equal(calls.setAiModelEnabled.length, 0);
});

test('admin POST validates the body, passes util failures through, and honours the limiter', async () => {
  const { calls, action } = createAdmin({
    setAiModelEnabled: async () => ({ ok: false, status: 404, error: 'Unknown model — id must be a catalog model id' })
  });

  const missingId = await action({ request: postRequest({ enabled: true }) });
  assert.equal(missingId.status, 400);
  const badEnabled = await action({ request: postRequest({ id: 'claude-opus-5', enabled: 'yes' }) });
  assert.equal(badEnabled.status, 400);
  const unknown = await action({ request: postRequest({ id: 'claude-opus-9', enabled: true }) });
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as any).ok, false);
  assert.equal(calls.ensure.length, 0);

  const wrongMethod = await action({ request: new Request(adminEndpoint, { method: 'PATCH' }) });
  assert.equal(wrongMethod.status, 405);

  const limited = createAdmin({ enforceRateLimit: async () => blocked });
  const throttled = await limited.action({ request: postRequest({ id: 'claude-opus-5', enabled: true }) });
  assert.equal(throttled.status, 429);
  assert.equal(limited.calls.setAiModelEnabled.length, 0);

  await assert.rejects(
    () => action({ request: postRequest(JSON.stringify({ id: 'claude-opus-5', enabled: true, padding: 'x'.repeat(20_000) })) }),
    (error: unknown) => error instanceof Response && error.status === 413 && error.headers.get('Cache-Control') === 'private, no-store, max-age=0'
  );
});
