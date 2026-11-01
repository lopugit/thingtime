import { getHomeThingsCollection, withHomeMongoSnapshot } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { timelineFolderId } from '../timeline/repository';
import { TIMELINE_EVENT_KIND } from '../../../timeline/contract';
import { isFolderThing } from '../../../schemas/folderThing';
import { MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { StorageMutationError } from '../storage/storageCore';
import { inventorySyncEntry } from '../../../fileSync/cloudInventory';
import { cloudInventoryAccess as access, createCloudPathService, readCloudInventoryNode, readCloudInventoryRoot } from './inventory';

export const CLOUD_CHANGES_MAX_HEADERS = 32, CLOUD_CHANGES_MAX_ENTRIES = 8, CLOUD_CHANGES_MAX_BYTES = 128 * 1024;
const fail = (status: number, message: string): never => { throw new StorageMutationError(status, 'storage_conflict', message); };

/** Resolve current placement inside the authorized root, then reuse the exact
 * path-observation collision gate in this same snapshot. Timeline only wakes
 * current observations: client-authored history never supplies file metadata. */
export async function resolveCloudChangeTarget(things: any, session: any, ownerId: string, rootId: string, id: string,
    budget: () => number, signal?: AbortSignal) {
    if (id === rootId) return null;
    let next: string | null = id, target: any = null;
    const seen = new Set<string>(), names: string[] = [], chain: any[] = [];
    while (next !== rootId) {
        if (!next) return null; // Not a descendant. Never infer deletion.
        if (!access.identity(next) || seen.has(next) || seen.size >= MAX_FOLDER_DEPTH) return null;
        seen.add(next);
        const doc = await things.findOne({ shareId: next, ownerId }, { session, projection: access.projection, maxTimeMS: budget(), signal, readPreference: 'primary' });
        if (!doc || doc.crystal?.trashed === true) return null;
        if (!target && !isFolderThing(doc) && !(doc.thingtime?.length === 1 && doc.thingtime[0] === 'file')) return null;
        chain.push(doc);
        if (!target) target = doc;
        names.unshift(doc.crystal?.name);
        next = doc.folderId ?? null;
    }
    if (chain.some((doc, index) => !access.owned(doc, ownerId) || !access.privateAudience(doc, true) || (index > 0 && !isFolderThing(doc)))) fail(409, 'A changed cloud item is inaccessible.');
    if (names.some(name => typeof name !== 'string' || name.includes('/'))) fail(409, 'Cloud change path is invalid.');
    const path = names.join('/'), prefix = names.slice(0, -1).join('/');
    const node = readCloudInventoryNode(target, ownerId, target.folderId, prefix, rootId);
    if (node.path !== path) fail(409, 'Cloud change path is invalid.');
    const read = createCloudPathService({ collection: async () => things, transaction: work => work(session), customPlane: () => false, now: () => { budget(); return Date.now(); } });
    const checked = await read(ownerId, rootId, path, signal);
    if (!checked.ok) fail(checked.status, checked.error);
    const expected = inventorySyncEntry(node), entry = checked.observation.entry;
    if (!entry || entry.id !== expected.id || entry.version !== expected.version) fail(409, 'Cloud change placement changed; retry the same cursor.');
    return { node, entry };
}

/** Durable deltas reuse the canonical owner-serialized Timeline log. No saved
 * feed collection, in-process cursor, or full-tree refresh is needed. */
export function createCloudInventoryChangesService(overrides: Partial<{
    collection(): Promise<any>; snapshot<T>(work: (session: any) => Promise<T>): Promise<T>;
    customPlane(): boolean; now(): number; resolve: typeof resolveCloudChangeTarget;
}> = {}) {
    const deps = { collection: getHomeThingsCollection, snapshot: withHomeMongoSnapshot,
        customPlane: isCustomMongoEndpointActive, now: Date.now, resolve: resolveCloudChangeTarget, ...overrides };
    let active = 0;
    return async (ownerId: string, rootId: unknown, after: unknown, wait: boolean, signal?: AbortSignal) => {
        if (!access.identity(ownerId) || !access.identity(rootId) || (after !== undefined && (!Number.isSafeInteger(after) || (after as number) < 0)) || (wait && after === undefined))
            return { ok: false as const, status: 400, error: 'Choose a cloud root and a valid change cursor.' };
        if (deps.customPlane()) return { ok: false as const, status: 409, error: 'Files currently require the home data plane.' };
        if (active >= 8) return { ok: false as const, status: 503, error: 'Cloud change capacity is busy; retry the same cursor.' };
        active++;
        const started = deps.now(); let watcher: any;
        const abort = () => { if (watcher) void watcher.close().catch(() => {}); };
        const budget = () => { signal?.throwIfAborted(); if (deps.customPlane()) fail(409, 'Cloud change data plane changed.');
            const remaining = 20_000 - (deps.now() - started); if (remaining <= 0) fail(503, 'Cloud change observation timed out.'); return Math.min(5000, remaining); };
        try {
            const things = await deps.collection();
            const page = () => deps.snapshot(async session => {
                if (!session?.snapshotEnabled || session.inTransaction()) throw Error('Cloud changes require a snapshot session');
                const root = await readCloudInventoryRoot(things, session, ownerId, rootId as string, budget, signal);
                const folder = await things.findOne({ shareId: timelineFolderId(ownerId), ownerId }, { session, projection: { timelinePosition: 1 }, maxTimeMS: budget(), signal });
                const watermark = folder?.timelinePosition ?? 0;
                if (!Number.isSafeInteger(watermark) || watermark < 0 || (after !== undefined && (after as number) > watermark)) fail(409, 'Cloud change cursor is unavailable; restart reconciliation.');
                // A missing retained boundary cannot be mistaken for an idle feed.
                for (const position of new Set([watermark, after as number].filter(n => n > 0))) {
                    const boundary = await things.findOne({ ownerId, thingtime: TIMELINE_EVENT_KIND, createdAt: new Date(position) },
                        { session, projection: { createdAt: 1 }, maxTimeMS: budget(), signal });
                    if (!boundary) fail(409, 'Cloud change history is incomplete; restart reconciliation.');
                }
                const feed = { version: 1 as const, rootId: rootId as string, rootRevision: access.folderRevision(root), cursor: after === undefined ? watermark : after as number,
                    changes: [] as { position: number; entry: NonNullable<Awaited<ReturnType<typeof resolveCloudChangeTarget>>>['entry']; subtree: string | null }[], hasMore: false };
                if (after === undefined) return { ok: true as const, feed };
                const headers = await things.find({ ownerId, thingtime: TIMELINE_EVENT_KIND, createdAt: { $gt: new Date(after as number), $lte: new Date(watermark) } },
                    { session, projection: { targetId: 1, createdAt: 1 }, maxTimeMS: budget(), signal, readPreference: 'primary' })
                    .sort({ createdAt: 1 }).limit(CLOUD_CHANGES_MAX_HEADERS).toArray();
                for (const header of headers) {
                    budget(); const position = new Date(header.createdAt).getTime();
                    if (!Number.isSafeInteger(position) || position <= feed.cursor || position > watermark) fail(409, 'Cloud change history is invalid.');
                    const resolved = access.identity(header.targetId) ? await deps.resolve(things, session, ownerId, rootId as string, header.targetId, budget, signal) : null;
                    if (resolved) {
                        const change = { position, entry: resolved.entry, subtree: resolved.node.kind === 'folder' ? resolved.node.id : null };
                        if (Buffer.byteLength(JSON.stringify({ ...feed, changes: [...feed.changes, change] })) > CLOUD_CHANGES_MAX_BYTES) {
                            if (!feed.changes.length) fail(413, 'Cloud change exceeds its response bound.'); break;
                        }
                        feed.changes.push(change);
                    }
                    feed.cursor = position;
                    if (feed.changes.length >= CLOUD_CHANGES_MAX_ENTRIES) break;
                }
                // No silent cursor advancement across missing committed history.
                if (!headers.length && watermark > (after as number)) fail(409, 'Cloud change history is incomplete; restart reconciliation.');
                feed.hasMore = feed.cursor < watermark;
                return { ok: true as const, feed };
            });
            if (wait) {
                await deps.snapshot(session => readCloudInventoryRoot(things, session, ownerId, rootId as string, budget, signal));
                // Start the native subscription BEFORE the first read. Mongo's
                // watch() is lazy; prime it once so a commit cannot fall in the
                // read/subscribe gap. The durable cursor remains Timeline's.
                watcher = things.watch([{ $match: { operationType: 'insert', 'fullDocument.ownerId': ownerId, 'fullDocument.thingtime': TIMELINE_EVENT_KIND } }, { $project: { _id: 1 } }], { maxAwaitTimeMS: 1000 });
                signal?.addEventListener('abort', abort, { once: true });
                await watcher.tryNext(); budget();
            }
            let result = await page();
            while (wait && !result.feed.hasMore && result.feed.cursor === after && deps.now() - started < 15_000) {
                signal?.throwIfAborted(); const change = await watcher.tryNext(); budget();
                if (change) { result = await page(); if (result.feed.cursor !== after) break; }
            }
            // Even an idle long-poll response must recheck current root ACLs;
            // metadata revocation is not assumed to generate a wake event.
            if (wait && result.feed.cursor === after) result = await page();
            budget(); return result;
        } catch (error) {
            return error instanceof StorageMutationError ? { ok: false as const, status: error.status, error: error.message }
                : { ok: false as const, status: 503, error: 'Cloud changes are unavailable; retain the durable cursor and retry.' };
        } finally {
            active--; signal?.removeEventListener('abort', abort);
            if (watcher) { try { await watcher.close(); } catch { /* The response remains a bounded read; cancellation already failed closed. */ } }
        }
    };
}
export const readCloudInventoryChanges = createCloudInventoryChangesService();
