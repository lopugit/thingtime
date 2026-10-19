import { canonicalIgnoreRules, createSyncIgnorePolicy } from './syncIgnore';
import { canonicalNativeScanExclusions, isNativeScanExcluded } from './nativeScanExclusions';
import { validSyncEntry, validSyncPath, type SyncEntry, type SyncPolicy } from './reconcile';
import type { FolderRequest, FolderResult } from './mobileFolders.client';

export type NativeBackupCapture = { id: string; generation: string; totalEntries: number; coverage: 'full' | 'partial'; consistency: 'per-entry'; totalSkipped: number };
export type NativeBackupStatus = NativeBackupCapture & { state: 'running' | 'complete' | 'interrupted' };
export type NativeInventoryCapture = { id: string; generation: string; totalEntries: number } & Partial<Pick<NativeBackupCapture, 'coverage' | 'consistency' | 'totalSkipped'>>;
export type NativeScanSkip = { ordinal: number; path: string | null; reason: 'symlink' | 'special' | 'fifo' | 'socket' | 'device' | 'unreadable' | 'changed' | 'invalid-path' | 'duplicate-identity' | 'path-collision'; scope: 'entry' | 'subtree' | 'root' };
export type NativeSkippedPage = { capture: NativeBackupCapture; offset: number; skipped: NativeScanSkip[]; nextOffset: number | null; totalSkipped: number };
export type NativeIndexProgress = Pick<NativeBackupStatus, 'state' | 'coverage' | 'consistency' | 'totalEntries' | 'totalSkipped'>;
export class NativeInventoryRetryWait extends Error {}
// Each status read reauthorizes before and after native IO. Keep observation
// traffic comfortably below the shared device-read budget while the native
// worker continues independently; this does not cache or skip authorization.
export const NATIVE_INDEX_POLL_MS = 2_000;
export function assertBackupCapturePolicy(policy: SyncPolicy | undefined) {
	if (policy?.mode !== 'backup' || policy.propagateDeletes !== false) throw Error('Partial native captures require backup with deletion propagation disabled.');
}
export function parseNativeBackupCapture(value: unknown): NativeBackupCapture {
	const c = value as NativeBackupCapture;
	if (!c || !['full', 'partial'].includes(c.coverage) || c.consistency !== 'per-entry' || !Number.isSafeInteger(c.totalSkipped) || c.totalSkipped < 0 ||
		(c.coverage === 'full' && c.totalSkipped !== 0) || (c.coverage === 'partial' && c.totalSkipped === 0)) throw Error('Invalid backup coverage.');
	const { id, generation, totalEntries } = parseNativeInventoryCaptureBase(c);
	return { id, generation, totalEntries, coverage: c.coverage, consistency: c.consistency, totalSkipped: c.totalSkipped };
}
export function parseNativeBackupStatus(value: unknown): NativeBackupStatus {
	const c = value as NativeBackupStatus;
	if (!c || !['running', 'complete', 'interrupted'].includes(c.state)) throw Error('Invalid backup capture status.');
	if (c.state === 'complete') return { ...parseNativeBackupCapture(c), state: c.state };
	// A running capture has no whole-tree coverage claim, even before the first
	// skip. Only its sealed result can report full coverage.
	if (c.coverage !== 'partial' || c.consistency !== 'per-entry' || !Number.isSafeInteger(c.totalSkipped) || c.totalSkipped < 0)
		throw Error('Invalid running backup coverage.');
	return { ...parseNativeInventoryCaptureBase(c), coverage: c.coverage, consistency: c.consistency, totalSkipped: c.totalSkipped, state: c.state };
}
export function parseNativeScanSkip(value: unknown, ordinal: number): NativeScanSkip {
	const s = value as NativeScanSkip;
	if (!s || s.ordinal !== ordinal || !Number.isSafeInteger(ordinal) || ordinal < 0 ||
		!['symlink', 'special', 'fifo', 'socket', 'device', 'unreadable', 'changed', 'invalid-path', 'duplicate-identity', 'path-collision'].includes(s.reason) ||
		!['entry', 'subtree', 'root'].includes(s.scope) || (s.scope === 'root' ? s.path !== null || !['changed', 'unreadable'].includes(s.reason) :
			s.path === null ? s.reason !== 'invalid-path' : !validSyncPath(s.path))) throw Error('Invalid native skipped item.');
	return { ordinal, path: s.path, reason: s.reason, scope: s.scope };
}
export function parseNativeSkippedPage(value: unknown, capture: NativeBackupCapture, offset: number): NativeSkippedPage {
	const p = value as NativeSkippedPage, expected = parseNativeBackupCapture(capture);
	if (!p || JSON.stringify(parseNativeBackupCapture(p.capture)) !== JSON.stringify(expected) || !Number.isSafeInteger(offset) || offset < 0 ||
		p.offset !== offset || p.totalSkipped !== expected.totalSkipped || !Array.isArray(p.skipped) || p.skipped.length > 128) throw Error('Native skipped inventory changed.');
	const next = offset + p.skipped.length;
	if (next > expected.totalSkipped || (!p.skipped.length && (offset !== 0 || expected.totalSkipped !== 0)) ||
		p.nextOffset !== (next === expected.totalSkipped ? null : next)) throw Error('Native skipped inventory is incomplete.');
	const result = { capture: expected, offset, skipped: p.skipped.map((s, i) => parseNativeScanSkip(s, offset + i)), nextOffset: p.nextOffset, totalSkipped: expected.totalSkipped };
	if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024) throw Error('Native skipped inventory exceeds its byte bound.');
	return result;
}
export type NativeInventoryPage = { capture: NativeInventoryCapture; offset: number; entries: SyncEntry[]; nextOffset: number | null };
export type LocalInventoryPage = { generation: string; ordinal: number; entries: SyncEntry[]; totalEntries?: number; backupCapture?: NativeBackupCapture; skippedPage?: NativeSkippedPage };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function parseNativeInventoryCaptureBase(value: unknown): { id: string; generation: string; totalEntries: number } {
	const c = value as NativeInventoryCapture;
	if (!c || typeof c.id !== 'string' || !uuid.test(c.id) || typeof c.generation !== 'string' || !uuid.test(c.generation) ||
		!Number.isSafeInteger(c.totalEntries) || c.totalEntries < 0) throw Error('Invalid native inventory generation.');
	return { id: c.id, generation: c.generation, totalEntries: c.totalEntries };
}
export function parseNativeInventoryCapture(value: unknown): NativeInventoryCapture {
	const c = value as NativeInventoryCapture;
	return c && ['coverage', 'consistency', 'totalSkipped'].some(key => key in c) ? parseNativeBackupCapture(c) : parseNativeInventoryCaptureBase(c);
}
export function parseNativeInventoryPage(value: unknown, capture: NativeInventoryCapture, offset: number): NativeInventoryPage {
	const p = value as NativeInventoryPage, expected = parseNativeInventoryCapture(capture);
	if (!p || JSON.stringify(parseNativeInventoryCapture(p.capture)) !== JSON.stringify(expected) ||
		!Number.isSafeInteger(offset) || offset < 0 || p.offset !== offset || !Array.isArray(p.entries) || p.entries.length > 128 ||
		p.entries.some(entry => !validSyncEntry(entry))) throw Error('Native inventory page changed.');
	const next = offset + p.entries.length;
	if (next > expected.totalEntries || (!p.entries.length && (offset !== 0 || expected.totalEntries !== 0)) ||
		p.nextOffset !== (next === expected.totalEntries ? null : next)) throw Error('Native inventory page is incomplete.');
	const result = { capture: expected, offset, entries: structuredClone(p.entries), nextOffset: p.nextOffset };
	if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024) throw Error('Native inventory page exceeds its byte bound.');
	return result;
}

