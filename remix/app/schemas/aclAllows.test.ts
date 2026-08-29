import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { aclAllows } from './registry.ts';

// aclAllows is the exact visibility authority — canView (api/utils/things/things.ts),
// recordPostViews (api/utils/things/views.ts) and attachment access
// (api/utils/attachments/attachmentAccess.ts) all bottom out here, and the DB
// clauses in visibilityQueryFor are only a superset prefilter in front of it.
// It had no unit coverage, so the most-specific-wins ordering that makes
// '-tt:user/<name>' beat a circle grant was resting entirely on review.
//
// These cases pin the rules claimed by TODO/claude-todo/17-circles.md, so the
// session that makes the family circle real has to keep them true.

const OWNER = 'ownerA';
const FRIEND = 'friendB';
const STRANGER = 'strangerC';

// friendIds is the viewer's ACCEPTED-friend set (friendIdsOf → withFriendIds).
// Friendship is mutual, so the viewer's own set answers for any owner.
const viewer = (id: string, username: string, friendIds: string[] = []) => ({
  id,
  username,
  friendIds: new Set(friendIds)
});

const FRIENDS_ONLY = ['-tt:all', 'tt:userFriends', 'tt:user'];

test('tt:all is public, including logged-out viewers', () => {
  assert.equal(aclAllows(['tt:all'], null, OWNER), true);
  assert.equal(aclAllows(['tt:all'], viewer(STRANGER, 'c'), OWNER), true);
});

test('friends-only resolves against the real friend graph', () => {
  assert.equal(aclAllows(FRIENDS_ONLY, viewer(OWNER, 'a'), OWNER), true, 'owner sees own thing');
  assert.equal(aclAllows(FRIENDS_ONLY, viewer(FRIEND, 'b', [OWNER]), OWNER), true, 'accepted friend sees it');
  assert.equal(aclAllows(FRIENDS_ONLY, viewer(STRANGER, 'c'), OWNER), false, 'stranger does not');
  assert.equal(aclAllows(FRIENDS_ONLY, null, OWNER), false, 'anon does not');
});

// A pending friend request must grant nothing — friendIdsOf only returns
// crystal.status === 'accepted' pairs, so an un-accepted request is an empty set.
test('a pending friend request grants no access', () => {
  assert.equal(aclAllows(FRIENDS_ONLY, viewer(FRIEND, 'b', []), OWNER), false);
});

// The security-critical ordering: specificity is
// tt:all(0) < circles(1) < tt:user(2) < tt:user/<name>(3).
test('a specific-user exclusion beats a circle grant', () => {
  const acl = [...FRIENDS_ONLY, '-tt:user/b'];
  assert.equal(aclAllows(acl, viewer(FRIEND, 'b', [OWNER]), OWNER), false, 'excluded friend loses access');
  assert.equal(aclAllows(acl, viewer('friendD', 'd', [OWNER]), OWNER), true, 'other friends are unaffected');
});

test('a narrower grant survives a broad -tt:all', () => {
  assert.equal(aclAllows(['-tt:all', 'tt:user/b'], viewer(FRIEND, 'b'), OWNER), true);
});

test('exclusions win ties at equal specificity', () => {
  assert.equal(aclAllows(['tt:user/b', '-tt:user/b'], viewer(FRIEND, 'b'), OWNER), false);
});

test('public-except-one-user', () => {
  const acl = ['tt:all', '-tt:user/b'];
  assert.equal(aclAllows(acl, viewer(FRIEND, 'b'), OWNER), false, 'the excluded user is out');
  assert.equal(aclAllows(acl, viewer(STRANGER, 'c'), OWNER), true, 'everyone else is in');
});

test('usernames match case-insensitively', () => {
  assert.equal(aclAllows(['-tt:all', 'tt:user/b'], viewer(FRIEND, 'B'), OWNER), true);
});

// Pinned CURRENT behaviour, not a desired end state: claude-todo/17 tracks
// making this circle real. A diff here is a REVIEW PROMPT — the session that
// adds the family graph should flip these deliberately, in the same change
// that adds Viewer.familyIds and the visibilityQueryFor clause.
test('tt:userFamily is still owner-only — no family graph exists yet', () => {
  const acl = ['-tt:all', 'tt:userFamily', 'tt:user'];
  assert.equal(aclAllows(acl, viewer(OWNER, 'a'), OWNER), true, 'owner sees own thing');
  assert.equal(aclAllows(acl, viewer(FRIEND, 'b', [OWNER]), OWNER), false, 'not even an accepted friend');
});

// tt:app/<clientId> is the audience among ONE embedded app's users, resolved
// only on app-token read paths — it must never admit a Thingtime-site viewer.
test('tt:app/<clientId> never matches a site viewer', () => {
  assert.equal(aclAllows(['-tt:all', 'tt:app/xyz'], viewer(FRIEND, 'b', [OWNER]), OWNER), false);
});

// tt:inherit is resolved by the chain walker (resolveInheritChain) before this
// evaluator runs, so it is skipped here rather than granting anything.
test('tt:inherit grants nothing on its own', () => {
  assert.equal(aclAllows(['tt:inherit'], viewer(FRIEND, 'b', [OWNER]), OWNER), false);
});

test('an empty acl denies everyone but leaves the owner to the caller', () => {
  assert.equal(aclAllows([], viewer(OWNER, 'a'), OWNER), false, 'callers short-circuit owners before asking');
  assert.equal(aclAllows([], viewer(STRANGER, 'c'), OWNER), false);
});
