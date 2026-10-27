import type { CatalogueCompletion, CatalogueSink } from '../catalogue/catalogueStream';
import { WorkspaceError, type WorkspaceTransaction } from './storage';
import type { LocalThing } from './things';

type Ticket = { read: number; epoch: number };
type Meta = Ticket & { domain: string; entries: number; lastId: string; expiresAt: number };
type Run = <T>(mode: IDBTransactionMode, work: (tx: WorkspaceTransaction) => Promise<T>, signal?: AbortSignal) => Promise<T>;
const metas = 'catalogue-staging';
const lifetime = 24 * 60 * 60 * 1000;
const changed = () => new WorkspaceError('CATALOGUE_CHANGED', 'The catalogue read was superseded. Device changes have been kept.', 409);
const stageNames = (id: string) => {
	if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw changed();
	return { entries: `catalogue-stage-${id}`, references: `catalogue-references-${id}` };
};

/** Cursor pages keep admission within one IDB transaction without materializing
 * a library. Callers may await IDB requests only while consuming this iterator. */
export async function* scanWorkspace<T>(tx: WorkspaceTransaction, collection: string) {
	let after: string | undefined;
	for (;;) {
		const rows = await tx.scan<T>(collection, { after });
		if (!rows.length) return;
		for (const row of rows) yield row;
		after = rows[rows.length - 1].id;
	}
}

async function discard(tx: WorkspaceTransaction, id: string) {
	const names = stageNames(id);
	for (const collection of [names.entries, names.references])
		for await (const row of scanWorkspace(tx, collection)) await tx.delete(collection, row.id);
	await tx.delete(metas, id);
}

export type StagedCatalogue<T> = {
	rows(): AsyncIterable<{ id: string; value: T }>;
	has(id: string): Promise<boolean>;
	hasDependent(id: string): Promise<boolean>;
};

/** Provisional records live only in this caller's scoped workspace. A clean
 * terminal is required before one atomic, lease/signal/ticket-fenced admission.
 * Failed runs are removed; crash/retired-lease leftovers expire and are reclaimed
 * on the next authorized read. Neither staging nor cleanup touches sync queues. */
export async function stageCatalogue<T>(options: {
	run: Run;
	domain: 'themes' | 'algorithms';
	catalogKey: string;
	ticket: Ticket;
	id: string;
	parse(id: string, value: unknown): T;
	load(sink: CatalogueSink, signal: AbortSignal): Promise<CatalogueCompletion>;
	admit(tx: WorkspaceTransaction, rows: StagedCatalogue<T>): Promise<boolean>;
	signal: AbortSignal;
	now?: () => number;
}): Promise<boolean> {
	const { run, domain, ticket, signal, id } = options, now = options.now ?? Date.now, names = stageNames(id);
	let completed = false, admitted = false;
	const current = async (tx: WorkspaceTransaction) => {
		const catalog = await tx.get<Ticket>('settings', options.catalogKey);
		if (!catalog || catalog.read !== ticket.read || catalog.epoch !== ticket.epoch) throw changed();
	};
	await run('readwrite', async tx => {
		await current(tx);
		for await (const row of scanWorkspace<Meta>(tx, metas)) {
			if (row.value.expiresAt <= now() || (row.value.domain === domain && row.value.read !== ticket.read)) await discard(tx, row.id);
		}
		if (await tx.get(metas, id)) throw changed();
		await tx.put(metas, id, { ...ticket, domain, entries: 0, lastId: '', expiresAt: now() + lifetime } satisfies Meta);
	}, signal);
	try {
		await options.load({
			entry: async (entryId, value, streamSignal) => {
				if (completed) throw changed();
				const parsed = options.parse(entryId, value);
				await run('readwrite', async tx => {
					await current(tx);
					const meta = await tx.get<Meta>(metas, id);
					if (!meta || entryId <= meta.lastId || !Number.isSafeInteger(meta.entries + 1)) throw changed();
					await tx.put(names.entries, entryId, parsed);
					await tx.put(metas, id, { ...meta, entries: meta.entries + 1, lastId: entryId, expiresAt: now() + lifetime });
				}, AbortSignal.any([signal, streamSignal]));
			},
			complete: async (receipt, streamSignal) => {
				if (completed || receipt.domain !== domain) throw changed();
				admitted = await run('readwrite', async tx => {
					await current(tx);
					const meta = await tx.get<Meta>(metas, id);
					if (!meta || receipt.entries !== meta.entries) throw changed();
					// Construct a scoped reverse-presence index from CURRENT device Things
					// inside admission; it cannot miss an edit made while receiving bytes.
					for await (const { value } of scanWorkspace<LocalThing>(tx, 'things')) {
						for (const reference of [value.folderId, value.targetId])
							if (typeof reference === 'string' && reference) await tx.put(names.references, reference, true);
					}
					const result = await options.admit(tx, {
						rows: () => scanWorkspace<T>(tx, names.entries),
						has: async key => (await tx.get(names.entries, key)) !== undefined,
						hasDependent: async key => (await tx.get(names.references, key)) === true
					});
					await discard(tx, id);
					return result;
				}, AbortSignal.any([signal, streamSignal]));
				completed = true;
			}
		}, signal);
		if (!completed) throw changed();
		return admitted;
	} finally {
		// A failed stream's aborted signal must not prevent removing its own
		// provisional rows. The original workspace lease still fences cleanup.
		if (!completed) await run('readwrite', tx => discard(tx, id)).catch(() => {});
	}
}

/** Conflict review scans the same complete stream but retains only one entry. */
export async function findCatalogueEntry<T>(
	load: (sink: CatalogueSink, signal: AbortSignal) => Promise<CatalogueCompletion>,
	id: string, parse: (value: unknown) => T, signal: AbortSignal
): Promise<T | null> {
	let found: T | null = null, completed = false;
	await load({ entry: async (key, value) => { if (key === id) found = parse(value); }, complete: async () => { completed = true; } }, signal);
	signal.throwIfAborted();
	if (!completed) throw changed();
	return found;
}
