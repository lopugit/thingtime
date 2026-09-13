import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { createMemoryThingsCollection } from '../lopu/accountingMemory.testutil';
let things: any;
let failLedger = false;
const session = { transaction: true };
const transaction = async (work: any) => {
	const before = things.docs.map((doc: any) => ({
		...doc,
		crystal: { ...doc.crystal },
		uniqueKeys: doc.uniqueKeys ? [...doc.uniqueKeys] : undefined
	}));
	try {
		return await work(session);
	} catch (error) {
		things.docs.splice(0, things.docs.length, ...before);
		throw error;
	}
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
	namedExports: { getHomeThingsCollection: async () => things, withHomeMongoTransaction: transaction }
});
mock.module(new URL('../settings/lopuAccess.ts', import.meta.url).href, {
	namedExports: { getStoredLopuAccessSettings: async () => ({ starterCredits: 5, lowBalanceWarningCredits: 1 }) }
});
mock.module(new URL('./inviteAvatar.ts', import.meta.url).href, { namedExports: { normalizeInviteAvatar: async () => null } });
const { createInvite, closeInvite, previewInvite, prepareInviteSignup, expireInvites, listInvites } = await import('./invites');
const { ensureLopuAccount, getLopuAccount } = await import('../lopu/accounting');
beforeEach(() => {
	things = createMemoryThingsCollection();
	failLedger = false;
	things.countDocuments = async (filter: any) => (await things.find(filter).toArray()).length;
	const find = things.find;
	things.find = (filter: any) => {
		const cursor = find(filter);
		cursor.project = () => cursor;
		return cursor;
	};
	const insert = things.insertOne;
	things.insertOne = async (doc: any, options: any) => {
		if (doc.shareId.startsWith('invite-credit-') && failLedger) throw new Error('ledger unavailable');
		if (doc.shareId.startsWith('invite-credit-') || doc.thingtime.includes('account-invite')) assert.equal(options?.session, session);
		return insert(doc);
	};
});
const balance = async (id = 'creator') => (await getLopuAccount(id))?.crystal.balanceMicros;
const make = (credits = 2) => createInvite('creator', { username: 'friend', displayName: 'Friend', credits });
test('creating, previewing and cancelling conserve credits and do not expose raw token state', async () => {
	const invite = await make();
	assert.equal(await balance(), 3_000_000);
	const shown = await previewInvite(invite.token);
	assert.equal(shown.username, 'friend');
	assert.equal(shown.credits, 2);
	assert.equal(JSON.stringify(things.docs).includes(invite.token), false);
	await closeInvite(invite.id, 'other-user');
	assert.equal(await balance(), 3_000_000);
	await closeInvite(invite.id, 'creator');
	await closeInvite(invite.id, 'creator');
	assert.equal(await balance(), 5_000_000);
	await assert.rejects(() => previewInvite(invite.token));
	assert.equal(things.ofKind('account-invite')[0].secure, undefined);
});
test('insufficient funds, in-flight turns and failed ledger writes leave no reservation', async () => {
	await ensureLopuAccount('creator');
	await assert.rejects(() => make(6));
	assert.equal(await balance(), 5_000_000);
	await things.updateOne({ ownerId: 'creator', thingtime: 'lopu-account' }, { $set: { 'crystal.inflight': 1 } });
	await assert.rejects(() => make(1));
	await things.updateOne({ ownerId: 'creator', thingtime: 'lopu-account' }, { $set: { 'crystal.inflight': 0 } });
	failLedger = true;
	await assert.rejects(() => make(1));
	assert.equal(await balance(), 5_000_000);
	assert.equal(things.ofKind('account-invite').length, 0);
});
test('claim uses the signup transaction, gifts exactly once, and does not mint starter credits', async () => {
	const invite = await make(2.25);
	const prepared = await prepareInviteSignup(invite.token, { username: 'my-own-name', displayName: 'My name' });
	assert.equal(prepared.username, 'my-own-name');
	await transaction((session: any) => prepared.onCreated({ _id: 'recipient' }, session));
	assert.equal(await balance('recipient'), 2_250_000);
	assert.equal(await balance(), 2_750_000);
	assert.equal((await getLopuAccount('recipient'))!.crystal.starterMicros, 0);
	await assert.rejects(() => transaction((session: any) => prepared.onCreated({ _id: 'second-recipient' }, session)));
	assert.equal(await getLopuAccount('second-recipient'), null);
	await closeInvite(invite.id, 'creator');
	assert.equal(await balance(), 2_750_000);
});
test('a failed claim rolls back invite consumption and recipient balance', async () => {
	const invite = await make();
	const prepared = await prepareInviteSignup(invite.token, {});
	failLedger = true;
	await assert.rejects(() => transaction((session: any) => prepared.onCreated({ _id: 'recipient' }, session)));
	assert.equal((await previewInvite(invite.token)).status, 'pending');
	assert.equal(await getLopuAccount('recipient'), null);
});
test('expiry returns held credits once and prevents signup', async () => {
	const invite = await make();
	await things.updateOne({ shareId: invite.id }, { $set: { expiresAt: new Date(0) } });
	await expireInvites();
	await expireInvites();
	assert.equal(await balance(), 5_000_000);
	await assert.rejects(() => prepareInviteSignup(invite.token, {}));
});
test('the pending cap also covers free invites and cancellation opens a slot', async () => {
	let first: any;
	for (let n = 0; n < 20; n++) {
		const invite = await make(0);
		first ??= invite;
	}
	await assert.rejects(() => make(0));
	assert.equal(things.ofKind('account-invite').length, 20);
	await closeInvite(first.id, 'creator');
	await make(0);
	assert.equal(await balance(), 5_000_000);
});

test('old open reservations remain manageable after newer closed invitations fill history', async () => {
	const open = await make(1);
	for (let i = 0; i < 51; i++) {
		const closed = await make(0);
		await closeInvite(closed.id, 'creator');
	}
	const history = await listInvites('creator');
	assert.equal(history[0].id, open.id);
	assert.equal(history[0].avatarUrl, undefined);
	assert.equal(history.length, 31);
	assert.equal(
		history.some((row) => 'token' in row || 'ownerId' in row),
		false
	);
});
