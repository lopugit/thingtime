import { normalizeEditorJsHeadingLevel, type EditorJsBlock, type EditorJsDoc } from '../Editor/editorJsValue';
import { inlineStyleToTokens, sanitizeStyleTokens, tokensToInlineStyle, sanitizeInlineStyle, hasStyleTokens } from '../Editor/styleTokens';
import { isSafeUrl } from '../Kinds/safeUrl';

// Editor.js doc ↔ HTML for builder text blocks: the rich-editor modal edits an
// Editor.js document, storage stays the block's bounded `html` (rendered only
// through the sanitising allowlist renderer), and reopening converts the html
// back into editable Editor.js blocks. Inline markup (b/i/a/mark/code/u) is
// Editor.js's own inline-HTML strings and passes through both directions —
// the render-side allowlist stays the security boundary, so conversion here
// never needs to be one.

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Editor.js paragraphs render data.text as LIVE innerHTML inside the modal —
// unlike the canvas, that render does NOT pass the allowlist renderer, so
// every fragment handed to the editor is scrubbed first: executable/embed
// tags are dropped, on* handler attributes are stripped, and href/src values
// must clear the same `isSafeUrl` gate the render-side allowlist uses. That
// gate is an ALLOWLIST parsed by the URL parser (http/https/mailto/tel), not a
// scheme prefix test: a denylist misses vbscript:, non-text data: payloads,
// and whitespace-obfuscated schemes like `java&#9;script:`, which browsers
// still execute because the parser strips control characters before reading
// the scheme. The stored html itself stays untouched (render-side allowlist is
// the page-level authority) — this guards only the editor sink.
const SCRUB_DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'noscript', 'template']);

const scrubElement = (el: Element): void => {
	for (const child of Array.from(el.children)) {
		if (SCRUB_DROP_TAGS.has(child.tagName.toLowerCase())) {
			child.remove();
			continue;
		}
		for (const attr of Array.from(child.attributes)) {
			const name = attr.name.toLowerCase();
			const isUrlAttribute = name === 'href' || name === 'src' || name === 'xlink:href';
			if (name === 'style' && child.tagName.toLowerCase() === 'span') child.setAttribute('style', sanitizeInlineStyle(attr.value));
			if (name.startsWith('on') || (isUrlAttribute && !isSafeUrl(attr.value))) {
				child.removeAttribute(attr.name);
			}
		}
		scrubElement(child);
	}
};

const scrubbedInnerHtml = (el: Element): string => {
	const clone = el.cloneNode(true) as Element;
	scrubElement(clone);
	return clone.innerHTML;
};

const scrubbedOuterHtml = (el: Element): string => {
	const wrapper = el.ownerDocument.createElement('div');
	wrapper.appendChild(el.cloneNode(true));
	scrubElement(wrapper);
	return wrapper.innerHTML;
};

type ListItem = string | { content?: string; items?: ListItem[] };

const listItemsToHtml = (items: ListItem[], ordered: boolean): string => {
	const tag = ordered ? 'ol' : 'ul';
	const body = items
		.map((item) => {
			if (typeof item === 'string') return `<li>${item}</li>`;
			const nested = Array.isArray(item.items) && item.items.length ? listItemsToHtml(item.items, ordered) : '';
			return `<li>${item.content || ''}${nested}</li>`;
		})
		.join('');
	return `<${tag}>${body}</${tag}>`;
};

