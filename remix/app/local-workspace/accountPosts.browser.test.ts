import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_ACCOUNT_POSTS_URL,
	artifacts = process.env.TT_LOCAL_ACCOUNT_POSTS_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'account post snapshots support offline bookmarks, reactions, Saved and scoped permalink recovery',
	{ skip: !base || !playwrightPath, timeout: 180_000 },
	async () => {
		assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
		const { chromium } = await import(playwrightPath!),
			browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
		const reader = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			author = await browser.newContext(),
			page = await reader.newPage();
		page.setDefaultTimeout(15_000);
		const headers = { Origin: new URL(base!).origin },
			url = (path: string) => new URL(path, base).href,
			errors: string[] = [],
			writes: any[] = [],
			bounds: any[] = [];
		let offline = false,
			id = '';
		page.on('pageerror', (error: Error) => errors.push(error.message));
		reader.on('request', (request: any) => {
			if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ path: new URL(request.url()).pathname, offline });
		});
		try {
			if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
			const register = async (context: any, prefix: string) => {
				const username = `${prefix}-${randomUUID().slice(0, 8)}`,
					password = randomUUID() + randomUUID();
				const response = await context.request.post(url('/api/v1/auth/register'), {
					headers,
					data: { username, email: `${username}@example.test`, password }
				});
				assert.equal(response.status(), 200, await response.text());
				return { ...(await response.json()).user, password };
			};
			const viewer = await register(reader, 'postreader'),
				creator = await register(author, 'postauthor');
			const text = 'A shared post retained for this account only.';
			const created = await author.request.post(url('/api/v1/things'), {
				headers,
				data: { thingtime: ['post'], crystal: { type: 'text', text }, acl: ['tt:custom', 'tt:user', `tt:user/${viewer.username}/comment`] }
			});
			assert.equal(created.status(), 200, await created.text());
			const createdBody = await created.json();
			id = createdBody.thing?.id || createdBody.post?.id || createdBody.id;
			assert.ok(id);
			const initial = await reader.request.get(url(`/api/v1/things?id=${id}`));
			assert.equal(initial.status(), 200, await initial.text());
			assert.equal((await initial.json()).post.author.id, creator.id);
			await page.goto(url(`/post/${id}`));
			await page.getByText(text, { exact: true }).waitFor();
			await page.getByRole('button', { name: 'Save to library', exact: true }).waitFor();
			await page.waitForFunction(async () => {
				await navigator.serviceWorker.ready;
				if (!navigator.serviceWorker.controller) return false;
				for (const key of await caches.keys())
					if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
						return true;
				return false;
			});
			await reader.setOffline(true);
			offline = true;
			assert.equal(
				await page.evaluate(async () => {
					try {
						await fetch('/api/root-data?post-offline', { cache: 'no-store' });
						return false;
					} catch {
						return true;
					}
				}),
				true
			);
			await page.reload();
			await page.getByText(text, { exact: true }).waitFor();
			await page.getByText('Saved on this device. Account updates and cloud media need a connection.', { exact: true }).waitFor();
			await page.getByRole('button', { name: 'Save to library', exact: true }).click();
			await page.getByRole('button', { name: 'Remove from Saved', exact: true }).waitFor();
			await page.getByRole('button', { name: 'React', exact: true }).click();
			await page.getByRole('button', { name: 'React ❤️', exact: true }).click();
			await page.goto(url('/saved'));
			await page.getByText(text, { exact: true }).waitFor();
			await page.getByText('Saved on this device. Your online account may contain more saved posts.', { exact: true }).waitFor();
			await page.reload();
			await page.getByText(text, { exact: true }).waitFor();
			const other = await reader.newPage();
			await other.goto(url(`/post/${id}`));
			await other.getByRole('button', { name: 'Remove from Saved', exact: true }).click();
			await page.getByText(text, { exact: true }).waitFor({ state: 'hidden' });
			await other.getByRole('button', { name: 'Save to library', exact: true }).click();
			await page.getByText(text, { exact: true }).waitFor();
			await other.close();
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				await page.evaluate(() => scrollTo(0, 0));
				const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
				assert.equal(size.width, size.scroll);
				bounds.push(size);
				if (artifacts) await page.screenshot({ path: resolve(artifacts, `account-saved-${width}.png`) });
			}
			assert.deepEqual(
				writes.filter((row) => row.offline),
				[]
			);
			offline = false;
			await reader.setOffline(false);
			await page.reload();
			await page.getByRole('region', { name: 'Account interaction sync', exact: true }).waitFor({ state: 'hidden', timeout: 90_000 });
			let remote: any;
			for (let attempt = 0; attempt < 45; attempt++) {
				const response = await reader.request.get(url(`/api/v1/things/interactions?id=${id}`));
				if (response.status() === 200) {
					remote = (await response.json()).states[0];
					if (remote.saved && remote.reactions.includes('❤️')) break;
				}
				await new Promise((r) => setTimeout(r, 2000));
			}
			assert.equal(remote.saved, true);
			assert.deepEqual(remote.reactions, ['❤️']);
			// A retained private projection belongs only to this account workspace.
			await page.goto(url(`/post/${id}`));
			await page.getByText(text, { exact: true }).waitFor();
			assert.equal((await reader.request.post(url('/api/v1/auth/logout'), { headers })).status(), 200);
			await page.reload();
			await page.getByRole('button', { name: 'Back to the feed 📰', exact: true }).waitFor();
			await reader.setOffline(true);
			offline = true;
			await page.reload();
			await page.getByRole('button', { name: 'Back to the feed 📰', exact: true }).waitFor();
			assert.equal(await page.getByText(text, { exact: true }).count(), 0);
			offline = false;
			await reader.setOffline(false);
			const login = await reader.request.post(url('/api/v1/login'), { headers, data: { username: viewer.username, password: viewer.password } });
			assert.equal(login.status(), 200, await login.text());
			await page.goto(url(`/post/${id}`));
			await page.getByText(text, { exact: true }).waitFor();
			// Revoke the original read grant. A fresh normal read must evict the retained
			// display snapshot, and an offline replay must not resurrect that refusal.
			const revoked = await author.request.patch(url('/api/v1/things'), { headers, data: { id, acl: ['tt:user'] } });
			assert.equal(revoked.status(), 200, await revoked.text());
			await page.goto(url(`/post/${id}`));
			await page.getByText(text, { exact: true }).waitFor({ state: 'hidden' });
			await page.getByRole('button', { name: 'Back to the feed 📰', exact: true }).waitFor();
			await reader.setOffline(true);
			offline = true;
			await page.reload();
			await page.getByText(text, { exact: true }).waitFor({ state: 'hidden' });
			await page.getByRole('button', { name: 'Back to the feed 📰', exact: true }).waitFor();
			assert.deepEqual(errors, []);
			if (artifacts)
				await writeFile(
					resolve(artifacts, 'verification.json'),
					JSON.stringify(
						{
							offlineReload: true,
							foreignAuthorPreserved: true,
							crossTab: true,
							savedLibrary: true,
							reconnectedMembership: remote,
							revocationEvictsSnapshot: true,
							logoutOfflineIsolation: true,
							bounds,
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
			await reader.setOffline(false);
			for (const context of [reader, author]) for (const tab of context.pages()) await tab.close();
			if (id) await author.request.delete(url(`/api/v1/things?id=${id}`), { headers });
			for (const context of [reader, author]) await context.request.post(url('/api/v1/auth/logout'), { headers });
			await browser.close();
		}
	}
);
