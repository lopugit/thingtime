const PREFIX = 'ttLabel_';
type Label = { key: string; text: string };
// Per-block literal labels live in the existing scalar args map. Templates
// and library components stay untouched; dynamic result/query tokens are never
// converted into authored content. A changed template invalidates old keys.
export function componentTextOverrides(render: unknown, args: Record<string, unknown> = {}, editing = false) {
	const labels: Label[] = [];
	let visited = 0;
	const walk = (node: any, path: string): any => {
		if (++visited > 6000 || !node || typeof node !== 'object') return node;
		if (Array.isArray(node)) return node.map((child, index) => walk(child, `${path}_${index}`));
		const childKey = node.children == null && node.rawChildren != null ? 'rawChildren' : 'children';
		const children = node[childKey];
		const literal =
			typeof children === 'string'
				? children
				: Array.isArray(children) && children.length === 1 && typeof children[0] === 'string'
				? children[0]
				: null;
		const out = { ...node };
		if (
			(typeof node.tag === 'string' || typeof node.type === 'string' || typeof node.chakra === 'string') &&
			literal?.trim() &&
			!/[{}]/.test(literal)
		) {
			let hash = 2166136261;
			for (const char of `${path}:${literal}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
			const key = `${PREFIX}${labels.length}_${hash.toString(36)}`;
			const value = typeof args[key] === 'string' ? (args[key] as string) : literal;
			labels.push({ key, text: value });
			// Args resolve as data once, so typed braces cannot become template code.
			const child = typeof args[key] === 'string' ? { ttArg: key } : literal;
			out[childKey] = Array.isArray(children) ? [child] : child;
			if (editing) out.props = { ...node.props, 'data-tt-label-key': key };
			return out;
		}
		for (const key of Object.keys(out)) if (key !== 'props') out[key] = walk(out[key], `${path}_${key}`);
		return out;
	};
	return { render: walk(render, 'root'), labels };
}
