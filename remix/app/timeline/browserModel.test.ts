import assert from 'node:assert/strict';
import test from 'node:test';
import { filterHistoryCards, historyCard, historyComparison, historyPositions, historySystemLine, readHistoryFilters, writeHistoryFilters } from './browserModel.ts';
import type { LocalTimelineRow } from './localStore.ts';
import type { TimelineEvent } from './contract.ts';
import type { HistoryNoteView } from './notes.ts';
import { TIMELINE_UNDO_LABEL } from './publishedVersion.ts';
import { TIMELINE_VERSION_NAME_KIND, TIMELINE_VERSION_NAME_LABELS, type TimelineVersionName } from './versionNames.ts';

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

const note = (id: string, text: string, author: 'owner' | 'lopu' = 'owner', status: HistoryNoteView['status'] = 'accepted'): HistoryNoteView => ({
	note: { formatVersion: 1, id: `note-${id}`, ownerId: 'owner', eventId: 'a', thingId: 'page', author, text, createdAt: '2026-09-29T12:01:00.000Z' },
	status,
	failure: null
});
const versionName = (name: string, revision = 1, eventId = 'a'): TimelineVersionName => ({
	formatVersion: 1, id: `${eventId}/name`, ownerId: 'owner', eventId, thingId: 'page', name, revision, createdAt: '2026-10-13T05:00:00.000Z', updatedAt: '2026-10-13T05:00:00.000Z'
});

test('the messages toggle defaults on, round-trips only when off and ignores other values', () => {
	assert.equal(readHistoryFilters(new URLSearchParams('')).messages, true);
	assert.equal(readHistoryFilters(new URLSearchParams('messages=on')).messages, true);
	assert.equal(readHistoryFilters(new URLSearchParams('messages=off')).messages, false);
	const filters = readHistoryFilters(new URLSearchParams('messages=off&storage=home'));
	assert.equal(writeHistoryFilters(new URLSearchParams('storage=home'), filters).get('messages'), 'off');
	const shown = writeHistoryFilters(new URLSearchParams('messages=off&storage=home'), { ...filters, messages: true });
	assert.equal(shown.has('messages'), false);
	assert.equal(shown.get('storage'), 'home');
	assert.deepEqual(readHistoryFilters(shown), { ...filters, messages: true });
});

test('system lines come from the recorded operation only and never invent version numbers', () => {
	const base = row('a', 1).event;
	assert.equal(historySystemLine(base), null);
	assert.equal(historySystemLine({ ...base, operation: 'restore', parentIds: ['p'] }), 'Restored from an earlier version · nothing was lost');
	assert.equal(historySystemLine({ ...base, operation: 'merge', parentIds: ['p', 'q'] }), 'Combined two versions · both remain in History');
	assert.equal(
		historySystemLine({ ...base, operation: 'create', before: null, label: 'Recovered deleted Thing' }),
		'Recovered deleted Thing · its earlier moments are still here'
	);
	assert.equal(historySystemLine({ ...base, operation: 'create', before: null, label: 'Created page' }), null);
	assert.equal(historySystemLine({ ...base, operation: 'delete', after: null }), null);
	const branch = (label: string): TimelineEvent => ({
		...base,
		mode: 'effect',
		operation: 'effect',
		label,
		before: null,
		after: { adapter: 'timeline-branch', version: 1, value: { branch: { id: 'branch-1' }, head: { eventId: 'a' } } }
	});
	assert.equal(historySystemLine(branch('Created branch')), 'Started a private variation');
	assert.equal(historySystemLine(branch('Pushed branch version')), 'Updated a private variation');
	assert.equal(historySystemLine(branch('Added Thing to branch')), 'Updated a private variation');
	const outcome: TimelineEvent = {
		...base,
		mode: 'effect',
		operation: 'effect',
		source: 'action',
		clientId: null,
		actorId: 'owner',
		label: 'Action run accepted',
		before: null,
		dependencies: [],
		after: {
			adapter: 'action-outcome',
			version: 1,
			value: { actionName: 'Send', runId: 'action-run-2d6a0f8e-5d3b-4c3a-9c1e-0f9a8b7c6d5e', status: 'started', startedAt: '2026-09-29T12:00:00.000Z', durationMs: null, opsUsed: null, depthUsed: null, childActionsUsed: null }
		}
	};
	assert.equal(historySystemLine(outcome), null);
	// Undo is a restore distinguished only by its shared label; the generic restore line above keeps holding for every other restore.
	const undo: TimelineEvent = { ...base, operation: 'restore', parentIds: ['head', 'p'], label: TIMELINE_UNDO_LABEL };
	assert.equal(historySystemLine(undo), 'Undid just this change · later edits to other properties were kept');
	assert.equal(historySystemLine({ ...undo, label: 'Undid change later' }), 'Restored from an earlier version · nothing was lost');
	const named = (label: string, before: TimelineVersionName | null, after: TimelineVersionName | null): TimelineEvent => ({
		...base, mode: 'effect', operation: 'effect', label, dependencies: [{ thingId: 'page', eventId: 'a' }],
		before: before && { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: before }, after: after && { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: after }
	});
	const launch = versionName('Launch copy'); const final = versionName('Final copy', 2);
	assert.equal(historySystemLine(named(TIMELINE_VERSION_NAME_LABELS.named, null, launch)), 'Named this version');
	assert.equal(historySystemLine(named(TIMELINE_VERSION_NAME_LABELS.renamed, launch, final)), 'Renamed this version');
	assert.equal(historySystemLine(named(TIMELINE_VERSION_NAME_LABELS.cleared, final, null)), 'Removed this version name');
	assert.equal(historySystemLine(named('Unknown future label', null, launch)), 'Named this version');
	assert.equal(historySystemLine(named('Unknown future label', launch, final)), 'Renamed this version');
	assert.equal(historySystemLine(named('Unknown future label', final, null)), 'Removed this version name');
	for (const text of [historySystemLine(undo), historySystemLine(named(TIMELINE_VERSION_NAME_LABELS.renamed, launch, final)), historySystemLine({ ...base, operation: 'restore', parentIds: ['p'] }), historySystemLine(branch('Created branch'))]) assert.ok(!/\bv?\d+\b/.test(text ?? ''));
});

