import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopFolderHost } from './desktopFolders.client';
import { mobileFolderSource } from './mobileFolders.client';
const origin = 'https://sync.test';
const rootId = '00000000-0000-4000-8000-000000000001';
test('desktop folder failures show fixed compatibility guidance and hide arbitrary native details', async () => {
	const unsupported = 'The selected server does not support this version of folder sync.';
	for (const message of [unsupported,
		`Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${unsupported}`,
		'/private/user/folder: native transport failure', `secret prefix ${unsupported}`, '']) {
		await assert.rejects(createDesktopFolderHost({
			ownerId: 'owner', deviceId: 'device', signal: new AbortController().signal,
			rendererOrigin: () => 'http://127.0.0.1:12001', assertCurrent: () => {},
			bridge: { folderSyncRequest: async () => { throw Error(message); } }
		}), { message: message === unsupported || message.startsWith("Error invoking remote method '")
			? unsupported : 'Folder access could not be verified. Check the connection, pairing and selected account.' });
	}
});
function fixture() {
	const lifetime = new AbortController(),
		calls: any[] = [],
		network: any[] = [];
	let localOrigin = 'http://127.0.0.1:12001',
		current = true,
		patch: any = {},
		hold = false,
		release: (value: unknown) => void = () => {};
	let responseOrigin = origin;
	const bridge = {
		folderSyncRequest: async (input: any) => {
			calls.push(input);
			if (input.action === 'suspend') return {};
			const value = {
				...input,
				origin,
				roots: [{ id: rootId, name: 'Chosen', publicationVersion: '1.0.0' }],
				capabilities: { fileAccessVersion: '1.1.0', fileStagingVersion: '1.0.0', filePublicationVersion: '1.1.0' },
				apiCapabilities: { schemaVersion: 1, origin, features: { 'api.files': { version: '1.4.0' } } },
				...(input.action === 'read'
					? {
							chunk: {
								version: input.version,
								offset: input.offset,
								size: 131073,
								data: btoa('a'.repeat(Math.min(input.length, 131073 - input.offset)))
							}
					  }
					: {}),
				...patch
			};
			if (hold)
				return await new Promise((resolve) => {
					release = () => resolve(value);
				});
			return value;
		}
	};
	const fetcher: typeof fetch = async (url, init) => {
		network.push({ url: String(url), init });
		return new Response('ok', { headers: { 'x-thingtime-api-fallback': responseOrigin } });
	};
	const create = () =>
		createDesktopFolderHost({
			ownerId: 'owner',
			deviceId: 'device',
			bridge,
			signal: lifetime.signal,
			rendererOrigin: () => localOrigin,
			assertCurrent: () => {
				if (!current) throw Error('Identity changed');
			},
			fetch: fetcher
		});
	return {
		create,
		calls,
		network,
		lifetime,
		patch: (p: any) => {
			patch = p;
		},
		hold: (value = true) => {
			hold = value;
		},
		release: () => release({}),
		origin: (value: string) => {
			localOrigin = value;
		},
		current: (value: boolean) => {
			current = value;
		},
		responseOrigin: (value: string) => {
			responseOrigin = value;
		}
	};
}
const apiInit = {
	credentials: 'same-origin',
	cache: 'no-store',
	redirect: 'error',
	headers: {
		'X-Thingtime-Expected-Actor': 'owner',
		'X-Thingtime-Expected-Data-Plane': 'home'
	}
} satisfies RequestInit;
test('desktop context binds capabilities, origin and every native reply to the host-confirmed owner/device', async () => {
	const f = fixture(),
		host = await f.create();
	assert.equal(host.origin(), origin);
	assert.equal(host.capabilities?.platform, 'macos');
	await host.requireCapability('api.files', '1.3.0');
	await assert.rejects(host.requireCapability('api.files', '1.5.0'));
	await assert.rejects(host.requireCapability('api.actions-run', '1.0.0'));
	assert.equal((await host.request('owner', { action: 'list' }, f.lifetime.signal)).roots[0].id, rootId);
	await assert.rejects(host.request('other', { action: 'list' }, f.lifetime.signal));
	await assert.rejects(host.authorizeDevice('owner', 'other', f.lifetime.signal));
	for (const patch of [{ origin: 'https://other.test' }, { ownerId: 'other' }, { deviceId: 'other' }, { requestId: 'other' }]) {
		f.patch(patch);
		await assert.rejects(host.request('owner', { action: 'list' }, f.lifetime.signal));
	}
	f.patch({ apiCapabilities: { schemaVersion: 1, origin: 'https://other.test', features: {} } });
	await assert.rejects(host.authorizeDevice('owner', 'device', f.lifetime.signal));
});
test('desktop remaps only pinned authenticated API requests and never lends cookies to signed upload URLs', async () => {
	const f = fixture(),
		host = await f.create();
	await host.fetch(origin + '/api/v1/files?rootId=cloud', apiInit);
	assert.equal(f.network[0].url, 'http://127.0.0.1:12001/api/v1/files?rootId=cloud');
	assert.equal(f.network[0].init.credentials, 'same-origin');
	const signed = origin + '/signed-upload?signature=fixture';
	await host.fetch(signed, { method: 'PUT', credentials: 'omit', redirect: 'error', body: 'bytes' });
	assert.equal(f.network[1].url, signed);
	assert.equal(f.network[1].init.credentials, 'omit');
	for (const [url, init] of [
		['https://other.test/api/v1/files', apiInit],
		[origin + '/private', apiInit],
		[origin + '/api/v1/files', { ...apiInit, redirect: 'follow' }],
		[origin + '/api/v1/files', { ...apiInit, headers: {} }],
		[signed, { credentials: 'omit', redirect: 'error', headers: apiInit.headers }],
		['http://other.test/upload', { credentials: 'omit', redirect: 'error' }],
		[origin + '/api/v1/files', { ...apiInit, headers: { ...apiInit.headers, Authorization: 'not-a-real-token' } }]
	] as [string, RequestInit][])
		await assert.rejects(host.fetch(url, init));
	assert.equal(f.network.length, 2);
	f.responseOrigin('https://other.test');
	await assert.rejects(host.fetch(origin + '/api/v1/files', apiInit));
	f.current(false);
	await assert.rejects(host.fetch(signed, { credentials: 'omit', redirect: 'error' }));
	assert.equal(f.network.length, 3);
});
test('desktop native reads use the shared bounded source without a global mobile bridge', async () => {
	const f = fixture(),
		host = await f.create();
	const source = mobileFolderSource(
		'owner',
		rootId,
		{ path: 'file', id: 'native', version: '1', size: 131073, kind: 'file', sha256: 'a'.repeat(64) },
		f.lifetime.signal,
		host.request,
		host.capabilities
	);
	await source.check();
	assert.equal((await source.read(0, 131073)).length, 131073);
	assert.deepEqual(
		f.calls.filter((call) => call.action === 'read').map((call) => call.length),
		[1, 65536, 65536, 1]
	);
	assert.ok(f.calls.every((call) => call.verifiedChunks === undefined));
});
test('cancelled desktop calls stop waiting, suspend their original request, and discard late replies', async () => {
	const f = fixture(),
		host = await f.create();
	f.hold();
	const pending = host.request('owner', { action: 'choose' }, f.lifetime.signal);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const original = f.calls.at(-1);
	f.lifetime.abort();
	await assert.rejects(pending);
	assert.deepEqual(f.calls.at(-1), { requestId: original.requestId, ownerId: 'owner', deviceId: 'device', origin, action: 'suspend' });
	f.release();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.throws(host.origin);
});
test('context negotiation can cancel before the renderer learns the host-selected origin', async () => {
	const f = fixture();
	f.hold();
	const pending = f.create();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const original = f.calls.at(-1);
	f.lifetime.abort();
	await assert.rejects(pending);
	assert.equal(f.calls.at(-1).requestId, original.requestId);
	assert.equal(f.calls.at(-1).origin, undefined);
	f.release();
	await new Promise((resolve) => setTimeout(resolve, 0));
});

