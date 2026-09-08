import { Binary } from 'mongodb';
import { RELATIONSHIP_UNIQUE_CRYSTAL_KEYS, relationshipUniqueKeys } from '../messenger/shared';

// One finite cursor per family, not a repeatedly queried page of failures.
// Only protected relationship kinds participate; ordinary data may use these
// crystal names without claiming a server-owned uniqueness slot.
export const repairRelationshipKeys = async (
	things: any,
	{ dryRun, assertLease }: { dryRun: boolean; assertLease?: () => Promise<void> }
) => {
	let matched = 0;
	let migrated = 0;
	let skipped = 0;
	let duplicates = 0;
	let changed = 0;
	for (const [kind, field] of Object.entries(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS)) {
		await assertLease?.();
		const cursor = things.find(
			{ thingtime: kind, [`crystal.${field}`]: { $type: 'string', $ne: '' } },
			{ projection: { _id: 1, [`crystal.${field}`]: 1, uniqueKeys: 1 } }
		).batchSize(500);
		try {
			for await (const doc of cursor) {
				const key = relationshipUniqueKeys(kind, doc.crystal)?.[0];
				if (!key) continue;
				if (Array.isArray(doc.uniqueKeys) && doc.uniqueKeys.some((existing: unknown) =>
					existing instanceof Binary && existing.sub_type === key.sub_type && Buffer.from(existing.value()).equals(Buffer.from(key.value())))) continue;
				matched += 1;
				if (dryRun) continue;
				await assertLease?.();
				try {
					const result = await things.updateOne(
						// Compare the source identity, not just _id: a concurrent
						// relationship edit must never receive its old identity key.
						{ _id: doc._id, thingtime: kind, [`crystal.${field}`]: doc.crystal[field], uniqueKeys: { $ne: key } },
						{ $addToSet: { uniqueKeys: key } }
					);
					migrated += result.modifiedCount;
					if (!result.matchedCount) { skipped += 1; changed += 1; }
				} catch (error: any) {
					if (error?.code !== 11000) throw error;
					// Never choose/delete a winner or disclose private identities.
					// The unresolved row stays pending for an operator to repair.
					skipped += 1;
					duplicates += 1;
				}
			}
		} finally {
			await cursor.close();
		}
	}
	return {
		dryRun, matched, migrated, created: 0, skipped,
		notes: [
			...(duplicates ? [`${duplicates} duplicate relationship slot(s) remain pending; no relationships were deleted.`] : []),
			...(changed ? [`${changed} relationship(s) changed concurrently or were repaired by another runner; re-check pending work.`] : [])
		]
	};
};
