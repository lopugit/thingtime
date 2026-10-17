import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection, getSettingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { ACL_ALL, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
	AI_MODEL_CATALOG,
	AI_MODEL_PROVIDER_IDS,
	AI_MODEL_THINGTIME,
	AI_MODEL_UNIQUE_KEY_FIELD,
	aiModelShareId,
	aiProviderStatusFromEnv,
	getAiModelCatalogEntry,
	type AiModelProviderId
} from './modelsCore';
import { discoverConfiguredProviderModels, isModelUnavailableError, type DiscoveredAiModel } from './modelDiscovery';

// Leave room for cron invocation jitter so a daily job is never skipped.
const DAILY_INTERVAL = 23 * 60 * 60_000;
const COOLDOWN = 5 * 60_000;
const LEASE = 2 * 60_000;
export type ModelSyncReason = 'scheduled' | 'unavailable' | 'admin';
export type ModelSyncResult = { provider: AiModelProviderId; status: 'synced' | 'skipped' | 'failed'; count?: number };
export type ModelSyncClaim = { token: string; startedAt: Date };
export type ModelSyncStore = {
	claim(provider: AiModelProviderId, reason: ModelSyncReason): Promise<ModelSyncClaim | null>;
	publish(provider: AiModelProviderId, claim: ModelSyncClaim, models: DiscoveredAiModel[]): Promise<boolean>;
	fail(provider: AiModelProviderId, claim: ModelSyncClaim): Promise<void>;
};

export function createAiModelSync(deps: {
	store: ModelSyncStore;
	discover: (provider: AiModelProviderId) => Promise<DiscoveredAiModel[]>;
	configured: (provider: AiModelProviderId) => boolean;
}) {
	const pending = new Map<AiModelProviderId, Promise<ModelSyncResult>>();
	const syncProvider = (provider: AiModelProviderId, reason: ModelSyncReason = 'scheduled'): Promise<ModelSyncResult> => {
		const current = pending.get(provider);
		if (current) return current;
		const run = (async (): Promise<ModelSyncResult> => {
			if (!deps.configured(provider)) return { provider, status: 'skipped' };
			let claim: ModelSyncClaim | null = null;
			try {
				claim = await deps.store.claim(provider, reason);
				if (!claim) return { provider, status: 'skipped' };
				const models = await deps.discover(provider);
				if (!models.length) throw new Error('Empty catalogue');
				const published = await deps.store.publish(provider, claim, models);
				return published ? { provider, status: 'synced', count: models.length } : { provider, status: 'skipped' };
			} catch {
				if (claim) await deps.store.fail(provider, claim).catch(() => {});
				return { provider, status: 'failed' };
			}
		})().finally(() => pending.delete(provider));
		pending.set(provider, run);
		return run;
	};
	return {
		syncProvider,
		syncAll: (reason: ModelSyncReason = 'scheduled') => Promise.all(AI_MODEL_PROVIDER_IDS.map((provider) => syncProvider(provider, reason))),
		recover: async (provider: AiModelProviderId, error: unknown) => (isModelUnavailableError(error) ? syncProvider(provider, 'unavailable') : null)
	};
}

