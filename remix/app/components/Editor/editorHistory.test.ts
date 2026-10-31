import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorHistory } from './editorHistory';
import { carryStyleTokens } from './editorStyleCarry';
import type { EditorJsDoc } from './editorJsValue';
const doc = (text: string, color?: string, size?: string): EditorJsDoc => ({
	blocks: [
		{
			id: 'one',
			type: 'paragraph',
			data: { text },
			...(color || size ? { tunes: { style: { ...(color ? { color } : {}), ...(size ? { size } : {}) } } } : {})
		}
	]
});
test('undo then edit retains both futures and permits revisiting either branch', () => {
	const h = new EditorHistory();
	h.initialize(doc('a'));
	h.record(doc('ab'));
	h.record(doc('abc'));
	h.select(h.undoId!);
	h.record(doc('abd'));
	assert.equal(h.events.length, 4);
	assert.equal(h.events[3].parentId, 1);
	h.select(2);
	assert.equal(h.current.doc.blocks[0].data.text, 'abc');
	h.select(h.undoId!);
	assert.equal(h.redoId, 2);
	h.select(3);
	assert.equal(h.current.doc.blocks[0].data.text, 'abd');
});
test('selective colour revert preserves subsequent text and unrelated size changes', () => {
	const h = new EditorHistory();
	h.initialize(doc('a'));
	h.record(doc('a', '#ff0000'));
	h.record(doc('ab', '#ff0000', '24px'));
	const reverted = h.patch(1, 'revert');
	assert.equal(reverted.conflicts, 0);
	assert.equal(reverted.doc.blocks[0].data.text, 'ab');
	assert.deepEqual(reverted.doc.blocks[0].tunes, { style: { size: '24px' } });
	h.record(reverted.doc);
	const reapplied = h.patch(1, 'reapply');
	assert.equal(reapplied.conflicts, 0);
	assert.deepEqual(reapplied.doc.blocks[0].tunes, { style: { size: '24px', color: '#ff0000' } });
});
test('conflicting selective operations are detected and snapshots are isolated from source mutation', () => {
	const h = new EditorHistory(),
		original = doc('a');
	h.initialize(original);
	original.blocks[0].data.text = 'bad';
	assert.equal(h.current.doc.blocks[0].data.text, 'a');
	h.record(doc('b'));
	h.record(doc('c'));
	assert.equal(h.patch(1, 'revert').conflicts, 1);
});
test('block insertion, deletion, reordering and conversion are recoverable', () => {
	const h = new EditorHistory();
	h.initialize(doc('a'));
	const two = { ...doc('a'), blocks: [...doc('a').blocks, { id: 'two', type: 'header', data: { text: 'b', level: 2 } }] };
	h.record(two);
	h.record({ blocks: [...two.blocks].reverse() });
	assert.deepEqual(
		h.patch(2, 'revert').doc.blocks.map((b) => b.id),
		['one', 'two']
	);
	h.select(1);
	h.record({ blocks: [two.blocks[1]] });
	assert.equal(h.patch(3, 'revert').doc.blocks[0].id, 'one');
	h.record({ blocks: [{ ...two.blocks[1], type: 'paragraph' }] });
	assert.equal(h.patch(4, 'revert').doc.blocks[0].type, 'header');
});
test('conversion preferences carry safe styles by default and can exclude chosen properties', () => {
	assert.deepEqual(carryStyleTokens({ color: '#ff0000', size: '24px', align: 'right' }, { size: false }), { color: '#ff0000', align: 'right' });
	assert.deepEqual(carryStyleTokens({ color: 'url(evil)', font: '__proto__' }, {}), {});
});

test('selective revert restores a combined reorder and edit while preserving later inserted blocks', () => {
	const h = new EditorHistory();
	const one = doc('a').blocks[0],
		two = { id: 'two', type: 'paragraph', data: { text: 'b' } };
	h.initialize({ blocks: [one, two] });
	h.record({ blocks: [two, { ...one, data: { text: 'changed' } }] });
	h.record({ blocks: [two, { id: 'later', type: 'paragraph', data: { text: 'keep me' } }, h.current.doc.blocks[1]] });
	const reverted = h.patch(1, 'revert');
	assert.equal(reverted.conflicts, 0);
	assert.deepEqual(
		reverted.doc.blocks.map((b) => b.id),
		['one', 'later', 'two']
	);
	assert.equal(reverted.doc.blocks[0].data.text, 'a');
	h.record(reverted.doc);
	const reapplied = h.patch(1, 'reapply');
	assert.equal(reapplied.conflicts, 0);
	assert.deepEqual(
		reapplied.doc.blocks.map((b) => b.id),
		['two', 'later', 'one']
	);
	assert.equal(reapplied.doc.blocks[2].data.text, 'changed');
});