test('cards carry their 📌 name, title a name-change effect by the recorded name and match names in search', () => {
	const pinned = historyCard(row('a', 1), [], versionName('Launch copy'));
	assert.equal(pinned.name, 'Launch copy');
	assert.equal(pinned.title, 'Recorded title');
	assert.equal(historyCard(row('b', 2)).name, undefined);
	assert.equal(historyCard(row('b', 2), []).name, undefined);
	const effect = historyCard(row('effect', 3, {
		mode: 'effect', operation: 'effect', label: TIMELINE_VERSION_NAME_LABELS.cleared, dependencies: [{ thingId: 'page', eventId: 'a' }],
		before: { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: versionName('Final copy', 2) }, after: null
	}));
	assert.equal(effect.title, 'Final copy'); assert.equal(effect.system, 'Removed this version name');
	assert.equal(effect.kind, ''); assert.deepEqual(effect.chips, []); assert.equal(effect.changeCount, 0); assert.equal(effect.removed, false);
	const renamed = historyCard(row('rename', 4, {
		mode: 'effect', operation: 'effect', label: TIMELINE_VERSION_NAME_LABELS.renamed, dependencies: [{ thingId: 'page', eventId: 'a' }],
		before: { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: versionName('Launch copy') }, after: { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: versionName('Final copy', 2) }
	}));
	assert.equal(renamed.title, 'Final copy'); assert.equal(renamed.system, 'Renamed this version');
	const cards = [pinned, historyCard(row('b', 2)), effect];
	assert.deepEqual(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=launch+copy'))).map((card) => card.row.event.id), ['a']);
	assert.deepEqual(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=final+copy'))).map((card) => card.row.event.id), ['effect']);
	assert.deepEqual(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=launch+copy&operation=delete'))), []);
	assert.deepEqual(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=recorded+title'))).map((card) => card.row.event.id), ['a', 'b']);
});

test('cards carry their notes and system line; search matches note text without changing other filters', () => {
	const restored = historyCard(row('a', 1, { operation: 'restore', parentIds: ['p'] }), [note('1', 'Client asked for the old headline'), note('2', 'Lopu: the title went back.', 'lopu', 'pending')]);
	assert.equal(restored.system, 'Restored from an earlier version · nothing was lost');
	assert.equal(restored.notes.length, 2);
	assert.deepEqual(historyCard(row('b', 2)).notes, []);
	assert.equal(historyCard(row('b', 2)).system, null);
	const cards = [restored, historyCard(row('b', 2))];
	assert.deepEqual(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=old+headline'))).map((card) => card.row.event.id), ['a']);
	assert.deepEqual(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=title+went'))).map((card) => card.row.event.id), ['a']);
	assert.equal(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=old+headline&operation=update'))).length, 0);
	assert.equal(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('q=nothing+was+lost'))).length, 0);
	assert.equal(filterHistoryCards(cards, readHistoryFilters(new URLSearchParams('messages=off&q=old+headline'))).length, 1);
});
