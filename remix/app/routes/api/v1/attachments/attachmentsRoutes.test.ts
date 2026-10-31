import assert from 'node:assert/strict';
import test from 'node:test';

import { createAttachmentMutationAction, isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { createAttachmentDetectionBackfillAction } from './backfill-detected-types/_backfill-detected-types';
import { createAttachmentCleanupLoader } from './cleanup/_cleanup';
import { createAttachmentContentLoader } from './content/_content';
import { createAttachmentLinkAction } from './link/_link';

const endpoint = 'https://thingtime.example/api/v1/attachments/uploads';
const allowed = async () => ({
	allowed: true,
	limit: 30,
	remaining: 29,
	resetAt: new Date(Date.now() + 60_000).toISOString()
});
const user = { id: 'user-1', accountKind: 'user' } as any;

test('content authorization preserves the request link key and enriched audience without inventing an owner', async () => {
	for (const currentUser of [null, user]) {
		let observed: any;
		const route = createAttachmentContentLoader({
			getUser: async () => currentUser,
			enforceLimit: allowed as any,
			enrichViewer: async (viewer) => viewer?.id ? { ...viewer, groupIds: new Set(['group-1']) } : viewer,
			download: async (viewer) => { observed = viewer; return { ok: false, status: 404, error: 'Attachment not found' }; }
		});
		const response = await route({ request: new Request('https://thingtime.example/api/v1/attachments/content?id=fixture&key=read-key&sharedRoot=page') });
		assert.equal(response.status, 404);
		assert.equal(observed.id, currentUser?.id || '');
		assert.deepEqual([...observed.linkKeys], ['read-key']);
		assert.equal(observed.sharedRoot, 'page');
		assert.equal(observed.groupIds?.has('group-1') || false, !!currentUser);
		assert.match(response.headers.get('Cache-Control')!, /no-store/);
	}
});

test('malformed shared media roots are refused before authentication or storage access', async () => {
	const route = createAttachmentContentLoader({ getUser: async () => { throw Error('must not authenticate'); } });
	for (const root of ['', 'a'.repeat(129), '../other']) {
		const response = await route({ request: new Request(`https://thingtime.example/api/v1/attachments/content?id=fixture&sharedRoot=${encodeURIComponent(root)}`) });
		assert.equal(response.status, 400);
		assert.match(response.headers.get('Cache-Control')!, /no-store/);
	}
});

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
		enrichViewer: async (viewer) => viewer,
		getUser: async () => ({ id: 'service-1', accountKind: 'service' } as any),
		enforceLimit: allowed as any,
		download: async (inputViewer) => {
			viewer = inputViewer;
			return {
				ok: true,
				url: 'https://s3.example/private?signature=secret',
				expiresAt: nowIso,
				cacheKey: 'a'.repeat(64),
				version: 'b'.repeat(64),
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
		enrichViewer: async (viewer) => viewer,
		getUser: async () => user,
		enforceLimit: allowed as any,
		download: async () =>
			allowedNow
				? {
						ok: true,
						url: 'https://private.example/secret',
						expiresAt: 'later',
						cacheKey: 'a'.repeat(64),
				version: 'b'.repeat(64),
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
		enrichViewer: async (viewer) => viewer,
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
				version: 'b'.repeat(64),
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

test('upload throttling returns Retry-After without reaching storage; limiter outages remain 503', async () => {
	for (const unavailable of [false, true]) {
		const handler = createAttachmentMutationAction({
			rateKey: 'attachments.start', service: async () => { assert.fail('blocked request must not reserve storage'); }
		}, {
			getUser: async () => user,
			enforceLimit: async (_request, key, identity, options) => {
				assert.equal(key, 'attachments.start');
				assert.equal(identity, 'user:user-1');
				assert.equal(options?.failClosed, true);
				return { allowed: false, limit: 60, remaining: 0, resetAt: new Date(Date.now() + 60_000).toISOString(), unavailable };
			}
		});
		const response = await handler({ request: post({ requestId: 'same-upload' }) });
		assert.equal(response.status, unavailable ? 503 : 429);
		assert.match(response.headers.get('Cache-Control')!, /no-store/);
		if (!unavailable) assert.ok(Number(response.headers.get('Retry-After')) > 0 && Number(response.headers.get('Retry-After')) <= 60);
		else assert.equal(response.headers.get('Retry-After'), null);
	}
});

// "Download all" archives share the content endpoint's audience plumbing: the
// presented key, the enriched viewer, sharedRoot and admin review ride into the
// planner; malformed ids fail before authentication; manifests stay JSON.
test('archive requests carry the exact viewer context into the planner and stream a ZIP body', async () => {
	const { createAttachmentArchiveLoader } = await import('./archive/_archive');
	let observed: any;
	const plan = {
		ok: true as const,
		id: 'post-1',
		kind: 'post' as const,
		name: 'Beach day',
		fileName: 'Beach day.zip',
		entries: [{ id: 'att-1', path: 'a.png', name: 'a.png', size: 3, contentType: 'image/png', url: 'https://bucket.test/a' }],
		links: [],
		skipped: 0,
		totalBytes: 3
	};
	const rateKeys: string[] = [];
	let streamOptions: any;
	let manifestOptions: any;
	const route = createAttachmentArchiveLoader({
		getUser: async () => ({ ...user, isAdmin: true }),
		enforceLimit: (async (_request: Request, key: string) => {
			rateKeys.push(key);
			return allowed();
		}) as any,
		enrichViewer: async (viewer) => (viewer?.id ? { ...viewer, groupIds: new Set(['group-1']) } : viewer),
		plan: async (viewer, id, options) => {
			observed = { viewer, id, options };
			return { ...plan, ownerId: 'someone-else' };
		},
		manifest: (value, options) => {
			manifestOptions = options;
			return { ok: true, id: value.id, kind: value.kind, name: value.name, fileName: value.fileName, fileCount: 1, totalBytes: 3, skipped: 0, linkCount: 0, files: [] };
		},
		stream: (_plan, _signal, options) => {
			streamOptions = options;
			return new Response('PK').body!;
		},
		now: () => 1_000
	});
	const response = await route({ request: new Request('https://thingtime.example/api/v1/attachments/archive?id=post-1&key=read-key&sharedRoot=page') });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Content-Type'), 'application/zip');
	assert.match(response.headers.get('Content-Disposition')!, /^attachment; filename="Beach day\.zip"/);
	assert.match(response.headers.get('Cache-Control')!, /no-store/);
	assert.equal(response.headers.get('X-Thingtime-Archive-Files'), '1');
	assert.equal(await response.text(), 'PK');
	assert.equal(observed.id, 'post-1');
	assert.equal(observed.viewer.id, 'user-1');
	assert.deepEqual([...observed.viewer.linkKeys], ['read-key']);
	assert.equal(observed.viewer.groupIds.has('group-1'), true);
	// a real download presigns, and planning + streaming share one wall clock anchored at request start
	assert.deepEqual(observed.options, { sharedRoot: 'page', isAdmin: true, presign: true, deadlineAt: 281_000 });
	assert.deepEqual(streamOptions, { deadlineAt: 281_000 });

	const manifest = await route({ request: new Request('https://thingtime.example/api/v1/attachments/archive?id=post-1&manifest=1') });
	assert.equal(manifest.status, 200);
	assert.match(manifest.headers.get('Content-Type')!, /application\/json/);
	assert.deepEqual(await manifest.json(), { ok: true, id: 'post-1', kind: 'post', name: 'Beach day', fileName: 'Beach day.zip', fileCount: 1, totalBytes: 3, skipped: 0, linkCount: 0, files: [] });
	// probes authorize without presigning; an administrator (like the owner) sees the skipped count
	assert.deepEqual(observed.options, { sharedRoot: null, isAdmin: true, presign: false, deadlineAt: 281_000 });
	assert.deepEqual(manifestOptions, { revealSkipped: true });

	const head = await route({ request: new Request('https://thingtime.example/api/v1/attachments/archive?id=post-1', { method: 'HEAD' }) });
	assert.equal(head.status, 200);
	assert.equal(head.body, null);
	assert.equal(head.headers.get('Content-Type'), 'application/zip');
	assert.equal(observed.options.presign, false);
	// downloads and probes draw on separate rate windows
	assert.deepEqual(rateKeys, ['attachments.archive', 'attachments.archiveManifest', 'attachments.archiveManifest']);

	// a plain viewer who is not the root's owner never receives the skipped count
	const stranger = createAttachmentArchiveLoader({
		getUser: async () => user,
		enforceLimit: allowed as any,
		enrichViewer: async (viewer) => viewer,
		plan: async () => ({ ...plan, ownerId: 'someone-else' }),
		manifest: (_value, options) => {
			manifestOptions = options;
			return { ok: true, id: 'post-1', kind: 'post', name: 'x', fileName: 'x.zip', fileCount: 1, totalBytes: 3, skipped: 0, linkCount: 0, files: [] };
		}
	});
	await stranger({ request: new Request('https://thingtime.example/api/v1/attachments/archive?id=post-1&manifest=1') });
	assert.deepEqual(manifestOptions, { revealSkipped: false });
});

test('archive requests refuse malformed ids and roots before authenticating, and surface planner failures as JSON', async () => {
	const { createAttachmentArchiveLoader } = await import('./archive/_archive');
	const unauthenticated = createAttachmentArchiveLoader({ getUser: async () => { throw new Error('must not authenticate'); } });
	for (const query of ['', 'id=', 'id=-bad', `id=${'a'.repeat(129)}`, 'id=ok&sharedRoot=../x', 'id=ok&sharedRoot=']) {
		const response = await unauthenticated({ request: new Request(`https://thingtime.example/api/v1/attachments/archive?${query}`) });
		assert.equal(response.status, 400, query);
		assert.match(response.headers.get('Cache-Control')!, /no-store/);
	}
	const anonymous = createAttachmentArchiveLoader({
		getUser: async () => null,
		enforceLimit: allowed as any,
		enrichViewer: async (viewer) => viewer,
		plan: async (viewer) => {
			assert.equal(viewer, null);
			return { ok: false, status: 404, error: 'Thing not found' };
		}
	});
	const missing = await anonymous({ request: new Request('https://thingtime.example/api/v1/attachments/archive?id=nope') });
	assert.equal(missing.status, 404);
	assert.deepEqual(await missing.json(), { ok: false, error: 'Thing not found' });
	// service credentials read exactly like anonymous callers
	const service = createAttachmentArchiveLoader({
		getUser: async () => ({ id: 'svc', accountKind: 'service', isAdmin: true }) as any,
		enforceLimit: allowed as any,
		enrichViewer: async (viewer) => viewer,
		plan: async (viewer, _id, options) => {
			assert.equal(viewer, null);
			assert.deepEqual({ ...options, deadlineAt: undefined }, { sharedRoot: null, presign: true, deadlineAt: undefined });
			return { ok: false, status: 404, error: 'Thing not found' };
		}
	});
	assert.equal((await service({ request: new Request('https://thingtime.example/api/v1/attachments/archive?id=post-1') })).status, 404);
	const limited = createAttachmentArchiveLoader({
		getUser: async () => null,
		enforceLimit: (async () => ({ allowed: false, unavailable: true, limit: 0, remaining: 0, resetAt: new Date().toISOString() })) as any
	});
	assert.equal((await limited({ request: new Request('https://thingtime.example/api/v1/attachments/archive?id=post-1') })).status, 503);
});

// The filesystem stand-in for private S3 is a laptop convenience: without its
// directory variable the route is inert (404 for every method) and never
// reveals which operations exist.
test('the local object-storage route is inert unless the stand-in directory is configured', async () => {
	const previous = process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR;
	delete process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR;
	try {
		const { loader, action } = await import('./local-object/_local-object');
		for (const [handler, method] of [[loader, 'GET'], [loader, 'HEAD'], [action, 'PUT']] as const) {
			const response = await handler({ request: new Request('https://thingtime.example/api/v1/attachments/local-object?op=get&key=objects%2Fx', { method }) });
			assert.equal(response.status, 404, method);
			assert.match(response.headers.get('Cache-Control')!, /no-store/);
		}
	} finally {
		if (previous !== undefined) process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = previous;
	}
});

test('fingerprint requests retain the content audience, no-store headers and fail-closed rate limit', async () => {
	let observed: any; let called = 0; let limited = false;
	const payload = { ok: true as const, id: 'fixture', version: 'a'.repeat(64), size: 1, fingerprint: { algorithm: 'sha256-parts-v1' as const, partSizeBytes: 8388608, partCount: 1, sha256: 'b'.repeat(64) } };
	const loader = createAttachmentContentLoader({ getUser: async () => user, enrichViewer: async viewer => ({ ...viewer!, groupIds: new Set(['group']) }),
		enforceLimit: (async () => limited ? { allowed: false, unavailable: true } : allowed()) as any,
		download: async () => { throw Error('must not issue a download URL'); },
		fingerprint: async (viewer, id) => { called++; observed = viewer; assert.equal(id, 'fixture'); return payload; } });
	const request = new Request('https://thingtime.example/api/v1/attachments/content?id=fixture&fingerprint=1&key=link&sharedRoot=page');
	const result = await loader({ request }); assert.deepEqual(await result.json(), payload);
	assert.equal(observed.id, user.id); assert.equal(observed.sharedRoot, 'page'); assert.deepEqual([...observed.linkKeys], ['link']); assert.deepEqual([...observed.groupIds], ['group']);
	assert.match(result.headers.get('Cache-Control')!, /private.*no-store/);
	for (const variant of ['&width=64', '&cache=bytes']) assert.equal((await loader({ request: new Request(request.url + variant) })).status, 400);
	assert.equal(called, 1); limited = true; assert.equal((await loader({ request })).status, 503); assert.equal(called, 1);
});

test('version-pinned ranges bound upstream bytes and reauthorize before returning private content', async () => {
	const version = 'a'.repeat(64),
		url = 'https://thingtime.example/api/v1/attachments/content?id=fixture&range=1&version=' + version + '&offset=2&length=3';
	const metadata = {
		ok: true as const,
		url: 'https://storage.example/pinned',
		expiresAt: 'later',
		cacheKey: 'opaque',
		version,
		size: 20 * 1024 * 1024,
		contentType: 'application/octet-stream',
		disposition: 'attachment; filename="fixture"',
		image: false
	};
	let authorizations = 0,
		revoked = false,
		changed = false,
		mode = 'valid',
		fetched = 0;
	const route = createAttachmentContentLoader({
		getUser: async () => user,
		enforceLimit: allowed as any,
		enrichViewer: async (v) => v,
		download: async () => {
			authorizations++;
			return authorizations % 2 === 0 && revoked
				? { ok: false as const, status: 404, error: 'Attachment not found' }
				: { ...metadata, version: authorizations % 2 === 0 && changed ? 'b'.repeat(64) : version };
		},
		rangeFetch: async (_target, init) => {
			fetched++;
			assert.equal(init?.redirect, 'error');
			assert.equal(new Headers(init?.headers).get('Range'), 'bytes=2-4');
			if (mode === 'redirect') return new Response(null, { status: 302 });
			const bytes = mode === 'short' ? new Uint8Array([2, 3]) : mode === 'long' ? new Uint8Array([2, 3, 4, 5]) : new Uint8Array([2, 3, 4]);
			return new Response(bytes, {
				status: 206,
				headers: { 'Content-Range': mode === 'wrong' ? 'bytes 3-5/' + metadata.size : 'bytes 2-4/' + metadata.size, 'Content-Length': '3' }
			});
		}
	});
	let result = await route({ request: new Request(url) });
	assert.equal(result.status, 206);
	assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array([2, 3, 4]));
	assert.match(result.headers.get('Cache-Control')!, /no-store/);
	assert.equal(result.headers.get('ETag'), '"' + version + '"');
	assert.equal(authorizations, 2);
	revoked = true;
	result = await route({ request: new Request(url) });
	assert.equal(result.status, 404);
	revoked = false;
	changed = true;
	result = await route({ request: new Request(url) });
	assert.equal(result.status, 409);
	changed = false;
	for (const value of ['short', 'long', 'wrong', 'redirect']) {
		mode = value;
		authorizations = 0;
		result = await route({ request: new Request(url) });
		assert.equal(result.status, 502);
		assert.equal(authorizations, 1);
	}
	mode = 'valid';
	authorizations = 0;
	const before = fetched;
	result = await route({ request: new Request(url.replace(version, 'c'.repeat(64))) });
	assert.equal(result.status, 409);
	assert.equal(fetched, before);
	result = await route({ request: new Request(url.replace('offset=2', 'offset=' + metadata.size)) });
	assert.equal(result.status, 416);
	assert.equal(fetched, before);
	for (const query of [
		'range=2',
		'range=1&version=x&offset=0&length=1',
		'range=1&version=' + version + '&offset=-1&length=1',
		'range=1&version=' + version + '&offset=0&length=2097153',
		'range=1&version=' + version + '&offset=0&length=1&cache=bytes',
		'range=1&version=' + version + '&offset=0&length=1&offset=1'
	]) {
		result = await route({ request: new Request('https://thingtime.example/api/v1/attachments/content?id=fixture&' + query) });
		assert.equal(result.status, 400);
	}
});


test('retained ranges recheck the current session after reading and cannot become redirects or shared reads', async () => {
	const version = 'a'.repeat(64);
	let reads = 0, auth = 0;
	const route = createAttachmentContentLoader({
		getUser: async () => (++auth === 1 ? { id: 'owner', accountKind: 'user' } : null) as any,
		enforceLimit: allowed as any, enrichViewer: async v => v,
		download: async (_viewer, _id, _download, retainedVersion) => {
			assert.equal(retainedVersion, version);
			return { ok: true, version, size: 1, url: 'https://fixture.invalid', expiresAt: '', cacheKey: '', contentType: 'application/octet-stream', disposition: 'attachment', image: false };
		},
		rangeFetch: async () => { reads++; return new Response(new Uint8Array([1]), { status: 206, headers: { 'Content-Range': 'bytes 0-0/1' } }); }
	});
	const url = 'https://thingtime.example/api/v1/attachments/content?id=fixture&retained=1&range=1&version=' + version + '&offset=0&length=1';
	assert.equal((await route({ request: new Request(url) })).status, 404);
	assert.equal(reads, 1);
	for (const invalid of [url + '&sharedRoot=other', url + '&key=other', url + '&retained=1', url.replace('&range=1', '')])
		assert.equal((await route({ request: new Request(invalid) })).status, 400);
	assert.equal(reads, 1);
});

for (const purpose of ['file','recording'] as const) test('explicit owned-'+purpose+' retention is full-user, same-origin and unscoped while ordinary cache reads keep their gates', async () => {
 let principal:any=user, calls=0;
 const file={purpose,ownerId:'user-1',updatedAt:'2026-10-17T00:00:00.000Z',folderId:null,attachment:{id:'file',name:'file.txt',size:3,contentType:'text/plain',mediaKind:'file' as const}};
 const route=createAttachmentContentLoader({getUser:async()=>principal,enforceLimit:allowed as any,enrichViewer:async viewer=>viewer,
  download:async (_viewer,_id,download,retainedVersion,retain)=>{calls++;assert.equal(download,true);assert.equal(retainedVersion,undefined);assert.equal(retain,true);return {ok:true,url:'https://private.test/secret',expiresAt:'later',cacheKey:'a'.repeat(64),version:'a'.repeat(64),size:3,contentType:'application/octet-stream',disposition:'attachment',image:false,retention:file};}});
 const url='https://thingtime.example/api/v1/attachments/content?id=file&cache=retain&download=1';
 const response=await route({request:new Request(url,{headers:{Origin:'https://thingtime.example'}})});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,cacheKey:'a'.repeat(64)+':original',size:3,file});assert.match(response.headers.get('Cache-Control')!,/private.*no-store/);
 for(const query of ['&key=x','&sharedRoot=root','&width=64'])assert.equal((await route({request:new Request(url+query)})).status,400);
 assert.equal((await route({request:new Request(url,{headers:{Origin:'https://foreign.test'}})})).status,403);
 for(const value of [null,{id:'service',accountKind:'service'}]) {principal=value;assert.equal((await route({request:new Request(url)})).status,401);}
 assert.equal(calls,1);
});

test('owned-original streaming preserves private authorization and backpressure above the media-cache budget', async () => {
 const size = 70 * 1024 * 1024, block = new Uint8Array(1024 * 1024).fill(137);
 let principal: any = user, owner = user.id, fetched = 0, produced = 0, cancelled = 0, upstreamSignal: AbortSignal | null | undefined;
 const route = createAttachmentContentLoader({getUser: async () => principal, enforceLimit: allowed as any, enrichViewer: async viewer => viewer,
  download: async (_viewer, _id, download, retainedVersion, retain) => {
   assert.equal(download, true); assert.equal(retainedVersion, undefined); assert.equal(retain, true);
   return {ok: true, url: 'https://private.test/signed-original', expiresAt: 'later', cacheKey: 'a'.repeat(64), version: 'a'.repeat(64), size,
    contentType: 'application/octet-stream', disposition: 'attachment', image: false,
    retention: {purpose: 'file', ownerId: owner, updatedAt: '2026-10-18T00:00:00Z', folderId: null,
     attachment: {id: 'file', name: 'large.bin', size, contentType: 'application/octet-stream', mediaKind: 'file'}}};
  },
  fetchObject: async (url, init) => {
   fetched++; assert.equal(url, 'https://private.test/signed-original'); assert.equal(init?.redirect, 'error'); upstreamSignal = init?.signal;
   return new Response(new ReadableStream({pull(controller) {produced++; controller.enqueue(block);}, cancel() {cancelled++;}}, {highWaterMark: 0}));
  }});
 const url = 'https://thingtime.example/api/v1/attachments/content?id=file&cache=retain-bytes&download=1';
 for (const value of [null, {id: 'service', accountKind: 'service'}]) {principal = value; assert.equal((await route({request: new Request(url)})).status, 401);}
 principal = user;
 for (const query of ['&key=x','&sharedRoot=page','&width=64']) assert.equal((await route({request: new Request(url + query)})).status, 400);
 assert.equal((await route({request: new Request(url.replace('&download=1', ''))})).status, 400);
 assert.equal((await route({request: new Request(url, {headers: {Origin: 'https://foreign.test'}})})).status, 403);
 owner = 'foreign'; assert.equal((await route({request: new Request(url)})).status, 404); owner = user.id;
 assert.equal(fetched, 0);
 const controller = new AbortController();
 const response = await route({request: new Request(url, {headers: {Origin: 'https://thingtime.example'}, signal: controller.signal})});
 assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control')!, /private.*no-store/);
 assert.equal(response.headers.get('Content-Length'), String(size)); assert.equal(response.headers.get('ETag'), '"' + 'a'.repeat(64) + ':original:v1"');
 assert.equal(response.headers.get('Location'), null); assert.equal(produced, 0, 'Do not read bytes before the consumer asks');
 const reader = response.body!.getReader(); assert.deepEqual((await reader.read()).value, block); assert.equal(produced, 1);
 controller.abort(); assert.equal(upstreamSignal?.aborted, true);
 await reader.cancel(); reader.releaseLock(); assert.equal(cancelled, 1);
});

test('owned-original streaming preserves rate refusal and ordinary media cache bounds', async () => {
 let fetched = 0;
 const download = async () => ({ok: true as const, url: 'https://private.test/original', expiresAt: 'later', cacheKey: 'a'.repeat(64), version: 'a'.repeat(64), size: 70 * 1024 * 1024, contentType: 'application/octet-stream', disposition: 'attachment', image: false});
 const route = createAttachmentContentLoader({getUser: async () => user, enforceLimit: allowed as any, enrichViewer: async viewer => viewer, download,
  fetchObject: async () => {fetched++; throw Error('Must not read storage');}});
 assert.equal((await route({request: new Request('https://thingtime.example/api/v1/attachments/content?id=file&cache=bytes&download=1')})).status, 413);
 const refused = createAttachmentContentLoader({getUser: async () => user, enforceLimit: async () => ({allowed: false, unavailable: true}) as any, download});
 assert.equal((await refused({request: new Request('https://thingtime.example/api/v1/attachments/content?id=file&cache=retain-bytes&download=1')})).status, 503);
 assert.equal(fetched, 0);
});

test('shared original streams pin receipts, preserve backpressure above 16 MiB and reauthorize before EOF', async () => {
 const size = 17 * 1024 * 1024, block = new Uint8Array(1024 * 1024).fill(37);
 let fetched = 0, produced = 0, reads = 0, cancelled = 0;
 const route = createAttachmentContentLoader({getUser: async () => null, enforceLimit: allowed as any, enrichViewer: async viewer => viewer,
  download: async (viewer, id, download, retainedVersion, retain) => {
   reads++; assert.equal(viewer?.sharedRoot, 'page'); assert.equal(viewer?.id, ''); assert.ok(viewer?.linkKeys?.has('synthetic-link'));
   assert.equal(id, 'file'); assert.equal(download, true); assert.equal(retainedVersion, undefined); assert.ok(!retain);
   return {ok: true, url: 'https://private.test/pinned', expiresAt: 'later', cacheKey: 'a'.repeat(64), version: 'b'.repeat(64), size,
    contentType: 'application/octet-stream', disposition: 'attachment', image: false};
  }, fetchObject: async (_url, init) => {
   fetched++; assert.equal(init?.redirect, 'error');
   return new Response(new ReadableStream({pull(controller) {
    if (produced === 17) controller.close(); else { produced++; controller.enqueue(block); }
   }, cancel() {cancelled++;}}, {highWaterMark: 0}), {headers: {'Content-Length': String(size)}});
  }});
 const url = 'https://thingtime.example/api/v1/attachments/content?id=file&download=1&cache=original-bytes&sharedRoot=page&key=synthetic-link';
 assert.equal((await route({request: new Request(url)})).status, 412); assert.equal(fetched, 0);
 const response = await route({request: new Request(url, {headers: {'If-Match': '"' + 'a'.repeat(64) + ':original:v1"'}})});
 assert.equal(response.status, 200); assert.equal(produced, 0); assert.equal(response.headers.get('Location'), null);
 assert.match(response.headers.get('Cache-Control')!, /private.*no-store/); assert.equal(response.headers.get('Content-Length'), String(size));
 const reader = response.body!.getReader(); let bytes = 0;
 for (;;) {const part = await reader.read(); if (part.done) break; bytes += part.value.length;}
 assert.equal(bytes, size); assert.equal(reads, 3); assert.equal(cancelled, 0);
});

test('shared original streams reject mixed modes, changed authority/version and malformed storage bytes', async () => {
 const url = 'https://thingtime.example/api/v1/attachments/content?id=file&download=1&cache=original-bytes&sharedRoot=page';
 const headers = {'If-Match': '"' + 'a'.repeat(64) + ':original:v1"'};
 for (const failure of ['revoked', 'changed', 'truncated', 'excess', 'encoding', 'upstream-length', 'rate', 'cancel'] as const) {
  let downloads = 0, cancelled = 0;
  const route = createAttachmentContentLoader({getUser: async () => null,
   enforceLimit: (async () => failure === 'rate' ? {allowed: false, unavailable: true} : {allowed: true}) as any,
   enrichViewer: async viewer => viewer,
   download: async () => {
    if (++downloads > 1 && failure === 'revoked') return {ok: false, status: 404, error: 'Attachment not found'};
    return {ok: true, url: 'https://private.test/pinned', expiresAt: 'later', cacheKey: 'a'.repeat(64),
     version: (downloads > 1 && failure === 'changed' ? 'c' : 'b').repeat(64), size: failure === 'cancel' ? 6 : 3, contentType: 'application/octet-stream', disposition: 'attachment', image: false};
   }, fetchObject: async () => {
    let sent = false;
    return new Response(new ReadableStream({pull(controller) {if (sent) controller.close(); else {sent = true; controller.enqueue(new Uint8Array(failure === 'truncated' ? 1 : failure === 'excess' ? 4 : 3));}}, cancel() {cancelled++;}}, {highWaterMark: 0}),
     {headers: failure === 'encoding' ? {'Content-Encoding': 'gzip'} : failure === 'upstream-length' ? {'Content-Length': '9'} : {}});
   }});
  for (const suffix of ['&width=64', '&cache=bytes', '&fingerprint=1', '&retained=1', '&range=1', '&character=other', '&id=other'])
   assert.equal((await route({request: new Request(url + suffix, {headers})})).status, 400);
  const abort = new AbortController(), response = await route({request: new Request(url, {headers, signal: abort.signal})});
  if (failure === 'rate') {assert.equal(response.status, 503); assert.equal(downloads, 0);}
  else if (['encoding', 'upstream-length'].includes(failure)) {assert.equal(response.status, 502); assert.equal(cancelled, 1);}
  else if (failure === 'cancel') {const reader = response.body!.getReader(); await reader.read(); abort.abort(); await reader.cancel(); assert.equal(cancelled, 1);}
  else await assert.rejects(response.arrayBuffer(), /Original stream/);
 }
});

test('shared original progress budgets distinguish upstream inactivity, consumer backpressure and total expiry', async () => {
 const url = 'https://thingtime.example/api/v1/attachments/content?id=file&download=1&cache=original-bytes';
 const headers = {'If-Match': '"' + 'a'.repeat(64) + ':original:v1"'};
 const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
 for (const mode of ['idle', 'progress', 'total', 'authority', 'bad-length'] as const) {
  let count = 0, cancelled = 0, principals = 0;
  const route = createAttachmentContentLoader({getUser: async () => { if (++principals > 1 && mode === 'authority') await new Promise(() => {}); return null; }, enforceLimit: allowed as any, enrichViewer: async viewer => viewer,
   originalStreamPolicy: {idleMs: mode === 'idle' ? 5 : 30, totalMs: mode === 'total' ? 20 : mode === 'authority' ? 60 : 500},
   download: async () => ({ok: true, url: 'https://private.test/original', expiresAt: 'later', cacheKey: 'a'.repeat(64), version: 'b'.repeat(64), size: 6, contentType: 'application/octet-stream', disposition: 'attachment', image: false}),
   fetchObject: async () => new Response(new ReadableStream({async pull(controller) {
    if (mode === 'idle') return new Promise(() => {});
    await pause(5); if (count++ === 6) controller.close(); else controller.enqueue(new Uint8Array([count]));
   }, cancel() {cancelled++; return new Promise<void>(() => {});}}, {highWaterMark: 0}), {headers: mode === 'bad-length' ? {'Content-Length': '99'} : {}})
  });
  const response = await Promise.race([route({request: new Request(url, {headers})}), pause(100).then(() => {throw Error('Cancellation delayed the response');})]);
  if (mode === 'bad-length') {assert.equal(response.status, 502); assert.equal(cancelled, 1); continue;}
  if (mode === 'idle') {await assert.rejects(response.arrayBuffer(), /Original stream/); assert.equal(cancelled, 1); continue;}
  if (mode === 'authority') {await assert.rejects(response.arrayBuffer(), /Original stream/); continue;}
  const reader = response.body!.getReader(); await reader.read();
  await pause(mode === 'total' ? 30 : 60);
  if (mode === 'total') await assert.rejects(reader.read(), /Original stream/);
  else {let bytes = 1; for (;;) {const part = await reader.read(); if (part.done) break; bytes += part.value.length;} assert.equal(bytes, 6);}
 }
});

test('Character media selectors reuse session authorization and never fall back to public access', async () => {
  let header: string | null = null;
  let downloaded = false;
  const route = createAttachmentContentLoader({
    getUser: async request => { header = request.headers.get('X-Thingtime-Character'); return null; },
    enforceLimit: allowed as any,
    download: async () => { downloaded = true; return { ok: false, status: 404, error: 'missing' }; }
  });
  const result = await route({ request: new Request('https://thingtime.example/api/v1/attachments/content?id=file&character=other') });
  assert.equal(header, 'other'); assert.equal(result.status, 401); assert.equal(downloaded, false);
  const malformed = await route({ request: new Request('https://thingtime.example/api/v1/attachments/content?id=file&character=') });
  assert.equal(malformed.status, 400);
});

test('signed target mode accepts only full owner session and one closed exact range, returning private no-store JSON', async () => {
 const version = 'a'.repeat(64), query = `id=attachment&target=1&range=1&version=${version}&offset=0&length=10`;
 let calls = 0;
 const route = createAttachmentContentLoader({ getUser: async () => user, enforceLimit: allowed as any,
 downloadTarget: async (viewer, id, range) => { calls++; assert.deepEqual(viewer, { id: user.id }); assert.equal(id, 'attachment'); assert.deepEqual(range, { version, offset: 0, length: 10 }); return { ok: true, target: { version: 1, ownerId: user.id, attachmentId: 'attachment', contentVersion: version, offset: 0, length: 10, size: 10, fingerprint: {} as any, url: 'https://storage.example/signed', expiresAt: new Date(Date.now()+60000).toISOString(), headers: { Range: 'bytes=0-9' } } }; } });
 const response = await route({ request: new Request('https://thingtime.example/api/v1/attachments/content?' + query) });
 assert.equal(response.status, 200); assert.equal((await response.json()).target.ownerId, user.id); assert.match(response.headers.get('Cache-Control')!, /private.*no-store/); assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
 for (const suffix of ['&target=1', '&id=other', '&key=secret', '&retained=1', '&sharedRoot=page', '&cache=bytes', '&fingerprint=1', '&download=1', '&width=64', '&character=other', '&other=1']) {
  assert.equal((await route({ request: new Request('https://thingtime.example/api/v1/attachments/content?' + query + suffix) })).status, 400);
 }
 assert.equal(calls, 1);
 const anonymous = createAttachmentContentLoader({ getUser: async () => null, enforceLimit: allowed as any, downloadTarget: async () => { throw Error('anonymous cannot request targets'); } });
 assert.equal((await anonymous({ request: new Request('https://thingtime.example/api/v1/attachments/content?' + query) })).status, 404);
});

test('retry-safe link route retains full-user, origin, rate and private-response fences without upload approval', async () => {
  let calls = 0;
  const service = async (ownerId: string, body: unknown) => {
    calls++; assert.equal(ownerId, user.id); assert.equal((body as any).url, 'https://example.invalid/a.png');
    return { ok: false as const, status: 409, error: 'Fixture receipt conflict' };
  };
  const body = { url: 'https://example.invalid/a.png', requestId: 'link-request' };
  const route = (viewer: any = user, limit: any = allowed) => createAttachmentLinkAction({ getUser: async () => viewer, enforceLimit: limit }, service);
  for (const [viewer, status] of [[null, 401], [{ ...user, accountKind: 'service' }, 403]]) {
    const response = await route(viewer)({ request: post(body) }); assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  }
  assert.equal((await route()({ request: post(body, { Origin: 'https://attacker.invalid' }) })).status, 403);
  assert.equal((await route()({ request: post(body, { Authorization: 'Bearer ttnode_fixture' }) })).status, 403);
  assert.equal((await route(user, async () => ({ allowed: false, unavailable: true }))({ request: post(body) })).status, 503);
  assert.equal(calls, 0);
  const response = await route({ ...user, publicUploadsEnabled: false, privateUploadsEnabled: false })({ request: post(body) });
  assert.equal(response.status, 409); assert.equal(calls, 1);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  // Existing scoped Watch behavior for non-idempotent links remains unchanged.
  assert.equal((await route()({ request: post({ url: body.url }, { Authorization: 'Bearer ttnode_fixture' }) })).status, 409);
  assert.equal(calls, 2);
});
