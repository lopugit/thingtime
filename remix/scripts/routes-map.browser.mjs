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
body { margin: 0; background: #f4f7f6; color: #233838; font: 16px system-ui; }
#root { max-width: 860px; margin: 24px auto; padding: 0 16px; }
h1 { font-weight: 700; }
[aria-label$="fixture map"] { position: relative; background: repeating-linear-gradient(27deg, #c8ded5, #c8ded5 40px, #ddebe6 40px, #ddebe6 42px); }
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
	browser = await chromium.launch({ chromiumSandbox: true, ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
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
	const installSdk = () => {
		window.fixtureMaps = { created: 0, removed: 0 };
		window.mapboxgl = {
			Map: class {
				constructor({ container }) { if (!(container instanceof window.HTMLElement)) throw new Error('Map host belongs to another document'); this.container = container; window.fixtureMaps.created++; }
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
				constructor({ element }) {
					if (!(element instanceof window.HTMLElement)) throw new Error('Marker belongs to another document');
					this.element = element;
					element.setAttribute('role', 'img');
					element.setAttribute('aria-label', 'SDK marker');
					element.setAttribute('tabindex', '0');
				}
				setLngLat([longitude]) { this.longitude = longitude; return this; }
				addTo(map) {
					this.element.style.position = 'absolute';
					this.element.style.transform = 'translate(-50%, -50%)';
					this.element.style.left = '8%';
					this.element.style.top = this.longitude > 144.96 ? '56%' : '8%';
					map.container.append(this.element);
					return this;
				}
				getElement() { return this.element; }
				remove() { this.element.remove(); }
			}
		};
	};

	const sdkScript = '(' + installSdk.toString() + ')();';
	await page.addInitScript(code => { if (window === window.top) window.eval(code); }, sdkScript);
	await page.route(origin + '/vendor/mapbox-gl/**/mapbox-gl.js', route => route.fulfill({ contentType: 'text/javascript', body: sdkScript }));
	await page.route(origin + '/vendor/mapbox-gl/**/mapbox-gl.css', route => route.fulfill({
		contentType: 'text/css', body: '[aria-label="Composed fixture map"] { position: relative; background: #c8ded5 }'
	}));
	await page.route(origin + '/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: {
		schemaVersion: 1, origin, features: { 'api.maps': { version: '1.2.0' }, 'api.webpages-resolve': { version: '1.10.0' }, 'api.attachment-content': { version: '1.12.0' }, 'api.actions-run': { version: '1.39.0' } }
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
				{ id: 'fixture-quay', component: 'other-component', renderComponent: 'other-component', coordinates: [144.95, -37.81], crystal: { title: 'Copper Quay', markerIcon: '★', markerLabelMode: 'both', markerLabel: 'Coffee and a river walk', markerIcons: ['✦', '☕'], markerAvatarAttachmentId: 'fixture-avatar' } },
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
		const nativeFace = fern.locator('[data-tt-map-marker-face]');
		const faceBounds = await nativeFace.boundingBox(), targetBounds = await fern.boundingBox();
		assert.ok(faceBounds.height < targetBounds.height, 'scaled native colored face shrinks while the target stays44px');
		assert.ok(Math.abs((faceBounds.y+faceBounds.height/2)-(targetBounds.y+targetBounds.height/2))<1, 'native face remains centered');
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
		await exerciseComposed(page, profile);
		assert.deepEqual(errors, []);
		console.log(profile + ' legacy and composed marker, details, search, list, draft, focus, manual refresh and navigation passed');
	} catch (error) {
		releaseSlowDetail();
		releaseSlowSuggestion();
		releaseSave();
		console.error(profile, { errors, text: (await page.locator('body').innerText()).slice(0, 700) });
		throw error;
	}
}


async function exerciseComposed(page, profile) {
	await page.getByRole('button', { name: 'Open composed marker fixture' }).click();
	const map = page.getByRole('region', { name: 'Composed fixture map' });
	const quay = map.getByRole('button', { name: 'Saved · Copper Quay' });
	const fern = map.getByRole('button', { name: 'Saved · Fern Library' });
	const quayDraft = map.getByRole('textbox', { name: 'Draft Copper Quay' });
	const fernDraft = map.getByRole('textbox', { name: 'Draft Fern Library' });
	await quay.waitFor();
	await fern.waitFor();
	assert.equal(await map.getByText('Row: Coffee and a river walk', { exact: true }).count(), 1);
	assert.equal(await page.getByText('Unexpected row-selected component', { exact: true }).count(), 0);
	const anchors = map.locator('[data-tt-map-point]');
	assert.equal(await anchors.count(), 2);
	assert.deepEqual(await anchors.evaluateAll(nodes => nodes.map(node => [node.getAttribute('role'), node.getAttribute('aria-label'), node.getAttribute('tabindex')])), [
		[null, null, null], [null, null, null]
	]);
	await quayDraft.fill('Composed fixture draft');
	assert.equal(await fernDraft.inputValue(), '');
	const detailScroll = page.getByLabel('Fixture detail scroll');
	await detailScroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
	await quay.focus();
	await quay.press('Enter');
	const quayDetail = page.getByText('Selected marker: fixture-quay', { exact: true });
	await quayDetail.waitFor();
	assert.equal(await quay.getAttribute('aria-pressed'), 'true');
	assert.equal(await quay.evaluate(node => node === document.activeElement), true);
	assert.equal(await quayDraft.inputValue(), 'Composed fixture draft');
	assert.ok(await detailScroll.evaluate(node => node.scrollTop < 40), 'new selection reveals the detail in its own scrolling region');
	await detailScroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
	const bottom = await detailScroll.evaluate(node => node.scrollTop);
	await quay.press('Enter');
	assert.equal(await detailScroll.evaluate(node => node.scrollTop), bottom, 'same selection does not move the scroll container again');
	assert.equal(await quay.evaluate(node => node === document.activeElement), true);
	await fern.click();
	await page.getByText('Selected marker: fixture-fern', { exact: true }).waitFor();
	assert.equal(await quayDraft.inputValue(), 'Composed fixture draft');
	assert.equal(await fernDraft.inputValue(), '');
	await exerciseMarkerMenu(page, map, 'Fern Library', 1, profile, true);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await page.screenshot({ path: join(screenshots, profile + '-composed.png'), fullPage: true });

	await page.getByRole('button', { name: 'Remove fixture markers' }).click();
	await anchors.first().waitFor({ state: 'detached' });
	await page.getByRole('button', { name: 'Restore fixture markers' }).click();
	await quayDraft.waitFor();
	assert.equal(await quayDraft.inputValue(), '', 'removed markers do not retain abandoned input');
	await quayDraft.fill('Draft before identity change');
	const mapCount = await page.evaluate(() => window.fixtureMaps.created);
	await page.getByRole('button', { name: 'Switch fixture database' }).click();
	await page.waitForFunction(count => window.fixtureMaps.created > count, mapCount);
	await quayDraft.waitFor();
	assert.equal(await quayDraft.inputValue(), '', 'a data-plane identity change clears protected drafts');

	await page.getByRole('button', { name: 'Edit marker composition' }).click();
	const template = page.getByLabel('Map marker template');
	await template.getByText('Authored marker note', { exact: true }).click();
	await page.getByText('Selected block: marker-note', { exact: true }).waitFor();
	await page.getByRole('textbox', { name: 'Edit selected marker note' }).fill('Updated marker note');
	await template.getByText('Updated marker note', { exact: true }).waitFor();
	await template.getByRole('button', { name: 'Saved ·' }).click();
	await page.getByText('Selected block: marker-content', { exact: true }).waitFor();
	await page.getByRole('button', { name: 'View marker composition' }).click();
	await quay.waitFor();
	assert.equal(await map.getByText('Updated marker note', { exact: true }).count(), 2);

	const topMaps = await page.evaluate(() => window.fixtureMaps.created);
	await page.getByRole('button', { name: 'Render map in viewport iframe' }).click();
	const frame = page.frameLocator('iframe[title="Responsive page preview"]');
	const framedMap = frame.getByRole('region', { name: 'Composed fixture map' });
	const framedQuay = framedMap.getByRole('button', { name: 'Saved · Copper Quay' });
	await framedQuay.waitFor();
	assert.equal(await framedMap.evaluate(node => node.ownerDocument.defaultView.fixtureMaps.created), 1);
	assert.equal(await framedMap.evaluate(node => node.ownerDocument.defaultView.innerWidth), 390);
	assert.equal(await page.evaluate(() => window.fixtureMaps.created), topMaps);
	assert.equal(await framedMap.evaluate(node => node.ownerDocument.querySelectorAll('link[data-tt-mapbox-css]').length), 1);
	assert.equal(await framedQuay.evaluate(node => node instanceof node.ownerDocument.defaultView.HTMLElement), true);
	await framedQuay.focus();
	await framedQuay.press('Enter');
	await page.getByText('Selected marker: fixture-quay', { exact: true }).waitFor();
	assert.equal(await framedQuay.evaluate(node => node === node.ownerDocument.activeElement), true);
	await exerciseMarkerMenu(page, framedMap, 'Copper Quay', 2, profile);
	await page.screenshot({ path: join(screenshots, profile + '-iframe.png'), fullPage: true });
}

async function exerciseMarkerMenu(page, map, label, pulse, profile, structural = false) {
 const trigger = map.getByRole('button', { name: 'Marker commands for ' + label, exact: true });
 await trigger.waitFor();
 assert.equal(await trigger.getAttribute('aria-haspopup'), 'menu', 'new conditional trigger receives the menu binding');
 const show = () => profile === 'mobile' ? trigger.tap() : trigger.click();
 await show();
 const popup = map.getByRole('menu', { name: 'Commands for ' + label, exact: true });
 await popup.waitFor();
 const original = await popup.elementHandle();
 const beforePulse = Number((await page.getByText(/^Marker refresh: [0-9]+;/).innerText()).match(/Marker refresh: ([0-9]+);/)[1]);
 await page.evaluate(() => window.fixtureMarkerRefresh('scope'));
 await page.getByText(new RegExp('^Marker refresh: ' + (beforePulse + 1) + ';')).waitFor();
 assert.equal(await original.evaluate(node => node.isConnected && node.matches(':popover-open')), true, 'ordinary source scope reconciliation preserves the same native popup');
 await popup.getByRole('menuitem', { name: 'Refreshed marker action', exact: true }).waitFor();
 const command = popup.getByRole('menuitem', { name: 'Use marker', exact: true });
 assert.equal(await command.evaluate(node => node === node.ownerDocument.activeElement), true, 'refresh keeps keyboard focus on the existing command');
 await page.screenshot({ path: join(screenshots, profile + '-menu-refresh-' + pulse + '.png'), fullPage: true });
 await command.click();
 await page.getByText('Marker command: ' + (label === 'Fern Library' ? 'fixture-fern' : 'fixture-quay'), { exact: true }).waitFor();
 await popup.waitFor({ state: 'hidden' });
 if (!structural) return;
 await show();
 await popup.waitFor();
 await page.evaluate(() => window.fixtureMarkerRefresh('disabled'));
 await page.getByText(/menu disabled: true;/).waitFor();
 await popup.waitFor({ state: 'hidden' });
 assert.equal(await trigger.getAttribute('aria-disabled'), 'true');
 await page.evaluate(() => window.fixtureMarkerRefresh('disabled'));
 await page.getByText(/menu disabled: false;/).waitFor();
 await show();await popup.waitFor();
 const replaced = await popup.elementHandle();
 await page.evaluate(() => window.fixtureMarkerRefresh('slot'));
 await page.getByText(/alternate slot: true$/).waitFor();
 assert.equal(await replaced.evaluate(node => node.isConnected), false, 'actual popup replacement ends the previous menu lifetime');
 await popup.waitFor({ state: 'hidden' });
 await show();await popup.waitFor();
 await popup.press('Escape');
 assert.equal(await trigger.evaluate(node => node === node.ownerDocument.activeElement), true);
}
