import { visitStoredBlocks, iterateStoredBlocks, storedComponentScope } from './sharedCompositionCore';
import { literalAttachmentId, mapCssMediaUrls, isRenderMediaStyleProp, mapStyleMediaUrls } from '../../../components/Sharing/renderMediaCore';
import { visitAuthoredHtmlMedia } from './authoredHtmlMedia';
import {
	createTemplateResolver,
	defaultsFromArgs,
	MAX_RESOLVED_NODES,
	sanitizeArgSpecs
} from '../../../components/ComponentsLibrary/componentTemplate';
import { iterateStoredTemplateNodes, componentScopeValue, storedReferenceText, StoredReferenceUnsupportedError } from '../../../components/ComponentsLibrary/componentTemplate';
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
	const cssUrl = (value: string) => {
		url(value);
		return value;
	};
	const resolveStored = createTemplateResolver({ preserveUnboundTokens: true });
	const storedScope = {
		...defaultsFromArgs(sanitizeArgSpecs(crystal.args)),
		...(crystal.savedArgs && typeof crystal.savedArgs === 'object' && !Array.isArray(crystal.savedArgs) ? crystal.savedArgs : {}),
		...options.args
	};
	let visited = 0;
	let propertyVisits = 0;
	type Mode = 'literal' | 'stored' | 'resolved';
	type Position = 'props' | 'style' | 'url';
	// A wrapper can occupy the whole props record or any individual media
	// value. Follow only output branches, keeping their rendering position;
	// condition operands, map keys and arbitrary metadata are never outputs.
	const mediaValue = (value: any, position: Position, mode: Mode, depth = 0, scope = storedScope): void => {
		if (depth > 48 || ++propertyVisits > MAX_RESOLVED_NODES) return;
		if (typeof value === 'string') {
			const text = mode === 'stored' ? resolveStored(value, scope) : value;
			if (position === 'url') url(text);
			else if (position === 'style' && typeof text === 'string') mapCssMediaUrls(text, cssUrl);
			return;
		}
		if (!value || typeof value !== 'object') return;
		const visit = (child: unknown) => mediaValue(child, position, mode, depth + 1, scope);
		if (Array.isArray(value)) {
			if (position === 'style')
				for (const child of value) {
					if (propertyVisits >= MAX_RESOLVED_NODES) break;
					visit(child);
				}
			return;
		}
		if (mode !== 'resolved') {
			// Match template precedence; ttArg values are data, not fresh syntax.
			if ('ttArg' in value || (!('ttMap' in value) && !('ttIf' in value) && 'ttFormat' in value)) {
				if (mode === 'stored') mediaValue(resolveStored(value, scope), position, 'resolved', depth + 1, scope);
				return;
			}
			if ('ttMap' in value) {
				visit(value.ttMap?.default);
				if (value.ttMap?.values && typeof value.ttMap.values === 'object' && !Array.isArray(value.ttMap.values)) {
					for (const child of Object.values(value.ttMap.values)) {
						if (propertyVisits >= MAX_RESOLVED_NODES) break;
						visit(child);
					}
				}
				return;
			}
			if ('ttIf' in value) {
				visit(value.ttIf?.then);
				visit(value.ttIf?.else);
				return;
			}
			if ('ttMerge' in value) {
				if (position !== 'url' && Array.isArray(value.ttMerge))
					for (const part of value.ttMerge) {
						if (propertyVisits >= MAX_RESOLVED_NODES) break;
						if (part && typeof part === 'object' && !Array.isArray(part)) visit(part);
					}
				return;
			}
			if ('ttRepeat' in value) {
				if (position === 'style') visit(value.ttRepeat?.node);
				return;
			}
			if ('ttEach' in value) {
				if (position === 'style') visit(value.ttEach?.node);
				visit(value.ttEach?.empty);
				return;
			}
		}
		for (const [key, child] of Object.entries(value)) {
			if (propertyVisits >= MAX_RESOLVED_NODES) break;
			if (position === 'style') visit(child);
			else if (position === 'props') {
				if (['src', 'poster', 'href'].includes(key)) mediaValue(child, 'url', mode, depth + 1, scope);
				else if (isRenderMediaStyleProp(key)) mediaValue(child, 'style', mode, depth + 1, scope);
				else if (key.startsWith('_')) visit(child);
			}
		}
	};
	const render = (node: any, depth = 0, mode: Mode = 'literal', scope = storedScope): void => {
		if (!node || typeof node !== 'object' || depth > 64 || ++visited > 1600) return;
		if (Array.isArray(node)) {
			node.forEach((child) => render(child, depth + 1, mode, scope));
			return;
		}
		mediaValue(node.props, 'props', mode, 0, scope);
		if (node.tag === 'tt-collection' || node.chakra === 'Collection') {
			const row = node.props?.itemTemplate;
			const previousResolved = resolvedRoot;
			// Deferred row syntax is resolved in its own pass. Runtime row data
			// never supplies a stored media grant, even if args reuse those names.
			resolvedRoot = false;
			render(row && typeof row === 'object' && 'ttTemplate' in row ? row.ttTemplate : row, depth + 1, mode === 'resolved' ? 'stored' : mode, {
				...scope,
				item: undefined,
				index: undefined
			});
			resolvedRoot = previousResolved;
		}
		for (const child of [
			node.children,
			node.rawChildren,
			node.ttMerge,
			node.ttIf?.then,
			node.ttIf?.else,
			node.ttRepeat?.node,
			node.ttEach?.node,
			node.ttEach?.empty,
			node.ttMap?.default
		])
			render(child, depth + 1, mode, scope);
		if (node.ttMap?.values && typeof node.ttMap.values === 'object')
			Object.values(node.ttMap.values).forEach((child) => render(child, depth + 1, mode, scope));
	};
	const blocks = (nodes: unknown): void => visitStoredBlocks(nodes, (block,scope) => {
   // Each validated block has its own render-expression budget. The page tree
   // must never silently drop dependencies after an unrelated sibling.
   visited = 0; propertyVisits = 0;
   mapStyleMediaUrls(block.css,cssUrl);
   if (block.type === 'media') url(block.src);
   if (block.type === 'text') url(block.href);
   if (block.type === 'text' || block.type === 'html') visitAuthoredHtmlMedia(block.html,url);
   if (block.type === 'component' && typeof block.component === 'string') {
    const component=options.component?.(block.component);
    if(component) for(const id of compositionAttachmentIds(['component'],component,{args:block.args})) ids.add(id);
   }
   if(block.type === 'element') {
    render({tag:block.tag,props:block.props});
    render({tag:block.tag,props:block.props},0,'stored',scope);
   }
 });
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

