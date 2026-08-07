import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript route through the repo's tsx test loader.
import { createPrConflictResolverModelWaterfallHandlers } from '../../../routes/api/v1/settings/pr-conflict-auto-resolver-model-waterfall/_pr-conflict-auto-resolver-model-waterfall.tsx';

const endpoint = 'https://thingtime.test/api/v1/settings/pr-conflict-auto-resolver-model-waterfall';

const postRequest = (body: unknown) =>
  new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

const createHandlers = (overrides: Record<string, unknown> = {}) =>
  createPrConflictResolverModelWaterfallHandlers({
    requireAdmin: async () => ({ error: { status: 401, message: 'Unauthorized' } }),
    getWaterfall: async () => ['default'],
    setWaterfall: async (waterfall: any) => waterfall,
    ...overrides
  } as any);

test('public GET exposes only the safe model projection and never checks admin auth', async () => {
  const { loader } = createHandlers({
    requireAdmin: async () => {
      throw new Error('GET must remain public');
    },
    getWaterfall: async () => ['claude-fable-5', 'default']
  });

  const response = await loader({ request: new Request(endpoint) });
  const body: any = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Object.keys(body).sort(), ['key', 'models', 'ok', 'waterfall']);
  assert.deepEqual(body.waterfall, ['claude-fable-5', 'default']);
  assert.equal(body.key, 'Thingtime.PRConflictAutoResolverModelWaterfall');
  assert.equal(JSON.stringify(body).includes('updatedBy'), false);
  assert.equal(JSON.stringify(body).includes('updatedAt'), false);
  assert.equal(JSON.stringify(body).includes('_id'), false);
});

test('POST rejects anonymous and authenticated non-admin callers before writing', async () => {
  for (const gate of [
    { error: { status: 401, message: 'Unauthorized' } },
    { error: { status: 403, message: 'Admins only' } }
  ]) {
    let wrote = false;
    const { action } = createHandlers({
      requireAdmin: async () => gate,
      setWaterfall: async () => {
        wrote = true;
        return ['default'];
      }
    });

    const response = await action({ request: postRequest({ waterfall: ['default'] }) });
    assert.equal(response.status, gate.error.status);
    assert.equal(wrote, false);
  }
});

test('admin POST validates and persists the full ordered waterfall with actor id', async () => {
  let persisted: { waterfall: unknown; actor: unknown } | null = null;
  const { action } = createHandlers({
    requireAdmin: async () => ({ user: { id: 'admin-123' } }),
    setWaterfall: async (waterfall: unknown, actor: unknown) => {
      persisted = { waterfall, actor };
      return waterfall;
    }
  });

  const waterfall = ['claude-opus-5', 'claude-fable-5', 'default'];
  const response = await action({ request: postRequest({ waterfall }) });
  const body: any = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(persisted, { waterfall, actor: 'admin-123' });
  assert.deepEqual(body.waterfall, waterfall);
});

test('admin POST rejects malformed and oversized bodies without writing', async () => {
  let writes = 0;
  const { action } = createHandlers({
    requireAdmin: async () => ({ user: { id: 'admin-123' } }),
    setWaterfall: async () => {
      writes += 1;
      return ['default'];
    }
  });

  const malformed = await action({ request: postRequest({ waterfall: ['default', '--allowedTools=Bash'] }) });
  assert.equal(malformed.status, 400);
  assert.equal(writes, 0);

  await assert.rejects(
    () => action({ request: postRequest(JSON.stringify({ waterfall: ['default'], padding: 'x'.repeat(20_000) })) }),
    (error: unknown) => error instanceof Response && error.status === 413
  );
  assert.equal(writes, 0);
});
