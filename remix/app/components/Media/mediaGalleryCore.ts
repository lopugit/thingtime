export const MAX_LINKED_IMAGES = 8;
// Mirrors the post image URL bound in app/schemas/registry.ts without pulling
// the server schema registry into the browser bundle.
export const MAX_LINKED_IMAGE_URL_CHARS = 2048;

export type LinkedImageItem = {
	id: string;
	url: string;
};

const createLocalId = () =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `linked-image-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const isLinkedImageUrl = (value: string): boolean => {
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed.length > MAX_LINKED_IMAGE_URL_CHARS ||
		/[\p{Cc}\p{Cf}\p{Cs}\s]/u.test(trimmed) ||
		trimmed.includes('\\') ||
		!/^https?:\/\//i.test(trimmed)
	) {
		return false;
	}
	try {
		const parsed = new URL(trimmed);
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
};

export const createLinkedImageItem = (url = '', idFactory: () => string = createLocalId): LinkedImageItem => ({
	id: idFactory(),
	url
});

export const canonicalLinkedImageUrls = (items: readonly LinkedImageItem[]): string[] => {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const item of items) {
		const url = item.url.trim();
		if (!isLinkedImageUrl(url) || seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
	}
	return urls;
};

export const linkedImageItemError = (items: readonly LinkedImageItem[], index: number): string | null => {
	const item = items[index];
	if (!item) return null;
	const url = item.url.trim();
	if (!url) return 'Enter a full http(s) image URL.';
	if (!isLinkedImageUrl(url)) return 'Use a full http(s) image URL without spaces.';
	if (items.slice(0, index).some((candidate) => candidate.url.trim() === url)) return 'This image URL is already added.';
	return null;
};

export type AppendLinkedImageLinesResult = {
	items: LinkedImageItem[];
	remainingInput: string;
	addedCount: number;
	duplicateCount: number;
	invalidCount: number;
	overflowCount: number;
};

export const appendLinkedImageLines = (
	current: readonly LinkedImageItem[],
	input: string,
	options: { maxItems?: number; idFactory?: () => string } = {}
): AppendLinkedImageLinesResult => {
	const maxItems = options.maxItems ?? MAX_LINKED_IMAGES;
	const idFactory = options.idFactory ?? createLocalId;
	const next = [...current];
	const seen = new Set(canonicalLinkedImageUrls(current));
	const remaining: string[] = [];
	let addedCount = 0;
	let duplicateCount = 0;
	let invalidCount = 0;
	let overflowCount = 0;

	for (const rawLine of input.split(/\r?\n/)) {
		const url = rawLine.trim();
		if (!url) continue;
		if (!isLinkedImageUrl(url)) {
			invalidCount += 1;
			remaining.push(rawLine);
			continue;
		}
		if (seen.has(url)) {
			duplicateCount += 1;
			continue;
		}
		if (next.length >= maxItems) {
			overflowCount += 1;
			remaining.push(url);
			continue;
		}
		seen.add(url);
		next.push(createLinkedImageItem(url, idFactory));
		addedCount += 1;
	}

	return {
		items: next,
		remainingInput: remaining.join('\n'),
		addedCount,
		duplicateCount,
		invalidCount,
		overflowCount
	};
};

export const linkedImageAddMessage = (result: AppendLinkedImageLinesResult, maxItems = MAX_LINKED_IMAGES, noun = 'linked image'): string | null => {
	const messages: string[] = [];
	if (result.addedCount) messages.push(`${result.addedCount} ${noun}${result.addedCount === 1 ? '' : 's'} added.`);
	if (result.duplicateCount) messages.push(`${result.duplicateCount} duplicate${result.duplicateCount === 1 ? '' : 's'} skipped.`);
	if (result.invalidCount) messages.push('Use one full http(s) image URL per line.');
	if (result.overflowCount) messages.push(`You can include up to ${maxItems} ${noun}${maxItems === 1 ? '' : 's'}.`);
	return messages.length ? messages.join(' ') : null;
};
