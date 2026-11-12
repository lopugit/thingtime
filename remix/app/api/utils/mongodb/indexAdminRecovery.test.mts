import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mock, test } from 'node:test';
let allowed = false;
let entered = 0;
let repaired = 0;
const recovery = new AsyncLocalStorage<boolean>();
mock.module('~/api/http', { namedExports: {
  json: (body: unknown, init: { status?: number } = {}) => Response.json(body, init),
  readJsonBody: async (request: Request) => request.json()
} });
mock.module('~/api/utils/admin/adminResponse', { namedExports: { withAdminPrivateResponse: (work: () => Promise<Response>) => work() } });
mock.module('~/api/utils/auth/requireAdmin', { namedExports: { requireAdmin: async () => allowed ? { user: { id: 'admin' } } : { error: { message: 'Forbidden', status: 403 } } } });
mock.module('~/api/utils/mongodb/collections', { namedExports: { withHomeIndexRecovery: async (work: () => Promise<unknown>) => {
  entered++; return recovery.run(true, work);
} } });
mock.module('~/api/utils/migrations/migrations', { namedExports: { runMigration: async () => {
  assert.equal(recovery.getStore(), true, 'repair is authorized before the recovery scope is entered');
  repaired++;
  return { ok: true, migration: 'fixture-repair', report: {} };
} } });
mock.module('~/api/utils/migrations/migrationFailure', { namedExports: { captureMigrationFailureDiagnostic: () => null, migrationFailureResult: () => ({ ok: false, status: 500, error: 'failed' }) } });
mock.module('~/api/utils/migrations/migrationDiagnostics', { namedExports: { createMigrationDiagnostic: async () => ({ ok: false }), formatMigrationDiagnosticDetail: () => '' } });
const { action } = await import('../../../routes/api/v1/admin/migrations/run/_run.tsx');
const request = () => new Request('https://thingtime.test/api/v1/admin/migrations/run', { method: 'POST', body: JSON.stringify({ migration: 'fixture-repair' }) });

test('admin repair scope is unreachable to a rejected caller and entered only after authorization', async () => {
  const rejected = await action({ request: request() });
  assert.equal(rejected.status, 403);
  assert.equal(entered, 0);
  assert.equal(repaired, 0);
  allowed = true;
  const repairedResponse = await action({ request: request() });
  assert.equal(repairedResponse.status, 200);
  assert.equal(entered, 1);
  assert.equal(repaired, 1);
  assert.equal(recovery.getStore(), undefined, 'the internal repair scope does not leak to ordinary work');
});
