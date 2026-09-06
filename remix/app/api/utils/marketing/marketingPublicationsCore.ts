import { resolvePublicationKey, type MarketingPublications, type PublicationChange, type PublicationState } from '~/marketing/publishing';

// Pure half of the marketing publication store: how the settings singleton's
// stored rows become the client's published/hidden lists, and how a validated
// change list becomes a write plan. The Mongo adapter (marketingPublications.ts)
// only moves these shapes in and out of the `settings` collection.
//
// Storage shape (one `settings` doc, key 'marketing-publications'):
//   { key, items: [{ key, state, at, by }], updatedAt, updatedBy }
// One row per switched key. Rows whose key the catalog no longer generates are
// dropped on read, so removing a page from the catalog needs no migration.

export const MARKETING_PUBLICATIONS_SETTINGS_KEY = 'marketing-publications';

export type StoredPublicationItem = { key: string; state: PublicationState; at: Date; by: string | null };

export type PublicationWritePlan = { removeKeys: string[]; addItems: StoredPublicationItem[] };

const toDate = (value: unknown): Date | null => {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
	if (typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
};

/** Tolerant read: malformed rows, duplicate keys (last wins) and catalog-unknown keys all drop out. */
export const normalizeStoredItems = (raw: unknown): StoredPublicationItem[] => {
	if (!Array.isArray(raw)) return [];
	const byKey = new Map<string, StoredPublicationItem>();
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const { key, state, at, by } = entry as Record<string, unknown>;
		if (typeof key !== 'string' || (state !== 'published' && state !== 'hidden')) continue;
		const resolved = resolvePublicationKey(key);
		if (!resolved.ok) continue;
		const expected: PublicationState = resolved.target.type === 'section' ? 'hidden' : 'published';
		if (state !== expected) continue;
		byKey.set(key, { key, state, at: toDate(at) ?? new Date(0), by: typeof by === 'string' ? by : null });
	}
	return [...byKey.values()];
};

/** Rows → wire shape. `audit` (who/when per key) is projected for admin sessions only. */
export const projectPublications = (items: StoredPublicationItem[], updatedAt: unknown, options: { audit: boolean }): MarketingPublications => {
	const published: string[] = [];
	const hidden: string[] = [];
	const audit: Record<string, { at: string; by: string | null }> = {};
	for (const item of items) {
		(item.state === 'published' ? published : hidden).push(item.key);
		if (options.audit) audit[item.key] = { at: item.at.toISOString(), by: item.by };
	}
	const stamp = toDate(updatedAt);
	const result: MarketingPublications = { published, hidden, updatedAt: stamp ? stamp.toISOString() : null };
	if (options.audit) result.audit = audit;
	return result;
};

/** Validated changes → the rows to remove (every touched key) and the rows to add (non-null states). */
export const planPublicationWrite = (changes: PublicationChange[], meta: { at: Date; by: string | null }): PublicationWritePlan => ({
	removeKeys: changes.map((change) => change.key),
	addItems: changes.flatMap((change) => (change.state ? [{ key: change.key, state: change.state, at: meta.at, by: meta.by }] : []))
});

/** Pure twin of the Mongo pipeline update, used by tests and the fallback path. */
export const applyWritePlan = (items: StoredPublicationItem[], plan: PublicationWritePlan): StoredPublicationItem[] => {
	const removed = new Set(plan.removeKeys);
	return [...items.filter((item) => !removed.has(item.key)), ...plan.addItems];
};
