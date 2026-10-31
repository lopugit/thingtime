/** Shared server and local Thing tag contract. */
export const MAX_TAGS = 12;
export const MAX_TAG_CHARS = 40;

// The tag cap counts code points, never bisecting a surrogate pair, and lone
// surrogates are dropped — stored tags must be well-formed UTF-16 so the
// client's encodeURIComponent on a stored tag can never throw during render.
// NFC normalization keeps composed and decomposed spellings of one visible
// tag (NFD 'café' pasted from macOS vs typed NFC) in a single stored bucket.
// components/Feed/hashtags.ts canonicalHashtag and Attachments/
// attachmentUiCore.ts canonicalPostTags mirror this exactly.
export const canonicalTag = (value: string): string =>
  Array.from(value.trim().toLowerCase().normalize('NFC'))
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint < 0xd800 || codePoint > 0xdfff;
    })
    .slice(0, MAX_TAG_CHARS)
    .join('');

export const sanitizeTags = (value: unknown): string[] | { ok: false; status: number; error: string } => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'tags must be a list' };
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const tag = canonicalTag(entry);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
};
