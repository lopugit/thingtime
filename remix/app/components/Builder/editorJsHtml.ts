import { normalizeEditorJsHeadingLevel, type EditorJsBlock, type EditorJsDoc } from '../Editor/editorJsValue';

// Editor.js doc ↔ HTML for builder text blocks: the rich-editor modal edits an
// Editor.js document, storage stays the block's bounded `html` (rendered only
// through the sanitising allowlist renderer), and reopening converts the html
// back into editable Editor.js blocks. Inline markup (b/i/a/mark/code/u) is
// Editor.js's own inline-HTML strings and passes through both directions —
// the render-side allowlist stays the security boundary, so conversion here
// never needs to be one.

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
			return `<ul>${items
				.map((item: any) => `<li>${item?.checked ? '✅' : '⬜'} ${item?.text || ''}</li>`)
				.join('')}</ul>`;
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
	(doc.blocks || []).map(blockToHtml).filter(Boolean).join('\n');

// ——— html → Editor.js ————————————————————————————————————————————————————

const elementToBlocks = (el: Element): EditorJsBlock[] => {
	const tag = el.tagName.toLowerCase();
	if (/^h[1-6]$/.test(tag)) {
		return [{ type: 'header', data: { text: el.innerHTML, level: Number(tag[1]) } }];
	}
	if (tag === 'ul' || tag === 'ol') {
		const items = Array.from(el.children)
			.filter((child) => child.tagName.toLowerCase() === 'li')
			.map((li) => ({ content: li.innerHTML, meta: {}, items: [] }));
		return [{ type: 'list', data: { style: tag === 'ol' ? 'ordered' : 'unordered', items } }];
	}
	if (tag === 'blockquote') {
		const clone = el.cloneNode(true) as Element;
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
		const content = rows.map((row) => Array.from(row.children).map((cell) => cell.innerHTML));
		return content.length ? [{ type: 'table', data: { withHeadings, content } }] : [];
	}
	if (tag === 'figure') {
		const img = el.querySelector('img');
		if (img?.getAttribute('src')) {
			return [
				{ type: 'image', data: { url: img.getAttribute('src'), caption: el.querySelector('figcaption')?.innerHTML || '' } }
			];
		}
		return [{ type: 'paragraph', data: { text: el.innerHTML } }];
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
		return el.innerHTML.trim() ? [{ type: 'paragraph', data: { text: el.innerHTML } }] : [];
	}
	// p and any other leaf element becomes a paragraph with its inline html
	return el.innerHTML.trim() || tag === 'br' ? [{ type: 'paragraph', data: { text: tag === 'br' ? '' : el.innerHTML } }] : [];
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
			inlineRun.push(tag === 'br' ? '<br>' : el.outerHTML);
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
