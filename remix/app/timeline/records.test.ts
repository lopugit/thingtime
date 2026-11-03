import assert from 'node:assert/strict';
import test from 'node:test';
import { joinTimelineEvent, splitTimelineEvent, parseTimelineEventRecord, parseTimelineLink } from './records.ts';
import { eventFixture } from './testFixtures.ts';

test('many versions share Things, branches and dependency versions through independent immutable links', () => {
	const first = eventFixture('revision-a', { parentIds: ['base'], dependencies: [{ thingId: 'component', eventId: 'component-version' }] });
	const second = eventFixture('revision-b', { branchId: 'experiment', parentIds: ['base'], dependencies: first.dependencies });
	const a = splitTimelineEvent(first); const b = splitTimelineEvent(second);
	assert.equal('parentIds' in a.event, false); assert.equal('dependencies' in a.event, false);
	assert.equal(a.links.length, 5); assert.equal(b.links.length, 5);
	assert.equal(a.links.filter(link => link.relation === 'dependency')[0].targetId, b.links.filter(link => link.relation === 'dependency')[0].targetId);
	assert.equal(new Set([...a.links, ...b.links].map(link => link.id)).size, 10);
	assert.deepEqual(joinTimelineEvent(a.event, [...a.links].reverse()), first);
	assert.deepEqual(joinTimelineEvent(b.event, b.links), second);
	assert.deepEqual(a, splitTimelineEvent(first), 'Adding another relationship must not rewrite the earlier event');
});

test('missing, duplicate, cross-account and substituted links never produce a partial revision', () => {
	const { event, links } = splitTimelineEvent(eventFixture('merge', { operation: 'merge', before: eventFixture().after, parentIds: ['left', 'right'] }));
	for (const bad of [links.slice(1), [...links.slice(1), links[1]], links.map((link, index) => index ? link : { ...link, ownerId: 'other' }), links.map((link, index) => index ? link : { ...link, targetId: 'foreign' })]) assert.throws(() => joinTimelineEvent(event, bad), /link/i);
	assert.throws(() => parseTimelineEventRecord({ ...event, parentIds: ['left', 'right'] }), /fields/);
	assert.throws(() => parseTimelineEventRecord({ ...event, parentCount: 3 }), /count/);
	assert.throws(() => parseTimelineLink({ ...links[0], arbitrary: 'unmetered' }), /fields/);
});
