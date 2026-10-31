type MigrationPendingStatus = {
  id: string;
  pending: number;
};

const LEGACY_COLLECTION_MIGRATION_ID = 'merge-legacy-collections';

// The storage-generations table remains the complete physical census. The
// adoption banner is reserved for actionable copy-forward work so a fully
// merged frozen snapshot does not look like a failed migration.
export const actionableAdoptionIssues = (
  adoptionIssues: readonly string[],
  migrations: readonly MigrationPendingStatus[]
): string[] => {
  if (!adoptionIssues.length) return [];
  const legacyMerge = migrations.find((migration) => migration.id === LEGACY_COLLECTION_MIGRATION_ID);
  return legacyMerge?.pending === 0 ? [] : [...adoptionIssues];
};

// "1.2 GB" / "596 KB" / "—" for an absent census; whole numbers above 100.
export const formatGenerationBytes = (bytes: number | undefined | null): string => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

// Index bytes far beyond the documents they serve is the signature of a
// collection whose rows were mass-deleted (freed pages stay in the index
// files) or over-indexed — the rebuild-things-indexes migration's trigger.
export const generationIndexRatio = (generation: { dataBytes?: number; indexBytes?: number }): number | null => {
  if (typeof generation.dataBytes !== 'number' || typeof generation.indexBytes !== 'number') return null;
  if (generation.dataBytes <= 0) return generation.indexBytes > 0 ? Infinity : null;
  return generation.indexBytes / generation.dataBytes;
};
