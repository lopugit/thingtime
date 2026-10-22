// Run under a verified OS network boundary. The only server is a synthetic
// fixture with no backend, account credentials, database, or origin fallback.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE);
const port = 13820,
	origin = `http://127.0.0.1:${port}`;
await assert.rejects(fetch('http://1.1.1.1', { signal: AbortSignal.timeout(2000) }), (e) => e.cause?.code === 'EPERM');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
	root,
	configFile: false,
	envDir: false,
	resolve: { alias: { '~': `${root}/app` } },
	server: { host: '127.0.0.1', port, strictPort: true },
	esbuild: { jsx: 'automatic' }
});
let browser;
const errors = [];
try {
	await server.listen();
	const evidence = fileURLToPath(new URL('../tmp/menu-bar-qa/', import.meta.url));
	await mkdir(evidence, { recursive: true });
	browser = await chromium.launch({ headless: true, ...(process.env.TT_CHROME_PATH ? { executablePath: process.env.TT_CHROME_PATH } : {}) });
	const context = await browser.newContext();
	await context.tracing.start({ screenshots: true, snapshots: true });
	const page = await context.newPage();
	page.on('pageerror', (e) => errors.push(e.message));
	for (const width of process.env.TT_SCRIPTS_ONLY ? [] : [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${origin}/scripts/mac-menu-bar.browser.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await page
			.getByText('Menu item 0', { exact: true })
			.waitFor({ timeout: 120000 })
			.catch(async (e) => {
				console.log('ERRORS', errors);
				console.log(await page.locator('body').innerText());
				await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
				throw e;
			});
  assert.equal(await page.getByText('Menu item 46', {exact:true}).count(), 1, 'Show all is the default');
  assert.equal(await page.getByRole('img',{name:'Sample program icon'}).count(),47);
  assert.equal(await page.getByRole('img',{name:'Sample program icon'}).first().evaluate(e=>e.complete && e.naturalWidth>0),true);
		await page.locator('summary').first().click();
		await page.getByText('/Applications/Sample.app/Contents/MacOS/Sample', { exact: true }).first().waitFor();
		assert.equal(await page.locator('details[open]').getByText('Unavailable', { exact: true }).count(), 0, 'zero/false are real readings');
		await page.screenshot({ path: `${evidence}/${width}-details.png`, fullPage: true });
		for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 600) {
			await page.evaluate((y) => window.scrollTo(0, y), y);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}: overflow`);
		}
		await page.getByPlaceholder(/Search Menu bar items/i).fill('Menu item 46');
		await page.getByText('Menu item 46', { exact: true }).waitFor();
		await page.locator('summary').first().click();
		assert.ok((await page.locator('details[open]').getByText('Unavailable', { exact: true }).count()) >= 2);
		for (const [state, text] of [
			['partial', 'Partial inventory.'],
			['offline', 'Offline · last snapshot'],
			['locked', 'Unlock this Mac'],
			['collecting', 'Reading the Mac menu bar.'],
			['unsupported', 'Menu bar sync needs a compatible Mac node'],
			['empty', 'Pair Thingtime on your Mac']
		]) {
			await page.getByLabel('Acceptance scenario').selectOption(state);
			await page.getByText(text, { exact: false }).first().waitFor();
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}/${state}: overflow`);
		}
	}

 for (const width of [1440,390]) {
  await page.setViewportSize({width,height:900});
  await page.goto(`${origin}/scripts/mac-menu-bar.browser.html?editor`,{waitUntil:'domcontentloaded',timeout:120000});
  if(width<768) await page.getByRole('button',{name:'Inspector',exact:true}).click();
  const picker=page.getByLabel('Select block',{exact:true});
  await picker.waitFor({timeout:120000});
  const options=await picker.locator('option').evaluateAll(es=>es.map(e=>({value:e.value,label:e.textContent})));
  assert.ok(options.length>100,'Every nested field appears as an authored block');
  const choose=async(pattern)=>{const item=options.find(e=>pattern.test(e.label));assert.ok(item,`Block ${pattern} exists`);await picker.selectOption(item.value);};
  await choose(/div · Mac menu bar$/);
  await page.getByLabel('Block text',{exact:true}).fill(`My menu bar ${width}`);
  await choose(/button · Refresh/);
  await page.getByLabel('Block text',{exact:true}).fill(`Refresh icons ${width}`);
  await choose(/img ·/);
  await page.getByLabel('Element alt',{exact:true}).fill('Icon for {item.program}');
  await choose(/summary ·/);
  await page.getByLabel('Block text',{exact:true}).fill('Inspect program and stats');
  await choose(/When item.state.menuBar.accessibility$/);
  await page.getByLabel('Condition equals',{exact:true}).selectOption('true');
  await page.getByLabel('Condition equals',{exact:true}).selectOption('false');
  await choose(/List · Menu bar items/);
  assert.equal(await page.getByLabel('Default page size').inputValue(),'all');
  await page.getByTestId('builder-save').click();
  await page.getByTestId('saved').filter({hasText:'Saved and validated'}).waitFor();
  await page.screenshot({path:`${evidence}/${width}-editor.png`,fullPage:true});
  await page.reload();
  if(width<768) await page.getByRole('button',{name:'Inspector',exact:true}).click();
  await page.getByLabel('Select block').waitFor();
  await page.getByLabel('Select block').selectOption(options.find(e=>/div · Mac menu bar$/.test(e.label)).value);
  assert.equal(await page.getByLabel('Block text',{exact:true}).inputValue(),`My menu bar ${width}`);
  if(await page.getByRole('button',{name:'View',exact:true}).isVisible()) await page.getByRole('button',{name:'View',exact:true}).click();
  else { await page.getByRole('button',{name:'Page mode: Builder',exact:true}).click(); await page.getByRole('menuitemradio',{name:'View',exact:true}).click(); }
  await page.getByTestId('builder-close').click();
  await page.getByText(`My menu bar ${width}`,{exact:true}).waitFor();
  await page.getByRole('img',{name:'Icon for Sample program',exact:true}).first().waitFor();
  assert.equal(await page.getByRole('img',{name:'Icon for Sample program',exact:true}).count(),47);
  await page.getByText('Inspect program and stats',{exact:true}).first().click();
  await page.getByText('/Applications/Sample.app/Contents/MacOS/Sample',{exact:true}).first().waitFor();
  for(let y=0;y<await page.evaluate(()=>document.body.scrollHeight);y+=600) {
   await page.evaluate(y=>scrollTo(0,y),y);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}: edited page overflow`);
  }
  // Test identities persist only in this synthetic browser context.
  await page.evaluate(()=>sessionStorage.removeItem('menu-blocks'));
 }
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${origin}/scripts/mac-menu-bar.browser.html?scripts`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await page.getByRole('button', { name: 'Request run', exact: true }).waitFor({ timeout: 120000 });
		const formBounds = await page.getByPlaceholder('example-1').boundingBox();
		assert.ok(formBounds && formBounds.x >= 18, `${width}: suite supplies its own side padding`);
		assert.ok(Math.abs(formBounds.x + formBounds.width / 2 - width / 2) <= 2, `${width}: suite centers its own form`);
		await page.getByRole('button', { name: 'Save reusable Action', exact: true }).click();
		await page.getByRole('link', { name: 'Open saved Thing', exact: true }).waitFor();
		await page.getByRole('combobox', { name: 'Choose a record', exact: true }).selectOption('fixture-mac');
		await page.getByPlaceholder('example-1').fill('acceptance-1');
		await page.getByRole('button', { name: 'Request run', exact: true }).click();
		await page
			.getByText('needs-approval', { exact: true })
			.waitFor({ timeout: 15000 })
			.catch(async (e) => {
				console.log(await page.locator('body').innerText());
				console.log(errors);
				console.log(
					await page
						.locator('input,textarea,select,button[data-tt-action]')
						.evaluateAll((es) =>
							es.map((e) => ({ tag: e.tagName, name: e.name, value: e.value, valid: e.validity?.valid, action: e.getAttribute('data-tt-action') }))
						)
				);
				throw e;
			});
		await page.getByRole('button', { name: 'Read this result', exact: true }).click();
		await page.getByText('Hello fixture', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Save result as a private Thing', exact: true }).click();
		await page.getByRole('link', { name: 'Open saved Thing', exact: true }).waitFor();
		await page.getByRole('button', { name: 'Save reusable Action', exact: true }).click();
		await page.getByText('Read an earlier run', { exact: true }).click();
		await page.screenshot({ path: `${evidence}/${width}-scripts.png`, fullPage: true });
		for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 600) {
			await page.evaluate((y) => scrollTo(0, y), y);
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
		}
	}
	assert.deepEqual(errors, []);
	await context.tracing.stop({ path: `${evidence}/trace.zip` });
	console.log(
		JSON.stringify({
			ok: true,
			widths: [1440, 390],
			searchLastOf47: !process.env.TT_SCRIPTS_ONLY,
			details: !process.env.TT_SCRIPTS_ONLY,
			zeroAndUnavailable: !process.env.TT_SCRIPTS_ONLY,
			states: process.env.TT_SCRIPTS_ONLY ? 0 : 7,
			evidence
		})
	);
} finally {
	await browser?.close();
	await server.close();
}
