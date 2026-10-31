import type { EditorJsBlock, EditorJsDoc } from './editorJsValue';
import { sanitizeEditorJsInlineHtml } from './inlineHtmlText';
import { sanitizeStyleTokens } from './styleTokens';

const cleanDraftFields = (value: unknown, key = ''): unknown => {
	if (typeof value === 'string')
		return ['text', 'title', 'message', 'caption', 'content', 'items'].includes(key) ? sanitizeEditorJsInlineHtml(value) : value;
	if (Array.isArray(value)) return value.map((entry) => cleanDraftFields(entry, key));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value)
				.filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k))
				.map(([k, v]) => [k, cleanDraftFields(v, k)])
		);
	return value;
};

/** Native save omits unfinished/empty blocks. Keep those in the editing journal, not the submitted value. */
export const captureEditorDraft = async (editor: any): Promise<{ doc: EditorJsDoc; submitted: EditorJsDoc }> => {
	const drafts = Array.from({ length: editor.blocks.getBlocksCount() }, (_, index) => editor.blocks.getBlockByIndex(index).save());
	const [submitted, raw] = await Promise.all([editor.save(), Promise.all(drafts)]);
	if (!submitted?.blocks || raw.some((block) => !block?.id)) throw new Error('Unable to capture the full editor document');
	const valid = new Map<string, EditorJsBlock>(submitted.blocks.map((block: EditorJsBlock) => [block.id!, block]));
	const doc: EditorJsDoc = {
		blocks: raw.map(
			(block: any) =>
				valid.get(block.id) || {
					id: block.id,
					type: block.tool,
					data: cleanDraftFields(block.data) as Record<string, unknown>,
					...(block.tunes?.style ? { tunes: { style: sanitizeStyleTokens(block.tunes.style) } } : {})
				}
		)
	};
	return JSON.parse(JSON.stringify({ doc, submitted: { blocks: submitted.blocks } }));
};
