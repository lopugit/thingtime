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
