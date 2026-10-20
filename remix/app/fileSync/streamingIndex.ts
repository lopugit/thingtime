import { validSyncEntry, type SyncEntry } from './reconcile';
import { nativeInventoryPageSize, NativeInventoryRetryWait } from './nativeInventory';
import { canonicalIgnoreRules, createSyncIgnorePolicy } from './syncIgnore';
import { canonicalNativeScanExclusions, isNativeScanExcluded } from './nativeScanExclusions';
import type { FolderRequest, FolderResult } from './mobileFolders.client';

export type NativeIndexChange = { sequence: number; revision: string; entry: SyncEntry; sourcePosition?: number; sourceKind?: 'snapshot' | 'delta' };
/** Remote provenance orders concurrent snapshot rows against durable deltas. */
export const validIndexProvenance = (change: Pick<NativeIndexChange, 'sourcePosition' | 'sourceKind'>) =>
	(change.sourcePosition === undefined && change.sourceKind === undefined) ||
	(Number.isSafeInteger(change.sourcePosition) && change.sourcePosition! >= 0 && ['snapshot', 'delta'].includes(change.sourceKind!));
export type NativeIndexChangesPage = {
	id: string;
	generation: string;
	state: 'running' | 'indexed' | 'complete' | 'interrupted';
	revision: number;
	changes: NativeIndexChange[];
	nextSequence: number;
	hasMore: boolean;
	totalEntries?: number;
	totalSkipped?: number;
};
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
/** A stream tail is a watermark, never a complete inventory. Native producers
 * must collision-check each namespace and its ancestors before publishing it. */
export function parseNativeIndexChangesPage(value: unknown, id: string, afterSequence: number, pageSize = 128): NativeIndexChangesPage {
	const p = value as NativeIndexChangesPage,
		maximum = nativeInventoryPageSize(pageSize);
	if (
		!p ||
		p.id !== id ||
		!identifier(p.id) ||
		!identifier(p.generation) ||
		!['running', 'indexed', 'complete', 'interrupted'].includes(p.state) ||
		!count(afterSequence) ||
		!count(p.revision) ||
		p.revision < afterSequence ||
		!Array.isArray(p.changes) ||
		p.changes.length > maximum ||
		typeof p.hasMore !== 'boolean' ||
		p.nextSequence !== afterSequence + p.changes.length ||
		p.nextSequence > p.revision ||
		p.hasMore !== p.nextSequence < p.revision ||
		(p.totalEntries !== undefined && !count(p.totalEntries)) ||
		(p.totalSkipped !== undefined && !count(p.totalSkipped))
	)
		throw Error('Native streaming index changed.');
	for (const [i, c] of p.changes.entries())
		if (!c || c.sequence !== afterSequence + i + 1 || !validSyncEntry(c.entry) || c.revision !== c.entry.version || !validIndexProvenance(c))
			throw Error('Native streaming revision changed.');
	const result = structuredClone(p);
	if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024) throw Error('Native streaming page exceeds its byte bound.');
	return result;
}

export async function* readNativeIndexChanges(input: {
	ownerId: string;
	deviceId: string;
	rootId: string;
	captureId: string;
	afterSequence: number;
	signal: AbortSignal;
	readyToFinish?(): Promise<boolean>;
	excludedPaths?: string[];
	ignoreRules?: string;
	pageSize?: number;
	request(ownerId: string, request: FolderRequest, signal: AbortSignal): Promise<FolderResult>;
}): AsyncGenerator<NativeIndexChangesPage> {
	const pageSize = nativeInventoryPageSize(input.pageSize),
		exclusions = canonicalNativeScanExclusions(input.excludedPaths ?? []);
	const ignoreRules = canonicalIgnoreRules(input.ignoreRules),
		ignore = createSyncIgnorePolicy(ignoreRules);
	const common = {
		rootId: input.rootId,
		inventoryDeviceId: input.deviceId,
		captureId: input.captureId,
		capturePolicy: 'one-way-supported' as const,
		excludedPaths: input.excludedPaths ?? [],
		...(ignoreRules ? { ignoreRules } : {})
	};
	input.signal.throwIfAborted();
	const begun = await input.request(input.ownerId, { action: 'scan-stream', ...common }, input.signal);
	let generation = begun.changesPage?.generation,
		afterSequence = input.afterSequence,
		indexed = false,
		pollAfterFinish = false;
	for (;;) {
		input.signal.throwIfAborted();
		const finish = indexed && !pollAfterFinish && !!input.readyToFinish && (await input.readyToFinish());
		pollAfterFinish = finish;
		const result = await input.request(
			input.ownerId,
			finish
				? { action: 'scan-stream-finish', ...common, afterSequence }
				: { action: 'scan-changes', ...common, afterSequence, pageSize, waitMilliseconds: indexed ? 2_000 : 25_000 },
			input.signal
		);
		input.signal.throwIfAborted();
		const page = parseNativeIndexChangesPage(result.changesPage, input.captureId, afterSequence, pageSize);
		if (generation !== undefined && page.generation !== generation) throw Error('Native streaming generation changed.');
		generation = page.generation;
		indexed = page.state === 'indexed';
		if (page.changes.some((c) => isNativeScanExcluded(c.entry.path, exclusions) || ignore.ignored(c.entry.path, c.entry.kind)))
			throw Error('Native streaming index included an excluded path.');
		if (page.state === 'interrupted')
			throw new NativeInventoryRetryWait('Streaming indexing was interrupted. Its durable cursor has been preserved.');
		yield page;
		afterSequence = page.nextSequence;
		if (page.state === 'complete' && !page.hasMore) return;
	}
}
