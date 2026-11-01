import assert from 'node:assert/strict';
import test from 'node:test';

import { ATTACHMENT_ENVELOPE_VERSION } from './attachmentCore';
import { MAX_PROFILE_ATTACHMENT_BYTES, createProfileAttachmentReconciler, isBindableProfileAttachment, type AttachmentDoc } from './attachmentStore';

const now = new Date('2026-08-09T00:00:00.000Z');

const profileDoc = (overrides: Partial<AttachmentDoc> = {}): AttachmentDoc => ({
	_id: overrides.shareId || 'attachment-1',
	shareId: 'attachment-1',
	schemaVersion: 2,
	thingtime: ['attachment'],
	crystal: { name: 'avatar.jpg', size: 1024, contentType: 'image/jpeg', mediaKind: 'image' },
	extended: null,
	ownerId: 'user-1',
	acl: ['tt:user'],
	tags: [],
	storageClass: 'content',
	storageAccountingVersion: 1,
	sizeBytes: 1200,
	attachmentEnvelopeVersion: ATTACHMENT_ENVELOPE_VERSION,
	attachmentState: 'ready',
	attachmentPurpose: 'profile',
	attachmentProfileSlot: 'avatar',
	objectSizeBytes: 1024,
	objectKey: 'objects/attachment-1',
	objectVersionId: 'version-1',
	attachmentExpiresAt: new Date(now.getTime() + 60_000),
	createdAt: new Date(now.getTime() - 60_000),
	updatedAt: new Date(now.getTime() - 30_000),
	...overrides
});

test('profile binding accepts only owner-owned ready unexpired narrow raster images or the exact idempotent binding', () => {
	const draft = profileDoc();
	assert.equal(isBindableProfileAttachment(draft, 'user-1', 'user-1', 'avatar', now), true);
	assert.equal(isBindableProfileAttachment({ ...draft, attachmentExpiresAt: now }, 'user-1', 'user-1', 'avatar', now), false);
	assert.equal(isBindableProfileAttachment({ ...draft, ownerId: 'other' }, 'user-1', 'user-1', 'avatar', now), false);
	assert.equal(
		isBindableProfileAttachment({ ...draft, crystal: { ...draft.crystal, contentType: 'image/svg+xml' } }, 'user-1', 'user-1', 'avatar', now),
		false
	);
	assert.equal(
		isBindableProfileAttachment({ ...draft, crystal: { ...draft.crystal, mediaKind: 'video' } }, 'user-1', 'user-1', 'avatar', now),
		false
	);
	assert.equal(isBindableProfileAttachment({ ...draft, crystal: { ...draft.crystal, size: 999 } }, 'user-1', 'user-1', 'avatar', now), false);
	assert.equal(
		isBindableProfileAttachment({ ...draft, objectSizeBytes: MAX_PROFILE_ATTACHMENT_BYTES + 1 }, 'user-1', 'user-1', 'avatar', now),
		false
	);
	assert.equal(
		isBindableProfileAttachment(
			{ ...draft, targetId: 'user-1', acl: ['tt:inherit'], attachmentExpiresAt: undefined },
			'user-1',
			'user-1',
			'avatar',
			now
		),
		true
	);
});

const inMemoryReconciler = (initial: AttachmentDoc[], failWrite = false) => {
	const docs = initial.map((doc) => ({ ...doc }));
	const writes: Array<{ filter: any; update: any; session: any }> = [];
	const reconcile = createProfileAttachmentReconciler({
		getThings: async () =>
			({
				find: () => ({ toArray: async () => docs }),
				updateOne: async (filter: any, update: any, options: any) => {
					writes.push({ filter, update, session: options?.session });
					if (failWrite) return { matchedCount: 0 };
					const doc = docs.find((candidate) => (filter._id === undefined ? candidate.shareId === filter.shareId : candidate._id === filter._id));
					if (!doc) return { matchedCount: 0 };
					Object.assign(doc, update.$set || {});
					for (const key of Object.keys(update.$unset || {})) delete (doc as any)[key];
					return { matchedCount: 1 };
				}
			} as any)
	});
	return { docs, writes, reconcile };
};

test('profile replacement binds the new image and releases the old row as billed owner-only expired cleanup work', async () => {
	const old = profileDoc({
		_id: 'old',
		shareId: 'old',
		targetId: 'user-1',
		acl: ['tt:inherit'],
		attachmentExpiresAt: undefined,
		updatedAt: new Date(now.getTime() - 10_000)
	});
	const next = profileDoc({ _id: 'next', shareId: 'next', objectKey: 'objects/next', updatedAt: new Date(now.getTime() - 5_000) });
	const state = inMemoryReconciler([old, next]);
	const session = { id: 'same-home-session' };
	await state.reconcile({
		ownerId: 'user-1',
		targetId: 'user-1',
		current: { avatar: 'old', banner: null },
		desired: { avatar: 'next', banner: null },
		now,
		session
	});

	const rebound = state.docs.find((doc) => doc.shareId === 'next')!;
	const released = state.docs.find((doc) => doc.shareId === 'old')!;
	assert.equal(rebound.targetId, 'user-1');
	assert.deepEqual(rebound.acl, ['tt:inherit']);
	assert.equal(rebound.attachmentExpiresAt, undefined);
	assert.equal(released.targetId, undefined);
	assert.deepEqual(released.acl, ['tt:user']);
	assert.equal(released.attachmentExpiresAt, now);
	assert.equal(released.attachmentState, 'ready');
	assert.equal(released.sizeBytes, old.sizeBytes);
	assert.ok(state.writes.every((write) => write.session === session));
	assert.equal(state.writes[0].filter.attachmentPurpose, 'profile');
	assert.equal(state.writes[1].filter.targetId, 'user-1');
});

test('profile binding is idempotent, rejects duplicate slots, and fails closed on a racing write', async () => {
	const bound = profileDoc({ targetId: 'user-1', acl: ['tt:inherit'], attachmentExpiresAt: undefined });
	const idempotent = inMemoryReconciler([bound]);
	await idempotent.reconcile({
		ownerId: 'user-1',
		targetId: 'user-1',
		current: { avatar: 'attachment-1', banner: null },
		desired: { avatar: 'attachment-1', banner: null },
		now,
		session: {}
	});
	assert.equal(idempotent.writes.length, 1);

	await assert.rejects(
		idempotent.reconcile({
			ownerId: 'user-1',
			targetId: 'user-1',
			current: { avatar: null, banner: null },
			desired: { avatar: 'attachment-1', banner: 'attachment-1' },
			now,
			session: {}
		}),
		/Avatar and banner must use different attachments/
	);

	const raced = inMemoryReconciler([profileDoc()], true);
	await assert.rejects(
		raced.reconcile({
			ownerId: 'user-1',
			targetId: 'user-1',
			current: { avatar: null, banner: null },
			desired: { avatar: 'attachment-1', banner: null },
			now,
			session: {}
		}),
		/changed while the profile was being updated/
	);
});
