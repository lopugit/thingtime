import assert from 'node:assert/strict';
import test from 'node:test';

import { patVisibilityBlocksAcl, patVisibilityMatchClause, patVisibilityOf, viewerOf } from './things.ts';

// The token visibility fence (Settings → Token minter: public-only /
// private-only personal access tokens) is decided by ONE expression,
// patVisibilityBlocksAcl, consulted from canView (before the owner
// short-circuit), createThing, updateThing and deleteThing. Everything else is
// plumbing. patScopes.test.ts pins the pure mint-time guards; this pins the
// acl-level truth table those guards feed, so the two halves of the fence are
// both covered by `npm run test:unit` rather than only by the live
// scripts/verify-pat-tokens.mjs run.

const user = { id: 'owner-1', username: 'owner' };
const fenced = (visibility: 'all' | 'public' | 'private') => viewerOf(user, { jti: 'tok-1', visibility });

// Each fixture is a stored thing shape plus the acl `aclOf` resolves it to,
// covering both doc eras (v2 acl arrays and v1 visibility enums).
type Fixture = { name: string; doc: { acl?: string[]; visibility?: string }; acl: string[]; isPublic: boolean };

const FIXTURES: Fixture[] = [
  { name: 'v2 public', doc: { acl: ['tt:all'] }, acl: ['tt:all'], isPublic: true },
  { name: 'v1 public (visibility only)', doc: { visibility: 'public' }, acl: ['tt:all'], isPublic: true },
  { name: 'v2 owner-only', doc: { acl: ['tt:user'] }, acl: ['tt:user'], isPublic: false },
  { name: 'v1 private', doc: { visibility: 'private' }, acl: ['tt:user'], isPublic: false },
  // the sharp one: the friends circle acl CONTAINS the string 'tt:all', as the
  // negated entry '-tt:all'. A substring/prefix test here would read a
  // friends-only thing as public and hand it to a public-only token.
  { name: 'v2 friends circle', doc: { acl: ['-tt:all', 'tt:userFriends', 'tt:user'] }, acl: ['-tt:all', 'tt:userFriends', 'tt:user'], isPublic: false },
  { name: 'v1 friends', doc: { visibility: 'friends' }, acl: ['-tt:all', 'tt:userFriends', 'tt:user'], isPublic: false },
  { name: 'specific-user grant', doc: { acl: ['tt:user/bob'] }, acl: ['tt:user/bob'], isPublic: false }
];

const INHERIT: Fixture = { name: 'attached child', doc: { acl: ['tt:inherit'] }, acl: ['tt:inherit'], isPublic: false };

test('patVisibilityOf reads the fence off the viewer, and only the two restricting modes', () => {
  assert.equal(patVisibilityOf(fenced('public')), 'public');
  assert.equal(patVisibilityOf(fenced('private')), 'private');
  // 'all' is the unrestricted default, not a third fence
  assert.equal(patVisibilityOf(fenced('all')), null);
  // a full session and an unfenced token are both simply unrestricted
  assert.equal(patVisibilityOf(viewerOf(user)), null);
  assert.equal(patVisibilityOf(viewerOf(user, { jti: 'tok-1' })), null);
  assert.equal(patVisibilityOf(null), null);
});

test('viewerOf threads the fence onto the viewer and normalizes anything else to unrestricted', () => {
  assert.equal(viewerOf(user, { jti: 'tok-1', visibility: 'private' })?.pat?.visibility, 'private');
  // a token minted before the field (meta.visibility absent) is unrestricted —
  // mintPatToken rejects unknown values and patSessionVisibility normalizes on
  // read, so this last normalization is the third and final backstop
  assert.equal(viewerOf(user, { jti: 'tok-1' })?.pat?.visibility, 'all');
  assert.equal(viewerOf(user, { jti: 'tok-1', visibility: 'sideways' as any })?.pat?.visibility, 'all');
  // no pat at all: no fence field to misread
  assert.equal(viewerOf(user)?.pat, undefined);
});

test('an unrestricted viewer is never blocked by the fence', () => {
  for (const { name, acl } of [...FIXTURES, INHERIT]) {
    assert.equal(patVisibilityBlocksAcl(viewerOf(user), acl), false, `session / ${name}`);
    assert.equal(patVisibilityBlocksAcl(fenced('all'), acl), false, `all / ${name}`);
    assert.equal(patVisibilityBlocksAcl(null, acl), false, `anonymous / ${name}`);
  }
});

