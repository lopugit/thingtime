// Only literal, unkeyed first-party attachment references can delegate access.
// This is the single authority for that judgement: compositionAttachmentIds
// grants exactly these ids, and sharedAttachmentUrl below transports the bearer
// key to exactly these URLs. Keeping one predicate is what makes those two sets
// equal — an id outside this grammar can never be authorized through a shared
// root, so sending the key with it would only leak it to a guaranteed 403.
export const literalAttachmentId = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value.startsWith('/api/v1/attachments/content?') || /[{}$]/.test(value)) return null;
	try {
		const parsed = new URL(value, 'https://local.invalid');
		const id = parsed.searchParams.get('id');
		return parsed.pathname === '/api/v1/attachments/content' && id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) && !parsed.searchParams.has('key') && !parsed.searchParams.has('sharedRoot') ? id : null;
	} catch { return null; }
};

// Only the exact relative first-party media endpoint receives the bearer key.
// Never append it to external URLs, arbitrary links, or stored template data.
export const sharedAttachmentUrl = (value: string, linkKey?: string, sharedRoot?: string): string => {
	// Reject before rewriting: an unresolved `{...}` placeholder or an id the
	// grant side cannot name is not ours to re-encode. URLSearchParams would
	// normalize it (`id=a/b` → `id=a%2Fb`) and corrupt the stored value the
	// runtime still has to resolve, for a URL that could never be authorized.
	if ((!linkKey && !sharedRoot) || !literalAttachmentId(value)) return value;
	try {
		const url = new URL(value, 'https://local.invalid');
		if (linkKey) url.searchParams.set('key', linkKey);
		if (sharedRoot) url.searchParams.set('sharedRoot', sharedRoot);
		return `${url.pathname}${url.search}${url.hash}`;
	} catch { return value; }
};
