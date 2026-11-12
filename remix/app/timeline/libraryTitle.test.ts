import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryTitleSnapshot, libraryTitleValue } from './libraryTitle.ts';
import { libraryTitleMutationEvent } from '../api/utils/timeline/libraryTitle.ts';
import { newThingMutationCapture } from '../api/utils/timeline/recordMutation.ts';
import { withTimelineMutationContext } from '../api/utils/timeline/mutationContext.ts';
import { packTimelineEntry, timelinePayloadBytes } from '../api/utils/timeline/envelope.ts';
import { entryFixture } from './testFixtures.ts';

const before = { shareId: 'library-item', ownerId: 'owner', thingtime: ['theme'], timelineHeadId: 'saved',
	crystal: { title: 'Old title', name: 'Original identity', payload: { secret: 'never copy me' } }, secure: 'private key' };

test('library title events retain only display metadata, exact ancestry and trusted provenance', () => {
	withTimelineMutationContext('owner', 'ai', () => {
		const capture = newThingMutationCapture('owner');
		for (const kind of ['theme', 'feed-algorithm', 'custom-emoji', 'chat-archive']) {
			const source = { ...before, thingtime: [kind] };
			const event = libraryTitleMutationEvent(source, { ...source, crystal: { ...source.crystal, title: 'New title' } }, capture)!;
			assert.deepEqual(event.parentIds, ['saved']); assert.equal(event.source, 'ai');
			assert.equal(event.operationId, capture.operationId); assert.equal(event.actorId, 'owner');
			assert.deepEqual(event.before, libraryTitleSnapshot('Old title'));
			assert.deepEqual(event.after, libraryTitleSnapshot('New title'));
			for (const privateValue of ['Original identity', 'never copy me', 'private key']) assert.equal(JSON.stringify(event).includes(privateValue), false);
			assert.ok(timelinePayloadBytes({ thingtime: ['timeline-event'], ...packTimelineEntry(entryFixture(event)) })! > 0, 'Retained authored titles consume history allowance');
		}
	});
});

test('title history rejects hidden fields and invalid values, while unchanged titles add no event', () => {
	for (const value of [{}, { title: undefined }, { title: {} }, { title: 'x'.repeat(121) }, { title: 'Safe', payload: 'hidden' }]) {
		assert.throws(() => libraryTitleValue({ adapter: 'library-title', version: 1, value } as any));
	}
	assert.deepEqual(libraryTitleValue(libraryTitleSnapshot(undefined)), { title: null });
	const capture = newThingMutationCapture('owner');
	assert.equal(libraryTitleMutationEvent(before, structuredClone(before), capture), null);
	for (const changed of [{ ...before, ownerId: 'other' }, { ...before, shareId: 'other' }, { ...before, thingtime: ['user'] }]) {
		assert.throws(() => libraryTitleMutationEvent(before, changed, capture));
	}
	for (const kind of [['user'], ['theme', 'data'], undefined]) {
		const row = { ...before, thingtime: kind };
		assert.throws(() => libraryTitleMutationEvent(row, row, capture));
	}
});
