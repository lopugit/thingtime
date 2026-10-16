import assert from 'node:assert/strict';
import test from 'node:test';

import { createAttachmentMutationAction } from './attachmentResponses';

const user = { id: 'user-1', accountKind: 'user', publicUploadsEnabled: true, privateUploadsEnabled: true } as any;
const allowedLimit = { allowed: true, limit: 10, remaining: 9, resetAt: Date.now() + 60_000 } as any;

test('Watch device credentials can start only post-purpose attachment uploads', async () => {
	let serviceCalls = 0;
	const action = createAttachmentMutationAction(
		{
			rateKey: 'attachments.start',
			requireUploadPermission: true,
			service: async () => {
				serviceCalls += 1;
				return { ok: true };
			}
		},
		{
			getUser: async () => user,
			enforceLimit: async () => allowedLimit,
			readBody: async () => ({ purpose: 'profile-avatar' })
		}
	);
	const response = await action({
		request: new Request('https://thingtime.com/api/v1/attachments/uploads', {
			method: 'POST',
			headers: { Authorization: 'Bearer ttnode_example', 'Content-Type': 'application/json' },
			body: '{}'
		})
	});
	assert.equal(response.status, 403);
	assert.equal(serviceCalls, 0);
	assert.match(await response.text(), /post-purpose/u);
});

test('Watch device credentials retain the post upload path', async () => {
	let serviceCalls = 0;
	const action = createAttachmentMutationAction(
		{
			rateKey: 'attachments.start',
			requireUploadPermission: true,
			service: async () => {
				serviceCalls += 1;
				return { ok: true, upload: { id: 'attachment-1' } };
			}
		},
		{
			getUser: async () => user,
			enforceLimit: async () => allowedLimit,
			readBody: async () => ({ purpose: 'post' })
		}
	);
	const response = await action({
		request: new Request('https://thingtime.com/api/v1/attachments/uploads', {
			method: 'POST',
			headers: { Authorization: 'Bearer ttnode_example', 'Content-Type': 'application/json' },
			body: '{}'
		})
	});
	assert.equal(response.status, 200);
	assert.equal(serviceCalls, 1);
});

test('subspace image uploads require public approval even with private upload approval', async () => {
  for (const purpose of ['subspace-icon', 'subspace-banner']) {
    let called = false;
    const action = createAttachmentMutationAction({ rateKey: 'attachments.start', requireUploadPermission: true, service: async () => { called = true; return { ok: true }; } }, { getUser: async () => ({ ...user, publicUploadsEnabled: false }), enforceLimit: async () => allowedLimit, readBody: async () => ({ purpose }) });
    const response = await action({ request: new Request('https://thingtime.com/api/v1/attachments/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  }
});


test('durable request cancellation requires full user auth while legacy Watch cleanup remains available', async () => {
	let calls = 0, body: Record<string,unknown> = { requestId: 'original-request' };
	const action = createAttachmentMutationAction({ rateKey: 'attachments.delete', requestIdRequiresFullUser: true,
		service: async () => { calls++; return { ok: true }; }
	}, { getUser: async () => user, enforceLimit: async () => allowedLimit, readBody: async () => body });
	const request = (watch: boolean) => new Request('https://thingtime.com/api/v1/attachments/uploads/abort', {
		method: 'POST', headers: { 'Content-Type': 'application/json', ...(watch ? { Authorization: 'Bearer ttnode_example' } : {}) }, body: '{}'
	});
	assert.equal((await action({ request: request(true) })).status, 403); assert.equal(calls, 0);
	assert.equal((await action({ request: request(false) })).status, 200);
	body = { id: 'existing-file', retainReceipt: true, expectedUpdatedAt: '2026-10-16T00:00:00.000Z' };
	assert.equal((await action({ request: request(true) })).status, 403); assert.equal(calls, 1);
	assert.equal((await action({ request: request(false) })).status, 200);
	body = { uploadId: 'legacy-upload' };
	assert.equal((await action({ request: request(true) })).status, 200); assert.equal(calls, 3);
});
