import { describe, expect, it } from 'vitest';
import { emojiValue, findEmojiEntries, unicodeNotation } from './emojiData.js';

describe('Emoji & Symbols data', () => {
  it('ranks an exact semantic match before related emoji', () => {
    const matches = findEmojiEntries('red heart', 'all', []);
    expect(matches[0]).toMatchObject({ label: 'red heart', value: '❤️' });
    expect(findEmojiEntries('heart', 'all', []).length).toBeGreaterThan(40);
  });

  it('includes searchable non-emoji Unicode symbols', () => {
    expect(findEmojiEntries('summation', '8', [])[0]).toMatchObject({ value: '∑', label: 'summation' });
  });

  it('applies a selected skin tone when the emoji supports one', () => {
    const wavingHand = findEmojiEntries('waving hand', 'all', [])[0]!;
    expect(emojiValue(wavingHand, 3)).toBe('👋🏽');
    expect(unicodeNotation('👋🏽')).toBe('U+1F44B U+1F3FD');
  });
});
