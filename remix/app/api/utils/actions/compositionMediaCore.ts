import { literalAttachmentId, mapCssMediaUrls, mapRenderMediaProps, mapStyleMediaUrls } from '../../../components/Sharing/renderMediaCore';

// Media capabilities come only from literal first-party URLs in stored render
// positions. Input values, arbitrary metadata and external links are not grants.
export const compositionAttachmentIds = (kinds: string[], crystal: Record<string, any>): Set<string> => {
	const ids = new Set<string>();
	const url = (value: unknown) => {
		const id = literalAttachmentId(value);
		if (id) ids.add(id);
	};
	const cssUrl = (value: string) => { url(value); return value; };
	let visited = 0;
	const render = (node: any, depth = 0): void => {
		if (!node || typeof node !== 'object' || depth > 64 || ++visited > 1600) return;
		if (Array.isArray(node)) { node.forEach((child) => render(child, depth + 1)); return; }
		for (const name of ['src', 'poster', 'href']) url(node.props?.[name]);
		if (node.props && typeof node.props === 'object') mapRenderMediaProps(node.props, cssUrl);
		for (const child of [node.children, node.rawChildren, node.ttMerge, node.ttIf?.then, node.ttIf?.else, node.ttRepeat?.node, node.ttEach?.node, node.ttEach?.empty, node.ttMap?.default]) render(child, depth + 1);
		if (node.ttMap?.values && typeof node.ttMap.values === 'object') Object.values(node.ttMap.values).forEach((child) => render(child, depth + 1));
	};
	const blocks = (nodes: any, depth = 0): void => {
		if (!Array.isArray(nodes) || depth > 16) return;
		for (const block of nodes) {
			if (!block || typeof block !== 'object') continue;
			mapStyleMediaUrls(block.css, cssUrl);
			if (block.type === 'media') url(block.src);
			if (block.type === 'text') url(block.href);
			if (block.type === 'container') blocks(block.children, depth + 1);
		}
	};
	if (kinds.includes('webpage')) {
		blocks(crystal.blocks);
		if (typeof crystal.previewBg === 'string') mapCssMediaUrls(crystal.previewBg, cssUrl);
	}
	if (kinds.includes('component') || kinds.includes('schema')) render(crystal.render);
	return ids;
};
