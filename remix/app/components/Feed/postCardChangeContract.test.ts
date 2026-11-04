import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// TODO #12 made PostCard's `onChanged` prop `(id, next)` so PostList and
// SearchPage can hand the SAME handler identity to every card. The per-card
// closure they used to build is what defeated PostCard's React.memo and
// repainted the whole column on every engagement event.
//
// Both halves of that fix are invisible to the rest of the suite, and one is
// invisible to tsc too:
//
//   * tsc enforces the arity but not WHICH id a call addresses — an
//     `onChanged?.(comment.id, …)` from post scope compiles fine, and every
//     consumer then matches no post and silently drops the update.
//   * nothing at all catches a consumer going back to an inline closure; the
//     memo just quietly stops bailing again.
//
// Nine call sites landed on the wrong shape while this change was being built
// (six inside PostCard, three route consumers), each shipping green because the
// typecheck ratchet is advisory. So pin the contract here instead of leaving it
// to review.

const feedDir = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(resolve(feedDir, ...segments), 'utf8');

const postCard = read('PostCard.tsx');

// The `,` in each call regex below only matches a call that HAS a second
// argument, so a call site that reverts to the old one-argument shape is
// invisible to `calls` — it just quietly stops being counted. tsc does flag
// that one (TS2554), but the typecheck ratchet is deliberately non-blocking, so
// it annotates and still goes green: exactly how the six one-argument calls
// below shipped on this change's superseded head. Count the raw call sites too
// and require every one of them to be addressed.
const countCalls = (pattern: RegExp) => [...postCard.matchAll(pattern)].length;

test('PostCard keeps the two-argument onChanged contract', () => {
  assert.match(postCard, /onChanged\?:\s*\(id: string, next: PostChange\) => void;/);
});

test('every post-level onChanged call addresses post.id', () => {
  // the two contracts in this file are syntactically distinguishable:
  // PostCardImpl's prop is optional (`onChanged?.(`), CommentRow's is required
  // (`onChanged(`), so `onChanged\(` cannot match a post-level call.
  const calls = [...postCard.matchAll(/onChanged\?\.\(\s*([^,)]+),/g)].map((match) => match[1].trim());
  assert.ok(calls.length >= 10, `expected PostCard to still bubble changes through onChanged?.() — found ${calls.length}`);
  assert.equal(
    calls.length,
    countCalls(/onChanged\?\.\(/g),
    'every post-level onChanged?.() call must pass an id AND a change — a one-argument call only warns'
  );
  assert.deepEqual([...new Set(calls)], ['post.id']);
});

test('every comment-level onChanged call addresses comment.id', () => {
  const calls = [...postCard.matchAll(/(?:^|[^.\w])onChanged\(\s*([^,)]+),/gm)].map((match) => match[1].trim());
  assert.ok(calls.length >= 3, `expected CommentRow to still bubble changes through onChanged() — found ${calls.length}`);
  assert.equal(
    calls.length,
    countCalls(/(?:^|[^.\w])onChanged\(/gm),
    'every comment-level onChanged() call must pass an id AND a change — a one-argument call only warns'
  );
  assert.deepEqual([...new Set(calls)], ['comment.id']);
});

// Every surface that renders a PostCard must pass a hoisted, stable handler by
// name — an inline arrow is exactly the regression TODO #12 removed.
const CONSUMERS = [
  ['PostList.tsx'],
  ['..', 'Search', 'SearchPage.tsx'],
  ['..', '..', 'routes', 'thing.tsx'],
  ['..', '..', 'routes', 'post.tsx'],
  ['..', '..', 'routes', 'media.tsx']
];

for (const segments of CONSUMERS) {
  const name = segments[segments.length - 1];
  test(`${name} hands PostCard a stable onChanged identity`, () => {
    const bindings = [...read(...segments).matchAll(/onChanged=\{([^}]*)\}/g)].map((match) => match[1].trim());
    assert.ok(bindings.length >= 1, `${name} should still render a PostCard with onChanged`);
    for (const binding of bindings) {
      assert.match(
        binding,
        /^[A-Za-z_$][\w$]*$/,
        `${name} must pass a stable named handler, not an inline closure: onChanged={${binding}}`
      );
    }
  });
}
