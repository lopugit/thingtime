import { randomUUID } from 'node:crypto';
import { writeCatalogueStream, type CatalogueIdentity } from '../../../catalogue/catalogueStream';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { getHomeThingsCollection, getThemesCollection, getFeedAlgorithmsCollection, withHomeMongoSnapshot } from '../mongodb/collections';
import { getActiveMongoEndpoint } from '../mongodb/endpoint';
import { projectThemeSyncDocument } from '../themes/themeSync';
import { projectAlgorithmSyncDocument } from '../algorithms/algorithmSync';

// Query work bounds, not catalogue count or size limits. One lookahead detects
// ambiguous IDs even across page boundaries; a later page re-reads that row.
export const CATALOGUE_PAGE_ENTRIES = 64;
const QUERY_TIMEOUT_MS = 5000;
const incomplete = () => new Error('Catalogue snapshot is incomplete. Keep the last complete catalogue.');
type Endpoint = ReturnType<typeof getActiveMongoEndpoint>;
type SnapshotDependencies = {
	things(): Promise<any>;
	themes(): Promise<any>;
	algorithms(): Promise<any>;
	snapshot<T>(work: (session: any) => Promise<T>): Promise<T>;
	endpoint(): Endpoint;
	projectTheme(doc: any, legacy: boolean): unknown;
	projectAlgorithm(doc: any, legacy: boolean): unknown;
	generation(): string;
};
export type CatalogueSnapshotInput = {
	identity: CatalogueIdentity;
	/** Re-read the authenticated session and selected plane; throw on change. */
	admit(): Promise<void>;
	signal?: AbortSignal;
	stallTimeoutMs?: number;
};

/** No durable server job and no restart at a newer snapshot. A failed/cancelled
 * observation has no clean EOF, so even a received terminal cannot be admitted.
 * The returned body is backpressured, including before its first byte. */
