import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { parse as parseCss } from 'postcss';
import { MAX_WEBPAGE_HTML_CHARS } from '../../../schemas/registry';
import { HTML_ALLOWED_TAGS, HTML_MARKUP_DROP_TAGS, HTML_VOID_TAGS, HTML_MAX_NODES, HTML_MAX_DEPTH } from '../../../components/Kinds/htmlRenderPolicy';
import { isSafeCssText } from '../../../components/Kinds/safeUrl';
import { mapCssMediaUrls } from '../../../components/Sharing/renderMediaCore';

const visitStyleMedia = (style: string, visitUrl: (url: string) => void): void => {
	try {
		// A style attribute is a declaration list, never a stylesheet. Do not
		// traverse nested rules/at-rules, and screen each value as the renderer
		// does so one rejected declaration cannot hide a safe sibling image.
		const declarations = parseCss(style, { from: undefined });
		for (const declaration of declarations.nodes) {
			if (declaration.type !== 'decl' || !isSafeCssText(declaration.value)) continue;
			mapCssMediaUrls(declaration.value, (url) => { visitUrl(url); return url; });
		}
	} catch { /* Malformed declaration lists grant nothing. */ }
};

// Parse authored markup as HTML, not with a URL regex: entities, comments,
// raw-text containers and browser tree repair determine rendering positions.
// This is dependency discovery, not a replacement for renderer sanitization.
export const visitAuthoredHtmlMedia = (html: unknown, visitUrl: (url: string) => void): void => {
	if (typeof html !== 'string' || !html || html.length > MAX_WEBPAGE_HTML_CHARS) return;
	// Match DOMParser.parseFromString: the detached document has scripting
	// disabled (not parse5's default), which changes noscript tree repair.
	const document = parse(html, { scriptingEnabled: false });
	const htmlElement = document.childNodes.find((node): node is DefaultTreeAdapterMap['element'] => 'tagName' in node && node.tagName === 'html');
	const body = htmlElement?.childNodes.find((node): node is DefaultTreeAdapterMap['element'] => 'tagName' in node && node.tagName === 'body');
	if (!body) return;
	// htmlToNode adds one wrapper div before HtmlThingRenderer applies its cap.
	let visited = 1;
	const walk = (node: DefaultTreeAdapterMap['childNode'], depth: number): void => {
		if (visited >= HTML_MAX_NODES || depth > HTML_MAX_DEPTH) return;
		if (node.nodeName === '#text') { visited += 1; return; }
		if (!('tagName' in node) || HTML_MARKUP_DROP_TAGS.has(node.tagName)) return;
		visited += 1;
		if (HTML_ALLOWED_TAGS.has(node.tagName)) {
			for (const attr of node.attrs) {
				if (attr.namespace) continue;
				if (['src', 'poster', 'href'].includes(attr.name)) visitUrl(attr.value);
				if (attr.name === 'style') visitStyleMedia(attr.value, visitUrl);
			}
			if (HTML_VOID_TAGS.has(node.tagName)) return;
		}
		for (const child of node.childNodes) walk(child, depth + 1);
	};
	for (const child of body.childNodes) walk(child, 1);
};