const blockToHtml = (block: EditorJsBlock): string => {
	const data = (block.data || {}) as Record<string, any>;
	switch (block.type) {
		case 'paragraph':
			return `<p>${data.text || ''}</p>`;
		case 'header': {
			const level = normalizeEditorJsHeadingLevel(data.level);
			return `<h${level}>${data.text || ''}</h${level}>`;
		}
		case 'list': {
			const ordered = data.style === 'ordered';
			const items = Array.isArray(data.items) ? (data.items as ListItem[]) : [];
			return listItemsToHtml(items, ordered);
		}
		case 'checklist': {
			const items = Array.isArray(data.items) ? data.items : [];
			return `<ul>${items.map((item: any) => `<li>${item?.checked ? '✅' : '⬜'} ${item?.text || ''}</li>`).join('')}</ul>`;
		}
		case 'quote': {
			const caption = data.caption ? `<footer>${data.caption}</footer>` : '';
			return `<blockquote>${data.text || ''}${caption}</blockquote>`;
		}
		case 'code':
			return `<pre><code>${escapeHtml(String(data.code || ''))}</code></pre>`;
		case 'delimiter':
			return '<hr>';
		case 'table': {
			const content: string[][] = Array.isArray(data.content) ? data.content : [];
			if (!content.length) return '';
			const withHeadings = data.withHeadings === true;
			const row = (cells: string[], cellTag: string) => `<tr>${cells.map((cell) => `<${cellTag}>${cell || ''}</${cellTag}>`).join('')}</tr>`;
			const head = withHeadings ? `<thead>${row(content[0], 'th')}</thead>` : '';
			const bodyRows = (withHeadings ? content.slice(1) : content).map((cells) => row(cells, 'td')).join('');
			return `<table>${head}<tbody>${bodyRows}</tbody></table>`;
		}
		case 'image':
		case 'simpleImage': {
			const url = typeof data.url === 'string' ? data.url : typeof data.file?.url === 'string' ? data.file.url : '';
			if (!url) return '';
			const caption = data.caption ? `<figcaption>${data.caption}</figcaption>` : '';
			return `<figure><img src="${escapeHtml(url)}" alt="">${caption}</figure>`;
		}
		case 'warning':
			return `<div>⚠️ <strong>${data.title || ''}</strong> ${data.message || ''}</div>`;
		case 'embed': {
			const source = typeof data.source === 'string' ? data.source : '';
			return source ? `<p><a href="${escapeHtml(source)}">${escapeHtml(data.caption || source)}</a></p>` : '';
		}
		default:
			return typeof data.text === 'string' ? `<p>${data.text}</p>` : '';
	}
};

export const editorJsToHtml = (doc: EditorJsDoc): string =>
	(doc.blocks || [])
		.map((block) => {
			const html = blockToHtml(block);
			const tokens = sanitizeStyleTokens(block.tunes?.style);
			const style = [tokensToInlineStyle(tokens), tokens.align ? `text-align:${tokens.align}` : ''].filter(Boolean).join(';');
			return style ? html.replace(/^<([a-z][a-z0-9]*)/i, (_, tag) => `<${tag} style="${escapeHtml(style)}"`) : html;
		})
		.filter(Boolean)
		.join('\n');

// ——— html → Editor.js ————————————————————————————————————————————————————

