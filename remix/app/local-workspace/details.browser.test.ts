import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const base = process.env.TT_LOCAL_DETAILS_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
// Real production client, clean profile and normal import/comments/menu UI.
test('anonymous Thing discussions and owner rename survive a cold offline reload', { skip: !base || !playwrightPath, timeout: 120_000 }, async () => {
	const { chromium } = await import(playwrightPath!);
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
	const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	try {
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			page = await context.newPage();
		const mutations: string[] = [];
		context.on('request', (request: any) => {
			if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
		});
		const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
		await page.goto(new URL('/things', base).href);
		assert.equal((await (await root).json()).user, null);
		await page.getByRole('button', { name: 'Import…', exact: true }).waitFor();
		await page.waitForFunction(async () => {
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) return false;
			for (const key of await caches.keys())
				if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
					return true;
			return false;
		});
		await context.setOffline(true);
		await page.getByRole('button', { name: 'Import…', exact: true }).click();
		await page
			.getByRole('textbox', { name: 'Copied Thingtime content', exact: true })
			.fill(
				JSON.stringify({
					format: 'thingtime.transfer',
					version: 1,
					roots: ['component'],
					things: [
						{
							id: 'component',
							thingtime: ['component'],
							crystal: { name: 'Local discussion acceptance', render: { tag: 'section', children: 'Editable Component with local discussion.' } }
						}
					],
					files: []
				})
			);
		await page.getByRole('button', { name: 'Read pasted content', exact: true }).click();
		await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
		await page.getByRole('link', { name: 'Local discussion acceptance', exact: true }).click();
		await page.getByRole('heading', { name: 'Comments', exact: true }).waitFor();
		assert.equal(await page.getByText('Could not load comments.', { exact: true }).count(), 0);
		await page.getByPlaceholder('Write a comment… 💬', { exact: true }).fill('A comment saved entirely on this device.');
		await page.getByRole('button', { name: 'Send comment', exact: true }).click();
		await page.waitForFunction(() => (document.querySelector('textarea[placeholder="Write a comment… 💬"]') as HTMLTextAreaElement)?.value === '');
		await page.getByText('A comment saved entirely on this device.', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Reply to Local workspace', exact: true }).click();
		await page.getByPlaceholder('Reply to Local workspace… 💬', { exact: true }).fill('Nested reply stays local too.');
		await page.getByRole('button', { name: 'Send reply', exact: true }).click();
		await page.waitForFunction(() => (document.querySelector('textarea[placeholder="Reply to Local workspace… 💬"]') as HTMLTextAreaElement)?.value === '');
		await page.getByText('Nested reply stays local too.', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Thing actions', exact: true }).click();
		assert.equal(await page.getByRole('menuitem', { name: /History|Send to Lopu/ }).count(), 0);
		await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
		await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill('Renamed entirely offline');
		await page.getByRole('button', { name: 'Rename', exact: true }).click();
		await page.getByRole('heading', { name: 'Renamed entirely offline', exact: true }).waitFor();
		await page.reload();
		await page.getByRole('heading', { name: 'Renamed entirely offline', exact: true }).waitFor();
		await page.getByText('A comment saved entirely on this device.', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'View replies', exact: true }).click();
		await page.getByText('Nested reply stays local too.', { exact: true }).waitFor();
		await page.getByRole('searchbox', { name: 'Search Comments', exact: true }).fill('no matching comment');
		await page.getByText('A comment saved entirely on this device.', { exact: true }).waitFor({ state: 'hidden' });
		await page.getByRole('searchbox', { name: 'Search Comments', exact: true }).fill('');
		await page.getByText('A comment saved entirely on this device.', { exact: true }).waitFor();
		assert.equal(mutations.length, 0, mutations.join('\n'));
		const bounds = [];
		const dir = process.env.TT_LOCAL_DETAILS_ARTIFACTS ? resolve(process.env.TT_LOCAL_DETAILS_ARTIFACTS) : null;
		if (dir) await mkdir(dir, { recursive: true });
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
			const measurement = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
			assert.equal(measurement.scrollWidth, width);
			bounds.push(measurement);
			if (dir) await page.screenshot({ path: resolve(dir, `offline-discussion-${width}.png`), fullPage: true });
		}
		const moreReplies=page.getByRole('button',{name:'View replies',exact:true});if(await moreReplies.count())await moreReplies.click();
		await page.getByText('Nested reply stays local too.',{exact:true}).waitFor();
		const rootPath = new URL(page.url()).pathname;
		const links = await page.locator('a[href^="/post/"]').evaluateAll((anchors: HTMLAnchorElement[]) => [...new Set(anchors.map(anchor => anchor.getAttribute('href')))]);
		assert.equal(links.length,2);await page.goto(new URL(links[1]!,base).href);await page.reload();
		await page.getByText('Nested reply stays local too.',{exact:true}).waitFor();
		const parent=page.getByRole('link',{name:'View parent comment 💬',exact:true}),rootLink=page.getByRole('link',{name:'Go to the top of the thread 🧵',exact:true});
		await parent.waitFor();await rootLink.waitFor();
		assert.equal(await parent.getAttribute('href'),links[0]);assert.equal(await rootLink.getAttribute('href'),rootPath);
		for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(dir)await page.screenshot({path:resolve(dir,`offline-reply-context-${width}.png`)});}
		await parent.click();await page.getByText('A comment saved entirely on this device.',{exact:true}).waitFor();
		await page.getByRole('link',{name:'View full conversation 🧵',exact:true}).click();await page.getByRole('heading',{name:'Renamed entirely offline',exact:true}).waitFor();
		assert.deepEqual(mutations,[]);
		if (dir)
			await writeFile(
				resolve(dir, 'browser-verification.json'),
				JSON.stringify(
					{ anonymous: true, coldOfflineReload: true, commentAndReply: true, offlineThreadNavigation: true, ownerRename: true, commentSearch: true, mutations, bounds },
					null,
					2
				)
			);
	} finally {
		await browser.close();
	}
});
