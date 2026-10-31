import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { RECORDING_JOB_KIND } from './recordingsCore';

let source: any, jobs: Map<string, any>, reads: any[];
const collection = {
	findOne: async (filter: any, options?: any) => {
		reads.push({ filter, options });
		return filter.shareId === source?.shareId && filter.ownerId === source.ownerId ? structuredClone(source) : null;
	},
	find: () => { throw new Error('Standalone audio must not search for bound children.'); },
	updateOne: async (filter: any, patch: any) => {
		assert.equal(filter.thingtime, RECORDING_JOB_KIND);
		if (!jobs.has(filter.shareId)) jobs.set(filter.shareId, structuredClone(patch.$setOnInsert));
		return { matchedCount: 1 };
	}
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => collection } });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: { packSecure: (value: any) => value, unpackSecure: (value: any) => value || {} } });
const { queueRecordingPost, recordingSource } = await import('./recordingsStore');

beforeEach(() => {
	source = { _id: 'source', shareId: 'audio-id', ownerId: 'owner', thingtime: ['attachment'], acl: ['tt:user'],
		attachmentPurpose: 'recording', attachmentState: 'ready', crystal: { mediaKind: 'audio', name: 'Memo.m4a' } };
	jobs = new Map(); reads = [];
});

test('explicit saved-recording queue is idempotent and leaves source payload/binding untouched', async () => {
	const before = structuredClone(source);
	assert.equal(await queueRecordingPost('owner', source.shareId), 1);
	assert.equal(await queueRecordingPost('owner', source.shareId), 1);
	assert.equal(jobs.size, 1);
	const [job] = [...jobs.values()];
	assert.equal(job.targetId, source.shareId);
	assert.equal(job.crystal.attachmentId, source.shareId);
	assert.equal(job.crystal.filename, 'Memo.m4a');
	assert.equal(job.crystal.status, 'queued');
	assert.deepEqual(source, before);
});

test('saved source is reauthorized in the caller transaction and fails closed after changes', async () => {
	const job = { ownerId: 'owner', targetId: source.shareId, crystal: { attachmentId: source.shareId } };
	const session = { transaction: true };
	const result = await recordingSource(job, session);
	assert.equal(result?.attachment.shareId, source.shareId);
	assert.equal(result?.post, result?.attachment);
	assert.equal(reads.at(-1).options.session, session);
	for (const patch of [{ acl: ['tt:all'] }, { deletedAt: new Date() }, { attachmentState: 'deleting' },
		{ targetId: 'another-thing' }, { ownerId: 'other' }, { moderation: { status: 'blocked' } }]) {
		const original = source; source = { ...source, ...patch };
		assert.equal(await recordingSource(job, session), null);
		source = original;
	}
});

test('a foreign or bound recording cannot be queued through the new path', async () => {
	await assert.rejects(queueRecordingPost('other', source.shareId), TypeError);
	source.targetId = 'private-message';
	await assert.rejects(queueRecordingPost('owner', source.shareId), TypeError);
	assert.equal(jobs.size, 0);
});
