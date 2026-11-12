import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceAccessFromCandidates } from './access';
import { SERVICE_KINDS, type ServiceWorkspaceConfig } from '../../../schemas/serviceWorkspace';

test('shared workspace authorization retains more than5000 synthetic fetched candidates without a product ceiling', () => {
 // Pure shared-service regression, not SQLite/Mongo setup or API acceptance.
 const ownerId = 'owner', rootId = 'workspace';
 const config: ServiceWorkspaceConfig = { version: 1, name: 'Synthetic fetched workspace', timeZone: 'UTC', folders: Object.fromEntries(SERVICE_KINDS.map(kind => [kind, `folder-${kind}`])) as ServiceWorkspaceConfig['folders'] };
 const root = { shareId: rootId, ownerId, thingtime: ['folder'], extended: { serviceWorkspace: config } };
 const docs = Array.from({ length: 5001 }, (_, index) => ({ shareId: `customer-${index}`, ownerId, thingtime: ['data'], updatedAt: new Date(0),
  acl: ['tt:user', 'tt:custom', 'tt:service-workspace'], crystal: { workspaceId: rootId, recordType: 'customer', values: { firstName: `Customer ${index}` } } }));
 const access = workspaceAccessFromCandidates(rootId, ownerId, root, null, docs);
 assert.equal(access?.records.length, 5001); assert.equal(access?.visibleIds.size, 5001); assert.equal(access?.visibleIds.has('customer-5000'), true);
 assert.equal(workspaceAccessFromCandidates(rootId, 'stranger', root, null, docs), null);
 const foreignMember = { shareId: 'foreign-member', ownerId: 'elsewhere', thingtime: ['data'], updatedAt: new Date(0), crystal: { workspaceId: rootId, recordType: 'member', values: { userId: 'stranger', role: 'Admin' } } };
 assert.equal(workspaceAccessFromCandidates(rootId, 'stranger', root, foreignMember, docs), null);
 const foreignRow = { ...docs[0], shareId: 'foreign-customer', ownerId: 'elsewhere' };
 assert.equal(workspaceAccessFromCandidates(rootId, ownerId, root, null, [...docs, foreignRow])?.records.length, 5001);
});