const elementToBlocks = (el: Element): EditorJsBlock[] => {
	const blocks = elementToUnstyledBlocks(el);
	const style = el.getAttribute('style') || '';
	const tokens = sanitizeStyleTokens({
		...inlineStyleToTokens(style),
		align: /(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(style)?.[1].toLowerCase()
	});
	return hasStyleTokens(tokens)
		? blocks.map((block) => ({ ...block, tunes: { ...block.tunes, style: { ...tokens, ...sanitizeStyleTokens(block.tunes?.style) } } }))
		: blocks;
};

const elementToUnstyledBlocks = (el: Element): EditorJsBlock[] => {
	const tag = el.tagName.toLowerCase();
	if (/^h[1-6]$/.test(tag)) {
		return [{ type: 'header', data: { text: scrubbedInnerHtml(el), level: Number(tag[1]) } }];
	}
	if (tag === 'ul' || tag === 'ol') {
		const items = Array.from(el.children)
			.filter((child) => child.tagName.toLowerCase() === 'li')
			.map((li) => ({ content: scrubbedInnerHtml(li), meta: {}, items: [] }));
		return [{ type: 'list', data: { style: tag === 'ol' ? 'ordered' : 'unordered', items } }];
	}
	if (tag === 'blockquote') {
		const clone = el.cloneNode(true) as Element;
		scrubElement(clone);
		const footer = clone.querySelector('footer');
		const caption = footer?.innerHTML || '';
		footer?.remove();
		return [{ type: 'quote', data: { text: clone.innerHTML, caption, alignment: 'left' } }];
	}
	if (tag === 'pre') {
		return [{ type: 'code', data: { code: el.textContent || '' } }];
	}
	if (tag === 'hr') {
		return [{ type: 'delimiter', data: {} }];
	}
	if (tag === 'table') {
		const rows = Array.from(el.querySelectorAll('tr'));
		const withHeadings = !!el.querySelector('th');
		const content = rows.map((row) => Array.from(row.children).map((cell) => scrubbedInnerHtml(cell)));
		return content.length ? [{ type: 'table', data: { withHeadings, content } }] : [];
	}
	if (tag === 'figure') {
		const img = el.querySelector('img');
		if (img?.getAttribute('src')) {
			return [
				{
					type: 'image',
					data: { url: img.getAttribute('src'), caption: scrubbedInnerHtml(el.querySelector('figcaption') || el.ownerDocument.createElement('span')) }
				}
			];
		}
		return [{ type: 'paragraph', data: { text: scrubbedInnerHtml(el) } }];
	}
	if (tag === 'img') {
		const src = el.getAttribute('src');
		return src ? [{ type: 'image', data: { url: src, caption: '' } }] : [];
	}
	if (tag === 'div' || tag === 'section' || tag === 'article') {
		// containers with block children flatten; leaf divs become paragraphs
		const children = Array.from(el.children);
		const hasBlockChildren = children.some((child) =>
			/^(h[1-6]|ul|ol|blockquote|pre|hr|table|figure|div|p|section|article)$/.test(child.tagName.toLowerCase())
		);
		if (hasBlockChildren) return nodesToBlocks(el.childNodes);
		return el.innerHTML.trim() ? [{ type: 'paragraph', data: { text: scrubbedInnerHtml(el) } }] : [];
	}
	// p and any other leaf element becomes a paragraph with its inline html
	return el.innerHTML.trim() || tag === 'br' ? [{ type: 'paragraph', data: { text: tag === 'br' ? '' : scrubbedInnerHtml(el) } }] : [];
};

const nodesToBlocks = (nodes: NodeListOf<ChildNode> | ChildNode[]): EditorJsBlock[] => {
	const blocks: EditorJsBlock[] = [];
	let inlineRun: string[] = [];
	const flushInline = () => {
		const text = inlineRun.join('').trim();
		if (text) blocks.push({ type: 'paragraph', data: { text } });
		inlineRun = [];
	};
	for (const node of Array.from(nodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (node.textContent) inlineRun.push(escapeHtml(node.textContent));
			continue;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) continue;
		const el = node as Element;
		const tag = el.tagName.toLowerCase();
		// inline elements join the current paragraph run
		if (/^(b|i|u|s|strong|em|a|span|mark|code|sub|sup|small|br)$/.test(tag)) {
			inlineRun.push(tag === 'br' ? '<br>' : scrubbedOuterHtml(el));
			continue;
		}
		flushInline();
		blocks.push(...elementToBlocks(el));
	}
	flushInline();
	return blocks;
};

export const htmlToEditorJs = (html: string): EditorJsDoc => {
	const fallback: EditorJsDoc = { blocks: [{ type: 'paragraph', data: { text: html } }] };
	if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return fallback;
	try {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const blocks = nodesToBlocks(doc.body.childNodes);
		return { blocks: blocks.length ? blocks : [{ type: 'paragraph', data: { text: '' } }] };
	} catch {
		return fallback;
	}
};

export const htmlToPlainText = (html: string): string => {
	if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;
	try {
		return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
	} catch {
		return html;
	}
};
