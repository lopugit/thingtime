import assert from 'node:assert/strict';
import test from 'node:test';
import { subspaceEmbedSearchResults } from './subspaceEmbedSearch';

test('canonical search post records and list arrays normalize to the same selectable choices', () => {
  const post = { id: 'post-a', title: 'An accessible post', thingtime: ['post'] };
  const thing = { id: 'thing-a', crystal: { name: 'An accessible component' }, thingtime: ['component'] };
  const expected = [{ id: 'thing-a', name: 'An accessible component' }, { id: 'post-a', name: 'An accessible post' }];
  assert.deepEqual(subspaceEmbedSearchResults({ things: [thing], posts: { 'post-a': post } }), expected);
  assert.deepEqual(subspaceEmbedSearchResults({ things: [thing], posts: [post] }), expected);
  assert.deepEqual(subspaceEmbedSearchResults({ things: [thing, { ...post, crystal: { name: 'Generic post' } }], posts: { 'post-a': post } }), expected);
});

test('empty/malformed buckets do not throw and protected system kinds are never selectable', () => {
  assert.deepEqual(subspaceEmbedSearchResults({ posts: {} }), []);
  assert.deepEqual(subspaceEmbedSearchResults({ things: null, posts: 'unexpected' }), []);
  assert.deepEqual(subspaceEmbedSearchResults({ things: [null, {}, { id: 'modlog', thingtime: ['subspace-modlog'] }], posts: { nope: null, wrong: { id: 'chat', thingtime: ['chat-message'] } } }), []);
});
