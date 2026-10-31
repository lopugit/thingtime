import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const fixtureUrl = 'http://127.0.0.1:12280/__boot-fixture?key=fixture-read-key&view=shared#card';

const openFixture = async (browser, { width = 390, failures = 1, denied = false } = {}) => {
	const context = await browser.newContext({ viewport: { width, height: 844 } });
	if (denied) await context.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }));
	const tab = await context.newPage();
	const boot = await readFile(new URL('../public/tt-boot.js', import.meta.url), 'utf8');
	let navigations = 0;
	let dependencies = 0;
	await tab.route('http://127.0.0.1:12280/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/__boot-fixture') {
			navigations++;
			return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" }, body: '<!doctype html><html><head><script src="/tt-boot.js"></script></head><body style="margin:0"><div id="root"></div><script type="module" src="/__boot-entry.js"></script></body></html>' });
		}
		if (path === '/tt-boot.js') return route.fulfill({ contentType: 'text/javascript', body: boot });
		if (path === '/__boot-entry.js') return route.fulfill({ contentType: 'text/javascript', body: 'import "/__boot-dependency.js"; document.getElementById("root").textContent = "App ready";' });
		if (path === '/__boot-dependency.js') {
			dependencies++;
			if (dependencies <= failures) return route.abort('failed');
			return route.fulfill({ contentType: 'text/javascript', body: 'export const ready = true;' });
		}
		return route.fulfill({ status: 404, body: '' });
	});
	await tab.goto(fixtureUrl, { waitUntil: 'commit' });
	return { context, tab, navigations: () => navigations, dependencies: () => dependencies };
};

// A synthetic document exercises the browser's real static-module failure
// event before entry.client can install its own listeners. No accounts/API
// writes or user-browser storage are involved.
test('early boot recovers a failed entry dependency once without a blank page', { skip: !playwrightPath, timeout: 120000 }, async () => {
	const { chromium } = await import(playwrightPath);
	const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
	try {
		for (const width of [1440, 390]) {
			const fixture = await openFixture(browser, { width });
			await fixture.tab.getByText('App ready', { exact: true }).waitFor({ timeout: 8000 });
			assert.equal(fixture.navigations(), 2, 'Exactly one automatic recovery navigation');
			assert.equal(fixture.dependencies(), 2);
			assert.equal(fixture.tab.url(), fixtureUrl, 'Recovery preserves the sharing query and fragment');
			await fixture.context.close();
		}
	} finally {
		await browser.close();
	}
});

test('persistent module failures have an accessible manual retry, including storage-denied sessions', { skip: !playwrightPath, timeout: 120000 }, async () => {
	const { chromium } = await import(playwrightPath);
	const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
	try {
		for (const [width, denied] of [[1440, false], [390, false], [390, true]]) {
			const fixture = await openFixture(browser, { width, denied, failures: Infinity });
			await fixture.tab.getByRole('heading', { name: 'Thingtime could not start' }).waitFor({ timeout: 8000 });
			const expected = denied ? 1 : 2;
			assert.equal(fixture.navigations(), expected);
			assert.equal(fixture.dependencies(), expected);
			assert.ok(await fixture.tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			const retry = fixture.tab.getByRole('button', { name: 'Try again' });
			const bounds = await retry.boundingBox();
			assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844);
			if (process.env.TT_SHARED_SCREENSHOT_DIR) {
				await fixture.tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/boot-recovery-${width}-${denied}-top.png` });
				await fixture.tab.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
				await fixture.tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/boot-recovery-${width}-${denied}-bottom.png` });
			}
			await Promise.all([fixture.tab.waitForEvent('load'), retry.click()]);
			await fixture.tab.getByRole('heading', { name: 'Thingtime could not start' }).waitFor();
			assert.equal(fixture.navigations(), expected + 1, 'Manual retry does not unlock another automatic reload');
			assert.equal(fixture.tab.url(), fixtureUrl);
			await fixture.context.close();
		}
	} finally {
		await browser.close();
	}
});
