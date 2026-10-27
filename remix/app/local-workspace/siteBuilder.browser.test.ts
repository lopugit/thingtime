import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const origin = process.env.TT_SITE_TEST_ORIGIN, session = process.env.TT_SITE_TEST_SESSION;
const artifacts = process.env.TT_SITE_TEST_ARTIFACTS, fixture = process.env.TT_SITE_TEST_FIXTURE;
const puppeteerPath = process.env.TT_SITE_PUPPETEER, executablePath = process.env.TT_SITE_CHROME;

test('anonymous global and site editors create, retain media, refresh other tabs and reset offline', {
 skip: !origin || !session || !artifacts || !fixture || !puppeteerPath || !executablePath, timeout: 180_000
}, async testContext => {
 assert.equal(new URL(origin!).hostname, '127.0.0.1');
 const health = await (await fetch(origin + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment.sessionId, session);
 const manifest = await (await fetch(origin + '/.well-known/thingtime-capabilities.json')).json();
 assert.equal(manifest.features['api.things'].version, '1.36.0');
 const { default: puppeteer } = await import(puppeteerPath!);
 const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 30_000,
  args: ['--no-proxy-server', '--disable-background-networking'] });
 testContext.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
 const context = await browser.createBrowserContext(), page = await context.newPage();
 const errors: string[] = [], accountRequests: string[] = [], views: unknown[] = [];
 const observe = (tab: any) => {
  tab.setDefaultTimeout(15_000);
  tab.on('pageerror', (error: Error) => errors.push(error.message));
  tab.on('request', (request: any) => {
   const path = new URL(request.url()).pathname;
   if (/^\/api\/v1\/(things|drafts|attachments|auth\/temporary)(\/|$)/.test(path)) accountRequests.push(`${request.method()} ${path}`);
  });
 };
 observe(page);
 const fill = async (tab: any, selector: string, value: string) => {
  const input = await tab.waitForSelector(selector, { visible: true });
  await input.click(); await tab.keyboard.down('Control'); await tab.keyboard.press('KeyA'); await tab.keyboard.up('Control'); await input.type(value);
 };
 const openInspector = async (tab: any) => {
  await tab.waitForSelector('select[aria-label="Select block"], button[aria-label="Open the builder inspector"]');
  if (!await tab.$('select[aria-label="Select block"]')) await tab.click('button[aria-label="Open the builder inspector"]');
  await tab.waitForSelector('select[aria-label="Select block"]', { visible: true });
 };
 const addBlock = async (tab: any, type: string) => {
  const drop = await tab.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-testid^="dropwell-root"]')].at(-1));
  await drop.asElement().click(); await drop.dispose();
  await tab.click(`[data-testid="insert-quick-${type}"]`);
 };
 const save = async (tab: any) => {
  await tab.click('[data-testid="builder-save"]');
  await tab.waitForFunction(() => {
   const button = document.querySelector<HTMLButtonElement>('[data-testid="builder-save"]');
   return button?.disabled === true && button.textContent?.trim() === 'Save' && !document.querySelector('[data-testid="builder-discard"]');
  });
 };
 const scrollPage = async (tab: any, bottom: boolean) => tab.evaluate(async (bottom: boolean) => {
  const roots = [document.scrollingElement!, ...[...document.querySelectorAll<HTMLElement>('body *')].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)];
  for (const root of roots) {
   const height = root.scrollHeight;
   if (height > 40_000) throw Error('Unexpected repeating page content');
   if (!bottom) { root.scrollTop = 0; continue; }
   for (let top = 0; top <= height; top += Math.max(100, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); }
  }
 }, bottom);
 const capture = async (label: string) => {
  for (const width of [1440, 390, 320]) {
   await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
   await scrollPage(page, false); await page.evaluate(() => document.fonts.ready);
   if (label === 'global-inspector') assert.ok(await page.$eval('[data-testid="border-style"]', (el: HTMLElement) => el.getBoundingClientRect().width >= 100));
   const bounds = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
   assert.equal(bounds.overflow, false, label); views.push({ label, ...bounds });
   await page.screenshot({ path: resolve(artifacts!, `${label}-${width}.png`) });
   await scrollPage(page, true);
   await page.screenshot({ path: resolve(artifacts!, `${label}-${width}-bottom.png`) });
  }
 };
 await mkdir(artifacts!, { recursive: true });
 const resourceSamples: unknown[] = [];
 const sampleResources = async (stage: string) => {
  const processes = await Promise.all((await readdir('/proc')).filter(id => /^\d+$/.test(id)).map(async id => {
   const status = await readFile(`/proc/${id}/status`, 'utf8').catch(() => '');
   return { id, name: /^Name:\s*(.+)$/m.exec(status)?.[1], rssKiB: Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1] || 0) };
  }));
  resourceSamples.push({ stage, bytes: Number(await readFile('/sys/fs/cgroup/memory.current', 'utf8')), processes: processes.filter(row => row.rssKiB).sort((a, b) => b.rssKiB - a.rssKiB) });
  await writeFile(resolve(artifacts!, 'resource-samples.json'), JSON.stringify(resourceSamples, null, 2));
 };
 // A deterministic one-pixel PNG tests real file bytes, not an HTTP image mock.
 const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1EAAAAASUVORK5CYII=', 'base64');
 const imagePath = resolve(artifacts!, 'local-pixel.png'); await writeFile(imagePath, bytes);
 try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin + '/builder?page=__global__', { waitUntil: 'domcontentloaded' });
  await openInspector(page);
  testContext.diagnostic('Global canvas and block selector loaded');
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready;
   if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  }, { timeout: 90_000 });
  await page.setOfflineMode(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-site-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await addBlock(page, 'text');
  await fill(page, 'textarea[aria-label="Block text"]', 'Global device note');
  const globalTextId = await page.$eval('select[aria-label="Select block"]', (el: HTMLSelectElement) => el.value);
  await addBlock(page, 'media');
  await (await page.waitForSelector('[data-testid="media-upload-input"]')).uploadFile(imagePath);
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-testid="media-src-input"]')?.value.includes('id=local-'));
  await fill(page, '[data-testid="css-custom-editor"]', 'width: 48px\nheight: 48px'); await page.keyboard.press('Tab');
  await save(page); await page.reload({ waitUntil: 'domcontentloaded' }); await openInspector(page);
  await page.waitForFunction(() => [...document.images].some(image => image.currentSrc.startsWith('blob:') && image.complete && image.naturalWidth === 1));
  await page.select('select[aria-label="Select block"]', globalTextId);
  assert.equal(await page.$eval('textarea[aria-label="Block text"]', (el: HTMLTextAreaElement) => el.value), 'Global device note');
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-testid="inline-rich-text-editor"] [contenteditable="true"]')].some(el => el.innerText === 'Global device note' && el.getBoundingClientRect().height > 0));
  testContext.diagnostic('Offline global text and image survived cold reload');
  await capture('global-inspector');
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin + '/builder?site=/ode', { waitUntil: 'domcontentloaded' }); await openInspector(page);
  await addBlock(page, 'text'); await fill(page, 'textarea[aria-label="Block text"]', 'Personal site note'); await save(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Personal site note'));
  await page.addScriptTag({ path: fixture });
  const proof = await page.evaluate(() => (window as any).siteBuilderFixture.proof());
  assert.equal(proof.pages.length, 2); assert.equal(proof.files.length, 1);
  assert.equal(proof.files[0].hash, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(proof.pages.some((row: any) => row.crystal.pageKey === 'site-global'));
  assert.ok(proof.pages.some((row: any) => row.crystal.siteRoute === '/ode'));
  await writeFile(resolve(artifacts!, 'site-global.transfer.json'), proof.json);
  testContext.diagnostic('Site override and canonical media export validated');
  await page.goto(origin + '/ode', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Global device note') && document.body.innerText.includes('Personal site note'));
  await page.waitForFunction(() => [...document.images].some(image => image.currentSrc.startsWith('blob:') && image.complete && image.naturalWidth === 1));
  await capture('personal-site');
  await sampleResources('single-tab-captures');
  const other = await context.newPage(); observe(other); await other.setOfflineMode(true);
  await other.goto(origin + '/builder?page=__global__', { waitUntil: 'domcontentloaded' }); await openInspector(other);
  await other.select('select[aria-label="Select block"]', globalTextId); await fill(other, 'textarea[aria-label="Block text"]', 'Global note from another tab'); await save(other);
  await page.bringToFront();
  await page.waitForFunction(() => document.body.innerText.includes('Global note from another tab'));
  await sampleResources('cross-tab-update');
  await other.close();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin + '/builder?site=/ode', { waitUntil: 'domcontentloaded' }); await openInspector(page);
  await page.click('[data-testid="builder-reset-default"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Personal site note'));
  await page.goto(origin + '/ode', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Global note from another tab'));
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Personal site note')), false);
  await sampleResources('reset-complete');
  assert.deepEqual(accountRequests, []); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks: ['native site/global creation while offline', 'block selector and independently editable text', 'normal file picker retains exact local PNG bytes across cold reload', 'canonical export contains page and file dependencies', 'global and site composition in normal route', 'cross-tab global refresh', 'reset only the personal site override'], imageHash: proof.files[0].hash, views, accountRequests, errors }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts!, 'failure.txt'), await page.$eval('body', (el: HTMLElement) => el.innerText).catch(() => 'Unavailable'));
  throw error;
 } finally { await context.close(); await browser.close(); }
});
