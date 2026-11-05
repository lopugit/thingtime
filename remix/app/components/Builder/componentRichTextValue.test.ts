import assert from 'node:assert/strict';
import test from 'node:test';
import { componentRichTextDocument, componentRichTextHasContent, componentRichTextSnapshot } from './componentRichTextValue';

test('legacy angle-bracket text stays literal in an Editor.js field and plain-text companion', () => {
	const snapshot = componentRichTextSnapshot('<b>literal</b> & ordinary text');
	assert.equal(snapshot.document.blocks[0].data.text, '&lt;b&gt;literal&lt;/b&gt; &amp; ordinary text');
	assert.equal(snapshot.plainText, '<b>literal</b> & ordinary text');
	assert.deepEqual(JSON.parse(snapshot.json), snapshot.document);
});
test('one rich snapshot preserves native formatting and supplies matching plain text', () => {
	const value = { kind: 'rich-text', time: 123, blocks: [{ type: 'paragraph', data: { text: '<b>Latest</b> <i>draft</i>' } }] };
	const snapshot = componentRichTextSnapshot(value);
	assert.deepEqual(snapshot.document, value);
	assert.equal(snapshot.plainText, 'Latest draft');
});
test('an explicit empty document clears both outputs and never selects a legacy fallback', () => {
	const snapshot = componentRichTextSnapshot({ kind: 'rich-text', blocks: [] });
	assert.equal(snapshot.plainText, ''); assert.deepEqual(JSON.parse(snapshot.json).blocks, []);
});
test('invalid objects refuse instead of being stringified into display content', () => {
	assert.throws(() => componentRichTextDocument({ html: '<script>unsafe</script>' }), /Editor.js document/);
});
test('required content ignores empty heading/list formatting markers but accepts literal punctuation', () => {
	assert.equal(componentRichTextHasContent({ blocks: [{ type: 'header', data: { level: 2, text: '<br>' } }, { type: 'list', data: { style: 'ordered', items: [{ content: '', items: [] }] } }] }), false);
	assert.equal(componentRichTextHasContent(componentRichTextDocument('#')), true);
});
