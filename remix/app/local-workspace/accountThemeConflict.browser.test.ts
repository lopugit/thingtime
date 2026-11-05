import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_ACCOUNT_THEME_CONFLICT_URL,
	artifacts = process.env.TT_ACCOUNT_THEME_CONFLICT_ARTIFACTS;
test(
	'native account theme conflict review preserves independent private copies and survives immediate offline reload',
	{ skip: !base || !artifacts || !process.env.TT_SHARED_PLAYWRIGHT_PATH, timeout: 180_000 },
	async () => {
		const origin = new URL(base!).origin,
			output = resolve(artifacts!);
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
		const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
		const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
		const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
			page = await context.newPage(),
			headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' };
		const errors: string[] = [],
			checks: string[] = [];
		let owner = '',
			created = false;
		page.setDefaultTimeout(25000);
		page.on('pageerror', (error: Error) => errors.push(error.message));
		const post = (path, data) => context.request.post(origin + path, { headers, data });
		const snapshot = async () => {
			const response = await post('/api/v1/themes/sync', { operation: 'snapshot', expectedOwnerId: owner });
			assert.equal(response.status(), 200);
			return (await response.json()).themes;
		};
		await mkdir(output, { recursive: true });
		try {
			const response = await context.request.get(origin + '/api/v1/mongodb/status');
			assert.equal(response.status(), 200);
			const health = await response.json();
			assert.equal(health.host, '127.0.0.1:22463');
			assert.equal(health.custom, false);
			const username = 'themeconflict-' + randomUUID().slice(0, 8),
				name = 'Conflict peach ' + randomUUID().slice(0, 6);
			const signup = await post('/api/v1/auth/register', { username, email: username + '@example.test', password: randomUUID() + randomUUID() });
			assert.equal(signup.status(), 200);
			owner = (await signup.json()).user.id;
			created = true;
			const save = await post('/api/v1/themes', { name, theme: { colors: { accent: '#bb8866' } }, visibility: 'private' });
			assert.equal(save.status(), 200);
			const original = (await save.json()).theme;
			await page.goto(origin + '/themes');
			await page.getByRole('button', { name: 'Apply', exact: true }).last().click();
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
			await page.locator('input:not([type="color"])[value="#bb8866"]').fill('#885544');
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
			await page.getByText('saved on this device · pending', { exact: true }).waitFor();
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).waitFor();
			await page.reload();
			await page.locator('input:not([type="color"])[value="#885544"]').waitFor();
			checks.push('native offline edit and reload preserve changed tokens');
			// APIRequestContext is intentionally independent of browser offline emulation:
			// this normal private write represents a concurrent second device.
			const remote = await post('/api/v1/themes', {
				id: original.id,
				name: 'Account newer peach',
				theme: { colors: { accent: '#226688' } },
				visibility: 'private',
				expectedUpdatedAt: original.updatedAt
			});
			assert.equal(remote.status(), 200);
			await context.setOffline(false);
			await page.reload();
			await page.getByRole('button', { name: 'Review theme', exact: true }).click();
			await page.getByRole('region', { name: 'Theme sync comparison', exact: true }).waitFor();
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				await page
					.getByRole('region', { name: 'Theme sync comparison', exact: true })
					.screenshot({ path: resolve(output, `comparison-${width}.png`), animations: 'disabled' });
			}
			checks.push('normal concurrent edit produces explicit bounded native conflict review at all viewports');
			await page.getByRole('button', { name: 'Keep device as private copy', exact: true }).click();
			let rows: any[] = [],
				copy: any,
				selection: any;
			// A reload can leave a legitimate 60s claim. Poll one operation at a
			// time within the 60/min endpoint budget, leaving room for app sync.
			for (let i = 0; i < 40; i++) {
				if (!copy) {
					rows = await snapshot();
					copy = rows.find((row: any) => row.id !== original.id);
				}
				if (copy) {
					const selected = await post('/api/v1/themes/sync', { operation: 'selection', expectedOwnerId: owner });
					const response = await selected.json();
					assert.equal(selected.status(), 200, JSON.stringify(response));
					selection = response.selection;
					assert.ok(selection, 'Selection response must be complete');
					if (selection.themeId === copy.id) break;
				}
				await page.waitForTimeout(3000);
			}
			assert.ok(copy);
			assert.equal(copy.visibility, 'private');
			assert.equal(copy.theme.colors.accent, '#885544');
			assert.equal(rows.find((row) => row.id === original.id).theme.colors.accent, '#226688');
			assert.equal(selection.themeId, copy.id);
			await page.reload();
			await page.getByText(copy.name + ' ⭐', { exact: true }).waitFor();
			await page.locator('input:not([type="color"])[value="#885544"]').waitFor();
			assert.deepEqual(errors, []);
			checks.push('private independent copy preserves both versions and remaps selected theme through reload');
			await writeFile(resolve(output, 'verification.json'), JSON.stringify({ checks, errors, viewports: [1440, 390, 320] }, null, 2));
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
						inputs: await page
							.locator('input')
							.evaluateAll((nodes: HTMLInputElement[]) => nodes.map((n) => ({ type: n.type, value: n.value })))
							.catch(() => []),
						errors
					},
					null,
					2
				)
			);
			throw error;
		} finally {
			await context.setOffline(false).catch(() => {});
			if (created) {
				for (const row of await snapshot().catch(() => []))
					await context.request.delete(origin + '/api/v1/themes', { headers, data: { id: row.id } }).catch(() => {});
			}
			await browser.close();
		}
	}
);
