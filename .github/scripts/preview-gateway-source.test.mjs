import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewGatewaySource, gatewaySourceIssue, gatewaySourcePaths } from './preview-gateway-source.mjs';
const sources = () => Object.fromEntries(gatewaySourcePaths.map((path, index) => [path, [
  "import { registerGatewayDrain, requireGatewayDatabaseAccess } from '../deployment/environmentGateway'; class GatewayMongoClient extends mod.MongoClient { override async connect() { await requireGatewayDatabaseAccess(); await super.connect(); } }",
  "import { environmentGatewayIngress, isGatewayDataPath } from '../utils/environmentGateway'; await environmentGatewayIngress(event.req); runAdmittedGatewayWork(() => next());",
  'export const requireGatewayDatabaseAccess = async () => { await gatewayAuthority.requireDatabase(); };',
  "export const mongoConnectionPolicy: 'proxy' | 'dedicated' = 'proxy';"
][index]]));
test('admits integrated source and preserves explicit dedicated branch opt-in', () => {
  assert.equal(gatewaySourceIssue(sources()), null);
  const value = sources(); value[gatewaySourcePaths[3]] = "export const mongoConnectionPolicy = 'dedicated';"; assert.equal(gatewaySourceIssue(value), null);
});
test('old Mongo source, missing middleware/authority/policy, commented and reordered fences fail', () => {
  for (let index = 0; index < 4; index++) {
    const value = sources(); delete value[gatewaySourcePaths[index]]; assert.ok(gatewaySourceIssue(value));
    const commented = sources(); commented[gatewaySourcePaths[index]] = `/* ${commented[gatewaySourcePaths[index]]} */`; assert.ok(gatewaySourceIssue(commented));
  }
  const reordered = sources(); reordered[gatewaySourcePaths[0]] = reordered[gatewaySourcePaths[0]].replace('await requireGatewayDatabaseAccess(); await super.connect();', 'await super.connect(); await requireGatewayDatabaseAccess();');
  assert.equal(gatewaySourceIssue(reordered), 'database-fence-missing');
});
test('source reads bind every exact commit, provider errors and old absent files fail closed', async () => {
  const sha = 'a'.repeat(40), value = sources(), seen = [];
  await assertPreviewGatewaySource('owner/repo', sha, async (url) => { seen.push(url); const path = url.split('/contents/')[1].split('?')[0]; return { type: 'file', encoding: 'base64', content: Buffer.from(value[path]).toString('base64') }; });
  assert.equal(seen.length, 4); assert.ok(seen.every((url) => url.endsWith(`?ref=${sha}`)));
  await assert.rejects(assertPreviewGatewaySource('owner/repo', sha, async () => { throw Object.assign(new Error('Missing'), { status: 404 }); }), /predates/);
  await assert.rejects(assertPreviewGatewaySource('owner/repo', sha, async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); }), /Forbidden/);
  await assert.rejects(assertPreviewGatewaySource('owner/repo', sha, async () => ({ type: 'file' })), /incomplete/);
});
