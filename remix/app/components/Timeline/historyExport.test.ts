import assert from 'node:assert/strict';
import test from 'node:test';
import { HISTORY_EXPORT_MAX_BYTES, HISTORY_EXPORT_MAX_EVENTS, HISTORY_EXPORT_MAX_PAGES, HISTORY_EXPORT_MAX_RETRIES, collectHistoryExport, historyExportFilename, historyExportText, type HistoryExportPage, type HistoryExportScan } from './historyExport.ts';
import { timelineExportRecord } from './timelineExportDownload.ts';
import { entryFixture, eventFixture } from '../../timeline/testFixtures.ts';
import type { TimelineNote } from '../../timeline/notes.ts';
import type { TimelineVersionName } from '../../timeline/versionNames.ts';

const scope = { ownerId: 'user-1', dataPlane: 'home', storage: 'home' as const };
const options = { now: () => '2026-10-14T09:00:00.000Z', wait: async () => {} };
const entry = (position: number, overrides = {}) => entryFixture(eventFixture(`event-${position}`, { mode: 'revision', operation: 'update', source: 'api', clientId: null, ...overrides }), position);
const note = (eventId: string, id = `note-${eventId}`): TimelineNote => ({ formatVersion: 1, id, ownerId: 'user-1', eventId, thingId: 'page-1', author: 'owner', text: 'why', createdAt: '2026-10-13T00:00:00.000Z' });
const name = (eventId: string): TimelineVersionName => ({ formatVersion: 1, id: `name-${eventId}`, ownerId: 'user-1', eventId, thingId: 'page-1', name: 'Launch', revision: 1, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' });
/** Newest-first pages of `size` entries from `total` down to 1, like the server. */
const pager = (total: number, size: number, extra: (page: HistoryExportPage) => HistoryExportPage = page => page) => {
	const cursors: ({ before?: number })[] = [];
	const scan: HistoryExportScan = async cursor => {
		cursors.push(cursor);
		const top = cursor.before === undefined ? total : cursor.before - 1;
		const entries = []; for (let position = top; position > Math.max(0, top - size); position--) entries.push(entry(position));
		const last = entries.at(-1)?.receipt.position ?? null;
		return extra({ entries, nextBefore: last !== null && last > 1 ? last : null });
	};
	return { scan, cursors };
};

test('the export walks newest-first pages by cursor and carries notes and names for exported events only', async () => {
	const { scan, cursors } = pager(5, 2, page => ({ ...page, notes: [note(page.entries[0].event.id), note('event-999'), { ...note(page.entries[0].event.id), ownerId: 'user-2', id: 'foreign' }], names: [name(page.entries[0].event.id)] }));
	const file = await collectHistoryExport(scan, scope, options);
	assert.deepEqual(cursors, [{}, { before: 4 }, { before: 2 }]);
	assert.deepEqual(file.entries.map(item => item.receipt.position), [5, 4, 3, 2, 1]);
	assert.deepEqual(file.notes.map(item => item.eventId), ['event-5', 'event-3', 'event-1']);
	assert.deepEqual(file.names.map(item => item.eventId), ['event-5', 'event-3', 'event-1']);
	assert.equal(file.truncated, false);
	assert.deepEqual({ kind: file.kind, formatVersion: file.formatVersion, exportedAt: file.exportedAt, ownerId: file.ownerId, dataPlane: file.dataPlane, storage: file.storage, bounds: file.bounds },
		{ kind: 'thingtime-history-export', formatVersion: 1, exportedAt: '2026-10-14T09:00:00.000Z', ownerId: 'user-1', dataPlane: 'home', storage: 'home', bounds: { maxEvents: HISTORY_EXPORT_MAX_EVENTS, maxBytes: HISTORY_EXPORT_MAX_BYTES, maxPages: HISTORY_EXPORT_MAX_PAGES } });
	// A history export is never a single-version file.
	assert.throws(() => timelineExportRecord(JSON.parse(historyExportText(file)), { id: 'event-5', thingId: 'page-1', ownerId: 'user-1' }), /not a version file/);
	assert.equal(historyExportFilename(file.ownerId, file.exportedAt), 'history-export-user-1-2026-10-14.json');
	assert.equal(historyExportFilename('a/b:c@d', '2026-10-14T09:00:00.000Z'), 'history-export-a_b_c_d-2026-10-14.json');
});

test('the event bound truncates mid-page, keeps the messages of the kept events and stops paging', async () => {
	// 48 per page: the event bound lands mid-page (page 42) before the 50-page bound does.
	const { scan, cursors } = pager(HISTORY_EXPORT_MAX_EVENTS + 5, 48, page => ({ ...page, notes: page.entries.map(item => note(item.event.id)) }));
	const file = await collectHistoryExport(scan, scope, options);
	assert.equal(file.entries.length, HISTORY_EXPORT_MAX_EVENTS);
	assert.equal(file.truncated, true);
	assert.equal(file.entries.at(-1)?.receipt.position, 6);
	assert.equal(file.notes.length, HISTORY_EXPORT_MAX_EVENTS);
	assert.ok(!file.notes.some(item => item.eventId === 'event-5'), 'notes of dropped events are not exported');
	assert.equal(cursors.length, Math.ceil(HISTORY_EXPORT_MAX_EVENTS / 48));
});

test('the page bound and the byte bound both mark the file truncated without exceeding them', async () => {
	const endless = pager(HISTORY_EXPORT_MAX_PAGES * 2, 1);
	const paged = await collectHistoryExport(endless.scan, scope, options);
	assert.equal(endless.cursors.length, HISTORY_EXPORT_MAX_PAGES);
	assert.equal(paged.entries.length, HISTORY_EXPORT_MAX_PAGES);
	assert.equal(paged.truncated, true);
	// Each entry is roughly a third of the byte budget: the third one would overflow it.
	const big = 'x'.repeat(Math.ceil(HISTORY_EXPORT_MAX_BYTES / 3));
	const heavy: HistoryExportScan = async () => ({ entries: [3, 2, 1].map(position => entry(position, { after: { adapter: 'thing', version: 1, value: { big } } })), nextBefore: null });
	const bounded = await collectHistoryExport(heavy, scope, options);
	assert.equal(bounded.entries.length, 2);
	assert.equal(bounded.truncated, true);
	assert.ok(Buffer.byteLength(JSON.stringify(bounded.entries)) <= HISTORY_EXPORT_MAX_BYTES);
});

test('a 429 backs off by Retry-After up to three times, then propagates; other failures propagate at once', async () => {
	const waits: number[] = []; let calls = 0;
	const limited: HistoryExportScan = async () => { calls++; if (calls <= HISTORY_EXPORT_MAX_RETRIES) throw Object.assign(new Error('slow down'), { status: 429, retryAfterSeconds: calls === 1 ? 2 : null }); return { entries: [entry(1)], nextBefore: null }; };
	const file = await collectHistoryExport(limited, scope, { ...options, wait: async ms => { waits.push(ms); } });
	assert.equal(file.entries.length, 1);
	assert.deepEqual(waits, [2000, 1000, 1000]);
	const exhausted: HistoryExportScan = async () => { throw Object.assign(new Error('still slow'), { status: 429, retryAfterSeconds: 900 }); };
	const exhaustedWaits: number[] = [];
	await assert.rejects(collectHistoryExport(exhausted, scope, { ...options, wait: async ms => { exhaustedWaits.push(ms); } }), /still slow/);
	assert.deepEqual(exhaustedWaits, [30_000, 30_000, 30_000]);
	const refused: HistoryExportScan = async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); };
	await assert.rejects(collectHistoryExport(refused, scope, options), /Unauthorized/);
});

test('history that belongs to another account is refused and nothing is written', async () => {
	const foreign: HistoryExportScan = async () => ({ entries: [entry(2), entry(1, { ownerId: 'user-2' })], nextBefore: null });
	await assert.rejects(collectHistoryExport(foreign, scope, options), /another account/);
	const aborted = new AbortController(); aborted.abort();
	await assert.rejects(collectHistoryExport(async () => ({ entries: [], nextBefore: null }), scope, { ...options, signal: aborted.signal }), /cancelled/);
});
