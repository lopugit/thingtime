import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { recordingFailureMessage } from './recordingsCore';

let download: any;
mock.module(new URL('../attachments/attachments.ts', import.meta.url).href, {
	namedExports: { getAttachmentDownload: async (viewer: any, id: string, force: boolean) => {
		assert.deepEqual(viewer, { id: 'owner' });
		assert.equal(id, 'attachment');
		assert.equal(force, false);
		return download;
	} }
});
mock.module(new URL('../settings/prConflictResolverModelWaterfall.ts', import.meta.url).href, {
	namedExports: { getAiPreferredModelWaterfall: async () => [] }
});
const { readRecordingBytes } = await import('./recordingsProvider');

beforeEach(() => {
	download = { ok: true, size: 3, contentType: 'audio/wav', url: 'https://storage.example.test/audio?signature=private' };
});
afterEach(() => mock.restoreAll());

test('recording download uses the authorized attachment and requires its exact byte length', async () => {
	mock.method(globalThis, 'fetch', async (_url: unknown, options: any) => {
		assert.equal(options.redirect, 'error');
		return new Response(new Uint8Array([1, 2, 3]));
	});
	const result = await readRecordingBytes('owner', 'attachment');
	assert.deepEqual(Array.from(result.bytes), [1, 2, 3]);
	assert.equal(result.type, 'audio/wav');
});

test('storage HTTP and network failures expose only the download category', async () => {
	const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
	const check = (error: unknown) => {
		const message = recordingFailureMessage(error);
		assert.match(message, /download the saved audio/);
		assert.doesNotMatch(message, /signature|private credential/);
		return true;
	};
	await assert.rejects(readRecordingBytes('owner', 'attachment'), check);
	fetchMock.mock.mockImplementation(async () => { throw new Error('private credential in signed URL'); });
	await assert.rejects(readRecordingBytes('owner', 'attachment'), check);
});

test('truncated or oversized storage responses never reach transcription', async () => {
	const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1, 2])));
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /download/);
	fetchMock.mock.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3, 4])));
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /download/);
});

test('unavailable sources and unsupported formats are distinguished without a storage fetch', async () => {
	const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
	download = { ok: false, error: 'private internal detail' };
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /no longer available/);
	download = { ok: true, contentType: 'text/html', size: 3 };
	await assert.rejects(readRecordingBytes('owner', 'attachment'), /format or size/);
	assert.equal(fetchMock.mock.callCount(), 0);
});
