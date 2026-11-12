import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeTransferArchive, encodeTransferArchive, transferChecksum } from '../utils/thingTransfer/archive';
import { validateTransfer } from '../utils/thingTransfer/format';

const base = process.env.TT_DRAFT_WEB_BASE, artifacts = process.env.TT_DRAFT_ARTIFACT_DIR;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE;

test('native account Duplicate copies offline file bytes privately and independent queues resume after reconnect', {
	skip: !base || !artifacts || !playwrightPath || !adminFile, timeout: 300_000
}, async t => {
	assert.equal(new URL(base!).hostname, '127.0.0.1');
	assert.ok(process.env.TT_RENDER_SESSION, 'Use a disposable isolated full-app runtime.');
	const health = await (await fetch(base + '/api/v1/health/nitro', { redirect: 'error' })).json();
	assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
	assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
	await mkdir(artifacts!, { recursive: true });
	const { chromium } = await import(playwrightPath!);
	const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	t.after(() => browser.close());
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
	const admin = await browser.newContext(), guest = await browser.newContext(), page = await context.newPage();
	const url = (path: string) => new URL(path, base).href;
	const runId = randomUUID(), folderName = 'Offline file copy ' + runId.slice(0, 8);
	const bytes = Buffer.from(('Private device copy · 独立 🌿\n' + runId + '\n').repeat(257));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	type Phase = 'online' | 'disconnecting' | 'offline' | 'reconnecting';
	type ObservedWrite = { path: string; offline: boolean; phase: Phase; at: number; operation?: string; bulkOperation?: string; actor?: string; plane?: string; response?: { status: number; phase: Phase; at: number }; failure?: string };
	const errors: string[] = [], writes: ObservedWrite[] = [];
	const writeRequests = new Map<any, ObservedWrite>();
	const connectivityEvents: { phase: Phase; at: number }[] = [];
	const offlineHttpSuccesses: { path: string; status: number; at: number }[] = [];
	const bounds: { width: number; scrollWidth: number }[] = [];
	let phase: Phase = 'online', ownerId = '', sourceRoot = '', copyRoot = '', failedOriginalUploads = 0;
	let sourceFileId = '', copyFileId = '', originalRequestId = '';
	let lastRemoteFile: unknown;
	const network = await context.newCDPSession(page);
	await network.send('Network.enable');
	const connectivity = async (value: boolean) => {
		phase = value ? 'disconnecting' : 'reconnecting';
		connectivityEvents.push({ phase, at: Date.now() });
		await context.setOffline(value);
		// A loopback-only OS fixture also needs Chromium's explicit online signal.
		await network.send('Network.overrideNetworkState', { offline: value, latency: 1,
			downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
		assert.equal(await page.evaluate(() => navigator.onLine), !value);
		if (value) assert.equal(await page.evaluate(async () => {
			try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; }
		}), true, 'The real root-data request must fail before offline acceptance starts');
		phase = value ? 'offline' : 'online';
		connectivityEvents.push({ phase, at: Date.now() });
	};
	page.setDefaultTimeout(25_000);
	page.on('pageerror', (error: Error) => errors.push(error.message));
	page.on('request', (request: any) => {
		if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
			let operation: string | undefined, bulkOperation: string | undefined;
			const path = new URL(request.url()).pathname;
			try { const body = request.postDataJSON(); operation = body?.operation; if (path === '/api/v1/things/bulk') bulkOperation = body?.op; } catch { /* Byte uploads have no JSON operation. */ }
			const row = { path, offline: phase === 'offline', phase, at: Date.now(), operation, bulkOperation,
				actor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'] };
			writes.push(row); writeRequests.set(request, row);
		}
	});
	page.on('response', (response: any) => {
		const row = writeRequests.get(response.request());
		if (row) row.response = { status: response.status(), phase, at: Date.now() };
		const path = new URL(response.url()).pathname;
		if (phase === 'offline' && path.startsWith('/api/') && !response.fromServiceWorker() && response.status() >= 200 && response.status() < 400)
			offlineHttpSuccesses.push({ path, status: response.status(), at: Date.now() });
	});
	page.on('requestfailed', (request: any) => {
		const row = writeRequests.get(request); if (row) row.failure = request.failure()?.errorText || 'Request failed';
	});
	const api = (method: string, path: string, data?: unknown) => page.evaluate(async ({ method, path, data, ownerId }) => {
		const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
			headers: { 'X-Thingtime-Expected-Actor': ownerId, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
			...(data === undefined ? {} : { body: JSON.stringify(data) }) });
		return { status: response.status, body: await response.json() };
	}, { method, path, data, ownerId });
	// The worker's durable claim may survive a reload for up to 60 seconds.
	const poll = async (read: () => Promise<any>, accept: (value: any) => boolean, attempts = 225) => {
		let last: any;
		for (let attempt = 0; attempt < attempts; attempt++) {
			last = await read(); if (accept(last)) return last;
			await page.waitForTimeout(400);
		}
		throw Error('Account copy did not converge: ' + JSON.stringify(last));
	};
	// Observe only this synthetic account's scoped records; all mutations use UI/API.
	const snapshot = () => page.evaluate(async ownerId => {
		const scope = JSON.stringify(['account', location.origin, ownerId, 'home']);
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('thingtime.local-workspaces.v1');
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			const rows = await new Promise<any[]>((resolve, reject) => {
				const request = db.transaction('records', 'readonly').objectStore('records').getAll();
				request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
			});
			return {
				things: rows.filter(row => row.scope === scope && row.collection === 'things').map(row => row.value),
				files: rows.filter(row => row.scope === scope && row.collection === 'account-files').map(row => ({
					id: row.id, state: row.value.state, sha256: row.value.sha256, phase: row.value.phase, error: row.value.error,
					contentType: row.value.request.contentType, remoteContentType: row.value.remote?.contentType,
					requestId: row.value.request.requestId || row.id.replace(/^local-file-/, ''), remoteId: row.value.remote?.id
				})),
				metadata: rows.filter(row => row.scope === scope && row.collection === 'account-file-metadata').map(row => row.value),
				contentSync: rows.filter(row => row.scope === scope && row.collection === 'thing-sync').map(row => ({
					id: row.id, state: row.value.state, deleted: row.value.deleted, error: row.value.error, remoteId: row.value.base?.id
				}))
			};
		} finally { db.close(); }
	}, ownerId);
	const folderLink = (id: string) => page.locator(`a[href*="folder=${encodeURIComponent(id)}"]`).first();
	const exportFolder = async (id: string, name: string) => {
		await page.goto(url('/things'));
		await folderLink(id).click({ button: 'right' });
		await page.getByRole('menuitem', { name: '📥 Download…', exact: true }).click();
		await page.getByLabel('Download format', { exact: true }).selectOption('zip');
		const waiting = page.waitForEvent('download');
		await page.getByRole('dialog').getByRole('button', { name: 'Download', exact: true }).click();
		const download = await waiting, path = resolve(artifacts!, name + '.thingtime.zip');
		await download.saveAs(path);
		const bundle = await decodeTransferArchive(await readFile(path));
		assert.equal(bundle.manifest.roots[0], id);
		assert.equal(bundle.manifest.things.length, 3);
		assert.equal(bundle.manifest.files.length, 1);
		for (const content of bundle.files.values()) assert.deepEqual(Buffer.from(content), bytes);
		return bundle.manifest;
	};
	const failOriginal = async (route: any) => {
		if (route.request().method() === 'POST' && route.request().postDataJSON().requestId === originalRequestId) {
			failedOriginalUploads++;
			// Keep the ordinary Retry upload control available until this fixture
			// releases the outage; manual retry must override the server's backoff.
			return route.fulfill({ status: 503, headers: { 'Retry-After': '120' }, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Isolated source upload outage' }) });
		}
		return route.continue();
	};
	try {
		await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
		const username = 'copyfiles-' + runId.slice(0, 8);
		const registration = await context.request.post(url('/api/v1/auth/register'), { headers: { Origin: base! },
			data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
		assert.equal(registration.status(), 200, await registration.text());
		ownerId = (await registration.json()).user.id;
		// Only generated fixture credentials are read; browser fetch preserves the
		// real Secure-cookie policy on the isolated loopback origin.
		const administrator = JSON.parse(await readFile(adminFile!, 'utf8'));
		const adminPage = await admin.newPage();
		await adminPage.goto(url('/.well-known/thingtime-capabilities.json'));
		assert.equal(await adminPage.evaluate(async credentials => (await fetch('/api/v1/login', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials)
		})).status, { username: administrator.username, password: administrator.password }), 200);
		assert.equal(await adminPage.evaluate(async userId => (await fetch('/api/v1/admin/users/public-uploads', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, enabled: true, scope: 'private' })
		})).status, ownerId), 200);
		await connectivity(false);
		await page.goto(url('/things'));
		await page.getByRole('button', { name: 'Import…', exact: true }).waitFor();
		await page.waitForFunction(async () => {
			await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
			for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') &&
				await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
			return false;
		});
		const manifest = validateTransfer({ format: 'thingtime.transfer', version: 1, roots: ['folder'], things: [
			{ id: 'folder', thingtime: ['folder'], crystal: { name: folderName } },
			{ id: 'data', thingtime: ['data'], folderId: 'folder', crystal: { name: 'Independent copy data', text: '私有 · ' + runId } },
			{ id: 'file', thingtime: ['attachment'], folderId: 'folder', crystal: { recordingFileId: 'portable-bytes', filePurpose: 'file' } }
		], files: [{ id: 'portable-bytes', targetId: 'file', path: 'files/000000', name: 'private-copy.txt', mime: 'text/plain',
			bytes: bytes.length, sha256: await transferChecksum(bytes), title: 'Private copied file' }] });
		const archive = await encodeTransferArchive({ manifest, files: new Map([['portable-bytes', bytes]]) });
		await connectivity(true);
		await page.reload();
		await page.getByRole('button', { name: 'Import…', exact: true }).click();
		await page.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles({
			name: 'copy-source.thingtime.zip', mimeType: 'application/zip', buffer: Buffer.from(archive)
		});
		await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		const sourceLink = page.getByRole('link', { name: folderName, exact: true });
		await sourceLink.waitFor();
		sourceRoot = new URL((await sourceLink.getAttribute('href'))!, base).searchParams.get('folder')!;
		assert.ok(sourceRoot);
		const before = await snapshot();
		assert.equal(before.files.length, 1);
		sourceFileId = before.files[0].id; originalRequestId = before.files[0].requestId;
		assert.equal(before.files[0].sha256, sha256); assert.equal(before.files[0].remoteId, undefined);
		const previousFolders = new Set(before.things.filter((row: any) => row.thingtime.includes('folder')).map((row: any) => row.id));
		const source = await exportFolder(sourceRoot, 'source-offline');
		await folderLink(sourceRoot).click({ button: 'right' });
		await page.getByRole('menuitem', { name: /Duplicate/ }).click();
		const copied = await poll(snapshot, value => value.things.some((row: any) => row.thingtime.includes('folder') && !previousFolders.has(row.id)) && value.files.length === 2);
		const newFolders = copied.things.filter((row: any) => row.thingtime.includes('folder') && !previousFolders.has(row.id));
		assert.equal(newFolders.length, 1);
		copyRoot = newFolders[0].id;
		copyFileId = copied.files.find((row: any) => row.id !== sourceFileId).id;
		assert.notEqual(copyRoot, sourceRoot); assert.notEqual(copyFileId, sourceFileId);
		assert.equal(new Set(copied.files.map((row: any) => row.requestId)).size, 2);
		assert.ok(copied.files.every((row: any) => row.sha256 === sha256 && !row.remoteId));
		await page.reload();
		const copy = await exportFolder(copyRoot, 'copy-cold-offline');
		const sourceIds = new Set(source.things.map(row => row.id));
		assert.ok(copy.things.every(row => !sourceIds.has(row.id)));
		assert.notEqual(copy.files[0].id, source.files[0].id);
		assert.equal(copy.things.find(row => row.thingtime.includes('data'))!.crystal.text, '私有 · ' + runId);
		const unchanged = await exportFolder(sourceRoot, 'source-unchanged-offline');
		assert.deepEqual(unchanged.things, source.things);
		assert.deepEqual(unchanged.files, source.files);
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
			await page.goto(url('/things?folder=' + copyRoot));
			await page.getByRole('link', { name: 'Independent copy data', exact: true }).waitFor();
			await page.getByRole('link', { name: 'Independent copy data', exact: true }).scrollIntoViewIfNeeded();
			const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
			assert.equal(scrollWidth, width); bounds.push({ width, scrollWidth });
			await page.screenshot({ path: resolve(artifacts!, `offline-copy-${width}.png`), animations: 'disabled' });
		}
		assert.deepEqual(writes.filter(row => row.offline), []); assert.deepEqual(offlineHttpSuccesses, []);
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.route('**/api/v1/attachments/uploads', failOriginal);
		await connectivity(false);
		await page.reload();
		await poll(async () => failedOriginalUploads, value => value > 0);
		const copyDataId = copy.things.find(row => row.thingtime.includes('data'))!.id;
		const remoteData = await poll(() => api('GET', '/api/v1/things?id=' + copyDataId), value => value.status === 200);
		assert.equal(remoteData.body.thing.crystal.text, '私有 · ' + runId);
		assert.equal(remoteData.body.thing.folderId, copyRoot);
		assert.deepEqual(remoteData.body.thing.acl, ['tt:user']);
		assert.equal(remoteData.body.thing.author.id, ownerId);
		const independent = await poll(snapshot, value => value.files.find((row: any) => row.id === copyFileId)?.remoteId);
		const copiedRemoteId = independent.files.find((row: any) => row.id === copyFileId).remoteId;
		assert.equal(independent.files.find((row: any) => row.id === sourceFileId).remoteId, undefined,
			'The copied file completes while the original upload remains failed');
		const remoteFile = await poll(async () => lastRemoteFile = await api('GET', '/api/v1/things?id=' + copiedRemoteId),
			value => value.status === 200 && value.body.thing?.folderId === copyRoot);
		assert.equal(remoteFile.body.thing.author.id, ownerId);
		assert.equal(remoteFile.body.thing.visibility, 'private');
		for (const id of [copyRoot, copyDataId, copiedRemoteId]) assert.equal((await guest.request.get(url('/api/v1/things?id=' + id))).status(), 404);
		const readRemoteBytes = (id: string) => page.evaluate(async id => {
			const response = await fetch('/api/v1/attachments/content?id=' + encodeURIComponent(id) + '&download=1', { credentials: 'same-origin', redirect: 'error' });
			return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
		}, id);
		const remoteCopy = await readRemoteBytes(copiedRemoteId);
		assert.equal(remoteCopy.status, 200); assert.deepEqual(Buffer.from(remoteCopy.bytes), bytes);
		assert.equal((await guest.request.get(url('/api/v1/attachments/content?id=' + copiedRemoteId + '&download=1'))).status(), 404);
		await page.unroute('**/api/v1/attachments/uploads', failOriginal);
		const review = page.getByRole('region', { name: 'Account file sync', exact: true });
		await review.getByText('Review file sync', { exact: true }).click();
		await review.getByRole('button', { name: 'Retry upload', exact: true }).click();
		const settled = await poll(snapshot, value => value.files.every((row: any) => row.state === 'synced' && row.remoteId) && value.metadata.every((row: any) => row.state === 'synced'));
		assert.equal(new Set(settled.files.map((row: any) => row.remoteId)).size, 2);
		for (const file of settled.files) {
			const placed = await api('GET', '/api/v1/things?id=' + file.remoteId);
			assert.equal(placed.status, 200);
			assert.equal(placed.body.thing.folderId, file.id === copyFileId ? copyRoot : sourceRoot);
			const remote = await readRemoteBytes(file.remoteId);
			assert.equal(remote.status, 200); assert.deepEqual(Buffer.from(remote.bytes), bytes);
			assert.equal((await guest.request.get(url('/api/v1/attachments/content?id=' + file.remoteId + '&download=1'))).status(), 404);
		}
		// File metadata placement uses canonical bulk move; Duplicate itself must
		// never delegate copying/importing the local closure to a server endpoint.
		assert.equal(writes.some(row => (row.path === '/api/v1/things/bulk' && row.bulkOperation !== 'move') || ['/api/v1/things/fork', '/api/v1/things/import'].includes(row.path)), false);
		assert.deepEqual(writes.filter(row => row.offline), []); assert.deepEqual(offlineHttpSuccesses, []); assert.deepEqual(errors, []);
		await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ runId, action: 'Things Duplicate', nativeForkUi: false,
			sourceRoot, copyRoot, sourceFileId, copyFileId, bytes: bytes.length, sha256, distinctPrivateCopies: true,
			coldOfflineExactBytes: true, unchangedSource: true, failedOriginalUploads, copiedFileSyncedWhileOriginalFailed: true,
			ordinaryContentSynced: true, originalRetryConverged: true, guestRefused: true, settledFiles: settled.files, bounds, connectivityEvents, offlineHttpSuccesses, writes, errors }, null, 2));
	} catch (error) {
		const image = await page.screenshot({ timeout: 5000 }).catch(() => null);
		if (image) await writeFile(resolve(artifacts!, `failure-${runId}.png`), image);
		await writeFile(resolve(artifacts!, `failure-${runId}.json`), JSON.stringify({ runId, error: String(error),
			screenshot: image ? { file: `failure-${runId}.png`, sha256: createHash('sha256').update(image).digest('hex') } : null,
			body: await page.locator('body').innerText().catch(() => ''), browserOnline: await page.evaluate(() => navigator.onLine).catch(() => null),
			sourceRoot, copyRoot, sourceFileId, copyFileId, failedOriginalUploads, lastRemoteFile,
			localState: await snapshot().catch(error => ({ error: String(error) })), errors, connectivityEvents, offlineHttpSuccesses, writes }, null, 2));
		throw error;
	} finally {
		await page.unroute('**/api/v1/attachments/uploads', failOriginal).catch(() => {});
		await context.setOffline(false).catch(() => {});
	}
});
