import assert from 'node:assert/strict';
import test from 'node:test';
import { editorJsToHtml } from './editorJsHtml';

test('builder HTML keeps inline and whole-block styles on headings, paragraphs and lists', () => {
	const result = editorJsToHtml({
		blocks: [
			{
				type: 'header',
				data: { text: 'A <span style="color:#ff000088">heading</span>', level: 2 },
				tunes: { style: { size: '1.5rem', color: '#123456', align: 'center', decoration: 'underline' } }
			},
			{ type: 'paragraph', data: { text: 'Paragraph' }, tunes: { style: { size: 24 } } },
			{ type: 'list', data: { style: 'unordered', items: [{ content: 'List text' }] }, tunes: { style: { color: '#ff0000' } } }
		]
	});
	assert.match(result, /<h2 style="color:#123456;font-size:1.5rem;text-decoration:underline;text-align:center">/);
	assert.match(result, /<span style="color:#ff000088">heading<\/span>/);
	assert.match(result, /<p style="font-size:24px">Paragraph<\/p>/);
	assert.match(result, /<ul style="color:#ff0000">/);
});
test('builder serialization drops hostile style tokens', () => {
	const result = editorJsToHtml({
		blocks: [
			{
				type: 'paragraph',
				data: { text: 'Safe' },
				tunes: { style: { color: 'red;position:fixed', size: 'url(evil)', font: '__proto__', align: 'right;display:none' } }
			}
		]
	});
	assert.equal(result, '<p>Safe</p>');
});
