import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript route through the repo's tsx test loader.
import { createLopuChatDefaultsHandlers } from '../../../routes/api/v1/settings/lopu-chat-defaults/_lopu-chat-defaults.tsx';

const endpoint = 'https://thingtime.test/api/v1/settings/lopu-chat-defaults';

const allowed = { allowed: true, limit: 30, remaining: 29, resetAt: new Date(Date.now() + 60_000).toISOString() };
const blocked = { allowed: false, limit: 30, remaining: 0, resetAt: new Date(Date.now() + 30_000).toISOString() };

const postRequest = (body: unknown) =>
  new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

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

const createHandlers = (overrides: Record<string, unknown> = {}) => {
  const limits: Array<{ name: string; identity: string | null; options: unknown }> = [];
  const writes: Array<{ defaults: unknown; updatedBy: string }> = [];
  const handlers = createLopuChatDefaultsHandlers({
    requireAdmin: async () => ({ error: { status: 401, message: 'Unauthorized' } }),
    getCurrentUser: async () => null,
    enforceRateLimit: async (_request: Request, name: string, identity: string | null, options: unknown) => {
      limits.push({ name, identity, options });
      return allowed;
    },
    getStoredDefaults: async () => ({ model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' }),
    setStoredDefaults: async (defaults: unknown, updatedBy: string) => {
      writes.push({ defaults, updatedBy });
      return defaults;
    },
    listAiModels: async () => sampleList(),
    ...overrides
  } as any);
  return { limits, writes, ...handlers };
};

test('public GET returns the stored preference plus its resolved form and never checks admin auth', async () => {
  const { limits, loader } = createHandlers({
    requireAdmin: async () => {
      throw new Error('GET must remain public');
    }
  });

  const response = await loader({ request: new Request(endpoint) });
  const body: any = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Object.keys(body).sort(), ['defaults', 'key', 'models', 'ok', 'providers', 'resolved']);
  assert.equal(body.key, 'Thingtime.LopuChatDefaults');
  assert.deepEqual(body.defaults, { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' });
  assert.deepEqual(body.resolved, { model: 'claude-opus-5', effort: 'high', speed: 'normal' });
  assert.equal(JSON.stringify(body).includes('updatedBy'), false);
  assert.equal(JSON.stringify(body).includes('updatedAt'), false);
  assert.deepEqual(limits, [{ name: 'settings.lopu-chat-defaults', identity: null, options: undefined }]);

  const wrongMethod = await loader({ request: new Request(endpoint, { method: 'DELETE' }) });
  assert.equal(wrongMethod.status, 405);
});

test('GET keys the limiter by the session when present and answers 429 when blocked', async () => {
  const { limits, loader } = createHandlers({ getCurrentUser: async () => ({ id: 'user-1' }) });
  await loader({ request: new Request(endpoint) });
  assert.equal(limits[0].identity, 'user:user-1');

  const throttled = createHandlers({ enforceRateLimit: async () => blocked });
  const response = await throttled.loader({ request: new Request(endpoint) });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) >= 1);
});

test('POST rejects anonymous and authenticated non-admin callers before writing', async () => {
  for (const gate of [
    { error: { status: 401, message: 'Unauthorized' } },
    { error: { status: 403, message: 'Admins only' } }
  ]) {
    const { writes, limits, action } = createHandlers({ requireAdmin: async () => gate });
    const response = await action({ request: postRequest({ model: 'claude-opus-5' }) });
    assert.equal(response.status, gate.error.status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(writes.length, 0);
    assert.equal(limits.length, 0);
  }
});

test('admin POST validates strictly, persists with the actor through a fail-closed limit, and echoes the resolved form', async () => {
  const { writes, limits, action } = createHandlers({ requireAdmin: async () => ({ user: { id: 'admin-123' } }) });

  const response = await action({ request: postRequest({ model: 'claude-opus-5', effort: 'xhigh', speed: 'fast' }) });
  const body: any = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [{ defaults: { model: 'claude-opus-5', effort: 'xhigh', speed: 'fast' }, updatedBy: 'admin-123' }]);
  assert.deepEqual(limits, [{ name: 'settings.lopu-chat-defaults', identity: 'user:admin-123', options: { failClosed: true } }]);
  assert.deepEqual(body.defaults, { model: 'claude-opus-5', effort: 'xhigh', speed: 'fast' });
  assert.deepEqual(body.resolved, { model: 'claude-opus-5', effort: 'high', speed: 'normal' });

  // the wrapped shape is accepted too, and an omitted effort lands on the model's high tier
  const wrapped = await action({ request: postRequest({ defaults: { model: 'claude-fable-5' } }) });
  assert.equal(wrapped.status, 200);
  assert.deepEqual(writes[1].defaults, { model: 'claude-fable-5', effort: 'high', speed: 'normal' });

  const wrongMethod = await action({ request: new Request(endpoint, { method: 'PUT' }) });
  assert.equal(wrongMethod.status, 405);
});

test('admin POST rejects malformed, sentinel, unoffered, and oversized bodies without writing', async () => {
  const { writes, action } = createHandlers({ requireAdmin: async () => ({ user: { id: 'admin-123' } }) });

  for (const body of [{}, { model: 'default' }, { model: 'claude-opus-9' }, { model: 'claude-opus-5', effort: 'ultra' }, { model: 'claude-fable-5', speed: 'fast' }]) {
    const response = await action({ request: postRequest(body) });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(((await response.json()) as any).ok, false);
  }
  assert.equal(writes.length, 0);

  const throttled = createHandlers({ requireAdmin: async () => ({ user: { id: 'admin-123' } }), enforceRateLimit: async () => blocked });
  assert.equal((await throttled.action({ request: postRequest({ model: 'claude-opus-5' }) })).status, 429);
  assert.equal(throttled.writes.length, 0);

  await assert.rejects(
    () => action({ request: postRequest(JSON.stringify({ model: 'claude-opus-5', padding: 'x'.repeat(20_000) })) }),
    (error: unknown) => error instanceof Response && error.status === 413
  );
  assert.equal(writes.length, 0);
});