/** Worker media discovery over stored output positions. The complete source
 * record is bounded by storage; the iterator never expands a resolved render
 * tree or applies preview budgets to a saved backup. IDs are observations only,
 * never grants; the capture adapter must resolve owner/target/version itself. */
export function* iterateStoredCompositionMedia(kinds: string[], crystal: Record<string, any>, options: { args?: Record<string, unknown>; signal?: AbortSignal } = {}): Generator<string | null> {
	const scope = storedComponentScope(crystal, options.args);
	const copied = kinds.includes('component') ? copiedMediaRefs(crystal.render?.ttMediaRefs, true) : new Map<string, string>();
	const urlId = (value: unknown) => {
		if (typeof value !== 'string') return null;
		if (value.startsWith('/api/v1/attachments/content?') && /[{}$]/.test(value)) throw new StoredReferenceUnsupportedError('Runtime-dependent stored media reference');
		const id = literalAttachmentId(copiedMediaUrl(value, copied));
		if (!id && value.startsWith('/api/v1/attachments/content?')) throw new StoredReferenceUnsupportedError('Stored media identity is outside the supported unkeyed reference protocol');
		return id;
	};
	type Position = 'props' | 'style' | 'url';
	function* values(root: unknown, position: Position, current: Record<string, unknown>, opaque = false): Generator<string | null> {
		const stack: Iterator<{ value: any; position: Position; opaque: boolean }>[] = [];
		const one = function* (value: unknown, position: Position, opaque: boolean) { yield { value, position, opaque }; };
		stack.push(one(root, position, opaque));
		while (stack.length) {
			options.signal?.throwIfAborted();
			const next = stack[stack.length - 1].next();
			if (next.done) { stack.pop(); continue; }
			yield null;
			const { value, position: at, opaque: resolved } = next.value;
			if (typeof value === 'string') {
				// Arguments are values, never fresh template syntax.
				// Repeated scalar interpolation can amplify one small stored value
				// into an enormous string. Until a streaming scalar URL/CSS adapter
				// exists, mark that format unsupported instead of allocating it or
				// certifying a resolver-truncated prefix as complete media coverage.
				if (!resolved) {
					const tokens = new Set<string>();
					for (const match of value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)\}/g)) {
						if (tokens.has(match[1])) throw new StoredReferenceUnsupportedError('Repeated media interpolation needs a streaming scalar adapter');
						tokens.add(match[1]);
					}
				}
				const text = resolved ? value : storedReferenceText(value, current, Infinity);
				if (at === 'url') { const id = urlId(text); if (id) yield id; }
				if (at === 'style') {
					const ids: string[] = [];
					try { mapCssMediaUrls(text, url => { const id = urlId(url); if (id) ids.push(id); return url; }, { stored: true, signal: options.signal }); }
					catch { options.signal?.throwIfAborted(); throw new StoredReferenceUnsupportedError('Stored CSS media cannot be fully decoded'); }
					yield* ids;
				}
				continue;
			}
			if (!value || typeof value !== 'object') continue;
			const children = function* () {
				if (Array.isArray(value)) { if (at === 'style') for (const child of value) yield* one(child, at, resolved); return; }
				if (!resolved) {
					if ('ttArg' in value) {
						const selected = componentScopeValue(current, String(value.ttArg));
						if (selected === undefined) throw new StoredReferenceUnsupportedError('Runtime-dependent stored media value');
						yield* one(selected, at, true); return;
					}
					if ('ttMap' in value) {
						yield* one(value.ttMap?.default, at, false);
						if (value.ttMap?.values && typeof value.ttMap.values === 'object') for (const key of Object.keys(value.ttMap.values)) yield* one(value.ttMap.values[key], at, false);
						return;
					}
					if ('ttIf' in value) { yield* one(value.ttIf?.then, at, false); yield* one(value.ttIf?.else, at, false); return; }
					if ('ttFormat' in value) throw new StoredReferenceUnsupportedError('Formatted media needs an exact output adapter');
					if ('ttMerge' in value) throw new StoredReferenceUnsupportedError('Stored media merge needs an exact output adapter');
					if ('ttRepeat' in value || 'ttEach' in value) throw new StoredReferenceUnsupportedError('Stored media value repetition needs an exact output adapter');
				}
				for (const key of Object.keys(value)) {
					if (at === 'style') yield* one(value[key], at, resolved);
					else if (at === 'props') {
						if (['src', 'poster', 'href'].includes(key)) yield* one(value[key], 'url', resolved);
						else if (isRenderMediaStyleProp(key)) yield* one(value[key], 'style', resolved);
						else if (key.startsWith('_')) yield* one(value[key], at, resolved);
					}
				}
			};
			stack.push(children());
		}
	}
	function* render(root: unknown, current: Record<string, unknown>) {
		for (const step of iterateStoredTemplateNodes(root, current, options.signal)) {
			if (!step) { yield null; continue; }
			const { node, scope, opaque } = step;
			if (!opaque && ['ttArg', 'ttMap', 'ttIf', 'ttFormat', 'ttMerge', 'ttRepeat', 'ttEach'].some(key => key in node)) continue;
			yield* values(node.props, 'props', scope, opaque);
		}
	}
	if (kinds.includes('webpage')) {
		for (const step of iterateStoredBlocks(crystal.blocks, options.signal)) {
			if (!step) { yield null; continue; }
			const { block, scope } = step;
			yield* values(block.css, 'style', scope, true);
			if (block.type === 'media') { const id = urlId(block.src); if (id) yield id; }
			if (block.type === 'text') { const id = urlId(block.href); if (id) yield id; }
			if (block.type === 'text' || block.type === 'html') {
				const ids: string[] = [];
				try { visitAuthoredHtmlMedia(block.html, url => { const id = urlId(url); if (id) ids.push(id); }, { stored: true, signal: options.signal }); }
				catch { options.signal?.throwIfAborted(); throw new StoredReferenceUnsupportedError('Stored HTML media cannot be fully decoded'); }
				yield* ids;
			}
			if (block.type === 'element') yield* render({ tag: block.tag, props: block.props }, scope);
		}
		yield* values(crystal.previewBg, 'style', {}, true);
	}
	if (kinds.includes('component') || kinds.includes('schema')) yield* render(crystal.render, scope);
}
