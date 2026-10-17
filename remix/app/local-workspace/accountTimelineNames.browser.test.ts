import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_ACCOUNT_NAMES_URL,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH,
	artifacts = process.env.TT_LOCAL_ACCOUNT_NAMES_ARTIFACTS;

test(
	'native account History names and notes complete locally, survive offline reload and sync independently',
	{ skip: !base || !playwrightPath, timeout: 180_000 },
	async () => {
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Disposable loopback fixtures only');
		const { chromium } = await import(playwrightPath!),
			browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			guest = await browser.newContext(),
			page = await context.newPage();
		const url = (path: string) => new URL(path, base).href,
			headers = { Origin: new URL(base!).origin };
		const title = 'Offline names fixture',
			note = 'A note saved while disconnected.',
			finalName = 'Remember this version';
		const errors: string[] = [],
			offlineWrites: string[] = [],
			commands: any[] = [];
		let thingId = '',
			ownerId = '',
			dataPlane = '',
			offline = false;
		page.setDefaultTimeout(20_000);
		page.on('pageerror', (error: Error) => errors.push(error.message));
		page.on('request', (request: any) => {
			const target = new URL(request.url());
			if (target.pathname === '/api/v1/timeline' && target.searchParams.get('dataPlane')) dataPlane = target.searchParams.get('dataPlane')!;
			if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
				if (offline) offlineWrites.push(new URL(request.url()).pathname);
				if (new URL(request.url()).pathname === '/api/v1/timeline') commands.push(request.postDataJSON());
			}
		});
		const history = page.getByRole('dialog', { name: 'History', exact: true });
		const open = async () => {
			await page.getByRole('button', { name: 'Thing actions', exact: true }).click();
			await page.getByRole('menuitem', { name: /History/ }).click();
			await history.waitFor();
			await history.getByRole('button', { name: new RegExp('Created Thing ' + title) }).click();
		};
		const details = (width: number) => (width === 1440 ? history : page.getByRole('dialog', { name: 'Version details', exact: true }));
		const close = async (width = 1440) => {
			if (width !== 1440) await details(width).getByRole('button', { name: 'Close', exact: true }).click();
			await history.getByRole('button', { name: 'Close', exact: true }).click();
			await history.waitFor({ state: 'detached' });
		};
		const version = (root: any) => root.locator('.history-version[data-selected="true"]');
		const remote = async () => {
			const response = await context.request.get(url('/api/v1/timeline?' + new URLSearchParams({ thingId, ownerId, dataPlane })));
			assert.equal(response.status(), 200, await response.text());
			return response.json();
		};
		try {
			if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
			const username = 'localnames-' + randomUUID().slice(0, 8),
				registration = await context.request.post(url('/api/v1/auth/register'), {
					headers,
					data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
				});
			assert.equal(registration.status(), 200, await registration.text());
			ownerId = (await registration.json()).user.id;
			const created = await context.request.post(url('/api/v1/things'), {
				headers,
				data: { thingtime: ['data'], crystal: { name: title, value: 'Private History name and note fixture' }, acl: ['tt:user'] }
			});
			assert.equal(created.status(), 200, await created.text());
			thingId = (await created.json()).thing.id;
			await page.goto(url('/thing/' + thingId));
			await open();
			await history.getByRole('tab', { name: 'Versions', exact: true }).click();
			await version(history).getByRole('textbox', { name: 'Version name', exact: true }).waitFor();
			await close();
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
			await open();
			await history.getByRole('tab', { name: 'Versions', exact: true }).click();
			for (const name of ['First offline name', 'Renamed offline']) {
				await version(history).getByRole('textbox', { name: 'Version name', exact: true }).fill(name);
				await version(history).getByRole('button', { name: 'Save', exact: true }).click();
				await version(history).getByText('Version name saved on this device. Account sync runs separately.', { exact: true }).waitFor();
			}
			await version(history).getByRole('button', { name: 'Clear', exact: true }).click();
			await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.history-version[data-selected="true"] input')?.value === '');
			await version(history).getByRole('textbox', { name: 'Version name', exact: true }).fill(finalName);
			await version(history).getByRole('button', { name: 'Save', exact: true }).click();
			await version(history).getByText('Version name saved on this device. Account sync runs separately.', { exact: true }).waitFor();
			await history.getByRole('tab', { name: 'Message', exact: true }).click();
			await history.getByRole('textbox', { name: 'Add a note to this change', exact: true }).fill(note);
			await history.getByRole('button', { name: 'Save note', exact: true }).click();
			await history.getByText('Saved on this device. This note will sync separately when your account is connected.', { exact: true }).waitFor();
			await close();
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				await page.reload();
				await page.getByRole('heading', { name: title, exact: true }).waitFor();
				await open();
				const panel = details(width);
				await panel.getByRole('tab', { name: 'Versions', exact: true }).click();
				assert.equal(await version(panel).getByRole('textbox', { name: 'Version name', exact: true }).inputValue(), finalName);
				await version(panel).getByText('Version name saved on this device · waiting to sync', { exact: true }).waitFor();
				await page.evaluate(() => document.fonts.ready);
				const bounds = await panel.boundingBox();
				assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				const inputBounds = await version(panel).getByRole('textbox', { name: 'Version name', exact: true }).boundingBox();
				assert.ok(inputBounds && inputBounds.width >= 90, 'The editable name field remains usable beside its controls');
				if (artifacts) await page.screenshot({ path: resolve(artifacts, `account-history-names-${width}.png`), animations: 'disabled' });
				await panel.getByRole('tab', { name: 'Message', exact: true }).click();
				await panel
					.getByRole('tabpanel', { name: 'Message', exact: true })
					.locator('.history-message-text')
					.getByText(note, { exact: true })
					.waitFor();
				await close(width);
			}
			assert.deepEqual(offlineWrites, []);
			const before = await remote();
			assert.equal((before.names ?? []).length, 0);
			assert.equal((before.notes ?? []).length, 0);
			offline = false;
			await context.setOffline(false);
			await page.setViewportSize({ width: 1440, height: 1000 });
			const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true });
			if (await reconnect.isVisible()) await reconnect.click();
			let accepted: any = null;
			for (let n = 0; n < 150; n++) {
				const result = await remote();
				if (result.names?.some((name: any) => name.name === finalName) && result.notes?.some((entry: any) => entry.text === note)) {
					accepted = result;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			assert.ok(accepted, 'queued names and note receive real account acknowledgements');
			await open();
			await history.getByRole('tab', { name: 'Versions', exact: true }).click();
			await page.waitForFunction(() => !document.body.innerText.includes('Version name saved on this device · waiting to sync'));
			await close();
			await page.reload();
			await page.getByRole('heading', { name: title, exact: true }).waitFor();
			await open();
			await close();
			offline = true;
			await context.setOffline(true);
			await page.reload();
			await open();
			await history.getByRole('tab', { name: 'Versions', exact: true }).click();
			assert.equal(await version(history).getByRole('textbox', { name: 'Version name', exact: true }).inputValue(), finalName);
			await history.getByRole('tab', { name: 'Message', exact: true }).click();
			await history
				.getByRole('tabpanel', { name: 'Message', exact: true })
				.locator('.history-message-text')
				.getByText(note, { exact: true })
				.waitFor();
			await history.getByRole('tabpanel', { name: 'Message', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
			await history.getByText('Saved on this device. This removal will sync separately when your account is connected.', { exact: true }).waitFor();
			assert.ok(
				(await remote()).notes.some((entry: any) => entry.text === note),
				'Offline removal has not reached the account'
			);
			await close();
			offline = false;
			await context.setOffline(false);
			if (await reconnect.isVisible()) await reconnect.click();
			let removed = false;
			for (let n = 0; n < 150; n++) {
				if (!(await remote()).notes.some((entry: any) => entry.text === note)) {
					removed = true;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			assert.ok(removed, 'The independently queued note removal reaches the account');
			assert.deepEqual(
				commands.filter((command) => command.command === 'name-version').map((command) => command.expectedRevision),
				[0, 1, 2, 0]
			);
			assert.equal((await guest.request.get(url('/api/v1/things?id=' + thingId))).status(), 404);
			assert.equal((await guest.request.get(url('/api/v1/timeline?thingId=' + thingId))).status(), 401);
			assert.deepEqual(errors, []);
			assert.deepEqual(offlineWrites, []);
			if (artifacts)
				await writeFile(
					resolve(artifacts, 'verification.json'),
					JSON.stringify(
						{
							thingId,
							nativeNames: true,
							nativeNotes: true,
							queuedNoteRemoval: true,
							coldOfflineReload: true,
							canonicalAcknowledgements: true,
							viewports: [1440, 390, 320],
							offlineWrites,
							errors,
							commands: commands.map((command) => ({ command: command.command, expectedRevision: command.expectedRevision }))
						},
						null,
						2
					)
				);
		} catch (error) {
			if (artifacts) {
				await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
				await writeFile(
					resolve(artifacts, 'failure.json'),
					JSON.stringify(
						{
							body: await page
								.locator('body')
								.innerText()
								.catch(() => ''),
							thingId,
							errors,
							offlineWrites,
							commands
						},
						null,
						2
					)
				);
			}
			throw error;
		} finally {
			await page.close();
			await context.setOffline(false).catch(() => {});
			if (thingId) await context.request.delete(url('/api/v1/things'), { headers, data: { id: thingId } }).catch(() => {});
			await guest.close();
			await context.close();
			await browser.close();
		}
	}
);
