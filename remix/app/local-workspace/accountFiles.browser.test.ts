import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_FILE_SYNC_URL,
	adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH,
	artifacts = process.env.TT_LOCAL_FILE_SYNC_ARTIFACTS;
test(
	'account file adapter persists offline bytes and resumes the real private upload lifecycle',
	{ skip: !base || !adminFile || !playwrightPath, timeout: 120_000 },
	async () => {
		assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
		const { chromium } = await import(playwrightPath!),
			browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			admin = await browser.newContext(),
			guest = await browser.newContext(),
			page = await context.newPage();
		page.setDefaultTimeout(20_000);
		const headers = { Origin: new URL(base!).origin },
			url = (path: string) => new URL(path, base).href,
			errors: string[] = [],
			writes: any[] = [];
		let offline = false,
			remoteId = '',
			dropped = 0;
		page.on('framenavigated', (frame) => {
			if (frame === page.mainFrame()) writes.push({ navigation: frame.url(), offline });
		});
		page.on('console', (message) => {
			if (message.text().startsWith('[vite]')) writes.push({ vite: message.text(), offline });
		});
		page.on('pageerror', (error: Error) => errors.push(error.message));
		context.on('request', (request: any) => {
			if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
				writes.push({
					path: new URL(request.url()).pathname,
					method: request.method(),
					offline,
					actor: request.headers()['x-thingtime-expected-actor'],
					plane: request.headers()['x-thingtime-expected-data-plane']
				});
		});
		context.on('response', async (response: any) => {
			const path = new URL(response.url()).pathname;
			if (path.startsWith('/api/v1/attachments/uploads')) {
				const body = await response.json().catch(() => null);
				writes.push({
					response: path,
					status: response.status(),
					code: body?.code,
					fields: Object.keys(body || {}),
					partOrigins: body?.parts?.map((part: any) => {
						try {
							return new URL(part.url, base).origin;
						} catch {
							return 'invalid';
						}
					})
				});
			}
		});
		try {
			if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
			const administrator = JSON.parse(await readFile(adminFile!, 'utf8'));
			const adminLogin = await admin.request.post(url('/api/v1/login'), {
				headers,
				data: { username: administrator.username, password: administrator.password }
			});
			assert.equal(adminLogin.status(), 200);
			const username = 'file-reader-' + randomUUID().slice(0, 8),
				registered = await context.request.post(url('/api/v1/auth/register'), {
					headers,
					data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
				});
			assert.equal(registered.status(), 200, await registered.text());
			const owner = (await registered.json()).user;
			await page.goto(url('/things'));
			await page.getByRole('heading', { name: 'Things', exact: true }).waitFor();
			await page.evaluate(async () => {
				const paths = ['/app/local-workspace/runtime.client.ts', '/app/local-workspace/accountApi.client.ts'];
				const [runtime, api] = await Promise.all(paths.map((path) => import(path)));
				if (!runtime.currentAccountWorkspace() || !api.accountApi) throw Error('Account adapter unavailable');
			});
			// Imports can finish Vite dependency optimization; settle the actual app
			// before deliberately disconnecting its development server.
			await page.waitForLoadState('networkidle');
			offline = true;
			await context.setOffline(true);
			assert.equal(
				await page.evaluate(async () => {
					try {
						await fetch('/api/root-data?file-offline', { cache: 'no-store' });
						return false;
					} catch {
						return true;
					}
				}),
				true
			);
			const requestId = randomUUID(),
				text = 'Private bytes saved before account upload.';
			const localId = await page.evaluate(
				async ({ requestId, text }) => {
					const paths = ['/app/local-workspace/runtime.client.ts', '/app/local-workspace/accountApi.client.ts'],
						[runtime, api] = await Promise.all(paths.map((path) => import(path))),
						scope = runtime.currentAccountWorkspace(),
						facade = api.accountApi({ things: {}, attachments: {} }, { id: scope.ownerId }, scope.dataPlane);
					const result = await facade.attachments.saveLocalFile({
						requestId,
						name: 'offline-file.txt',
						contentType: 'text/plain',
						bytes: new TextEncoder().encode(text),
						purpose: 'file'
					});
					const read = await facade.attachments.readLocalFile({ id: result.attachment.id });
					if (new TextDecoder().decode(read.bytes) !== text) throw Error('Device bytes changed');
					return result.attachment.id;
				},
				{ requestId, text }
			);
			await page.getByRole('region', { name: 'Account file sync', exact: true }).waitFor();
			assert.deepEqual(
				writes.filter((row) => row.offline && row.method),
				[]
			);
			await page.getByText('Review file sync', { exact: true }).click();
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				await page.evaluate(() => scrollTo(0, 0));
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				if (artifacts) await page.screenshot({ path: resolve(artifacts, `file-sync-${width}.png`) });
			}
			offline = false;
			await context.setOffline(false);
			await page.evaluate(() => window.dispatchEvent(new Event('thingtime:root-data-refresh')));
			await page
				.getByRole('region', { name: 'Account file sync', exact: true })
				.getByRole('status')
				.filter({ hasText: 'Account upload needs attention.' })
				.waitFor();
			const blocked = await page.evaluate(async () => {
				const paths = ['/app/local-workspace/runtime.client.ts', '/app/local-workspace/accountApi.client.ts'],
					[runtime, api] = await Promise.all(paths.map((path) => import(path)));
				return api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.status();
			});
			assert.equal(blocked[0].state, 'error');
			assert.equal(blocked[0].remoteId, undefined);
			const approval = await admin.request.post(url('/api/v1/admin/users/public-uploads'), {
				headers,
				data: { userId: owner.id, enabled: true, scope: 'private' }
			});
			assert.equal(approval.status(), 200, await approval.text());
			await context.route('**/api/v1/attachments/uploads/complete', async (route: any) => {
				if (!dropped) {
					const response = await route.fetch();
					if (response.status() === 200) {
						dropped++;
						return route.abort('failed');
					}
					return route.fulfill({ response });
				}
				return route.continue();
			});
			await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
			await page.getByRole('region', { name: 'Account file sync', exact: true }).waitFor({ state: 'hidden', timeout: 75_000 });
			remoteId = await page.evaluate(async (localId) => {
				const paths = ['/app/local-workspace/runtime.client.ts', '/app/local-workspace/accountApi.client.ts'],
					[runtime, api] = await Promise.all(paths.map((path) => import(path)));
				return api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.remoteId(localId);
			}, localId);
			assert.ok(typeof remoteId === 'string' && remoteId.length > 0, 'completion supplies a canonical account file ID');
			const content = await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}&download=1`));
			assert.equal(content.status(), 200, await content.text());
			assert.equal(await content.text(), text);
			assert.equal((await guest.request.get(url(`/api/v1/attachments/content?id=${remoteId}`))).status(), 404);
			assert.equal(dropped, 1);
			assert.equal(writes.filter((row) => row.method === 'PUT').length, 1);
			for (const row of writes.filter((row) => row.path?.startsWith('/api/v1/attachments/uploads'))) {
				assert.equal(row.actor, owner.id);
				assert.ok(row.plane);
			}
			assert.deepEqual(errors, []);
			if (artifacts)
				await writeFile(
					resolve(artifacts, 'verification.json'),
					JSON.stringify(
						{
							adapterOnly: true,
							offlineBytes: true,
							permissionRefusalPreservesBytes: true,
							privateUploadApprovedThroughAdminApi: true,
							lostCompletionReceipt: true,
							putCount: 1,
							remoteId,
							guestRefused: true,
							writes,
							errors
						},
						null,
						2
					)
				);
		} catch (error) {
			if (artifacts) {
				await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true });
				await writeFile(
					resolve(artifacts, 'failure.json'),
					JSON.stringify({ body: await page.locator('body').innerText(), writes, errors }, null, 2)
				);
			}
			throw error;
		} finally {
			await context.setOffline(false);
			if (remoteId) await context.request.delete(url(`/api/v1/things?id=${remoteId}`), { headers });
			for (const c of [context, admin, guest]) {
				await c.request.post(url('/api/v1/auth/logout'), { headers });
				await c.close();
			}
			await browser.close();
		}
	}
);
