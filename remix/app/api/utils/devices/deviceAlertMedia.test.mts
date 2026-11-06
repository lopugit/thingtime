import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
let doc: any, ready: any;
const version = () => attachmentContentVersion('audio', 'objects/audio', 'version-one');
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
	namedExports: {
		getHomeThingsCollection: async () => ({ findOne: async (q: any) => (doc && q.ownerId === doc.ownerId && q.shareId === doc.shareId ? doc : null) })
	}
});
mock.module(new URL('../attachments/attachments.ts', import.meta.url).href, { namedExports: { getAttachmentDownload: async () => ready } });
const service = await import('./deviceAlertMedia');
beforeEach(() => {
	doc = {
		shareId: 'audio',
		ownerId: 'owner',
		thingtime: ['attachment'],
		attachmentState: 'ready',
		attachmentPurpose: 'file',
		objectKey: 'objects/audio',
		objectVersionId: 'version-one',
		crystal: { contentType: 'audio/mpeg', mediaKind: 'audio' },
		moderation: { status: 'skipped', categories: ['not-analyzable'], analyzedAt: new Date() }
	};
	ready = {
		ok: true,
		url: 'https://storage.test/exact',
		version: version(),
		size: 3,
		contentType: 'audio/mpeg',
		expiresAt: new Date().toISOString()
	};
});
test('media pins exact canonical attachment version and supports protected policy skips for audio', async () => {
	const result = await service.ownedAudio('owner', 'audio');
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.versionId, version());
	assert.equal((await service.downloadDeviceMedia('owner', 'audio', version())).ok, true);
	assert.equal((await service.ownedAudio('foreign', 'audio')).ok, false);
	assert.equal((await service.ownedAudio('owner', 'audio', 'a'.repeat(64))).ok, false);
});
test('pending, missing, blocked, flagged, linked, wrong-purpose and expiring uploads cannot execute', async () => {
	for (const patch of [
		{ moderation: null },
		{ moderation: { status: 'pending' } },
		{ moderation: { status: 'blocked' } },
		{ moderation: { status: 'clear', flagPending: true } },
		{ moderation: { status: 'skipped' } },
		{ attachmentState: 'pending' },
		{ attachmentPurpose: 'password' },
		{ attachmentLinked: true },
		{ attachmentExpiresAt: new Date(Date.now() + 10000) },
		{ crystal: { contentType: 'image/png' } }
	]) {
		const before = doc;
		doc = { ...doc, ...patch };
		assert.equal((await service.ownedAudio('owner', 'audio')).ok, false, JSON.stringify(patch));
		doc = before;
	}
});
test('download refuses version replacement and rechecks deletion/moderation at delivery', async () => {
	ready = { ...ready, version: 'f'.repeat(64) };
	assert.equal((await service.downloadDeviceMedia('owner', 'audio', version())).ok, false);
	doc.moderation = { status: 'pending' };
	assert.equal((await service.downloadDeviceMedia('owner', 'audio', version())).ok, false);
});
