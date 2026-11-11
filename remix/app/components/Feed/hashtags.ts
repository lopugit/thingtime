// Inline #hashtag tokenization shared by the composer (typed #tags become
// real tags on publish) and PostCard (#tags in post text render as links).
// One grammar in one module so what the composer extracts and what the card
// linkifies can never drift apart.
//
// A hashtag is a `#` at a word start — the start of the text or right after
// whitespace / an opening bracket / a quote — followed by Unicode letters,
// digits, `_` or `-`, containing at least one letter. That word-start rule is
// what keeps URLs (`example.com/page#section`), HTML entities (`&#39;`) and
// code-ish tokens like `foo#bar` untouched: their `#` follows a word or path
// character, so it never matches. Purely numeric refs like `#42` stay plain
// text too (no letter).

// mirrors attachmentUiCore MAX_POST_TAG_CHARS and the server sanitizeTags cap
const MAX_HASHTAG_CHARS = 40;

// inline tags harvested from the text on publish are capped below the
// server's 12-tag total, leaving room for explicitly entered tags
export const INLINE_HASHTAG_CAP = 10;

// group 1: the word-start prefix (kept as plain text), group 2: the tag body.
// \p{M} keeps combining marks inside the tag so decomposed input (NFD '#café')
// never severs an accent from its base letter at the link boundary.
const HASHTAG_PATTERN = /(^|[\s([{'"“”‘’])#([\p{L}\p{M}\p{N}_-]*\p{L}[\p{L}\p{M}\p{N}_-]*)/gu;

// display keeps the author's casing; hrefs and stored tags use this form,
// matching the server-side tag canonicalizer (trim + lowercase + NFC + cap).
// NFC normalization keeps composed and decomposed spellings of the same
// visible tag ('#café' typed vs pasted from macOS NFD text) in ONE bucket —
// the server canonicalTag and canonicalPostTags apply the same form. The cap
// counts code points — a UTF-16 slice could bisect a surrogate pair, and the
// resulting lone surrogate makes encodeURIComponent throw during render. Lone
// surrogates already present in the input (e.g. a poison tag stored via the
// raw API before this guard) are dropped for the same reason: the result must
// always be well-formed UTF-16 so searchTagHref can never throw.
const isLoneSurrogate = (char: string): boolean => {
	const codePoint = char.codePointAt(0) ?? 0;
	return codePoint >= 0xd800 && codePoint <= 0xdfff;
};

export const canonicalHashtag = (raw: string): string =>
	Array.from(raw.trim().toLowerCase().normalize('NFC'))
		.filter((char) => !isLoneSurrogate(char))
		.slice(0, MAX_HASHTAG_CHARS)
		.join('');

export type HashtagSegment = { kind: 'text'; text: string } | { kind: 'tag'; text: string; tag: string };

// Split text into plain-text and hashtag segments for rendering. Concatenating
// every segment's `text` reproduces the NFC-normalized input — the literal
// `#Word` (original casing) stays in the flow, only its wrapper changes.
// Normalizing first means an NFD accent composes into its base letter before
// tokenizing, so it can never be severed onto the wrong side of a boundary.
export const splitHashtagSegments = (rawText: string): HashtagSegment[] => {
	const segments: HashtagSegment[] = [];
	if (!rawText) return segments;
	const text = rawText.normalize('NFC');
	const pattern = new RegExp(HASHTAG_PATTERN.source, HASHTAG_PATTERN.flags);
	let cursor = 0;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		const raw = match[2];
		const tag = canonicalHashtag(raw);
		if (!tag) continue;
		const tagStart = match.index + match[1].length;
		if (tagStart > cursor) segments.push({ kind: 'text', text: text.slice(cursor, tagStart) });
		segments.push({ kind: 'tag', text: `#${raw}`, tag });
		cursor = tagStart + 1 + raw.length;
	}
	if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
	return segments;
};

// The canonical tags typed inline in a post body, in order of appearance,
// deduped, capped at INLINE_HASHTAG_CAP. The composer merges these with the
// explicit tag input (explicit tags first) through canonicalPostTags.
export const extractInlineHashtags = (text: string): string[] => {
	const tags: string[] = [];
	for (const segment of splitHashtagSegments(text)) {
		if (segment.kind !== 'tag') continue;
		if (!tags.includes(segment.tag)) tags.push(segment.tag);
		if (tags.length >= INLINE_HASHTAG_CAP) break;
	}
	return tags;
};

// Every tappable tag (chip or inline #link) lands on /search pre-seeded to
// filter by that tag — SearchPage consumes ?tags= as a deep link, seeding a
// visible `tags is <tag>` builder row and running the search. One tag per
// param (multi-tag links repeat the param: ?tags=a&tags=b) — SearchPage reads
// getAll('tags') with no delimiter, so a stored tag containing a comma can
// never be split into rows that don't match the post the chip sits on.
export const searchTagHref = (tag: string): string => `/search?tags=${encodeURIComponent(canonicalHashtag(tag))}`;
