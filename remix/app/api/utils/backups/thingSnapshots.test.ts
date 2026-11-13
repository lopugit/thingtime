import assert from 'node:assert/strict';
import test from 'node:test';
import { thingContentSnapshot } from '../timeline/recordMutation';
import { parseBackupThingSnapshot } from './thingSnapshots';

test('ordinary recovery accepts only canonical content and refuses protected or extra envelope fields', () => {
	const snapshot = thingContentSnapshot({ thingtime: ['data'], crystal: { title: 'Saved content' }, folderId: 'folder-one' })!;
	assert.deepEqual(parseBackupThingSnapshot(snapshot), snapshot);
	for (const mutate of [
		(s: any) => (s.value.thingtime = ['draft']),
		(s: any) => (s.value.thingtime = ['chat-message']),
		(s: any) => (s.value.thingtime = []),
		(s: any) => (s.value.secure = 'private'),
		(s: any) => delete s.value.acl,
		(s: any) => (s.adapter = 'unknown'),
		(s: any) => (s.version = 2),
		(s: any) => (s.extra = true)
	]) {
		const changed = structuredClone(snapshot);
		mutate(changed);
		assert.throws(() => parseBackupThingSnapshot(changed));
	}
});

test('relational audiences cannot silently become baseline-only snapshots', () => {
  assert.throws(() => thingContentSnapshot({ acl: ['tt:user'], aclGeneration: 'generation', thingtime: ['data'] }), /materialized/);
});

test('trusted snapshot materialization preserves over 64 grants, exclusions and raw authorization metadata', async () => {
  const { materializeThingContentSnapshotDocument } = await import('../timeline/recordMutation');
  const { retainBackupThingSnapshot } = await import('./thingSnapshots');
  const { versionContent } = await import('../../../timeline/versions');
  const grants = Array.from({ length: 90 }, (_, n) => `tt:user/person-${n}`);
  const entries = [...grants, '-tt:user/blocked', 'tt:group/reviewers/comment'];
  const session = { identity: 'same-content-snapshot' };
  let observed: any;
  const things = { find: (filter: any, options: any) => {
    observed = { filter, options };
    return { async *[Symbol.asyncIterator]() { for (const entry of entries) yield { crystal: { entry } }; } };
  } };
  const raw = { shareId: 'saved', ownerId: 'owner', acl: ['tt:user', 'tt:custom'], aclGeneration: 'generation', aclRevision: 'revision',
    thingtime: ['data'], crystal: { title: 'Saved' }, secure: 'never snapshot', token: 'never snapshot' };
  const projected = await materializeThingContentSnapshotDocument(things, raw, session);
  const snapshot = thingContentSnapshot(projected)!;
  assert.equal(observed.options.session, session);
  assert.equal(observed.filter['crystal.revision'], 'generation');
  assert.deepEqual(observed.filter['crystal.revoked'], { $ne: true });
  assert.deepEqual((snapshot.value as any).acl, ['tt:user', 'tt:custom', ...entries]);
  assert.equal((snapshot.value as any).secure, undefined); assert.equal((snapshot.value as any).token, undefined);
  assert.deepEqual((versionContent(snapshot) as any).acl, (snapshot.value as any).acl);
  assert.equal(raw.aclGeneration, 'generation'); assert.equal(raw.aclRevision, 'revision'); assert.deepEqual(raw.acl, ['tt:user', 'tt:custom']);
  const item = await retainBackupThingSnapshot({} as any, 'snapshot', 0, projected, {
    scope: { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' }, authorize: async () => {}
  });
  assert.equal(item.content, null);
  assert.deepEqual((parseBackupThingSnapshot(item.snapshot).value as any).acl, (snapshot.value as any).acl);
});


test('derived ACL rows retain typed census exclusions rather than exporting authority records', async () => {
  const { family } = await import('./accountInventory');
  for (const kind of ['acl-entry', 'session-resource-grant', 'account-config-entry'])
    assert.equal(family({ shareId: 'derived-control', ownerId: 'owner', thingtime: [kind] }), 'excluded-authority');
});
