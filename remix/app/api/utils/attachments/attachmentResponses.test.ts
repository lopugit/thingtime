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

test('unlimited metadata reaches the service only after account and rate admission', async () => {
  const { JSON_BODY_WITHOUT_APPLICATION_LIMIT } = await import('../../http');
  const metadata = 'original metadata '.repeat(2048);
  for (const refusal of ['account', 'rate', null]) {
    let reads = 0, calls = 0;
    const action = createAttachmentMutationAction({ rateKey: 'attachments.annotate', bodyBudget: JSON_BODY_WITHOUT_APPLICATION_LIMIT,
      service: async (_owner, body: any) => { calls++; assert.equal(body.description, metadata); return { ok: true }; }
    }, { getUser: async () => refusal === 'account' ? null : user,
      enforceLimit: async () => refusal === 'rate' ? { ...allowedLimit, allowed: false } : allowedLimit,
      readBody: async (request, budget) => { reads++; const { readJsonBody } = await import('../../http'); return readJsonBody(request, budget); }
    });
    const response = await action({ request: new Request('https://thingtime.com/api/v1/attachments/annotate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: metadata }) }) });
    assert.equal(response.status, refusal === 'account' ? 401 : refusal === 'rate' ? 429 : 200);
    assert.equal(reads, refusal ? 0 : 1); assert.equal(calls, refusal ? 0 : 1);
  }
});
