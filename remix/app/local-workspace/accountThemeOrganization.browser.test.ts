import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_ACCOUNT_THEME_ORGANIZATION_URL,
	artifacts = process.env.TT_ACCOUNT_THEME_ORGANIZATION_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
for (const customPlane of [false, true])
	test(
		`native library moves, drains and deletes private account themes offline${
			customPlane ? ' under a selected custom plane' : ''
		} with independent conditional synchronization`,
		{ skip: !base || !artifacts || !playwrightPath, timeout: 300_000 },
		async () => {
			const origin = new URL(base!).origin,
				evidence = resolve(artifacts!, customPlane ? 'custom-plane-account' : 'account');
			assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
			const { chromium } = await import(playwrightPath!);
			const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
			const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
				page = await context.newPage(),
				guest = await browser.newContext();
			const headers: Record<string, string> = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' },
				url = (path: string) => new URL(path, origin).href;
			// Browser fetch observes loopback Secure cookies exactly as the app does.
			const nativeRequest = async (method: string, target: string, options: any = {}) => {
				const result = await page.evaluate(
					async ({ method, target, headers, data }) => {
						const response = await fetch(target, {
							method,
							headers: { ...headers, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
							...(data === undefined ? {} : { body: JSON.stringify(data) })
						});
						return { status: response.status, body: await response.json() };
					},
					{ method, target, headers: method === 'GET' ? {} : { ...headers, ...options.headers }, data: options.data }
				);
				return { status: () => result.status, json: async () => result.body, text: async () => JSON.stringify(result.body) };
			};
			const native = {
				get: (target: string, options?: any) => nativeRequest('GET', target, options),
				post: (target: string, options?: any) => nativeRequest('POST', target, options),
				delete: (target: string, options?: any) => nativeRequest('DELETE', target, options)
			};

			let selectedCustom = '',
				offline = false,
				themeId = '',
				folderId = '',
				dataId = '',
				ownerId = '';
			const deviceReads: { offline: boolean }[] = [];
			const writes: any[] = [],
				errors: string[] = [],
				checks: string[] = [];
			page.setDefaultTimeout(20000);
			page.on('pageerror', (error: Error) => errors.push(error.message));
			page.on('request', (request: any) => {
				if (new URL(request.url()).pathname.startsWith('/api/v1/devices')) deviceReads.push({ offline });
				if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
					writes.push({ path: new URL(request.url()).pathname, offline, method: request.method(), at: Date.now() });
			});
			let title = 'Organization peach ' + randomUUID().slice(0, 6),
				folderName = 'Theme folder ' + randomUUID().slice(0, 6),
				dataName = 'Ordinary companion ' + randomUUID().slice(0, 6);
			const read = async (id: string) => {
				const r = await native.get(url('/api/v1/things?id=' + id));
				return { status: r.status(), ...(await r.json()) };
			};
			const until = async (fn: () => Promise<boolean>) => {
				// A reload may leave the previous worker's durable 60s claim alive.
				// Allow its bounded expiry before judging reconnect progress.
				const deadline = Date.now() + 90_000;
				while (Date.now() < deadline) {
					if (await fn()) return;
					await page.waitForTimeout(250);
				}
				assert.fail('Conditional synchronization did not complete');
			};
			const select = async (name: string) => {
				const input = page.getByRole('checkbox', { name: 'Select ' + name, exact: true });
				await page.locator('label').filter({ has: input }).click();
			};
			const remove = async (name: string) => {
				await select(name);
				await page.getByRole('button', { name: '🗑️ Delete', exact: true }).click();
				const dialog = page.getByRole('dialog');
				await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
				await dialog.waitFor({ state: 'hidden' });
				await page.getByRole('link', { name, exact: true }).waitFor({ state: 'hidden' });
			};
			const sourceTitle = title;
			const libraryPath = (folder?: string) =>
				'/things?' + new URLSearchParams({ ...(customPlane ? { localPlane: 'home', workspaceOwner: ownerId } : {}), ...(folder ? { folder } : {}) });
			const goOffline = async () => {
				await page.waitForLoadState('networkidle');
				await connectivity(true);
				await page.reload();
			};
			const reconnect = async () => {
				offline = false;
				await connectivity(false);
				if (selectedCustom) {
					const reset = await native.post(url('/api/v1/mongodb/endpoint'), { data: { reset: true } });
					assert.equal(reset.status(), 200, await reset.text());
					headers['X-Thingtime-Expected-Data-Plane'] = 'home';
				}
				await page.reload();
			};
			const network = await context.newCDPSession(page);
			await network.send('Network.enable');
			const connectivity = async (value: boolean) => {
				if (!value) offline = false;
				await context.setOffline(value);
				await network.send('Network.overrideNetworkState', {
					offline: value,
					latency: 1,
					downloadThroughput: 100_000_000,
					uploadThroughput: 100_000_000,
					connectionType: 'ethernet'
				});
				if (value) offline = true;
			};
			await connectivity(false);
			await mkdir(resolve(evidence), { recursive: true });
			try {
				const health = await context.request.get(url('/api/v1/mongodb/status'));
				assert.equal(health.status(), 200);
				const store = await health.json();
				if (process.env.TT_RENDER_SESSION) {
					const isolation = await (await context.request.get(url('/api/v1/health/nitro'))).json();
					assert.equal(isolation.testEnvironment.mode, 'isolated-agent-test');
					assert.equal(isolation.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
					assert.equal(store.host, '127.0.0.1:27017');
					assert.match(store.replicaSet, /^tt-agent-/);
				} else {
					assert.equal(store.host, '127.0.0.1:22463');
					assert.equal(store.replicaSet, 'draftPreview');
				}
				assert.equal(store.custom, false);
				const username = 'themeorg-' + randomUUID().slice(0, 8);
				const registration = await context.request.post(url('/api/v1/auth/register'), {
					headers,
					data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
				});
				assert.equal(registration.status(), 200);
				ownerId = (await registration.json()).user.id;
				headers['X-Thingtime-Expected-Actor'] = ownerId;
				await page.goto(url(libraryPath()));
				for (const [kind, name] of [
					['folder', folderName],
					['data', dataName]
				]) {
					const r = await native.post(url('/api/v1/things'), {
						headers,
						data: { thingtime: [kind], crystal: { name }, visibility: 'private' }
					});
					assert.equal(r.status(), 200, await r.text());
					const id = (await r.json()).thing.id;
					if (kind === 'folder') folderId = id;
					else dataId = id;
				}
				themeId = randomUUID();
				const create = await native.post(url('/api/v1/themes/sync'), {
					headers,
					data: {
						operation: 'write',
						expectedOwnerId: ownerId,
						command: {
							action: 'save',
							id: themeId,
							writeId: randomUUID(),
							expectedVersion: null,
							name: title,
							theme: { colors: { accent: '#bf8068' } },
							visibility: 'private'
						}
					}
				});
				assert.equal(create.status(), 200);
				await page.goto(url(libraryPath()));
				await page.getByRole('link', { name: title, exact: true }).waitFor();
				await page.getByRole('link', { name: dataName, exact: true }).waitFor();
				await page.waitForFunction(async () => {
					await navigator.serviceWorker.ready;
					if (!navigator.serviceWorker.controller) return false;
					for (const key of await caches.keys())
						if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
							return true;
					return false;
				});
				if (customPlane) {
					const status = await (await native.get(url('/api/v1/mongodb/status'))).json();
					assert.equal(status.host, '127.0.0.1:27017');
					assert.match(status.replicaSet, /^tt-agent-/);
					const database = 'theme_organization_' + randomUUID().replace(/-/g, '');
					const activated = await native.post(url('/api/v1/mongodb/endpoint'), {
						data: { url: `mongodb://127.0.0.1:27017/${database}?replicaSet=${encodeURIComponent(status.replicaSet)}` }
					});
					assert.equal(activated.status(), 200, await activated.text());
					const root = await (await native.get(url('/api/root-data'))).json();
					selectedCustom = root.dataPlane;
					assert.match(selectedCustom, /^custom-/);
					headers['X-Thingtime-Expected-Data-Plane'] = selectedCustom;
					await page.goto(url('/things'));
					await page.getByRole('link', { name: 'Home library', exact: true }).click();
					await page.getByRole('link', { name: title, exact: true }).waitFor();
					await page.getByRole('link', { name: dataName, exact: true }).waitFor();
					await page.waitForLoadState('networkidle');
				}
				await goOffline();
				await page.getByRole('link', { name: title, exact: true }).click({ button: 'right' });
				await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
				title = 'Offline display ' + title;
				await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill(title);
				await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
				await page.getByRole('dialog').waitFor({ state: 'hidden' });
				await page.reload();
				await page.getByRole('link', { name: title, exact: true }).waitFor();
				await select(title);
				await select(dataName);
				await page.getByRole('button', { name: '📁 Move', exact: true }).click();
				let dialog = page.getByRole('dialog');
				await dialog.getByText(folderName, { exact: true }).click();
				await dialog.getByRole('button', { name: 'Move here', exact: true }).click();
				await dialog.waitFor({ state: 'hidden' });
				await page.goto(url(libraryPath(folderId)));
				await page.getByRole('link', { name: title, exact: true }).waitFor();
				await page.getByRole('link', { name: dataName, exact: true }).waitFor();
				await page.reload();
				await page.getByRole('link', { name: title, exact: true }).waitFor();
				assert.equal(await page.getByText('Couldn’t refresh your computers 😔', { exact: true }).count(), 0);
				for (const width of [1440, 390, 320]) {
					await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
					assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
					await page.screenshot({ path: resolve(evidence, `theme-library-${width}.png`), fullPage: true, animations: 'disabled' });
				}
				checks.push('mixed theme and ordinary move, cold offline folder reload and responsive library');
				await reconnect();
				await until(async () => {
					const [theme, data] = await Promise.all([read(themeId), read(dataId)]);
					return theme.thing?.folderId === folderId && theme.thing?.crystal.title === title && data.thing?.folderId === folderId;
				});
				assert.equal((await read(themeId)).thing.visibility, 'private');
				assert.equal((await read(themeId)).thing.crystal.name, sourceTitle);
				assert.equal((await guest.request.get(url('/api/v1/things?id=' + themeId))).status(), 404);
				await page.setViewportSize({ width: 1440, height: 1000 });
				await page.goto(url(libraryPath()));
				await page.getByRole('link', { name: folderName, exact: true }).waitFor();
				await goOffline();
				await remove(folderName);
				await page.getByRole('link', { name: title, exact: true }).waitFor();
				await page.getByRole('link', { name: dataName, exact: true }).waitFor();
				await page.reload();
				await page.getByRole('link', { name: title, exact: true }).waitFor();
				checks.push('folder deletion drains theme and ordinary child locally before reconnect');
				await reconnect();
				await until(async () => {
					const [folder, theme, data] = await Promise.all([read(folderId), read(themeId), read(dataId)]);
					return folder.status === 404 && theme.status === 200 && !theme.thing.folderId && data.status === 200 && !data.thing.folderId;
				});
				await goOffline();
				await remove(title);
				await page.reload();
				assert.equal(await page.getByRole('link', { name: title, exact: true }).count(), 0);
				await reconnect();
				await until(async () => (await read(themeId)).status === 404);
				await page.reload();
				assert.equal(await page.getByRole('link', { name: title, exact: true }).count(), 0);
				checks.push('dedicated theme deletion persists across reload and synchronizes without generic protected writes');
				assert.deepEqual(
					writes.filter((row) => row.offline),
					[]
				);
				assert.deepEqual(
					deviceReads.filter((row) => row.offline),
					[]
				);
				assert.deepEqual(errors, []);
				assert.equal(
					writes.some((row) => row.path.endsWith('/things/bulk')),
					false
				);
				await writeFile(
					resolve(evidence, 'verification.json'),
					JSON.stringify(
						{
							checks,
							customPlane,
							selectedCustom,
							offlineRename: true,
							sourceTitle,
							displayTitle: title,
							writes,
							deviceReads,
							errors,
							viewports: [1440, 390, 320]
						},
						null,
						2
					)
				);
			} catch (error) {
				await page.screenshot({ path: resolve(evidence, 'failure.png'), fullPage: true }).catch(() => {});
				const local = await page.evaluate(async () => {
					const db = await new Promise<IDBDatabase>((resolve, reject) => {
						const request = indexedDB.open('thingtime.local-workspaces.v1');
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					});
					try {
						return await new Promise<unknown[]>((resolve, reject) => {
							const request = db.transaction('records').objectStore('records').getAll();
							request.onsuccess = () => resolve(request.result.filter((row: any) => ['thing-sync', 'account-theme-sync', 'things'].includes(row.collection)));
							request.onerror = () => reject(request.error);
						});
					} finally { db.close(); }
				}).catch(() => []);
				const remote = !offline ? await Promise.all([read(themeId), read(dataId), read(folderId)]).catch(() => []) : [];
				await writeFile(
					resolve(evidence, 'failure.json'),
					JSON.stringify(
						{
							error: String(error),
							checks,
							local,
							remote,
							body: await page
								.locator('body')
								.innerText()
								.catch(() => ''),
							writes,
							errors
						},
						null,
						2
					)
				);
				throw error;
			} finally {
				await context.setOffline(false).catch(() => {});
				if (themeId) await native.post(url('/api/v1/themes/delete'), { headers, data: { id: themeId } }).catch(() => {});
				for (const id of [dataId, folderId].filter(Boolean)) await native.delete(url('/api/v1/things'), { headers, data: { id } }).catch(() => {});
				await browser.close();
			}
		}
	);

test(
	'anonymous native library preserves folder contents and deletes the applied theme fully offline without any account writes',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 120_000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
		const { chromium } = await import(playwrightPath!);
		const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
		const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
			page = await context.newPage(),
			writes: string[] = [],
			errors: string[] = [];
		page.setDefaultTimeout(20000);
		page.on('request', (request: any) => {
			if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname);
		});
		page.on('pageerror', (error: Error) => errors.push(error.message));
		let title = 'Anonymous peach ' + randomUUID().slice(0, 6),
			folderName = 'Anonymous looks ' + randomUUID().slice(0, 6),
			url = (path: string) => new URL(path, origin).href;
		const sourceTitle = title;
		await mkdir(resolve(artifacts!), { recursive: true });
		const file = resolve(artifacts!, 'anonymous-input.json');
		await writeFile(
			file,
			JSON.stringify({
				format: 'thingtime.transfer',
				version: 1,
				roots: ['folder'],
				things: [
					{ id: 'folder', thingtime: ['folder'], crystal: { name: folderName } },
					{ id: 'theme', thingtime: ['theme'], folderId: 'folder', crystal: { name: title, theme: { colors: { accent: '#bf8068' } } } }
				],
				files: []
			})
		);
		const remove = async (name: string) => {
			const input = page.getByRole('checkbox', { name: 'Select ' + name, exact: true });
			await page.locator('label').filter({ has: input }).click();
			await page.getByRole('button', { name: '🗑️ Delete', exact: true }).click();
			const dialog = page.getByRole('dialog');
			await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
			await dialog.waitFor({ state: 'hidden' });
			await page.getByRole('link', { name, exact: true }).waitFor({ state: 'hidden' });
		};
		try {
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
			await context.setOffline(true);
			await page.reload();
			await page.getByTestId('thing-transfer-menu').first().click();
			await page.getByRole('menuitem', { name: 'Import into my Things…', exact: true }).click();
			await page.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles(file);
			await page.getByText('1 transfer ready to import', { exact: true }).waitFor();
			await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
			await page.getByRole('dialog').waitFor({ state: 'hidden' });
			await page.getByRole('button', { name: 'Apply', exact: true }).last().click();
			await page.getByText(title + ' ⭐', { exact: true }).waitFor();
			await page.goto(url('/things'));
			await remove(folderName);
			await page.getByRole('link', { name: title, exact: true }).waitFor();
			await page.reload();
			await page.getByRole('link', { name: title, exact: true }).waitFor();
			await page.getByRole('link', { name: title, exact: true }).click({ button: 'right' });
			await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
			title = 'Offline display ' + title;
			await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill(title);
			await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
			await page.getByRole('dialog').waitFor({ state: 'hidden' });
			await page.reload();
			await page.getByRole('link', { name: title, exact: true }).waitFor();
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.waitForTimeout(100);
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				await page.screenshot({ path: resolve(artifacts!, `anonymous-theme-title-${width}.png`), fullPage: true, animations: 'disabled' });
			}
			await remove(title);
			await page.reload();
			assert.equal(await page.getByRole('link', { name: title, exact: true }).count(), 0);
			await page.goto(url('/themes'));
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).waitFor();
			assert.equal(await page.getByText(sourceTitle + ' ⭐', { exact: true }).count(), 0);
			assert.deepEqual(writes, []);
			assert.deepEqual(errors, []);
			await writeFile(
				resolve(artifacts!, 'anonymous-verification.json'),
				JSON.stringify(
					{
						anonymous: true,
						offlineRename: true,
						sourceTitle,
						displayTitle: title,
						viewports: [1440, 390, 320],
						offlineFolderDrain: true,
						offlineAppliedThemeDeletion: true,
						writes,
						errors
					},
					null,
					2
				)
			);
		} catch (error) {
			await page.screenshot({ path: resolve(artifacts!, 'anonymous-failure.png'), fullPage: true }).catch(() => {});
			await writeFile(
				resolve(artifacts!, 'anonymous-failure.json'),
				JSON.stringify(
					{
						error: String(error),
						body: await page
							.locator('body')
							.innerText()
							.catch(() => ''),
						writes,
						errors
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
