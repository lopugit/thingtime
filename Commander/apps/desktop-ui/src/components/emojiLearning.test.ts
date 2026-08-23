import { describe, expect, it } from 'vitest';
import {
  deserializeEmojiLearning,
  emptyEmojiLearning,
  learnedEmojiCounts,
  recordEmojiChoice,
  resetEmojiChoice,
} from './emojiLearning.js';

describe('emoji query learning', () => {
  it('increments a normalized query and emoji pair by one for every selection', () => {
    const once = recordEmojiChoice(emptyEmojiLearning(), '  Blue   HEART  ', 'emoji:1F499');
    const twice = recordEmojiChoice(once, 'blue heart', 'emoji:1F499');

    expect(learnedEmojiCounts(twice, 'BLUE HEART').get('emoji:1F499')).toBe(2);
    expect(twice.queries).toEqual([{ query: 'blue heart', choices: [{ emojiId: 'emoji:1F499', count: 2 }] }]);
  });

  it('fails closed for malformed or unsupported persisted data', () => {
    expect(deserializeEmojiLearning('{nope')).toEqual(emptyEmojiLearning());
    expect(deserializeEmojiLearning(JSON.stringify({ version: 2, queries: [] }))).toEqual(
      emptyEmojiLearning(),
    );
    expect(
      deserializeEmojiLearning(
        JSON.stringify({
          version: 1,
          queries: [
            {
              query: 'heart',
              choices: [
                { emojiId: 'emoji:2764', count: 'many' },
                { emojiId: 'emoji:1F499', count: 0.5 },
              ],
            },
          ],
        }),
      ),
    ).toEqual(emptyEmojiLearning());
  });

  it('bounds retained query and emoji choice history', () => {
    let state = emptyEmojiLearning();
    for (let index = 0; index < 130; index += 1)
      state = recordEmojiChoice(state, `query ${index}`, `emoji:${index}`);

    expect(state.queries).toHaveLength(128);
    expect(state.queries[0]?.query).toBe('query 129');
    expect(state.queries.some((candidate) => candidate.query === 'query 0')).toBe(false);

    for (let index = 0; index < 18; index += 1)
      state = recordEmojiChoice(state, 'heart', `emoji:heart-${index}`);

    const heart = state.queries.find((candidate) => candidate.query === 'heart');
    expect(heart?.choices).toHaveLength(16);
    expect(heart?.choices[0]).toEqual({ emojiId: 'emoji:heart-17', count: 1 });
    expect(heart?.choices.some((choice) => choice.emojiId === 'emoji:heart-0')).toBe(false);
  });

  it('resets only one emoji score for the requested normalized query', () => {
    let state = emptyEmojiLearning();
    state = recordEmojiChoice(state, 'heart', 'emoji:red');
    state = recordEmojiChoice(state, 'heart', 'emoji:blue');
    state = recordEmojiChoice(state, 'sparkle', 'emoji:blue');

    const reset = resetEmojiChoice(state, ' HEART ', 'emoji:blue');
    expect(learnedEmojiCounts(reset, 'heart')).toEqual(new Map([['emoji:red', 1]]));
    expect(learnedEmojiCounts(reset, 'sparkle')).toEqual(new Map([['emoji:blue', 1]]));
  });
});
