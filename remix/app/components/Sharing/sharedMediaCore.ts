// Only the exact relative first-party media endpoint receives the bearer key.
// Never append it to external URLs, arbitrary links, or stored template data.
export const sharedAttachmentUrl = (value: string, linkKey?: string, sharedRoot?: string): string => {
	// The `[{}$]` template guard is the same one literalAttachmentId uses, so
	// transport rewrites exactly what discovery can grant. An unresolved
	// placeholder never names a readable attachment, and percent-encoding its
	// braces here would only corrupt the template the runtime still has to fill.
	if ((!linkKey && !sharedRoot) || !value.startsWith('/api/v1/attachments/content?') || /[{}$]/.test(value)) return value;
	try {
		const url = new URL(value, 'https://local.invalid');
		if (url.pathname !== '/api/v1/attachments/content' || !url.searchParams.get('id') || url.searchParams.has('key') || url.searchParams.has('sharedRoot')) return value;
		if (linkKey) url.searchParams.set('key', linkKey);
		if (sharedRoot) url.searchParams.set('sharedRoot', sharedRoot);
		return `${url.pathname}${url.search}${url.hash}`;
	} catch { return value; }
};
