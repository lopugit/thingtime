import assert from 'node:assert/strict';
import test from 'node:test';
import { chatAttachmentInput } from './chatAttachmentInput';

const event = (files: File[] = [], inside = true) => ({
	defaultPrevented: false,
	stopped: false,
	currentTarget: { contains: () => inside },
	target: {},
	clipboardData: { files },
	dataTransfer: { files, types: files.length ? ['Files'] : ['text/plain'], dropEffect: 'move' },
	preventDefault() {
		this.defaultPrevented = true;
	},
	stopPropagation() {
		this.stopped = true;
	}
});
for (const handler of ['onPaste', 'onDrop'] as const) {
	test(`${handler} accepts multiple files once and preserves ordinary text`, () => {
		const queued: File[][] = [];
		const handlers = chatAttachmentInput((files) => queued.push(files), false);
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		const transfer = event(files);
		handlers[handler](transfer as any);
		assert.deepEqual(queued, [files]);
		assert.equal(transfer.defaultPrevented, true);
		assert.equal(transfer.stopped, true);
		handlers[handler](transfer as any);
		assert.equal(queued.length, 1);
		const text = event();
		handlers[handler](text as any);
		assert.equal(text.defaultPrevented, false);
	});
	test(`${handler} rejects locked and portal transfers`, () => {
		const queued: File[][] = [];
		const transfer = event([new File(['a'], 'a.txt')]);
		chatAttachmentInput((files) => queued.push(files), true)[handler](transfer as any);
		assert.equal(transfer.defaultPrevented, true);
		chatAttachmentInput((files) => queued.push(files), false)[handler](event(transfer.clipboardData.files, false) as any);
		assert.equal(queued.length, 0);
	});
}
test('dragover permits file copy only when enabled and leaves text native', () => {
	const transfer = event([new File(['a'], 'a.txt')]);
	chatAttachmentInput(() => {}, false).onDragOver(transfer as any);
	assert.equal(transfer.dataTransfer.dropEffect, 'copy');
	chatAttachmentInput(() => {}, true).onDragOver(transfer as any);
	assert.equal(transfer.dataTransfer.dropEffect, 'none');
	const text = event();
	chatAttachmentInput(() => {}, false).onDragOver(text as any);
	assert.equal(text.defaultPrevented, false);
});
