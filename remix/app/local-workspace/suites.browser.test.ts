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
	'anonymous suite installs, executes in its opaque sandbox, saves and cold-reloads fully offline',
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
			const shell = await page.goto(new URL('/builder/demos/web-standards', base).href);
			const scripts = shell!
				.headers()
				['content-security-policy'].split(';')
				.find((part: string) => part.trim().startsWith('script-src '))!;
			assert.ok(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"), 'Exercise the production policy');
			assert.match(scripts, /'sha256-[A-Za-z0-9+/=]+'/);
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
			await page
				.frameLocator('iframe[title="button interactive preview"]')
				.getByRole('button', { name: 'Saved entirely offline', exact: true })
				.waitFor();
			await page.getByLabel('Execution result', { exact: true }).filter({ hasText: 'HTMLButtonElement' }).waitFor();
			assert.equal(await page.locator('iframe[title="button interactive preview"]').getAttribute('sandbox'), 'allow-scripts');
			await page.getByRole('button', { name: 'Save edited component', exact: true }).click();
			const savedLink = page.getByRole('link', { name: 'Open saved Thing →', exact: true });
			await savedLink.waitFor();
			await savedLink.click();
			await page.getByRole('textbox', { name: 'Content', exact: true }).waitFor();
			await page.reload();
			assert.equal(await page.getByRole('textbox', { name: 'Content', exact: true }).inputValue(), 'Saved entirely offline');
			await page.getByRole('button', { name: 'Run example', exact: true }).click();
			await page
				.frameLocator('iframe[title="button interactive preview"]')
				.getByRole('button', { name: 'Saved entirely offline', exact: true })
				.waitFor();
			await page.getByLabel('Execution result', { exact: true }).filter({ hasText: 'HTMLButtonElement' }).waitFor();
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
							offlineRuntime: 'native HTMLButtonElement; opaque sandbox retained',
							savedComponentAfterColdReload: true,
							mutations
						},
						null,
						2
					)
				);
			}

			await page.getByText('Edit reusable program', { exact: true }).click();
			const editor = page.getByRole('textbox', { name: 'Web Platform program', exact: true });
			const run = async (program: unknown) => {
				await editor.fill(JSON.stringify(program));
				await page.getByRole('button', { name: 'Run example', exact: true }).click();
			};
			await run({ version: 1, title: 'Offline worker', steps: [{ op: 'return', value: 42 }] });
			await page.getByLabel('Execution result', { exact: true }).filter({ hasText: /^42$/ }).waitFor();
			await page.getByRole('button', { name: 'Stop / clear', exact: true }).click();
			assert.equal(await page.locator('iframe[title$="interactive preview"]').count(), 0);
			assert.equal(await page.getByLabel('Execution result', { exact: true }).count(), 0);
			await run({ version: 1, title: 'Expected failure', steps: [{ op: 'throw', value: 'Expected offline failure' }] });
			await page.getByRole('status').filter({ hasText: 'Expected offline failure' }).waitFor();
			await run({
				version: 1,
				title: 'Offline form',
				allowFormEvents: true,
				document: [
					{ tag: 'form', attributes: { id: 'sample' }, children: [{ tag: 'button', attributes: { type: 'submit' }, children: ['Submit offline'] }] }
				],
				dom: [{ target: '#sample', event: '#sample|submit' }]
			});
			const iframe = page.locator('iframe[title="button interactive preview"]');
			assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-forms');
			await page.frameLocator('iframe[title="button interactive preview"]').getByRole('button', { name: 'Submit offline', exact: true }).click();
			await page.getByLabel('Execution result', { exact: true }).filter({ hasText: 'defaultPreventedAfterDispatch' }).waitFor();
			assert.equal(
				JSON.parse(await page.getByLabel('Execution result', { exact: true }).innerText()).events.at(-1).defaultPreventedAfterDispatch,
				true
			);
			assert.equal(mutations.length, 0, mutations.join('\n'));
			// Reconnect for the security probe: CSP, not offline networking, must
			// stop same-origin account/network reads and arbitrary inline execution.
			await context.setOffline(false);
			let escaped = 0;
			await context.route('**/__runtime_security_probe__', async (route: any) => {
				escaped++;
				await route.fulfill({ body: 'not allowed' });
			});
			const sandbox = await (await iframe.elementHandle())!.contentFrame();
			const boundary = await sandbox!.evaluate(async (endpoint: string) => {
				const script = document.createElement('script');
				script.textContent = 'globalThis.__arbitraryInline = true';
				document.body.appendChild(script);
				const result = {
					opaque: self.origin === 'null',
					parentDenied: false,
					cookieDenied: false,
					storageDenied: false,
					inlineBlocked: !(globalThis as any).__arbitraryInline,
					networkBlocked: false
				};
				try {
					void parent.document;
				} catch {
					result.parentDenied = true;
				}
				try {
					void document.cookie;
				} catch {
					result.cookieDenied = true;
				}
				try {
					void localStorage.length;
				} catch {
					result.storageDenied = true;
				}
				try {
					await fetch(endpoint);
				} catch {
					result.networkBlocked = true;
				}
				return result;
			}, new URL('/__runtime_security_probe__', base).href);
			assert.deepEqual(boundary, {
				opaque: true,
				parentDenied: true,
				cookieDenied: true,
				storageDenied: true,
				inlineBlocked: true,
				networkBlocked: true
			});
			assert.equal(escaped, 0);
			if (process.env.TT_LOCAL_SUITE_ARTIFACTS)
				await writeFile(
					resolve(process.env.TT_LOCAL_SUITE_ARTIFACTS, 'runtime-boundaries.json'),
					JSON.stringify(
						{
							...boundary,
							offlineWorker: 42,
							offlineErrorReported: true,
							offlineFormNavigationCancelled: true,
							stopClearsFrame: true,
							escapedRequests: escaped
						},
						null,
						2
					)
				);
		} finally {
			await browser.close();
		}
	}
);
