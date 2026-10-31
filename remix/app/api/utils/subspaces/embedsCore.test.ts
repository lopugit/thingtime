import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeEmbedCursor, encodeEmbedCursor, isSubspaceEmbedSource, publicEmbedThing, subspaceEmbedRegion, validEmbedRequestId } from './embedsCore';

test('embed source projection strips management capabilities even for the source owner', () => {
  const source = { id: 'source', thingtime: ['component'], author: { id: 'owner' }, crystal: { name: 'Public component' },
    acl: ['tt:hidden'], visibility: 'hidden', targetId: null, folderId: null, extended: null, tags: [],
    createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
    linkKey: 'must-not-leave-owner-management', tokenAcl: [{ tokenId: 'private-grant' }],
    audience: { sourceId: 'ancestor', linkKey: 'inherited-secret' }, timelineHeadId: 'private-history', secure: 'never' };
  const result = publicEmbedThing(source as any);
  assert.equal(result.id, source.id);
  assert.deepEqual(result.crystal, source.crystal);
  for (const field of ['linkKey', 'tokenAcl', 'audience', 'timelineHeadId', 'secure']) assert.equal(field in result, false, field);
});

test('opaque embed cursor preserves stable order and tie-break id without accepting query objects', () => {
  const row = { shareId: 'aa3a3082-13bd-4ad8-aeca-31a8ece76fe1', crystal: { order: 87 } };
  assert.deepEqual(decodeEmbedCursor(encodeEmbedCursor(row)), { id: row.shareId, order: 87 });
  for (const cursor of [null, {}, 'not-a-cursor', Buffer.from(JSON.stringify({ order: { $gt: 0 }, id: row.shareId })).toString('base64url'),
    Buffer.from(JSON.stringify({ order: Infinity, id: row.shareId })).toString('base64url'),
    Buffer.from(JSON.stringify({ order: 0, id: { $ne: null } })).toString('base64url')]) assert.equal(decodeEmbedCursor(cursor), null);
});

test('embed input grammar accepts only the two regions and operation identities', () => {
  assert.equal(subspaceEmbedRegion('sidebar'), 'sidebar');
  assert.equal(subspaceEmbedRegion('feed'), 'feed');
  for (const value of ['sidebar.more', '', null, {}, ['feed']]) assert.equal(subspaceEmbedRegion(value), null);
  assert.equal(validEmbedRequestId('aa3a3082-13bd-4ad8-aeca-31a8ece76fe1'), true);
  for (const value of ['', null, {}, 'arbitrary-reused-text']) assert.equal(validEmbedRequestId(value), false);
});


test('embed sources exclude protected, messenger, subspace and foreign app namespaces', () => {
  for (const thingtime of [['component'], ['webpage'], ['data'], ['post']]) assert.equal(isSubspaceEmbedSource({ thingtime }), true);
  for (const thingtime of [['subspace-modlog'], ['subspace'], ['subspace-embed'], ['chat'], ['community'], ['password-manager-entry'], ['user'], ['data', 'chat'], 'component', [null]])
    assert.equal(isSubspaceEmbedSource({ thingtime }), false, JSON.stringify(thingtime));
  assert.equal(isSubspaceEmbedSource({ thingtime: ['component'], appId: 'foreign-app' }), false);
  assert.equal(isSubspaceEmbedSource(null), false);
});
