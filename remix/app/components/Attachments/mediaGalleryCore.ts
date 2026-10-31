import { mediaPageUrl } from './attachmentUiCore';

// Canonical URLs authorize unlisted media. Preserve only composition context;
// legacy secret keys and storage URLs never become share links.
export const mediaPageLink = (id: string, contentUrl: string): string => {
	const page = mediaPageUrl(id);
	if (!contentUrl.startsWith('/api/v1/attachments/content?')) return page;
	const source = new URL(contentUrl, 'https://thingtime.invalid');
	if (source.searchParams.get('id') !== id) return page;
	const params = new URLSearchParams();
	for (const key of ['sharedRoot']) {
		const value = source.searchParams.get(key);
		if (value) params.set(key, value);
	}
	return params.size ? `${page}?${params}` : page;
};
