import assert from 'node:assert/strict';
import test from 'node:test';
import { copyStoredAttachment } from './copyStoredAttachment';
import { attachmentPartPlan } from './attachments';
import type { AttachmentDoc } from './attachmentStore';

const fixture = () => {
	const events: string[] = [];
	const parts: any[] = [];
	const now = new Date('2026-09-10T00:00:00Z');
	let source = {
		shareId: 'source', ownerId: 'author', objectKey: 'objects/source', objectVersionId: 'source-version',
		objectSizeBytes: 9 * 1024 * 1024, attachmentPurpose: 'post', attachmentState: 'ready',
		crystal: { name: 'photo.png', contentType: 'image/png' }
	} as AttachmentDoc;
	let destination = { ...source, shareId: 'copy', ownerId: 'visitor', objectKey: 'objects/copy', uploadId: 'destination-mpu', attachmentState: 'pending', attachmentExpiresAt: new Date(now.getTime() + 60_000) } as AttachmentDoc;
	let readable = true;
	const deps: Parameters<typeof copyStoredAttachment>[0] = {
		read: async () => { events.push('read'); return readable ? { ok: true, doc: structuredClone(source) } : { ok: false, status: 404, error: 'Attachment not found' }; },
		start: async (owner, input: any) => {
			events.push('reserve');
			assert.equal(owner, 'visitor');
			assert.deepEqual(input, { requestId: 'copy-request', filename: 'photo.png', contentType: 'image/png', sizeBytes: source.objectSizeBytes, purpose: 'post' });
			return { ok: true, upload: { id: 'copy' } };
		},
		store: {
			getOwned: async (owner, id) => { assert.equal(owner, 'visitor'); assert.equal(id, 'copy'); return destination; },
			markPartsIssued: async () => { events.push('mark-parts'); return destination; }
		},
		getS3: () => ({ copyUploadPart: async (part: any) => { events.push('part'); parts.push(part); } } as any),
		complete: async (owner, input) => { events.push('complete'); assert.equal(owner, 'visitor'); assert.deepEqual(input, { uploadId: 'copy' }); return { ok: true, attachment: { id: 'copy' } }; },
		remove: async (owner, input) => { events.push('cleanup'); assert.equal(owner, 'visitor'); assert.ok(['copy', 'copy-request'].includes((input as any).id)); return { ok: true, deferred: false }; },
		plan: attachmentPartPlan, uuid: () => 'copy-request', now: () => now
	};
	return { deps, events, parts, setSource: (patch: Partial<AttachmentDoc>) => { source = { ...source, ...patch }; }, setDestination: (patch: Partial<AttachmentDoc>) => { destination = { ...destination, ...patch }; }, revoke: () => { readable = false; } };
};

test('a stored copy reserves visitor bytes, pins source version, and uses normal finalization', async () => {
	const f = fixture();
	const result = await copyStoredAttachment(f.deps, { id: 'visitor', sharedRoot: 'page' }, 'source');
	assert.deepEqual(result, { ok: true, id: 'copy', attachment: { id: 'copy' } });
	assert.deepEqual(f.events, ['read', 'reserve', 'mark-parts', 'read', 'part', 'read', 'part', 'read', 'complete', 'read']);
	assert.equal(f.parts.length, 2);
	assert.deepEqual(f.parts.map(({ range }) => range), [{ start: 0, end: 8388607 }, { start: 8388608, end: 9437183 }]);
	for (const part of f.parts) {
		assert.equal(part.sourceObjectKey, 'objects/source'); assert.equal(part.sourceVersionId, 'source-version');
		assert.equal(part.objectKey, 'objects/copy'); assert.equal(part.uploadId, 'destination-mpu');
	}
});

test('single-part copies omit ranges, including files smaller than the S3 range threshold', async () => {
	const f = fixture(); f.setSource({ objectSizeBytes: 1 }); f.setDestination({ objectSizeBytes: 1 });
	assert.equal((await copyStoredAttachment(f.deps, { id: 'visitor' }, 'source')).ok, true);
	assert.equal(f.parts.length, 1); assert.equal(f.parts[0].range, undefined);
});

