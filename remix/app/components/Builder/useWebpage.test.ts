import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveWebpageClient, webpageAclForToggle } from './useWebpage';
import { MAX_WEBPAGE_ROUTE_CHARS } from '~/schemas/registry';

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
	globalThis.fetch = ((url: string) => {
		calls.push(String(url));
		return impl(String(url));
	}) as typeof globalThis.fetch;
	try {
		return { result: await run(), calls };
	} finally {
		globalThis.fetch = original;
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

// The public toggle owns the tt:all entry and nothing else — hidden links,
// custom audiences (tt:user/<name>) and app grants (tt:app/<id>) share the
// list and must survive a publish/unpublish round trip.
test('the public toggle only adds and removes tt:all', () => {
	assert.deepEqual(webpageAclForToggle(['tt:user'], true), ['tt:user', 'tt:all']);
	assert.deepEqual(webpageAclForToggle(['tt:user', 'tt:all'], false), ['tt:user']);
	assert.deepEqual(webpageAclForToggle(['tt:user', 'tt:hidden', 'tt:user/ada', 'tt:app/x'], true), [
		'tt:user',
		'tt:hidden',
		'tt:user/ada',
		'tt:app/x',
		'tt:all'
	]);
	assert.deepEqual(webpageAclForToggle(['tt:all', 'tt:hidden', 'tt:app/x'], false), ['tt:user', 'tt:hidden', 'tt:app/x']);
	// a missing/garbage acl degrades to owner-only rather than throwing
	assert.deepEqual(webpageAclForToggle(undefined, false), ['tt:user']);
	assert.deepEqual(webpageAclForToggle('not-a-list', true), ['tt:user', 'tt:all']);
	// tt:all is never duplicated by a repeated publish
	assert.deepEqual(webpageAclForToggle(['tt:user', 'tt:all'], true), ['tt:user', 'tt:all']);
});
