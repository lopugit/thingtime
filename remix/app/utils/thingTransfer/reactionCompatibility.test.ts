import assert from 'node:assert/strict';
import test from 'node:test';
import { customEmojiIdForAttachment } from '../../api/utils/messenger/messengerMediaCore';
import { customReactionEmojiId, sanitizeChatReactionToken, sanitizeReactionToken } from '../reactionTokens';

test('shared reaction parser accepts canonical stored-emoji IDs without widening feed reactions', () => {
  const id = customEmojiIdForAttachment('owner', 'upload');
  assert.equal(id.length, 70);
  assert.equal(customReactionEmojiId(`custom:${id}`), id);
  assert.equal(sanitizeChatReactionToken(`custom:${id}`), `custom:${id}`);
  assert.equal(sanitizeReactionToken(`custom:${id}`), null);
  for (const legacy of ['legacy_emoji', 'c0ffee12-ffff-4fff-8fff-000000000006']) {
    assert.equal(customReactionEmojiId(`custom:${legacy}`), legacy);
  }
  for (const invalid of [`emoji_${'a'.repeat(65)}`, `emoji_${'g'.repeat(64)}`, `emoji_${'A'.repeat(64)}`,
    'x'.repeat(70), `${id}/path`, `${id}?token=secret`, `${id}\0`, '../emoji', '']) {
    assert.equal(customReactionEmojiId(`custom:${invalid}`), null);
  }
});
