import { describe, expect, it } from 'vitest';
import { emojiValue, findEmojiEntries, unicodeNotation } from './emojiData.js';

describe('Emoji & Symbols data', () => {
  it('ranks an exact semantic match before related emoji', () => {
    const matches = findEmojiEntries('red heart', 'all', []);
    expect(matches[0]).toMatchObject({ label: 'red heart', value: '❤️' });
    const heartMatches = findEmojiEntries('heart', 'all', []);
    expect(heartMatches.length).toBeGreaterThan(40);
    expect(() => findEmojiEntries('h', 'all', [])).not.toThrow();
    expect(heartMatches.find((entry) => entry.label === 'face blowing a kiss')?.keywords).toContain(':x');
    expect(
      heartMatches.every((entry) => entry.keywords.every((keyword) => typeof keyword === 'string')),
    ).toBe(true);
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
