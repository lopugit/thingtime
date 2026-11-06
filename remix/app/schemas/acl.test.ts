import assert from 'node:assert/strict';
import test from 'node:test';

import { aclAllows, aclCapabilityFor, sanitizeAcl, visibilityFromAcl } from './registry.ts';

// The acl grammar itself — who may VIEW (aclAllows, most-specific-wins) and,
// on tt:custom things, HOW MUCH they may do (aclCapabilityFor: write ⊃ comment
// ⊃ read). The live PAT/audience suites in remix/scripts/verify-*.mjs need a
// running stack and a database; these run in the unit job, so a regression in
// the grammar fails fast instead of only in a manual QA pass.

const OWNER = 'owner-id';
const owner = { id: OWNER, username: 'owner' };
const bob = { id: 'bob-id', username: 'bob' };
const carol = { id: 'carol-id', username: 'carol' };
const anon = null;

const entries = (value: ReturnType<typeof sanitizeAcl>): string[] => {
	assert.equal(Array.isArray(value), true, `expected entries, got ${JSON.stringify(value)}`);
	return value as string[];
};

const rejected = (value: ReturnType<typeof sanitizeAcl>): { status: number; error: string } => {
	assert.equal(Array.isArray(value), false, `expected a rejection, got ${JSON.stringify(value)}`);
	return value as { ok: false; status: number; error: string };
};

test('aclAllows: public, private, and most-specific-wins exclusions', () => {
	assert.equal(aclAllows(['tt:all'], anon, OWNER), true);
	assert.equal(aclAllows(['tt:user'], anon, OWNER), false);
	assert.equal(aclAllows(['tt:user'], bob, OWNER), false);
	assert.equal(aclAllows(['tt:user'], owner, OWNER), true);
	// public except one user — the tt:user/ entry is more specific than tt:all
	assert.equal(aclAllows(['tt:all', '-tt:user/bob'], bob, OWNER), false);
	assert.equal(aclAllows(['tt:all', '-tt:user/bob'], carol, OWNER), true);
	// a named grant beats a broad exclusion
	assert.equal(aclAllows(['-tt:all', 'tt:user/bob', 'tt:user'], bob, OWNER), true);
	assert.equal(aclAllows(['-tt:all', 'tt:user/bob', 'tt:user'], carol, OWNER), false);
});

test('aclAllows: friends and group circles need their preloaded sets', () => {
	const friend = { ...bob, friendIds: new Set([OWNER]) };
	assert.equal(aclAllows(['-tt:all', 'tt:userFriends', 'tt:user'], friend, OWNER), true);
	// no preloaded friend set = the circle denies rather than guesses
	assert.equal(aclAllows(['-tt:all', 'tt:userFriends', 'tt:user'], bob, OWNER), false);

	const member = { ...carol, groupIds: new Set(['group-1']) };
	assert.equal(aclAllows(['tt:custom', 'tt:user', 'tt:group/group-1'], member, OWNER), true);
	assert.equal(aclAllows(['tt:custom', 'tt:user', 'tt:group/group-2'], member, OWNER), false);
	assert.equal(aclAllows(['tt:custom', 'tt:user', 'tt:group/group-1'], carol, OWNER), false);
});

test('tt:custom and tt:hidden match nobody on their own', () => {
	assert.equal(aclAllows(['tt:custom', 'tt:user'], bob, OWNER), false);
	assert.equal(aclAllows(['tt:hidden', 'tt:user'], bob, OWNER), false);
	// …and the owner short-circuit is the caller's job, but tt:user still holds
	assert.equal(aclAllows(['tt:hidden', 'tt:user'], owner, OWNER), true);
});

test('visibilityFromAcl: custom outranks the baseline it carries', () => {
	assert.equal(visibilityFromAcl(['tt:custom', 'tt:all', 'tt:user']), 'custom');
	assert.equal(visibilityFromAcl(['tt:custom', 'tt:hidden', 'tt:user']), 'custom');
	assert.equal(visibilityFromAcl(['tt:hidden', 'tt:user']), 'hidden');
	assert.equal(visibilityFromAcl(['tt:all']), 'public');
	assert.equal(visibilityFromAcl(['tt:user']), 'private');
	assert.equal(visibilityFromAcl(['tt:inherit']), 'inherit');
});

