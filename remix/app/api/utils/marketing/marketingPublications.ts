import { getSettingsCollection } from '../mongodb/collections';
import { mongoRequestOptions } from '../mongodb/requestBudget';
import { EMPTY_PUBLICATIONS, validatePublicationChanges, type MarketingPublications, type PublicationChange } from '~/marketing/publishing';
import {
	MARKETING_PUBLICATIONS_SETTINGS_KEY,
	normalizeStoredItems,
	planPublicationWrite,
	projectPublications,
	type PublicationWritePlan,
	type StoredPublicationItem
} from './marketingPublicationsCore';

// Durable storage for the marketing publish state (see
// marketing/publishing.ts for the model). Mirrors the moderation-settings and
// AI-waterfall stores: one keyed singleton in the home-DB `settings`
// collection, read on every request, with a last-known-good copy kept only for
// an actual Mongo outage. Reads fail CLOSED to "nothing published" when there
// is no last-known-good value — an outage must never expose unpublished pages.

type StoredDoc = { items: unknown; updatedAt: unknown } | null;

type StoreDependencies = {
	readStored: (options: { signal?: AbortSignal; timeoutMS?: number }) => Promise<StoredDoc>;
	writeItems: (plan: PublicationWritePlan, meta: { at: Date; by: string | null }) => Promise<void>;
};

export type PublicationReadResult = { ok: true; publications: MarketingPublications; freshness: 'live' } | { ok: false; status: 503; error: string; freshness: 'stale' | 'unavailable'; publications?: MarketingPublications };

export const createMarketingPublicationsStore = (dependencies: StoreDependencies) => {
	let lastKnownGood: { items: StoredPublicationItem[]; updatedAt: unknown } | null = null;

	const getReadResult = async (options: { audit: boolean }): Promise<PublicationReadResult> => {
		try {
			const doc = await dependencies.readStored(mongoRequestOptions({ timeoutMS: 3000 }));
			const items = normalizeStoredItems(doc?.items);
			lastKnownGood = { items, updatedAt: doc?.updatedAt ?? null };
			return { ok: true, publications: projectPublications(items, doc?.updatedAt ?? null, options), freshness: 'live' };
		} catch {
			return {
				ok: false, status: 503, error: 'Marketing publishing is temporarily unavailable',
				freshness: lastKnownGood ? 'stale' : 'unavailable',
				...(lastKnownGood ? { publications: projectPublications(lastKnownGood.items, lastKnownGood.updatedAt, options) } : {})
			};
		}
	};

	const getPublications = async (options: { audit: boolean }): Promise<MarketingPublications> => {
		const result = await getReadResult(options);
		return result.publications ?? (options.audit ? { ...EMPTY_PUBLICATIONS, audit: {} } : { ...EMPTY_PUBLICATIONS });
	};

	const applyChanges = async (raw: unknown, by: string | null): Promise<{ ok: true; publications?: MarketingPublications; applied: number; freshness: 'live' | 'stale' | 'unavailable' } | { ok: false; status: number; error: string }> => {
		const validated = validatePublicationChanges(raw);
		if (validated.ok === false) return { ok: false, status: 400, error: validated.error };
		const changes: PublicationChange[] = validated.changes;
		await dependencies.writeItems(planPublicationWrite(changes, { at: new Date(), by }), { at: new Date(), by });
		const readback = await getReadResult({ audit: true });
		return { ok: true, publications: readback.publications, freshness: readback.freshness, applied: changes.length };
	};

	return { getPublications, getReadResult, applyChanges };
};

const store = createMarketingPublicationsStore({
	readStored: async (options) => {
		const doc = await (await getSettingsCollection()).findOne(
			{ key: MARKETING_PUBLICATIONS_SETTINGS_KEY },
			{ ...options, maxTimeMS: Math.min(3000, options.timeoutMS ?? 3000), projection: { _id: 0, items: 1, updatedAt: 1 } }
		);
		return doc ? { items: doc.items, updatedAt: doc.updatedAt } : null;
	},
	writeItems: async (plan, meta) => {
		// One atomic pipeline update: drop every touched key, append the new
		// rows. `$literal` keeps stored strings from being read as field paths.
		await (await getSettingsCollection()).updateOne(
			{ key: MARKETING_PUBLICATIONS_SETTINGS_KEY },
			[
				{
					$set: {
						key: MARKETING_PUBLICATIONS_SETTINGS_KEY,
						items: {
							$concatArrays: [
								{
									$filter: {
										input: { $ifNull: ['$items', []] },
										as: 'item',
										cond: { $not: [{ $in: ['$$item.key', { $literal: plan.removeKeys }] }] }
									}
								},
								{ $literal: plan.addItems }
							]
						},
						updatedAt: meta.at,
						updatedBy: meta.by
					}
				}
			],
			{ upsert: true }
		);
	}
});

export const getMarketingPublications = store.getPublications;
export const applyMarketingPublicationChanges = store.applyChanges;

export const getMarketingPublicationsResult = store.getReadResult;
