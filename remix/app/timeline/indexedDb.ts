import { timelineLocalIndex, validateTimelineRow, type LocalTimelineRow, type TimelineLocalBackend, type TimelineLocalIndex, type TimelineLocalSelection } from './localStore.ts';
import { joinTimelineEvent, splitTimelineEvent, type TimelineEventRecord, type TimelineLink } from './records.ts';
import { TIMELINE_BRANCH_CACHE_HEADS, TIMELINE_BRANCH_PENDING_LIMIT, type BranchLocalState, type TimelineBranchBackend } from './branchStore.ts';

type StoredRow = Omit<LocalTimelineRow, 'event'> & { event: TimelineEventRecord };
type StoredLink = { scope: string; link: TimelineLink };
const stores = ['events', 'eventIndex', 'links'];
const hydrate = (row: StoredRow, links: StoredLink[]): LocalTimelineRow => {
	if (links.some(link => link.scope !== row.scope)) throw new Error('Timeline relationship scope changed');
	return { ...row, event: joinTimelineEvent(row.event, links.map(item => item.link)) };
};
const putRow = (row: LocalTimelineRow, payloads: IDBObjectStore, index: IDBObjectStore, links: IDBObjectStore) => {
	const records = splitTimelineEvent(row.event);
	payloads.put({ ...row, event: records.event }); index.put(timelineLocalIndex(row));
	for (const link of records.links) links.put({ scope: row.scope, link });
};

/** Snapshot records, atomic relationship records and their index commit together. There is no
 * localStorage fallback that could report a successful save while losing edits. */
