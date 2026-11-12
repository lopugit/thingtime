import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeChatReactionToken, sanitizeReactionToken, splitEmojis } from '../../utils/reactionTokens';
import { getThingtimeSchema, validateThingtimeCrystal } from '../../schemas/registry';
import { beginRecentReaction, createRecentReactionState, quickRecentReactions, reactionPickerScope, receiveRecentReactions, recordRecentReaction } from '../Emoji/reactionPickerState';
import { REACTION_EMOJIS } from './feedTypes';

test('full emoji combinations survive both reaction validators and the canonical schema', () => {
  for (const token of ['🙂'.repeat(13), '👨🏽‍👩🏾‍👧🏿‍👦🏻'.repeat(20), '🇦🇺1️⃣👍🏽❤️'.repeat(100)]) {
    assert.equal(sanitizeReactionToken(token), token);
    assert.equal(sanitizeChatReactionToken(token), token);
    const result = validateThingtimeCrystal(['reaction'], { emoji: token });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.crystal, { emoji: token });
  }
  const schema = getThingtimeSchema('reaction');
  assert.equal(schema?.fields.find((field) => field.name === 'emoji')?.max, undefined);
});

test('removing token length caps preserves the emoji grammar and namespace boundaries', () => {
  for (const invalid of ['', 'hello', '123', '.', '$🙂', '🙂 🙂', '🙂\n🙂', '🙂.🙂', 'custom:emoji_abcdef', '\u200d'.repeat(100)]) {
    assert.equal(sanitizeReactionToken(invalid), null, invalid);
  }
  assert.equal(sanitizeReactionToken('  🙂🙌  '), '🙂🙌');
});

test('quick shortcuts append nine distinct recent tokens without repeating defaults', () => {
  const tokens = ['🚀', '🌈', '🎉', '🦋', '🐈', '🌻', '🌙', '🐸', '🙂'.repeat(20), '🌊'];
  const recent = ['👍', tokens[0], tokens[0], 'invalid', '❤️', ...tokens.slice(1)];
  assert.deepEqual(quickRecentReactions(recent, REACTION_EMOJIS), tokens.slice(0, 9));
  assert.deepEqual(quickRecentReactions(['👍', '🌈'], REACTION_EMOJIS), ['🌈']);
  assert.deepEqual(quickRecentReactions([], REACTION_EMOJIS), []);
});

test('a stale initial GET cannot erase an addition confirmed while it was in flight', () => {
  const store = createRecentReactionState(['🎉']);
  const order = beginRecentReaction(store);
  recordRecentReaction(store, '🚀', ['🚀', '🎉'], order);
  receiveRecentReactions(store, ['🎉', '🌈']);
  assert.deepEqual(store.list, ['🚀', '🎉', '🌈']);
});

test('out-of-order add replies keep successful selections in intent order without losing server history', () => {
  const store = createRecentReactionState(['🎉']);
  const older = beginRecentReaction(store);
  const newer = beginRecentReaction(store);
  recordRecentReaction(store, '🌈', ['🌈', '🚀', '🎉'], newer);
  recordRecentReaction(store, '🚀', ['🚀', '🎉'], older);
  assert.deepEqual(store.list, ['🌈', '🚀', '🎉']);
  // A failed attempt has no confirmed callback and does not enter recents.
  beginRecentReaction(store);
  receiveRecentReactions(store, ['🎉']);
  assert.deepEqual(store.list, ['🌈', '🚀', '🎉']);
});

test('recent stores and picker drafts use distinct account, origin and database identities', () => {
  const scopes = [
    reactionPickerScope('https://thingtime.test', 'home', 'user-a'),
    reactionPickerScope('https://thingtime.test', 'home', 'user-b'),
    reactionPickerScope('https://other.test', 'home', 'user-a'),
    reactionPickerScope('https://thingtime.test', 'other-db', 'user-a'),
    reactionPickerScope('https://thingtime.test', 'home', null)
  ];
  assert.equal(new Set(scopes).size, scopes.length);
  const a = createRecentReactionState([]);
  const b = createRecentReactionState([]);
  recordRecentReaction(a, '🚀', ['🚀'], beginRecentReaction(a));
  assert.deepEqual(b.list, []);
});

test('a current mutation snapshot preserves newer external usage between local selections', () => {
  const store = createRecentReactionState([]);
  recordRecentReaction(store, '🚀', ['🚀'], beginRecentReaction(store));
  // Another tab uses 🌈 before this tab uses 🎉. The current server list is
  // authoritative here; the earlier local 🚀 must not jump ahead of 🌈.
  recordRecentReaction(store, '🎉', ['🎉', '🌈', '🚀'], beginRecentReaction(store));
  assert.deepEqual(store.list, ['🎉', '🌈', '🚀']);
});

test('a delayed older reply fills history without moving newer confirmed selections', () => {
  const store = createRecentReactionState([]);
  const older = beginRecentReaction(store);
  recordRecentReaction(store, '🌈', ['🌈', '🌙'], beginRecentReaction(store));
  recordRecentReaction(store, '🎉', ['🎉', '🌈', '🌙'], beginRecentReaction(store));
  recordRecentReaction(store, '🚀', ['🚀', '🌙'], older);
  assert.deepEqual(store.list, ['🎉', '🌈', '🚀', '🌙']);
  receiveRecentReactions(store, ['🌙']);
  assert.deepEqual(store.list, ['🎉', '🌈', '🚀', '🌙']);
});

test('an older receipt preserves its position in the newest server snapshot', () => {
  const store = createRecentReactionState([]);
  const older = beginRecentReaction(store);
  const snapshot = ['🎉', '🌙', '🌈', '🚀'];
  recordRecentReaction(store, '🎉', snapshot, beginRecentReaction(store));
  recordRecentReaction(store, '🚀', ['🚀', '🌈'], older);
  assert.deepEqual(store.list, snapshot);
});

test('decoration can read a bounded emoji prefix without truncating the saved token', () => {
  const emoji = '👨🏽‍👩🏾‍👧🏿‍👦🏻';
  const token = emoji.repeat(200);
  assert.deepEqual(splitEmojis(token, 8), Array(8).fill(emoji));
  assert.deepEqual(splitEmojis(token, 1), [emoji]);
  assert.deepEqual(splitEmojis(token, 0), []);
  assert.equal(sanitizeReactionToken(token), token);
});
