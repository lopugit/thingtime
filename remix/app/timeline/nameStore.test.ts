import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb.ts';
import { TimelineNameStore, TIMELINE_NAME_CACHE_LIMIT, timelineVersionNameEffect } from './nameStore.ts';
import { TimelineLocalStore } from './localStore.ts';
import { TimelineSync } from './sync.ts';
import { TIMELINE_PAGE_SIZE, type TimelineEntry, type TimelineEvent } from './contract.ts';
import { TIMELINE_VERSION_NAME_KIND, TIMELINE_VERSION_NAME_LABELS, type TimelineVersionName } from './versionNames.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';

const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.com', dataPlane: 'home' };
const at = (n: number) => `2026-10-13T05:0${n}:00.000Z`;
const nameFor = (eventId: string, name: string, overrides: Partial<TimelineVersionName> = {}): TimelineVersionName => ({
	formatVersion: 1, id: `${eventId}/name`, ownerId: scope.ownerId, eventId, thingId: 'page', name, revision: 1, createdAt: at(1), updatedAt: at(1), ...overrides
});
const snapshot = (value: TimelineVersionName | null) => value && { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value };
/** A server-recorded name-change effect: `before` the replaced record, `after` the new one (null once cleared). */
const effect = (id: string, before: TimelineVersionName | null, after: TimelineVersionName | null, position: number, overrides: Partial<TimelineEvent> = {}): TimelineEntry => entryFixture(eventFixture(id, {
	thingId: 'page', source: 'api', clientId: null, mode: 'effect', operation: 'effect', before: snapshot(before), after: snapshot(after),
	label: after === null ? TIMELINE_VERSION_NAME_LABELS.cleared : before === null ? TIMELINE_VERSION_NAME_LABELS.named : TIMELINE_VERSION_NAME_LABELS.renamed,
	dependencies: [{ thingId: 'page', eventId: (after ?? before)!.eventId }], ...overrides
}), position);
const saved = (id: string, position: number) => entryFixture(eventFixture(id, { thingId: 'page', source: 'api', mode: 'revision', clientId: null }), position);
const cached = (store: TimelineNameStore, eventId: string) => store.forEvents([eventId]).get(eventId)?.name ?? null;
const unused = async () => { throw new Error('unused'); };

test('an authoritative read replaces the names of its events, keeps other events and refuses foreign, duplicate or oversized name lists', () => {
	const store = new TimelineNameStore(scope);
	store.accept([nameFor('base', 'Launch copy'), nameFor('next', 'Draft two')]);
	assert.deepEqual([...store.forEvents(['base', 'next', 'missing'])].map(([id, name]) => [id, name.name]), [['base', 'Launch copy'], ['next', 'Draft two']]);
	store.accept([nameFor('base', 'Launch copy v2', { revision: 2, updatedAt: at(2) })], { events: ['base', 'next'] });
	assert.equal(cached(store, 'base'), 'Launch copy v2'); assert.equal(cached(store, 'next'), null);
	store.accept([], { events: ['other'] }); assert.equal(cached(store, 'base'), 'Launch copy v2');
	assert.throws(() => store.accept([nameFor('base', 'Mine', { ownerId: 'other' })]), /scope/);
	assert.throws(() => store.accept([nameFor('base', 'One'), nameFor('base', 'Two')]), /scope/);
	assert.throws(() => store.accept(Array.from({ length: TIMELINE_PAGE_SIZE + 1 }, (_, n) => nameFor(`event-${n}`, 'Name'))), /scope/);
	assert.throws(() => store.accept([{ ...nameFor('base', 'Padded '), extra: true } as any]), /Invalid/);
	assert.equal(cached(store, 'base'), 'Launch copy v2');
	assert.throws(() => new TimelineNameStore({ ...scope, apiOrigin: 'ftp://x' }), /origin/);
	assert.equal(cached(new TimelineNameStore({ ...scope, ownerId: 'other' }), 'base'), null);
	store.clear(); assert.equal(store.forEvents(['base']).size, 0);
});

