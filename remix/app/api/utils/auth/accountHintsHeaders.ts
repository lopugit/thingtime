// Account hints identify browser sessions and must never be stored by a shared
// cache. The federated resolver additionally varies by Origin through its
// credentialed CORS response; preserve that while adding Cookie as the other
// response selector.
export const privateAccountHintsHeaders = (...sources: Array<HeadersInit | undefined>) => {
	const headers = new Headers();
	const vary = new Map<string, string>();

	for (const source of sources) {
		if (!source) continue;
		new Headers(source).forEach((value, name) => {
			if (name.toLowerCase() === 'vary') {
				for (const token of value.split(',')) {
					const trimmed = token.trim();
					if (!trimmed) continue;
					const normalized = trimmed.toLowerCase();
					vary.set(normalized, normalized === 'origin' ? 'Origin' : normalized === 'cookie' ? 'Cookie' : trimmed);
				}
				return;
			}
			headers.set(name, value);
		});
	}

	vary.set('cookie', 'Cookie');
	headers.set('Vary', [...vary.values()].join(', '));
	headers.set('Cache-Control', 'private, no-store');
	return headers;
};