export function createCatalogueSnapshotService(overrides: Partial<SnapshotDependencies> = {}) {
	const deps: SnapshotDependencies = { things: getHomeThingsCollection, themes: getThemesCollection, algorithms: getFeedAlgorithmsCollection,
		snapshot: withHomeMongoSnapshot, endpoint: getActiveMongoEndpoint, projectTheme: projectThemeSyncDocument,
		projectAlgorithm: projectAlgorithmSyncDocument, generation: randomUUID, ...overrides };
	return function catalogueSnapshotBody(input: CatalogueSnapshotInput): ReadableStream<Uint8Array> {
		const { identity, admit } = input;
		const selected = deps.endpoint(), initial = selected ? { ...selected } : null;
		const stream = new TransformStream<Uint8Array, Uint8Array>(), writer = stream.writable.getWriter();
		const controller = new AbortController();
		const cancel = () => controller.abort(input.signal?.reason ?? incomplete());
		const abortWriter = () => { void writer.abort(incomplete()).catch(() => {}); };
		controller.signal.addEventListener('abort', abortWriter, { once: true });
		if (input.signal?.aborted) cancel(); else input.signal?.addEventListener('abort', cancel, { once: true });
		void writer.closed.catch(() => controller.abort(incomplete()));
		const check = () => {
			controller.signal.throwIfAborted();
			const current = deps.endpoint();
			if (current?.url !== initial?.url || current?.savedId !== initial?.savedId) throw incomplete();
		};
		const timeout = input.stallTimeoutMs ?? 240_000;
		const authorized = async (signal = controller.signal) => {
			check(); signal.throwIfAborted();
			let timer: ReturnType<typeof setTimeout> | undefined;
			let abort: (() => void) | undefined;
			try {
				await Promise.race([Promise.resolve().then(admit), new Promise<never>((_, reject) => {
					abort = () => reject(incomplete());
					signal.addEventListener('abort', abort, { once: true });
					timer = setTimeout(() => { controller.abort(incomplete()); reject(incomplete()); }, timeout);
				})]);
				check(); signal.throwIfAborted();
			} finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
		};
		const write = async (bytes: Uint8Array, signal: AbortSignal) => {
			// A large profile can span many frames. Reauthorize those writes too,
			// rather than waiting until the next page to notice revocation.
			const abort = () => controller.abort(incomplete());
			if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
			try { await authorized(signal); signal.throwIfAborted(); await writer.write(bytes); check(); }
			finally { signal.removeEventListener('abort', abort); }
		};
		const work = async () => {
			if (!Number.isFinite(timeout) || timeout <= 0) throw incomplete();
			await authorized();
			const modern = await deps.things(), legacy = await (identity.domain === 'themes' ? deps.themes() : deps.algorithms());
			check();
			await deps.snapshot(async session => {
				if (!session?.snapshotEnabled || session.inTransaction()) throw incomplete();
				let iterator: AsyncGenerator<{ id: string; value: unknown }> | undefined;
				async function* entries(signal: AbortSignal): AsyncGenerator<{ id: string; value: unknown }> {
					const guard = async () => { signal.throwIfAborted(); await authorized(signal); signal.throwIfAborted(); };
					const source = (collection: any, old: boolean) => {
						let rows: any[] = [], offset = 0, after = '', done = false;
						return { async peek(): Promise<any | undefined> {
							if (offset < rows.length) return rows[offset];
							if (done) return undefined;
							await guard();
							const filter = { ownerId: identity.ownerId, ...(old ? {} : { thingtime: identity.domain === 'themes' ? 'theme' : 'feed-algorithm' }),
								...(after ? { shareId: { $gt: after } } : {}) };
							const cursor = collection.find(filter, { session, signal, maxTimeMS: QUERY_TIMEOUT_MS, readPreference: 'primary',
								collation: { locale: 'simple' } }).sort({ shareId: 1 }).limit(CATALOGUE_PAGE_ENTRIES + 1).batchSize(CATALOGUE_PAGE_ENTRIES + 1);
							let page: any[];
							try { page = await cursor.toArray(); } finally { await cursor.close(); }
							await guard();
							let previous = after;
							for (const doc of page) {
								if (doc.ownerId !== identity.ownerId || typeof doc.shareId !== 'string' || !doc.shareId || doc.shareId <= previous ||
									(!old && (!Array.isArray(doc.thingtime) || !doc.thingtime.includes(identity.domain === 'themes' ? 'theme' : 'feed-algorithm')))) throw incomplete();
								previous = doc.shareId;
							}
							done = page.length <= CATALOGUE_PAGE_ENTRIES;
							rows = page.slice(0, CATALOGUE_PAGE_ENTRIES); offset = 0;
							if (rows.length) after = rows[rows.length - 1].shareId;
							return rows[offset];
						}, take() { offset++; } };
					};
					const current = source(modern, false), earlier = source(legacy, true);
					for (;;) {
						const a = await current.peek(), b = await earlier.peek();
						if (!a && !b) { await guard(); return; }
						const old = !a || (b && b.shareId < a.shareId), doc = old ? b : a;
						if (old) earlier.take(); else { current.take(); if (b?.shareId === a.shareId) earlier.take(); }
						const value = (identity.domain === 'themes' ? deps.projectTheme : deps.projectAlgorithm)(doc, !!old);
						// Reuse the former JSON structural/per-profile boundary without
						// imposing its old aggregate catalogue byte/count restriction.
						copyBoundedJson(value, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 250_000 });
						yield { id: doc.shareId, value };
					}
				}
				try {
					await writeCatalogueStream({ ...identity, version: 1, generation: deps.generation() }, signal => {
						iterator = entries(signal); return iterator;
					}, write, { signal: controller.signal, check, stallTimeoutMs: input.stallTimeoutMs });
				} finally {
					// The framing core cancels its signal before returning, but its
					// iterator cleanup is intentionally detached. Await ours before
					// ending the DB session, including an in-flight aborted page read.
					if (iterator) await iterator.return(undefined);
				}
			});
			// Clean EOF admits the terminal. Session cleanup may have awaited I/O,
			// so fence completion with one final current-authentication check too.
			await authorized(); await writer.close();
		};
		void work().catch(async () => { controller.abort(incomplete()); await writer.abort(incomplete()).catch(() => {}); }).finally(() => {
			input.signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', abortWriter); writer.releaseLock();
		});
		return stream.readable;
	};
}

export const catalogueSnapshotBody = createCatalogueSnapshotService();
