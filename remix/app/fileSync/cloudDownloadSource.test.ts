import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudDownloadSource } from './cloudDownloadSource';
import { fingerprintSource } from './contentFingerprint';
const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'root' };
test('download source reads bounded pinned ranges, verifies content and refuses source/context/byte substitution', async () => {
	const bytes = new Uint8Array(8 * 1024 * 1024 + 17).fill(19),
		fingerprint = await fingerprintSource({ size: bytes.length, read: async (o, n) => bytes.slice(o, o + n), check: () => {} });
	const file = {
		id: 'file',
		revision: 'r1',
		name: 'file.bin',
		folderId: 'folder',
		trashed: false,
		content: { attachmentId: 'attachment', version: 'a'.repeat(64), size: bytes.length, fingerprint }
	};
	let current = { ...scope },
		changed = false,
		wrong = false,
		short = false,
		revoked = false;
	const ranges: number[] = [];
	const runtime = {
		currentScope: () => current,
		origin: () => scope.origin,
		requireCapability: async (_f: string, v: string) => assert.ok(['1.0.0', '1.14.0'].includes(v)),
		fetch: async (url: any, init: any) => {
			const u = new URL(String(url));
			assert.equal(u.origin, scope.origin);
			assert.equal(init.credentials, 'same-origin');
			assert.equal(init.redirect, 'error');
			assert.equal(init.headers['X-Thingtime-Expected-Actor'], 'owner');
			assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
			if (u.pathname === '/api/v1/files') return Response.json({ ok: true, file: { ...file, revision: changed ? 'r2' : 'r1' } });
			if (revoked) return Response.json({ ok: false }, { status: 404 });
			assert.equal(u.searchParams.get('version'), file.content.version);
			const offset = Number(u.searchParams.get('offset')),
				length = Number(u.searchParams.get('length'));
			ranges.push(length);
			return new Response(bytes.slice(offset, offset + length - (short ? 1 : 0)), {
				status: 206,
				headers: {
					ETag: '"' + (wrong ? 'b'.repeat(64) : file.content.version) + '"',
					'Content-Range': `bytes ${offset}-${offset + length - 1}/${bytes.length}`,
					'Content-Length': String(length)
				}
			});
		}
	};
	const source = createCloudDownloadSource(runtime, scope, file);
	assert.deepEqual(await source.read(0, bytes.length), bytes);
	assert.deepEqual(ranges, [2 * 1024 * 1024, 2 * 1024 * 1024, 2 * 1024 * 1024, 2 * 1024 * 1024, 17]);
	assert.deepEqual(await fingerprintSource(source), fingerprint);
	await source.verify!();
	changed = true;
	await assert.rejects(source.read(0, 1), /Cloud source changed/);
	changed = false;
	wrong = true;
	await assert.rejects(source.read(0, 1), /range version/);
	wrong = false;
	short = true;
	await assert.rejects(source.read(0, 1), /incomplete/);
	short = false;
	revoked = true;
	await assert.rejects(source.read(0, 1), /Cloud download request failed \(404\)/);
	revoked = false;
	current = { ...scope, ownerId: 'other' };
	await assert.rejects(source.read(0, 1), /context changed/);
	current = scope;
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(source.read(0, 1, abort.signal), { name: 'AbortError' });
	for (const [o, n] of [
		[-1, 1],
		[0, 33 * 1024 * 1024],
		[bytes.length, 1]
	])
		await assert.rejects(source.read(o, n), /Invalid/);
});
