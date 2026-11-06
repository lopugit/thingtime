import assert from 'node:assert/strict';
import test from 'node:test';
import { canView, resolvePostLinkedThings, type ThingDoc, type Viewer } from './things';

const record = (id: string, acl: string[], extra: Record<string, unknown> = {}): ThingDoc => ({
  shareId: id, ownerId: 'owner', thingtime: ['data'], acl, crystal: {}, ...extra
}) as ThingDoc;

test('post references coalesce workspace membership loads but authorize every source independently', async () => {
  const workspaceAcl = ['tt:user', 'tt:custom', 'tt:service-workspace'];
  const rows = Array.from({ length: 20 }, (_, index) => record(`record-${index}`, workspaceAcl));
  rows.push(record('private', ['tt:user']), record('restricted-customer', workspaceAcl));
  rows.push(record('managed', ['tt:all'], { thingtime: ['chat-archive'] }));
  const byId = new Map(rows.map(row => [row.shareId, row]));
  let membershipReads = 0, allowMember = true;
  const cache = new WeakMap<object, Promise<boolean>>();
  const checked: string[] = [];
  const viewers = new Set<Viewer>();
  // Same request-local cache contract as serviceWorkspaces/access: authority
  // depends on both the viewer and each record, never the first allowed row.
  const authorize = async (doc: ThingDoc, viewer: Viewer): Promise<boolean> => {
    checked.push(doc.shareId); viewers.add(viewer);
    if (canView(doc, viewer)) return true;
    if (!viewer || !doc.acl?.includes('tt:service-workspace')) return false;
    if (!cache.has(viewer)) { membershipReads++; cache.set(viewer, Promise.resolve(allowMember)); }
    return await cache.get(viewer)! && doc.shareId !== 'restricted-customer';
  };
  const lookup = async (id: string) => byId.get(id) || null;
  const viewer = { id: 'staff' };
  const result = await resolvePostLinkedThings(rows.map(row => row.shareId), viewer, lookup, authorize);
  assert.equal(result.length, 20);
  assert.equal(membershipReads, 1);
  assert.equal(viewers.size, 1);
  assert.equal(checked.length, 22, 'private and customer-restricted sources each get checked; managed kinds never project');
  assert.equal(viewer.hasOwnProperty('linkThingIds'), false, 'no capability is added to the caller');
  checked.length = 0; allowMember = false;
  assert.deepEqual(await resolvePostLinkedThings(rows.map(row => row.shareId), viewer, lookup, authorize), []);
  assert.equal(membershipReads, 2, 'a new projection rechecks revoked membership');
});

test('canonical attached links preserve private, moderation and PAT visibility fences', async () => {
  const rows = [record('public', ['tt:all']), record('hidden', ['tt:hidden']), record('private', ['tt:user']),
    record('blocked', ['tt:all'], { moderation: { status: 'blocked' } }), record('managed', ['tt:all'], { thingtime: ['chat-archive'] })];
  const lookup = async (id: string) => rows.find(row => row.shareId === id) || null;
  assert.deepEqual((await resolvePostLinkedThings(rows.map(row => row.shareId), null, lookup)).map(row => row.shareId), ['public', 'hidden']);
  const token = { id: 'owner', pat: { tokenId: 'scoped', onlyCreatedThings: false, visibility: 'public' as const } };
  assert.deepEqual((await resolvePostLinkedThings(rows.map(row => row.shareId), token, lookup)).map(row => row.shareId), ['public']);
  rows[1].acl = ['tt:user'];
  assert.deepEqual((await resolvePostLinkedThings(['hidden'], null, lookup)), [], 'removing link audience revokes the embed');
});
