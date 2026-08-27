import { isBillableStorageThing } from '../storage/storageCore.ts';

// Exact optimistic delete guard for legacy collection conversion. Matching the
// whole BSON preimage (inside $literal, so user keys are never interpreted as
// operators) catches field additions/removals as well as value changes and
// remains safe for historical rows which never had an updatedAt token.
export const exactDocumentSnapshotMatch = (doc: Record<string, unknown>): Record<string, unknown> => ({
	_id: doc._id,
	$expr: { $eq: ['$$ROOT', { $literal: doc }] }
});

export const builtinSchemaSeedNeedsRefresh = (
	twin: { crystal?: unknown; storageClass?: unknown } | null | undefined,
	expectedCrystal: unknown
): boolean =>
	!twin || twin.storageClass !== 'control' || JSON.stringify(twin.crystal ?? {}) !== JSON.stringify(expectedCrystal);

export const storageMigrationOwnership = (
	doc: Parameters<typeof isBillableStorageThing>[0],
	knownUsers: ReadonlySet<string>
): 'excluded' | 'known-user' | 'unknown-user' => {
	if (!isBillableStorageThing(doc)) return 'excluded';
	return knownUsers.has(String(doc.ownerId)) ? 'known-user' : 'unknown-user';
};
