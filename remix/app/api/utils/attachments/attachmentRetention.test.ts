import assert from 'node:assert/strict';
import test from 'node:test';
import { activeAttachmentRetention, parseAttachmentRetention, createAttachmentRetention } from './attachmentRetention';

test('retention refuses ambiguous, unbounded or caller-selected deadlines before storage', async () => {
	const version = { id: 'owned', version: 'a'.repeat(64) };
	for (const input of [null, [], {}, { versions: [] }, { versions: [version, version] },
		{ versions: [version], retainedUntil: '2099-01-01' }, { versions: [{ ...version, ownerId: 'other' }] },
		{ versions: [{ id: '../escape', version: version.version }] }, { versions: [{ ...version, version: 'latest' }] },
		{ versions: Array.from({ length: 65 }, (_, n) => ({ ...version, id: String(n) })) }]) {
		assert.throws(() => parseAttachmentRetention(input));
		const service = createAttachmentRetention({ collection: async () => { throw Error('No storage access allowed'); } });
		const result = await service.retain('owner', input);
		assert.equal(result.ok, false);
		if (result.ok === false) assert.equal(result.status, 400);
	}
});

test('expired, closed or malformed holds cannot authorize retained reads', () => {
	const now = new Date('2026-10-19T00:00:00Z'), future = new Date(now.getTime() + 1);
	assert.equal(activeAttachmentRetention({ attachmentRetainUntil: future }, now), true);
	for (const doc of [{}, { attachmentRetainUntil: now }, { attachmentRetainUntil: new Date(NaN) },
		{ attachmentRetainUntil: future.toISOString() }, { attachmentRetainUntil: future, attachmentRetentionClosed: true }])
		assert.equal(activeAttachmentRetention(doc as any, now), false);
});
