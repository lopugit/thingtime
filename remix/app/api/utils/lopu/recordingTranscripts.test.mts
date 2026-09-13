import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const owned = { ownerId: 'owner', acl: ['tt:user'] };
const attachment = (id: string) => ({ ...owned, shareId: id, thingtime: ['attachment'], attachmentPurpose: 'recording', attachmentState: 'ready', crystal: { mediaKind: 'audio' } });
const rows: any[] = [attachment('a'), attachment('b')];
for (const id of ['a', 'b']) {
	rows.push({ ...owned, shareId: `job-owner-${id}-${id}`, targetId: id, thingtime: ['lopu-recording-job'], crystal: { attachmentId: id }, state: { commentIds: [`c-${id}`], commentIndex: 1 } });
	rows.push({ ...owned, shareId: `c-${id}`, targetId: id, thingtime: ['comment'], crystal: { text: `🦄 Lopu transcription\n\nQuote ${id}` } });
}
const queries: any[] = [];
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => ({
	find(query: any) {
		queries.push(query);
		return { toArray: async () => rows.filter((row) => row.ownerId === query.ownerId && query.shareId.$in.includes(row.shareId) && (!query.thingtime || row.thingtime.includes(query.thingtime))) };
	}
}) } });
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, { namedExports: {
	recordingId: (...parts: string[]) => parts.join('-'), recordingJobState: (job: any) => job.state
} });
const { readRecordingTranscripts } = await import('./recordingTranscripts');
test('real Watch children inherit only the verified private parent, including after privacy changes', async () => {
	const parent = { ...owned, shareId: 'watch-upload-inherited', thingtime: ['post'], tags: ['apple-watch'] };
	const file = { ...attachment('watch-audio'), targetId: parent.shareId, attachmentPurpose: 'post', acl: ['tt:inherit'] };
	const transcript = { ...owned, shareId: 'watch-comment', targetId: parent.shareId, thingtime: ['comment'], acl: ['tt:inherit'], crystal: { text: '🦄 Lopu transcription\n\nInherited quote' } };
	rows.push(parent, file, transcript, { ...owned, shareId: `job-owner-${parent.shareId}-${file.shareId}`, targetId: parent.shareId, thingtime: ['lopu-recording-job'], crystal: { attachmentId: file.shareId }, state: { commentIds: [transcript.shareId], commentIndex: 1 } });
	assert.deepEqual(await readRecordingTranscripts('owner', [file.shareId]), [{ attachmentId: file.shareId, text: 'Inherited quote' }]);
	parent.acl = ['tt:all'];
	assert.deepEqual(await readRecordingTranscripts('owner', [file.shareId]), []);
	parent.acl = ['tt:user'];
	transcript.targetId = 'different-parent';
	assert.deepEqual(await readRecordingTranscripts('owner', [file.shareId]), []);
	queries.length = 0;
});
test('reads the exact ordered relational transcripts with four batched reads, not one per player', async () => {
	assert.deepEqual(await readRecordingTranscripts('owner', ['a', 'b', 'missing']), [
		{ attachmentId: 'a', text: 'Quote a' }, { attachmentId: 'b', text: 'Quote b' }
	]);
	assert.equal(queries.length, 4);
	assert.ok(queries.every((query) => query.ownerId === 'owner' && Array.isArray(query.shareId.$in)));
	assert.deepEqual(await readRecordingTranscripts('other', ['a', 'b']), []);
	rows.find((row) => row.shareId === 'c-a').crystal.text = 'Edited transcript';
	rows.find((row) => row.shareId === 'b').acl = ['tt:all'];
	assert.deepEqual(await readRecordingTranscripts('owner', ['a', 'b']), [{ attachmentId: 'a', text: 'Edited transcript' }]);
	rows.find((row) => row.shareId === 'c-a').deletedAt = new Date();
	assert.deepEqual(await readRecordingTranscripts('owner', ['a', 'b']), []);
});
