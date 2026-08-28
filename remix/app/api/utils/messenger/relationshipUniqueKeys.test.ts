import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { RELATIONSHIP_UNIQUE_CRYSTAL_KEYS, relationshipUniqueKeys, newThingDoc, dmKeyOf, followKey } from './shared.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { fromBin } from '../auth/users.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { thingUniqueKey } from '../mongodb/uniqueKeys.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { validateThingtimeCrystal } from '~/schemas/registry';

// Relationship dedupe rides the server-only root uniqueKeys namespace (the
// sparse unique multikey index that already holds username/email/schema/
// waitlist slots). These tests pin the stamp contract: every mapped kind
// stamps `<crystalField>:<key>` as BinData, unmapped kinds and null keys stay
// unstamped, and the namespace prefixes can never collide with the existing
// system key families. `vote` is included even though its product surface is
// not part of this release: a preview deployment already created the legacy
// kind-blind index in the shared develop database, so phase 1 must retire and
// backfill that family before phase 2 reopens the crystal namespace.

test('the relationship map covers exactly the retired unique-index families', () => {
	assert.deepEqual(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS, {
		follow: 'followKey',
		'chat-member': 'memberKey',
		'community-member': 'memberKey',
		chat: 'dmKey',
		'community-invite': 'inviteCode',
		'custom-emoji': 'emojiKey',
		friend: 'friendKey',
		vote: 'voteKey',
		// joined late: shipped with its own kind-blind crystal.linkKey unique
		// index (PR #323, authored while this migration was in flight)
		'passkey-app-link': 'linkKey'
	});
});

test('passkey app links stamp through the shared helper (auth writer builds its own doc)', () => {
	const stamped = relationshipUniqueKeys('passkey-app-link', { linkKey: 'passkey-1:origin:https://thingtime.com' });
	assert.ok(stamped && stamped.length === 1);
	assert.equal(fromBin(stamped![0]), 'linkKey:passkey-1:origin:https://thingtime.com');
	// no key → no stamp, so a malformed link can never claim the empty slot
	assert.equal(relationshipUniqueKeys('passkey-app-link', { linkKey: '' }), undefined);
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
		friend: { status: 'pending', friendKey: 'a~b' },
		vote: { optionIndex: 0, voteKey: 'poll-1~user-1' }
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

test('callers can add domain Binary keys without losing relationship stamps', () => {
	const externalKey = thingUniqueKey('externalConversationKey', 'hash-1');
	const importedDm = newThingDoc('chat', {
		ownerId: 'u',
		crystal: { chatType: 'dm', dmKey: 'a:b' },
		uniqueKeys: [externalKey]
	}) as any;
	assert.deepEqual(importedDm.uniqueKeys.map(fromBin), ['dmKey:a:b', 'externalConversationKey:hash-1']);
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

test('the data-crystal namespace is fully open — relationship names are ordinary user data', () => {
	// With dedupe on root uniqueKeys and the crystal-path indexes non-unique,
	// a data thing carrying any relationship field name at its crystal root
	// enters no unique index: it can neither squat a real relationship nor be
	// rejected. This pins the un-reservation (phase 2) — no name in the open
	// namespace is special.
	for (const field of Object.values(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS)) {
		const result = validateThingtimeCrystal(['data'], { [field]: 'any:value' });
		assert.equal(result.ok, true, `crystal.${field} must save as ordinary data`);
	}
	const voteResult = validateThingtimeCrystal(['data'], { voteKey: 'poll:user' });
	assert.equal(voteResult.ok, true, 'voteKey (poll branch) must be ordinary data too');
});
