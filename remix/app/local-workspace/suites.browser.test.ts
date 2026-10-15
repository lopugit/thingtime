import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_LOCAL_SUITE_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
// Production build only: this clean profile installs through the normal gallery,
// then operates without networking. Nothing is inserted through a test API.
test(
	'anonymous suite installs, edits, saves and cold-reloads with explicit offline runtime diagnostics',
	{ skip: !base || !playwrightPath, timeout: 120_000 },
	async () => {
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
		const { chromium } = await import(pathToFileURL(playwrightPath!).href);
		const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
		try {
			const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
			const page = await context.newPage();
			const mutations: string[] = [];
			page.on('request', (request) => {
				if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
			});
			const root = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/root-data');
			await page.goto(new URL('/builder/demos/web-standards', base).href);
			assert.equal((await (await root).json()).user, null);
			await page.getByTestId('suite-detail-install').waitFor();
			assert.equal(
				await page.evaluate(async () => {
					await Promise.race([
						navigator.serviceWorker.ready,
						new Promise((_, reject) => setTimeout(() => reject(new Error('Offline worker did not activate')), 90_000))
					]);
					if (!navigator.serviceWorker.controller)
						await new Promise<void>((resolve, reject) => {
							const timer = setTimeout(() => reject(new Error('Offline worker did not claim the page')), 10_000);
							navigator.serviceWorker.addEventListener(
								'controllerchange',
								() => {
									clearTimeout(timer);
									resolve();
								},
								{ once: true }
							);
						});
					for (const key of await caches.keys()) {
						if (!key.startsWith('thingtime:offline-shell:')) continue;
						const cache = await caches.open(key);
						if (await cache.match('/__thingtime_offline_shell_complete__')) return true;
					}
					return false;
				}),
				true,
				'The complete offline shell must be ready before disconnecting'
			);
			await context.setOffline(true);
			await page.getByTestId('suite-detail-install').click();
			await page.waitForURL('**/p/web-standards', { waitUntil: 'commit' });
			const feature = page.locator('a[href*="feature=html-element-button-"]');
			await feature.click();
			await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Saved entirely offline');
			await page.getByRole('button', { name: 'Run example', exact: true }).click();
			// Opaque-origin runtime navigation currently cannot use the app worker.
			// Keep the sandbox; this is an explicit remaining full-rollout gate.
			await page.getByRole('status').filter({ hasText: 'The isolated runtime did not load' }).waitFor();
			assert.equal(await page.locator('iframe[title="button interactive preview"]').getAttribute('sandbox'), 'allow-scripts');
			await page.getByRole('button', { name: 'Save edited component', exact: true }).click();
			const savedLink = page.getByRole('link', { name: 'Open saved Thing →', exact: true });
			await savedLink.waitFor();
			await savedLink.click();
			await page.getByRole('textbox', { name: 'Content', exact: true }).waitFor();
			await page.reload();
			assert.equal(await page.getByRole('textbox', { name: 'Content', exact: true }).inputValue(), 'Saved entirely offline');
			assert.equal(mutations.length, 0, mutations.join('\n'));
			if (process.env.TT_LOCAL_SUITE_ARTIFACTS) {
				const dir = resolve(process.env.TT_LOCAL_SUITE_ARTIFACTS);
				await mkdir(dir, { recursive: true });
				await page.screenshot({ path: resolve(dir, 'offline-saved-component.png') });
				await writeFile(
					resolve(dir, 'browser-verification.json'),
					JSON.stringify(
						{
							anonymous: true,
							offlineInstall: true,
							offlineRuntime: 'unavailable; explicit error, sandbox retained',
							savedComponentAfterColdReload: true,
							mutations
						},
						null,
						2
					)
				);
			}
		} finally {
			await browser.close();
		}
	}
);
