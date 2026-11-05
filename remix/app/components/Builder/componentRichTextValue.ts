import { blocksToText, isEditorJsDoc, type EditorJsDoc } from '../Editor/editorJsValue';
import { inlineHtmlToText } from '../Editor/inlineHtmlText';

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Legacy strings are literal text, never HTML or JSON auto-detection. An
 * explicitly empty native document owns its value and stays empty. */
export function componentRichTextDocument(value: unknown): EditorJsDoc {
	if (isEditorJsDoc(value)) return { ...value, kind: 'rich-text', blocks: value.blocks };
	if (value === undefined || value === null || value === '') return { kind: 'rich-text', blocks: [] };
	if (typeof value !== 'string') throw new Error('Rich text needs an Editor.js document or plain text.');
	return { kind: 'rich-text', blocks: value.split(/\r?\n/).map((text) => ({ type: 'paragraph', data: { text: escapeText(text) } })) };
}

export function componentRichTextSnapshot(value: unknown): { document: EditorJsDoc; json: string; plainText: string } {
	const document = componentRichTextDocument(value);
	return { document, json: JSON.stringify(document), plainText: blocksToText(document.blocks) };
}

export function componentRichTextHasContent(document: EditorJsDoc): boolean {
	const pending: unknown[] = document.blocks.map((block) => block.data);
	const seen = new WeakSet<object>();
	while (pending.length) {
		const value = pending.pop();
		if (typeof value === 'string' && inlineHtmlToText(value).trim()) return true;
		if (!value || typeof value !== 'object' || seen.has(value)) continue;
		seen.add(value);
		if (Array.isArray(value)) for (const child of value) pending.push(child);
		else
			for (const key of ['text', 'content', 'title', 'message', 'caption', 'code', 'url', 'source', 'embed', 'items', 'file']) {
				if (Object.prototype.hasOwnProperty.call(value, key)) pending.push((value as Record<string, unknown>)[key]);
			}
	}
	return false;
}

/** An untouched hidden/opening field can submit its current default without
 * constructing an editor. A dirty field always requires its live snapshot. */
export function componentRichTextSaveSnapshot(saved: unknown, currentDefault: unknown, dirty: boolean) {
	if (saved === undefined && dirty) throw new Error('The rich-text editor is still opening. Try saving again.');
	return componentRichTextSnapshot(saved === undefined ? currentDefault : saved);
}

export const componentRichTextFieldName = (value: unknown): string =>
	typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value) ? value : '';
