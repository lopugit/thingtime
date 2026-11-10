import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_SITE_EDITABLE_ORIGIN, session = process.env.TT_SITE_EDITABLE_SESSION;
const artifacts = process.env.TT_SITE_EDITABLE_ARTIFACTS;

// Run only inside the verified network-none browser/backend runtime. All fixture
// construction and edits use native Builder controls; IndexedDB is read-only proof.
test('global and site nested blocks remain individually editable after offline save and reload', {
 skip: !base || !session || !artifacts, timeout: 240_000
}, async () => {
 assert.equal(new URL(base ).hostname, '127.0.0.1');
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment.sessionId, session);
 const manifest = await (await fetch(base + '/.well-known/thingtime-capabilities.json')).json();
 assert.equal(manifest.origin, base);
 assert.match(manifest.features['api.things'].version, /^1\./);
 const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH );
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH,
  headless: true, chromiumSandbox: true,
  args: ['--no-proxy-server', '--disable-background-networking', '--js-flags=--max-old-space-size=128'] });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const page = await context.newPage(); page.setDefaultTimeout(20_000);
 const errors           = [], accountRequests           = [], checks           = [], views            = [];
 const identities                                                                                               = {};
 page.on('pageerror', (error       ) => errors.push(error.message));
 page.on('request', (request     ) => {
  const path = new URL(request.url()).pathname;
  if (/^\/api\/v1\/(things|drafts|actions|attachments|auth\/temporary)(\/|$)/.test(path)) accountRequests.push(`${request.method()} ${path}`);
 });
 const open = async () => {
  if (!await page.getByLabel('Select block', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Open the builder inspector', exact: true }).click();
  await page.getByLabel('Select block', { exact: true }).waitFor();
 };
 const selected = () => page.getByLabel('Select block', { exact: true }).inputValue();
 const select = async (id        ) => { await open(); await page.getByLabel('Select block', { exact: true }).selectOption(id); assert.equal(await selected(), id); };
 const add = async (parent               , kind        ) => {
  const prefix = 'dropwell-' + (parent || 'root');
  await page.locator(`[data-testid="${prefix}"], [data-testid^="${prefix}-"]`).last().click();
  await page.getByTestId('insert-quick-' + kind).click();
  return selected();
 };
 const fillText = (text        ) => page.getByLabel('Block text', { exact: true }).fill(text);
 const save = async () => {
  await page.getByTestId('builder-save').click();
  await page.waitForFunction(() => {
   const button = document.querySelector                   ('[data-testid="builder-save"]');
   return button?.disabled && button.textContent?.trim() === 'Save' && !document.querySelector('[data-testid="builder-discard"]');
  });
 };
 const pages = () => page.evaluate(async () => {
  const db = await new Promise             ((resolve, reject) => {
   const request = indexedDB.open('thingtime.local-workspaces.v1');
   request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try { return await new Promise       ((resolve, reject) => {
   const request = db.transaction('records', 'readonly').objectStore('records').getAll();
   request.onsuccess = () => resolve(request.result.filter((row     ) => row.scope === JSON.stringify(['anonymous', 1]) && row.collection === 'things' && row.value.thingtime?.includes('webpage')).map((row     ) => row.value));
   request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
 });
 const scroll = async (bottom         ) => page.evaluate(async bottom => {
  const roots = [document.scrollingElement , ...[...document.querySelectorAll             ('body *')].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)];
  for (const root of roots) {
   assertHeight(root.scrollHeight);
   if (!bottom) root.scrollTop = 0;
   else for (let y = 0; y <= root.scrollHeight; y += Math.max(100, root.clientHeight / 2)) { root.scrollTop = y; await new Promise(requestAnimationFrame); }
  }
  function assertHeight(height        ) { if (height > 40_000) throw Error('Unexpected repeating page content'); }
 }, bottom);
 await mkdir(artifacts , { recursive: true });
 try {
  await page.goto(base + '/builder?page=__global__'); await open();
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  }, undefined, { timeout: 90_000 });
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
  await context.setOffline(true);
  await cdp.send('Network.overrideNetworkState', { offline: true, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-builder-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  for (const scope of ['global', 'site']) {
   await page.goto(base + (scope === 'global' ? '/builder?page=__global__' : '/builder?site=/ode')); await open();
   const frame = await add(null, 'column');
   const text = await add(frame, 'text'); await fillText(scope + ' initial nested text');
   const button = await add(frame, 'button'); await fillText(scope + ' initial button');
   const icon = await add(frame, 'button'); await page.getByLabel('Element tag', { exact: true }).fill('span'); await fillText('☆');
   const input = await add(frame, 'input');
   identities[scope] = { frame, text, button, icon, input };
   await save(); await page.reload(); await open();
   // Select siblings independently through the native inspector, not a JSON editor.
   await select(text); assert.equal(await page.getByLabel('Block text', { exact: true }).inputValue(), scope + ' initial nested text'); await fillText(scope + ' edited nested text');
   await select(button); assert.equal(await page.getByLabel('Block text', { exact: true }).inputValue(), scope + ' initial button'); await fillText(scope + ' edited button');
   await select(icon); assert.equal(await page.getByLabel('Block text', { exact: true }).inputValue(), '☆'); await fillText('★');
   await save(); await page.reload(); await open();
   for (const [id, expected] of [[text, scope + ' edited nested text'], [button, scope + ' edited button'], [icon, '★']]) {
    await select(id); assert.equal(await page.getByLabel('Block text', { exact: true }).inputValue(), expected);
   }
   const saved = (await pages()).find((row     ) => scope === 'global' ? row.crystal.pageKey === 'site-global' : row.crystal.siteRoute === '/ode');
   assert.ok(saved, scope + ' saved page exists');
   const nested = saved.crystal.blocks.find((block     ) => block.id === frame).children;
   assert.deepEqual(nested.map((block     ) => block.id), [text, button, icon, input]);
   assert.equal(nested[0].text, scope + ' edited nested text'); assert.equal(nested[1].tag, 'button'); assert.equal(nested[1].text, scope + ' edited button'); assert.equal(nested[2].tag, 'span'); assert.equal(nested[2].text, '★'); assert.equal(nested[3].tag, 'input');
   for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await select(button);
    await page.getByLabel('Block text', { exact: true }).focus(); await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
     const el = document.activeElement , r = el.getBoundingClientRect();
     const x = Math.max(0, r.left) + (Math.min(innerWidth, r.right) - Math.max(0, r.left)) / 2;
     const y = Math.max(0, r.top) + (Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / 2;
     const hit = document.elementFromPoint(x, y);
     return { tag: el.tagName, visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
      unobscured: !!hit && (hit === el || el.contains(hit)), rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
    });
    assert.ok(focus.visible, scope + ' keyboard focus visible');
    assert.ok(focus.unobscured, scope + ' keyboard focus not covered');
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth > innerWidth,
     containers: [...document.querySelectorAll             ('[data-testid="builder-drawer"], [data-testid="builder-drawer"] *')]
      .filter(el => /auto|scroll/.test(getComputedStyle(el).overflowX))
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ tag: el.tagName, label: el.getAttribute('aria-label'), width: el.clientWidth, scrollWidth: el.scrollWidth })) }));
    assert.equal(overflow.document, false, scope + ' inspector document overflow'); assert.deepEqual(overflow.containers, [], scope + ' inspector scroll-container overflow');
    await page.screenshot({ path: resolve(artifacts , `${scope}-inspector-${width}.png`) });
    await scroll(true); await page.screenshot({ path: resolve(artifacts , `${scope}-inspector-${width}-bottom.png`) }); await scroll(false);
    views.push({ scope, width, focus, overflow });
   }
   await page.setViewportSize({ width: 1440, height: 1000 });
   checks.push(scope + ': native nested text/button/icon independently edited and saved through two offline reloads');
  }
  await writeFile(resolve(artifacts , 'saved-pages.json'), JSON.stringify(await pages(), null, 2));
  await page.goto(base + '/ode');
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   for (const scope of ['global', 'site']) {
    await page.getByText(scope + ' edited nested text', { exact: true }).waitFor();
    await page.locator(`[data-block-id="${identities[scope].icon}"]`).filter({ hasText: '★' }).first().waitFor();
    const button = page.getByRole('button', { name: scope + ' edited button', exact: true }); await button.focus();
    assert.ok(await button.evaluate((el             ) => document.activeElement === el));
    const input = page.locator(`[data-block-id="${identities[scope].input}"] input, input[data-block-id="${identities[scope].input}"]`).first();
    await page.keyboard.press('Tab');
    assert.ok(await input.evaluate((el             ) => document.activeElement === el), scope + ' button-to-input keyboard navigation');
    await input.fill(scope + ' functional input'); assert.equal(await input.inputValue(), scope + ' functional input');
   }
   const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
   await scroll(false); await page.screenshot({ path: resolve(artifacts , `composed-${width}.png`) }); await scroll(true); await page.screenshot({ path: resolve(artifacts , `composed-${width}-bottom.png`) });
   views.push({ scope: 'native /ode composition', width, overflow });
  }
  checks.push('native /ode renders both saved scopes with button-to-input keyboard navigation and editable live inputs at desktop/390/320px; no Action execution or input-value persistence is claimed');
  assert.deepEqual(errors, []); assert.deepEqual(accountRequests, []);
  await writeFile(resolve(artifacts , 'verification.json'), JSON.stringify({ checks, identities, views, errors, accountRequests }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts , 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts , 'failure.txt'), await page.locator('body').innerText().catch(() => 'Unavailable'));
  throw error;
 } finally { await context.close(); await browser.close(); }
});
