import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_LOCAL_FILE_SYNC_URL,
	adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH,
	artifacts = process.env.TT_LOCAL_FILE_SYNC_ARTIFACTS;

test('existing account file deletion through full-user browser contexts retains a durable receipt without an upload request ID',
	{ skip: !base || !adminFile || !playwrightPath, timeout: 120_000 }, async () => {
		assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
		const { chromium } = await import(playwrightPath!), browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
		const owner = await browser.newContext(), admin = await browser.newContext(), guest = await browser.newContext();
		const headers = { Origin: new URL(base!).origin }, url = (path: string) => new URL(path, base).href;
		let fileId = '';
		try {
			const administrator = JSON.parse(await readFile(adminFile!, 'utf8'));
			assert.equal((await admin.request.post(url('/api/v1/login'), { headers, data: { username: administrator.username, password: administrator.password } })).status(), 200);
			const username = 'existing-file-' + randomUUID().slice(0, 8);
			const registered = await owner.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
			assert.equal(registered.status(), 200, await registered.text());
			const user = (await registered.json()).user;
			assert.equal((await admin.request.post(url('/api/v1/admin/users/public-uploads'), { headers, data: { userId: user.id, enabled: true, scope: 'private' } })).status(), 200);
			const bytes = Buffer.from('Existing account file; no device upload intent.'), requestId = randomUUID();
			const upload = { requestId, filename: 'existing.txt', contentType: 'text/plain', sizeBytes: bytes.length, purpose: 'file' };
			const start = await owner.request.post(url('/api/v1/attachments/uploads'), { headers, data: upload });
			assert.equal(start.status(), 200, await start.text()); fileId = (await start.json()).upload.id;
			const parts = await owner.request.post(url('/api/v1/attachments/uploads/parts'), { headers, data: { uploadId: fileId, parts: [{ partNumber: 1, checksumSha256: createHash('sha256').update(bytes).digest('base64') }] } });
			assert.equal(parts.status(), 200, await parts.text());
			const part = (await parts.json()).parts[0];
			assert.ok(['127.0.0.1', 'localhost'].includes(new URL(part.url).hostname), 'Only disposable loopback object storage');
			assert.equal((await guest.request.put(part.url, { headers: part.headers, data: bytes })).status(), 200);
			const complete = await owner.request.post(url('/api/v1/attachments/uploads/complete'), { headers, data: { uploadId: fileId } });
			assert.equal(complete.status(), 200, await complete.text());
			const read = async () => {
				const response = await owner.request.get(url('/api/v1/things?id=' + fileId));
				assert.equal(response.status(), 200); return (await response.json()).thing;
			};
			const initial = await read(), input = { id: fileId, retainReceipt: true, expectedUpdatedAt: initial.updatedAt };
			assert.equal((await guest.request.post(url('/api/v1/attachments/delete'), { headers, data: input })).status(), 401);
			assert.equal((await admin.request.post(url('/api/v1/attachments/delete'), { headers, data: input })).status(), 404, 'Even an administrator cannot delete a foreign file through the owner route');
			assert.equal((await owner.request.post(url('/api/v1/attachments/delete'), { headers: { Origin: 'https://foreign.test' }, data: input })).status(), 403);
			assert.equal((await owner.request.post(url('/api/v1/attachments/annotate'), { headers, data: { id: fileId, expectedUpdatedAt: initial.updatedAt, title: 'Edited elsewhere' } })).status(), 200);
			assert.equal((await owner.request.post(url('/api/v1/attachments/delete'), { headers, data: input })).status(), 409);
			assert.deepEqual(await (await owner.request.get(url(`/api/v1/attachments/content?id=${fileId}&cache=bytes&download=1`))).body(), bytes);
			input.expectedUpdatedAt = (await read()).updatedAt;
			const [deleting, editing] = await Promise.all([
				owner.request.post(url('/api/v1/attachments/delete'), { headers, data: input }),
				owner.request.post(url('/api/v1/attachments/annotate'), { headers, data: { id: fileId, expectedUpdatedAt: input.expectedUpdatedAt, title: 'Concurrent edit' } })
			]);
			assert.equal([deleting, editing].filter(response => response.status() === 200).length, 1);
			if (editing.status() === 200) {
				assert.equal(deleting.status(), 409); input.expectedUpdatedAt = (await read()).updatedAt;
				assert.equal((await owner.request.post(url('/api/v1/attachments/delete'), { headers, data: input })).status(), 200);
			} else assert.ok([404, 409].includes(editing.status()));
			// The first successful response is deliberately not used by the retry.
			const retry = await owner.request.post(url('/api/v1/attachments/delete'), { headers, data: input });
			assert.equal(retry.status(), 200); assert.deepEqual(await retry.json(), { ok: true, deleted: true, deferred: false });
			assert.match(retry.headers()['cache-control'], /private.*no-store/);
			assert.equal((await owner.request.get(url('/api/v1/attachments/content?id=' + fileId))).status(), 404);
			const replay = await owner.request.post(url('/api/v1/attachments/uploads'), { headers, data: upload });
			assert.equal(replay.status(), 409); assert.equal((await replay.json()).code, 'upload_cancelled');
			const missingId = randomUUID();
			assert.equal((await owner.request.post(url('/api/v1/attachments/delete'), { headers, data: { ...input, id: missingId } })).status(), 404);
			const report = { existingFileReceipt: true, privateNoStore: true, missingIdRefused: true, guestRefused: true, foreignOwnerRefused: true, crossOriginRefused: true, staleVersionRefused: true, concurrentEditSingleWinner: true, replayAfterDiscardedResponse: true, delayedStartRefused: true, fileId, localOnly: true };
			if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await writeFile(resolve(artifacts, 'existing-file-deletion.json'), JSON.stringify(report, null, 2)); }
		} finally {
			if (fileId) await owner.request.post(url('/api/v1/attachments/delete'), { headers, data: { id: fileId } }).catch(() => {});
			await Promise.all([owner.close(), admin.close(), guest.close()]); await browser.close();
		}
	});
