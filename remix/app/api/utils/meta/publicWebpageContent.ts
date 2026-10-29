import { createTemplateResolver, defaultsFromArgs, sanitizeArgSpecs } from '../../../components/ComponentsLibrary/componentTemplate';
import { componentTextOverrides } from '../../../components/Builder/componentTextOverrides';
import { literalAttachmentId } from '../../../components/Sharing/sharedMediaCore';

export type PublicWebpageContentInput = {
	ok?: boolean;
	page?: { crystal?: unknown } | null;
	components?: Array<{ shareId?: string; id?: string; crystal?: unknown }>;
	refs?: Record<string, string | null>;
};
export type PublicWebpageContent = {
	title: string;
	description: string;
	images: Array<{ attachmentId: string; label: string }>;
	overrides: { title?: string; description?: string };
	truncated: boolean;
};
const record = (value: unknown): Record<string, any> =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);
const reserved = new Set([
	'viewer',
	'query',
	'result',
	'error',
	'installing',
	'installAvailable',
	'hasSource',
	'pending',
	'pendingAction',
	'page',
	'state',
	'last',
	'clock',
	'item',
	'index',
	'n',
	'collection',
	'__proto__',
	'prototype',
	'constructor'
]);
const unresolved = (value: string) => /\{[^{}]+\}/.test(value);
const clean = (value: unknown): string =>
	typeof value === 'string' &&
	!unresolved(value) &&
	!/<[^>]+(?:\shidden(?:[\s=>])|aria-hidden\s*=|display\s*:\s*none|visibility\s*:\s*hidden)/i.test(value)
		? value
				.replace(/<(script|style|template|textarea|select)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<!--[\s\S]*?-->/gi, ' ')
				.replace(/<[^>]*>/g, ' ')
				.replace(
					/&(?:nbsp|amp|lt|gt|quot|apos);/g,
					(entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity] || ' ')
				)
				.replace(/\s+/g, ' ')
				.trim()
		: typeof value === 'number' && Number.isFinite(value)
		? String(value)
		: '';
const args = (...values: unknown[]) => {
	const result: Record<string, string | number | boolean> = Object.create(null);
	for (const value of values)
		for (const [key, entry] of Object.entries(record(value))) {
			if (reserved.has(key) || key.includes('.')) continue;
			if (['string', 'number', 'boolean'].includes(typeof entry) && !(typeof entry === 'string' && unresolved(entry)))
				result[key] = entry as string | number | boolean;
			else delete result[key];
		}
	return result;
};
const hidden = (node: Record<string, any>) => {
	const props = record(node.props),
		css = { ...record(node.css), ...record(props.style) };
	return (
		[props.hidden, props['aria-hidden'], props.display, props.visibility, css.display, css.visibility].some(
			(value) => (typeof value === 'object' && value !== null) || (typeof value === 'string' && unresolved(value))
		) ||
		props.hidden === true ||
		props.hidden === 'true' ||
		props['aria-hidden'] === true ||
		props['aria-hidden'] === 'true' ||
		props.display === 'none' ||
		props.visibility === 'hidden' ||
		css.display === 'none' ||
		css.visibility === 'hidden'
	);
};

/** Input MUST come from resolveWebpage for the anonymous viewer. This function
 * neither reads Things nor executes sources/Actions. The work budget bounds a
 * preview projection; it never limits saved page content. */
