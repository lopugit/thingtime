import { readCloudInventoryStream } from './cloudInventoryStream';
import { inventorySyncEntry } from './cloudInventory';
import type { CloudInventoryPage } from './cloudInventoryPages';
import type { CloudTransportRuntime } from './cloudTransport';
import { sameSyncScope, validSyncEntry, type SyncEntry, type SyncScope } from './reconcile';
import type { NativeIndexChange, NativeIndexChangesPage } from './streamingIndex';

export type CloudIndexFeed = {
	version: 1;
	rootId: string;
	rootRevision: string;
	cursor: number;
	changes: { position: number; entry: SyncEntry; subtree: string | null }[];
	hasMore: boolean;
};
export type CloudIndexChange = NativeIndexChange & { sourcePosition: number; sourceKind: 'snapshot' | 'delta' };
export type CloudIndexResume = { cursor?: string; snapshotComplete?: boolean; checkpoint(cursor: string, snapshotComplete: boolean): Promise<void> };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const position = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export function parseCloudIndexFeed(value: unknown, rootId: string, after?: number): CloudIndexFeed {
	const feed = value as CloudIndexFeed;
	if (
		!feed ||
		feed.version !== 1 ||
		feed.rootId !== rootId ||
		!identifier(feed.rootRevision) ||
		!position(feed.cursor) ||
		(after !== undefined && (!position(after) || feed.cursor < after)) ||
		!Array.isArray(feed.changes) ||
		feed.changes.length > 8 ||
		typeof feed.hasMore !== 'boolean' ||
		(feed.hasMore && (after === undefined || feed.cursor === after))
	)
		throw Error('Cloud index changes are invalid.');
	let previous = after ?? feed.cursor;
	const changes = feed.changes.map((change) => {
		if (
			!change ||
			!position(change.position) ||
			change.position <= previous ||
			change.position > feed.cursor ||
			!validSyncEntry(change.entry) ||
			(change.entry.kind === 'file' && !change.entry.fingerprint) ||
			(change.entry.kind === 'folder' ? change.subtree !== change.entry.id : change.subtree !== null)
		)
			throw Error('Cloud index revision changed.');
		previous = change.position;
		return { position: change.position, entry: structuredClone(change.entry), subtree: change.subtree };
	});
	const result: CloudIndexFeed = { version: 1, rootId, rootRevision: feed.rootRevision, cursor: feed.cursor, changes, hasMore: feed.hasMore };
	if (new TextEncoder().encode(JSON.stringify(result)).length > 128 * 1024) throw Error('Cloud index page exceeds its byte bound.');
	return result;
}

type Frame =
	| { kind: 'entries'; entries: Omit<CloudIndexChange, 'sequence'>[] }
	| { kind: 'cursor'; cursor: number }
	| { kind: 'snapshot' }
	| { kind: 'idle'; accept(value: boolean): void };
/** Four transport frames of backpressure; durable raw-index storage belongs to
 * the shared run journal. The queue never retains a whole inventory or path set. */
function frameQueue(signal: AbortSignal) {
	const rows: Frame[] = [],
		waiters = new Set<() => void>();
	let ended = false,
		error: unknown;
	const wake = () => {
		for (const waiter of [...waiters]) waiter();
	};
	const changed = () =>
		new Promise<void>((resolve, reject) => {
			const done = () => {
				waiters.delete(done);
				signal.removeEventListener('abort', abort);
				resolve();
			};
			const abort = () => {
				waiters.delete(done);
				signal.removeEventListener('abort', abort);
				reject(signal.reason);
			};
			waiters.add(done);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
		});
	return {
		async push(frame: Frame) {
			while (rows.length === 4 && !ended) {
				signal.throwIfAborted();
				await changed();
			}
			signal.throwIfAborted();
			if (ended) throw error ?? Error('Cloud index queue closed.');
			rows.push(frame);
			wake();
		},
		async next(): Promise<Frame> {
			while (!rows.length && !ended) {
				signal.throwIfAborted();
				await changed();
			}
			signal.throwIfAborted();
			if (!rows.length) throw error ?? Error('Cloud index source closed.');
			const frame = rows.shift()!;
			wake();
			return frame;
		},
		close(reason?: unknown) {
			ended = true;
			error = reason;
			wake();
		}
	};
}

/** Subscribe from the durable Timeline watermark BEFORE opening the initial
 * snapshot. Snapshot and delta producers run together and drain into bounded
 * frames; the caller commits each yielded frame before requesting the next. */
