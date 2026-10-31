import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { INLINE_HASHTAG_CAP, canonicalHashtag, extractInlineHashtags, searchTagHref, splitHashtagSegments } from './hashtags.ts';

test('hashtags match at word starts and keep the literal text intact', () => {
	const text = 'Golden hour #Sunset over the bay #beach-life ✨';
	const segments = splitHashtagSegments(text);
	assert.equal(segments.map((segment) => segment.text).join(''), text);
	assert.deepEqual(
		segments.filter((segment) => segment.kind === 'tag').map((segment) => (segment.kind === 'tag' ? segment.tag : '')),
		['sunset', 'beach-life']
	);
	// display keeps the author's casing; the tag is canonical lowercase
	assert.equal(segments.find((segment) => segment.kind === 'tag')?.text, '#Sunset');
});

test('urls, entities, mid-word hashes, and pure numbers never linkify', () => {
	for (const text of [
		'see https://example.com/page#section for details',
		'https://example.com/#home',
		'quote &#39; entity',
		'issue #42 and PR #123',
		'foo#bar is not a tag',
		'no tags here at all'
	]) {
		assert.deepEqual(extractInlineHashtags(text), [], text);
		assert.deepEqual(splitHashtagSegments(text), text ? [{ kind: 'text', text }] : []);
	}
});

test('unicode tags, punctuation boundaries, and brackets work', () => {
	assert.deepEqual(extractInlineHashtags('#日本語 tag and (#nested) "#quoted" #trailing.'), [
		'日本語',
		'nested',
		'quoted',
		'trailing'
	]);
	assert.deepEqual(extractInlineHashtags('newline\n#fresh start'), ['fresh']);
});

test('inline extraction dedupes case-insensitively and caps the list', () => {
	assert.deepEqual(extractInlineHashtags('#Cats #cats #CATS #dogs'), ['cats', 'dogs']);
	const many = Array.from({ length: 15 }, (_unused, index) => `#tag${index}`).join(' ');
	assert.equal(extractInlineHashtags(many).length, INLINE_HASHTAG_CAP);
});

test('NFD input normalizes to the same tag as NFC and never severs an accent', () => {
	// explicit escapes so the two encodings can't be flattened by tooling:
	// NFD (e + combining acute, common from macOS paste) vs NFC (precomposed)
	const nfdTag = 'cafe\u0301';
	const nfcTag = 'caf\u00e9';
	// both spellings land in ONE bucket...
	assert.deepEqual(extractInlineHashtags(`#${nfdTag} end`), [nfcTag]);
	assert.deepEqual(extractInlineHashtags(`#${nfdTag} end`), extractInlineHashtags(`#${nfcTag} end`));
	assert.equal(canonicalHashtag(nfdTag), nfcTag);
	assert.equal(searchTagHref(nfdTag), searchTagHref(nfcTag));
	// ...and the combining accent stays inside the link segment (concatenation
	// reproduces the NFC form, not a detached mark starting the next segment)
	const segments = splitHashtagSegments(`#${nfdTag} end`);
	assert.equal(segments.map((segment) => segment.text).join(''), `#${nfcTag} end`);
	assert.deepEqual(segments[0], { kind: 'tag', text: `#${nfcTag}`, tag: nfcTag });
});

test('tag hrefs canonicalize and escape the tag', () => {
	assert.equal(searchTagHref('Sunset'), '/search?tags=sunset');
	assert.equal(searchTagHref('日本語'), `/search?tags=${encodeURIComponent('日本語')}`);
});

test('astral-letter tags never bisect a surrogate pair or break the href', () => {
	// 3 ASCII letters + 25 math-bold letters = 28 code points but 53 UTF-16
	// units; the old UTF-16 slice(0, 40) cut mid-pair, leaving a lone high
	// surrogate that made encodeURIComponent throw during render.
	const astral = `the${'\u{1D5EF}'.repeat(25)}`;
	assert.equal(canonicalHashtag(astral), astral);
	assert.doesNotThrow(() => searchTagHref(astral));
	// a tag truncated at the cap cuts on a code-point boundary: 39 singles plus
	// one full surrogate pair survive (41 UTF-16 units), never half a pair
	const overCap = 'x'.repeat(39) + '\u{1D5EF}\u{1D5EF}';
	assert.equal(canonicalHashtag(overCap), 'x'.repeat(39) + '\u{1D5EF}');
	assert.doesNotThrow(() => searchTagHref(overCap));
	// a poison tag stored via the raw API before the guard (lone surrogate at
	// the cap boundary) still canonicalizes to well-formed UTF-16 and renders
	const poison = 'a'.repeat(39) + '\uD800';
	assert.equal(canonicalHashtag(poison), 'a'.repeat(39));
	assert.doesNotThrow(() => searchTagHref(poison));
});
