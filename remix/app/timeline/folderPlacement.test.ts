import assert from 'node:assert/strict';
import test from 'node:test';
import { folderPlacementSnapshot, folderPlacementValue } from './folderPlacement.ts';
import { versionContent } from './versions.ts';
import { thingMutationEvent } from '../api/utils/timeline/recordMutation.ts';
import { packTimelineEntry, timelinePayloadBytes } from '../api/utils/timeline/envelope.ts';
import { entryFixture } from './testFixtures.ts';

const capture = { id: 'move', operationId: 'operation', actorId: 'owner', source: 'api' as const, now: new Date('2026-09-27T12:00:00Z') };
const source = { shareId: 'thing', ownerId: 'owner', thingtime: ['data'], crystal: { title: 'My Thing', text: 'large'.repeat(10_000) }, folderId: 'before', timelineHeadId: 'saved' };

test('placement retains compact metadata and reconstructs content only from a saved ancestor', () => {
  const event = thingMutationEvent(source, { ...source, folderId: 'after' }, capture)!;
  assert.deepEqual(event.parentIds, ['saved']);
  assert.equal(event.label, 'Moved Thing');
  assert.deepEqual(event.after, folderPlacementSnapshot('after'));
  assert.ok(JSON.stringify(event).length < 1000);
  const basis = { crystal: source.crystal, extended: null, tags: [], geo: null, acl: ['tt:user'], folderId: 'before', secure: 'never' };
  const restored = versionContent(event.after, basis);
  assert.deepEqual(restored.crystal, source.crystal); assert.equal(restored.folderId, 'after');
  assert.equal(restored.secure, undefined);
  assert.throws(() => versionContent(event.after), /ancestor/);
  assert.throws(() => versionContent(folderPlacementSnapshot('after', true), basis), /format/);
  const legacy = thingMutationEvent({ ...source, timelineHeadId: undefined }, { ...source, timelineHeadId: undefined, folderId: 'after' }, capture)!;
  assert.equal(legacy.after?.adapter, 'thing-content', 'A first mutation retains a complete baseline');
  const edited = thingMutationEvent(source, { ...source, folderId: 'after', crystal: { title: 'Changed' } }, capture)!;
  assert.equal(edited.after?.adapter, 'thing-content');
});

test('only exact server placement metadata is unmetered; client drafts and extra fields cannot hide payloads', () => {
  const event = thingMutationEvent(source, { ...source, folderId: null }, capture)!;
  const bytes = (value: typeof event) => timelinePayloadBytes({ thingtime: ['timeline-event'], ...packTimelineEntry(entryFixture(value)) });
  assert.equal(bytes(event), 0);
  assert.ok(bytes({ ...event, source: 'client', mode: 'draft', clientId: 'browser' })! > 0);
  for (const value of [{ folderId: 'folder', crystal: 'hidden' }, { folderId: 'x'.repeat(201) }, {}, { folderId: {} }]) {
    const snapshot = { adapter: 'folder-placement', version: 1, value } as any;
    assert.throws(() => folderPlacementValue(snapshot));
    assert.equal(bytes({ ...event, after: snapshot }), null);
  }
  assert.deepEqual(folderPlacementValue(folderPlacementSnapshot(null, true)), { folderId: null });
});
