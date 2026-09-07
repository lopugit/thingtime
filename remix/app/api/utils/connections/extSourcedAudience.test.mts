import assert from 'node:assert/strict';
import { mock, test, after } from 'node:test';

// The `tt:extsourced` audience is resolved LAZILY: things.ts memoises, per
// viewer object, whether that viewer sources each external post it is asked
// about. This exercises that memo through the real `canViewInherited`, with
// both collections mocked (the unlinkRetirement.test.mts precedent), so it
// runs with no Mongo.
//
// Regression: the memo used to record "already asked" BEFORE the membership
// query it stood for came back. getThing checks a whole comment chain with one
// Promise.all, and every entry in that chain inherits its acl from the same
// external post — but the entries sit at different inherit depths, so their
// chain walks finish at different times. The shallow entry could claim the
// memo and still be awaiting Mongo when a deeper one arrived, and that second
// caller went on to evaluate the acl with the answer not yet loaded. An
// unloaded set denies (deliberately, like friendIds), so a viewer's own
// comment thread on a personal external post intermittently lost its
// parent/root — timing-dependent, and invisible to a live end-to-end check.
//
// The sweep below walks the stagger between the two chain walks across the
// whole window in which the membership query is outstanding, so it pins the
// ordering rather than happening to catch it.

type Doc = Record<string, any>;

const tick = async (n: number) => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

const POST = 'ext-post-abc';
const ACCOUNT = 'ext-account-1';

// How many microtasks each mocked query takes, and how many it was asked for.
let linksQueryTicks = 0;
let membershipQueryTicks = 0;
let linkQueries = 0;
let membershipQueries = 0;
// the viewer's connections links — empty means "sources nothing"
let viewerLinks: Doc[] = [];

const home = {
  find(_query: Doc, _options?: Doc) {
    linkQueries += 1;
    return {
      toArray: async () => {
        await tick(linksQueryTicks);
        return viewerLinks;
      }
    };
  }
};

const things = {
  async findOne(query: Doc, _options?: Doc) {
    membershipQueries += 1;
    await tick(membershipQueryTicks);
    const accountIds: string[] = query?.parentId?.$in || [];
    return query?.targetId === POST && accountIds.includes(ACCOUNT) ? { _id: 'source-row' } : null;
  }
};

mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    getThingsCollection: async () => things,
    getHomeThingsCollection: async () => home
  }
});

const { canViewInherited } = await import('../things/things.ts');

after(() => mock.restoreAll());

const post: Doc = {
  shareId: POST,
  schemaVersion: 2,
  thingtime: ['external-post'],
  ownerId: 'system',
  acl: ['tt:extsourced'],
  targetId: null
};

const comment: Doc = {
  shareId: 'comment-1',
  schemaVersion: 2,
  thingtime: ['post', 'comment'],
  // someone ELSE's comment, so only the inherited audience can admit it
  ownerId: 'another-user',
  acl: ['tt:inherit'],
  targetId: POST
};

// One shared lookup, as getThing passes down — delayed so the comment's chain
// walk lands a controllable number of microtasks after the post's own check.
const lookupAfter = (ticks: number) => async (shareId: string) => {
  await tick(ticks);
  return shareId === POST ? post : null;
};

test('a linked viewer sees every chain entry converging on one external post, at any stagger', async () => {
  viewerLinks = [{ crystal: { accountId: ACCOUNT } }];
  linksQueryTicks = 4;
  membershipQueryTicks = 8;

  // Sweep the whole window first and report the ordering as a set: a single
  // failing stagger is the defect, but WHICH staggers fail is what says
  // "resolved before the answer landed" rather than "flaky".
  const hidden: number[] = [];
  const duplicated: { stagger: number; links: number; membership: number }[] = [];
  for (let stagger = 0; stagger <= 24; stagger += 1) {
    // one viewer object per request, exactly as the read paths thread it
    const viewer = { id: 'viewer-1', username: 'viewer' };
    linkQueries = 0;
    membershipQueries = 0;

    // getThing checks the post and the comment beneath it concurrently
    const [postVisible, commentVisible] = await Promise.all([
      canViewInherited(post as any, viewer as any, lookupAfter(0) as any),
      canViewInherited(comment as any, viewer as any, lookupAfter(stagger) as any)
    ]);

    if (!postVisible || !commentVisible) hidden.push(stagger);
    // the memo exists to make these queries once per request, not once per doc
    if (linkQueries !== 1 || membershipQueries !== 1) {
      duplicated.push({ stagger, links: linkQueries, membership: membershipQueries });
    }
  }
  assert.deepEqual(hidden, [], `every chain entry must stay visible; hidden at staggers ${JSON.stringify(hidden)}`);
  assert.deepEqual(duplicated, [], `the memo must collapse the queries; duplicated at ${JSON.stringify(duplicated)}`);
});

test('a viewer who sources nothing is denied, and the denial is memoised too', async () => {
  viewerLinks = [];
  linksQueryTicks = 2;
  membershipQueryTicks = 2;
  const viewer = { id: 'viewer-2', username: 'stranger' };
  linkQueries = 0;
  membershipQueries = 0;

  const [postVisible, commentVisible] = await Promise.all([
    canViewInherited(post as any, viewer as any, lookupAfter(0) as any),
    canViewInherited(comment as any, viewer as any, lookupAfter(3) as any)
  ]);

  assert.equal(postVisible, false);
  assert.equal(commentVisible, false);
  assert.equal(linkQueries, 1);
  // no links at all: the membership probe is skipped entirely
  assert.equal(membershipQueries, 0);
});

test('a viewer linked to some OTHER account is denied this post', async () => {
  viewerLinks = [{ crystal: { accountId: 'ext-account-someone-else' } }];
  linksQueryTicks = 1;
  membershipQueryTicks = 1;
  const viewer = { id: 'viewer-3', username: 'other' };

  assert.equal(await canViewInherited(post as any, viewer as any, lookupAfter(0) as any), false);
  assert.equal(await canViewInherited(comment as any, viewer as any, lookupAfter(0) as any), false);
});
