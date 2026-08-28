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