export async function* readCloudIndexChanges(
	scope: SyncScope,
	rootId: string,
	input: CloudTransportRuntime & { signal?: AbortSignal; snapshot?(subtreeId?: string, signal?: AbortSignal): AsyncIterable<CloudInventoryPage> },
	captureId: string,
	afterSequence: number,
	readyToFinish: () => Promise<boolean>,
	resume: CloudIndexResume
): AsyncGenerator<NativeIndexChangesPage> {
	if (!identifier(rootId) || !identifier(captureId) || !position(afterSequence)) throw Error('Choose a cloud index root and durable cursor.');
	const controller = new AbortController(),
		signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
	const check = () => {
		signal.throwIfAborted();
		if (input.origin() !== scope.origin || !sameSyncScope(scope, input.currentScope())) throw Error('Cloud index context changed.');
	};
	const queue = frameQueue(signal);
	let sequence = afterSequence,
		cursor: number,
		snapshotComplete = resume.snapshotComplete === true;
	const page = (changes: NativeIndexChange[], complete = false): NativeIndexChangesPage => ({
		id: captureId,
		generation: captureId,
		state: complete ? 'complete' : snapshotComplete ? 'indexed' : 'running',
		revision: sequence,
		changes,
		nextSequence: sequence,
		hasMore: false
	});
	const snapshot = (subtreeId?: string) =>
		input.snapshot
			? input.snapshot(subtreeId, signal)
			: readCloudInventoryStream(scope, rootId, {
					...input,
					signal,
					fetch: (target, init) => {
						const url = new URL(String(target));
						if (subtreeId) url.searchParams.set('subtreeId', subtreeId);
						return input.fetch(url, init);
					}
			  });
	const feed = async (after?: number, wait = false) => {
		check();
		const query = new URLSearchParams({
			rootId,
			changes: '1',
			...(after === undefined ? {} : { after: String(after) }),
			...(wait ? { wait: '1' } : {})
		});
		const response = await input.fetch(new URL('/api/v1/files?' + query, scope.origin), {
			credentials: 'include',
			redirect: 'error',
			cache: 'no-store',
			signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
			headers: { Accept: 'application/json', 'X-Thingtime-Expected-Actor': scope.ownerId, 'X-Thingtime-Expected-Data-Plane': scope.dataPlane }
		});
		try {
			check();
			if (!response.ok || !response.body) throw Error(`Cloud index feed is unavailable (${response.status}). Its durable cursor was retained.`);
		} catch (error) {
			await response.body?.cancel().catch(() => {});
			throw error;
		}
		const reader = response.body.getReader(),
			parts: Uint8Array[] = [];
		let count = 0;
		try {
			for (;;) {
				const part = await reader.read();
				check();
				if (part.done) break;
				count += part.value.length;
				if (count > 128 * 1024 + 1024) throw Error('Cloud index page exceeds its byte bound.');
				parts.push(part.value);
			}
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		const bytes = new Uint8Array(count);
		let offset = 0;
		for (const part of parts) {
			bytes.set(part, offset);
			offset += part.length;
		}
		const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		if (result?.ok !== true) throw Error('Cloud index feed refused the current root.');
		return parseCloudIndexFeed(result.feed, rootId, after);
	};
	check();
	for (const [feature, version] of Object.entries({ 'api.files': '1.7.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0' })) {
		await input.requireCapability(feature, version);
		check();
	}
	if (resume.cursor !== undefined) {
		if (!/^(0|[1-9][0-9]{0,15})$/.test(resume.cursor) || !position(Number(resume.cursor))) throw Error('The saved cloud index cursor is invalid.');
		cursor = Number(resume.cursor);
	} else {
		const initial = await feed();
		cursor = initial.cursor;
		await resume.checkpoint(String(cursor), false);
		check();
	}
	const baseline = cursor;
	const guarded = async (work: () => Promise<void>) => {
		try {
			await work();
		} catch (error) {
			queue.close(error);
			controller.abort(error);
			throw error;
		}
	};
	const initial = guarded(async () => {
		if (snapshotComplete) return;
		for await (const value of snapshot()) {
			check();
			await queue.push({
				kind: 'entries',
				entries: value.nodes.map((node) => {
					const entry = inventorySyncEntry(node);
					return { entry, revision: entry.version, sourcePosition: baseline, sourceKind: 'snapshot' as const };
				})
			});
		}
		await queue.push({ kind: 'snapshot' });
	});
	const updates = guarded(async () => {
		let after = cursor;
		for (;;) {
			const current = await feed(after, !snapshotComplete || !(await readyToFinish()));
			check();
			for (const change of current.changes) {
				await queue.push({
					kind: 'entries',
					entries: [{ entry: change.entry, revision: change.entry.version, sourcePosition: change.position, sourceKind: 'delta' }]
				});
				if (change.subtree)
					for await (const value of snapshot(change.subtree)) {
						check();
						await queue.push({
							kind: 'entries',
							entries: value.nodes.map((node) => {
								const entry = inventorySyncEntry(node);
								return { entry, revision: entry.version, sourcePosition: change.position, sourceKind: 'delta' as const };
							})
						});
					}
			}
			after = current.cursor;
			await queue.push({ kind: 'cursor', cursor: after });
			if (!current.hasMore && snapshotComplete) {
				const finished = await new Promise<boolean>((resolve, reject) => {
					const abort = () => {
						signal.removeEventListener('abort', abort);
						reject(signal.reason);
					};
					signal.addEventListener('abort', abort, { once: true });
					void queue
						.push({
							kind: 'idle',
							accept: (value) => {
								signal.removeEventListener('abort', abort);
								resolve(value);
							}
						})
						.catch(reject);
				});
				if (finished) return;
			}
		}
	});
	// Rejection is consumed immediately even if the caller is currently persisting
	// a yielded page; finally still joins both producers before releasing the source.
	void initial.catch(() => {});
	void updates.catch(() => {});
	try {
		yield page([]);
		for (;;) {
			check();
			const frame = await queue.next();
			if (frame.kind === 'entries') {
				const changes = frame.entries.map((change) => ({ ...change, sequence: ++sequence }));
				yield page(changes);
			} else if (frame.kind === 'cursor') {
				cursor = frame.cursor;
				await resume.checkpoint(String(cursor), snapshotComplete);
			} else if (frame.kind === 'snapshot') {
				snapshotComplete = true;
				await resume.checkpoint(String(cursor), true);
				yield page([]);
			} else {
				const done = snapshotComplete && (await readyToFinish());
				frame.accept(done);
				if (done) {
					yield page([], true);
					return;
				}
			}
		}
	} finally {
		controller.abort();
		queue.close();
		await Promise.allSettled([initial, updates]);
	}
}
