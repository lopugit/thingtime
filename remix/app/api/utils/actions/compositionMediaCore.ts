// Media capabilities come only from literal first-party URLs in stored render
// positions. Input values, arbitrary metadata and external links are not grants.
export const compositionAttachmentIds = (kinds: string[], crystal: Record<string, any>): Set<string> => {
	const ids = new Set<string>();
	const url = (value: unknown) => {
		if (typeof value !== 'string' || !value.startsWith('/api/v1/attachments/content?') || /[{}$]/.test(value)) return;
		try {
			const parsed = new URL(value, 'https://local.invalid');
			const id = parsed.searchParams.get('id');
			if (parsed.pathname === '/api/v1/attachments/content' && id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) && !parsed.searchParams.has('key') && !parsed.searchParams.has('sharedRoot')) ids.add(id);
		} catch { /* Invalid URLs do not grant access. */ }
	};
	let visited = 0;
	const render = (node: any, depth = 0): void => {
		if (!node || typeof node !== 'object' || depth > 64 || ++visited > 1600) return;
		if (Array.isArray(node)) { node.forEach((child) => render(child, depth + 1)); return; }
		for (const name of ['src', 'poster', 'href']) url(node.props?.[name]);
		for (const child of [node.children, node.rawChildren, node.ttMerge, node.ttIf?.then, node.ttIf?.else, node.ttRepeat?.node, node.ttEach?.node, node.ttEach?.empty, node.ttMap?.default]) render(child, depth + 1);
		if (node.ttMap?.values && typeof node.ttMap.values === 'object') Object.values(node.ttMap.values).forEach((child) => render(child, depth + 1));
	};
	const blocks = (nodes: any, depth = 0): void => {
		if (!Array.isArray(nodes) || depth > 16) return;
		for (const block of nodes) {
			if (!block || typeof block !== 'object') continue;
			if (block.type === 'media') url(block.src);
			if (block.type === 'text') url(block.href);
			if (block.type === 'container') blocks(block.children, depth + 1);
		}
	};
	if (kinds.includes('webpage')) blocks(crystal.blocks);
	if (kinds.includes('component') || kinds.includes('schema')) render(crystal.render);
	return ids;
};
