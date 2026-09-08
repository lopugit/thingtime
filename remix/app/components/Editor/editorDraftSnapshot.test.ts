import test from 'node:test';
import assert from 'node:assert/strict';
import { captureEditorDraft } from './editorDraftSnapshot';

const fakeEditor = (drafts: any[], saved: any[]) => ({
	blocks: { getBlocksCount: () => drafts.length, getBlockByIndex: (i: number) => ({ save: async () => drafts[i] }) },
	save: async () => ({ blocks: saved })
});
test('journal retains empty blocks and unfinished captions in order without submitting invalid data', async () => {
	const saved = { id: 'valid', type: 'paragraph', data: { text: 'Kept' } };
	const drafts = [
		{ id: 'empty', tool: 'paragraph', data: { text: '' }, tunes: { style: { color: '#ff0000' } } },
		{ id: 'valid', tool: 'paragraph', data: { text: '<script>bad</script>Kept' } },
		{ id: 'quote', tool: 'quote', data: { text: '', caption: '<b>unfinished</b><img src=x onerror=bad>' } }
	];
	const result = await captureEditorDraft(fakeEditor(drafts, [saved]));
	assert.deepEqual(
		result.doc.blocks.map((b) => b.id),
		['empty', 'valid', 'quote']
	);
	assert.deepEqual(result.submitted.blocks, [saved]);
	assert.equal(result.doc.blocks[1].data.text, 'Kept');
	assert.equal(result.doc.blocks[2].data.caption, '<b>unfinished</b>');
	assert.deepEqual(result.doc.blocks[0].tunes, { style: { color: '#ff0000' } });
	drafts[0].data.text = 'mutated';
	saved.data.text = 'mutated';
	assert.equal(result.doc.blocks[0].data.text, '');
	assert.equal(result.doc.blocks[1].data.text, 'Kept');
});
test('incomplete snapshot fails instead of silently dropping part of the editing history', async () => {
	await assert.rejects(captureEditorDraft(fakeEditor([{ data: { text: 'no identity' } }], [])), /full editor document/);
	await assert.rejects(
		captureEditorDraft({
			blocks: { getBlocksCount: () => 0 },
			save: async () => {
				throw new Error('save failed');
			}
		}),
		/save failed/
	);
});
