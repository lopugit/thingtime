// Synthetic presentation acceptance only. Both browser and fixture server are network-none.
const fs = require('node:fs/promises'),
	http = require('node:http'),
	os = require('node:os'),
	assert = require('node:assert/strict');
const puppeteer = require('/opt/thingtime-browser/node_modules/puppeteer-core');
const root = '/home/pwuser/select-qa',
	results = root + '/results';
const report = { checks: [], states: [], errors: [] };
const owner = { id: 'owner', displayName: 'Synthetic owner', username: 'synthetic' };
const characters = ['character', 'long'].map((id, i) => ({
	disabled: false,
	user: {
		id,
		username: id,
		displayName: i
			? 'A very long Character display name with enough words to exceed the available mobile width without growing the page'
			: 'Synthetic task Character'
	}
}));
let browser, server;
(async () => {
	try {
		await fs.mkdir(results, { recursive: true });
		assert.equal(
			Object.values(os.networkInterfaces())
				.flat()
				.filter((x) => !x.internal).length,
			0
		);
		assert.equal((await fs.readFile('/proc/net/route', 'utf8')).trim().split('\n').length, 1);
		await assert.rejects(fetch('http://1.1.1.1', { signal: AbortSignal.timeout(1500) }));
		server = http.createServer(async (req, res) => {
			try {
				const url = new URL(req.url, 'http://127.0.0.1:17643');
				if (url.pathname === '/redirect-test') {
					res.writeHead(302, { location: 'http://1.1.1.1' });
					return res.end();
				}
				if (url.pathname.includes('well-known')) {
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify({ schemaVersion: 1, origin: url.origin, features: { 'api.auth-characters': { version: '1.0.0' } } }));
				}
				if (url.pathname === '/api/v1/auth/characters') {
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify({ ok: true, principal: owner, characters, nextCursor: null }));
				}
				const file = root + '/dist' + (url.pathname === '/' ? '/scripts/select-theme.browser.html' : url.pathname);
				res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
				res.end(await fs.readFile(file));
			} catch {
				res.writeHead(404);
				res.end();
			}
		});
		await new Promise((resolve) => server.listen(17643, '127.0.0.1', resolve));
		const descriptor = JSON.parse(await fs.readFile('/opt/thingtime-browser/browser.json', 'utf8'));
		browser = await puppeteer.launch({
			executablePath: descriptor.executable,
			headless: true,
			pipe: true,
			userDataDir: root + '/profile',
			args: ['--no-proxy-server', '--disable-background-networking']
		});
		assert.ok(!browser.process().spawnargs.includes('--no-sandbox'));
		const page = await browser.newPage();
		page.on('pageerror', (error) => report.errors.push(error.message));
		await assert.rejects(page.goto('http://127.0.0.1:17643/redirect-test', { timeout: 3000 }));
		report.checks.push('backend direct IP and browser redirect blocked; native Chromium sandbox enabled');
		await page.tracing.start({ path: results + '/trace.json', screenshots: false });
		for (const width of [1440, 390])
			for (const mode of ['light', 'dark']) {
				await page.setViewport({ width, height: 900 });
				await page.goto('http://127.0.0.1:17643/?mode=' + mode);
				await page.waitForFunction(() => document.querySelector('select[aria-label="Post as"]')?.options.length === 3);
				const select = 'select[aria-label="Post as"]';
				const metrics = await page.$eval(select, (e) => {
					const s = getComputedStyle(e);
					return { radius: s.borderRadius, bg: s.backgroundColor, color: s.color, border: s.borderColor, height: e.getBoundingClientRect().height };
				});
				assert.equal(metrics.radius, '7px');
				assert.equal(metrics.border, mode === 'dark' ? 'rgb(52, 52, 58)' : 'rgb(236, 236, 239)');
				for (const [size, radius] of [
					['xs', '7px'],
					['sm', '9px'],
					['md', '9px'],
					['lg', '12px']
				]) {
					assert.equal(await page.$eval('#size-' + size, (e) => getComputedStyle(e).borderRadius), radius);
				}
				await page.evaluate(() => {
					document.documentElement.style.setProperty('--tt-radius-xs', '13px');
					document.documentElement.style.setProperty('--tt-radius-sm', '17px');
					document.documentElement.style.setProperty('--tt-border-w', '2px');
				});
				assert.equal(await page.$eval(select, (e) => getComputedStyle(e).borderRadius), '13px');
				assert.equal(await page.$eval(select, (e) => getComputedStyle(e).borderTopWidth), '2px');
				for (const size of ['sm', 'md']) assert.equal(await page.$eval('#size-' + size, (e) => getComputedStyle(e).borderRadius), '17px');
				await page.evaluate(() => {
					document.documentElement.style.removeProperty('--tt-radius-xs');
					document.documentElement.style.removeProperty('--tt-radius-sm');
					document.documentElement.style.removeProperty('--tt-border-w');
				});
				assert.equal(await page.$eval('#invalid', (e) => getComputedStyle(e).borderColor), 'rgb(214, 69, 90)');
				assert.equal(metrics.bg, mode === 'dark' ? 'rgb(22, 22, 26)' : 'rgb(255, 255, 255)');
				assert.equal(metrics.color, mode === 'dark' ? 'rgb(250, 250, 250)' : 'rgb(22, 22, 26)');
				await page.keyboard.press('Tab');
				const focus = await page.$eval(select, (e) => ({ active: document.activeElement === e, outline: getComputedStyle(e).outlineWidth }));
				assert.ok(focus.active);
				assert.equal(focus.outline, '2px');
				await page.screenshot({ path: results + '/' + width + '-' + mode + '-focus.png', fullPage: true });
				await page.keyboard.press('ArrowDown');
				await page.keyboard.press('Enter');
				await page.waitForFunction(() => document.querySelector('[data-testid="selected"]').textContent.includes('character'));
				await page.select(select, 'long');
				await page.waitForFunction(() => document.querySelector('[data-testid="selected"]').textContent.includes('long'));
				assert.ok(await page.$eval('#disabled', (e) => e.disabled));
				assert.equal(await page.$eval('#disabled', (e) => getComputedStyle(e).opacity), '0.4');
				assert.equal(await page.$eval('#unstyled', (e) => getComputedStyle(e).borderTopWidth), '0px');
				const total = await page.evaluate(() => document.documentElement.scrollHeight);
				for (let y = 0; y < total; y += 500) {
					await page.evaluate((y) => scrollTo(0, y), y);
					assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
				}
				await page.evaluate(() => document.querySelector('#bottom').scrollIntoView());
				await page.screenshot({ path: results + '/' + width + '-' + mode + '-long.png', fullPage: true });
				await page.evaluate(() => scrollTo(0, 0));
				await page.click(select);
				await page.screenshot({ path: results + '/' + width + '-' + mode + '-open.png' });
				await page.keyboard.press('Escape');
				const filled = await page.$eval('#filled', (e) => ({ color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
				const baselineFilled = await page.$eval('#upstream-filled', (e) => ({
					color: getComputedStyle(e).color,
					bg: getComputedStyle(e).backgroundColor
				}));
				assert.deepEqual(filled, baselineFilled, 'explicit filled variant must preserve upstream inherited color and surface');
				report.states.push({ width, mode, metrics, focus, filled, baselineFilled });
			}
		await page.tracing.stop();
		assert.deepEqual(report.errors, []);
		report.checks.push(
			'real PostAsSelect roster callback; xs/sm/md/lg; explicit variants; keyboard focus and selection; disabled; long values; full desktop/mobile scroll; native popup; runtime radius and border customization; invalid border'
		);
		report.ok = true;
	} catch (error) {
		report.ok = false;
		report.errors.push(error.stack);
		process.exitCode = 1;
	} finally {
		await fs.writeFile(results + '/report.json', JSON.stringify(report, null, 2));
		console.log(JSON.stringify(report));
		await browser?.close();
		if (server) await new Promise((resolve) => server.close(resolve));
	}
})();