export class IndexedDbTimelineBackend implements TimelineLocalBackend, TimelineBranchBackend {
	private database: Promise<IDBDatabase> | null = null;
	constructor(private factory: IDBFactory, private name = 'thingtime-timeline-v1') {}
	private open(): Promise<IDBDatabase> {
		if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
			const request = this.factory.open(this.name, 5);
			let abandoned = false;
			request.onupgradeneeded = change => {
				const db = request.result;
				const payloads = db.objectStoreNames.contains('events') ? request.transaction!.objectStore('events') : db.createObjectStore('events', { keyPath: ['scope', 'event.id'] });
				if (!payloads.indexNames.contains('scope')) payloads.createIndex('scope', 'scope');
				const existingIndex = db.objectStoreNames.contains('eventIndex');
				const index = existingIndex ? request.transaction!.objectStore('eventIndex') : db.createObjectStore('eventIndex', { keyPath: ['scope', 'id'] });
				if (!existingIndex) { index.createIndex('scope', 'scope'); index.createIndex('thing', ['scope', 'thingId']); index.createIndex('status', ['scope', 'status']); }
				if (!index.indexNames.contains('draft')) index.createIndex('draft', ['scope', 'draftKey']);
				const links = db.objectStoreNames.contains('links') ? request.transaction!.objectStore('links') : db.createObjectStore('links', { keyPath: ['scope', 'link.id'] });
				if (!links.indexNames.contains('event')) links.createIndex('event', ['scope', 'link.eventId']);
				if (!links.indexNames.contains('target')) links.createIndex('target', ['scope', 'link.relation', 'link.targetId']);
				for (const [storeName, key] of [['branches', 'branch.id'], ['branchHeads', 'head.id'], ['branchCommands', 'command.operationId']]) {
					if (!db.objectStoreNames.contains(storeName)) { const store = db.createObjectStore(storeName, { keyPath: ['scope', key] }); store.createIndex('scope', 'scope'); }
				}
				// Upgrade existing pending work in place; invalid data aborts the
				// upgrade, preserving the original DB for recovery.
				if ((change as IDBVersionChangeEvent).oldVersion >= 4) return;
				const cursor = payloads.openCursor();
				cursor.onsuccess = () => {
					if (!cursor.result) return;
					try {
						const row = validateTimelineRow(cursor.result.value, cursor.result.value.scope);
						// v3 may have a newer draft pin/access time in its small index.
						// Preserve it; snapshot rows intentionally do not get rewritten
						// for every touch or draft release.
						const metadata = index.get([row.scope, row.event.id]);
						metadata.onsuccess = () => {
							try { putRow(metadata.result ? { ...row, draftKey: metadata.result.draftKey ?? null, accessedAt: metadata.result.accessedAt } : row, payloads, index, links); cursor.result!.continue(); }
							catch { request.transaction!.abort(); }
						};
					}
					catch { request.transaction!.abort(); }
				};
			};
			request.onsuccess = () => {
				const db = request.result;
				if (abandoned) { db.close(); return; }
				db.onversionchange = () => { db.close(); this.database = null; }; resolve(db);
			};
			request.onerror = () => { this.database = null; reject(request.error ?? new Error('Timeline storage is unavailable')); };
			request.onblocked = () => { abandoned = true; this.database = null; reject(new Error('Close older Thingtime tabs to update Timeline storage')); };
		});
		return this.database;
	}
	async read(scope: string, selection?: TimelineLocalSelection): Promise<LocalTimelineRow[]> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(stores, 'readonly');
			const index = transaction.objectStore('eventIndex'); const payloads = transaction.objectStore('events'); const links = transaction.objectStore('links');
			const request = selection?.draftKey ? index.index('draft').getAll([scope, selection.draftKey]) : selection?.thingId ? index.index('thing').getAll([scope, selection.thingId]) : selection?.status ? index.index('status').getAll([scope, selection.status]) : index.index('scope').getAll(scope);
			const rows: LocalTimelineRow[] = []; let failure: unknown;
			request.onsuccess = () => {
				for (const metadata of request.result as TimelineLocalIndex[]) {
					if (selection?.status && metadata.status !== selection.status) continue;
					if (selection?.thingIds && !selection.thingIds.includes(metadata.thingId)) continue;
					const read = payloads.get([scope, metadata.id]);
					const related = links.index('event').getAll([scope, metadata.id]);
					let waiting = 2;
					const complete = () => {
						if (--waiting) return;
						if (!read.result) { failure = new Error('Timeline payload is missing. Pending index preserved.'); transaction.abort(); return; }
						try { rows.push(hydrate({ ...read.result, accessedAt: metadata.accessedAt, draftKey: metadata.draftKey ?? null }, related.result)); }
						catch (error) { failure = error; transaction.abort(); }
					};
					read.onsuccess = complete; related.onsuccess = complete;
				}
			};
			transaction.oncomplete = () => resolve(rows);
			transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Timeline read failed'));
		});
	}
	async change(scope: string, payloadIds: string[], update: Parameters<TimelineLocalBackend['change']>[2]): Promise<void> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(stores, 'readwrite', { durability: 'strict' });
			const payloads = transaction.objectStore('events'); const index = transaction.objectStore('eventIndex'); const links = transaction.objectStore('links');
			const headers = index.index('scope').getAll(scope);
			const ids = [...new Set(payloadIds)];
			const reads = ids.map(id => payloads.get([scope, id]));
			const related = ids.map(id => links.index('event').getAll([scope, id]));
			let outstanding = reads.length * 2 + 1; let failure: unknown;
			const ready = () => {
				if (--outstanding) return;
				try {
					const changes = update(headers.result, reads.flatMap((read, n) => read.result ? [hydrate(read.result, related[n].result)] : []));
					for (const row of changes.put) {
						if (row.scope !== scope) throw new Error('Timeline storage scope changed');
						putRow(row, payloads, index, links);
					}
					for (const id of changes.remove) {
						payloads.delete([scope, id]); index.delete([scope, id]);
						const cursor = links.index('event').openCursor([scope, id]);
						cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
					}
					const byId = new Map<string, TimelineLocalIndex>(headers.result.map((item: TimelineLocalIndex) => [item.id, item]));
					for (const touch of changes.touch ?? []) { const existing = byId.get(touch.id); if (existing) index.put({ ...existing, ...touch }); }
				} catch (error) { failure = error; transaction.abort(); }
			};
			headers.onsuccess = ready; [...reads, ...related].forEach(read => { read.onsuccess = ready; });
			transaction.oncomplete = () => resolve();
			transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Timeline save failed'));
		});
	}
	private async branchTransaction(scope: string, update?: (state: BranchLocalState) => BranchLocalState): Promise<BranchLocalState> {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			const specs = [['branches', 'branches', (row: any) => row.branch.id], ['heads', 'branchHeads', (row: any) => row.head.id], ['pending', 'branchCommands', (row: any) => row.command.operationId]] as const;
			const tx = db.transaction(specs.map(([, name]) => name), update ? 'readwrite' : 'readonly', update ? { durability: 'strict' } : undefined);
			const reads = specs.map(([, name]) => tx.objectStore(name).index('scope').getAll(scope, TIMELINE_BRANCH_CACHE_HEADS + TIMELINE_BRANCH_PENDING_LIMIT + 1));
			let waiting = reads.length; let result: BranchLocalState; let failure: unknown;
			const ready = () => {
				if (--waiting) return;
				try {
					const before = { branches: reads[0].result, heads: reads[1].result, pending: reads[2].result };
					result = update ? update(before) : before;
					if (!update) return;
					for (const [field, name, key] of specs) {
						const store = tx.objectStore(name); const old = new Map(before[field].map(row => [key(row), JSON.stringify(row)]));
						for (const row of result[field]) {
							if (row.scope !== scope) throw new Error('Timeline branch scope changed');
							const id = key(row); if (old.get(id) !== JSON.stringify(row)) store.put(row); old.delete(id);
						}
						for (const id of old.keys()) store.delete([scope, id]);
					}
				} catch (error) { failure = error; tx.abort(); }
			};
			reads.forEach(read => { read.onsuccess = ready; });
			tx.oncomplete = () => resolve(result); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Timeline branch storage failed'));
		});
	}
	readBranchState(scope: string): Promise<BranchLocalState> { return this.branchTransaction(scope); }
	async changeBranchState(scope: string, update: (state: BranchLocalState) => BranchLocalState): Promise<void> { await this.branchTransaction(scope, update); }
	async close(): Promise<void> { const db = this.database; this.database = null; (await db)?.close(); }
}
