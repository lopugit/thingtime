/** XPath runs synchronously in the browser. Bound both syntax and the actual
 * input tree before native execution; a worker deadline cannot interrupt it. */
export const XPATH_LIMITS = { text: 512, tokens: 64, nodes: 128, treeText: 1024, work: 16_000_000, totalWork: 64_000_000 };
export function xpathExpression(raw: unknown): { text: string; tokens: number } {
	if (typeof raw !== 'string' || raw.length > XPATH_LIMITS.text) throw new Error('Expected bounded XPath expression text');
	// Quoted text is opaque. Malformed syntax remains the native parser's job.
	const tokens = raw.match(/"[^"]*"|'[^']*'|[A-Za-z_][\w.-]*|\d+(?:\.\d+)?|\/\/|::|[^\s]/g) || [];
	if (tokens.length > XPATH_LIMITS.tokens) throw new Error('XPath token budget exceeded');
	let predicates = 0,
		depth = 0;
	for (const token of tokens) {
		if (token === '[') {
			if (++predicates > 1) throw new Error('Nested XPath predicates exceed the work boundary');
		} else if (token === ']') predicates = Math.max(0, predicates - 1);
		else if (predicates && ['/', '//', '::'].includes(token)) throw new Error('XPath predicate traversal exceeds the work boundary');
		if (token === '(' && ++depth > 8) throw new Error('XPath expression depth budget exceeded');
		if (token === ')') depth = Math.max(0, depth - 1);
	}
	return { text: raw, tokens: Math.max(1, tokens.length) };
}
export function xpathCost(tokens: number, nodes: number, text: number, expressionLength: number): number {
	if (nodes > XPATH_LIMITS.nodes || text > XPATH_LIMITS.treeText) throw new Error('XPath input tree budget exceeded');
	// Conservative allowance for repeated traversal, node-set comparisons and
	// string functions, including authored literals and concatenation expansion.
	const cost = tokens ** 2 * (nodes ** 2 + (text + expressionLength) ** 2);
	if (cost > XPATH_LIMITS.work) throw new Error('XPath expression work budget exceeded');
	return cost;
}
/** Data-backed synchronous callback interface. Native Node resolvers are also
 * supported. Worker callbacks are asynchronous and must never be faked here. */
export function xpathResolver(raw: unknown): { lookupNamespaceURI: (prefix: string | null) => string | null } {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 16)
		throw new Error('Expected a bounded XPath namespace map or owned Node');
	const entries = Object.entries(raw);
	for (const [prefix, uri] of entries)
		if (!/^[A-Za-z_][\w.-]{0,39}$/.test(prefix) || typeof uri !== 'string' || uri.length > 512) throw new Error('Invalid XPath namespace map entry');
	const namespaces = new Map(entries as [string, string][]);
	return Object.freeze({ lookupNamespaceURI: (prefix: string | null) => namespaces.get(prefix || '') ?? null });
}
