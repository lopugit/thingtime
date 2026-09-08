import assert from 'node:assert/strict';
import test from 'node:test';
import { fromBin } from '../auth/users';
import { backfillPollVoteKeys, migratePollVoteIndex, pollVoteIdentity } from './pollVoteIndex';

const vote = { _id: 'v', thingtime: ['vote'], ownerId: 'u', targetId: 'p', crystal: { voteKey: 'p~u' } };
const fixture = (docs: any[], failure?: Error) => {
	const events: string[] = [];
	const writes: any[] = [];
	const raw = {
		async createIndex(keys: any, options: any) {
			assert.deepEqual(keys, { uniqueKeys: 1 });
			assert.deepEqual(options, { unique: true, sparse: true });
			events.push('constraint');
		},
		find(filter: any) {
			assert.deepEqual(filter, { thingtime: 'vote' });
			return { batchSize: (size: number) => {
				assert.equal(size, 500);
				return { async *[Symbol.asyncIterator]() { yield* docs; } };
			} };
		},
		async bulkWrite(operations: any[], options: any) {
			assert.equal(options.ordered, true);
			events.push('backfill');
			if (failure) throw failure;
			writes.push(...operations);
		}
	};
	return { raw, events, writes, drop: async (name: string) => { events.push(`drop:${name}`); } };
};

test('poll identity uses a protected namespaced Binary point lookup with owner and target guards', () => {
	const identity = pollVoteIdentity('p', 'u');
	assert.equal(fromBin(identity.uniqueKey), 'voteKey:p~u');
	assert.deepEqual(Object.keys(identity.filter).sort(), ['ownerId', 'targetId', 'thingtime', 'uniqueKeys']);
	assert.equal(identity.filter.ownerId, 'u');
	assert.equal(identity.filter.targetId, 'p');
});

test('replacement constraint and legacy backfill precede retirement', async () => {
	const f = fixture([vote]);
	await migratePollVoteIndex(f.raw, f.drop);
	assert.deepEqual(f.events, ['constraint', 'backfill', 'drop:things_vote_key_lookup', 'drop:things_vote_key_unique']);
	assert.equal(fromBin(f.writes[0].updateOne.update.$addToSet.uniqueKeys), 'voteKey:p~u');
	assert.deepEqual(f.writes[0].updateOne.filter, { _id: 'v', thingtime: 'vote', ownerId: 'u', targetId: 'p', 'crystal.voteKey': 'p~u' });
});

test('malformed or duplicate legacy slots keep their old indexes and never delete data', async () => {
	for (const f of [fixture([{ ...vote, crystal: { voteKey: 'foreign~slot' } }]), fixture([vote], new Error('duplicate'))]) {
		await assert.rejects(migratePollVoteIndex(f.raw, f.drop));
		assert.ok(f.events.every(event => !event.startsWith('drop:')));
	}
});

test('foreign free-form crystals never acquire protected poll slots', async () => {
	const f = fixture([{ ...vote, thingtime: ['data'] }]);
	await backfillPollVoteKeys(f.raw);
	assert.equal(f.writes.length, 0);
});

test('custom databases retain their existing named indexes', async () => {
	const f = fixture([vote]);
	await migratePollVoteIndex(f.raw, f.drop, false);
	assert.deepEqual(f.events, ['constraint', 'backfill']);
});

test('legacy backfill uses bounded batches', async () => {
	const f = fixture(Array.from({ length: 1001 }, (_, i) => ({ ...vote, _id: i })));
	await backfillPollVoteKeys(f.raw);
	assert.equal(f.events.length, 3);
	assert.equal(f.writes.length, 1001);
});
