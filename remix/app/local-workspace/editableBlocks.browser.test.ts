import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

const origin = process.env.TT_BLOCKS_TEST_ORIGIN, session = process.env.TT_BLOCKS_TEST_SESSION;
const artifacts = process.env.TT_BLOCKS_TEST_ARTIFACTS, fixture = process.env.TT_BLOCKS_TEST_FIXTURE;
const puppeteerPath = process.env.TT_BLOCKS_PUPPETEER, executablePath = process.env.TT_BLOCKS_CHROME;

test('native anonymous Builder edits individual blocks offline and exports their dependencies', {
 skip: !origin || !session || !artifacts || !fixture || !puppeteerPath || !executablePath, timeout: 180_000
}, async testContext => {
 assert.equal(new URL(origin!).hostname, '127.0.0.1');
 const health = await (await fetch(origin + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment.sessionId, session);
 const manifest = await (await fetch(origin + '/.well-known/thingtime-capabilities.json')).json();
 assert.equal(manifest.origin, origin);
 assert.ok(capabilitySatisfies(manifest.features['api.things'].version, '1.36.0'),
  'Requires the editable-block contract and accepts compatible later additions');
 const { default: puppeteer } = await import(puppeteerPath!);
 const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 30_000, args: ['--no-proxy-server', '--disable-background-networking'] });
 testContext.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
 const context = await browser.createBrowserContext(), page = await context.newPage();
 page.setDefaultTimeout(15_000);
 const errors: string[] = [], accountRequests: string[] = [], viewports: unknown[] = [];
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => {
  const path = new URL(request.url()).pathname;
  if (/^\/api\/v1\/(things|drafts|actions|auth\/temporary)(\/|$)/.test(path)) accountRequests.push(`${request.method()} ${path}`);
 });
 const click = async (label: string) => {
  const handle = await page.waitForFunction((text: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text && !button.disabled && button.getBoundingClientRect().width), {}, label);
  await handle.asElement().click(); await handle.dispose();
 };
 const fill = async (selector: string, value: string) => {
  const field = await page.waitForSelector(selector, { visible: true });
  await field.click();
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await field.type(value);
 };
 const select = async (id: string) => {
  await page.waitForSelector('select[aria-label="Select block"]', { visible: true });
  await page.select('select[aria-label="Select block"]', id);
 };
 await mkdir(artifacts!, { recursive: true });
 try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin + '/builder', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('New page'));
  await page.addScriptTag({ path: fixture });
  const seeded = await page.evaluate(() => (window as any).editableBlocksFixture.seed());
  await page.goto(origin + '/builder?page=' + seeded.pageId, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Local component argument'));
  await click('Builder');
  await select('title'); await fill('textarea[aria-label="Block text"]', 'Edited nested title');
  await fill('[data-testid="css-custom-editor"]', 'color: #8b4334');
  await page.keyboard.press('Tab');
  await page.click('button[aria-label="Move block down"]');
  await select('button'); await fill('textarea[aria-label="Block text"]', 'Edited button');
  await select('icon'); await fill('textarea[aria-label="Block text"]', '★');
  await page.click('[data-block-id="icon"]', { button: 'right' });
  await page.click('[data-testid="ctx-duplicate"]');
  const duplicate = await page.waitForFunction(() => [...document.querySelectorAll<HTMLOptionElement>('select[aria-label="Select block"] option')].find(option => option.value !== 'icon' && option.textContent?.includes('★'))?.value);
  await select(await duplicate.jsonValue()); await duplicate.dispose();
  await fill('textarea[aria-label="Block text"]', '✦');
  await select('row-name'); await fill('textarea[aria-label="Block text"]', 'Edited row: {item.name}');
  await select('unused'); await page.click('button[aria-label="Delete block"]');
  await click('Save');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save' && button.disabled));
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready;
   if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  }, { timeout: 90_000 });
  await page.setOfflineMode(true); await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Edited nested title'));
  await click('View');
  await page.waitForFunction(() => document.body.innerText.includes('Edited row: First row'));
  await click('Builder'); await select('button');
  await fill('textarea[aria-label="Block text"]', 'Saved while offline'); await click('Save');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save' && button.disabled));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Saved while offline'));
  await page.addScriptTag({ path: fixture });
  const proof = await page.evaluate(id => (window as any).editableBlocksFixture.proof(id), seeded.pageId);
  assert.ok(proof.kinds.some((kinds: string[]) => kinds.includes('component')));
  assert.ok(proof.kinds.some((kinds: string[]) => kinds.includes('action')));
  assert.equal(JSON.stringify(proof.page.crystal).includes('Remove this fixture block'), false);
  const children = proof.page.crystal.blocks[0].children;
  assert.equal(children[0].id, 'button');
  assert.equal(children[1].id, 'title');
  assert.equal(children[1].css.color, '#8b4334');
  assert.ok(children.some((block: any) => block.id !== 'icon' && block.text === '✦'));
  assert.match(proof.json, /Edited row/);
  await writeFile(resolve(artifacts!, 'editable-offline.json'), proof.json);
  await click('View');
  for (const width of [1440, 390, 320]) {
   await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
   const closeInspector = 'button[aria-label="Close builder"]';
   if (!await page.$(closeInspector)) await click('Inspector');
   await page.waitForSelector(closeInspector, { visible: true });
   await page.screenshot({ path: resolve(artifacts!, `inspector-${width}.png`) });
   await page.click(closeInspector);
   await page.waitForSelector(closeInspector, { hidden: true });
   await page.evaluate(() => {
    for (const root of [document.scrollingElement!, ...document.querySelectorAll('#lopuPageScroll')]) root.scrollTop = 0;
   });
   await page.evaluate(() => document.fonts.ready);
   await page.waitForFunction(() => document.body.innerText.includes('Edited row: First row'));
   const bounds = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
   assert.equal(bounds.overflow, false);
   await page.screenshot({ path: resolve(artifacts!, `blocks-${width}.png`) });
   // Walk each real scroll container to its bottom; do not infer from viewport alone.
   await page.evaluate(async () => {
    for (const root of [document.scrollingElement!, ...document.querySelectorAll('#lopuPageScroll')]) {
     for (let top = 0; top < root.scrollHeight; top += Math.max(1, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); }
    }
   });
   await page.screenshot({ path: resolve(artifacts!, `blocks-${width}-bottom.png`) });
   viewports.push(bounds);
  }
  assert.deepEqual(accountRequests, []); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks: ['nested title, button, icon and repeated row edits', 'style, reorder, duplicate and delete through Builder controls', 'save and cold offline reload', 'offline edit and local save without capability fetch', 'canonical export includes Component and Action dependencies', 'inspector and unobstructed page at all three viewports'], viewports, accountRequests, errors }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts!, 'failure.txt'), await page.$eval('body', (element: HTMLElement) => element.innerText).catch(() => 'Unavailable'));
  throw error;
 } finally { await context.close(); await browser.close(); }
});
