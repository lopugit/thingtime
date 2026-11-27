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
let savedTheme = null;
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
					return res.end(
						JSON.stringify({
							schemaVersion: 1,
							origin: url.origin,
							features: {
								'api.auth-characters': { version: '1.0.0' },
								'api.themes': { version: '1.2.0' },
								'api.mongodb-endpoint': { version: '1.1.0' }
							}
						})
					);
				}
				if (url.pathname === '/api/v1/auth/characters') {
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify({ ok: true, principal: owner, characters, nextCursor: null }));
				}
				if (url.pathname === '/api/v1/themes' && req.method === 'POST') {
					const chunks = [];
					for await (const chunk of req) chunks.push(chunk);
					const body = JSON.parse(Buffer.concat(chunks).toString());
					savedTheme = { ...body, id: 'synthetic-saved-theme' };
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify({ ok: true, theme: savedTheme }));
				}
				if (url.pathname === '/fixture/saved') {
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify(savedTheme));
				}
				if (url.pathname.startsWith('/api/')) {
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify({ ok: true, themes: savedTheme ? [savedTheme] : [], things: [], notifications: [] }));
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
				assert.equal(metrics.border, mode === 'dark' ? 'rgb(42, 42, 51)' : 'rgb(236, 236, 239)');
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
				assert.equal(metrics.bg, mode === 'dark' ? 'rgb(19, 19, 24)' : 'rgb(255, 255, 255)');
				assert.equal(metrics.color, mode === 'dark' ? 'rgb(242, 242, 247)' : 'rgb(22, 22, 26)');
				await page.keyboard.press('Tab');
				await page.waitForFunction(
					(selector, color) => getComputedStyle(document.querySelector(selector)).borderColor === color,
					{},
					select,
					'rgb(214, 51, 132)'
				);
				await page.waitForFunction((selector) => !getComputedStyle(document.querySelector(selector)).boxShadow.includes('oklab'), {}, select);
				const focus = await page.$eval(select, (e) => ({
					active: document.activeElement === e,
					outline: getComputedStyle(e).outlineWidth,
					outlineStyle: getComputedStyle(e).outlineStyle,
					shadow: getComputedStyle(e).boxShadow,
					border: getComputedStyle(e).borderColor,
					borderWidth: getComputedStyle(e).borderTopWidth
				}));
				assert.ok(focus.active);
				assert.equal(focus.outline, '0px');
				assert.equal(focus.outlineStyle, 'none');
				assert.ok(focus.shadow.includes('14px') && focus.shadow.includes('0.24'), 'default soft two-color focus glow');
				assert.equal(focus.border, 'rgb(214, 51, 132)');
				assert.notEqual(focus.border, metrics.border);
				assert.equal(focus.borderWidth, '1px');
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
				await page.$eval(select, (e) => e.blur());
				await page.click(select);
				await page.screenshot({ path: results + '/' + width + '-' + mode + '-open.png' });
				await page.keyboard.press('Escape');
				await page.waitForFunction(
					(selector, color) => getComputedStyle(document.querySelector(selector)).borderColor === color,
					{},
					select,
					focus.border
				);
				await page.waitForFunction(
					(selector, shadow) => getComputedStyle(document.querySelector(selector)).boxShadow === shadow,
					{},
					select,
					focus.shadow
				);
				const pointerFocus = await page.$eval(select, (e) => ({
					outline: getComputedStyle(e).outlineWidth,
					shadow: getComputedStyle(e).boxShadow,
					border: getComputedStyle(e).borderColor
				}));
				assert.equal(pointerFocus.outline, '0px');
				assert.equal(pointerFocus.shadow, focus.shadow);
				assert.equal(pointerFocus.border, focus.border);
				await page.screenshot({ path: results + '/' + width + '-' + mode + '-pointer.png' });
				const filled = await page.$eval('#filled', (e) => ({ color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
				const baselineFilled = await page.$eval('#upstream-filled', (e) => ({
					color: getComputedStyle(e).color,
					bg: getComputedStyle(e).backgroundColor
				}));
				assert.deepEqual(filled, baselineFilled, 'explicit filled variant must preserve upstream inherited color and surface');
				report.states.push({ width, mode, metrics, focus, pointerFocus, filled, baselineFilled });
			}
		const snapshot = () => page.$eval('[data-testid="theme-snapshot"]', (e) => JSON.parse(e.textContent));
		const editColor = async (label, value) => {
			const h = await page.$('input[aria-label="' + label + ' text"]');
			const input = h;
			assert.ok(input, 'real ThemeStudio color control ' + label);
			await input.click();
			await input.evaluate((e) => e.select());
			await input.press('Backspace');
			await input.type(value);
			await input.press('Tab');
			await h.dispose();
		};
		const step = async (label, direction) => {
			const h = await page.evaluateHandle(
				({ label, direction }) => {
					const labelElement = [...document.querySelectorAll('p')].find((e) => e.textContent === label);
					let row = labelElement;
					while (row && ![...row.querySelectorAll('button')].some((e) => e.textContent.trim() === '＋')) row = row.parentElement;
					return [...(row?.querySelectorAll('button') || [])].find((e) => e.textContent.trim() === direction);
				},
				{ label, direction }
			);
			const button = h.asElement();
			assert.ok(button, 'real ThemeStudio step control ' + label);
			await button.click();
			await h.dispose();
		};
		report.editorStates = [];
		for (const width of [1440, 390])
			for (const mode of ['light', 'dark']) {
				await page.setViewport({ width, height: 900 });
				await page.evaluate(() => localStorage.removeItem('qa-theme-settings'));
				await page.goto('http://127.0.0.1:17643/?surface=editor&mode=' + mode);
				await page.waitForFunction(() => [...document.querySelectorAll('p')].some((e) => e.textContent === 'Focus border'));
				await editColor('Focus border', '#0066cc');
				await editColor('Focus glow start', '#00ff88');
				await editColor('Focus glow end', '#8844ff');
				const softness = await page.$('input[aria-label="Focus glow softness"]');
				assert.ok(softness);
				await softness.click();
				await page.keyboard.down('Control');
				await page.keyboard.press('A');
				await page.keyboard.up('Control');
				await softness.type('15');
				await softness.press('Tab');
				await step('Focus glow strength', '＋');
				await page.waitForFunction(
					() => JSON.parse(document.querySelector('[data-testid="theme-snapshot"]').textContent).general.focusGlowOpacity === 0.26
				);
				const custom = await snapshot();
				assert.equal(custom.colors.focusBorder, '#0066cc');
				assert.equal(custom.colors.focusGlowStart, '#00ff88');
				assert.equal(custom.colors.focusGlowEnd, '#8844ff');
				assert.equal(custom.general.focusGlowBlur, 15);
				await page.evaluate(() => scrollTo(0, 0));
				await page.focus('select[aria-label="Post as"]');
				await page.waitForFunction(() => getComputedStyle(document.querySelector('select[aria-label="Post as"]')).borderColor === 'rgb(0, 102, 204)');
				const customFocus = await page.$eval('select[aria-label="Post as"]', (e) => ({
					border: getComputedStyle(e).borderColor,
					shadow: getComputedStyle(e).boxShadow,
					outline: getComputedStyle(e).outlineWidth
				}));
				assert.equal(customFocus.outline, '0px');
				assert.ok(customFocus.shadow.includes('15px') && customFocus.shadow.includes('0.26'));
				await page.screenshot({ path: results + '/' + width + '-' + mode + '-custom-focus.png' });
				const save = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Save theme 💾'));
				assert.ok(save.asElement());
				await save.asElement().click();
				await save.dispose();
				await page.waitForFunction(async () => {
					const value = await (await fetch('/fixture/saved')).json();
					return value?.theme?.colors?.focusBorder === '#0066cc' && value.theme.general.focusGlowOpacity === 0.26;
				});
				const saved = await page.evaluate(async () => await (await fetch('/fixture/saved')).json());
				assert.equal(saved.theme.colors.focusGlowStart, '#00ff88');
				assert.equal(saved.theme.colors.focusGlowEnd, '#8844ff');
				assert.equal(saved.theme.general.focusGlowBlur, 15);
				for (let i = 0; i < 13; i++) await step('Focus glow strength', '−');
				await page.waitForFunction(
					() => JSON.parse(document.querySelector('[data-testid="theme-snapshot"]').textContent).general.focusGlowOpacity === 0
				);
				await page.reload();
				await page.waitForSelector('select[aria-label="Post as"]');
				assert.equal((await snapshot()).general.focusGlowOpacity, 0);
				await page.focus('select[aria-label="Post as"]');
				await page.waitForFunction(() => getComputedStyle(document.querySelector('select[aria-label="Post as"]')).boxShadow.includes('0)'));
				await page.waitForFunction(() => getComputedStyle(document.querySelector('select[aria-label="Post as"]')).borderColor === 'rgb(0, 102, 204)');
				const off = await page.$eval('select[aria-label="Post as"]', (e) => ({
					border: getComputedStyle(e).borderColor,
					shadow: getComputedStyle(e).boxShadow
				}));
				assert.ok(off.shadow.includes('0)'), 'zero strength must remove visible shadow alpha');
				assert.equal(off.border, 'rgb(0, 102, 204)');
				const total = await page.evaluate(() => document.documentElement.scrollHeight);
				for (let y = 0; y < total; y += 600) {
					await page.evaluate((y) => scrollTo(0, y), y);
					assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'ThemeStudio horizontal overflow');
				}
				await page.screenshot({ path: results + '/' + width + '-' + mode + '-editor-bottom.png' });
				report.editorStates.push({
					width,
					mode,
					customFocus,
					off,
					savedFocus: {
						border: saved.theme.colors.focusBorder,
						start: saved.theme.colors.focusGlowStart,
						end: saved.theme.colors.focusGlowEnd,
						blur: saved.theme.general.focusGlowBlur,
						strength: saved.theme.general.focusGlowOpacity
					}
				});
			}
		report.checks.push(
			'real ThemeStudio colors and step controls update live tokens; canonical presets; synthetic API save captures fields; isolated fixture persistence survives reload; strength zero removes visible glow; full editor scroll'
		);

		await page.tracing.stop();
		assert.deepEqual(report.errors, []);
		report.checks.push(
			'real PostAsSelect roster callback; xs/sm/md/lg; explicit variants; keyboard and pointer focus use themed pink border and soft gradient glow without outer outline; selection; disabled; long values; full desktop/mobile scroll; native popup; runtime radius and border customization; invalid border'
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
