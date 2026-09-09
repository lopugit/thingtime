// Only the exact relative first-party media endpoint receives the bearer key.
// Never append it to external URLs, arbitrary links, or stored template data.
export const sharedAttachmentUrl = (value: string, linkKey?: string, sharedRoot?: string): string => {
	if ((!linkKey && !sharedRoot) || !value.startsWith('/api/v1/attachments/content?')) return value;
	try {
		const url = new URL(value, 'https://local.invalid');
		if (url.pathname !== '/api/v1/attachments/content' || !url.searchParams.get('id') || url.searchParams.has('key') || url.searchParams.has('sharedRoot')) return value;
		if (linkKey) url.searchParams.set('key', linkKey);
		if (sharedRoot) url.searchParams.set('sharedRoot', sharedRoot);
		return `${url.pathname}${url.search}${url.hash}`;
	} catch { return value; }
};