test('name effects apply in acceptance order; a replayed or older effect never overwrites a newer record or undoes a later clear', () => {
	const store = new TimelineNameStore(scope);
	const alpha = nameFor('base', 'Alpha'); const beta = nameFor('base', 'Beta', { revision: 2, updatedAt: at(2) }); const gamma = nameFor('base', 'Gamma', { createdAt: at(4), updatedAt: at(4) });
	const history = [effect('name-1', null, alpha, 2), effect('name-2', alpha, beta, 3), effect('name-3', beta, null, 4), effect('name-4', null, gamma, 5)];
	for (const entry of history) assert.equal(store.applyEffect(entry.event), true);
	assert.equal(cached(store, 'base'), 'Gamma');
	// Replays and the superseded first life (same revision, older updatedAt) leave the current name alone.
	store.applyEffect(history[0].event); store.applyEffect(history[1].event); store.applyEffect(history[2].event);
	assert.deepEqual(store.forEvents(['base']).get('base'), gamma);
	store.applyEffect(effect('name-5', gamma, null, 6).event); assert.equal(cached(store, 'base'), null);
	assert.equal(store.applyEffect(saved('plain', 7).event), false);
	assert.equal(store.applyEffect(eventFixture('branch', { mode: 'effect', operation: 'effect', after: { adapter: 'timeline-branch', version: 1, value: { branch: {} } } })), false);
	assert.throws(() => store.applyEffect(effect('bad-1', null, nameFor('base', 'Theirs', { ownerId: 'other' }), 8, { ownerId: 'other' }).event), /scope/);
	assert.throws(() => store.applyEffect(effect('bad-2', null, alpha, 9, { dependencies: [{ thingId: 'page', eventId: 'elsewhere' }] }).event), /version name effect/);
	assert.throws(() => store.applyEffect(effect('bad-3', alpha, nameFor('next', 'Moved'), 10).event), /version name effect/);
	assert.throws(() => store.applyEffect(effect('bad-4', null, { ...alpha, extra: true } as any, 11).event), /Invalid/);
	assert.throws(() => store.applyEffect(effect('bad-5', null, nameFor('base', 'Theirs', { ownerId: 'other' }), 12).event), /version name effect/);
	assert.equal(cached(store, 'base'), null);
	assert.deepEqual(timelineVersionNameEffect(history[2].event), { eventId: 'base', name: null, prior: beta });
	assert.equal(timelineVersionNameEffect(saved('plain', 13).event), null);
});

test('the name cache is bounded and evicts the least recently accepted names', () => {
	let clock = 0; const store = new TimelineNameStore(scope, () => ++clock);
	const names = Array.from({ length: TIMELINE_NAME_CACHE_LIMIT }, (_, n) => nameFor(`event-${n}`, `Name ${n}`));
	for (let n = 0; n < names.length; n += TIMELINE_PAGE_SIZE) store.accept(names.slice(n, n + TIMELINE_PAGE_SIZE));
	store.accept([names[0]]);
	store.accept([nameFor('event-fresh', 'Fresh')]);
	const kept = store.forEvents([...names.map(name => name.eventId), 'event-fresh']);
	assert.equal(kept.size, TIMELINE_NAME_CACHE_LIMIT);
	assert.equal(kept.has('event-0'), true); assert.equal(kept.has('event-1'), false); assert.equal(kept.has('event-fresh'), true);
});

test('page reads adopt their names, drop stale cached names for those events and refuse names outside the page', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const names = new TimelineNameStore(scope);
	names.accept([nameFor('base', 'Stale'), nameFor('other', 'Elsewhere')]);
	const fresh = nameFor('base', 'Fresh', { revision: 2, updatedAt: at(2) });
	let response: any = { entries: [saved('base', 2)], nextBefore: null, nextAfter: null, names: [fresh] };
	const sync = new TimelineSync(events, { page: async () => response, push: unused }, undefined, undefined, names);
	assert.deepEqual((await sync.page('page')).names, [fresh]);
	assert.equal(cached(names, 'base'), 'Fresh'); assert.equal(cached(names, 'other'), 'Elsewhere');
	for (const field of [[nameFor('foreign', 'Outside')], [nameFor('base', 'Mine', { ownerId: 'other' })], [fresh, fresh], 'names', [{ ...fresh, extra: true }], Array.from({ length: TIMELINE_PAGE_SIZE + 1 }, () => fresh)]) {
		response = { ...response, names: field }; await assert.rejects(sync.page('page'), /Invalid Timeline/);
	}
	assert.equal(cached(names, 'base'), 'Fresh');
	response = { entries: [saved('base', 2)], nextBefore: null, nextAfter: null }; assert.equal('names' in await sync.page('page'), false);
	assert.equal(cached(names, 'base'), 'Fresh');
	response = { entries: [saved('base', 2)], nextBefore: null, nextAfter: null, names: [] }; await sync.page('page');
	assert.equal(cached(names, 'base'), null); assert.equal(cached(names, 'other'), 'Elsewhere');
	await backend.close();
});

