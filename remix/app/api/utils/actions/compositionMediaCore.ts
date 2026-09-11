import { literalAttachmentId, mapCssMediaUrls, isRenderMediaStyleProp, mapStyleMediaUrls } from '../../../components/Sharing/renderMediaCore';
import { visitAuthoredHtmlMedia } from './authoredHtmlMedia';
import { createTemplateResolver, defaultsFromArgs, MAX_RESOLVED_NODES, sanitizeArgSpecs } from '../../../components/ComponentsLibrary/componentTemplate';
import { copiedMediaRefs, copiedMediaUrl } from '../../../components/Sharing/copiedMediaRefs';

// Media capabilities come only from literal first-party URLs in stored render
// positions. Input values, arbitrary metadata and external links are not grants.
export type CompositionMediaOptions = {
	args?: Record<string, unknown>;
	component?: (ref: string) => Record<string, any> | undefined;
};

export const compositionAttachmentIds = (kinds: string[], crystal: Record<string, any>, options: CompositionMediaOptions = {}): Set<string> => {
	const ids = new Set<string>();
	const rootRefs = kinds.includes('component') ? copiedMediaRefs(crystal.render?.ttMediaRefs) : new Map<string, string>();
	let resolvedRoot = true;
	const url = (value: unknown) => {
		const id = literalAttachmentId(typeof value === 'string' && !resolvedRoot ? copiedMediaUrl(value, rootRefs) : value);
		if (id) ids.add(id);
	};
	const cssUrl = (value: string) => { url(value); return value; };
	const resolveStored = createTemplateResolver({ preserveUnboundTokens: true });
	const storedScope = { ...defaultsFromArgs(sanitizeArgSpecs(crystal.args)),
		...(crystal.savedArgs && typeof crystal.savedArgs === 'object' && !Array.isArray(crystal.savedArgs) ? crystal.savedArgs : {}), ...options.args };
	let visited = 0;
	let propertyVisits = 0;
	type Mode = 'literal' | 'stored' | 'resolved';
	type Position = 'props' | 'style' | 'url';
	// A wrapper can occupy the whole props record or any individual media
	// value. Follow only output branches, keeping their rendering position;
	// condition operands, map keys and arbitrary metadata are never outputs.
	const mediaValue = (value: any, position: Position, mode: Mode, depth = 0): void => {
		if (depth > 48 || ++propertyVisits > MAX_RESOLVED_NODES) return;
		if (typeof value === 'string') {
			const text = mode === 'stored' ? resolveStored(value, storedScope) : value;
			if (position === 'url') url(text);
			else if (position === 'style' && typeof text === 'string') mapCssMediaUrls(text, cssUrl);
			return;
		}
		if (!value || typeof value !== 'object') return;
		const visit = (child: unknown) => mediaValue(child, position, mode, depth + 1);
		if (Array.isArray(value)) {
			if (position === 'style') for (const child of value) { if (propertyVisits >= MAX_RESOLVED_NODES) break; visit(child); }
			return;
		}
		if (mode !== 'resolved') {
			// Match template precedence; ttArg values are data, not fresh syntax.
			if ('ttArg' in value || (!('ttMap' in value) && !('ttIf' in value) && 'ttFormat' in value)) {
				if (mode === 'stored') mediaValue(resolveStored(value, storedScope), position, 'resolved', depth + 1);
				return;
			}
			if ('ttMap' in value) {
				visit(value.ttMap?.default);
				if (value.ttMap?.values && typeof value.ttMap.values === 'object' && !Array.isArray(value.ttMap.values)) {
					for (const child of Object.values(value.ttMap.values)) { if (propertyVisits >= MAX_RESOLVED_NODES) break; visit(child); }
				}
				return;
			}
			if ('ttIf' in value) { visit(value.ttIf?.then); visit(value.ttIf?.else); return; }
			if ('ttMerge' in value) {
				if (position !== 'url' && Array.isArray(value.ttMerge)) for (const part of value.ttMerge) {
					if (propertyVisits >= MAX_RESOLVED_NODES) break;
					if (part && typeof part === 'object' && !Array.isArray(part)) visit(part);
				}
				return;
			}
			if ('ttRepeat' in value) { if (position === 'style') visit(value.ttRepeat?.node); return; }
			if ('ttEach' in value) { if (position === 'style') visit(value.ttEach?.node); visit(value.ttEach?.empty); return; }
		}
		for (const [key, child] of Object.entries(value)) {
			if (propertyVisits >= MAX_RESOLVED_NODES) break;
			if (position === 'style') visit(child);
			else if (position === 'props') {
				if (['src', 'poster', 'href'].includes(key)) mediaValue(child, 'url', mode, depth + 1);
				else if (isRenderMediaStyleProp(key)) mediaValue(child, 'style', mode, depth + 1);
				else if (key.startsWith('_')) visit(child);
			}
		}
	};
	const render = (node: any, depth = 0, mode: Mode = 'literal'): void => {
		if (!node || typeof node !== 'object' || depth > 64 || ++visited > 1600) return;
		if (Array.isArray(node)) { node.forEach((child) => render(child, depth + 1, mode)); return; }
		mediaValue(node.props, 'props', mode);
		for (const child of [node.children, node.rawChildren, node.ttMerge, node.ttIf?.then, node.ttIf?.else, node.ttRepeat?.node, node.ttEach?.node, node.ttEach?.empty, node.ttMap?.default]) render(child, depth + 1, mode);
		if (node.ttMap?.values && typeof node.ttMap.values === 'object') Object.values(node.ttMap.values).forEach((child) => render(child, depth + 1, mode));
	};
	const blocks = (nodes: any, depth = 0): void => {
		if (!Array.isArray(nodes) || depth > 16) return;
		for (const block of nodes) {
			if (!block || typeof block !== 'object') continue;
			if (++visited > 1600) return;
			mapStyleMediaUrls(block.css, cssUrl);
			if (block.type === 'media') url(block.src);
			if (block.type === 'text') url(block.href);
			if (block.type === 'text' || block.type === 'html') visitAuthoredHtmlMedia(block.html, url);
			if (block.type === 'component' && typeof block.component === 'string') {
				const component = options.component?.(block.component);
				if (component) {
					const args = block.args && typeof block.args === 'object' && !Array.isArray(block.args) ? block.args : {};
					for (const id of compositionAttachmentIds(['component'], component, { args })) ids.add(id);
				}
			}
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
		resolvedRoot = false;
		render(crystal.render);
		if (kinds.includes('component')) {
			render(crystal.render, 0, 'stored');
			// The full resolver already applied root bindings once. Partial props
			// resolution above did not; applying twice would change authored chains.
			resolvedRoot = true;
			render(resolveStored(crystal.render, storedScope), 0, 'resolved');
		}
	}
	return ids;
};