test('anonymous, unavailable, purpose-isolated and moderation-hidden sources never reserve storage', async () => {
	const anonymous = fixture();
	assert.equal((await copyStoredAttachment(anonymous.deps, null, 'source')).ok, false);
	assert.deepEqual(anonymous.events, []);
	for (const patch of [{ attachmentPurpose: 'message' }, { attachmentPurpose: 'profile' }, { attachmentPurpose: 'recording' }, { moderation: { status: 'blocked' } }, { moderation: { status: 'pending' } }] as Partial<AttachmentDoc>[]) {
		const f = fixture(); f.setSource(patch);
		assert.equal((await copyStoredAttachment(f.deps, { id: 'visitor', isAdmin: true }, 'source')).ok, false);
		assert.deepEqual(f.events, ['read']);
	}
	const f = fixture(); f.revoke();
	assert.equal((await copyStoredAttachment(f.deps, { id: 'visitor' }, 'source')).ok, false);
	assert.deepEqual(f.events, ['read']);
});

test('source revocation or exact-version replacement between parts aborts and cleans only the copy', async () => {
	for (const change of ['revoke', 'version', 'purpose', 'blocked'] as const) {
		const f = fixture();
		f.deps.getS3 = () => ({ copyUploadPart: async () => {
			f.events.push('part');
			if (change === 'revoke') f.revoke();
			if (change === 'version') f.setSource({ objectVersionId: 'new-version' });
			if (change === 'purpose') f.setSource({ attachmentPurpose: 'message' });
			if (change === 'blocked') f.setSource({ moderation: { status: 'blocked' } });
		} } as any);
		assert.equal((await copyStoredAttachment(f.deps, { id: 'visitor' }, 'source')).ok, false);
		assert.equal(f.events.filter((event) => event === 'part').length, 1);
		assert.equal(f.events.includes('complete'), false); assert.equal(f.events.at(-1), 'cleanup');
	}
});

test('quota and destination fence failures do not write S3 parts', async () => {
	for (const patch of [{ ownerId: 'another-owner' }, { objectSizeBytes: 2 }, { targetId: 'bound' }, { attachmentState: 'ready' }, { uploadId: undefined }, { attachmentExpiresAt: new Date(0) }] as Partial<AttachmentDoc>[]) {
		const f = fixture(); f.setDestination(patch);
		assert.equal((await copyStoredAttachment(f.deps, { id: 'visitor' }, 'source')).ok, false);
		assert.equal(f.parts.length, 0); assert.equal(f.events.includes('complete'), false);
	}
	const f = fixture(); f.deps.start = async () => ({ ok: false, status: 413, error: 'Storage quota exceeded' });
	assert.equal((await copyStoredAttachment(f.deps, { id: 'visitor' }, 'source')).ok, false);
	assert.equal(f.parts.length, 0); assert.equal(f.events.includes('complete'), false);
});

test('copy/finalization failures retain cleanup state without exposing storage errors', async () => {
	for (const stage of ['part', 'complete', 'after-complete'] as const) {
		const f = fixture();
		if (stage === 'part') f.deps.getS3 = () => ({ copyUploadPart: async () => { throw Error('secret bucket and version'); } } as any);
		if (stage === 'complete') f.deps.complete = async () => ({ ok: false, status: 409, error: 'Finalization pending' });
		if (stage === 'after-complete') f.deps.complete = async () => { f.revoke(); return { ok: true, attachment: { id: 'copy' } }; };
		f.deps.remove = async () => ({ ok: true, deferred: true });
		const result = await copyStoredAttachment(f.deps, { id: 'visitor' }, 'source');
		assert.equal(result.ok, false);
		if (!result.ok) { assert.match(result.error, /cleanup is pending/); assert.doesNotMatch(result.error, /secret|bucket|version/); }
	}
});
