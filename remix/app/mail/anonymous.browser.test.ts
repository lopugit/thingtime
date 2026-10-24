import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.TT_MAIL_TEST_ORIGIN, session = process.env.TT_MAIL_TEST_SESSION;
const artifacts = process.env.TT_MAIL_TEST_ARTIFACTS, fixture = process.env.TT_MAIL_TEST_FIXTURE;
const puppeteerPath = process.env.TT_MAIL_PUPPETEER, executablePath = process.env.TT_MAIL_CHROME;

for (const scenario of ['settings', 'reader'] as const) test(`native anonymous mail ${scenario} works offline without cloud requests`,
 { skip: !origin || !session || !artifacts || !fixture || !puppeteerPath || !executablePath, timeout: 180_000 }, async t => {
  assert.equal(new URL(origin!).hostname, '127.0.0.1');
  const health = await (await fetch(origin + '/api/v1/health/nitro')).json();
  assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
  assert.equal(health.testEnvironment.sessionId, session);
  const { default: puppeteer } = await import(puppeteerPath!);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 20_000,
   args: ['--no-proxy-server', '--disable-background-networking'] });
  t.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const browserEvents: unknown[] = [];
  const errors: string[] = [], forbiddenRequests: string[] = [], layouts: unknown[] = [], checks: string[] = [];
  const track = (tab: any) => {
   tab.on('framenavigated', (frame: any) => { if (frame === tab.mainFrame()) browserEvents.push({ kind: 'navigation', path: new URL(frame.url()).pathname }); });
   tab.on('requestfailed', (request: any) => browserEvents.push({ kind: 'request-failed', path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
   tab.on('console', (entry: any) => { if (['error', 'warn'].includes(entry.type())) browserEvents.push({ kind: entry.type(), message: entry.text().slice(0, 700) }); });
   tab.on('pageerror', (error: Error) => errors.push(error.message));
   tab.on('error', (error: Error) => errors.push('Renderer failed: ' + error.message));
   tab.on('request', (request: any) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/mail') || url.pathname === '/api/v1/auth/temporary' ||
      url.port === '17879' || url.hostname === 'mail-fixture.invalid') forbiddenRequests.push(request.method() + ' ' + url.pathname);
   });
  };
  track(page);
  const click = async (tab: any, text: string) => {
   await tab.bringToFront();
   await tab.waitForFunction((label: string) => [...document.querySelectorAll('button')].some(el => el.textContent?.trim() === label && el.checkVisibility() && !el.disabled), {}, text);
   const handle = await tab.evaluateHandle((label: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === label && el.checkVisibility()), text);
   await handle.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }));
   await handle.asElement().click(); await handle.dispose();
  };
  const expand = async (tab: any, title: string) => {
   await tab.bringToFront();
   await tab.waitForFunction(() => [...document.querySelectorAll('button')].some(el =>
    ['Add email account', 'Create proxy inbox'].includes(el.textContent?.trim() || '') && !el.disabled));
   await tab.waitForFunction((text: string) => [...document.querySelectorAll('details > summary')].some(el => el.querySelector('span')?.textContent === text), {}, title);
   const summary = await tab.evaluateHandle((text: string) => [...document.querySelectorAll('details > summary')].find(el => el.querySelector('span')?.textContent === text), title);
   if (!await summary.evaluate((el: Element) => (el.parentElement as HTMLDetailsElement).open)) {
    await summary.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }));
    await summary.asElement().focus(); await summary.asElement().press('Enter');
   }
   assert.equal(await summary.evaluate((el: Element) => (el.parentElement as HTMLDetailsElement).open), true);
   await summary.dispose();
  };
  const field = async (tab: any, text: string) => {
   await tab.waitForFunction((label: string) => [...document.querySelectorAll('label')].some(el => el.textContent?.replace('*', '').trim() === label && el.checkVisibility()), {}, text);
   const id = await tab.evaluate((label: string) => [...document.querySelectorAll('label')].find(el => el.textContent?.replace('*', '').trim() === label)?.htmlFor, text);
   assert.ok(id, `Missing field ${text}`); return tab.$(`[id="${id}"]`);
  };
  const fill = async (tab: any, label: string, value: string) => {
   await tab.bringToFront(); const input = await field(tab, label);
   await input.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }));
   await input.click(); await tab.keyboard.down('Control'); await tab.keyboard.press('A'); await tab.keyboard.up('Control'); await input.press('Backspace'); await input.type(value);
   assert.equal(await input.evaluate((el: HTMLInputElement) => el.value), value);
  };
  const checkbox = async (tab: any, label: string) => {
   const handle = await tab.evaluateHandle((text: string) => [...document.querySelectorAll('label')].find(el => el.textContent?.trim() === text), label);
   await handle.evaluate((el: Element) => el.scrollIntoView({ block: 'center' }));
   await handle.asElement().click(); await handle.dispose();
  };
  const snapshot = async (label: string) => {
   console.log('Checking ' + label);
   for (const width of [1440, 390, 320]) {
    await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
     const root = document.querySelector('#lopuPageScroll') || document.scrollingElement!;
     for (let top = 0; top < root.scrollHeight; top += Math.max(200, innerHeight * .75)) {
      root.scrollTop = top; await new Promise(requestAnimationFrame);
      if (document.documentElement.scrollWidth > innerWidth) throw Error('Horizontal overflow while scrolling');
     }
    });
    const content = label === 'mail-account-editor' ? 'form' : label === 'mail-reader' ? 'h2' :
     label === 'mail-proxy-editor' ? 'input[placeholder="Work, friends, everything lovely…"]' : null;
    if (content) {
     await page.$eval(content, (el: Element) => el.scrollIntoView({ block: 'center' }));
     await page.screenshot({ path: resolve(artifacts!, `${scenario}-${label}-${width}-content.png`) });
    }
    const scroll = async (bottom: boolean) => page.evaluate((end: boolean) => {
     for (const el of [document.scrollingElement!, document.querySelector('#lopuPageScroll')].filter(Boolean)) el!.scrollTop = end ? el!.scrollHeight : 0;
    }, bottom);
    for (const bottom of [false, true]) {
     await scroll(bottom);
     const bounds = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('main input, main select, main button, nav[aria-label="Mail inboxes"] button')]
       .filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > innerWidth + 1))
       .map(el => el.textContent?.trim().slice(0, 60)) }));
     assert.ok(bounds.documentWidth <= width, JSON.stringify({ label, ...bounds }));
     assert.deepEqual(bounds.overflowing, [], JSON.stringify({ label, ...bounds }));
     layouts.push({ label, bottom, ...bounds });
     await page.screenshot({ path: resolve(artifacts!, `${scenario}-${label}-${width}${bottom ? '-bottom' : ''}.png`) });
    }
   }
  };
  const waitForOfflineShell = () => page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  }, { timeout: 90000 });
  await mkdir(artifacts!, { recursive: true });
  try {
   console.log('Opening anonymous mail settings');
   await page.setViewport({ width: 1440, height: 1000 });
   await page.goto(origin + '/settings/email', { waitUntil: 'domcontentloaded' });
   await expand(page, 'Email accounts'); await click(page, 'Add email account');
   await fill(page, 'Account name', 'Offline mail fixture'); await fill(page, 'Email address', 'fixture@example.invalid');
   await fill(page, 'Server hostname', 'https://invalid.example'); await fill(page, 'Username', 'fixture@example.invalid');
   // No account/provider credentials are needed to save paused settings.
   await checkbox(page, 'Keep a copy on this device');
   await click(page, 'Save account');
   await page.waitForFunction(() => document.body.innerText.includes('Enter a mail server hostname'));
   await fill(page, 'Server hostname', 'imap.example.invalid');
   const cloud = await page.evaluate(() => [...document.querySelectorAll('label')].find(el => el.textContent?.trim() === 'Through Thingtime’s cloud')?.querySelector('input')?.disabled);
   assert.equal(cloud, true);
   await snapshot('mail-account-editor'); await click(page, 'Save account');
   await page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => el.textContent === 'Edit') || document.querySelector('[role="alert"]'));
   assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].some(el => el.textContent === 'Edit')), await page.$eval('body', (el: HTMLElement) => el.innerText));
   await page.evaluate(await readFile(fixture!, 'utf8'));
   const expected = await page.evaluate('MailFixture.seedReader()');
   if (scenario === 'reader') {
   await page.goto(origin + '/mail', { waitUntil: 'domcontentloaded' });
   await expand(page, 'All inboxes'); await page.waitForFunction(() => document.body.innerText.includes('52 saved messages'));
   await waitForOfflineShell();
   await page.setOfflineMode(true); await page.reload({ waitUntil: 'domcontentloaded' });
   await expand(page, 'All inboxes'); await page.waitForFunction(() => document.body.innerText.includes('52 saved messages'));
   assert.equal(await page.evaluate(async () => { try { await fetch('/__root?offline-proof=1', { cache: 'no-store' }); return false; } catch { return true; } }), true);
   await click(page, 'Show more saved mail');
   assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].filter(el => el.innerText.includes('Saved fixture message')).length), 51);
   await snapshot('mail-list');
   await page.type('input[aria-label="Search saved mail"]', 'A saved message');
   const message = await page.evaluateHandle((title: string) => [...document.querySelectorAll('button')].find(el => el.innerText.includes(title)), expected.subject);
   await message.asElement().click(); await message.dispose();
   await page.waitForSelector('h2');
   assert.equal(await page.$eval('h2', (el: Element) => el.textContent), expected.subject);
   assert.equal(await page.evaluate((body: string) => [...document.querySelectorAll('p')].some(el => el.textContent === body), expected.body), true);
   assert.equal(await page.$('img[src="https://mail-fixture.invalid/tracker"]'), null);
   const text = await page.$eval('body', (el: HTMLElement) => el.innerText);
   for (const marker of ['From: Not available', 'To: Not available', 'Date not available', 'This is a partial message.', '2 attachment(s)']) assert.ok(text.includes(marker), marker);
   await snapshot('mail-reader');
   checks.push('paused settings created through UI; invalid hostname refused; exact synthetic saved text, inert markup, missing fields and partial/attachment notices');
   await click(page, 'Back to inbox');
   await page.click('input[aria-label="Search saved mail"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
   await click(page, 'Create proxy inbox'); await expand(page, 'Create a proxy inbox'); await fill(page, 'Inbox name', 'Offline view'); await checkbox(page, 'Saved fixture inbox · IMAP');
   await snapshot('mail-proxy-editor'); await click(page, 'Save inbox'); await click(page, 'Edit proxy inbox'); await expand(page, 'Create a proxy inbox');
   await fill(page, 'Inbox name', 'Unsaved first tab');
   const other = await context.newPage(); track(other); await other.setOfflineMode(true);
   await other.goto(origin + '/mail', { waitUntil: 'domcontentloaded' }); await click(other, 'Offline view'); await expand(other, 'Offline view'); await click(other, 'Edit proxy inbox'); await expand(other, 'Create a proxy inbox');
   await fill(other, 'Inbox name', 'Saved second tab'); await click(other, 'Save inbox');
   await click(page, 'Save inbox'); await page.waitForFunction(() => document.body.innerText.includes('This inbox changed elsewhere'));
   assert.equal(await (await field(page, 'Inbox name')).evaluate((el: HTMLInputElement) => el.value), 'Unsaved first tab');
   await click(page, 'Cancel'); await click(page, 'Saved second tab'); await click(page, 'Edit proxy inbox'); await expand(page, 'Create a proxy inbox');
   assert.equal(await (await field(page, 'Inbox name')).evaluate((el: HTMLInputElement) => el.value), 'Saved second tab');
   await click(page, 'Cancel'); await other.close(); await page.bringToFront();
   await page.reload({ waitUntil: 'domcontentloaded' }); await click(page, 'Saved second tab'); await expand(page, 'Saved second tab'); await click(page, 'Remove view');
   await snapshot('mail-remove-view'); console.log('Removing proxy view'); await click(page, 'Remove proxy inbox');
   await page.waitForFunction(() => ![...document.querySelectorAll('nav[aria-label="Mail inboxes"] button')].some(el => el.textContent === 'Saved second tab'));
   checks.push('actual offline cold reload, pagination/search, proxy create/edit, stale cross-tab save refusal and retained text, reopen and delete view without deleting messages');
   } else {
   await waitForOfflineShell(); await page.setOfflineMode(true);
   await page.reload({ waitUntil: 'domcontentloaded' });
   console.log('Editing paused settings offline'); await expand(page, 'Email accounts'); await click(page, 'Edit');
   await fill(page, 'Account name', 'Renamed offline account'); await click(page, 'Save account');
   await page.waitForFunction(() => !document.querySelector('form') && document.body.innerText.includes('Renamed offline account'));
   await page.reload({ waitUntil: 'domcontentloaded' }); await expand(page, 'Email accounts'); await page.waitForFunction(() => document.body.innerText.includes('Renamed offline account'));
   await snapshot('mail-settings');
   }
   await page.evaluate(await readFile(fixture!, 'utf8')); const saved = await page.evaluate('MailFixture.proof()');
   assert.equal(saved.messages, expected.count); assert.deepEqual(saved.inboxes, []); assert.equal(saved.accounts[0].name, scenario === 'settings' ? 'Renamed offline account' : 'Offline mail fixture');
   assert.equal(saved.queuedWrites, 0); assert.equal(saved.hasCredential, false);
   let removed;
   if (scenario === 'settings') {
   assert.equal(await page.evaluate(async () => { try { await fetch('/__root?offline-proof=1', { cache: 'no-store' }); return false; } catch { return true; } }), true);
   await click(page, 'Remove'); await click(page, 'Keep account'); await click(page, 'Remove'); await click(page, 'Remove account');
   await page.waitForFunction(() => document.body.innerText.includes('Your connected accounts will appear here.'));
   removed = await page.evaluate('MailFixture.proof()'); assert.equal(removed.accounts.length, 0); assert.equal(removed.messages, 0);
   checks.push('offline account edit/reload and confirmed local cache removal; no credentials, remote queue, provider connection or account mail requests');
   }
   assert.deepEqual(forbiddenRequests, []); assert.deepEqual(errors, []);
   await writeFile(resolve(artifacts!, `verification-${scenario}.json`), JSON.stringify({ checks, layouts, saved, removed, forbiddenRequests, errors, readerSource: 'synthetic canonical encrypted-store fixture; not provider delivery' }, null, 2));
  } catch (error) {
   console.error(error);
   const cdp = await page.createCDPSession().catch(() => null);
   if (cdp) {
    const state = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({url:location.pathname,ready:document.readyState,text:document.body?.innerText})', returnByValue: true, timeout: 3000 }).catch((e: Error) => ({error:e.message}));
    await writeFile(resolve(artifacts!, `${scenario}-direct-dom.json`), JSON.stringify(state, null, 2));
    await cdp.detach().catch(() => {});
   }
   await writeFile(resolve(artifacts!, `${scenario}-browser-events.json`), JSON.stringify(browserEvents, null, 2));
   await writeFile(resolve(artifacts!, `${scenario}-failure-fields.json`), JSON.stringify(await page.$$eval('input:not([type=password])', inputs => inputs.map(el => ({type:(el as HTMLInputElement).type,value:(el as HTMLInputElement).value,checked:(el as HTMLInputElement).checked,valid:(el as HTMLInputElement).validity.valid}))).catch(() => []),null,2));
   await page.screenshot({ path: resolve(artifacts!, `${scenario}-failure.png`) }).catch(() => {});
   await writeFile(resolve(artifacts!, `${scenario}-failure.txt`), await page.$eval('body', (el: HTMLElement) => el.innerText).catch(() => 'Unavailable'));
   throw error;
  } finally { await context.close(); await browser.close(); }
 });
