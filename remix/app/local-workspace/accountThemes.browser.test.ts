import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTransfer } from '../utils/thingTransfer/format';
const base = process.env.TT_ACCOUNT_THEMES_URL,
	artifacts = process.env.TT_ACCOUNT_THEMES_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'native theme studio saves, applies and exports offline, reloads and synchronizes private content separately',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 180_000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
		const { chromium } = await import(playwrightPath!),
			browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			page = await context.newPage();
		const headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' },
			url = (path: string) => new URL(path, origin).href;
		const errors: string[] = [],
			writes: string[] = [],
			checks: string[] = [];
		let offline = false,
			id = '';
		page.setDefaultTimeout(25000);
		page.on('pageerror', (error: Error) => errors.push(error.message));
		page.on('request', (request: any) => {
			if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname);
		});
		await mkdir(resolve(artifacts!), { recursive: true });
		try {
			const health = await context.request.get(url('/api/v1/mongodb/status'));
			assert.equal(health.status(), 200);
			const storage = await health.json();
			assert.equal(storage.host, '127.0.0.1:22463');
			assert.equal(storage.custom, false);
			assert.equal(storage.connected, true);
			const username = 'themeui-' + randomUUID().slice(0, 8),
				name = 'Offline peach ' + randomUUID().slice(0, 6);
			const registration = await context.request.post(url('/api/v1/auth/register'), {
				headers,
				data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
			});
			assert.equal(registration.status(), 200);
			const owner = (await registration.json()).user.id;
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
			const nameInput = page.getByPlaceholder(/^e.g. .* remix/);
			await nameInput.fill(name);
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
			await page.getByText(name, { exact: false }).first().waitFor();
			await page.getByRole('button', { name: 'Apply', exact: true }).last().click();
			await page.reload();
			await page.getByText(name + ' ⭐', { exact: true }).waitFor();
			checks.push('offline native save, apply and cold reload');
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				await page.screenshot({ path: resolve(artifacts!, `themes-${width}.png`), animations: 'disabled', fullPage: true });
				await page.getByTestId('thing-transfer-menu').last().click();
				await page.getByRole('menuitem', { name: 'Export / Download…', exact: true }).click();
				await page.getByLabel('Download format', { exact: true }).selectOption('json');
				await page.screenshot({ path: resolve(artifacts!, `theme-download-${width}.png`), animations: 'disabled' });
				const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
				const path = resolve(artifacts!, `theme-${width}.json`);
				await download.saveAs(path);
				const exported = parseTransfer(await readFile(path, 'utf8'));
				assert.equal(exported.things.length, 1);
				assert.equal(exported.things[0].crystal.name, name);
				assert.deepEqual(exported.things[0].thingtime, ['theme']);
				assert.equal('acl' in exported.things[0], false);
				assert.equal('ownerId' in exported.things[0], false);
				await page.getByRole('dialog').waitFor({ state: 'hidden' });
			}
			checks.push('native offline JSON downloads validate at desktop and both phone widths');
			assert.deepEqual(writes, []);
			checks.push('no offline network mutations; 1440, 390 and 320px fit');
			offline = false;
			await context.setOffline(false);
			await page.reload();
			let remote: any, selection: any;
			for (let i = 0; i < 60; i++) {
				const response = await context.request.post(url('/api/v1/themes/sync'), { headers, data: { operation: 'snapshot', expectedOwnerId: owner } });
				assert.equal(response.status(), 200);
				remote = (await response.json()).themes.find((row: any) => row.name === name);
				if (remote) {
					id = remote.id;
					const result = await context.request.post(url('/api/v1/themes/sync'), {
						headers,
						data: { operation: 'selection', expectedOwnerId: owner }
					});
					assert.equal(result.status(), 200);
					selection = (await result.json()).selection;
					if (selection.themeId === id) break;
				}
				await page.waitForTimeout(500);
			}
			assert.ok(remote);
			assert.equal(remote.visibility, 'private');
			assert.equal(selection?.themeId, id);
			checks.push('independent content and selection queues converge to private account theme');
			await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
			for (let i = 0; i < 40; i++) {
				const response = await context.request.post(url('/api/v1/themes/sync'), { headers, data: { operation: 'snapshot', expectedOwnerId: owner } });
				if (!(await response.json()).themes.some((row: any) => row.id === id)) {
					checks.push('native deletion synchronizes');
					break;
				}
				await page.waitForTimeout(500);
			}
			assert.ok(checks.includes('native deletion synchronizes'));
			assert.deepEqual(errors, []);
			await writeFile(
				resolve(artifacts!, 'verification.json'),
				JSON.stringify({ checks, errors, offlineWrites: writes, viewports: [1440, 390, 320] }, null, 2)
			);
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
			if (id) await context.request.delete(url('/api/v1/themes'), { headers, data: { id } }).catch(() => {});
			await browser.close();
		}
	}
);
