import { isDeepStrictEqual } from 'node:util';
import { getHomeThingsCollection, getSettingsCollection, thingsIndexPlanEntries } from './collections';
import { isCustomMongoEndpointActive } from './endpoint';
import { COLLECTION_SCHEMA_VERSIONS, EMBEDDED_THINGTIME } from '../../../schemas/registry';
import { activateIndexLayout } from './indexLayoutActivation';

export const LEGACY_THING_LAYOUT_KEY = 'Thingtime.IndexLayout.LegacyThings.v1';
export const LEGACY_THING_INDEX_NAMES = [
  'things_v1_kind_visibility_created', 'things_v1_kind_owner_created',
  'things_v1_kind_owner_updated', 'things_v1_kind_created',
  'things_v1_kind_parent_created', 'parentId_1_ownerId_1_token_1',
  'commentId_1', 'shareOfId_1'
] as const;
let cached: { promise: Promise<boolean>; expires: number } | null = null;
export const invalidateLegacyThingLayout = () => { cached = null; };
export const homeLegacyThingLayoutReady = async () => {
  if (!cached || cached.expires <= Date.now()) {
    const promise = (async () => (await (await getSettingsCollection()).findOne({ key: LEGACY_THING_LAYOUT_KEY }, { projection: { ready: 1 } }))?.ready === true)()
      .catch(error => { cached = null; throw error; });
    cached = { promise, expires: Date.now() + 30_000 };
  }
  return cached.promise;
};
export const legacyThingReadsRequired = async () => isCustomMongoEndpointActive() || !await homeLegacyThingLayoutReady();

export const runLegacyThingIndexLayout = async (things: any, settings: any, { dryRun, assertLease }: { dryRun: boolean; assertLease?: () => Promise<void> }) => {
  const indexes = await things.indexes();
  const existing = indexes.filter((index: any) => (LEGACY_THING_INDEX_NAMES as readonly string[]).includes(index.name));
  // The current embed writer dual-stamps during rollout. These rows already
  // have the canonical schema and need only an unbillable metadata cleanup.
  // Every other legacy shape remains a hard migration prerequisite.
  const dualEmbed = { kind: 'embed', thingtime: { $eq: EMBEDDED_THINGTIME, $size: 1 }, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things };
  const residue = await things.countDocuments({ $or: [{ kind: { $exists: true }, $nor: [dualEmbed] }, { shareOfId: { $exists: true } }] });
  const dualEmbeds = await things.countDocuments(dualEmbed);
  const ready = (await settings.findOne({ key: LEGACY_THING_LAYOUT_KEY }, { projection: { ready: 1 } }))?.ready === true;
  if (dryRun) return { dryRun, matched: residue + dualEmbeds + existing.length + (ready ? 0 : 1), migrated: 0, created: 0, skipped: 0, notes: [`${residue} legacy-shape document(s) must be converted before retirement; ${dualEmbeds} canonical embed(s) need only kind metadata cleanup. Deploy compatible readers and embed writers on every shared-database origin first.`] };
  if (!assertLease) throw new Error('Legacy Thing index migration requires an active lease.');
  await assertLease();
  if (residue) throw new Error('Legacy Thing rows remain. Convert them through the canonical Thing/storage migrations before retiring their indexes. No documents or indexes were removed.');
  const expected = await thingsIndexPlanEntries({ legacyLookups: true });
  for (const index of existing) {
    const spec = expected.find(entry => entry.name === index.name)!;
    if (!spec || !isDeepStrictEqual(index.key, spec.keys) ||
      !isDeepStrictEqual(index.partialFilterExpression, spec.options.partialFilterExpression) ||
      !!index.unique !== !!spec.options.unique || !!index.sparse !== !!spec.options.sparse ||
      index.hidden || index.collation || index.expireAfterSeconds !== undefined) {
      throw new Error(`Unexpected legacy index definition: ${index.name}; preserved for operator review.`);
    }
  }
  await assertLease();
  // Prove the current embed listing has its replacement before activation.
  await things.createIndex({ thingtime: 1, ownerId: 1, updatedAt: -1, shareId: 1 });
  const activation = await activateIndexLayout(settings, LEGACY_THING_LAYOUT_KEY, assertLease);
  invalidateLegacyThingLayout();
  if (!activation.retirementReady) return { dryRun, matched: dualEmbeds + existing.length + (ready ? 0 : 1), migrated: 0, created: 0, skipped: 0, notes: [`Canonical home reads activated; metadata and old indexes preserved while caches drain. Run again in at least ${Math.ceil(activation.remainingMs / 1000)} seconds to complete retirement.`] };
  await assertLease();
  const cleaned = await things.updateMany(dualEmbed, { $unset: { kind: '' } });
  let retired = 0;
  for (const index of existing) {
    await assertLease();
    try { await things.dropIndex(index.name); retired++; }
    catch (error: any) { if (error?.code !== 27 && error?.code !== 26) throw error; }
  }
  return { dryRun, matched: dualEmbeds + existing.length + (ready ? 0 : 1), migrated: retired + cleaned.modifiedCount, created: 0, skipped: 0, notes: ['Legacy reads disabled on home; custom data planes retain compatibility. No Thing documents were deleted. Re-check after the 30-second cache window for in-flight dual-stamped embeds.'] };
};

export const migrateLegacyThingIndexLayout = async (options: { dryRun: boolean; assertLease?: () => Promise<void> }) =>
  runLegacyThingIndexLayout(await getHomeThingsCollection(), await getSettingsCollection(), options);
