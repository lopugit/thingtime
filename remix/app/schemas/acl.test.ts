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

test('sanitizeAcl: shape, dedup, and the entry cap still hold', () => {
	assert.equal(rejected(sanitizeAcl('tt:all')).status, 400);
	assert.equal(rejected(sanitizeAcl([])).status, 400);
	assert.equal(rejected(sanitizeAcl(['not-a-tt-entry'])).status, 400);
	assert.deepEqual(entries(sanitizeAcl(['tt:all', 'tt:all'])), ['tt:all']);
	const tooMany = Array.from({ length: 65 }, (_, index) => `tt:user/person${index}`);
	assert.match(rejected(sanitizeAcl(tooMany)).error, /at most 64 entries/);
});
