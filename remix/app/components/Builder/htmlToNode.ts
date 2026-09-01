import type { HtmlThingNode } from '../Kinds/HtmlThingRenderer';

// Browser-side HTML → HtmlThingNode parser for builder blocks that carry
// authored markup (rich WYSIWYG text, raw html blocks). This is a STRUCTURE
// converter, not the security boundary: everything it produces is rendered
// exclusively through HtmlThingRenderer, whose allowlist (tags, props, urls,
// object-form styles, no event handlers) is the authority. The parser only
// pre-drops the containers that could never render anything useful.

const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'noscript', 'template']);

const styleTextToObject = (el: HTMLElement): Record<string, string> | undefined => {
	const style = el.style;
	if (!style || !style.length) return undefined;
	const out: Record<string, string> = {};
	for (let index = 0; index < style.length; index += 1) {
		const prop = style.item(index);
		const value = style.getPropertyValue(prop);
		if (!value) continue;
		const key = prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
		out[key] = value;
	}
	return Object.keys(out).length ? out : undefined;
};

const elementToNode = (el: Element): HtmlThingNode | null => {
	const tag = el.tagName.toLowerCase();
	if (DROP_TAGS.has(tag)) return null;
	const props: Record<string, unknown> = {};
	for (const attr of Array.from(el.attributes)) {
		const name = attr.name.toLowerCase();
		if (name === 'style') continue;
		// authored markup must not mint tt-action bindings — those attributes
		// are allowlisted downstream ONLY for trusted component templates, and
		// a page's html block runs with the VIEWER's click, not the author's
		if (name.startsWith('data-tt-')) continue;
		if (name.startsWith('on')) continue;
		props[name] = attr.value;
	}
	const style = styleTextToObject(el as HTMLElement);
	if (style) props.style = style;
	const children: HtmlThingNode[] = [];
	el.childNodes.forEach((child) => {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || '';
			if (text) children.push(text);
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			const node = elementToNode(child as Element);
			if (node !== null) children.push(node);
		}
	});
	return {
		tag,
		...(Object.keys(props).length ? { props } : {}),
		...(children.length ? { children } : {})
	};
};

export const htmlToNode = (html: string): HtmlThingNode | null => {
	if (!html || typeof window === 'undefined' || typeof DOMParser === 'undefined') return null;
	try {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const body = doc.body;
		if (!body) return null;
		const children: HtmlThingNode[] = [];
		body.childNodes.forEach((child) => {
			if (child.nodeType === Node.TEXT_NODE) {
				const text = child.textContent || '';
				if (text) children.push(text);
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				const node = elementToNode(child as Element);
				if (node !== null) children.push(node);
			}
		});
		if (!children.length) return null;
		return { tag: 'div', children };
	} catch {
		return null;
	}
};
