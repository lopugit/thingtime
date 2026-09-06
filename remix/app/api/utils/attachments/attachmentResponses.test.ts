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
