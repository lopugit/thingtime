/** Real isolated Mongo transactions and production Request handlers. Synthetic
 * storage transport is explicit: this does not prove provider durability. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const directory = process.env.THINGTIME_ATTACHMENT_RETENTION_TEST_DIRECTORY;
assert.ok(
	directory && /^mongodb:\/\/127\.0\.0\.1:28162\/thingtime\?replicaSet=attachment-retention$/.test(process.env.MONGODB_CONNECTION_STRING || '')
);
const actual = await realpath(directory!);
assert.equal(dirname(actual), await realpath(tmpdir()));
assert.ok(basename(actual).startsWith('thingtime-attachment-retention-'));
assert.equal((await stat(actual)).mode & 0o077, 0);
process.env.APP_URL = 'http://127.0.0.1:28163';
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.NODE_ENV = 'test';
const { action: register } = await import('../app/routes/api/v1/auth/register/_register');
const { action: retainAction, createAttachmentContentLoader } = await import('../app/routes/api/v1/attachments/content/_content');
const { attachmentStore } = await import('../app/api/utils/attachments/attachmentStore');
const { createAttachmentRetention, ATTACHMENT_RETENTION_MS } = await import('../app/api/utils/attachments/attachmentRetention');
const { createAttachmentService } = await import('../app/api/utils/attachments/attachments');
const { attachmentContentVersion } = await import('../app/api/utils/attachments/contentFingerprint');
const { getUserStorageUsage } = await import('../app/api/utils/storage/userStorage');
let cookie = '';
const base = process.env.APP_URL;
const request = (path: string, body?: unknown, auth = true) =>
	new Request(base + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { Origin: base, 'Content-Type': 'application/json', ...(auth ? { Cookie: cookie } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
const registration = await register({
	request: request(
		'/api/v1/auth/register',
		{
			username: 'retain-' + randomUUID().slice(0, 8),
			password: randomUUID() + '-Fixture!',
			email: randomUUID() + '@example.invalid'
		},
		false
	)
} as any);
assert.equal(registration.status, 200);
cookie = registration.headers
	.getSetCookie()
	.map((v) => v.split(';')[0])
	.join('; ');
const owner = (await registration.json()).user.id;
const initialUsage = await getUserStorageUsage(owner);
async function upload() {
	const id = randomUUID(),
		lease = randomUUID(),
		expires = new Date(Date.now() + 600000);
	const crystal = { name: 'retained.bin', size: 4, contentType: 'application/octet-stream', mediaKind: 'file' as const };
	await attachmentStore.reservePending({
		id,
		ownerId: owner,
		crystal,
		objectKey: 'objects/' + id,
		requestFingerprint: 'a'.repeat(64),
		purpose: 'file',
		expiresAt: expires
	});
	await attachmentStore.setUploadId(owner, id, 'fixture-mpu');
	assert.ok((await attachmentStore.claimFinalizing(owner, id, lease))?.acquired);
	const doc = await attachmentStore.markReady(owner, id, crystal, 'fixture-version', expires, lease);
	return { doc, version: attachmentContentVersion(id, doc.objectKey, doc.objectVersionId!), id };
}
const first = await upload(),
	second = await upload();
const allocated = await getUserStorageUsage(owner);
const versions = [{ id: first.id, version: first.version }];
const response = await retainAction({ request: request('/api/v1/attachments/content', { versions }) });
assert.equal(response.status, 200);
assert.match(response.headers.get('Cache-Control')!, /private.*no-store/);
const receipt = await response.json();
assert.deepEqual(receipt.versions, versions);
assert.equal(Date.parse(receipt.retainedUntil) - Date.parse(receipt.serverTime), ATTACHMENT_RETENTION_MS);
assert.deepEqual(await getUserStorageUsage(owner), allocated, 'Retention keeps existing quota, without a second byte charge');
assert.equal((await retainAction({ request: request('/api/v1/attachments/content', { versions }, false) })).status, 401);
assert.equal(
	(await retainAction({ request: request('/api/v1/attachments/content', { versions: [{ id: first.id, version: 'b'.repeat(64) }] }) })).status,
	409
);
const atomic = await retainAction({
	request: request('/api/v1/attachments/content', {
		versions: [
			{ id: second.id, version: second.version },
			{ id: randomUUID(), version: 'a'.repeat(64) }
		]
	})
});
assert.equal(atomic.status, 409);
assert.equal((await attachmentStore.getById(second.id))?.attachmentRetainUntil, undefined, 'Refused batch leaves no partial holds');
let clock = new Date(),
	deletes = 0;
const retention = createAttachmentRetention({ now: () => clock });
const s3 = {
	deleteObject: async () => {
		deletes++;
	},
	signDownload: async () => ({ url: 'https://fixture.invalid/exact', expiresAt: new Date().toISOString() })
};
const service = createAttachmentService({ now: () => clock, closeRetention: retention.closeForDeletion, getS3: () => s3 as any });
assert.equal((await service.remove(owner, { id: first.id })).ok, true);
assert.equal(deletes, 0);
assert.equal((await attachmentStore.getById(first.id))?.attachmentState, 'deleting');
assert.equal((await service.download({ id: owner }, first.id, false)).ok, false, 'Normal content stays deleted');
assert.equal((await service.download({ id: owner }, first.id, false, first.version)).ok, true);
assert.equal((await service.download({ id: 'other' }, first.id, false, first.version)).ok, false);
assert.equal((await service.download({ id: owner, sharedRoot: 'unrelated' }, first.id, false, first.version)).ok, false);
const route = createAttachmentContentLoader({
	download: service.download,
	rangeFetch: async () =>
		new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'Content-Range': 'bytes 0-3/4', 'Content-Length': '4' } })
});
const path =
	'/api/v1/attachments/content?' + new URLSearchParams({ id: first.id, retained: '1', range: '1', version: first.version, offset: '0', length: '4' });
const bytes = await route({ request: request(path) });
assert.equal(bytes.status, 206);
assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
assert.equal((await route({ request: request(path, undefined, false) })).status, 404);
assert.equal((await route({ request: request('/api/v1/attachments/content?id=' + first.id + '&retained=1') })).status, 400);
// Concurrent renewals cannot shorten another capture; the real Mongo document
// is also the deletion fence, not a separate unchecked lease table.
clock = new Date(Date.parse(receipt.retainedUntil) - 60000);
const renewals = await Promise.all(Array.from({ length: 8 }, () => retention.retain(owner, { versions })));
assert.ok(renewals.every((v) => v.ok));
const afterRenew = (await attachmentStore.getById(first.id))!;
assert.ok(afterRenew.attachmentRetainUntil!.getTime() > Date.parse(receipt.retainedUntil));
assert.equal((await service.remove(owner, { id: first.id })).ok, true);
assert.equal(deletes, 0);
assert.deepEqual(await getUserStorageUsage(owner), allocated, 'Deferred deletion cannot refund retained bytes');
clock = new Date(afterRenew.attachmentRetainUntil!.getTime() + 1);
assert.equal((await service.download({ id: owner }, first.id, false, first.version)).ok, false);
const [closed, refused] = await Promise.all([retention.closeForDeletion(owner, first.id), retention.retain(owner, { versions })]);
assert.equal(closed?.attachmentRetentionClosed, true);
assert.equal(refused.ok, false, 'Expired deleting retention cannot be resurrected');
assert.equal((await service.remove(owner, { id: first.id })).ok, true);
assert.equal(deletes, 1);
assert.equal(await attachmentStore.getById(first.id), null);
assert.equal((await service.remove(owner, { id: first.id })).ok, true);
assert.equal(deletes, 1, 'Delete retry cannot repeat storage or refund');
await service.remove(owner, { id: second.id });
assert.deepEqual(await getUserStorageUsage(owner), initialUsage, 'Exact canonical quota refund after permanent deletion');
console.log(
	JSON.stringify({
		attachmentRetentionProof: true,
		checks: [
			'authenticated-private-route',
			'exact-version',
			'atomic-batch-refusal',
			'owner-only-retained-ranges',
			'deletion-deferral',
			'concurrent-renewal',
			'expiry-purge-fence',
			'no-double-charge',
			'deferred-no-refund',
			'exact-once-refund'
		],
		boundary: 'Production handlers, attachment store and Mongo transactions; synthetic object transport and expiry clock, no live provider/UI claim'
	})
);
process.exit(0);
