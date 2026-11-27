import type { HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { authoredHtmlPropName, HTML_MAX_DEPTH, HTML_MAX_NODES, HTML_MARKUP_DROP_TAGS as DROP_TAGS } from '../Kinds/htmlRenderPolicy';

// Browser-side HTML → HtmlThingNode parser for builder blocks that carry
// authored markup (rich WYSIWYG text, raw html blocks). This is a STRUCTURE
// converter, not the security boundary: everything it produces is rendered
// exclusively through HtmlThingRenderer, whose allowlist (tags, props, urls,
// object-form styles, no event handlers) is the authority. The parser only
// pre-drops the containers that could never render anything useful.

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

const elementToNode = (el: Element, depth: number, state: { count: number }): HtmlThingNode | null => {
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
		props[authoredHtmlPropName(name)] = attr.value;
	}
	const style = styleTextToObject(el as HTMLElement);
	if (style) props.style = style;
	const children = childNodes(el, depth + 1, state);
	return {
		tag,
		...(Object.keys(props).length ? { props } : {}),
		...(children.length ? { children } : {})
	};
};

function childNodes(parent: ParentNode, depth: number, state: { count: number }): HtmlThingNode[] {
 if (depth > HTML_MAX_DEPTH) return [];
 const children: HtmlThingNode[] = [];
 for (let child = parent.firstChild; child && state.count < HTML_MAX_NODES; child = child.nextSibling) {
  if (child.nodeType === Node.TEXT_NODE) {
   const text = child.textContent || '';
   if (text) { state.count++; children.push(text); }
  } else if (child.nodeType === Node.ELEMENT_NODE) {
   if (DROP_TAGS.has((child as Element).tagName.toLowerCase())) continue;
   state.count++;
   const node = elementToNode(child as Element, depth, state);
   if (node !== null) children.push(node);
  }
 }
 return children;
}

export const htmlToNode = (html: string): HtmlThingNode | null => {
 if (!html || typeof DOMParser === 'undefined') return null;
 try {
  const document = new DOMParser().parseFromString(html, 'text/html');
  if (!document.body) return null;
  const children = childNodes(document.body, 1, { count: 1 });
  return children.length ? { tag: 'div', children } : null;
 } catch {
  return null;
 }
};