export const inferPublicWebpageContent = (input: PublicWebpageContentInput): PublicWebpageContent => {
	const output: PublicWebpageContent = { title: '', description: '', images: [], overrides: {}, truncated: false };
	if (input.ok === false || !input.page) return output;
	const page = record(input.page.crystal);
	const name = clean(page.name),
		description = clean(page.description);
	if (name && !/^untitled(?:\s+page)?$/i.test(name)) output.overrides.title = name;
	if (description) output.overrides.description = description;
	const prose: string[] = [],
		headings: string[] = [];
	const components = new Map((input.components || []).map((component) => [component.shareId || component.id, record(component.crystal)]));
	const resolve = createTemplateResolver({
		preserveUnboundTokens: true,
		onExhausted: () => {
			output.truncated = true;
		}
	});
	let remaining = 4096,
		chars = 32000;
	const ancestors = new Set<object>();
	const spend = (node: unknown, depth: number, work: () => unknown): any => {
		if (--remaining < 0 || depth > 48 || chars <= 0) {
			output.truncated = true;
			return null;
		}
		if (!node || typeof node !== 'object') return work();
		if (ancestors.has(node)) {
			output.truncated = true;
			return null;
		}
		ancestors.add(node);
		try {
			return work();
		} finally {
			ancestors.delete(node);
		}
	};
	const known = (path: unknown, scope: Record<string, unknown>) =>
		typeof path === 'string' && !path.includes('.') && !reserved.has(path) && own(scope, path);
	// Preserve only display syntax. Runtime selectors are unknown rather than
	// false: neither branch may be advertised as the anonymous presentation.
	const template = (raw: unknown, scope: Record<string, unknown>, depth = 0): any =>
		spend(raw, depth, () => {
			if (typeof raw === 'string') {
				chars -= raw.length;
				return raw;
			}
			if (typeof raw === 'number' || typeof raw === 'boolean' || raw == null) return raw;
			if (Array.isArray(raw)) return raw.map((child) => template(child, scope, depth + 1));
			const node = record(raw);
			if ('ttArg' in node) return known(node.ttArg, scope) || known(node.fallback, scope) ? node : null;
			for (const operator of ['ttIf', 'ttMap', 'ttFormat', 'ttRepeat'])
				if (operator in node) {
					const spec = record(node[operator]);
					if (
						(operator !== 'ttRepeat' && !known(spec.arg, scope)) ||
						(operator === 'ttRepeat' && spec.arg !== undefined && !known(spec.arg, scope)) ||
						(operator === 'ttFormat' && spec.kind === 'elapsed')
					)
						return null;
					return {
						[operator]: Object.fromEntries(
							Object.entries(spec).map(([key, value]) => [
								key,
								['then', 'else', 'node', 'default'].includes(key)
									? template(value, scope, depth + 1)
									: key === 'values'
									? Object.fromEntries(Object.entries(record(value)).map(([label, child]) => [label, template(child, scope, depth + 1)]))
									: value
							])
						)
					};
				}
			if ('ttMerge' in node)
				return { ttMerge: Array.isArray(node.ttMerge) ? node.ttMerge.map((part: unknown) => template(part, scope, depth + 1)) : [] };
			if (Object.keys(node).some((key) => key.startsWith('tt') && !['ttAction', 'ttActionInputs', 'ttActionRefs', 'ttMediaRefs'].includes(key)))
				return null;
			if (!node.tag && !node.chakra) return null;
			const props = record(node.props);
			const presentationKnown = (value: unknown, level = 0): boolean => {
				if (level > 8) return false;
				if (typeof value === 'string') return Array.from(value.matchAll(/\{([^{}]+)\}/g)).every((match) => known(match[1], scope));
				if (!value || typeof value !== 'object') return true;
				const expression = record(value);
				if ('ttArg' in expression && !known(expression.ttArg, scope)) return false;
				for (const operator of ['ttIf', 'ttMap', 'ttFormat'])
					if (operator in expression && !known(record(expression[operator]).arg, scope)) return false;
				return Object.values(expression).every((child) => presentationKnown(child, level + 1));
			};
			if (
				![
					props.as,
					props.hidden,
					props['aria-hidden'],
					props.display,
					props.visibility,
					record(props.style).display,
					record(props.style).visibility,
					record(node.css).display,
					record(node.css).visibility
				].every((value) => presentationKnown(value))
			)
				return null;
			return {
				tag: node.tag || node.chakra,
				css: Object.fromEntries(
					['display', 'visibility']
						.filter((property) => own(record(node.css), property))
						.map((property) => [property, template(node.css[property], scope, depth + 1)])
				),
				props: Object.fromEntries(
					['as', 'src', 'alt', 'hidden', 'aria-hidden', 'display', 'visibility', 'style']
						.filter((key) => own(props, key))
						.map((key) => [
							key,
							key === 'style'
								? Object.fromEntries(
										['display', 'visibility']
											.filter((property) => own(record(props.style), property))
											.map((property) => [property, template(props.style[property], scope, depth + 1)])
								  )
								: template(props[key], scope, depth + 1)
						])
				),
				children: template(node.children ?? node.rawChildren, scope, depth + 1)
			};
		});
	const add = (value: unknown, heading = false) => {
		const text = clean(value);
		if (!text || chars <= 0) return;
		chars -= text.length;
		(heading ? headings : prose).push(text);
	};
	const image = (src: unknown, label: unknown) => {
		const id = literalAttachmentId(src);
		if (id && !output.images.some((entry) => entry.attachmentId === id)) output.images.push({ attachmentId: id, label: clean(label) || 'Photo' });
	};
	const rendered = (raw: unknown, heading = false, depth = 0): void => {
		spend(raw, depth, () => {
			if (Array.isArray(raw)) {
				for (const child of raw) rendered(child, heading, depth + 1);
				return;
			}
			if (typeof raw === 'string' || typeof raw === 'number') {
				add(raw, heading);
				return;
			}
			const node = record(raw),
				props = record(node.props),
				tag = String(props.as || node.tag || '').toLowerCase();
			if (hidden(node) || ['script', 'style', 'template', 'noscript', 'iframe', 'input', 'textarea', 'select'].includes(tag) || tag.startsWith('tt-'))
				return;
			if (!heading && (/^h[1-6]$/.test(tag) || tag === 'heading') && headings.length) return;
			if (tag === 'img' || tag === 'image') image(props.src, props.alt);
			rendered(node.children, heading || /^h[1-6]$/.test(tag) || tag === 'heading', depth + 1);
		});
	};
	const blocks = (raw: unknown, scope: Record<string, unknown> = {}, depth = 0): void => {
		spend(raw, depth, () => {
			if (!Array.isArray(raw)) return;
			for (const entry of raw) {
				if (remaining <= 0) break;
				const node = record(entry);
				if (hidden(node)) continue;
				// SourceBlock installs a fresh ComponentDataScope rather than merging
				// its parent's args. Plain descendants retain the existing scope.
				const local = node.args || node.source ? args(node.args) : scope;
				if (node.type === 'condition') {
					const condition = record(node.condition);
					if (!known(condition.arg, local)) continue;
					const matches = resolve({ ttIf: { ...condition, then: true, else: false } }, local) === true;
					if (matches === !!condition.negate) continue;
				}
				if (node.type === 'component') {
					const ref = typeof node.component === 'string' ? input.refs?.[node.component] : null;
					const component = ref ? components.get(ref) : undefined;
					if (!component) continue;
					const values = args(defaultsFromArgs(sanitizeArgSpecs(component.args)), component.savedArgs, node.args);
					try {
						const authored = componentTextOverrides(component.render, record(node.args)).render;
						rendered(resolve(template(authored, values), values), false, depth + 1);
					} catch {
						// A malformed legacy tree cannot escape the preview boundary.
						output.truncated = true;
					}
				} else if (node.type === 'media' && node.media === 'image') image(node.src, node.alt);
				else if (['text', 'html', 'element'].includes(node.type)) {
					if (node.type === 'element')
						rendered(
							resolve(template({ tag: node.tag, props: node.props, children: node.text || node.html }, local), local),
							node.style === 'heading',
							depth + 1
						);
					else {
						const heading = node.style === 'heading' || /^h[1-6]$/.test(node.tag || '');
						if (!heading || !headings.length) add(node.html || node.text, heading);
					}
				}
				if (['container', 'condition', 'text', 'html', 'element'].includes(node.type)) blocks(node.children, local, depth + 1);
			}
		});
	};
	blocks(page.blocks);
	output.title = headings.join(' ').trim();
	output.description = prose.join(' ').trim();
	return output;
};