test('name effects in a page update already-loaded versions in acceptance order even when the page arrives newest-first', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const names = new TimelineNameStore(scope);
	const alpha = nameFor('base', 'Alpha'); const beta = nameFor('base', 'Beta', { revision: 2, updatedAt: at(2) });
	// Newer events first, as a `before` page delivers them: a naive forward apply would resurrect Beta after its clear.
	let response: any = { entries: [effect('name-3', beta, null, 5), effect('name-2', alpha, beta, 4), effect('name-1', null, alpha, 3)], nextBefore: null, nextAfter: null, names: [] };
	const sync = new TimelineSync(events, { page: async () => response, push: unused }, undefined, undefined, names);
	await sync.page('page', { before: 6 });
	assert.equal(cached(names, 'base'), null);
	const gamma = nameFor('base', 'Gamma', { createdAt: at(4), updatedAt: at(4) });
	response = { entries: [effect('name-4', null, gamma, 7)], nextBefore: null, nextAfter: null, names: [] };
	await sync.page('page', { after: 6 });
	assert.equal(cached(names, 'base'), 'Gamma');
	// The page's own `names` stay authoritative for the events it carries.
	response = { entries: [saved('base', 8), effect('name-5', gamma, nameFor('base', 'Delta', { revision: 2, createdAt: at(4), updatedAt: at(5) }), 9)], nextBefore: null, nextAfter: null, names: [nameFor('base', 'Epsilon', { revision: 3, createdAt: at(4), updatedAt: at(6) })] };
	await sync.page('page', { after: 7 }); assert.equal(cached(names, 'base'), 'Epsilon');
	response = { entries: [effect('bad', null, { ...alpha, extra: true } as any, 10)], nextBefore: null, nextAfter: null };
	await assert.rejects(sync.page('page', { after: 9 }), /Invalid/);
	await backend.close();
});

test('an exact version read accepts wrapped names for that event and still accepts a bare entry', async () => {
	// The cache clock sits before every fixture timestamp, so an effect read after an authoritative empty read is newer than that read and applies.
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const names = new TimelineNameStore(scope, () => Date.parse(at(0)));
	const entry = saved('base', 3); const name = nameFor('base', 'Launch copy');
	let response: any = { entry, names: [name] };
	const sync = new TimelineSync(events, { page: unused, push: unused, entry: async () => response }, undefined, undefined, names);
	assert.deepEqual(await sync.entry('base'), entry); assert.equal(cached(names, 'base'), 'Launch copy');
	response = entry; assert.deepEqual(await sync.entry('base'), entry); assert.equal(cached(names, 'base'), 'Launch copy');
	response = { entry, notes: [], names: [nameFor('other', 'Wrong event')] }; await assert.rejects(sync.entry('base'), /Invalid Timeline page/);
	response = { entry: saved('different', 4), names: [] }; await assert.rejects(sync.entry('base'), /different version/);
	assert.equal(cached(names, 'base'), 'Launch copy');
	response = { entry, names: [] }; await sync.entry('base'); assert.equal(cached(names, 'base'), null);
	const effectEntry = effect('name-1', null, name, 5);
	response = { entry: effectEntry, names: [] }; assert.deepEqual(await sync.entry('name-1'), effectEntry); assert.equal(cached(names, 'base'), 'Launch copy');
	await backend.close();
});

test('a cleared name is never resurrected by its own older naming effect arriving later, while a newer naming replaces the clear', () => {
	const store = new TimelineNameStore(scope, () => Date.parse(at(7)));
	const first = nameFor('saved', 'First');
	const named = effect('named', null, first, 1, { occurredAt: at(1) }).event;
	const cleared = effect('cleared', first, null, 2, { occurredAt: at(5) }).event;
	store.applyEffect(cleared);
	store.applyEffect(named);
	assert.equal(cached(store, 'saved'), null, 'paging older history replays the naming effect after the clear');
	store.accept([], { events: ['saved'] });
	store.applyEffect(named);
	assert.equal(cached(store, 'saved'), null, 'an authoritative empty read is a tombstone too');
	const later = nameFor('saved', 'Later', { revision: 3, createdAt: at(9), updatedAt: at(9) });
	store.applyEffect(effect('named-later', null, later, 3, { occurredAt: at(9) }).event);
	assert.deepEqual(store.forEvents(['saved']).get('saved'), later, 'a naming after the clear replaces the tombstone');
	store.accept([first], { events: ['saved'] });
	assert.deepEqual(store.forEvents(['saved']).get('saved'), first, 'a page read stays authoritative');
});
