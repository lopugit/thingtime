import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { MAX_INHERIT_CHAIN, resolveInheritChain } from './aclChainCore.ts';

type Doc = { shareId: string; targetId?: string | null; inherit: boolean };

// Build a lookup + walker over an in-memory doc set (mirrors things by shareId).
const makeWorld = (docs: Doc[]) => {
  const byId = new Map(docs.map((d) => [d.shareId, d]));
  return {
    doc: (shareId: string) => byId.get(shareId)!,
    resolve: (shareId: string) =>
      resolveInheritChain(byId.get(shareId)!, (d) => d.inherit, async (id) => byId.get(id) ?? null)
  };
};

// A root post with a linear reply chain of `depth` inheriting comments under it.
const chainWorld = (depth: number) => {
  const docs: Doc[] = [{ shareId: 'root', targetId: null, inherit: false }];
  for (let level = 1; level <= depth; level++) {
    docs.push({ shareId: `c${level}`, targetId: level === 1 ? 'root' : `c${level - 1}`, inherit: true });
  }
  return makeWorld(docs);
};

test('a non-inheriting doc resolves to itself', async () => {
  const world = chainWorld(0);
  assert.equal(await world.resolve('root'), world.doc('root'));
});

test('deep comment chains resolve to the root post (regression: 5-deep replies 404ed on react/permalink)', async () => {
  const world = chainWorld(12);
  // every level of the chain resolves, not just the first four
  for (let level = 1; level <= 12; level++) {
    assert.equal(await world.resolve(`c${level}`), world.doc('root'), `chain depth ${level} must resolve`);
  }
});

test('chains resolve right up to the pathology ceiling, and fail closed past it', async () => {
  const world = chainWorld(MAX_INHERIT_CHAIN);
  assert.equal(await world.resolve(`c${MAX_INHERIT_CHAIN}`), world.doc('root'));
  const past = chainWorld(MAX_INHERIT_CHAIN + 1);
  assert.equal(await past.resolve(`c${MAX_INHERIT_CHAIN + 1}`), null);
});

test('a missing or deleted target fails closed', async () => {
  const world = makeWorld([{ shareId: 'orphan', targetId: 'deleted-parent', inherit: true }]);
  assert.equal(await world.resolve('orphan'), null);
});

test('an inheriting doc with no target fails closed', async () => {
  const world = makeWorld([{ shareId: 'dangling', targetId: null, inherit: true }]);
  assert.equal(await world.resolve('dangling'), null);
});

test('cycles fail closed instead of looping', async () => {
  const world = makeWorld([
    { shareId: 'a', targetId: 'b', inherit: true },
    { shareId: 'b', targetId: 'c', inherit: true },
    { shareId: 'c', targetId: 'a', inherit: true }
  ]);
  assert.equal(await world.resolve('a'), null);
  const self = makeWorld([{ shareId: 'me', targetId: 'me', inherit: true }]);
  assert.equal(await self.resolve('me'), null);
});
