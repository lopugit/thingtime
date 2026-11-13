import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewGatewaySource, gatewaySourceIssue, gatewaySourcePaths } from './preview-gateway-source.mjs';
const sources = () => Object.fromEntries(gatewaySourcePaths.map((path, index) => [path, [
  "import { registerGatewayDrain, requireGatewayDatabaseAccess } from '../deployment/environmentGateway'; class GatewayMongoClient extends mod.MongoClient { override async connect() { await requireGatewayDatabaseAccess(); await super.connect(); } }",
  "import { environmentGatewayIngress, isGatewayDataPath } from '../utils/environmentGateway'; await environmentGatewayIngress(event.req); runAdmittedGatewayWork(() => next());",
  'export const requireGatewayDatabaseAccess = async () => { await gatewayAuthority.requireDatabase(); };',
  "export const mongoConnectionPolicy: 'proxy' | 'dedicated' = 'proxy';"
][index]]));
const leasedSources = () => ({ ...sources(),
  [gatewaySourcePaths[1]]: `
    import { environmentGatewayIngress } from '../utils/environmentGateway';
    import { admitGatewayWork } from '../../app/api/utils/deployment/environmentGateway';
    const end = () => lease?.end();
    await environmentGatewayIngress(event.req);
    lease = await admitGatewayWork();
    await lease.run(() => next());
    await lease!.run(() => reader.read());
    if (chunk.done) { controller.close(); end(); }
    try { await lease!.run(() => reader.cancel(reason)); } finally { end(); }
    catch (error) { end(); throw error; }
  `,
  [gatewaySourcePaths[2]]: `
    const gatewayWork = createGatewayWorkLifecycle(() => gatewayAuthority.requireDatabase());
    await requireDatabase();
    const lease = await admit();
    try { return await lease.run(work); } finally { lease.end(); }
    export const requireGatewayDatabaseAccess = async () => {
      await gatewayWork.withWork(async () => {});
    };
  `
});
test('admits integrated source and preserves explicit dedicated branch opt-in', () => {
  assert.equal(gatewaySourceIssue(sources()), null);
  const value = sources(); value[gatewaySourcePaths[3]] = "export const mongoConnectionPolicy = 'dedicated';"; assert.equal(gatewaySourceIssue(value), null);
});
test('admits scoped lease ingress and authority while retaining the database fence', () => {
  assert.equal(gatewaySourceIssue(leasedSources()), null);
  const dedicated = leasedSources(); dedicated[gatewaySourcePaths[3]] = "export const mongoConnectionPolicy = 'dedicated';";
  assert.equal(gatewaySourceIssue(dedicated), null);
  const reordered = leasedSources();
  reordered[gatewaySourcePaths[0]] = reordered[gatewaySourcePaths[0]].replace('await requireGatewayDatabaseAccess(); await super.connect();', 'await super.connect(); await requireGatewayDatabaseAccess();');
  assert.equal(gatewaySourceIssue(reordered), 'database-fence-missing');
});
test('leased ingress refuses missing admission, scoped consumption or terminal release', () => {
  for (const fragment of [
    'import { admitGatewayWork }', 'lease = await admitGatewayWork();',
    'const end = () => lease?.end();', 'await lease.run(() => next());',
    'await lease!.run(() => reader.read());', 'await lease!.run(() => reader.cancel(reason));',
    'controller.close(); end();', 'finally { end(); }', 'catch (error) { end();'
  ]) {
    const value = leasedSources(); value[gatewaySourcePaths[1]] = value[gatewaySourcePaths[1]].replace(fragment, '');
    assert.equal(gatewaySourceIssue(value), 'gateway-ingress-missing', fragment);
  }
});
test('leased authority refuses missing authority callback, admission or lease cleanup', () => {
  for (const fragment of [
    '() => gatewayAuthority.requireDatabase()', 'await requireDatabase();',
    'const lease = await admit();', 'return await lease.run(work);',
    'finally { lease.end(); }', 'await gatewayWork.withWork(async () => {});'
  ]) {
    const value = leasedSources(); value[gatewaySourcePaths[2]] = value[gatewaySourcePaths[2]].replace(fragment, '');
    assert.equal(gatewaySourceIssue(value), 'gateway-authority-missing', fragment);
  }
  for (let index = 0; index < 4; index++) {
    const value = leasedSources(); value[gatewaySourcePaths[index]] = `/* ${value[gatewaySourcePaths[index]]} */`;
    assert.ok(gatewaySourceIssue(value));
  }
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
