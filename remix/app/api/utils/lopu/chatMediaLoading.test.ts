import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLopuMedia } from './chatMedia.server';
import { lopuNetworkRequest } from './network.server';

const fixture = (options: { deny?: boolean; revoked?: boolean; type?: string; size?: number; linked?: boolean; body?: string } = {}) => {
	let downloads = 0,
		fetches = 0;
	const bytes = options.body ?? 'pixels';
	const deps = {
		describe: async () =>
			options.deny
				? { ok: false }
				: {
						ok: true,
						linked: options.linked ?? false,
						attachment: { id: 'one', name: 'test', size: options.size ?? bytes.length, contentType: options.type ?? 'image/png' }
				  },
		download: async () => {
			downloads++;
			return options.revoked && downloads > 1
				? { ok: false }
				: { ok: true, url: 'https://object.example/signed', cacheKey: 'version-one', size: bytes.length };
		},
		fetch: async (_url: string, init: RequestInit) => {
			fetches++;
			assert.equal(init.redirect, 'error');
			return new Response(bytes);
		}
	};
	return { deps: deps as any, fetches: () => fetches };
};
test('authorized images and text are loaded; access refusal never fetches bytes', async () => {
	const ok = fixture();
	assert.equal((await resolveLopuMedia('owner', ['one'], undefined, ok.deps)).media[0].data, Buffer.from('pixels').toString('base64'));
	const text = fixture({ type: 'text/plain', body: 'actual contents' });
	assert.match((await resolveLopuMedia('owner', ['one'], undefined, text.deps)).text, /actual contents/);
	const denied = fixture({ deny: true });
	assert.equal((await resolveLopuMedia('owner', ['one'], undefined, denied.deps)).media.length, 0);
	assert.equal(denied.fetches(), 0);
});
test('revocation during download discards bytes, and linked/oversized/unsupported files stay explicit', async () => {
	const revoked = fixture({ revoked: true });
	const result = await resolveLopuMedia('owner', ['one'], undefined, revoked.deps);
	assert.equal(result.media.length, 0);
	assert.match(result.text, /could not be read/);
	for (const options of [{ linked: true }, { size: 6 * 1024 * 1024 }, { type: 'video/mp4' }]) {
		const item = fixture(options);
		const result = await resolveLopuMedia('owner', ['one'], undefined, item.deps);
		assert.equal(item.fetches(), 0);
		assert.equal(result.media.length, 0);
		assert.match(result.text, /not sent/);
	}
});
test('network transport refuses private literals and mapped private IPv6 before opening sockets', async () => {
	for (const url of [
		'https://127.0.0.1',
		'https://169.254.169.254',
		'https://10.0.0.1',
		'https://[::1]',
		'https://[::ffff:127.0.0.1]',
		'https://localhost'
	])
		await assert.rejects(lopuNetworkRequest({ url }), /Private|public/);
});

test('HTTP transport pins DNS and bounds responses without redirects or ambient credentials', async () => {
	const { EventEmitter } = await import('node:events');
	const { PassThrough } = await import('node:stream');
	const exercise = (status: number, content: string, contentType = 'text/plain', addresses = [{ address: '93.184.216.34', family: 4 }]) => {
		let calls = 0;
		const deps = {
			lookup: async () => addresses,
			request: (_url: URL, options: any, callback: any) => {
				calls++;
				assert.equal(options.agent, false);
				assert.equal(options.headers.cookie, undefined);
				options.lookup('example.com', { all: true }, (_error: unknown, pinned: unknown) => assert.deepEqual(pinned, [addresses[0]]));
				const req = new EventEmitter() as any;
				req.end = () =>
					queueMicrotask(() => {
						const response = new PassThrough() as any;
						response.statusCode = status;
						response.headers = { 'content-type': contentType };
						callback(response);
						response.end(content);
					});
				return req;
			}
		};
		const result = lopuNetworkRequest({ url: 'https://example.com' }, undefined, deps as any);
		return { result, calls: () => calls };
	};
	const valid = exercise(200, 'actual body');
	assert.equal((await valid.result).body, 'actual body');
	const redirect = exercise(302, 'redirect');
	await assert.rejects(redirect.result, /Redirect refused/);
	assert.equal(redirect.calls(), 1);
	const large = exercise(200, 'x'.repeat(256 * 1024 + 1));
	await assert.rejects(large.result, /exceeds/);
	const binary = exercise(200, 'bytes', 'image/png');
	await assert.rejects(binary.result, /Only uncompressed/);
	const mixed = exercise(200, 'no', 'text/plain', [
		{ address: '93.184.216.34', family: 4 },
		{ address: '10.0.0.1', family: 4 }
	]);
	await assert.rejects(mixed.result, /public addresses/);
	assert.equal(mixed.calls(), 0);
});
