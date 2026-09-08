import { thingUniqueKey } from './uniqueKeys';

export const pollVoteIdentity = (pollId: string, ownerId: string) => {
	const key = `${pollId}~${ownerId}`;
	const uniqueKey = thingUniqueKey('voteKey', key);
	return { key, uniqueKey, filter: { thingtime: 'vote', ownerId, targetId: pollId, uniqueKeys: uniqueKey } };
};

// Copy only genuine poll-vote slots, never a free-form crystal that happens
// to contain voteKey. Duplicate or malformed legacy votes fail closed; this
// migration never deletes a vote or guesses which duplicate should survive.
export const backfillPollVoteKeys = async (raw: any) => {
	const cursor = raw.find({ thingtime: 'vote' }, {
		projection: { _id: 1, thingtime: 1, ownerId: 1, targetId: 1, 'crystal.voteKey': 1 }
	}).batchSize(500);
	let operations: any[] = [];
	const flush = async () => {
		if (operations.length) await raw.bulkWrite(operations, { ordered: true });
		operations = [];
	};
	for await (const doc of cursor) {
		if (!(Array.isArray(doc.thingtime) ? doc.thingtime.includes('vote') : doc.thingtime === 'vote')) continue;
		if (typeof doc.ownerId !== 'string' || !doc.ownerId || typeof doc.targetId !== 'string' || !doc.targetId)
			throw new Error('A legacy poll vote has an invalid identity. Repair it before retiring its index.');
		const identity = pollVoteIdentity(doc.targetId, doc.ownerId);
		if (doc.crystal?.voteKey !== identity.key)
			throw new Error('A legacy poll vote has an invalid identity. Repair it before retiring its index.');
		operations.push({ updateOne: {
			filter: { _id: doc._id, thingtime: 'vote', ownerId: doc.ownerId, targetId: doc.targetId, 'crystal.voteKey': identity.key },
			update: { $addToSet: { uniqueKeys: identity.uniqueKey } }
		} });
		if (operations.length === 500) await flush();
	}
	await flush();
};

export const migratePollVoteIndex = async (raw: any, drop: (name: string) => Promise<unknown>, retire = true) => {
	// A functioning replacement constraint is required before backfill/drop.
	await raw.createIndex({ uniqueKeys: 1 }, { unique: true, sparse: true });
	await backfillPollVoteKeys(raw);
	if (retire) {
		await drop('things_vote_key_lookup');
		await drop('things_vote_key_unique');
	}
};
