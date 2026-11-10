import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimelineEntry, parseTimelineEvent, timelineEventText, timelineScopeKey, TIMELINE_EVENT_MAX_BYTES } from './contract.ts';

import { eventFixture } from './testFixtures.ts';

test('the bounded sync aggregate round-trips without loss or caller mutation', () => {
	const event = eventFixture();
	const local = parseTimelineEvent(event);
	const remote = parseTimelineEvent(JSON.parse(JSON.stringify(local)));
	assert.deepEqual(local, remote);
	assert.notEqual(local.after, event.after);
	assert.equal(timelineEventText(event), timelineEventText({ ...event, after: { value: { blocks: [], title: 'Hello' }, version: 1, adapter: 'thing' } }));
});

test('shape validation refuses unknown fields, unsupported versions, forged receipt relationships and invalid graph edges', () => {
	for (const invalid of [
		{ ...eventFixture(), formatVersion: 2 }, { ...eventFixture(), pending: true },
		{ ...eventFixture(), occurredAt: '2026-02-31T00:00:00.000Z' }, { ...eventFixture(), parentIds: ['event-1'] },
		{ ...eventFixture(), parentIds: ['parent', 'parent'] }, { ...eventFixture(), operation: 'merge' },
		{ ...eventFixture(), operation: 'delete' }, { ...eventFixture(), mode: 'effect' },
		{ ...eventFixture(), dependencies: [{ thingId: 'x', eventId: '1' }, { thingId: 'x', eventId: '2' }] }
	]) assert.throws(() => parseTimelineEvent(invalid));
	assert.throws(() => parseTimelineEntry({ event: eventFixture(), receipt: { formatVersion: 1, eventId: 'different', ownerId: 'user-1', position: 1, acceptedAt: '2026-09-27T05:00:01.000Z' } }));
});

test('payloads stay inert; lossy/runtime values and accessors cannot execute during capture', () => {
	let invoked = false;
	const getter = Object.defineProperty({}, 'secret', { enumerable: true, get: () => { invoked = true; return 'secret'; } });
	const cycle: any = {}; cycle.self = cycle;
	for (const value of [getter, cycle, new Date(), NaN, Infinity, undefined, { value: undefined }, [, 1], () => 1, { toJSON() { invoked = true; return {}; } }]) {
		assert.throws(() => parseTimelineEvent(eventFixture('event-1', { after: { adapter: 'thing', version: 1, value: value as any } })));
	}
	assert.equal(invoked, false);
	const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":"ordinary data","date":"2026-09-27"}');
	assert.deepEqual(parseTimelineEvent(eventFixture('event-1', { after: { adapter: 'thing', version: 1, value } })).after?.value, value);
	assert.equal(({} as any).polluted, undefined);
});

test('UTF-8 and structural budgets refuse oversized snapshots before persistence', () => {
	assert.throws(() => parseTimelineEvent(eventFixture('event-1', { after: { adapter: 'thing', version: 1, value: '🙌'.repeat(TIMELINE_EVENT_MAX_BYTES / 3) } })), /budget/);
	let value: any = null;
	for (let i = 0; i < 100; i++) value = { value };
	assert.throws(() => parseTimelineEvent(eventFixture('event-1', { after: { adapter: 'thing', version: 1, value } })), /budget/);
});

test('cache scope binds account, origin and data plane without storing credentials', () => {
	const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.com', dataPlane: 'home' };
	assert.notEqual(timelineScopeKey(scope), timelineScopeKey({ ...scope, ownerId: 'user-2' }));
	assert.notEqual(timelineScopeKey(scope), timelineScopeKey({ ...scope, apiOrigin: 'https://preview.thingtime.com' }));
	assert.notEqual(timelineScopeKey(scope), timelineScopeKey({ ...scope, dataPlane: 'custom-hash' }));
	for (const apiOrigin of ['https://name:password@thingtime.com', 'https://thingtime.com/path', 'file:///tmp']) assert.throws(() => timelineScopeKey({ ...scope, apiOrigin }));
});
