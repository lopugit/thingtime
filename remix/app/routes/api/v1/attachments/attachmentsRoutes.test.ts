import assert from 'node:assert/strict';
import test from 'node:test';

import { createAttachmentMutationAction, isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { createAttachmentDetectionBackfillAction } from './backfill-detected-types/_backfill-detected-types';
import { createAttachmentCleanupLoader } from './cleanup/_cleanup';
import { createAttachmentContentLoader } from './content/_content';

const endpoint = 'https://thingtime.example/api/v1/attachments/uploads';
const allowed = async () => ({
	allowed: true,
	limit: 30,
	remaining: 29,
	resetAt: new Date(Date.now() + 60_000).toISOString()
});
const user = { id: 'user-1', accountKind: 'user' } as any;

const post = (body: unknown, headers: Record<string, string> = {}) =>
	new Request(endpoint, {
		method: 'POST',
		headers: { Origin: 'https://thingtime.example', 'Content-Type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

test('same-origin mutations honor the proxy-owned public origin and still fail closed for cross-site browsers', () => {
	const localProxyHeaders = {
		Origin: 'http://127.0.0.1:18280',
		'X-Forwarded-Host': '127.0.0.1:18280',
		'X-Forwarded-Proto': 'http'
	};
	assert.equal(isSameOriginAttachmentRequest(new Request('http://127.0.0.1:18282/api/v1/attachments/uploads', { headers: localProxyHeaders })), true);
	assert.equal(
		isSameOriginAttachmentRequest(
			new Request('http://127.0.0.1:18282/api/v1/attachments/uploads', {
				headers: { ...localProxyHeaders, Origin: 'https://attacker.example' }
			})
		),
		false
	);
	assert.equal(
		isSameOriginAttachmentRequest(
			new Request('http://127.0.0.1:18282/api/v1/attachments/uploads', {
				headers: {
					Origin: 'https://attacker.example',
					'X-Forwarded-Host': 'attacker.example',
					'X-Forwarded-Proto': 'https',
					'Sec-Fetch-Site': 'cross-site'
				}
			})
		),
		false
	);
});

// Signup-permissions hotfix: a brand-new account (both upload scopes withheld,
// even once its email is verified) must not be able to START an upload, and
// the requested purpose decides WHICH scope gates it (public =
// post/comment/custom-emoji, private = message/profile media; "all" is both
// flags). Approved scopes are unaffected — and routes that DON'T opt in stay
// open so an in-flight upload can still be completed or cancelled after a
// revoke.
test('upload starts require the upload-permission scope matching the purpose', async () => {
	let serviceCalls = 0;
	const gated = (viewer: any) =>
		createAttachmentMutationAction(
			{
				rateKey: 'attachments.start',
				service: async () => {
					serviceCalls += 1;
					return { ok: true };
				},
				requireUploadPermission: true
			},
			{ getUser: async () => viewer, enforceLimit: allowed as any }
		);

	const pending = {
		id: 'user-new',
		accountKind: 'user',
		emailVerified: true,
		publicUploadsEnabled: false,
		privateUploadsEnabled: false
	} as any;
	// no purpose defaults to 'post' — a public surface
	const denied = await gated(pending)({ request: post({}) });
	assert.equal(denied.status, 403);
	assert.equal(serviceCalls, 0);
	const deniedBody = await denied.json();
	assert.equal(deniedBody.code, 'public_uploads_not_approved');
	assert.equal(denied.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	for (const purpose of ['post', 'comment', 'custom-emoji']) {
		const res = await gated(pending)({ request: post({ purpose }) });
		assert.equal(res.status, 403, `public purpose ${purpose} not gated`);
		assert.equal((await res.json()).code, 'public_uploads_not_approved');
	}
	for (const purpose of ['message', 'profile-avatar', 'profile-banner']) {
		const res = await gated(pending)({ request: post({ purpose }) });
		assert.equal(res.status, 403, `private purpose ${purpose} not gated`);
		assert.equal((await res.json()).code, 'private_uploads_not_approved');
	}
	assert.equal(serviceCalls, 0);

	// each scope grants ONLY its own purposes — "all" is simply both flags
	const publicOnly = { id: 'user-pub', accountKind: 'user', publicUploadsEnabled: true, privateUploadsEnabled: false } as any;
	assert.equal((await gated(publicOnly)({ request: post({ purpose: 'post' }) })).status, 200);
	assert.equal((await gated(publicOnly)({ request: post({ purpose: 'message' }) })).status, 403);
	const privateOnly = { id: 'user-priv', accountKind: 'user', publicUploadsEnabled: false, privateUploadsEnabled: true } as any;
	assert.equal((await gated(privateOnly)({ request: post({ purpose: 'profile-avatar' }) })).status, 200);
	assert.equal((await gated(privateOnly)({ request: post({ purpose: 'comment' }) })).status, 403);
	const approvedAll = { id: 'user-ok', accountKind: 'user', publicUploadsEnabled: true, privateUploadsEnabled: true } as any;
	assert.equal((await gated(approvedAll)({ request: post({}) })).status, 200);
	assert.equal((await gated(approvedAll)({ request: post({ purpose: 'message' }) })).status, 200);
	assert.equal(serviceCalls, 4);

	// an unknown purpose reaches the service's own validation (no scope gates it)
	assert.equal((await gated(pending)({ request: post({ purpose: 'nonsense' }) })).status, 200);
	assert.equal(serviceCalls, 5);

	// Lifecycle routes (parts/complete/abort/delete) never opt in, so a
	// permission flipped off mid-upload can't strand a reserved MPU.
	const ungated = createAttachmentMutationAction(
		{ rateKey: 'attachments.complete', service: async () => ({ ok: true }) },
		{ getUser: async () => pending, enforceLimit: allowed as any }
	);
	assert.equal((await ungated({ request: post({}) })).status, 200);
});

test('attachment mutations enforce same-origin JSON, full users, caps, and private responses', async () => {
	let serviceCalls = 0;
	const handler = createAttachmentMutationAction(
		{
			rateKey: 'attachments.start',
			service: async () => {
				serviceCalls += 1;
				return { ok: true };
			}
		},
		{ getUser: async () => user, enforceLimit: allowed as any }
	);

	const crossOrigin = await handler({
		request: new Request(endpoint, {
			method: 'POST',
			headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
			body: '{}'
		})
	});
	assert.equal(crossOrigin.status, 403);
	assert.equal(crossOrigin.headers.get('Cache-Control'), 'private, no-store, max-age=0');

	const wrongType = await handler({ request: post('{}', { 'Content-Type': 'text/plain' }) });
	assert.equal(wrongType.status, 415);

	const serviceAccount = createAttachmentMutationAction(
		{ rateKey: 'attachments.start', service: async () => ({ ok: true }) },
		{ getUser: async () => ({ id: 'service-1', accountKind: 'service' } as any), enforceLimit: allowed as any }
	);
	assert.equal((await serviceAccount({ request: post({}) })).status, 403);

	let oversized: unknown;
	try {
		await handler({ request: post({ padding: 'x'.repeat(17 * 1024) }) });
	} catch (error) {
		oversized = error;
	}
	assert.ok(oversized instanceof Response);
	assert.equal(oversized.status, 413);
	assert.equal(oversized.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	assert.equal(serviceCalls, 0);
});

test('attachment mutation responses preserve bounded authored retry metadata', async () => {
	const handler = createAttachmentMutationAction(
		{
			rateKey: 'attachments.complete',
			service: async () => ({
				ok: false as const,
				status: 409,
				error: 'Upload parts are incomplete',
				code: 'upload_parts_retryable',
				retryable: true
			})
		},
		{ getUser: async () => user, enforceLimit: allowed as any }
	);
	const response = await handler({ request: post({ uploadId: 'attachment-1' }) });
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), {
		ok: false,
		error: 'Upload parts are incomplete',
		code: 'upload_parts_retryable',
		retryable: true
	});

	const quotaHandler = createAttachmentMutationAction(
		{
			rateKey: 'attachments.start',
			service: async () => ({
				ok: false as const,
				status: 507,
				error: 'Account storage allowance reached',
				code: 'quota_exceeded',
				retryable: false
			})
		},
		{ getUser: async () => user, enforceLimit: allowed as any }
	);
	const quotaResponse = await quotaHandler({ request: post({ filename: 'full.bin' }) });
	assert.equal(quotaResponse.status, 507);
	assert.deepEqual(await quotaResponse.json(), {
		ok: false,
		error: 'Account storage allowance reached',
		code: 'quota_exceeded',
		retryable: false
	});
});

test('content loader treats service credentials as anonymous and keeps signed redirects private', async () => {
	let viewer: any = 'unset';
	const loader = createAttachmentContentLoader({
		getUser: async () => ({ id: 'service-1', accountKind: 'service' } as any),
		enforceLimit: allowed as any,
		download: async (inputViewer) => {
			viewer = inputViewer;
			return {
				ok: true,
				url: 'https://s3.example/private?signature=secret',
				expiresAt: nowIso,
				cacheKey: 'a'.repeat(64),
				size: 500,
				contentType: 'image/png',
				disposition: 'inline',
				image: true
			};
		}
	});
	const nowIso = new Date().toISOString();
	const response = await loader({
		request: new Request('https://thingtime.example/api/v1/attachments/content?id=attachment-1')
	});
	assert.equal(viewer, null);
	assert.equal(response.status, 302);
	assert.equal(response.headers.get('Location'), 'https://s3.example/private?signature=secret');
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
	assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('cleanup route requires the exact cron bearer secret with no user-auth fallback', async () => {
	let reaps = 0;
	const loader = createAttachmentCleanupLoader({
		getSecret: () => 'cron-test-secret',
		reap: async () => {
			reaps += 1;
			return {
				ok: true,
				scanned: 2,
				deleted: 1,
				deferred: 0,
				skipped: 1,
				failed: 0,
				hasMore: false,
				stoppedForTimeBudget: false
			};
		}
	});

	for (const authorization of [undefined, 'cron-test-secret', 'bearer cron-test-secret', 'Bearer cron-test-secret-extra']) {
		const response = await loader({
			request: new Request('https://thingtime.example/api/v1/attachments/cleanup', {
				headers: authorization ? { Authorization: authorization, Cookie: 'tt_auth=valid-user-session' } : { Cookie: 'tt_auth=valid-user-session' }
			})
		});
		assert.equal(response.status, 401);
	}
	assert.equal(reaps, 0);

	const authorized = await loader({
		request: new Request('https://thingtime.example/api/v1/attachments/cleanup', {
			headers: { Authorization: 'Bearer cron-test-secret' }
		})
	});
	assert.equal(authorized.status, 200);
	assert.deepEqual(await authorized.json(), {
		ok: true,
		scanned: 2,
		deleted: 1,
		deferred: 0,
		skipped: 1,
		failed: 0,
		hasMore: false,
		stoppedForTimeBudget: false
	});
	assert.equal(authorized.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	assert.equal(reaps, 1);
});

test('detection backfill route is admin-only, same-origin JSON, and forwards one bounded pass', async () => {
	const report = {
		ok: true as const,
		dryRun: true,
		scanned: 1,
		upgradedInline: 1,
		labeledOpaque: 0,
		undetected: 0,
		missingObject: 0,
		conflicts: 0,
		failed: 0,
		hasMore: false,
		stoppedForTimeBudget: false
	};
	const serviceInputs: unknown[] = [];
	const handler = (overrides: Record<string, unknown> = {}) =>
		createAttachmentDetectionBackfillAction({
			admin: async () => ({ user: { id: 'admin-1' } } as any),
			enforceLimit: allowed as any,
			service: async (input: unknown) => {
				serviceInputs.push(input);
				return report;
			},
			...overrides
		} as any);

	// anonymous and signed-in non-admin callers never reach the service
	const anonymous = await handler({ admin: async () => ({ error: { status: 401, message: 'Unauthorized' } }) })({
		request: post({ dryRun: true })
	});
	assert.equal(anonymous.status, 401);
	const nonAdmin = await handler({ admin: async () => ({ error: { status: 403, message: 'Admins only' } }) })({
		request: post({ dryRun: true })
	});
	assert.equal(nonAdmin.status, 403);
	assert.deepEqual(await nonAdmin.json(), { ok: false, error: 'Admins only' });

	// transport gates fire before auth: cross-origin, wrong media type, wrong method
	const crossOrigin = await handler()({
		request: new Request(endpoint, {
			method: 'POST',
			headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
			body: '{}'
		})
	});
	assert.equal(crossOrigin.status, 403);
	const wrongType = await handler()({ request: post('{}', { 'Content-Type': 'text/plain' }) });
	assert.equal(wrongType.status, 415);
	const wrongMethod = await handler()({
		request: new Request(endpoint, {
			method: 'PUT',
			headers: { Origin: 'https://thingtime.example', 'Content-Type': 'application/json' },
			body: '{}'
		})
	});
	assert.equal(wrongMethod.status, 405);
	assert.equal(serviceInputs.length, 0);

	// throttled admins get the shared 429 shape
	const limited = await handler({
		enforceLimit: async () => ({ allowed: false, limit: 30, remaining: 0, resetAt: new Date(Date.now() + 60_000).toISOString() })
	})({ request: post({}) });
	assert.equal(limited.status, 429);
	assert.equal(serviceInputs.length, 0);

	// a real admin call forwards the body and returns the pass report privately
	const okResponse = await handler()({ request: post({ dryRun: true, limit: 50 }) });
	assert.equal(okResponse.status, 200);
	assert.deepEqual(await okResponse.json(), report);
	assert.equal(okResponse.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	assert.deepEqual(serviceInputs, [{ dryRun: true, limit: 50 }]);

	// service failures pass their status through unchanged
	const failing = await handler({
		service: async () => ({ ok: false as const, status: 400, error: 'Invalid backfill request' })
	})({ request: post({}) });
	assert.equal(failing.status, 400);
	assert.deepEqual(await failing.json(), { ok: false, error: 'Invalid backfill request' });
});

test('cleanup route fails closed when CRON_SECRET is unavailable', async () => {
	const loader = createAttachmentCleanupLoader({
		getSecret: () => undefined,
		reap: async () => ({
			ok: true,
			scanned: 0,
			deleted: 0,
			deferred: 0,
			skipped: 0,
			failed: 0,
			hasMore: false,
			stoppedForTimeBudget: false
		})
	});
	const response = await loader({
		request: new Request('https://thingtime.example/api/v1/attachments/cleanup', {
			headers: { Authorization: 'Bearer anything' }
		})
	});
	assert.equal(response.status, 503);
});

test('cache receipts authorize every request without exposing signed URLs, and reject unsupported previews', async () => {
	let allowedNow = true;
	const route = createAttachmentContentLoader({
		getUser: async () => user,
		enforceLimit: allowed as any,
		download: async () =>
			allowedNow
				? {
						ok: true,
						url: 'https://private.example/secret',
						expiresAt: 'later',
						cacheKey: 'a'.repeat(64),
						size: 500,
						contentType: 'image/png',
						disposition: 'inline',
						image: true
				  }
				: { ok: false, status: 404, error: 'Attachment not found' }
	});
	const request = new Request('https://thingtime.example/api/v1/attachments/content?id=example&cache=validate&width=64');
	const response = await route({ request });
	assert.deepEqual(await response.json(), { ok: true, cacheKey: 'a'.repeat(64) + ':64', size: 500 });
	assert.match(response.headers.get('Cache-Control')!, /no-store/);
	allowedNow = false;
	assert.equal((await route({ request })).status, 404);
	assert.equal((await route({ request: new Request(request.url.replace('width=64', 'width=99999')) })).status, 400);
});

test('conditional byte reuse authorizes before returning a cacheable 304', async () => {
	let authorized = true;
	let checks = 0;
	const route = createAttachmentContentLoader({
		getUser: async () => user,
		enforceLimit: allowed as any,
		download: async () => {
			checks++;
			return authorized
				? {
						ok: true,
						url: 'https://private.example/not-fetched',
						expiresAt: 'later',
						cacheKey: 'a'.repeat(64),
						size: 500,
						contentType: 'image/png',
						disposition: 'inline',
						image: true
				  }
				: { ok: false, status: 404, error: 'Attachment not found' };
		}
	});
	const request = new Request('https://thingtime.example/api/v1/attachments/content?id=example&width=64', {
		headers: { 'If-None-Match': '"' + 'a'.repeat(64) + ':64:v1"' }
	});
	const response = await route({ request });
	assert.equal(response.status, 304);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-cache');
	assert.equal(response.headers.get('ETag'), request.headers.get('If-None-Match'));
	authorized = false;
	assert.equal((await route({ request })).status, 404);
	assert.equal(checks, 2);
});
