import { literalAttachmentId, mapCssMediaUrls, mapRenderMediaProps, mapStyleMediaUrls } from '../../../components/Sharing/renderMediaCore';
import { visitAuthoredHtmlMedia } from './authoredHtmlMedia';
import { createTemplateResolver, defaultsFromArgs, sanitizeArgSpecs } from '../../../components/ComponentsLibrary/componentTemplate';

// Media capabilities come only from literal first-party URLs in stored render
// positions. Input values, arbitrary metadata and external links are not grants.
export const compositionAttachmentIds = (kinds: string[], crystal: Record<string, any>): Set<string> => {
	const ids = new Set<string>();
	const url = (value: unknown) => {
		const id = literalAttachmentId(value);
		if (id) ids.add(id);
	};
	const cssUrl = (value: string) => { url(value); return value; };
	const resolveStored = createTemplateResolver({ preserveUnboundTokens: true });
	const storedScope = { ...defaultsFromArgs(sanitizeArgSpecs(crystal.args)),
		...(crystal.savedArgs && typeof crystal.savedArgs === 'object' && !Array.isArray(crystal.savedArgs) ? crystal.savedArgs : {}) };
	let visited = 0;
	const render = (node: any, depth = 0, resolveProps = false): void => {
		if (!node || typeof node !== 'object' || depth > 64 || ++visited > 1600) return;
		if (Array.isArray(node)) { node.forEach((child) => render(child, depth + 1, resolveProps)); return; }
		const props = resolveProps ? resolveStored(node.props, storedScope) as Record<string, unknown> | undefined : node.props;
		for (const name of ['src', 'poster', 'href']) url(props?.[name]);
		if (props && typeof props === 'object') mapRenderMediaProps(props, cssUrl);
		for (const child of [node.children, node.rawChildren, node.ttMerge, node.ttIf?.then, node.ttIf?.else, node.ttRepeat?.node, node.ttEach?.node, node.ttEach?.empty, node.ttMap?.default]) render(child, depth + 1, resolveProps);
		if (node.ttMap?.values && typeof node.ttMap.values === 'object') Object.values(node.ttMap.values).forEach((child) => render(child, depth + 1, resolveProps));
	};
	const blocks = (nodes: any, depth = 0): void => {
		if (!Array.isArray(nodes) || depth > 16) return;
		for (const block of nodes) {
			if (!block || typeof block !== 'object') continue;
			mapStyleMediaUrls(block.css, cssUrl);
			if (block.type === 'media') url(block.src);
			if (block.type === 'text') url(block.href);
			if (block.type === 'text' || block.type === 'html') visitAuthoredHtmlMedia(block.html, url);
			if (block.type === 'container') blocks(block.children, depth + 1);
		}
	};
	if (kinds.includes('webpage')) {
		blocks(crystal.blocks);
		if (typeof crystal.previewBg === 'string') mapCssMediaUrls(crystal.previewBg, cssUrl);
	}
	if (kinds.includes('component') || kinds.includes('schema')) {
		// Keep literal dependencies in every authored branch. Resolve the actual
		// stored state (including repeat indices), then inactive render positions
		// against only persisted args, never query/action/viewer runtime values.
		render(crystal.render);
		if (kinds.includes('component')) {
			render(resolveStored(crystal.render, storedScope));
			render(crystal.render, 0, true);
		}
	}
	return ids;
};