/** Import only one sealed generation. Missing, reordered or substituted pages
 * never become an empty scan; the caller seals its journal after the final count. */
export async function* readNativeInventory(input: {
	ownerId: string; deviceId: string; rootId: string; signal: AbortSignal; excludedPaths?: string[]; ignoreRules?: string;
	backupPolicy?: SyncPolicy; captureId?: string; onProgress?(progress: NativeIndexProgress): void;
	/** Durable task adapter binds observed native generations and restart budget. */
	onCaptureStatus?(status: NativeBackupStatus): Promise<void>;
	/** A task-owned scheduler may replace the abortable polling delay in tests. */
	waitForPoll?(): Promise<void>;
	request(ownerId: string, request: FolderRequest, signal: AbortSignal): Promise<FolderResult>;
}): AsyncGenerator<LocalInventoryPage> {
	const { ownerId, deviceId: inventoryDeviceId, rootId, signal } = input;
	const request: typeof input.request = async (owner, request, requestSignal) => {
		try { return await input.request(owner, request, requestSignal); }
		catch (error) {
			signal.throwIfAborted();
			if (input.backupPolicy && ((error instanceof Error && /timed?\s*out|timeout|network(?: request| connection)? (?:failed|lost|unavailable)|failed to fetch|offline|disconnected|connection (?:lost|closed)/i.test(error.message)) ||
				(error instanceof DOMException && error.name === 'TimeoutError'))) throw new NativeInventoryRetryWait('Backup indexing is reconnecting. Its capture has been preserved.');
			throw error;
		}
	};
	const provided = input.excludedPaths === undefined ? [] : input.excludedPaths;
	const exclusions = canonicalNativeScanExclusions(provided), excludedPaths = [...provided];
	const ignoreRules = canonicalIgnoreRules(input.ignoreRules), ignore = createSyncIgnorePolicy(ignoreRules);
	const ignoredPolicy = ignoreRules ? { ignoreRules } : {};
	let capture: NativeInventoryCapture | undefined;
	try {
		signal.throwIfAborted();
		const captureId = input.captureId ?? crypto.randomUUID();
		if (!uuid.test(captureId)) throw Error('Invalid native capture identity.');
		if (input.backupPolicy) assertBackupCapturePolicy(input.backupPolicy);
		const begin = await request(ownerId, { action: 'scan-capture', ...ignoredPolicy, rootId, inventoryDeviceId, captureId, ...(input.backupPolicy ? { capturePolicy: 'backup-supported' as const } : {}), ...(excludedPaths.length ? { excludedPaths } : {}) }, signal);
		if (input.backupPolicy) {
			let status = parseNativeBackupStatus(begin.backupCapture);
			while (true) {
				signal.throwIfAborted();
				if (status.id !== captureId) throw Error('Native capture identity changed.');
				await input.onCaptureStatus?.(status); signal.throwIfAborted();
				input.onProgress?.(status);
				if (status.state === 'complete') { capture = parseNativeBackupCapture(status); break; }
				if (status.state === 'interrupted') throw new NativeInventoryRetryWait('Backup indexing was interrupted. Its saved capture will retry automatically.');
				if (input.waitForPoll) await input.waitForPoll();
				else await new Promise<void>((resolve, reject) => {
					const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
					const timer = setTimeout(finish, NATIVE_INDEX_POLL_MS);
					const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
					signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
				});
				let response: FolderResult;
				try { response = await request(ownerId, { action: 'scan-status', ...ignoredPolicy, rootId, inventoryDeviceId, captureId, capturePolicy: 'backup-supported', excludedPaths }, signal); }
				catch (error) { signal.throwIfAborted(); throw error; }
				const next = parseNativeBackupStatus(response.backupCapture);
				// Supported rows are provisional until sealing: a later case/Unicode
				// collision can retract an earlier subtree into the skipped ledger.
				// Pages below still pin the sealed descriptor and exact final count.
				if (next.generation !== status.generation || next.totalSkipped < status.totalSkipped) throw Error('Native indexing generation or coverage changed.');
				status = next;
			}
			let skipOffset = 0;
			do {
				signal.throwIfAborted();
				const response = await request(ownerId, { action: 'scan-skips', ...ignoredPolicy, rootId, inventoryDeviceId, capture: capture as NativeBackupCapture, offset: skipOffset, capturePolicy: 'backup-supported' }, signal);
				const skippedPage = parseNativeSkippedPage(response.skippedPage, capture as NativeBackupCapture, skipOffset);
				signal.throwIfAborted();
				yield { generation: capture.generation, ordinal: 0, entries: [], backupCapture: capture as NativeBackupCapture, skippedPage };
				if (skippedPage.nextOffset === null) break;
				skipOffset = skippedPage.nextOffset;
			} while (true);
		} else { capture = parseNativeInventoryCapture(begin.capture); if (capture.coverage !== undefined) throw Error('Partial inventory requires the negotiated backup policy.'); }
		if (capture.id !== captureId) throw Error('Native capture identity changed.');
		let offset = 0, ordinal = 0;
		while (true) {
			signal.throwIfAborted();
			const response = await request(ownerId, { action: 'scan-page', ...ignoredPolicy, rootId, inventoryDeviceId, capture, offset, ...(input.backupPolicy ? { capturePolicy: 'backup-supported' as const } : {}) }, signal);
			signal.throwIfAborted();
			const page = parseNativeInventoryPage(response.inventoryPage, capture, offset);
			if (page.entries.some(entry => isNativeScanExcluded(entry.path, exclusions) || ignore.ignored(entry.path, entry.kind))) throw Error('Native inventory included an excluded path.');
			yield { generation: capture.generation, ordinal: ordinal++, entries: page.entries, ...(input.backupPolicy ? { backupCapture: capture as NativeBackupCapture } : {}),
				...(page.nextOffset === null ? { totalEntries: capture.totalEntries } : {}) };
			if (page.nextOffset === null) return;
			offset = page.nextOffset;
		}
	} finally {
		// Owner changes/cancellation can refuse cleanup. The native cache evicts
		// old captures under its scope lock, so an abandoned request stays bounded.
		if (capture && !signal.aborted) await request(ownerId, { action: 'scan-discard', ...ignoredPolicy, rootId, inventoryDeviceId, capture, ...(input.backupPolicy ? { capturePolicy: 'backup-supported' as const } : {}) }, signal).catch(() => {});
	}
}
