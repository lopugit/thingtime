import { sanitizeInlineStyle } from './styleTokens';
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi;
const UNKNOWN_ENTITY_PATTERN = /&(?:#|[a-z][a-z\d]+;)/i;
const TAG_NAME_PATTERN = /^\s*(\/?)\s*([a-z][\w:-]*)/i;

const ALLOWED_INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'a', 'mark', 'code', 'br', 'span']);
const DROPPED_CONTENT_TAGS = new Set(['script', 'style', 'template']);
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_BASE = 'https://thingtime.invalid/';
const MAX_INLINE_NESTING = 64;

const decodeEntityOnce = (entity: string): string => {
	const lower = entity.toLowerCase();
	const named: Record<string, string> = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&apos;': "'",
		'&nbsp;': ' '
	};
	if (named[lower]) return named[lower];

	const radix = lower.startsWith('&#x') ? 16 : 10;
	const digits = lower.slice(radix === 16 ? 3 : 2, -1);
	const codePoint = Number.parseInt(digits, radix);
	return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
};

const decodeEntitiesOnce = (source: string): string => source.replace(ENTITY_PATTERN, decodeEntityOnce);
const escapeHtmlText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text: string): string => escapeHtmlText(text).replace(/"/g, '&quot;');

const readTag = (source: string, start: number): { end: number; contents: string } | null => {
	let quote = '';
	for (let index = start + 1; index < source.length; index += 1) {
		const character = source[index];
		if (quote) {
			if (character === quote) quote = '';
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === '>') return { end: index + 1, contents: source.slice(start + 1, index) };
	}
	return null;
};

const readAttribute = (tag: string, wantedName: string): string => {
	const nameMatch = TAG_NAME_PATTERN.exec(tag);
	let index = nameMatch?.[0].length ?? 0;

	while (index < tag.length) {
		while (/\s|\//.test(tag[index] || '')) index += 1;
		const nameStart = index;
		while (index < tag.length && !/[\s=/>]/.test(tag[index])) index += 1;
		const name = tag.slice(nameStart, index).toLowerCase();
		while (/\s/.test(tag[index] || '')) index += 1;

		let value = '';
		if (tag[index] === '=') {
			index += 1;
			while (/\s/.test(tag[index] || '')) index += 1;
			const quote = tag[index] === '"' || tag[index] === "'" ? tag[index++] : '';
			const valueStart = index;
			if (quote) {
				while (index < tag.length && tag[index] !== quote) index += 1;
				value = tag.slice(valueStart, index);
				if (tag[index] === quote) index += 1;
			} else {
				while (index < tag.length && !/[\s>]/.test(tag[index])) index += 1;
				value = tag.slice(valueStart, index);
			}
		}

		if (name === wantedName) return value;
		if (!name && index < tag.length) index += 1;
	}

	return '';
};

const safeHref = (rawHref: string): string => {
	const href = decodeEntitiesOnce(rawHref).trim();
	// Reject entities our deliberately one-pass decoder did not understand.
	// This also blocks double-encoded scheme obfuscation such as
	// `java&amp;#x73;cript:` from being decoded again by the browser.
	if (!href || UNKNOWN_ENTITY_PATTERN.test(href)) return '';
	try {
		return SAFE_PROTOCOLS.has(new URL(href, SAFE_BASE).protocol) ? href : '';
	} catch {
		return '';
	}
};

type OpenInlineTag = { name: string; closingHtml: string };

const parseInlineHtml = (value: unknown): { html: string; text: string } => {
	const source =
		typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : '';
	let html = '';
	let text = '';
	let cursor = 0;
	let inlineOverflowDepth = 0;
	const suppressedTags: string[] = [];
	const suppressedOverflowTags: string[] = [];
	const openTags: OpenInlineTag[] = [];

	const appendText = (segment: string) => {
		if (!segment || suppressedTags.length) return;
		const decoded = decodeEntitiesOnce(segment);
		text += decoded;
		html += escapeHtmlText(decoded);
	};

	while (cursor < source.length) {
		const tagStart = source.indexOf('<', cursor);
		if (tagStart < 0) {
			appendText(source.slice(cursor));
			break;
		}

		appendText(source.slice(cursor, tagStart));
		const nextCharacter = source[tagStart + 1] || '';
		if (!/[a-z!/]/i.test(nextCharacter)) {
			appendText('<');
			cursor = tagStart + 1;
			continue;
		}

		const token = readTag(source, tagStart);
		if (!token) {
			appendText(source.slice(tagStart));
			break;
		}
		cursor = token.end;

		if (/^\s*!--/.test(token.contents)) continue;
		const nameMatch = TAG_NAME_PATTERN.exec(token.contents);
		if (!nameMatch) continue;
		const closing = Boolean(nameMatch[1]);
		const tagName = nameMatch[2].toLowerCase();

		if (DROPPED_CONTENT_TAGS.has(tagName)) {
			if (closing) {
				if (suppressedOverflowTags.length) {
					if (suppressedOverflowTags[suppressedOverflowTags.length - 1] === tagName) suppressedOverflowTags.pop();
				} else if (suppressedTags[suppressedTags.length - 1] === tagName) suppressedTags.pop();
			} else if (!suppressedTags.length || suppressedTags[suppressedTags.length - 1] === 'template') {
				if (suppressedTags.length >= MAX_INLINE_NESTING) suppressedOverflowTags.push(tagName);
				else suppressedTags.push(tagName);
			}
			continue;
		}

		if (suppressedTags.length || !ALLOWED_INLINE_TAGS.has(tagName)) continue;

		if (closing) {
			if (inlineOverflowDepth > 0) {
				inlineOverflowDepth -= 1;
				continue;
			}
			let matchingIndex = -1;
			for (let index = openTags.length - 1; index >= 0; index -= 1) {
				if (openTags[index].name === tagName) {
					matchingIndex = index;
					break;
				}
			}
			if (matchingIndex >= 0) {
				for (let index = openTags.length - 1; index >= matchingIndex; index -= 1) html += openTags[index].closingHtml;
				openTags.splice(matchingIndex);
			}
			continue;
		}

		if (tagName === 'br') {
			text += '\n';
			html += '<br/>';
			continue;
		}
		if (openTags.length >= MAX_INLINE_NESTING) {
			inlineOverflowDepth += 1;
			continue;
		}

		if (tagName === 'a') {
			const href = safeHref(readAttribute(token.contents, 'href'));
			if (href) {
				html += `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">`;
				openTags.push({ name: tagName, closingHtml: '</a>' });
			} else {
				openTags.push({ name: tagName, closingHtml: '' });
			}
			continue;
		}

		if (tagName === 'span') {
			const style = sanitizeInlineStyle(decodeEntitiesOnce(readAttribute(token.contents, 'style')));
			html += style ? `<span style="${escapeAttribute(style)}">` : '<span>';
			openTags.push({ name: tagName, closingHtml: '</span>' });
			continue;
		}
		html += `<${tagName}>`;
		openTags.push({ name: tagName, closingHtml: `</${tagName}>` });
	}

	for (let index = openTags.length - 1; index >= 0; index -= 1) html += openTags[index].closingHtml;
	return { html, text };
};

// One deterministic parser is used in SSR and browsers. It decodes source
// entities exactly once, preserves the small Editor.js inline allowlist,
// removes script/style/template content, and never relies on DOMParser repair
// rules that could make server and client hydration disagree.
export const inlineHtmlToText = (value: unknown): string => parseInlineHtml(value).text;
export const sanitizeEditorJsInlineHtml = (value: unknown): string => parseInlineHtml(value).html;
