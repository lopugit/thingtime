// A reaction "token" is one or more emoji that render natively in the browser
// (we store the actual unicode characters, never image refs). A token can be a
// single emoji (👍) or a multi-emoji group typed/pasted as one unit
// (🤣🤣🙌💀💦) — the whole string is one reaction, one Mongo `reactions.<token>`
// key, one entry in a user's recents. This validator is the single source of
// truth shared by the server (things.ts) and the picker UI, so a token the
// client offers is exactly one the API accepts.
//
// Joiner code points referenced below: ‍ ZWJ, ️ VS16 (emoji
// presentation), ⃣ combining enclosing keycap.

// Every code point must be emoji-ish: a pictographic glyph, a regional
// indicator (flags), a skin-tone / emoji modifier, or one of the joiners that
// stitch emoji sequences together.
const ALL_EMOJI_CHARS =
  /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]+$/u;

// ...and at least one of them must be a real emoji, so bare digits/`#`/`*`
// (which are Emoji_Component on their own) can't sneak through as a "reaction"
// (⃣ lets keycap sequences like 1️⃣ still count).
const HAS_REAL_EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;

// One token holds at most this many distinct emoji (grapheme clusters); the
// code-point cap is a cheap guard against pathological joiner spam.
export const MAX_REACTION_EMOJIS = 12;
const MAX_REACTION_CODEPOINTS = 80;

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function'
    ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
    : null;

// Split a token into its individual emoji (grapheme clusters) for rendering /
// counting. Falls back to code-point spread where Intl.Segmenter is absent.
export const splitEmojis = (token: string): string[] => {
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(token), (s: any) => s.segment);
  }
  return Array.from(token);
};

// Return the trimmed token if it is a valid emoji-only reaction, else null.
// Also rejects Mongo-key-hostile input (`.`, leading `$`, spaces) as defense in
// depth — ALL_EMOJI_CHARS already excludes them.
export const sanitizeReactionToken = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (!token) return null;
  if (Array.from(token).length > MAX_REACTION_CODEPOINTS) return null;
  if (token.includes('.') || token.startsWith('$') || /\s/.test(token)) return null;
  if (!ALL_EMOJI_CHARS.test(token)) return null;
  if (!HAS_REAL_EMOJI.test(token)) return null;
  if (splitEmojis(token).length > MAX_REACTION_EMOJIS) return null;
  return token;
};

export const isValidReactionToken = (raw: unknown): boolean => sanitizeReactionToken(raw) !== null;
