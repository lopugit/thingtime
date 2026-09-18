import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Exercise the real API utility with deterministic storage/auth boundaries.
// No test writes to MongoDB or changes account verification settings.
const chat: any = {
	shareId: 'lopu-chat-test',
	ownerId: 'owner',
	thingtime: ['chat'],
	crystal: { name: 'Keep this transcript', externalSource: { access: 'lopu', provider: 'lopu' }, lopu: { turns: 4 } }
};
let writes = 0;
let active = true;
mock.module('../mongodb/collections', { namedExports: { getThingsCollection: async () => ({}), withHomeMongoTransaction: async () => {} } });
mock.module('../messenger/messenger', {
	namedExports: {
		resolveChatAccess: async (viewer: string) =>
			viewer !== 'owner' || !active
				? { ok: false, status: 403, error: 'Forbidden' }
				: { chat, member: { crystal: { role: 'owner', state: 'active' } } },
		chatListEntryFor: async () => ({ ok: true, chat: { id: chat.shareId, name: chat.crystal.name } }),
		chatPreviewOf: () => ({}),
		insertChatMember: async () => {},
		listChatsById: async () => [],
		projectMessages: async () => ({ messages: [] })
	}
});
mock.module('../messenger/storage', {
	namedExports: {
		updateMessengerThing: async (_collection: any, filter: any, update: any) => {
			assert.equal(filter.shareId, chat.shareId);
			assert.equal(filter.thingtime, 'chat');
			assert.deepEqual(Object.keys(update.$set).sort(), ['crystal.lopu.archived', 'updatedAt']);
			writes++;
			chat.crystal.lopu.archived = update.$set['crystal.lopu.archived'];
		},
		insertMessengerThing: async () => {
			throw new Error('Must not insert messages');
		},
		deleteMessengerThing: async () => {
			throw new Error('Must not delete chat');
		},
		deleteMessengerThings: async () => {
			throw new Error('Must not delete transcript');
		},
		withMessengerStorageTransaction: async () => {}
	}
});
const { updateLopuChat, getLopuChat } = await import('../messenger/lopuChats.ts');

test('archive and restore persist idempotently without changing messages, settings or membership', async () => {
	for (const archived of [true, true, false, false]) {
		const result = await updateLopuChat('owner', chat.shareId, { archived });
		assert.equal(result.ok, true);
		if (!result.ok) throw new Error(result.error);
		assert.equal(result.chat.lopu.archived === true, archived);
		const read = await getLopuChat('owner', chat.shareId);
		assert.equal(read.ok, true);
		if (read.ok) assert.equal(read.chat.lopu.archived === true, archived);
		assert.equal(chat.crystal.lopu.turns, 4);
		assert.equal(chat.crystal.name, 'Keep this transcript');
	}
	assert.equal(writes, 4);
});

test('invalid values, foreign accounts and inactive memberships never write', async () => {
	const before = writes;
	for (const archived of ['true', null, 1, {}]) {
		const result = await updateLopuChat('owner', chat.shareId, { archived });
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.status, 400);
	}
	assert.equal((await updateLopuChat('stranger', chat.shareId, { archived: true })).ok, false);
	active = false;
	assert.equal((await updateLopuChat('owner', chat.shareId, { archived: true })).ok, false);
	assert.equal(writes, before);
});
