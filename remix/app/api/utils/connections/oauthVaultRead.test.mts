import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';
process.env.THINGTIME_ADMIN_VAULT_KEY = randomBytes(32).toString('base64url');
let records: any[] = [], limit = 0;
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  getAdminIntegrationSecretsCollection: async () => ({ find(query: any) {
    assert.deepEqual(query, { label: 'connections-google-oauth' });
    return { limit(count: number) { limit = count; return { toArray: async () => records.slice(0, count) }; } };
  } }),
  getAdminIntegrationAuditCollection: async () => ({}), getAdminIntegrationClaimsCollection: async () => ({}), getAdminIntegrationEndpointsCollection: async () => ({})
} });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: { enforceRateLimit: async () => null, rateLimitedResponseInit: () => ({}) } });
const { readAdminAutomationSecret } = await import('../admin/integrations.ts');
test('missing and ambiguous labels fail closed with a bounded lookup before decryption', async () => {
  assert.equal(await readAdminAutomationSecret('connections-google-oauth'), null);
  // Invalid encrypted values deliberately prove neither candidate is decrypted.
  records = [{ id: 'one', cipherText: 'secret-one' }, { id: 'two', cipherText: 'secret-two' }, { id: 'three' }];
  assert.equal(await readAdminAutomationSecret('connections-google-oauth'), null);
  assert.equal(limit, 2);
});
