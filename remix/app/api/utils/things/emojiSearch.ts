import emojiByEmojiJson from 'unicode-emoji-json/data-by-emoji.json' with { type: 'json' };

type EmojiMetadata = { name?: unknown; slug?: unknown };
// Keep this a static JSON import. Nitro can bundle it into the server chunk;
// createRequire(import.meta.url)(...) leaves a runtime package lookup that
// Vercel's function tracer does not copy, taking every search request down
// with MODULE_NOT_FOUND even when no emoji-name condition was submitted.
const emojiByEmoji = emojiByEmojiJson as Record<string, EmojiMetadata>;

// Schema search accepts the same human names as the emoji picker. The stored
// reaction remains the native token; this expands a bounded name query into
// tokens without changing the generic text-search contract for other fields.
export const emojiTokensForSearchTerm = (value: string, limit = 50): string[] => {
	const query = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
	if (!query) return [];
	const starts: string[] = [];
	const contains: string[] = [];
	for (const [emoji, metadata] of Object.entries(emojiByEmoji)) {
		const name = typeof metadata.name === 'string' ? metadata.name.toLowerCase() : '';
		const slug = typeof metadata.slug === 'string' ? metadata.slug.toLowerCase().replace(/_/g, ' ') : '';
		if (name.startsWith(query)) starts.push(emoji);
		else if (name.includes(query) || slug.includes(query)) contains.push(emoji);
		if (starts.length >= limit) break;
	}
	return [...starts, ...contains].slice(0, limit);
};
