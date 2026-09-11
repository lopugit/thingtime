import { literalAttachmentId, mapCssMediaUrls, isRenderMediaStyleProp } from './renderMediaCore';

// Root-only component render metadata. References change a rendered URL, never
// authorize it: normal composition discovery and attachment ACLs still apply.
export const copiedMediaRefs = (value: unknown): Map<string, string> => {
	const refs = new Map<string, string>();
	if (!Array.isArray(value)) return refs;
	const valid = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
	for (const pair of value.slice(0, 512)) {
		if (Array.isArray(pair) && valid(pair[0]) && valid(pair[1]) && !refs.has(pair[0])) refs.set(pair[0], pair[1]);
	}
	return refs;
};

export const copiedMediaUrl = (value: string, refs: ReadonlyMap<string, string>): string => {
	const id = literalAttachmentId(value);
	const next = id && refs.get(id);
	if (!next || next === id) return value;
	const parsed = new URL(value, 'https://local.invalid');
	parsed.searchParams.set('id', next);
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

// This is a second, bounded pass over an already resolved render tree. Do not
// descend into argument/action data or interpret strings as template syntax.
// Charge newly generated text against the resolver's remaining shared budget.
export const mapResolvedCopiedMedia = (tree: unknown, refs: ReadonlyMap<string, string>, budget: { chars: number }): unknown => {
	if (!refs.size) return tree;
	let visits = 0;
	const text = (value: string, css: boolean): string | undefined => {
		const next = css ? mapCssMediaUrls(value, (url) => copiedMediaUrl(url, refs)) : copiedMediaUrl(value, refs);
		if (next === value) return value;
		const growth = Math.max(0, next.length - value.length);
		if (growth > budget.chars) return undefined;
		budget.chars -= growth;
		return next;
	};
	const props = (value: unknown, style = false, depth = 0): unknown => {
		if (++visits > 4000 || depth > 48) return undefined;
		if (typeof value === 'string') return style ? text(value, true) : value;
		if (!value || typeof value !== 'object') return value;
		if (Array.isArray(value)) return style ? value.map((child) => props(child, true, depth + 1)) : value;
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
			style || isRenderMediaStyleProp(key) ? props(child, true, depth + 1) :
			['src', 'poster', 'href'].includes(key) && typeof child === 'string' ? text(child, false) :
			key.startsWith('_') ? props(child, false, depth + 1) : child]));
	};
	const render = (node: unknown, depth = 0): unknown => {
		if (++visits > 4000 || depth > 48) return undefined;
		if (!node || typeof node !== 'object') return node;
		if (Array.isArray(node)) return node.map((child) => render(child, depth + 1));
		const out = { ...node } as Record<string, unknown>;
		if (out.props) out.props = props(out.props);
		for (const key of ['children', 'rawChildren']) if (out[key]) out[key] = render(out[key], depth + 1);
		return out;
	};
	return render(tree);
};
