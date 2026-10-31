/** A deliberately small HTML input vocabulary for native contextual parsing.
 * Validate tokens before parsing: no resources, attributes, raw-text elements,
 * custom elements, comments or foreign content can acquire parsing side effects.
 * Character references remain text in the native parser. */
export function rangeHTML(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096) throw new Error('Use bounded range fragment HTML');
	const tags = new Set('p span strong em b i u mark div br table tbody thead tfoot tr td th ul ol li'.split(' '));
	const tokens = value.match(/<[^>]*>|[^<]+|</g) || [];
	let count = 0;
	for (const token of tokens) {
		if (!token.startsWith('<')) continue;
		const match = /^<\/?([a-z]+)\s*>$/i.exec(token);
		if (!match || !tags.has(match[1].toLowerCase()) || ++count > 128)
			throw new Error('Range fragments accept bounded basic HTML tags without attributes');
	}
	return value;
}
export function rangeInit(value: unknown, node: (value: unknown) => object, number: (value: unknown) => unknown) {
	const keys = ['startContainer', 'startOffset', 'endContainer', 'endOffset'];
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== 4 ||
		keys.some((k) => !Object.prototype.hasOwnProperty.call(value, k))
	)
		throw new Error('StaticRange requires exactly four boundary fields');
	const init = value as Record<string, unknown>;
	return {
		startContainer: node(init.startContainer),
		startOffset: number(init.startOffset),
		endContainer: node(init.endContainer),
		endOffset: number(init.endOffset)
	};
}
