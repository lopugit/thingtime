/** Isolated browser regression. The SDK facade, records and API replies are synthetic.
 * Set TT_PLAYWRIGHT_MODULE to an installed Playwright module when needed.
 * Run: node remix/scripts/routes-map.browser.mjs <private screenshot directory>
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { ports } = require('./worktree-ports.cjs').resolveDevContext();
const root = fileURLToPath(new URL('../', import.meta.url));
const screenshots = resolve(process.argv[2] ?? '/tmp/thingtime-routes-browser');
const origin = 'http://127.0.0.1:' + ports.web;
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { background: #f4f7f6; color: #233838; font: 16px system-ui; }
#root { max-width: 860px; margin: 24px auto; padding: 0 16px; }
h1 { font-weight: 700; }
[aria-label="Routes fixture map"] { position: relative; background: repeating-linear-gradient(27deg, #c8ded5, #c8ded5 40px, #ddebe6 40px, #ddebe6 42px); }
fieldset { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; }
#root input, #root button:not([data-tt-map-point]) { padding: 8px 12px; border: 1px solid #547477; border-radius: 8px; background: white; min-height: 44px; }
#root button:not([data-tt-map-point]) { margin-right: 8px; }
</style>
<div id="root"></div><script type="module" src="/scripts/routes-map.browser.fixture.tsx"></script></html>`;
const server = await createServer({
	root, configFile: false, envDir: false, publicDir: false,
	resolve: { alias: { '~': join(root, 'app') } },
	server: { host: '127.0.0.1', port: ports.web, strictPort: true, hmr: false },
	plugins: [{ name: 'synthetic-routes-fixture', configureServer(vite) {
		vite.middlewares.use(async (request, response, next) => {
			if (!request.url?.startsWith('/p/fixture-routes')) return next();
			try {
				const markup = await vite.transformIndexHtml(request.url, html);
				response.setHeader('content-type', 'text/html');
				response.end(markup);
			} catch (error) { next(error); }
		});
	} }]
});

let browser;
try {
	await server.listen();
	await mkdir(screenshots, { recursive: true, mode: 0o700 });
	browser = await chromium.launch({ ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
	for (const [profile, viewport] of Object.entries({ desktop: { width: 1280, height: 840 }, mobile: { width: 390, height: 844 } })) {
		const context = await browser.newContext({ viewport, isMobile: profile === 'mobile', hasTouch: profile === 'mobile' });
		try { await exercise(context, profile); }
		finally { await context.close(); }
	}
} finally {
	await browser?.close();
	await server.close();
}

async function exercise(context, profile) {
	const page = await context.newPage();
	page.setDefaultTimeout(12000);
	const errors = [];
	const calls = new Map();
	page.on('pageerror', (error) => errors.push(error.message));
	await page.addInitScript(() => {
		window.fixtureMaps = { created: 0, removed: 0 };
		window.mapboxgl = {
			Map: class {
				constructor({ container }) { this.container = container; window.fixtureMaps.created++; }
				addControl() {}
				on(event, callback) { if (event === 'load') queueMicrotask(callback); }
				fitBounds() {}
				jumpTo() {}
				resize() {}
				getSource() {}
				remove() { window.fixtureMaps.removed++; }
			},
			NavigationControl: class {},
			LngLatBounds: class {
				extend() {}
				isEmpty() { return false; }
			},
			Marker: class {
				constructor({ element }) { this.element = element; }
				setLngLat([longitude]) { this.longitude = longitude; return this; }
				addTo(map) {
					this.element.style.position = 'absolute';
					this.element.style.left = '12%';
					this.element.style.top = this.longitude > 144.96 ? '54%' : '24%';
					map.container.append(this.element);
					return this;
				}
				getElement() { return this.element; }
				remove() { this.element.remove(); }
			}
		};
	});
	await page.route(origin + '/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: {
		schemaVersion: 1, origin, features: { 'api.maps': { version: '1.0.0' }, 'api.attachment-content': { version: '1.12.0' }, 'api.actions-run': { version: '1.37.0' } }
	} }));
	await page.route(origin + '/api/v1/maps', route => {
		assert.equal(route.request().postDataJSON().operation, 'browser-config');
		return route.fulfill({ json: { ok: true, publicToken: 'pk.fixture' } });
	});
	await page.route(origin + '/api/v1/attachments/content?*', route => {
		assert.equal(new URL(route.request().url()).searchParams.get('id'), 'fixture-avatar');
		return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4f64BAAUdAk6Fw5rJAAAAAElFTkSuQmCC', 'base64') });
	});
	let rank = 1;
	let releaseSlowDetail, releaseSlowSuggestion, releaseSave;
	const slowSuggestionGate = new Promise(resolve => { releaseSlowSuggestion = resolve; });
	const saveGate = new Promise(resolve => { releaseSave = resolve; });
	const slowDetailGate = new Promise(resolveSlowDetail => { releaseSlowDetail = resolveSlowDetail; });
	await page.route(origin + '/api/v1/actions/run', async route => {
		const { action, inputs, sharedRoot } = route.request().postDataJSON();
		assert.equal(sharedRoot, 'fixture-routes');
		calls.set(action, (calls.get(action) || 0) + 1);
		let result;
		if (action === 'fixture-favourites') {
			result = { items: [
				{ id: 'fixture-quay', coordinates: [144.95, -37.81], crystal: { title: 'Copper Quay', markerIcon: '★', markerLabelMode: 'both', markerLabel: 'Coffee and a river walk', markerIcons: ['✦', '☕'], markerAvatarAttachmentId: 'fixture-avatar' } },
				{ id: 'fixture-fern', coordinates: [144.97, -37.82], crystal: { title: 'Fern Library', markerLabelMode: 'title' } }
			] };
		} else if (action === 'fixture-search') {
			result = { text: inputs.q ? 'Search result for ' + inputs.q : 'All saved places' };
		} else if (action === 'fixture-rank') {
			result = { rank: inputs.group === 'second' ? 8 : rank };
		} else if (action === 'fixture-suggest') {
			if (inputs.query === 'Slow Quay') await slowSuggestionGate;
			result = { suggestions: [{ id: 'suggestion', address: inputs.query + ' suggestion' }] };
		} else if (action === 'fixture-save') {
			await saveGate;
			rank = 2;
			return route.fulfill({ json: { ok: true, status: 'error', error: 'Synthetic save failed' } });
		} else if (action === 'fixture-detail') {
			assert.ok(['fixture-quay', 'fixture-fern'].includes(inputs.id));
			if (inputs.id === 'fixture-quay' && calls.get(action) === 1) await slowDetailGate;
			result = { text: inputs.id === 'fixture-quay' ? 'Copper Quay · 8 Copper Lane' : 'Fern Library · 14 Fern Street' };
		} else assert.fail('Unexpected synthetic Action: ' + action);
		await route.fulfill({ json: { ok: true, status: 'ok', cache: 'no-store', result } });
	});

	const url = origin + '/p/fixture-routes?q=initial';
	const navigations = [];
	page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
	await page.goto(url);
	try {
		await page.getByText('Search result for initial').waitFor();
		const initialNavigations = [...navigations];
		const map = page.getByRole('region', { name: 'Routes fixture map' });
		const quay = map.getByRole('button', { name: /Copper Quay/ });
		const fern = map.getByRole('button', { name: 'Fern Library' });
		await quay.waitFor();
		await page.waitForFunction(() => {
			const avatar = document.querySelector('[data-tt-map-point] img');
			return avatar instanceof HTMLImageElement && avatar.complete && avatar.naturalWidth > 0;
		});
		assert.match(await quay.innerText(), /★\s+Copper Quay · Coffee and a river walk/);
		assert.equal(await quay.getAttribute('title'), 'Copper Quay');
		const captionFits = await quay.getByText('Copper Quay · Coffee and a river walk').evaluate(node => {
			const range = document.createRange();
			range.selectNodeContents(node);
			const clip = node.closest('button').getBoundingClientRect();
			return [...range.getClientRects()].every(line => line.left >= clip.left && line.right <= clip.right && line.bottom <= clip.bottom);
		});
		assert.equal(captionFits, true, 'the full custom caption fits inside its marker');
		assert.match(await quay.innerText(), /✦ ☕/);
		assert.equal(await quay.getByText('★', { exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth), true);

		const bounds = await quay.boundingBox();
		assert.ok(bounds.width >= 44 && bounds.height >= 44);
		const draft = page.getByRole('textbox', { name: 'Nested draft' });
		await draft.fill('Fixture draft');
		const search = page.getByRole('searchbox', { name: 'Search saved places' });
		await search.fill('fern');
		await search.press('Enter');
		await page.getByText('Search result for fern').waitFor();
		assert.equal(await search.inputValue(), 'fern');
		assert.equal(await search.evaluate(node => node === document.activeElement), true);

		const request = page.waitForRequest(req => req.url().endsWith('/actions/run') && req.postDataJSON().inputs?.id === 'fixture-quay');
		await quay.focus();
		await quay.press('Enter');
		await request;
		await map.getByRole('button', { name: /Copper Quay/, pressed: true }).waitFor();
		assert.equal(await quay.evaluate(node => node === document.activeElement), true);
		await fern.click();
		await page.getByText('Fern Library · 14 Fern Street').waitFor();
		const slow = page.waitForResponse(res => res.url().endsWith('/actions/run') && res.request().postDataJSON().inputs?.id === 'fixture-quay');
		releaseSlowDetail();
		await (await slow).finished();
		await page.evaluate(() => new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
		assert.equal(await page.getByText('Copper Quay · 8 Copper Lane').count(), 0);
		await page.getByText('Fern Library · 14 Fern Street').waitFor();

		await quay.click();
		await page.getByText('Copper Quay · 8 Copper Lane').waitFor();
		await page.getByRole('button', { name: 'Show Fern Library from list' }).click();
		await page.getByText('Fern Library · 14 Fern Street').waitFor();
		await page.getByText('Search result for fern').waitFor();
		const address = page.getByRole('searchbox', { name: 'Suggest addresses' });
		await address.fill('First');
		await page.getByRole('button', { name: 'First suggestion', exact: true }).click();
		await page.getByText('Selected ID: suggestion', { exact: true }).waitFor();
		await page.getByText('Selected address: First suggestion', { exact: true }).waitFor();
		const slowSuggestion = page.waitForRequest(req => req.url().endsWith('/actions/run') && req.postDataJSON().inputs?.query === 'Slow Quay');
		await address.fill('Slow Quay');
		assert.equal(await page.getByText('First suggestion', { exact: true }).count(), 0);
		await slowSuggestion;
		assert.equal(await page.getByText('Selected ID: suggestion', { exact: true }).count(), 0);
		assert.equal(await page.getByText('Selected address: First suggestion', { exact: true }).count(), 0);
		await address.fill('New Fern');
		await page.getByText('New Fern suggestion', { exact: true }).waitFor();
		const delayedSuggestion = page.waitForResponse(res => res.url().endsWith('/actions/run') && res.request().postDataJSON().inputs?.query === 'Slow Quay');
		releaseSlowSuggestion();
		await (await delayedSuggestion).finished();
		await page.evaluate(() => new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
		assert.equal(await page.getByText('Slow Quay suggestion', { exact: true }).count(), 0);
		await page.getByText('New Fern suggestion', { exact: true }).waitFor();
		assert.equal(await address.evaluate(node => node === document.activeElement), true);

		assert.equal(await search.inputValue(), 'fern');
		assert.equal(await draft.inputValue(), 'Fixture draft');
		assert.equal(await fern.getAttribute('aria-pressed'), 'true');
		assert.deepEqual(await page.evaluate(() => window.fixtureMaps), { created: 1, removed: 0 });
		assert.equal(calls.get('fixture-favourites'), 1);
		assert.deepEqual(navigations, initialNavigations);
		assert.equal(page.url(), url);
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await page.screenshot({ path: join(screenshots, profile + '.png'), fullPage: true });
		await page.getByText('Manual source fixture', { exact: true }).click();
		await page.getByText('Rank for first: 1', { exact: true }).waitFor();
		const automaticCalls = calls.get('fixture-search');
		const refreshedSearch = page.waitForResponse(res => res.url().endsWith('/actions/run') && res.request().postDataJSON().action === 'fixture-search');
		const saveRequest = page.waitForRequest(req => req.url().endsWith('/actions/run') && req.postDataJSON().action === 'fixture-save');
		const save = page.getByRole('button', { name: 'Report synthetic save failure' });
		await save.click();
		await saveRequest;
		await page.getByRole('button', { name: 'Select Quay during save' }).click();
		await page.getByText('Copper Quay · 8 Copper Lane').waitFor();
		await save.press('Enter');
		releaseSave();
		await page.getByText('Synthetic save failed', { exact: true }).first().waitFor();
		await (await refreshedSearch).finished();
		assert.equal(calls.get('fixture-search'), automaticCalls + 1);
		assert.equal(calls.get('fixture-save'), 1, 'in-flight writes remain single-flight');
		assert.equal(calls.get('fixture-rank'), 1, 'an Action report leaves manual source data pinned');
		await page.getByText('Rank for first: 1', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await page.getByRole('button', { name: 'Refetch fixture rank' }).click();
		await page.getByText('Rank for first: 2', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Change fixture group' }).click();
		await page.getByText('Rank for second: 8', { exact: true }).waitFor();
		assert.equal(calls.get('fixture-rank'), 3);
		const pageRefresh = page.waitForResponse(res => res.url().endsWith('/actions/run') && res.request().postDataJSON().action === 'fixture-rank');
		await page.getByRole('button', { name: 'Refresh fixture page sources' }).click();
		await (await pageRefresh).finished();
		assert.equal(calls.get('fixture-rank'), 4);

		await page.getByRole('button', { name: 'Switch fixture database' }).click();
		await page.waitForFunction(() => window.fixtureMaps.created === 2);
		assert.equal(await search.inputValue(), '');
		assert.equal(await draft.inputValue(), '');
		assert.equal(await page.getByText('Fern Library · 14 Fern Street').count(), 0);
		assert.equal(page.url(), url);
		assert.deepEqual(await page.evaluate(() => window.fixtureMaps), { created: 2, removed: 1 });
		await page.getByRole('button', { name: 'Open a deep link' }).click();
		await page.waitForURL('**?favouriteId=fixture-fern');
		assert.deepEqual(errors, []);
		console.log(profile + ' marker, details, search, list, draft, focus, manual refresh and navigation passed');
	} catch (error) {
		releaseSlowDetail();
		releaseSlowSuggestion();
		releaseSave();
		console.error(profile, { errors, text: (await page.locator('body').innerText()).slice(0, 700) });
		throw error;
	}
}