test('a public-only token passes exactly the world-visible acls', () => {
  for (const { name, acl, isPublic } of FIXTURES) {
    assert.equal(patVisibilityBlocksAcl(fenced('public'), acl), !isPublic, name);
  }
});

test('a private-only token is the exact mirror', () => {
  for (const { name, acl, isPublic } of FIXTURES) {
    assert.equal(patVisibilityBlocksAcl(fenced('private'), acl), isPublic, name);
  }
  // the two fences partition the space: no acl is allowed by both, none by neither
  for (const { name, acl } of FIXTURES) {
    const blocked = [fenced('public'), fenced('private')].filter((viewer) => patVisibilityBlocksAcl(viewer, acl));
    assert.equal(blocked.length, 1, `${name} must be inside exactly one fence`);
  }
});

test('an unresolved tt:inherit acl fails CLOSED for both fences', () => {
  // the audience of an attached thing lives on its target chain, so a direct
  // hit here means the caller skipped the inherit-aware path
  // (canViewInherited / patVisibilityBlocksDoc). Blocking is the safe answer:
  // createThing and updateThing skip this check for inherit acls precisely
  // because their target was already judged.
  assert.equal(patVisibilityBlocksAcl(fenced('public'), INHERIT.acl), true);
  assert.equal(patVisibilityBlocksAcl(fenced('private'), INHERIT.acl), true);
});

test('the DB fence clause is null for unrestricted viewers and pinned for the two fences', () => {
  assert.equal(patVisibilityMatchClause(viewerOf(user)), null);
  assert.equal(patVisibilityMatchClause(fenced('all')), null);
  assert.deepEqual(patVisibilityMatchClause(fenced('public')), {
    $or: [{ $or: [{ acl: 'tt:all' }, { visibility: 'public' }] }, { acl: 'tt:inherit' }]
  });
  assert.deepEqual(patVisibilityMatchClause(fenced('private')), {
    $nor: [{ $or: [{ acl: 'tt:all' }, { visibility: 'public' }] }]
  });
});

// Minimal evaluator for the two clause shapes above — enough to check the
// coarse/exact contract without a Mongo round trip. It understands only $or,
// $nor and equality on `acl` (a multikey array: equality means "contains") and
// `visibility` (a scalar).
const matches = (clause: any, doc: { acl?: readonly string[]; visibility?: string }): boolean => {
  if (Array.isArray(clause.$or)) return clause.$or.some((entry: any) => matches(entry, doc));
  if (Array.isArray(clause.$nor)) return !clause.$nor.some((entry: any) => matches(entry, doc));
  if (typeof clause.acl === 'string') return (doc.acl || []).includes(clause.acl);
  if (typeof clause.visibility === 'string') return doc.visibility === clause.visibility;
  throw new Error(`unsupported clause: ${JSON.stringify(clause)}`);
};

test('the coarse DB clause is a superset of what the exact check admits', () => {
  // listThings / listUserPosts / getFeed / searchThings conjoin the clause and
  // then re-judge each fetched doc. If the clause ever stops covering what the
  // exact tier admits, pages lose rows silently — no error, just missing data.
  for (const mode of ['public', 'private'] as const) {
    const clause = patVisibilityMatchClause(fenced(mode));
    for (const { name, doc, acl } of FIXTURES) {
      if (patVisibilityBlocksAcl(fenced(mode), acl)) continue;
      assert.equal(matches(clause, doc), true, `${mode} clause must fetch ${name}`);
    }
    // inherit-acl children are judged on their terminal in memory, so the
    // clause MUST fetch them under both fences even though the exact check
    // above fails them closed
    assert.equal(matches(clause, INHERIT.doc), true, `${mode} clause must fetch an inherit-acl child`);
  }
});

test('the coarse DB clause excludes the out-of-audience half', () => {
  // the clause is a superset, not the gate — but it must still do its job,
  // which is why listUserPosts can derive postCount from the fenced match
  for (const mode of ['public', 'private'] as const) {
    const clause = patVisibilityMatchClause(fenced(mode));
    for (const { name, doc, acl } of FIXTURES) {
      if (!patVisibilityBlocksAcl(fenced(mode), acl)) continue;
      assert.equal(matches(clause, doc), false, `${mode} clause must not count ${name}`);
    }
  }
});
