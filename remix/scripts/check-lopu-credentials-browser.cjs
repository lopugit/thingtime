// Runs inside the task-owned, network-none Chromium container only.
const fs = require('node:fs/promises'),
	http = require('node:http'),
	os = require('node:os'),
	assert = require('node:assert/strict');
const puppeteer = require('/opt/thingtime-browser/node_modules/puppeteer-core');
const root = '/home/pwuser/credential-qa',
	results = root + '/results';
const owner = 'synthetic-credential-owner';
const fixturePages = new Map();
const fixtureChats = [
	{
		id: 'saved-chat',
		name: 'Saved credits chat',
		updatedAt: new Date().toISOString(),
		lopu: { model: 'credit-one', providerId: null, effort: 'high', speed: 'normal' }
	}
];
const models = ['one', 'two'].map((id, i) => ({
	id: 'credit-' + id,
	label: 'Credit model ' + id,
	provider: 'openai',
	family: 'test',
	enabled: true,
	available: true,
	isDefault: i === 0,
	efforts: i ? ['high'] : ['low', 'high'],
	speeds: i ? ['normal'] : ['normal', 'fast']
}));
const plan = {
	id: 'chatgpt-plan-test',
	name: 'Personal ChatGPT',
	kind: 'compatible',
	model: 'plan-model',
	endpointHost: 'chatgpt.com',
	available: true,
	reason: null,
	realtimeModels: []
};
const api = async (req, res, url) => {
	const path = url.pathname;
	let body = {};
	const chunks = [];
	for await (const c of req) chunks.push(c);
	const raw = Buffer.concat(chunks).toString();
	if (raw) body = JSON.parse(raw);
	const send = (data, status = 200) => {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	};
	if (path.includes('well-known'))
		return send({
			schemaVersion: 1,
			origin: 'http://127.0.0.1:17643',
			features: Object.fromEntries(
				Object.entries({
					'api.webpages-resolve': '1.6.0',
					'api.actions-run': '1.7.0',
					'api.mongodb-endpoint': '1.1.0',
					'api.things': '1.35.0',
					'api.lopu-chats': '1.7.0',
					'api.lopu-chats-update': '1.6.1',
					'api.lopu-chats-reply': '1.19.2',
					'api.lopu-background-tasks': '1.3.0'
				}).map(([k, version]) => [k, { version }])
			)
		});
	if (path.endsWith('/ai/models'))
		return send({
			ok: true,
			models,
			defaults: { model: 'credit-one', effort: 'high', speed: 'normal' },
			providers: { openai: { configured: true } },
			vaultProviders: [
				plan,
				{ ...plan, id: 'chatgpt-plan-second', name: 'Second ChatGPT account' },
				{ ...plan, id: 'offline', name: 'Unavailable credential', available: false, reason: 'Reconnect account' }
			],
			vault: { configured: true }
		});
	if (path.endsWith('/lopu/account')) return send({ ok: true, account: { verified: true, requireVerification: true, balanceMicros: 100000000 } });
	if (path.endsWith('/webpages/resolve')) {
		const page = fixturePages.get(url.searchParams.get('id'));
		return page ? send({ ok: true, source: 'user', page }) : send({ ok: false }, 404);
	}
	if (path.endsWith('/things') && ['POST', 'PATCH'].includes(req.method)) {
		const page = { id: body.id || body.shareId, crystal: body.crystal, author: { id: owner }, updatedAt: new Date().toISOString(), acl: ['tt:user'] };
		fixturePages.set(body.crystal.pageKey, page);
		return send({ ok: true, thing: page });
	}
	if (path.endsWith('/lopu/chats/update')) {
		const row = fixtureChats.find((c) => c.id === body.chatId);
		if (!row) return send({ ok: false }, 404);
		Object.assign(row.lopu, body);
		return send({ ok: true, chat: row });
	}
	if (path.endsWith('/lopu/chats')) return send({ ok: true, chats: fixtureChats });
	return send({ ok: true, ownerId: owner, chats: [], messages: [], tasks: [], things: [] });
};
let browser, server;
const report = {
	outcome: 'running',
	checks: [],
	errors: [],
	scope: 'Real credential blocks, store and Builder; synthetic accounts and HTTP responses.'
};
const record = async (name) => {
	report.checks.push(name);
	await fs.writeFile(results + '/report.json', JSON.stringify(report, null, 2));
	console.log(name);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
	await fs.mkdir(results, { recursive: true });
	try {
		assert.equal(
			Object.values(os.networkInterfaces())
				.flat()
				.filter((x) => !x.internal).length,
			0
		);
		assert.equal((await fs.readFile('/proc/net/route', 'utf8')).trim().split('\n').length, 1);
		await assert.rejects(fetch('http://1.1.1.1', { signal: AbortSignal.timeout(2000) }));
		server = http.createServer(async (req, res) => {
			try {
				const url = new URL(req.url, 'http://localhost'),
					path = url.pathname;
				if (path.startsWith('/api/') || path.includes('well-known')) return api(req, res, url);
				if (path === '/redirect-test') {
					res.writeHead(302, { location: 'http://1.1.1.1' });
					return res.end();
				}
				const file = root + '/dist' + (path === '/' ? '/scripts/lopu-credentials.browser.html' : path);
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
			args: ['--no-proxy-server', '--disable-background-networking'],
			defaultViewport: { width: 1440, height: 1000 }
		});
		assert.ok(!browser.process().spawnargs.includes('--no-sandbox'));
		const page = await browser.newPage();
		page.on('pageerror', (e) => report.errors.push(e.message));
		await assert.rejects(page.goto('http://127.0.0.1:17643/redirect-test', { timeout: 4000 }));
		await record('kernel boundary blocks browser redirects and backend direct IP; sandbox enabled');
		await page.tracing.start({ path: results + '/trace.json', screenshots: false });
		const clickText = async (text) => {
			await page.waitForFunction((text) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === text), {}, text);
			await page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text).click(), text);
			await delay(150);
		};
		const choose = async (label, value) => {
			const selector = `select[aria-label="${label}"]`;
			await page.waitForSelector(selector);
			await page.select(selector, value);
			await delay(180);
		};
		const overflow = async () =>
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
		const scrollAll = async () => {
			const total = await page.evaluate(() => document.documentElement.scrollHeight);
			for (let top = 0; top < total; top += 500) {
				await page.evaluate((y) => window.scrollTo(0, y), top);
				await overflow();
			}
		};
		for (const width of [1440, 390]) {
			await page.setViewport({ width, height: 900 });
			await page.goto('http://127.0.0.1:17643/', { waitUntil: 'networkidle0' });
			await choose('AI credential', 'credits');
			await choose('AI model', 'credit-two');
			await page.reload({ waitUntil: 'networkidle0' });
			assert.equal(await page.$eval('[aria-label="AI model"]', (e) => e.value), 'credit-two');
			await choose('AI credential', 'chatgpt-plan-second');
			assert.equal(await page.$eval('[data-block-id="ai-endpoint-value"]', (e) => e.textContent), 'chatgpt.com');
			assert.equal(await page.$eval('[data-block-id="ai-personal-model-value"]', (e) => e.textContent), 'plan-model');
			await scrollAll();
			await page.screenshot({ path: results + `/${width}-defaults.png`, fullPage: true });
			await page.reload({ waitUntil: 'networkidle0' });
			assert.equal(await page.$eval('[aria-label="AI credential"]', (e) => e.value), 'chatgpt-plan-second');
			await clickText('Saved chat view');
			await page.waitForSelector('[aria-label="Chat settings"]');
			await page.click('[aria-label="Chat settings"]');
			await page.waitForSelector('[role="dialog"][aria-label="Chat settings"]');
			const expected = width === 1440 ? 'credits' : 'chatgpt-plan-test';

			await page.waitForFunction((expected) => document.querySelector('select[aria-label="AI credential"]')?.value === expected, {}, expected);
			await choose('AI credential', 'chatgpt-plan-test');
			await page.waitForFunction(async () => {
				const r = await fetch('/api/v1/lopu/chats');
				return (await r.json()).chats[0].lopu.providerId === 'chatgpt-plan-test';
			});
			await overflow();
			const panel = '[role="dialog"][aria-label="Chat settings"]';
			const bounds = await page.$eval(panel, (e) => {
				const r = e.getBoundingClientRect();
				return { top: r.top, bottom: r.bottom };
			});
			assert.ok(bounds.top >= 0 && bounds.bottom <= 900, 'chat settings clipped outside viewport');
			await page.$eval(panel, (el) => {
				for (const node of [el, ...el.querySelectorAll('*')])
					if (node.scrollHeight > node.clientHeight + 10 && getComputedStyle(node).overflowY !== 'visible') node.scrollTop = node.scrollHeight;
			});
			await page.screenshot({ path: results + `/${width}-chat-bottom.png` });
			await page.$eval(panel, (el) => {
				for (const node of [el, ...el.querySelectorAll('*')]) if (node.scrollTop) node.scrollTop = 0;
			});
			await page.screenshot({ path: results + `/${width}-chat.png` });
			await page.keyboard.press('Escape');
			await clickText('Defaults view');
			assert.equal(await page.$eval('[aria-label="AI credential"]', (e) => e.value), 'chatgpt-plan-second');
			await record(
				`${width}px: defaults survive reload; per-chat credential persists independently; endpoint/model and billing; popover full scroll`
			);
		}
		await page.setViewport({ width: 1440, height: 1000 });
		await clickText('Edit layout');
		await page.click('[data-block-id="ai-credential-label"]');
		await delay(250);
		await fs.writeFile(
			results + '/builder-controls.json',
			JSON.stringify(
				await page.evaluate(() =>
					[...document.querySelectorAll('input,textarea,button')].map((el) => ({
						tag: el.tagName,
						label: el.getAttribute('aria-label'),
						placeholder: el.getAttribute('placeholder'),
						value: el.value,
						text: el.textContent?.slice(0, 100)
					}))
				),
				null,
				2
			)
		);
		await page.screenshot({ path: results + '/builder.png' });
		await page.waitForSelector('textarea[aria-label="Block text"]');
		await page.click('textarea[aria-label="Block text"]');
		await page.keyboard.down('Control');
		await page.keyboard.press('KeyA');
		await page.keyboard.up('Control');
		await page.type('textarea[aria-label="Block text"]', 'Choose my AI credential');
		await page.keyboard.press('Escape');
		await page.click('[data-block-id="ai-credential-select"]');
		await page.waitForSelector('input[aria-label="Element title"]');
		await page.type('input[aria-label="Element title"]', 'Choose a saved account or Thingtime credits');
		await page.keyboard.press('Escape');
		await clickText('Save layout');
		await page.waitForFunction(() => !document.body.textContent.includes('Unsaved layout'));
		const authored = fixturePages.get('settings-lopu-ai-defaults');
		assert.ok(JSON.stringify(authored.crystal.blocks).includes('Choose my AI credential'));
		assert.ok(!JSON.stringify(authored.crystal).includes('chatgpt-plan-test'));
		await clickText('Done editing layout');
		await page.reload({ waitUntil: 'networkidle0' });
		assert.equal(await page.$eval('[data-block-id="ai-credential-label"]', (e) => e.textContent), 'Choose my AI credential');
		await choose('AI credential', 'credits');
		assert.equal(await page.$eval('[aria-label="AI credential"]', (e) => e.value), 'credits');
		await page.screenshot({ path: results + '/builder-saved.png', fullPage: true });
		assert.equal(await page.$eval('[aria-label="AI credential"]', (e) => e.title), 'Choose a saved account or Thingtime credits');
		await page.setViewport({ width: 390, height: 900 });
		await clickText('Edit layout');
		await page.click('[data-block-id="ai-credential-label"]');
		await page.waitForSelector('textarea[aria-label="Block text"]');
		await overflow();
		await page.screenshot({ path: results + '/390-builder.png' });
		await page.keyboard.press('Escape');
		await clickText('Done editing layout');
		await record(
			'Builder nested label and select edited, API readback matched, saved and reloaded; credential control still works; mobile inspector checked'
		);
		await page.tracing.stop();
		assert.deepEqual(report.errors, []);
		report.outcome = 'passed';
	} catch (e) {
		report.outcome = 'failed';
		report.error = e.stack;
		if (browser) {
			const pages = await browser.pages();
			const p = pages.at(-1);
			await p.screenshot({ path: results + '/failure.png' }).catch(() => {});
			await fs.writeFile(results + '/failure.html', await p.content()).catch(() => {});
			await p.tracing.stop().catch(() => {});
		}
	} finally {
		await browser?.close();
		server?.close();
		await fs.writeFile(results + '/report.json', JSON.stringify(report, null, 2));
		console.log(JSON.stringify(report));
		process.exitCode = report.outcome === 'passed' ? 0 : 1;
	}
})();
