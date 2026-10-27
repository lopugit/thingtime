import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_INTERACTIONS_URL,
	artifacts = process.env.TT_LOCAL_INTERACTIONS_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const enabled = !!base && !!playwrightPath;
test('account interactions complete offline, reconcile lost responses and reject stale writes', { skip: !enabled, timeout: 180_000 }, async () => {
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
	const { chromium } = await import(playwrightPath!),
		browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
		guest = await browser.newContext(),
		page = await context.newPage();
	page.setDefaultTimeout(15_000);
	const headers = { Origin: new URL(base!).origin },
		url = (path: string) => new URL(path, base).href,
		ids: string[] = [],
		errors: string[] = [],
		writes: any[] = [],
		bounds: any[] = [];
	let offline = false,
		dropped = 0;
	page.on('pageerror', (error: Error) => errors.push(error.message));
	context.on('request', (request: any) => {
		if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
			writes.push({
				path: new URL(request.url()).pathname,
				offline,
				actor: request.headers()['x-thingtime-expected-actor'],
				plane: request.headers()['x-thingtime-expected-data-plane']
			});
	});
	try {
		if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
		const username = `interactionqa-${randomUUID().slice(0, 8)}`,
			name = 'Offline account Library card';
		const registered = await context.request.post(url('/api/v1/auth/register'), {
			headers,
			data: { username, email: `${username}@example.test`, password: randomUUID() + randomUUID() }
		});
		assert.equal(registered.status(), 200);
		const owner = (await registered.json()).user.id;
		const created = await context.request.post(url('/api/v1/things'), {
			headers,
			data: {
				thingtime: ['component'],
				crystal: { name, componentKey: `interactions-${randomUUID()}`, version: 1, render: { tag: 'p', children: 'Native account Library preview' } },
				visibility: 'private'
			}
		});
		assert.equal(created.status(), 200, await created.text());
		const id = (await created.json()).thing.id;
		ids.push(id);
		const state = async () => {
			for (let attempt = 0; ; attempt++) {
				const r = await context.request.get(url(`/api/v1/things/interactions?id=${id}`));
				// A poll racing a committed interaction must acquire a fresh snapshot.
				if (r.status() === 409 && attempt < 5) {
					await new Promise((resolve) => setTimeout(resolve, 30));
					continue;
				}
				assert.equal(r.status(), 200, await r.text());
				return (await r.json()).states[0];
			}
		};
		const write = (body: any, extra: any = {}) =>
			context.request.post(url('/api/v1/things/interactions'), { headers: { ...headers, ...extra }, data: { id, ...body } });
		const first = await state();
		assert.equal(first.saved, false);
		assert.equal(first.revision, null);
		const save = { kind: 'save', active: true, expectedRevision: first.revision };
		assert.equal((await write(save)).status(), 200);
		assert.equal((await write(save)).status(), 409);
		assert.equal((await state()).saved, true);
		assert.equal((await context.request.post(url('/api/v1/things/save'), { headers, data: { id } })).status(), 200);
		const removed = await state();
		assert.equal(removed.saved, false);
		assert.notEqual(removed.revision, first.revision);
		assert.equal((await write(save)).status(), 409);
		const raced = await Promise.all([
			write({ kind: 'save', active: true, expectedRevision: removed.revision }),
			write({ kind: 'reaction', emoji: '❤️', active: true, expectedRevision: removed.revision })
		]);
		assert.deepEqual(raced.map((r) => r.status()).sort(), [200, 409]);
		const beforeMalformed = await state();
		assert.equal((await write({ kind: 'save', active: 'yes', expectedRevision: beforeMalformed.revision })).status(), 400);
		assert.equal((await state()).revision, beforeMalformed.revision);
		assert.equal((await write({ kind: 'save', active: true, expectedRevision: beforeMalformed.revision, extra: 'x'.repeat(5000) })).status(), 413);
		for (const query of ['', `?id=${id}&id=${id}`, `?id=${Array(51).fill(id).join(',')}`])
			assert.equal((await context.request.get(url(`/api/v1/things/interactions${query}`))).status(), 400);
		assert.equal(
			(await write({ kind: 'save', active: true, expectedRevision: beforeMalformed.revision }, { Origin: 'https://foreign.example' })).status(),
			403
		);
		assert.equal(
			(
				await write({ kind: 'save', active: true, expectedRevision: beforeMalformed.revision }, { 'X-Thingtime-Expected-Actor': 'wrong-account' })
			).status(),
			409
		);
		assert.equal((await guest.request.get(url(`/api/v1/things/interactions?id=${id}`))).status(), 401);
		const foreignName = `interaction-other-${randomUUID().slice(0, 8)}`;
		assert.equal(
			(
				await guest.request.post(url('/api/v1/auth/register'), {
					headers,
					data: { username: foreignName, email: `${foreignName}@example.test`, password: randomUUID() + randomUUID() }
				})
			).status(),
			200
		);
		assert.equal((await guest.request.get(url(`/api/v1/things/interactions?id=${id}`))).status(), 404);
		assert.notEqual(
			(
				await write(
					{ kind: 'save', active: true, expectedRevision: beforeMalformed.revision },
					{ 'X-Thingtime-Expected-Data-Plane': 'foreign-plane' }
				)
			).status(),
			200
		);
		const child = await context.request.post(url('/api/v1/things'), {
			headers,
			data: { thingtime: ['reaction'], targetId: id, crystal: { emoji: '🦄' } }
		});
		assert.equal(child.status(), 200, await child.text());
		const childId = (await child.json()).thing.id;
		const added = await state();
		assert.ok(added.reactions.includes('🦄'));
		assert.notEqual(added.revision, beforeMalformed.revision);
		const edited = await context.request.patch(url('/api/v1/things'), { headers, data: { id: childId, crystal: { emoji: '🌈' } } });
		assert.equal(edited.status(), 200, await edited.text());
		assert.notEqual((await state()).revision, added.revision);
		const editedState = await state();
		assert.equal((await context.request.delete(url(`/api/v1/things?id=${childId}`), { headers })).status(), 200);
		assert.notEqual((await state()).revision, editedState.revision);
		assert.equal((await write({ kind: 'save', active: true, expectedRevision: added.revision })).status(), 409);
		let baseline = await state();
		for (const emoji of baseline.reactions) {
			assert.equal((await write({ kind: 'reaction', emoji, active: false, expectedRevision: baseline.revision })).status(), 200);
			baseline = await state();
		}
		if (baseline.saved) assert.equal((await write({ kind: 'save', active: false, expectedRevision: baseline.revision })).status(), 200);
		await page.goto(url('/components?catalog=online'));
		await page.getByRole('button', { name: 'Mine', exact: true }).click();
		const card = page.getByRole('article', { name, exact: true });
		await card.waitFor();
		await page.waitForFunction(async () => {
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) return false;
			for (const key of await caches.keys())
				if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
					return true;
			return false;
		});
		await context.setOffline(true);
		offline = true;
		assert.equal(
			await page.evaluate(async () => {
				try {
					await fetch('/api/root-data?interactions-offline', { cache: 'no-store' });
					return false;
				} catch {
					return true;
				}
			}),
			true
		);
		await page.goto(url('/components?catalog=device'));
		await page.getByRole('button', { name: 'Mine', exact: true }).click();
		await card.getByRole('button', { name: 'Add to library', exact: true }).click();
		await card.getByRole('button', { name: 'In my library', exact: true }).waitFor();
		await card.getByRole('button', { name: 'react', exact: true }).click();
		await page.getByPlaceholder('🔍 Search, or type / paste emoji…').fill('❤️');
		await page.getByTitle('Add ❤️ as one reaction', { exact: true }).click();
		await card.getByRole('button', { name: '❤️ 1', exact: true }).waitFor();
		await page.getByRole('button', { name: 'Library', exact: true }).click();
		await page.reload();
		await card.getByRole('button', { name: 'In my library', exact: true }).waitFor();
		await card.getByRole('button', { name: '❤️ 1', exact: true }).waitFor();
		const other = await context.newPage();
		await other.goto(url('/components?catalog=device'));
		const otherCard = other.getByRole('article', { name, exact: true });
		await otherCard.getByRole('button', { name: 'In my library', exact: true }).click();
		await card.waitFor({ state: 'hidden' });
		await other.getByRole('button', { name: 'All', exact: true }).last().click();
		await otherCard.getByRole('button', { name: 'Add to library', exact: true }).click();
		await card.waitFor();
		await other.close();
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
			const measured = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
			assert.equal(measured.width, measured.scroll);
			bounds.push(measured);
			if (artifacts) await page.screenshot({ path: resolve(artifacts, `account-interactions-${width}.png`) });
		}
		assert.deepEqual(
			writes.filter((row) => row.offline),
			[]
		);
		await context.route('**/api/v1/things/interactions', async (route) => {
			if (route.request().method() === 'POST' && !dropped) {
				const response = await route.fetch();
				assert.equal(response.status(), 200);
				dropped++;
				await route.abort('failed');
				return;
			}
			await route.continue();
		});
		offline = false;
		await context.setOffline(false);
		await page.reload();
		let final: any;
		for (let attempt = 0; attempt < 45; attempt++) {
			final = await state();
			if (final.saved && final.reactions.includes('❤️')) break;
			// Respect the shared read/write rate bucket while waiting for tab claims.
			await new Promise((r) => setTimeout(r, 2000));
		}
		assert.equal(final.saved, true);
		assert.deepEqual(final.reactions, ['❤️']);
		assert.equal(dropped, 1);
		assert.equal(final.reactionCounts['❤️'], 1);
		await page.getByRole('region', { name: 'Account interaction sync', exact: true }).waitFor({ state: 'hidden' });
		// A different device changes the revision while this device removes its save.
		await page.getByRole('button', { name: 'Library', exact: true }).click();
		await context.setOffline(true);
		offline = true;
		await card.getByRole('button', { name: 'In my library', exact: true }).click();
		await card.waitFor({ state: 'hidden' });
		const elsewhere = await state();
		assert.equal((await write({ kind: 'reaction', emoji: '🙌', active: true, expectedRevision: elsewhere.revision })).status(), 200);
		offline = false;
		await context.setOffline(false);
		await page.reload();
		const reviewRegion = page.getByRole('region', { name: 'Account interaction sync', exact: true });
		// Reload can retire a tab after it claims the queued write; the durable
		// 60-second lease must expire before another tab may reconcile it.
		await reviewRegion.getByText(/Account sync needs attention/).waitFor({ timeout: 75_000 });
		await reviewRegion.getByText('Review interaction sync', { exact: true }).click();
		await reviewRegion.getByRole('button', { name: 'Review account choice', exact: true }).click();
		await reviewRegion.getByText(/This device: Not in Library/).waitFor();
		await reviewRegion.getByText(/Account: In Library/).waitFor();
		await page.evaluate(() => window.scrollTo(0, 0));
		const reviewBounds = await reviewRegion.boundingBox();
		assert.ok(reviewBounds && reviewBounds.y >= 52);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
		if (artifacts) await page.screenshot({ path: resolve(artifacts, 'account-conflict-review.png') });
		await reviewRegion.getByRole('button', { name: 'Keep device interaction choices', exact: true }).click();
		await reviewRegion.waitFor({ state: 'hidden' });
		const resolved = await state();
		assert.equal(resolved.saved, false);
		assert.deepEqual(resolved.reactions.sort(), ['❤️', '🙌'].sort());
		const exported = await context.request.post(url('/api/v1/things/export'), { headers, data: { ids: [id], includeFiles: false } });
		assert.equal(exported.status(), 200, await exported.text());
		assert.equal((await exported.text()).includes('interactionRevision'), false);
		const sent = writes.filter((row) => row.path === '/api/v1/things/interactions');
		assert.ok(sent.length);
		assert.ok(sent.every((row) => row.actor === owner && row.plane));
		assert.deepEqual(errors, []);
		if (artifacts)
			await writeFile(
				resolve(artifacts, 'verification.json'),
				JSON.stringify(
					{
						offlineCompletion: true,
						coldReload: true,
						crossTab: true,
						lostResponseReconciled: true,
						nativeConflictReview: true,
						canonicalExportExcludesSyncMetadata: true,
						conditionalRaces: true,
						legacyAndGenericRevisionFences: true,
						unauthorizedWritesRefused: true,
						final,
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
			await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), writes, errors }, null, 2));
		}
		throw error;
	} finally {
		for (const tab of context.pages()) await tab.close();
		await context.setOffline(false);
		await context.unrouteAll({ behavior: 'ignoreErrors' });
		for (const id of ids.reverse()) await context.request.delete(url(`/api/v1/things?id=${id}`), { headers });
		await context.request.post(url('/api/v1/auth/logout'), { headers });
		await guest.request.post(url('/api/v1/auth/logout'), { headers });
		await browser.close();
	}
});
