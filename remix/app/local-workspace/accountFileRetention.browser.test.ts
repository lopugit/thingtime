import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeTransferArchive } from '../utils/thingTransfer/archive';
import { serializeTransfer } from '../utils/thingTransfer/format';

const base = process.env.TT_LOCAL_FILE_SYNC_URL,
	adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH,
	artifacts = process.env.TT_LOCAL_FILE_SYNC_ARTIFACTS,
	cold = process.env.TT_LOCAL_FILE_RETENTION_COLD === '1';

test('existing account file retention renders and edits offline through the native UI without duplicate uploads',
	{ skip: !base || !adminFile || !playwrightPath, timeout: 120_000 }, async () => {
		assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
		const { chromium } = await import(playwrightPath!), browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
		const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), admin = await browser.newContext(), guest = await browser.newContext();
		const headers = { Origin: new URL(base!).origin }, url = (path: string) => new URL(path, base).href;
		let fileId = '', offline = false;
		const page = await owner.newPage(), modules = new Map<string, string>(), errors: string[] = [], writes: any[] = [];
		page.setDefaultTimeout(20_000);
		page.on('pageerror', (error: Error) => errors.push(error.message));
		page.on('request', request => { const path = new URL(request.url()).pathname; if (['/app/local-workspace/runtime.client.ts','/app/local-workspace/accountApi.client.ts'].includes(path)) modules.set(path, request.url()); if (!['GET','HEAD','OPTIONS'].includes(request.method())) writes.push({ path, offline }); });
		const navigate = async (path: string) => page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
		try {
			const administrator = JSON.parse(await readFile(adminFile!, 'utf8'));
			assert.equal((await admin.request.post(url('/api/v1/login'), { headers, data: { username: administrator.username, password: administrator.password } })).status(), 200);
			const username = 'existing-file-' + randomUUID().slice(0, 8);
			const registered = await owner.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
			assert.equal(registered.status(), 200, await registered.text());
			const user = (await registered.json()).user;
			assert.equal((await admin.request.post(url('/api/v1/admin/users/public-uploads'), { headers, data: { userId: user.id, enabled: true, scope: 'private' } })).status(), 200);
			await page.goto(url('/things?files=thingtime'));
			await page.getByTestId('filesystem-browser').getByRole('button', { name: 'Add files', exact: true }).waitFor();
			await page.waitForLoadState('networkidle');
			const bytes = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 168; const x = c.getContext('2d')!; x.fillStyle = '#f4cfad'; x.fillRect(0, 0, 120, 168); x.fillStyle = '#984b39'; x.font = '18px serif'; x.fillText('Retained file', 8, 80); return c.toDataURL('image/png').split(',')[1]; }), 'base64'), requestId = randomUUID();
			const upload = { requestId, filename: 'existing.png', contentType: 'image/png', sizeBytes: bytes.length, purpose: 'file' };
			const start = await owner.request.post(url('/api/v1/attachments/uploads'), { headers, data: upload });
			assert.equal(start.status(), 200, await start.text()); fileId = (await start.json()).upload.id;
			const parts = await owner.request.post(url('/api/v1/attachments/uploads/parts'), { headers, data: { uploadId: fileId, parts: [{ partNumber: 1, checksumSha256: createHash('sha256').update(bytes).digest('base64') }] } });
			assert.equal(parts.status(), 200, await parts.text());
			const part = (await parts.json()).parts[0];
			assert.ok(['127.0.0.1', 'localhost'].includes(new URL(part.url, base).hostname), 'Only disposable loopback object storage');
			assert.equal((await guest.request.put(new URL(part.url, base).href, { headers: part.headers, data: bytes })).status(), 200);
			const complete = await owner.request.post(url('/api/v1/attachments/uploads/complete'), { headers, data: { uploadId: fileId } });
			assert.equal(complete.status(), 200, await complete.text());
			if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
			const descriptor = url(`/api/v1/attachments/content?id=${fileId}&cache=retain&download=1`);
			assert.equal((await guest.request.get(descriptor)).status(), 401);
			assert.equal((await admin.request.get(descriptor)).status(), 404);
			const retained = await owner.request.get(descriptor); assert.equal(retained.status(), 200, await retained.text());
			const receipt = await retained.json(); assert.equal(receipt.file.ownerId, user.id); assert.equal(receipt.file.attachment.id, fileId);
			assert.ok(!JSON.stringify(receipt).includes('objects/')); assert.ok(!JSON.stringify(receipt).includes('signature'));
			// Truncated bytes must leave the ordinary online preview available and
			// report failed retention instead of saving a broken offline file.
			const damaged = '**/api/v1/attachments/content?*cache=retain-bytes*';
			await owner.route(damaged, async route => { if (new URL(route.request().url()).searchParams.get('download') !== '1') return route.continue(); await route.fulfill({ status: 200, body: bytes.subarray(0, 16), headers: { 'Content-Type': 'application/octet-stream', ETag: `"${receipt.cacheKey}:v1"`, 'Content-Length': String(bytes.length) } }); });
			await navigate('/media/' + fileId);
			await page.getByText(/could not be refreshed on this device/).waitFor();
			await owner.unroute(damaged);
			await page.reload(); await page.waitForLoadState('networkidle');
			await page.getByRole('link', { name: 'Download', exact: true }).scrollIntoViewIfNeeded();
			const image = page.locator('img[src^="blob:"]').first(); await image.waitFor(); await image.evaluate((img: HTMLImageElement) => img.decode());
			assert.equal(await image.evaluate((img: HTMLImageElement) => img.naturalWidth), 120);
			const paths = ['/app/local-workspace/runtime.client.ts','/app/local-workspace/accountApi.client.ts'].map(path => modules.get(path)); if (!cold) assert.ok(paths.every(Boolean));
			await page.evaluate(paths => { (window as any).__retainedModules = paths; }, paths);
			const localId = cold ? (await page.locator('body').innerText()).match(/local-file-account-[a-f0-9]{64}/)?.[0] : await page.evaluate(async id => { const [runtime, api] = await Promise.all((window as any).__retainedModules.map((path: string) => import(path))); const scope = runtime.currentAccountWorkspace(); const files = api.accountWorkspaceWorker(scope).files; const rows = await files.library(); if (rows.things.length !== 1) throw Error('Duplicate retention'); return rows.aliases.get(id); }, fileId);
			assert.match(localId, /^local-file-account-/);
			// Vite does not install the production offline shell. Warm both native
			// routes after reload before testing offline navigation between them.
			await navigate('/things?files=thingtime');
			await page.getByTestId('filesystem-browser').getByRole('button', { name: 'Add files', exact: true }).waitFor();
			await navigate('/media/' + fileId); await image.waitFor();
			await page.waitForLoadState('networkidle');
			if (cold) await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
			offline = true; await owner.setOffline(true);
			if (cold) { await page.reload(); await image.waitFor(); await image.evaluate((img: HTMLImageElement) => img.decode()); }
			await page.getByRole('button', { name: 'Edit file details', exact: true }).click();
			await page.getByLabel('Title', { exact: true }).fill('Offline retained title');
			await page.getByLabel('Description', { exact: true }).fill('Saved locally through the native editor.');
			await page.getByRole('button', { name: 'Save file details', exact: true }).click();
			await page.getByRole('heading', { name: 'Offline retained title', exact: true, level: 1 }).waitFor();
			if (cold) { await page.reload(); await page.getByRole('heading', { name: 'Offline retained title', exact: true, level: 1 }).waitFor(); await image.waitFor(); }
			const downloadWait = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download', exact: true }).click();
			const download = await downloadWait; assert.deepEqual(await readFile((await download.path())!), bytes);
			await navigate('/things');
			await page.getByRole('link', { name: 'Offline retained title', exact: true }).click({ button: 'right' });
			await page.getByRole('menuitem', { name: '📥 Download…', exact: true }).click();
			await page.getByRole('combobox', { name: 'Download format' }).selectOption('json');
			await page.getByRole('button', { name: 'Download', exact: true }).click();
			await page.getByRole('alert').filter({ hasText: 'include file bytes' }).waitFor();
			await page.getByRole('combobox', { name: 'Download format' }).selectOption('zip');
			const archiveWait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
			const archive = await readFile((await (await archiveWait).path())!), exported = await decodeTransferArchive(archive);
			assert.equal(exported.manifest.files.length, 1); assert.equal(exported.manifest.files[0].title, 'Offline retained title');
			assert.deepEqual(Buffer.from(exported.files.get(exported.manifest.files[0].id)!), bytes);
			if (artifacts) { await writeFile(resolve(artifacts, 'retained-export.thingtime.zip'), archive); await writeFile(resolve(artifacts, 'retained-export.thingtime.json'), serializeTransfer(exported.manifest)); }
			await navigate('/media/' + fileId); await image.waitFor();

			for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await image.scrollIntoViewIfNeeded(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width); if (artifacts) await page.screenshot({ path: resolve(artifacts, `retained-native-${width}.png`) }); }
			await navigate('/things?files=thingtime');
			const library = page.getByTestId('filesystem-browser'); await library.getByText('Offline retained title', { exact: true }).first().waitFor();
			assert.equal(await library.getByText('Offline retained title', { exact: true }).count(), 1);
			assert.deepEqual(writes.filter(write => write.offline), []);
			offline = false; await owner.setOffline(false); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
			let reconciled = false;
			for (let i = 0; i < 100; i++) { const response = await owner.request.get(url('/api/v1/things?id=' + fileId)); const row = (await response.json()).thing; if (row?.crystal?.title === 'Offline retained title') { reconciled = true; break; } await new Promise(resolve => setTimeout(resolve, 200)); }
			assert.ok(reconciled, 'Offline details reconcile to the original account file');
			if (cold) {
				// Delete only this fixture's server file, then let the ordinary
				// owned-descriptor refresh observe its real 404. A cached preview
				// and a new offline Download must both stop exposing those bytes.
				await navigate('/media/' + fileId); await image.waitFor();
				const removed = await owner.request.post(url('/api/v1/attachments/delete'), { headers, data: { id: fileId } });
				assert.equal(removed.status(), 200, await removed.text());
				await page.reload();
				await page.getByText(/Account access to this retained file is no longer available/).first().waitFor();
				await image.waitFor({ state: 'hidden' });
				offline = true; await owner.setOffline(true);
				await navigate('/things');
				await page.getByRole('link', { name: 'Offline retained title', exact: true }).click({ button: 'right' });
				await page.getByRole('menuitem', { name: '📥 Download…', exact: true }).click();
				let unexpectedDownloads = 0; page.on('download', () => unexpectedDownloads++);
				await page.getByRole('button', { name: 'Download', exact: true }).click();
				await page.getByRole('alert').filter({ hasText: 'no longer available' }).waitFor();
				for (const width of [1440,390,320]) {
					await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
					assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
					if (artifacts) await page.screenshot({ path: resolve(artifacts, `refused-retained-download-${width}.png`) });
				}
				assert.equal(unexpectedDownloads, 0);
				assert.deepEqual(writes.filter(write => write.offline), []);
				assert.deepEqual(writes.filter(write => write.path.includes('/attachments/uploads')), []); assert.deepEqual(errors, []);
				if (artifacts) await writeFile(resolve(artifacts, 'cold-retention-verification.json'), JSON.stringify({ localId, fileId, coldOfflineReload: true, offlineDetailsSurviveReload: true, exactOfflineDownload: true, canonicalOfflineZip: true, canonicalRefusalStopsPreviewAndExport: true, jsonFileExclusionRefused: true, reconciled, duplicateUploads: 0, viewports: [1440,390,320], writes, errors }, null, 2));
				return;
			}
			let lost = 0; const deletions: any[] = [];
			await owner.route('**/api/v1/attachments/delete', async route => { const input = route.request().postDataJSON(); if (input.id !== fileId) return route.continue(); deletions.push(input); const response = await route.fetch(); if (!lost && response.status() === 200) { lost++; return route.abort('failed'); } return route.fulfill({ response }); });
			offline = true; await owner.setOffline(true);
			await page.evaluate(async id => { const [runtime, api] = await Promise.all((window as any).__retainedModules.map((path: string) => import(path))); const scope = runtime.currentAccountWorkspace(); await api.accountApi({ things: {}, attachments: {} }, { id: scope.ownerId }, scope.dataPlane).things.remove({ id }); }, fileId);
			await library.getByText('Offline retained title', { exact: true }).waitFor({ state: 'hidden' });
			assert.deepEqual(writes.filter(write => write.offline), []);
			offline = false; await owner.setOffline(false); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
			await page.getByRole('region', { name: 'Account file sync', exact: true }).waitFor({ state: 'hidden', timeout: 75000 });
			assert.equal(lost, 1); assert.ok(deletions.length >= 2); assert.equal(deletions[0].retainReceipt, true); assert.equal(deletions[0].requestId, undefined); assert.deepEqual(deletions.at(-1), deletions.at(-2));
			assert.equal((await owner.request.get(descriptor)).status(), 404);
			const replay = await owner.request.post(url('/api/v1/attachments/uploads'), { headers, data: upload }); assert.equal(replay.status(), 409);
			assert.deepEqual(writes.filter(write => write.path.includes('/attachments/uploads')), [], 'The browser never uploads an existing file again');
			assert.deepEqual(errors, []);
			if (artifacts) await writeFile(resolve(artifacts, 'retention-verification.json'), JSON.stringify({ localId, fileId, nativeImage: [120,168], offlineDetails: true, exactOfflineDownload: true, truncationReported: true, singleAlias: true, lostDeletionReceipt: true, duplicateUploads: 0, viewports: [1440,390,320], writes, errors }, null, 2));
		} catch (error) {
			if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {}); await writeFile(resolve(artifacts, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
			throw error;
		} finally {
			if (fileId) await owner.request.post(url('/api/v1/attachments/delete'), { headers, data: { id: fileId } }).catch(() => {});
			await Promise.all([owner.close(), admin.close(), guest.close()]); await browser.close();
		}
	});
