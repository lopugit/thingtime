import { repairRelationshipKeys } from '../migrations/relationshipKeys';

export const SHARED_RELATIONSHIP_KINDS = ['friend', 'follow', 'chat-member', 'community-member', 'chat', 'community-invite'] as const;
export const SHARED_RELATIONSHIP_LOOKUPS = {
	things_friend_key_lookup: 'crystal.friendKey',
	things_follow_key_lookup: 'crystal.followKey',
	things_member_key_lookup: 'crystal.memberKey',
	things_dm_key_lookup: 'crystal.dmKey',
	things_invite_code_lookup: 'crystal.inviteCode'
} as const;

export const RELATIONSHIP_LAYOUT_KEY = 'Thingtime.IndexLayout.Relationships.v1';
export const relationshipIndexLayoutReady = async (settings: any): Promise<boolean> =>
	(await settings.findOne({ key: RELATIONSHIP_LAYOUT_KEY }, { projection: { ready: 1 } }))?.ready === true;

// Only the explicit leased migration scans data. Cold requests do one indexed
// control-plane lookup, never a backfill or DDL operation.
export const prepareRelationshipIndexLayout = async (things: any, assertLease?: () => Promise<void>) => {
	await assertLease?.();
	await things.createIndex({ uniqueKeys: 1 }, { unique: true, sparse: true });
	const options = { kinds: SHARED_RELATIONSHIP_KINDS, assertLease };
	const repaired = await repairRelationshipKeys(things, { ...options, dryRun: false });
	const pending = await repairRelationshipKeys(things, { ...options, dryRun: true });
	if (repaired.skipped || pending.matched) {
		throw new Error('Relationship keys need repair before shared-index reads can activate. Run backfill-relationship-unique-keys.');
	}
	return repaired;
};

// Home only; callers must await preparation first. Validate exact names AND
// keys, and never drop a unique ancestor, unknown index, or custom DB index.
export const retireRelationshipLookupIndexes = async (things: any, assertLease?: () => Promise<void>) => {
	const indexes = await things.indexes();
	for (const [name, field] of Object.entries(SHARED_RELATIONSHIP_LOOKUPS)) {
		const index = indexes.find((candidate: any) => candidate.name === name);
		if (!index) continue;
		const partial = index.partialFilterExpression;
		const condition = partial?.[field];
		const expectedOperator = name === 'things_friend_key_lookup' ? '$exists' : '$type';
		const expectedValue = expectedOperator === '$exists' ? true : 'string';
		if (index.unique || index.sparse || index.hidden || index.collation || index.expireAfterSeconds !== undefined ||
			Object.keys(index.key || {}).length !== 1 || index.key[field] !== 1 ||
			Object.keys(partial || {}).length !== 1 || Object.keys(condition || {}).length !== 1 || condition[expectedOperator] !== expectedValue) {
			throw new Error(`Unexpected relationship index definition: ${name}; preserved for operator review.`);
		}
		await assertLease?.();
		try { await things.dropIndex(name); }
		catch (error: any) { if (error?.code !== 27 && error?.code !== 26) throw error; }
	}
};

export const migrateRelationshipIndexLayout = async (things: any, settings: any, { dryRun, assertLease }: { dryRun: boolean; assertLease?: () => Promise<void> }) => {
	if (dryRun) {
		const repair = await repairRelationshipKeys(things, { dryRun: true, kinds: SHARED_RELATIONSHIP_KINDS, assertLease });
		const oldIndexes = (await things.indexes()).filter((index: any) => Object.prototype.hasOwnProperty.call(SHARED_RELATIONSHIP_LOOKUPS, index.name)).length;
		const ready = await relationshipIndexLayoutReady(settings);
		return { ...repair, matched: repair.matched + oldIndexes + (ready ? 0 : 1), notes: ['Deploy compatible readers and key-stamping writers on every origin sharing this database before retirement.'] };
	}
	if (!assertLease) throw new Error('Relationship index migration requires an active lease.');
	const repaired = await prepareRelationshipIndexLayout(things, assertLease);
	await assertLease();
	// Activate only after complete validation. A crash after this write leaves
	// redundant old indexes, not missed relationships. Retrying safely removes them.
	await settings.updateOne({ key: RELATIONSHIP_LAYOUT_KEY }, { $set: { ready: true, updatedAt: new Date() }, $setOnInsert: { key: RELATIONSHIP_LAYOUT_KEY } }, { upsert: true });
	await retireRelationshipLookupIndexes(things, assertLease);
	return { ...repaired, notes: ['Shared relationship reads activated; five legacy lookup indexes retired. Older workers may take 30 seconds to refresh readiness.'] };
};
