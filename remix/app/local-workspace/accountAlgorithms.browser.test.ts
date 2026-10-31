import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseTransfer } from '../utils/thingTransfer/format';

const base = process.env.TT_ACCOUNT_ALGORITHMS_URL,
	output = process.env.TT_ACCOUNT_ALGORITHMS_ARTIFACTS;
test(
	'native account algorithms survive offline reload, normal transfer, independent sync and conflict copies',
	{
		skip: !base || !output || !process.env.TT_SHARED_PLAYWRIGHT_PATH,
		timeout: 300_000
	},
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
		const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
		const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
		const page = await context.newPage(),
			headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' };
		const checks: string[] = [],
			errors: string[] = [],
			writes: string[] = [],
			syncResponses: { status: number; retryAfter: string | null }[] = [],
			layouts: any[] = [];
		let owner = '',
			complete = false;
		page.setDefaultTimeout(45_000);
		await page.addInitScript(() => {
			window.addEventListener('error', (event) => console.error('Fixture error location', event.filename, event.lineno, event.colno, event.message));
		});
		page.on('console', (message) => {
			if (message.type() === 'error' && message.text().startsWith('Fixture error location')) console.info('Console error:', message.text(), JSON.stringify(message.location()));
		});
		page.on('pageerror', (error: Error) => {
			errors.push(error.stack || error.message);
			console.info('Browser error:', error.stack || error.message);
		});
		context.on('response', (response) => {
			if (new URL(response.url()).pathname === '/api/v1/algorithms/sync') syncResponses.push({ status: response.status(), retryAfter: response.headers()['retry-after'] ?? null });
		});
		context.on('request', (request) => {
			if (request.method() !== 'GET' && /\/api\/v1\/(algorithms|drafts)/.test(request.url())) writes.push(request.url());
		});
		const post = (path: string, data: unknown) => context.request.post(origin + path, { headers, data });
		const snapshot = async () => {
			const response = await post('/api/v1/algorithms/sync', { operation: 'snapshot', expectedOwnerId: owner });
			assert.equal(response.status(), 200, await response.text());
			return (await response.json()).algorithms;
		};
		const until = async (predicate: () => Promise<boolean>, label: string) => {
			// Interrupted tab claims and server rate windows can last 60 seconds.
			const end = Date.now() + 90000;
			while (!(await predicate())) {
				assert.ok(Date.now() < end, label);
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		};
		const open = async (target = page) => {
			await target.goto(origin + '/settings/things', { waitUntil: 'domcontentloaded', timeout: 60_000 });
			const section = target.locator('details').filter({ has: target.locator('summary').filter({ hasText: 'Feed algorithms' }) });
			if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open))) await section.locator('summary').click();
			await target.getByTestId('algorithm-manager').waitFor();
		};
		await mkdir(output!, { recursive: true });
		try {
			const shell = await context.request.get(origin + '/offline-shell-manifest.mjs');
			assert.match(
				await shell.text(),
				/"hash":"[a-f0-9]{64}"/,
				'Cold offline verification requires a fresh production client build served by Nitro, not the Vite HMR port'
			);
			const health = await context.request.get(origin + '/api/v1/mongodb/status');
			assert.equal(health.status(), 200);
			assert.equal((await health.json()).host, '127.0.0.1:22463');
			const username = 'algorithmnative-' + randomUUID().slice(0, 8),
				name = 'Native offline ' + randomUUID().slice(0, 6);
			const signup = await post('/api/v1/auth/register', { username, email: username + '@example.test', password: randomUUID() + randomUUID() });
			assert.equal(signup.status(), 200, await signup.text());
			owner = (await signup.json()).user.id;
			assert.deepEqual(await snapshot(), []);
			await open();
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
			const section = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Feed algorithms' }) });
			if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open))) await section.locator('summary').click();
			const before = writes.length;
			await page.getByRole('button', { name: 'New algorithm ➕', exact: true }).click();
			await page.getByPlaceholder('Name this algorithm…').fill(name);
			await page.getByRole('button', { name: 'Create ➕', exact: true }).click();
			const card = page.getByTestId('algorithm-card').filter({ has: page.getByRole('button', { name, exact: true }) });
			await card.waitFor();
			const id = await card.getAttribute('data-algorithm-id');
			assert.ok(id);
			await card.getByRole('button', { name: 'Set active ✅', exact: true }).click();
			await card.getByText('Active ✅', { exact: true }).waitFor();
			assert.equal(writes.length, before, 'offline creation and apply send no profile, selection or draft requests');
			checks.push('cold offline native create and apply without requests');
			const second = await context.newPage();
			await open(second);
			await second.getByRole('button', { name, exact: true }).waitFor();
			await second.close();
			checks.push('second offline tab reads the same home profile');
			const title = 'Offline shelf ' + randomUUID().slice(0, 6);
			await page.goto(origin + '/things');
			await page.getByRole('link', { name, exact: true }).click({ button: 'right' });
			await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
			await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill(title);
			await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
			await page.getByRole('dialog').waitFor({ state: 'hidden' });
			await page.reload();
			await page.getByRole('link', { name: title, exact: true }).waitFor();
			assert.equal(writes.length, before);
			checks.push('normal library display-title rename survives offline reload without account requests');
			await open();
			await page.locator('.lopuToast').first().waitFor({ state: 'hidden', timeout: 20_000 });
			for (const viewport of [
				{ width: 390, height: 844 },
				{ width: 320, height: 844 },
				{ width: 1440, height: 1000 }
			]) {
				await page.setViewportSize(viewport);
				await card.scrollIntoViewIfNeeded();
				await page.evaluate(() => document.fonts.ready);
				const bounds = await card.boundingBox();
				assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, 'card remains inside viewport');
				layouts.push({ viewport, bounds });
				await page.screenshot({ path: output + `/native-offline-${viewport.width}.png` });
			}
			await card.getByRole('button', { name: 'Transfer', exact: true }).click();
			await page.getByRole('menuitem', { name: 'Export / Download…', exact: true }).click();
			await page.getByLabel('Download format').selectOption('json');
			const download = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download', exact: true }).click();
			await (await download).saveAs(output + '/native-profile.thingtime.json');
			const manifest = parseTransfer(await readFile(output + '/native-profile.thingtime.json', 'utf8'));
			assert.equal(manifest.roots[0], id);
			assert.equal(manifest.things[0].crystal.name, name);
			assert.equal(manifest.things[0].crystal.title, title);
			assert.doesNotMatch(JSON.stringify(manifest), /"ownerId"|"shared"|"listed"|"writeId"/);
			await page.getByTestId('algorithm-manager').getByRole('button', { name: 'Transfer', exact: true }).first().click();
			await page.getByRole('menuitem', { name: 'Import into my Things…', exact: true }).click();
			await page.getByLabel('Thingtime transfer files').setInputFiles(output + '/native-profile.thingtime.json');
			await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
			await until(async () => (await page.getByTestId('algorithm-card').count()) === 2, 'normal offline import did not return to library');
			const ids = await page.getByTestId('algorithm-card').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-algorithm-id')));
			assert.equal(new Set(ids).size, 2);
			assert.ok(ids.includes(id));
			assert.equal(writes.length, before);
			checks.push('native canonical JSON download and normal offline importer round-trip with fresh ID');
			await context.setOffline(false);
			await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
			await until(async () => (await snapshot()).length === 2, 'profile queues did not synchronize');
			await until(async () => {
				const response = await context.request.get(origin + '/api/v1/auth/me');
				return (await response.json()).user.activeFeedAlgorithmId === id;
			}, 'selection did not synchronize');
			assert.ok((await snapshot()).every((row: any) => !row.shared && !row.listed && row.content.title === title));
			checks.push('reconnect synchronizes two private copies and independent active choice');
			await until(async () => !(await page.getByTestId('algorithm-sync-status').isVisible()), 'initial queues did not settle');
			await context.setOffline(true);
			const original = page.locator(`[data-algorithm-id="${id}"]`),
				deviceName = name + ' device',
				remoteName = name + ' account';
			await original.getByRole('button', { name, exact: true }).click();
			await original.getByLabel('Algorithm name').fill(deviceName);
			await original.getByLabel('Algorithm name').press('Enter');
			await original.getByRole('button', { name: deviceName, exact: true }).waitFor();
			const edit = await post('/api/v1/algorithms/update', { id, name: remoteName });
			assert.equal(edit.status(), 200, await edit.text());
			await context.setOffline(false);
			await page.getByRole('button', { name: 'Review ' + deviceName, exact: true }).click();
			await page.getByText('Review before replacing saved work', { exact: true }).waitFor();
			assert.ok((await page.getByTestId('algorithm-sync-status').innerText()).includes(remoteName));
			await page.getByRole('button', { name: 'Keep both', exact: true }).click();
			await page.getByRole('button', { name: deviceName + ' (device copy)', exact: true }).waitFor();
			await context.setOffline(true);
			await page.reload();
			const reopened = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Feed algorithms' }) });
			if (!(await reopened.evaluate((node) => (node as HTMLDetailsElement).open))) await reopened.locator('summary').click();
			await page.getByRole('button', { name: deviceName + ' (device copy)', exact: true }).waitFor();
			await page.getByRole('button', { name: remoteName, exact: true }).waitFor();
			await page.setViewportSize({ width: 390, height: 844 });
			await page.getByRole('button', { name: deviceName + ' (device copy)', exact: true }).scrollIntoViewIfNeeded();
			await page.screenshot({ path: output + '/native-conflict-copy-390.png' });
			checks.push('native conflict review retains both versions through immediate offline reload');
			await context.setOffline(false);
			await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
			await until(async () => (await snapshot()).length === 3, 'independent conflict copy did not synchronize');
			assert.deepEqual(errors, []);
			complete = true;
		} catch (error) {
			await page.screenshot({ path: output + '/failure.png' }).catch(() => {});
			await writeFile(
				output + '/failure.txt',
				await page
					.locator('body')
					.innerText()
					.catch(() => 'Page unavailable')
			);
			throw error;
		} finally {
			await context.setOffline(false);
			await page.close();
			if (owner) {
				const response = await context.request.get(origin + '/api/v1/algorithms');
				if (response.ok())
					for (const row of (await response.json()).algorithms) {
						const removed = await post('/api/v1/algorithms/delete', { id: row.id });
						assert.equal(removed.status(), 200);
					}
			}
			await writeFile(output + '/verification.json', JSON.stringify({ complete, checks, layouts, errors, syncResponses }, null, 2));
			await context.close();
			await browser.close();
		}
	}
);
