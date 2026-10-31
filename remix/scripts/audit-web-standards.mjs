/** Run catalogue programs in the actual served iframe and worker. Creates no Things.
 * Use an explicit local or HTTPS preview URL and optionally a separately installed Playwright module.
 * Only frame-load failures are retried; program failures remain visible.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { platformRuntimeCsp } from './csp.mjs';
import { WEB_FEATURES } from '../app/webPlatform/catalogue.ts';
import { featureRecipe } from '../app/webPlatform/recipes.ts';
// An ephemeral test fixture serves only the two built runtime files. It is
// not an app/dev server and does not start Nitro, connect to a DB or use PM2.
async function builtRuntimeFixture() {
	const assets = new Map(
		await Promise.all(
			['html', 'js'].map(async (ext) => [
				`/platform/runtime.${ext}`,
				{
					bytes: await readFile(new URL(`../.vercel/output/static/platform/runtime.${ext}`, import.meta.url)),
					type: ext === 'html' ? 'text/html' : 'text/javascript'
				}
			])
		)
	);
	const server = createServer((request, response) => {
		const asset = assets.get(request.url?.split('?')[0]);
		if (!asset) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.writeHead(200, { 'Content-Type': asset.type, 'Content-Security-Policy': platformRuntimeCsp, 'Cache-Control': 'no-store' });
		response.end(asset.bytes);
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
async function main() {
	const fixture = process.env.TT_STANDARDS_AUDIT_BUILT === '1' ? await builtRuntimeFixture() : undefined;
	try {
		const requested = new URL(fixture?.origin || process.env.TT_STANDARDS_TEST_URL || '');
		const origin = requested.origin;
		assert.ok(
			!requested.username &&
				!requested.password &&
				(requested.protocol === 'https:' || (requested.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(requested.hostname))),
			'Use an explicit local or HTTPS preview URL without credentials'
		);
		const languages = (process.env.TT_STANDARDS_AUDIT_LANGUAGES || 'javascript').split(',');
		const selectedIds = process.env.TT_STANDARDS_AUDIT_IDS?.split(',');
		const entries = WEB_FEATURES.filter((f) => languages.includes(f.language) && (!selectedIds || selectedIds.includes(f.id)))
			.map((f) => ({ id: f.id, name: f.name, language: f.language, ...featureRecipe(f) }))
			.filter((f) => f.coverage === 'interactive');
		assert.ok(entries.length, 'No interactive examples match the requested selection');
		const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
		const browser = await chromium.launch({ channel: 'chrome', headless: true });
		const results = [];
		try {
			const page = await browser.newPage();
			await page.route(origin + '/__standards_audit', (route) =>
				route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Web standards runtime audit</title>' })
			);
			await page.goto(origin + '/__standards_audit');
			for (const item of entries) {
				let response;
				for (let attempt = 0; attempt < 2; attempt++) {
					response = await page.evaluate(
						(item2) =>
							new Promise((resolve) => {
								const runId = item2.id.slice(-64);
								const frame = document.createElement('iframe');
								frame.setAttribute('sandbox', item2.program.allowFormEvents ? 'allow-scripts allow-forms' : 'allow-scripts');
								let finished = false,
									ready = false;
								const finish = (value) => {
									if (finished) return;
									finished = true;
									clearTimeout(timer);
									removeEventListener('message', receive);
									frame.remove();
									resolve(value);
								};
								const receive = (event) => {
									if (event.source !== frame.contentWindow) return;
									if (event.data?.type === 'tt-platform-ready' && !ready) {
										ready = true;
										frame.contentWindow.postMessage(
											{
												type: 'tt-platform-start',
												runId,
												program: item2.program,
												input: Object.fromEntries((item2.program.parameters || []).map((p) => [p.name, p.default]))
											},
											'*'
										);
									}
									if (event.data?.type === 'tt-platform-result' && event.data.runId === runId) finish(event.data);
								};
								const timer = setTimeout(
									() => finish({ ok: false, loadFailure: !ready, text: ready ? 'Runtime failed to respond' : 'Runtime failed to load' }),
									12e3
								);
								addEventListener('message', receive);
								frame.src = '/platform/runtime.html';
								document.body.appendChild(frame);
							}),
						item
					);
					if (!response.loadFailure) break;
				}
				let result = response.text;
				try {
					result = JSON.parse(response.text);
				} catch {}
				const unsupported = !!result && typeof result === 'object' && result.status === 'unsupported';
				results.push({
					id: item.id,
					name: item.name,
					language: item.language,
					status: response.ok ? 'passed' : unsupported ? 'unsupported' : response.loadFailure ? 'load-failed' : 'failed',
					result
				});
				if (!response.ok && !unsupported) console.log(`Failed: ${item.name}: ${response.text}`);
				if (results.length === 1 || results.length % 50 === 0) console.log(`Audited ${results.length}/${entries.length}`);
			}
			const counts = Object.fromEntries(
				['passed', 'unsupported', 'failed', 'load-failed'].map((status) => [status, results.filter((r) => r.status === status).length])
			);
			const report = {
				browser: browser.version(),
				runtime: fixture ? 'built artifacts' : origin,
				generatedAt: new Date().toISOString(),
				counts,
				results
			};
			if (process.env.TT_STANDARDS_AUDIT_OUTPUT) await writeFile(process.env.TT_STANDARDS_AUDIT_OUTPUT, JSON.stringify(report, null, 2));
			console.log(
				JSON.stringify(
					{ browser: report.browser, counts, failures: results.filter((r) => r.status === 'failed' || r.status === 'load-failed') },
					null,
					2
				)
			);
			if (counts.failed || counts['load-failed']) process.exitCode = 1;
		} finally {
			await browser.close();
		}
	} finally {
		await fixture?.close();
	}
}
void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
