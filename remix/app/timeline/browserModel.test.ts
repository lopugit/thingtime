import assert from 'node:assert/strict';
import test from 'node:test';
import { filterHistoryCards, historyCard, historyComparison, historyPositions, readHistoryFilters, writeHistoryFilters } from './browserModel.ts';
import type { LocalTimelineRow } from './localStore.ts';
import type { TimelineEvent } from './contract.ts';

const row = (id: string, position: number | null, overrides: Partial<TimelineEvent> = {}): LocalTimelineRow => ({
	scope: 'owner',
	status: position === null ? 'pending' : 'accepted',
	accessedAt: 0,
	bytes: 1,
	receipt: position === null ? null : { formatVersion: 1, eventId: id, ownerId: 'owner', position, acceptedAt: '2026-09-29T12:00:00.000Z' },
	event: {
		formatVersion: 1,
		id,
		ownerId: 'owner',
		thingId: 'page',
		branchId: 'main',
		parentIds: [],
		operationId: id,
		actorId: 'owner',
		source: 'api',
		clientId: null,
		occurredAt: '2026-09-29T12:00:00.000Z',
		mode: 'revision',
		operation: 'update',
		label: 'Edited heading',
		before: { adapter: 'thing-content', version: 1, value: { thingtime: ['webpage'], crystal: { title: 'Then', count: 0, enabled: false } } },
		after: { adapter: 'thing-content', version: 1, value: { thingtime: ['webpage'], crystal: { title: 'Recorded title', count: 1, enabled: true } } },
		dependencies: [],
		...overrides
	}
});

test('History URLs discard invalid filter/date values and preserve data-source parameters', () => {
	const params = new URLSearchParams('storage=selected&thing=bad%20id&look=constructor&day=2026-02-30&q=hello&source=admin');
	const filters = readHistoryFilters(params);
	assert.equal(filters.thingId, '');
	assert.equal(filters.look, 'list');
	assert.equal(filters.day, '');
	assert.equal(filters.source, '');
	const next = writeHistoryFilters(params, { ...filters, thingId: 'page', look: 'frames', compact: true });
	assert.equal(next.get('storage'), 'selected');
	assert.equal(next.get('thing'), 'page');
	assert.equal(next.has('day'), false);
	assert.deepEqual(readHistoryFilters(next), { ...filters, thingId: 'page', look: 'frames', compact: true });
});

test('cards retain historical titles and removed content without inventing device or actor details', () => {
	const original = row('old', 3);
	const card = historyCard(original);
	assert.equal(card.title, 'Recorded title');
	assert.equal(card.kind, 'webpage');
	assert.equal(card.source, 'API');
	assert.deepEqual(
		card.chips.find((chip) => chip.label === 'enabled'),
		{ label: 'enabled', before: 'Off', after: 'On' }
	);
	assert.equal(historyCard(row('removed', 4, { after: null, operation: 'delete' })).title, 'Then');
	assert.equal(historyCard(row('broken', 5, { after: { adapter: 'definition-source', version: 1, value: { source: 'not JSON' } } })).title, 'Thing');
	assert.equal(original.event.after?.value && (original.event.after.value as any).crystal.title, 'Recorded title');
});

test('filters use recorded kinds, exact source and receipt state; search includes before/after labels', () => {
	const cards = [historyCard(row('a', 1)), historyCard(row('b', null, { source: 'client', mode: 'draft' }))];
	const filters = readHistoryFilters(new URLSearchParams('kind=webpage&source=client&sync=pending&q=Off'));
	assert.deepEqual(
		filterHistoryCards(cards, filters).map((card) => card.row.event.id),
		['b']
	);
	assert.equal(filterHistoryCards(cards, { ...filters, source: 'api' }).length, 0);
});

test('horizontal positions stay bounded and separated with backwards clocks and widely separated events', () => {
	const cards = [
		historyCard(row('pending', null, { occurredAt: '2001-01-01T00:00:00.000Z' })),
		historyCard(row('later', 2, { occurredAt: '2000-01-01T00:00:00.000Z' })),
		historyCard(row('first', 1, { occurredAt: '2099-01-01T00:00:00.000Z' })),
		historyCard(row('third', 3, { occurredAt: '2199-01-01T00:00:00.000Z' }))
	];
	const positions = historyPositions(cards, 272, true);
	assert.deepEqual(
		positions.map((item) => item.card.row.event.id),
		['first', 'later', 'third', 'pending']
	);
	for (let index = 1; index < positions.length; index++) {
		const delta = positions[index].x - positions[index - 1].x;
		assert.ok(delta >= 300 && delta <= 660);
	}
	assert.equal(cards[0].row.event.id, 'pending');
});

test('read-only comparison allows variations of one Thing and refuses other owners or incomplete adapters', () => {
	const first = row('first', 1).event;
	const next = {
		...first,
		id: 'next',
		branchId: 'variation',
		after: { adapter: 'thing-content', version: 1, value: { thingtime: ['webpage'], crystal: { title: 'Other', count: 0, enabled: false } } }
	};
	assert.equal(historyComparison(first, next).changes.length, 3);
	assert.ok(historyComparison(first, { ...next, ownerId: 'foreign' }).error);
	assert.ok(historyComparison(first, { ...next, thingId: 'foreign' }).error);
	assert.ok(historyComparison(first, { ...next, after: { adapter: 'folder-placement', version: 1, value: { folderId: null } } }).error);
	assert.equal(historyComparison(first, { ...next, after: null }).changes.length, 1);
});
