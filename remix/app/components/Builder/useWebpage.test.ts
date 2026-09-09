import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeSavedWebpage, resolveWebpageClient, type ResolvedWebpage } from './useWebpage';
import { MAX_WEBPAGE_ROUTE_CHARS } from '~/schemas/registry';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from '~/api/utils/capabilities/capabilityContract';

// SiteBlocksHost resolves the site doc for EVERY route a signed-in viewer
// lands on, so resolveWebpageClient screens the path against the same bounds
// the server gate applies before spending a request. These assertions pin the
// two halves of that contract: paths the gate could never accept never leave
// the client, and paths it can accept still go out unchanged.

const withFetch = async <T,>(
	impl: (url: string) => Promise<Response>,
	run: () => Promise<T>
): Promise<{ result: T; calls: string[] }> => {
	const calls: string[] = [];
	const original = globalThis.fetch;
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://test.example' } } });
	globalThis.fetch = ((url: string) => {
		if (String(url) === THINGTIME_CAPABILITY_MANIFEST_PATH) {
			return Promise.resolve({ ok: true, json: async () => ({ schemaVersion: 1, origin: 'https://test.example', features: { 'api.webpages-resolve': { version: '1.2.0' } } }) } as Response);
		}
		calls.push(String(url));
		return impl(String(url));
	}) as typeof globalThis.fetch;
	try {
		return { result: await run(), calls };
	} finally {
		globalThis.fetch = original;
		if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
		else Reflect.deleteProperty(globalThis, 'window');
	}
};

const okResponse = () =>
	Promise.resolve({
		ok: true,
		json: async () => ({ ok: true, page: null, source: null, components: [], refs: {} })
	} as unknown as Response);

test('paths the server route gate refuses never reach the network', async () => {
	// /post/<id> and the `*` thing-tree catch-all routinely carry uppercase,
	// dots and percent-escapes; WEBPAGE_ROUTE_PATTERN accepts none of them
	const refused = [
		'/post/AbC123',
		'/docs/api/Things/Get',
		'/u/SomeUser',
		'/thing/a.b',
		'/search%20me',
		'no-leading-slash',
		`/${'a'.repeat(MAX_WEBPAGE_ROUTE_CHARS + 1)}`
	];
	for (const path of refused) {
		const { result, calls } = await withFetch(okResponse, () => resolveWebpageClient({ kind: 'path', path }));
		assert.equal(result, null, `expected ${path} to resolve to null`);
		assert.deepEqual(calls, [], `expected ${path} to make no request`);
	}
});

test('paths the server route gate accepts still resolve over the network', async () => {
	for (const path of ['/', '/status', '/mongodb-status', '/apps/manage', '/docs/design-system', '/a_b/c-d']) {
		const { result, calls } = await withFetch(okResponse, () => resolveWebpageClient({ kind: 'path', path }));
		assert.ok(result, `expected ${path} to resolve`);
		assert.equal(calls.length, 1, `expected ${path} to make exactly one request`);
		assert.ok(calls[0].includes(`path=${encodeURIComponent(path)}`), `expected ${path} in the query`);
	}
});

test('id and global targets are never path-screened', async () => {
	const byId = await withFetch(okResponse, () => resolveWebpageClient({ kind: 'id', id: 'Mixed-Case-ShareId' }));
	assert.equal(byId.calls.length, 1);
	const global = await withFetch(okResponse, () => resolveWebpageClient({ kind: 'global' }));
	assert.equal(global.calls.length, 1);
	assert.ok(global.calls[0].includes('global=1'));
});

test('a standalone page forwards its hidden-link bearer key', async () => {
	const { calls } = await withFetch(okResponse, () =>
		resolveWebpageClient({ kind: 'id', id: 'hidden-page', key: 'secret key' })
	);
	assert.equal(calls.length, 1);
	assert.ok(calls[0].includes('id=hidden-page'));
	assert.ok(calls[0].includes('key=secret%20key'));
});

test('saved webpages adopt and clear owner-only hidden-link keys with their ACL', () => {
	const initial: ResolvedWebpage = {
		page: {
			id: 'page-1',
			crystal: { name: 'Shared page', siteRoute: '/shared', blocks: [] },
			acl: ['tt:user', 'tt:hidden'],
			linkKey: 'old-key'
		},
		source: 'user' as const,
		componentsByRef: {}
	};
	const refreshed = mergeSavedWebpage(initial, {
		id: 'page-1',
		crystal: initial.page?.crystal as unknown as Record<string, unknown>,
		acl: ['tt:user', 'tt:hidden'],
		linkKey: 'fresh-key'
	});
	assert.equal(refreshed?.page?.linkKey, 'fresh-key');

	const publicPage = mergeSavedWebpage(refreshed, {
		id: 'page-1',
		crystal: initial.page?.crystal as unknown as Record<string, unknown>,
		acl: ['tt:user', 'tt:all']
	});
	assert.equal(publicPage?.page?.linkKey, undefined);
});