test('queued requests keep immutable payloads and cancelled waiters never dispatch', async () => {
	const f = fixture(),
		host = await f.create();
	f.hold();
	const first = host.request('owner', { action: 'choose' }, f.lifetime.signal);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const request = { action: 'remove' as const, rootId };
	const second = host.request('owner', request, f.lifetime.signal);
	request.rootId = 'changed-after-enqueue';
	const cancelled = new AbortController();
	const third = host.request('owner', { action: 'list' }, cancelled.signal);
	cancelled.abort();
	await assert.rejects(third);
	f.hold(false);
	f.release();
	await first;
	await second;
	assert.deepEqual(
		f.calls.filter((call) => call.action !== 'context').map((call) => ({ action: call.action, rootId: call.rootId })),
		[
			{ action: 'choose', rootId: undefined },
			{ action: 'remove', rootId }
		]
	);
});


test('desktop excluded scans fail before dispatch on an older native host', async () => {
	const f = fixture(), host = await f.create(), calls = f.calls.length;
	for (const request of [{ action: 'scan' as const, rootId, excludedPaths: ['Library'] },
		{ action: 'scan-capture' as const, rootId, captureId: crypto.randomUUID(), inventoryDeviceId: 'device', excludedPaths: ['Library'] }])
		await assert.rejects(host.request('owner', request, f.lifetime.signal), /Update Thingtime to exclude paths/);
	assert.equal(f.calls.length, calls);
});

test('fixed native verification and shutdown waits survive IPC redaction; arbitrary and authority failures remain terminal', async () => {
 const { SyncConnectionWait, isSyncConnectionFailure } = await import('./syncConnectionWait');
 for (const marker of ['[folder_identity_retry] Folder identity verification is temporarily unavailable. Retry after reconnecting.',
  '[folder_sync_shutdown] Thingtime is closing. Saved sync work can resume when reopened.']) {
 for (const message of [marker, `Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${marker}`,
  `private-prefix ${marker}`, `${marker} private-suffix`, 'Folder access changed. Reopen this device with the current account.']) {
  for (const initial of [true, false]) {
   let fail = initial;
   const bridge = { folderSyncRequest: async (input: any) => {
    if (fail) throw Error(message);
    return { ...input, origin, capabilities: { fileAccessVersion: '1.10.0' },
     apiCapabilities: { schemaVersion: 1, origin, features: {} } };
   } };
   const attempt = async () => {
    const host = await createDesktopFolderHost({ ownerId: 'owner', deviceId: 'device', bridge,
     signal: new AbortController().signal, rendererOrigin: () => 'http://127.0.0.1:12001', assertCurrent: () => {} });
    fail = true;
    await host.request('owner', { action: 'list' }, new AbortController().signal);
   };
   const expected = message === marker || message.startsWith("Error invoking remote method '");
   await assert.rejects(attempt(), error => {
    assert.equal(error instanceof SyncConnectionWait, expected);
    assert.equal(isSyncConnectionFailure(error), expected);
    assert.doesNotMatch((error as Error).message, /private-prefix|private-suffix|folder_identity_retry|folder_sync_shutdown/);
    return true;
   });
  }
 }
 }
});