const key = (provider: AiModelProviderId) => `Thingtime.AiModelSync.${provider}`;
export const createMongoModelSyncStore = (
	dependencies = {
		getThings: getHomeThingsCollection,
		getSettings: getSettingsCollection,
		transaction: withHomeMongoTransaction
	}
): ModelSyncStore => ({
	async claim(provider, reason) {
		const settings = await dependencies.getSettings();
		const startedAt = new Date();
		const token = randomUUID();
		// Unique settings.key is already indexed. Concurrent cold starts share it.
		try {
			await settings.updateOne(
				{ key: key(provider) },
				{ $setOnInsert: { key: key(provider), leaseUntil: new Date(0), nextAttemptAt: new Date(0), nextSyncAt: new Date(0) } },
				{ upsert: true }
			);
		} catch (error: any) {
			if (error?.code !== 11000) throw error;
		}
		const claimed = await settings.updateOne(
			{
				key: key(provider),
				leaseUntil: { $lte: startedAt },
				nextAttemptAt: { $lte: startedAt },
				...(reason === 'scheduled' ? { nextSyncAt: { $lte: startedAt } } : {})
			},
			{ $set: { token, startedAt, leaseUntil: new Date(+startedAt + LEASE), nextAttemptAt: new Date(+startedAt + COOLDOWN) } }
		);
		return claimed.modifiedCount ? { token, startedAt } : null;
	},
	async publish(provider, claim, models) {
		const things = await dependencies.getThings();
		const settings = await dependencies.getSettings();
		return dependencies.transaction(async (session) => {
			// The lease document is written INSIDE the transaction: an expired
			// worker cannot commit over a newer claim. All model rows become visible
			// together, including removals. Failure preserves the previous snapshot.
			const committed = await settings.updateOne(
				{ key: key(provider), token: claim.token, leaseUntil: { $gt: new Date() } },
				{
					$set: {
						lastSyncedAt: claim.startedAt,
						status: 'synced',
						count: models.length,
						leaseUntil: new Date(0),
						nextSyncAt: new Date(+claim.startedAt + DAILY_INTERVAL)
					}
				},
				{ session }
			);
			if (!committed.matchedCount) return false;
			const policy = await settings.findOne({ key: key(provider) }, { session });
			const ids = models.map((model) => model.id);
			// Seed known rows inside the same snapshot so a later catalog ensure
			// cannot resurrect a retired model after a first-run cron.
			const rows = [
				...models,
				...AI_MODEL_CATALOG.filter((entry) => entry.provider === provider && !ids.includes(entry.modelId)).map((entry) => ({
					id: entry.modelId,
					label: entry.label
				}))
			];
			const inserts = rows.map((model) => {
				const candidate = getAiModelCatalogEntry(model.id);
				const entry = candidate?.provider === provider ? candidate : null;
				const curated = AI_MODEL_CATALOG.some((entry) => entry.modelId === model.id && entry.provider === provider);
				// Non-chat models are still recorded, but never advertised as supported.
				const crystal = entry
					? { ...entry, label: curated ? entry.label : model.label, efforts: [...entry.efforts], speeds: [...entry.speeds] }
					: {
							modelId: model.id,
							label: model.label,
							provider,
							efforts: [],
							speeds: ['normal'],
							family: provider === 'anthropic' ? 'claude' : 'gpt',
							sortOrder: 10000,
							contextWindow: null
					  };
				return {
					updateOne: {
						filter: { shareId: aiModelShareId(model.id) },
						update: {
							$setOnInsert: {
								shareId: aiModelShareId(model.id),
								schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
								thingtime: [AI_MODEL_THINGTIME],
								ownerId: 'system',
								storageClass: 'control',
								acl: [ACL_ALL],
								crystal: { ...crystal, enabled: Boolean(entry && (curated || policy?.autoAllowNewModels === true)) },
								extended: null,
								targetId: null,
								tags: [],
								uniqueKeys: [thingUniqueKey(AI_MODEL_UNIQUE_KEY_FIELD, model.id)],
								createdAt: claim.startedAt,
								updatedAt: claim.startedAt
							}
						},
						upsert: true
					}
				};
			});
			await things.bulkWrite(inserts, { session });
			const available = models.map((model) => ({
				updateOne: {
					filter: {
						...thingUniqueKeyFilter(AI_MODEL_UNIQUE_KEY_FIELD, model.id),
						ownerId: 'system',
						thingtime: AI_MODEL_THINGTIME,
						'crystal.provider': provider
					},
					update: {
						$set: { 'crystal.providerAvailable': true, 'crystal.lastSyncedAt': claim.startedAt, updatedAt: claim.startedAt }
					}
				}
			}));
			const written = await things.bulkWrite(available, { session });
			if (written.matchedCount !== models.length) throw new Error('Foreign model identity collision');
			await things.updateMany(
				{ ownerId: 'system', thingtime: AI_MODEL_THINGTIME, 'crystal.provider': provider, 'crystal.modelId': { $nin: ids } },
				{
					$set: { 'crystal.providerAvailable': false, 'crystal.lastSyncedAt': claim.startedAt, updatedAt: claim.startedAt }
				},
				{ session }
			);
			return true;
		});
	},
	async fail(provider, claim) {
		await (
			await dependencies.getSettings()
		).updateOne({ key: key(provider), token: claim.token }, { $set: { status: 'failed', lastAttemptAt: claim.startedAt, leaseUntil: new Date(0) } });
	}
});
const store = createMongoModelSyncStore();
const service = createAiModelSync({
	store,
	discover: discoverConfiguredProviderModels,
	configured: (provider) => aiProviderStatusFromEnv(process.env)[provider].configured
});
export const syncAiProviderModels = service.syncAll;
export const refreshUnavailableAiModel = service.recover;

export async function readAiModelProviderPolicies() {
	const rows = await (
		await getSettingsCollection()
	)
		.find(
			{ key: { $in: AI_MODEL_PROVIDER_IDS.map(key) } },
			{
				projection: { key: 1, autoAllowNewModels: 1, lastSyncedAt: 1, status: 1 }
			}
		)
		.toArray();
	return Object.fromEntries(
		AI_MODEL_PROVIDER_IDS.map((provider) => {
			const row = rows.find((row: any) => row.key === key(provider));
			return [
				provider,
				{
					autoAllowNewModels: row?.autoAllowNewModels === true,
					lastSyncedAt: row?.lastSyncedAt instanceof Date ? row.lastSyncedAt.toISOString() : null,
					status: ['synced', 'failed'].includes(row?.status) ? row.status : null
				}
			];
		})
	);
}

export async function setAiModelProviderPolicy(provider: AiModelProviderId, policy: { allowAll?: boolean; autoAllowNewModels?: boolean }) {
	const settings = await getSettingsCollection();
	const things = await getHomeThingsCollection();
	await withHomeMongoTransaction(async (session) => {
		// Also writes the sync lease's document so concurrent publication retries
		// against the latest admission policy. Neither action overwrites the other.
		await settings.updateOne(
			{ key: key(provider) },
			{
				$set: { updatedAt: new Date(), ...(policy.autoAllowNewModels !== undefined ? { autoAllowNewModels: policy.autoAllowNewModels } : {}) },
				$setOnInsert: { key: key(provider), leaseUntil: new Date(0), nextAttemptAt: new Date(0), nextSyncAt: new Date(0) }
			},
			{ upsert: true, session }
		);
		if (policy.allowAll !== undefined) {
			const rows = await things
				.find({ ownerId: 'system', thingtime: AI_MODEL_THINGTIME, 'crystal.provider': provider }, { projection: { 'crystal.modelId': 1 }, session })
				.toArray();
			const ids = rows.map((row: any) => row.crystal?.modelId).filter((id: any) => getAiModelCatalogEntry(id)?.provider === provider);
			await things.updateMany(
				{ ownerId: 'system', thingtime: AI_MODEL_THINGTIME, 'crystal.provider': provider, 'crystal.modelId': { $in: ids } },
				{
					$set: { 'crystal.enabled': policy.allowAll, updatedAt: new Date() }
				},
				{ session }
			);
		}
	});
}
