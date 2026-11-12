import assert from 'node:assert/strict';
import test from 'node:test';

import { emojiTokensForSearchTerm } from './emojiSearch.ts';

test('reaction schema search resolves human emoji names to stored tokens', () => {
	const hearts = emojiTokensForSearchTerm('heart');
	assert.ok(hearts.includes('❤️'));
	assert.ok(hearts.length > 1);
	assert.ok(hearts.length <= 50);
	assert.deepEqual(emojiTokensForSearchTerm('no-such-emoji-name-xyz'), []);
});
