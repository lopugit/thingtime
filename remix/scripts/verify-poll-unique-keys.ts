import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Disposable local replica set only. All data is created/read through the
// same API utilities as production; no direct collection access or fixtures.
assert.equal(process.env.TT_INDEX_TEST_ALLOW_LOCAL, '1');
assert.equal(process.env.MONGODB_CONNECTION_STRING, 'mongodb://127.0.0.1:27192/thingtime?replicaSet=ttindex');

const main = async () => {
	const { createUserAccount } = await import('../app/api/utils/auth/registerUser');
	const { createThing, deleteThing } = await import('../app/api/utils/things/things');
	const { voteOnThing } = await import('../app/api/utils/things/vote');
	const { runMongoQuery } = await import('../app/api/utils/mongodb/queryRunner');
	const { getSubscription } = await import('../app/api/utils/subscriptions/subscriptions');
	const { isBillableStorageThing } = await import('../app/api/utils/storage/storageCore');
	const ok = (result: any) => {
		assert.equal(result.ok, true, result.error);
		return result;
	};
	const prefix = `poll-${randomUUID().slice(0, 8)}`;
	const users: string[] = [];
	for (const role of ['owner', 'guest']) {
		const account = ok(
			await createUserAccount({
				username: `${prefix}-${role}`,
				password: 'disposable-poll-test-password',
				email: `${prefix}-${role}@example.invalid`,
				emailVerified: true,
				storageAllowanceBytes: 32 * 1024 * 1024
			})
		);
		users.push(String(account.user._id));
	}
	const [owner, guest] = users;
	const poll = ok(
		await createThing(
			owner,
			{ thingtime: ['data'], crystal: { question: 'Shared identity?', options: ['Yes', 'Absolutely'] }, acl: ['tt:all'] },
			{ id: owner }
		)
	).doc;
	const baseline = new Map(await Promise.all(users.map(async (id) => [id, (await getSubscription('user', id)).storage!.usedBytes!] as const)));
	const checkLedger = async (id: string) => {
		const rows = ok(
			await runMongoQuery({ collection: 'things', operation: 'find', filter: { thingtime: 'vote', targetId: poll.shareId, ownerId: id }, limit: 100 })
		).results;
		for (const row of rows) {
			assert.equal(isBillableStorageThing(row), false);
		}
		assert.equal(
			(await getSubscription('user', id)).storage!.usedBytes,
			baseline.get(id)!,
			'protected engagement votes must remain unbilled'
		);
	};
	const votes = () =>
		runMongoQuery({ collection: 'things', operation: 'countDocuments', filter: { thingtime: 'vote', targetId: poll.shareId, ownerId: owner } }).then(
			ok
		);
	const raced = await Promise.all(Array.from({ length: 16 }, () => voteOnThing(owner, poll.shareId, 0)));
	assert.ok(raced.some((result) => result.ok));
	// A concurrent toggle may remove the insert winner before a losing request
	// settles it. That request must explicitly ask for a retry, not claim success.
	for (const result of raced) if (result.ok === false) assert.equal(result.status, 409, result.error);
	const count = (await votes()).total;
	assert.ok(count <= 1, `one user produced ${count} vote Things during concurrent requests`);
	await checkLedger(owner);
	// A later ordinary request must see the same single authoritative vote.
	if (count === 1) ok(await voteOnThing(owner, poll.shareId, 0));
	assert.equal((await votes()).total, 0);
	await checkLedger(owner);
	assert.equal(ok(await voteOnThing(owner, poll.shareId, 0)).pollVotes.totalVotes, 1);
	const moved = ok(await voteOnThing(owner, poll.shareId, 1)).pollVotes;
	assert.deepEqual(moved.counts, [0, 1]);
	assert.equal(moved.totalVotes, 1);
	assert.equal(ok(await voteOnThing(guest, poll.shareId, 0)).pollVotes.totalVotes, 2);
	await checkLedger(owner);
	await checkLedger(guest);
	assert.equal(ok(await voteOnThing(owner, poll.shareId, 1)).pollVotes.totalVotes, 1);
	assert.equal((await votes()).total, 0);
	await checkLedger(owner);
	// Ordinary data with the same crystal key cannot reserve a protected slot.
	ok(await createThing(guest, { thingtime: ['data'], crystal: { voteKey: `${poll.shareId}~${owner}` } }, { id: guest }));
	assert.equal(ok(await voteOnThing(owner, poll.shareId, 0)).pollVotes.totalVotes, 2);
	await checkLedger(owner);
	const privatePoll = ok(
		await createThing(owner, { thingtime: ['data'], crystal: { question: 'Private?', options: ['Yes', 'No'] }, acl: ['tt:user'] }, { id: owner })
	).doc;
	assert.equal((await voteOnThing(guest, privatePoll.shareId, 0)).ok, false);
	assert.equal((await voteOnThing(owner, poll.shareId, 7)).ok, false);
	const limited = ok(
		await createUserAccount({
			username: `${prefix}-limited`,
			password: 'disposable-poll-test-password',
			email: `${prefix}-limited@example.invalid`,
			emailVerified: true,
			storageAllowanceBytes: 0
		})
	);
	const limitedId = String(limited.user._id);
	const limitedBefore = (await getSubscription('user', limitedId)).storage!.usedBytes;
	ok(await voteOnThing(limitedId, poll.shareId, 0));
	assert.equal((await getSubscription('user', limitedId)).storage!.usedBytes, limitedBefore);
	ok(await deleteThing(owner, poll.shareId));
	assert.equal(
		ok(await runMongoQuery({ collection: 'things', operation: 'countDocuments', filter: { thingtime: 'vote', targetId: poll.shareId } })).total,
		0
	);
	console.log(
		JSON.stringify({
			concurrentRequests: 16,
			explicitConcurrentRetries: raced.filter((result) => !result.ok).length,
			maximumVotesPerUser: count,
			unbilledVotesAndFullAccount: 'passed',
			crystalSquatIsolation: 'passed',
			moveToggleAndSecondVoter: 'passed',
			privatePollAndInvalidOption: 'passed',
			cascadeDelete: 'passed'
		})
	);
};

main().then(
	() => process.exit(0),
	(error) => {
		console.error(error);
		process.exit(1);
	}
);