test('aclCapabilityFor: owner writes, general viewers only read', () => {
	const acl = ['tt:custom', 'tt:all', 'tt:user', 'tt:user/bob/comment', 'tt:user/carol/write'];
	assert.equal(aclCapabilityFor(acl, owner, OWNER), 'write');
	// a public baseline grants READ to everyone, never engagement
	assert.equal(aclCapabilityFor(acl, { id: 'stranger-id', username: 'stranger' }, OWNER), 'read');
	assert.equal(aclCapabilityFor(acl, anon, OWNER), 'read');
	assert.equal(aclCapabilityFor(acl, bob, OWNER), 'comment');
	assert.equal(aclCapabilityFor(acl, carol, OWNER), 'write');
});

test('aclCapabilityFor: no baseline means picks only, and group suffixes carry', () => {
	const acl = ['tt:custom', 'tt:user', 'tt:user/bob', 'tt:group/group-1/comment'];
	assert.equal(aclCapabilityFor(acl, { id: 'stranger-id', username: 'stranger' }, OWNER), 'none');
	assert.equal(aclCapabilityFor(acl, bob, OWNER), 'read');
	assert.equal(aclCapabilityFor(acl, { ...carol, groupIds: new Set(['group-1']) }, OWNER), 'comment');
	// membership in a different group grants nothing
	assert.equal(aclCapabilityFor(acl, { ...carol, groupIds: new Set(['group-2']) }, OWNER), 'none');
});

test('aclCapabilityFor: exclusions shape view, never capability', () => {
	const acl = ['tt:custom', 'tt:all', 'tt:user', '-tt:user/bob/write'];
	// the '-' entry excludes bob from viewing; it must never hand him write
	assert.equal(aclAllows(acl, bob, OWNER), false);
	assert.equal(aclCapabilityFor(acl, bob, OWNER), 'none');
});

test('aclCapabilityFor: a grant the acl also excludes from VIEW confers nothing', () => {
	// The dangerous shape is a POSITIVE grant sitting beside a plain exclusion
	// of the same subject: most-specific-wins denies the view (exclusions win
	// ties), so the capability must fall with it. Reading the grant on its own
	// would hand out edit rights on a thing the same acl says the person may
	// not even read. Callers all prove view first, so this is the function's
	// own floor rather than a live hole — pin it so it stays one.
	const userAcl = ['tt:custom', 'tt:all', 'tt:user', 'tt:user/bob/write', '-tt:user/bob'];
	assert.equal(aclAllows(userAcl, bob, OWNER), false);
	assert.equal(aclCapabilityFor(userAcl, bob, OWNER), 'none');

	// …and the same for a group grant shadowed by a group exclusion
	const member = { ...carol, groupIds: new Set(['group-1']) };
	const groupAcl = ['tt:custom', 'tt:all', 'tt:user', 'tt:group/group-1/write', '-tt:group/group-1'];
	assert.equal(aclAllows(groupAcl, member, OWNER), false);
	assert.equal(aclCapabilityFor(groupAcl, member, OWNER), 'none');

	// a bystander the exclusion doesn't name still reads via the tt:all baseline
	assert.equal(aclCapabilityFor(userAcl, { id: 'stranger-id', username: 'stranger' }, OWNER), 'read');
});

test('sanitizeAcl: capability suffixes are accepted, deeper paths are refused', () => {
	assert.deepEqual(entries(sanitizeAcl(['tt:custom', 'tt:user', 'tt:user/bob/write', 'tt:group/g1/comment'])), [
		'tt:custom',
		'tt:user',
		'tt:user/bob/write',
		'tt:group/g1/comment'
	]);
	assert.deepEqual(entries(sanitizeAcl(['tt:all', '-tt:user/bob'])), ['tt:all', '-tt:user/bob']);

	// "tt:user/a/b" could mean "user a with capability b" or "user a/b, read" —
	// refuse it instead of guessing, in both the grant and exclusion forms
	assert.equal(rejected(sanitizeAcl(['tt:user/a/b'])).status, 400);
	assert.equal(rejected(sanitizeAcl(['-tt:user/a/b'])).status, 400);
	assert.equal(rejected(sanitizeAcl(['tt:user/a/b/write'])).status, 400);
	assert.equal(rejected(sanitizeAcl(['tt:group/g1/g2'])).status, 400);
	// an empty subject is not a grant either
	assert.equal(rejected(sanitizeAcl(['tt:user//write'])).status, 400);
	// tt:user (owner) and tt:userFriends are not tt:user/ grants
	assert.deepEqual(entries(sanitizeAcl(['tt:user', 'tt:userFriends'])), ['tt:user', 'tt:userFriends']);
});

