// Only the exact relative first-party media endpoint receives the bearer key.
// Never append it to external URLs, arbitrary links, or stored template data.
export const sharedAttachmentUrl = (value: string, linkKey?: string): string => {
	if (!linkKey || !value.startsWith('/api/v1/attachments/content?')) return value;
	try {
		const url = new URL(value, 'https://local.invalid');
		if (url.pathname !== '/api/v1/attachments/content' || !url.searchParams.get('id') || url.searchParams.has('key')) return value;
		url.searchParams.set('key', linkKey);
		return `${url.pathname}${url.search}${url.hash}`;
	} catch { return value; }
};
