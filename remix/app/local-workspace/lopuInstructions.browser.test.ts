import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.TT_INSTRUCTIONS_TEST_ORIGIN;
const session = process.env.TT_INSTRUCTIONS_TEST_SESSION;
const artifacts = process.env.TT_INSTRUCTIONS_TEST_ARTIFACTS;
const puppeteerPath = process.env.TT_INSTRUCTIONS_PUPPETEER;
const executablePath = process.env.TT_INSTRUCTIONS_CHROME;
test('isolated native instructions: anonymous edit, offline reload, cross-tab conflicts, responsive layout and normal private API',
 { skip: !origin || !session || !artifacts || !puppeteerPath || !executablePath, timeout: 180_000 }, async contextTest => {
  assert.equal(new URL(origin!).hostname, '127.0.0.1');
  const health = await (await fetch(origin + '/api/v1/health/nitro')).json();
  assert.equal(health.testEnvironment.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment.sessionId, session);
  const manifest = await (await fetch(origin + '/.well-known/thingtime-capabilities.json')).json();
  assert.equal(manifest.origin, origin); assert.ok(capabilitySatisfies(manifest.features['api.settings-lopu-prompt'].version, '2.0.0'));
  const { default: puppeteer } = await import(puppeteerPath!);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 30_000, args: ['--no-proxy-server', '--disable-background-networking'] });
  contextTest.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [], requests: string[] = [], checks: string[] = [], viewports: unknown[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('request', (request: any) => { if (new URL(request.url()).pathname === '/api/v1/settings/lopu-prompt') requests.push(request.method()); });
  const click = async (tab: any, label: string) => {
   await tab.bringToFront();
   await tab.waitForFunction((text: string) => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === text && !button.disabled), {}, label);
   const handle = await tab.evaluateHandle((text: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text), label);
   await handle.asElement().click(); await handle.dispose();
   if (label === 'Save instructions') await tab.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save instructions' && button.disabled) || document.querySelector('#lopu-instructions [role="alert"]')?.textContent?.includes('another tab'));
  };
  const text = 'Use Australian English.\nKeep my wording editable.';
  await mkdir(artifacts!, { recursive: true });
  try {
   await page.setViewport({ width: 1440, height: 1000 });
   console.log('Opening native settings');
   await page.goto(origin + '/settings/lopu#lopu-instructions', { waitUntil: 'domcontentloaded' });
   console.log('Adding instruction');
   await click(page, 'Add instruction'); await page.type('textarea[aria-label="Instruction 1"]', text);
   await click(page, 'Save instructions');
   await page.waitForFunction(() => document.querySelector('#lopu-instructions')?.textContent?.includes('Local workspace. No account sync.'));
   assert.deepEqual(requests, [], 'anonymous editor must not read or write account instructions');
   console.log('Saved anonymous instructions; waiting for verified offline shell');
   await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
    for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
    return false;
   }, { timeout: 90000 });
   console.log('Reloading offline');
   await page.setOfflineMode(true); await page.reload({ waitUntil: 'domcontentloaded' });
   await page.waitForFunction((expected: string) => (document.querySelector('textarea[aria-label="Instruction 1"]') as HTMLTextAreaElement)?.value === expected, {}, text);
   await click(page, 'Add instruction'); await page.type('textarea[aria-label="Instruction 2"]', 'Retain this disabled instruction.');
   const checkbox = await page.$('input[aria-label="Enable instruction 2"]');
   const label = await checkbox.evaluateHandle((element: Element) => element.closest('label')); await label.asElement().click();
   await click(page, 'Save instructions'); await page.reload({ waitUntil: 'domcontentloaded' });
   await page.waitForSelector('textarea[aria-label="Instruction 2"]');
   assert.equal(await page.$eval('input[aria-label="Enable instruction 2"]', (el: HTMLInputElement) => el.checked), false);
   checks.push('anonymous save, actual offline cold reload, disabled row retained');
   console.log('Testing cross-tab conflict');
   const other = await context.newPage(); await other.goto(origin + '/settings/lopu#lopu-instructions', { waitUntil: 'domcontentloaded' });
   await other.waitForSelector('textarea[aria-label="Instruction 1"]');
   await page.bringToFront(); console.log('Editing first tab');
   await page.type('textarea[aria-label="Instruction 1"]', ' Unsaved in first tab.');
   await other.bringToFront(); console.log('Saving second tab');
   await other.type('textarea[aria-label="Instruction 1"]', ' Saved in second tab.'); await click(other, 'Save instructions');
   await click(page, 'Save instructions');
   await page.waitForFunction(() => document.querySelector('#lopu-instructions [role="alert"]')?.textContent?.includes('another tab'));
   assert.match(await page.$eval('textarea[aria-label="Instruction 1"]', (el: HTMLTextAreaElement) => el.value), /Unsaved in first tab/);
   await click(page, 'Reload saved settings');
   await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Instruction 1"]') as HTMLTextAreaElement)?.value.includes('Saved in second tab'));
   await other.close(); await page.bringToFront(); checks.push('cross-tab conflict preserves unsaved editor text and offers explicit reload');
   console.log('Checking responsive layout');
   for (const width of [1440,390,320]) {
    await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
    await page.$eval('#lopu-instructions summary', (el: HTMLElement) => { if ((el.parentElement as HTMLDetailsElement).open) el.click(); });
    await page.$eval('#lopu-instructions', (el: HTMLElement) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -72); });
    await page.evaluate(() => document.fonts.ready);
    const bounds = await page.$eval('#lopu-instructions', (el: HTMLElement) => ({ width: innerWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(bounds.overflow, false); assert.ok(bounds.left >= 0 && bounds.right <= width);
    await page.screenshot({ path: resolve(artifacts!, `instructions-${width}.png`) });
    await page.$eval('#lopu-instructions summary', (el: HTMLElement) => el.click());
    await page.screenshot({ path: resolve(artifacts!, `instructions-expanded-${width}.png`) });
    await page.evaluate(() => { const root = document.scrollingElement!; root.scrollTop = root.scrollHeight; const el = document.querySelector('#lopuPageScroll'); if (el) el.scrollTop = el.scrollHeight; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(artifacts!, `instructions-bottom-${width}.png`) });
    viewports.push(bounds);
   }
   checks.push('expanded base prompt and bottom scroll fit desktop and both phone widths');
   assert.deepEqual(requests, []);
   await page.setOfflineMode(false);
   // A supported disposable API identity exists only inside this test namespace.
   // No password, host credential, personal profile or persistent owner is used.
   console.log('Checking normal private API');
   const apiProof = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json' };
    const denied = await fetch('/api/v1/settings/lopu-prompt', { method: 'POST', headers, body: JSON.stringify({ scope: 'personal', revision: null, instructions: [] }) });
    const temporary = await fetch('/api/v1/auth/temporary', { method: 'POST', headers });
    const current = await (await fetch('/api/v1/settings/lopu-prompt')).json();
    const instructions = Array.from({ length: 35 }, (_, i) => ({ id: String(i), text: i ? 'Private fixture preference' : 'x'.repeat(2100), enabled: true }));
    const saved = await fetch('/api/v1/settings/lopu-prompt', { method: 'POST', headers, body: JSON.stringify({ scope: 'personal', revision: current.personal.revision, instructions }) });
    const receipt = await saved.json();
    const stale = await fetch('/api/v1/settings/lopu-prompt', { method: 'POST', headers, body: JSON.stringify({ scope: 'personal', revision: current.personal.revision, instructions: [] }) });
    const baseDenied = await fetch('/api/v1/settings/lopu-prompt', { method: 'POST', headers, body: JSON.stringify({ scope: 'base', revision: current.base.revision, basePrompt: 'Not authorized' }) });
    const readback = await (await fetch('/api/v1/settings/lopu-prompt')).json();
    return { anonymous: denied.status, temporary: temporary.status, save: saved.status, stale: stale.status, base: baseDenied.status, equal: JSON.stringify(readback.personal) === JSON.stringify(receipt.personal), count: readback.personal.instructions.length, privateCache: saved.headers.get('Cache-Control') };
   });
   assert.deepEqual(apiProof, { anonymous:401, temporary:201, save:200, stale:409, base:403, equal:true, count:35, privateCache:'no-store' });
   checks.push('normal private API: anonymous refusal, disposable identity, large checklist, exact readback, stale revision and admin refusal');
   await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks, viewports, apiProof, errors, anonymousInstructionRequests: [] }, null, 2));
   assert.deepEqual(errors, []);
  } catch (error) {
   await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
   await writeFile(resolve(artifacts!, 'failure.txt'), await page.$eval('body', (el: HTMLElement) => el.innerText).catch(() => 'Unavailable'));
   throw error;
  } finally { await context.close(); await browser.close(); }
 });
