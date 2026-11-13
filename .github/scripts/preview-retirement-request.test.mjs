import assert from 'node:assert/strict';
import test from 'node:test';
import { previewRetirementRequest, redactedProviderEndpoint } from './preview-retirement-request.mjs';

test('ordinary automatic retention remains unchanged and reviewed selection is exact', () => {
  assert.deepEqual(previewRetirementRequest({ eventName: 'schedule', prNumber: 0 }), { deploymentIds: null, dryRun: false, reviewedRetirement: false });
  const value = { eventName: 'workflow_dispatch', prNumber: 0, deploymentIds: '["dpl_one","dpl_two"]', dryRun: 'true' };
  assert.deepEqual(previewRetirementRequest(value), { deploymentIds: ['dpl_one', 'dpl_two'], dryRun: true, reviewedRetirement: true });
  assert.equal(previewRetirementRequest({ ...value, dryRun: false }).dryRun, false);
});
test('reviewed mode rejects widened, malformed and ambiguous selections before any work', () => {
  const value = { eventName: 'workflow_dispatch', prNumber: 0, deploymentIds: '["dpl_one"]', dryRun: true };
  for (const patch of [{ eventName: 'schedule' }, { prNumber: 7 }, { deploymentIds: '' }, { deploymentIds: '[]' }, { deploymentIds: '["dpl_one","dpl_one"]' }, { deploymentIds: '["https://host"]' }, { deploymentIds: '[1]' }, { deploymentIds: 'not-json' }, { dryRun: 'maybe' }, { deploymentIds: JSON.stringify(Array.from({ length: 101 }, (_, index) => `dpl_${index}`)) }])
    assert.throws(() => previewRetirementRequest({ ...value, ...patch }));
});
test('403 diagnostic endpoints omit credentials, query values and alias names', () => {
  const location = redactedProviderEndpoint('https://user:fixture-secret@api.vercel.com/v13/deployments/dpl_exact?token=fixture-secret');
  assert.equal(location, 'Vercel /v13/deployments/:deploymentId');
  assert.equal(redactedProviderEndpoint('https://api.vercel.com/v4/aliases/private.example?teamId=private'), 'Vercel /v4/aliases/:alias');
  assert.equal(redactedProviderEndpoint('https://untrusted.test/private'), 'provider /unknown');
});
