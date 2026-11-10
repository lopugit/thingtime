import type { TimelineEntry } from '../../timeline/contract';
import type { TimelineNote } from '../../timeline/notes';
import type { TimelineVersionName } from '../../timeline/versionNames';
import type { TimelineStorage } from '../../timeline/storageScope';
import { triggerDownload } from '../Marketing/marketingDownload';
import { safeFilenamePart } from './timelineExportDownload';

/** Settings → History → Export: the one deliberate, bounded account-wide read.
 * It walks `connection.sync.scan` (transport-level pages that never touch the
 * IndexedDB cache) newest-first until a bound is hit, and writes one JSON file.
 * The file is a history export, never a version file: it deliberately does not
 * satisfy `timelineExportRecord` (no `event`/`content`, `kind` set), so it can
 * never be mistaken for a single-version export on import. Online only. */
export const HISTORY_EXPORT_MAX_EVENTS = 2000;
export const HISTORY_EXPORT_MAX_BYTES = 64 * 1024 * 1024;
export const HISTORY_EXPORT_MAX_PAGES = 50;
export const HISTORY_EXPORT_MAX_RETRIES = 3;
const RETRY_AFTER_MAX_SECONDS = 30;

export type HistoryExportPage = { entries: TimelineEntry[]; notes?: TimelineNote[]; names?: TimelineVersionName[]; nextBefore: number | null };
/** `TimelineSync.scan` shape: same validation as a page read, no store writes. */
export type HistoryExportScan = (cursor: { before?: number }) => Promise<HistoryExportPage>;
export type HistoryExportScope = { ownerId: string; dataPlane: string; storage: TimelineStorage };
export type HistoryExportFile = {
	kind: 'thingtime-history-export'; formatVersion: 1; exportedAt: string; ownerId: string; dataPlane: string; storage: TimelineStorage;
	bounds: { maxEvents: number; maxBytes: number; maxPages: number }; truncated: boolean;
	entries: TimelineEntry[]; notes: TimelineNote[]; names: TimelineVersionName[];
};
export type HistoryExportOptions = { now?: () => string; wait?: (ms: number) => Promise<void>; signal?: AbortSignal };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const retryAfterMs = (failure: unknown) => {
	const seconds = (failure as { retryAfterSeconds?: number | null })?.retryAfterSeconds;
	return Math.min(RETRY_AFTER_MAX_SECONDS, Number.isFinite(seconds) && (seconds as number) >= 0 ? (seconds as number) : 1) * 1000;
};
const rateLimited = (failure: unknown) => (failure as { status?: number })?.status === 429;

/** One page with 429 back-off: `Retry-After` (bounded, default 1 s) up to three times, then the failure propagates. */
async function scanPage(scan: HistoryExportScan, cursor: { before?: number }, options: HistoryExportOptions): Promise<HistoryExportPage> {
	const wait = options.wait ?? sleep;
	for (let attempt = 0; ; attempt++) {
		if (options.signal?.aborted) throw new Error('Export cancelled.');
		try { return await scan(cursor); }
		catch (failure) {
			if (!rateLimited(failure) || attempt >= HISTORY_EXPORT_MAX_RETRIES) throw failure;
			await wait(retryAfterMs(failure));
		}
	}
}

/** Collects entries, notes and names newest-first within the bounds. Every
 * entry must belong to the exporting owner (the scan validates page shape, not
 * the export's identity), notes/names are deduplicated by id and kept only for
 * exported events, and `truncated` says whether older history was left behind. */
export async function collectHistoryExport(scan: HistoryExportScan, scope: HistoryExportScope, options: HistoryExportOptions = {}): Promise<HistoryExportFile> {
	const entries: TimelineEntry[] = []; const notes = new Map<string, TimelineNote>(); const names = new Map<string, TimelineVersionName>();
	let bytes = 0; let truncated = false; let before: number | undefined; let pages = 0;
	while (pages < HISTORY_EXPORT_MAX_PAGES) {
		const page = await scanPage(scan, before === undefined ? {} : { before }, options);
		pages++;
		for (const entry of page.entries) {
			if (entry.event.ownerId !== scope.ownerId || entry.receipt.ownerId !== scope.ownerId) throw new Error('The export received history that belongs to another account.');
			const size = bytesOf(entry);
			if (entries.length >= HISTORY_EXPORT_MAX_EVENTS || bytes + size > HISTORY_EXPORT_MAX_BYTES) { truncated = true; break; }
			entries.push(entry); bytes += size;
		}
		// Messages and names ride with the events they belong to, including the events kept from a page that hit a bound.
		const ids = new Set(entries.map(entry => entry.event.id));
		for (const note of page.notes ?? []) if (ids.has(note.eventId) && note.ownerId === scope.ownerId) notes.set(note.id, note);
		for (const name of page.names ?? []) if (ids.has(name.eventId) && name.ownerId === scope.ownerId) names.set(name.id, name);
		if (truncated || page.nextBefore === null) break;
		before = page.nextBefore;
		if (pages >= HISTORY_EXPORT_MAX_PAGES) truncated = true;
	}
	return {
		kind: 'thingtime-history-export', formatVersion: 1, exportedAt: (options.now ?? (() => new Date().toISOString()))(),
		ownerId: scope.ownerId, dataPlane: scope.dataPlane, storage: scope.storage,
		bounds: { maxEvents: HISTORY_EXPORT_MAX_EVENTS, maxBytes: HISTORY_EXPORT_MAX_BYTES, maxPages: HISTORY_EXPORT_MAX_PAGES }, truncated,
		entries, notes: [...notes.values()], names: [...names.values()]
	};
}

/** `history-export-<ownerId>-<date>.json`; owner ids may carry `/`, `:` and `@`. */
export const historyExportFilename = (ownerId: string, exportedAt: string) => `history-export-${safeFilenamePart(ownerId).slice(0, 80)}-${exportedAt.slice(0, 10)}.json`;
export const historyExportText = (file: HistoryExportFile) => JSON.stringify(file, null, 2);

/** Browser only: saves through the shared anchor-click helper. Returns the file name for the inline notice. */
export function downloadHistoryExport(file: HistoryExportFile): string {
	const filename = historyExportFilename(file.ownerId, file.exportedAt);
	if (typeof Blob === 'undefined') throw new Error('Downloads need a browser.');
	triggerDownload(new Blob([historyExportText(file)], { type: 'application/json' }), filename);
	return filename;
}
