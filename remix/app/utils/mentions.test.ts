import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	MENTION_CAP,
	ACTIVE_MENTION_QUERY_PATTERN,
	extractMentionUsernames,
	isMentionableUsername,
	profileMentionHref,
	splitMentionSegments
	// @ts-ignore see above
} from './mentions.ts';

test('mentions match at word starts and keep the literal text intact', () => {
	const text = 'hey @Bob and (@alice-w) — ping @carol_9 👋';
	const segments = splitMentionSegments(text);
	assert.equal(segments.map((segment) => segment.text).join(''), text);
	assert.deepEqual(
		segments.filter((segment) => segment.kind === 'mention').map((segment) => (segment.kind === 'mention' ? segment.username : '')),
		['bob', 'alice-w', 'carol_9']
	);
	// display keeps the author's casing; the username is canonical lowercase
	assert.equal(segments.find((segment) => segment.kind === 'mention')?.text, '@Bob');
});

test('emails, mid-word @s, and bare @ never mention', () => {
	for (const text of ['mail me at bob@example.com', 'foo@bar is not a mention', 'a lone @ sign', 'trailing @', 'no mentions at all']) {
		assert.deepEqual(extractMentionUsernames(text), [], text);
		assert.deepEqual(splitMentionSegments(text), [{ kind: 'text', text }], text);
	}
});

test('dotted usernames match whole; sentence-ending dots stay out', () => {
	assert.deepEqual(extractMentionUsernames('cc @rick.deckard today'), ['rick.deckard']);
	// the trailing dot is punctuation, not part of the name
	const segments = splitMentionSegments('ask @bob. He knows');
	assert.deepEqual(segments, [
		{ kind: 'text', text: 'ask ' },
		{ kind: 'mention', text: '@bob', username: 'bob' },
		{ kind: 'text', text: '. He knows' }
	]);
});

test('a segment preceded by a word char (post-hashtag split) never linkifies its leading @', () => {
	// "#tag@bob" splits into tag "#tag" + text "@bob" — the @ is mid-word in
	// the original text, so the mention pass must skip it, matching what the
	// raw-text server pass sees (word-start rule fails there too).
	assert.deepEqual(splitMentionSegments('@bob', true), [{ kind: 'text', text: '@bob' }]);
	assert.deepEqual(splitMentionSegments('@bob', false), [{ kind: 'mention', text: '@bob', username: 'bob' }]);
	// only the very first character is affected — later mentions still match
	assert.deepEqual(
		splitMentionSegments('@bob but @carol is real', true).filter((segment) => segment.kind === 'mention'),
		[{ kind: 'mention', text: '@carol', username: 'carol' }]
	);
	// and the raw-text pass agrees: the word-start rule already fails there
	assert.deepEqual(extractMentionUsernames('#tag@bob but @carol is real'), ['carol']);
});

test('NFD input normalizes to NFC before tokenizing — server and renderer agree', () => {
	// 'rené' is e + combining acute (the macOS NFD paste path). NFC
	// composes it into 'rené' BEFORE the ASCII grammar runs, so both the
	// server pass (raw stored text) and the renderer pass (post-hashtag NFC
	// segments) tokenize the same '@ren' and stop at the same non-name char —
	// without the shared normalize, the server saw 'rene' while the card
	// linkified 'ren': two different users from one text.
	const nfd = 'hola @rene\u0301 amigo';
	const nfc = nfd.normalize('NFC');
	assert.deepEqual(extractMentionUsernames(nfd), ['ren']);
	assert.deepEqual(extractMentionUsernames(nfd), extractMentionUsernames(nfc));
	const segments = splitMentionSegments(nfd);
	// concatenation reproduces the NFC-normalized input
	assert.equal(segments.map((segment) => segment.text).join(''), nfc);
	assert.deepEqual(
		segments.filter((segment) => segment.kind === 'mention'),
		[{ kind: 'mention', text: '@ren', username: 'ren' }]
	);
});

test('extraction dedupes case-insensitively and caps at MENTION_CAP', () => {
	assert.deepEqual(extractMentionUsernames('@Bob @bob @BOB'), ['bob']);
	const many = Array.from({ length: MENTION_CAP + 5 }, (_value, index) => `@user${index}`).join(' ');
	assert.equal(extractMentionUsernames(many).length, MENTION_CAP);
});

test('implausibly long names are skipped, not truncated', () => {
	const longName = 'a'.repeat(65);
	assert.deepEqual(extractMentionUsernames(`hey @${longName}`), []);
});

test('mentionable-username guard matches the grammar', () => {
	assert.equal(isMentionableUsername('rick.deckard'), true);
	assert.equal(isMentionableUsername('bob-9_x'), true);
	assert.equal(isMentionableUsername(''), false);
	assert.equal(isMentionableUsername('has space'), false);
	assert.equal(isMentionableUsername('trailing.'), false);
	assert.equal(isMentionableUsername('a'.repeat(65)), false);
});

test('active-query pattern tracks in-progress typing including a trailing dot', () => {
	assert.equal('hey @bo'.match(ACTIVE_MENTION_QUERY_PATTERN)?.[2], 'bo');
	assert.equal('hey @bob.'.match(ACTIVE_MENTION_QUERY_PATTERN)?.[2], 'bob.');
	assert.equal('email bob@exam'.match(ACTIVE_MENTION_QUERY_PATTERN), null);
	assert.equal('hey @'.match(ACTIVE_MENTION_QUERY_PATTERN), null);
});

test('profile hrefs canonicalize and encode', () => {
	assert.equal(profileMentionHref('Bob'), '/profile/bob');
	assert.equal(profileMentionHref('rick.deckard'), '/profile/rick.deckard');
});
