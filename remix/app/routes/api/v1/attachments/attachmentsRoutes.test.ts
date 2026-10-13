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
	for (const purpose of ['message', 'profile-avatar', 'profile-banner', 'recording', 'recording-import']) {
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
	assert.equal((await gated(privateOnly)({ request: post({ purpose: 'recording' }) })).status, 200);
	assert.equal((await gated(privateOnly)({ request: post({ purpose: 'recording-import' }) })).status, 200);
	assert.equal((await gated(publicOnly)({ request: post({ purpose: 'recording-import' }) })).status, 403);
	assert.equal((await gated(privateOnly)({ request: post({ purpose: 'comment' }) })).status, 403);
	const approvedAll = { id: 'user-ok', accountKind: 'user', publicUploadsEnabled: true, privateUploadsEnabled: true } as any;
	assert.equal((await gated(approvedAll)({ request: post({}) })).status, 200);
	assert.equal((await gated(approvedAll)({ request: post({ purpose: 'message' }) })).status, 200);
	assert.equal(serviceCalls, 6);

	// an unknown purpose reaches the service's own validation (no scope gates it)
	assert.equal((await gated(pending)({ request: post({ purpose: 'nonsense' }) })).status, 200);
	assert.equal(serviceCalls, 7);

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