test('sanitizeAcl: usernames are canonicalized to lower case, group ids are not', () => {
	// aclEntryMatches compares usernames case-insensitively, but the feed/search
	// grant clause (things.ts visibilityQueryFor) matches acl strings EXACTLY
	// against a lower-cased tt:user/<username>. An un-normalized 'tt:user/Bob'
	// is therefore honoured by canView yet invisible in Bob's own feed — the
	// grant half-works. Canonicalizing here keeps both paths on one spelling.
	assert.deepEqual(entries(sanitizeAcl(['tt:custom', 'tt:user', 'tt:user/Bob/write'])), [
		'tt:custom',
		'tt:user',
		'tt:user/bob/write'
	]);
	assert.deepEqual(entries(sanitizeAcl(['tt:all', '-tt:user/BOB'])), ['tt:all', '-tt:user/bob']);
	// the fold is what the feed clause builds, so the two now agree
	const stored = entries(sanitizeAcl(['tt:custom', 'tt:user', 'tt:user/Bob/write']));
	const feedEntries = ['tt:user/bob', 'tt:user/bob/comment', 'tt:user/bob/write'];
	assert.equal(
		stored.some((entry) => feedEntries.includes(entry)),
		true
	);
	assert.equal(aclAllows(stored, bob, OWNER), true);
	assert.equal(aclCapabilityFor(stored, bob, OWNER), 'write');
	// case folding collapses what are otherwise duplicate grants
	assert.deepEqual(entries(sanitizeAcl(['tt:user/bob', 'tt:user/BOB'])), ['tt:user/bob']);
	// group ids are opaque and compared exactly (viewer.groupIds.has) — folding
	// one would break a real membership match, so their case is preserved
	assert.deepEqual(entries(sanitizeAcl(['tt:custom', 'tt:group/G1/comment'])), ['tt:custom', 'tt:group/G1/comment']);
	const member = { ...carol, groupIds: new Set(['G1']) };
	assert.equal(aclAllows(entries(sanitizeAcl(['tt:custom', 'tt:user', 'tt:group/G1'])), member, OWNER), true);
});

test('a capability word is still a usable username', () => {
	// "write" and "comment" are ordinary, registerable usernames (only '/' and
	// the env-admin allowlist are reserved), and the picker composes
	// tt:user/<username> verbatim. Reading the '/write' tail as a capability
	// whenever it appears would leave base 'tt:user' — the OWNER entry — so the
	// picked account would silently get nothing while the acl grew a phantom
	// owner grant. A capability suffix only counts over a non-empty subject.
	for (const name of ['write', 'comment']) {
		const picked = { id: `${name}-id`, username: name };
		const acl = entries(sanitizeAcl(['tt:custom', 'tt:user', `tt:user/${name}`]));
		assert.deepEqual(acl, ['tt:custom', 'tt:user', `tt:user/${name}`]);
		assert.equal(aclAllows(acl, picked, OWNER), true, `${name} should be able to view`);
		assert.equal(aclCapabilityFor(acl, picked, OWNER), 'read');
		// …and they must not pick up the owner's rights either
		assert.equal(aclAllows(acl, { id: 'someone-else', username: 'someone-else' }, OWNER), false);
		// the same name WITH a real capability suffix still parses as one
		const upgraded = entries(sanitizeAcl(['tt:custom', 'tt:user', `tt:user/${name}/write`]));
		assert.equal(aclCapabilityFor(upgraded, picked, OWNER), 'write');
	}
	// a group whose id is a capability word behaves the same way
	const member = { ...bob, groupIds: new Set(['write']) };
	const groupAcl = ['tt:custom', 'tt:user', 'tt:group/write'];
	assert.equal(aclAllows(groupAcl, member, OWNER), true);
	assert.equal(aclCapabilityFor(groupAcl, member, OWNER), 'read');
});

test('sanitizeAcl: shape, dedup, and the entry cap still hold', () => {
	assert.equal(rejected(sanitizeAcl('tt:all')).status, 400);
	assert.equal(rejected(sanitizeAcl([])).status, 400);
	assert.equal(rejected(sanitizeAcl(['not-a-tt-entry'])).status, 400);
	assert.deepEqual(entries(sanitizeAcl(['tt:all', 'tt:all'])), ['tt:all']);
	const tooMany = Array.from({ length: 65 }, (_, index) => `tt:user/person${index}`);
	assert.match(rejected(sanitizeAcl(tooMany)).error, /at most 64 entries/);
});
