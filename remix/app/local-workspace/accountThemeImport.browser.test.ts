import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTransfer, serializeTransfer } from '../utils/thingTransfer/format';
const base = process.env.TT_ACCOUNT_THEME_IMPORT_URL,
	artifacts = process.env.TT_ACCOUNT_THEME_IMPORT_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'native account import preserves editable theme folders offline and synchronizes private copies independently',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 180_000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
		const { chromium } = await import(playwrightPath!),
			browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			guest = await browser.newContext(),
			page = await context.newPage();
		const headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' },
			url = (path: string) => new URL(path, origin).href,
			errors: string[] = [],
			writes: { path: string; offline: boolean }[] = [],
			checks: string[] = [];
		let offline = false,
			themeId = '',
			folderId = '',
			ownerId = '';
		page.setDefaultTimeout(25000);
		page.on('pageerror', (error: Error) => errors.push(error.message));
		page.on('request', (request: any) => {
			if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ path: new URL(request.url()).pathname, offline });
		});
		const name = 'Imported peach ' + randomUUID().slice(0, 6),
			folderName = 'Offline looks ' + randomUUID().slice(0, 6);
		await mkdir(resolve(artifacts!), { recursive: true });
		try {
			const health = await context.request.get(url('/api/v1/mongodb/status'));
			assert.equal(health.status(), 200);
			const storage = await health.json();
			assert.equal(storage.host, '127.0.0.1:22463');
			assert.equal(storage.replicaSet, 'draftPreview');
			assert.equal(storage.custom, false);
			const username = 'themeimportui-' + randomUUID().slice(0, 8),
				registration = await context.request.post(url('/api/v1/auth/register'), {
					headers,
					data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
				});
			assert.equal(registration.status(), 200);
			ownerId = (await registration.json()).user.id;
			const file = resolve(artifacts!, 'input.json');
			await writeFile(
				file,
				serializeTransfer({
					format: 'thingtime.transfer',
					version: 1,
					roots: ['folder'],
					things: [
						{ id: 'folder', thingtime: ['folder'], crystal: { name: folderName } },
						{ id: 'theme', thingtime: ['theme'], folderId: 'folder', crystal: { name, theme: { colors: { accent: '#bf8068' } } } }
					],
					files: []
				})
			);
			await page.goto(url('/themes'));
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).waitFor();
			await page.waitForFunction(async () => {
				await navigator.serviceWorker.ready;
				if (!navigator.serviceWorker.controller) return false;
				for (const key of await caches.keys())
					if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
						return true;
				return false;
			});
			offline = true;
			await context.setOffline(true);
			await page.reload();
			await page.getByTestId('thing-transfer-menu').first().click();
			await page.getByRole('menuitem', { name: 'Import into my Things…', exact: true }).click();
			await page.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles(file);
			await page.getByText('1 transfer ready to import', { exact: true }).waitFor();
			await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
			await page.getByRole('dialog').waitFor({ state: 'hidden' });
			await page.getByText(name, { exact: true }).waitFor();
			await page.reload();
			await page.getByText(name, { exact: true }).waitFor();
			checks.push('normal file importer saves and reloads theme offline');
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				await page.screenshot({ path: resolve(artifacts!, `imported-theme-${width}.png`), animations: 'disabled', fullPage: true });
			}
			await page.setViewportSize({ width: 1440, height: 1000 });
			await page.goto(url('/things'));
			const folder = page.getByRole('link', { name: folderName, exact: true });
			await folder.waitFor();
			await folder.click({ button: 'right' });
			await page.getByRole('menuitem', { name: '📥 Download…', exact: true }).click();
			await page.getByLabel('Download format', { exact: true }).selectOption('json');
			const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
			const exported = resolve(artifacts!, 'imported-folder.json');
			await download.saveAs(exported);
			const manifest = parseTransfer(await readFile(exported, 'utf8'));
			assert.equal(manifest.things.length, 2);
			folderId = manifest.roots[0];
			const theme = manifest.things.find((row) => row.thingtime[0] === 'theme')!;
			themeId = theme.id;
			assert.notEqual(themeId, 'theme');
			assert.notEqual(folderId, 'folder');
			assert.equal(theme.folderId, folderId);
			assert.equal(theme.crystal.name, name);
			assert.equal((theme.crystal.theme as any).colors.accent, '#bf8068');
			assert.deepEqual(
				writes.filter((row) => row.offline),
				[]
			);
			checks.push('canonical offline folder export preserves remapped theme and tokens');
			offline = false;
			await context.setOffline(false);
			await page.reload();
			let stored: any;
			for (let n = 0; n < 100; n++) {
				const response = await context.request.get(url('/api/v1/things?id=' + themeId));
				if (response.status() === 200) {
					stored = (await response.json()).thing;
					if (stored?.folderId === folderId) break;
				}
				await page.waitForTimeout(300);
			}
			assert.equal(stored?.folderId, folderId);
			assert.equal(stored?.crystal.name, name);
			assert.equal(stored?.crystal.theme.colors.accent, '#bf8068');
			assert.equal(stored?.visibility, 'private');
			assert.equal(stored?.author.id, ownerId);
			assert.equal((await guest.request.get(url('/api/v1/things?id=' + themeId))).status(), 404);
			const selection = await context.request.post(url('/api/v1/themes/sync'), {
				headers,
				data: { operation: 'selection', expectedOwnerId: ownerId }
			});
			assert.equal(selection.status(), 200);
			assert.equal((await selection.json()).selection.themeId, null);
			assert.equal(
				writes.some((row) => row.path === '/api/v1/things/import'),
				false
			);
			assert.deepEqual(errors, []);
			checks.push('independent background writers preserve private folder placement without changing selection');
			await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks, errors, writes, viewports: [1440, 390, 320] }, null, 2));
		} catch (error) {
			await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
			await writeFile(
				resolve(artifacts!, 'failure.json'),
				JSON.stringify(
					{
						body: await page
							.locator('body')
							.innerText()
							.catch(() => ''),
						errors,
						writes
					},
					null,
					2
				)
			);
			throw error;
		} finally {
			await context.setOffline(false).catch(() => {});
			if (themeId) await context.request.post(url('/api/v1/themes/delete'), { headers, data: { id: themeId } }).catch(() => {});
			if (folderId) await context.request.delete(url('/api/v1/things'), { headers, data: { id: folderId } }).catch(() => {});
			await browser.close();
		}
	}
);
