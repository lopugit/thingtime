import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_ANONYMOUS_THEME_HISTORY_URL,
	artifacts = process.env.TT_ANONYMOUS_THEME_HISTORY_ARTIFACTS;
test(
	'anonymous native theme History saves and exports offline without account requests',
	{ skip: !base || !artifacts || !process.env.TT_SHARED_PLAYWRIGHT_PATH, timeout: 180_000 },
	async () => {
		const origin = new URL(base!).origin,
			output = resolve(artifacts!);
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
		const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
		const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }),
			page = await context.newPage(),
			errors: string[] = [],
			writes: string[] = [],
			checks: string[] = [];
		page.setDefaultTimeout(25000);
		page.on('pageerror', (e: Error) => errors.push(e.message));
		page.on('request', (r: any) => {
			if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push(new URL(r.url()).pathname);
		});
		await mkdir(output, { recursive: true });
		try {
			await page.goto(origin + '/themes');
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).waitFor();
			await page.waitForFunction(async () => {
				await navigator.serviceWorker.ready;
				if (!navigator.serviceWorker.controller) return false;
				for (const key of await caches.keys())
					if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
						return true;
				return false;
			});
			await context.setOffline(true);
			await page.reload();
			await page.locator('input:not([type="color"])[value="hotpink"]').first().fill('#885544');
			await page.getByPlaceholder(/^e.g. .* remix/).fill('Anonymous peach');
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
			await page.getByText('Anonymous peach ⭐', { exact: true }).waitFor();
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).waitFor();
			await page.reload();
			await page.locator('input:not([type="color"])[value="#885544"]').waitFor();
			checks.push('anonymous offline native save survives immediate reload');
			await page.getByRole('button', { name: 'History', exact: true }).click();
			await page.getByText('Created Thing', { exact: true }).click();
			await page.getByRole('tab', { name: 'Versions', exact: true }).click();
			await page.getByRole('button', { name: 'Export', exact: true }).first().waitFor();
			const [download] = await Promise.all([
				page.waitForEvent('download'),
				page.getByRole('button', { name: 'Export', exact: true }).first().click()
			]);
			await download.saveAs(resolve(output, 'theme-history.json'));
			const archive = JSON.parse(await readFile(resolve(output, 'theme-history.json'), 'utf8'));
			assert.equal(archive.content.adapter, 'theme-content');
			assert.equal(archive.content.value.crystal.theme.colors.accent, '#885544');
			assert.equal(archive.content.value.visibility, 'private');
			checks.push('native History exports the saved approved theme projection offline');
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				await page.screenshot({ path: resolve(output, `history-${width}.png`), animations: 'disabled' });
			}
			assert.deepEqual(errors, []);
			assert.deepEqual(writes, []);
			await writeFile(resolve(output, 'verification.json'), JSON.stringify({ checks, errors, writes, viewports: [1440, 390, 320] }, null, 2));
			console.log(JSON.stringify({ ok: true, checks }));
		} catch (error) {
			await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
			await writeFile(
				resolve(output, 'failure.json'),
				JSON.stringify(
					{
						error: String(error),
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
			await browser.close();
		}
	}
);
