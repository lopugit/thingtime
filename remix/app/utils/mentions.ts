// Inline @mention tokenization shared by the composer autocomplete
// (components/Feed/MentionAutocomplete.tsx), the PostCard renderer, and the
// server's mention-notification emitter (api/utils/notifications/mentions.ts).
// One grammar in one module — what the composer suggests, what the card
// linkifies, and who the server notifies can never drift apart. Mirrors
// components/Feed/hashtags.ts, but lives in ~/utils (like reactionTokens)
// because the API layer imports it too.
//
// A mention is an `@` at a word start — the start of the text or right after
// whitespace / an opening bracket / a quote — followed by ASCII letters,
// digits, `_` or `-`, plus interior `.` separators. A dot only counts when
// another name character follows it, so a sentence-ending "ask @bob." mentions
// `bob`, while "@rick.deckard" matches whole (usernames may contain dots —
// see the users-search docs example). The word-start rule keeps email
// addresses (`a@b.com`) and mid-word `@`s untouched: their `@` follows a word
// character, so it never matches. Usernames are stored trimmed + lowercased
// (auth/users.ts findUserByUsername), so the canonical form is plain
// lowercase; display keeps the author's casing. The grammar itself is
// ASCII-only, but the INPUT is not: text is NFC-normalized before tokenizing
// (mirroring hashtags.ts) so both consumers see identical text. PostCard runs
// this pass on splitHashtagSegments output — which is already NFC — while the
// server runs it on the raw stored text; without normalizing here, an NFD
// accent (e + combining mark, the macOS paste path) would tokenize as a plain
// ASCII letter for the server but as a non-name character for the renderer,
// and the two would resolve DIFFERENT usernames from the same text.

// Implausibly long candidates are skipped entirely rather than truncated — a
// truncated name would linkify (and notify) the WRONG user.
const MAX_MENTION_CHARS = 64;

// Unique mentions honoured per text, in order of appearance — bounds the
// server's per-create username lookups and notification emits.
export const MENTION_CAP = 10;

// group 1: the word-start prefix (kept as plain text), group 2: the name.
const MENTION_PATTERN = /(^|[\s([{'"“”‘’])@([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g;

// The in-progress grammar the composer autocomplete matches against the text
// BEFORE the caret: same word-start rule and charset, but a trailing dot is
// allowed mid-typing (the author may be halfway through `bob.smith`).
export const ACTIVE_MENTION_QUERY_PATTERN = /(^|[\s([{'"“”‘’])@([A-Za-z0-9_.-]{1,64})$/;

export const canonicalMentionUsername = (raw: string): string => raw.trim().toLowerCase();

// Insertable/linkable usernames only: anything outside the mention charset
// (spaces, unicode, `#`, …) could never tokenize back out of the text, so the
// autocomplete must not offer it and the renderer must not link it.
export const isMentionableUsername = (username: string): boolean =>
	username.length > 0 && username.length <= MAX_MENTION_CHARS && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(username);

export type MentionSegment = { kind: 'text'; text: string } | { kind: 'mention'; text: string; username: string };

// Split text into plain-text and mention segments for rendering.
// Concatenating every segment's `text` reproduces the NFC-normalized input —
// the literal `@Name` (original casing) stays in the flow, only its wrapper
// changes. Normalizing first matches splitHashtagSegments' contract exactly:
// its text segments are already NFC, so re-normalizing is a no-op there, and
// the server's raw-text pass composes to the same form before tokenizing.
// Designed to run AFTER splitHashtagSegments on its text segments:
// the grammars are disjoint (`@` and `#` are not name characters in either),
// so sequential passes can never double-linkify or nest anchors.
// `precededByWordChar` marks a segment that starts right after a hashtag's
// last (word) character in the original text — a `^@` match there is really a
// mid-word `@` ("#tag@bob") and must not linkify, matching what the raw-text
// pass (extractMentionUsernames on the server) sees.
export const splitMentionSegments = (rawText: string, precededByWordChar = false): MentionSegment[] => {
	const segments: MentionSegment[] = [];
	if (!rawText) return segments;
	const text = rawText.normalize('NFC');
	const pattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);
	let cursor = 0;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		const raw = match[2];
		if (raw.length > MAX_MENTION_CHARS) continue;
		if (match.index === 0 && match[1] === '' && precededByWordChar) continue;
		const start = match.index + match[1].length;
		if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
		segments.push({ kind: 'mention', text: `@${raw}`, username: canonicalMentionUsername(raw) });
		cursor = start + 1 + raw.length;
	}
	if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
	return segments;
};

// The canonical usernames mentioned in a text, in order of appearance,
// deduped, capped at MENTION_CAP. The server resolves these against real
// users and notifies each; renderers deliberately do NOT verify existence
// (linkification is grammar-only — the profile page handles unknown names).
export const extractMentionUsernames = (text: string): string[] => {
	const usernames: string[] = [];
	for (const segment of splitMentionSegments(text)) {
		if (segment.kind !== 'mention') continue;
		if (!usernames.includes(segment.username)) usernames.push(segment.username);
		if (usernames.length >= MENTION_CAP) break;
	}
	return usernames;
};

export const profileMentionHref = (username: string): string => `/profile/${encodeURIComponent(canonicalMentionUsername(username))}`;
