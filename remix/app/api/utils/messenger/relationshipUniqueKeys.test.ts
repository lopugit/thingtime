import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { RELATIONSHIP_UNIQUE_CRYSTAL_KEYS, relationshipUniqueKeys, newThingDoc, dmKeyOf, followKey } from './shared.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { fromBin } from '../auth/users.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { RESERVED_CRYSTAL_ROOT_KEYS } from '~/schemas/registry';

// Relationship dedupe rides the server-only root uniqueKeys namespace (the
// sparse unique multikey index that already holds username/email/schema/
// waitlist slots). These tests pin the stamp contract: every mapped kind
// stamps `<crystalField>:<key>` as BinData, unmapped kinds and null keys stay
// unstamped, and the namespace prefixes can never collide with the existing
// system key families.

test('the relationship map covers exactly the six retired unique-index families', () => {
	assert.deepEqual(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS, {
		follow: 'followKey',
		'chat-member': 'memberKey',
		'community-member': 'memberKey',
		chat: 'dmKey',
		'community-invite': 'inviteCode',
		'custom-emoji': 'emojiKey',
		friend: 'friendKey'
	});
});

test('stamps are `<field>:<key>` BinData and round-trip', () => {
	const key = followKey('follower-1', 'followee-2');
	const stamped = relationshipUniqueKeys('follow', { followKey: key });
	assert.ok(stamped && stamped.length === 1);
	assert.equal(fromBin(stamped![0]), `followKey:${key}`);
});

test('every mapped kind stamps through newThingDoc automatically', () => {
	const samples: Record<string, Record<string, unknown>> = {
		follow: { followKey: 'a:b' },
		'chat-member': { memberKey: 'chat-1:user-1' },
		'community-member': { memberKey: 'community-1:user-1' },
		chat: { chatType: 'dm', dmKey: dmKeyOf('b', 'a') },
		'community-invite': { inviteCode: 'tt-abc123' },
		'custom-emoji': { name: 'blob', emojiKey: 'scope:blob' },
		friend: { status: 'pending', friendKey: 'a~b' }
	};
	for (const [kind, crystal] of Object.entries(samples)) {
		const doc = newThingDoc(kind, { ownerId: 'user-1', crystal }) as any;
		const field = RELATIONSHIP_UNIQUE_CRYSTAL_KEYS[kind];
		assert.ok(Array.isArray(doc.uniqueKeys) && doc.uniqueKeys.length === 1, `${kind} must stamp uniqueKeys`);
		assert.equal(fromBin(doc.uniqueKeys[0]), `${field}:${crystal[field]}`);
	}
});

test('group/channel chats (dmKey null) and unmapped kinds stay unstamped', () => {
	const group = newThingDoc('chat', { ownerId: 'u', crystal: { chatType: 'group', dmKey: null } }) as any;
	assert.equal(group.uniqueKeys, undefined);
	const message = newThingDoc('message', { ownerId: 'u', crystal: { text: 'hi' } }) as any;
	assert.equal(message.uniqueKeys, undefined);
	assert.equal(relationshipUniqueKeys('follow', { followKey: 42 }), undefined);
	assert.equal(relationshipUniqueKeys('follow', { followKey: '' }), undefined);
	assert.equal(relationshipUniqueKeys('follow', null), undefined);
});

test('relationship prefixes are disjoint from the other uniqueKeys families', () => {
	// username:/email:/schema:/waitlist-email: are the existing system
	// namespaces riding the same index — a colliding prefix could let a
	// relationship stamp block a user signup slot (or vice versa).
	const reservedPrefixes = ['username', 'email', 'schema', 'waitlist-email'];
	for (const field of Object.values(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS)) {
		assert.ok(!reservedPrefixes.includes(field), `relationship prefix '${field}' collides with a system key family`);
	}
});

test('every mapped crystal field is reserved at the data-crystal root during the transition', () => {
	// Until every deployment DB has swapped its old kind-blind unique indexes
	// to lookups (boot-time ensure), the sanitizer reservation is what stops
	// squats — a mapped field missing from RESERVED_CRYSTAL_ROOT_KEYS would
	// reopen the window on not-yet-swapped DBs.
	for (const field of Object.values(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS)) {
		assert.ok(RESERVED_CRYSTAL_ROOT_KEYS.has(field), `'${field}' must stay in RESERVED_CRYSTAL_ROOT_KEYS until the swap completes everywhere`);
	}
});
