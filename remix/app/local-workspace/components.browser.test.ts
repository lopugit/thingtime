import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
const base = process.env.TT_LOCAL_COMPONENTS_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_COMPONENTS_ARTIFACTS;
const enabled = !!base && !!playwrightPath;
async function launch() {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Disposable local fixtures only');
 const { chromium } = await import(playwrightPath!);
 return chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
}
const ready = async (page: any) => page.waitForFunction(async () => {
 await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
 for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
 return false;
});
const detail = '/components/demo-guestbook-reader?catalog=device';
async function edit(page: any, name: string, label: string) {
 await page.getByRole('textbox', { name: 'Button label', exact: true }).fill(label);
 const toggle = page.getByRole('button', { name: 'Save version to my Things', exact: true });
 if (await toggle.isVisible()) await toggle.click();
 await page.getByPlaceholder('Version name', { exact: true }).fill(name);
}
async function layout(page: any, surface: string, bounds: unknown[]) {
 for (const width of [1440, 390, 320]) {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.equal(size.width, size.scrollWidth, `${surface} horizontal overflow at ${width}`); bounds.push({ surface, ...size });
  if (artifacts) await page.screenshot({ path: resolve(artifacts, `${surface}-${width}.png`), fullPage: true });
 }
 await page.setViewportSize({ width: 1440, height: 1000 });
}
test('anonymous component catalogue, editable args, recovery and independent versions work offline', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const writes: string[] = [], errors: string[] = [], bounds: unknown[] = [];
 context.on('request', (request: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/components', base).href); assert.equal((await (await root).json()).user, null); await ready(page);
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await page.getByRole('link', { name: 'Guestbook reader · Guestbook demo', exact: true }).waitFor();
  await layout(page, 'component-catalogue', bounds);
  // Displaying a bundled definition does not create ownership or local Things.
  await page.getByRole('button', { name: 'Mine', exact: true }).click();
  await page.getByRole('link', { name: 'Guestbook reader · Guestbook demo', exact: true }).waitFor({ state: 'hidden' });
  await page.goto(new URL(detail, base).href);
  await edit(page, 'Offline component acceptance', 'Read my offline notes');
  await page.reload();
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[placeholder="Version name"]')?.value === 'Offline component acceptance');
  assert.equal(await page.getByRole('textbox', { name: 'Button label', exact: true }).inputValue(), 'Read my offline notes');
  assert.equal(await page.getByRole('button', { name: 'Read my offline notes', exact: true }).count(), 2, 'Both native render panes use the recovered arguments');
  await layout(page, 'component-editor', bounds);
  await page.getByRole('button', { name: 'Save on this device', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('demo-guestbook-reader')); const copyUrl = page.url();
  await page.getByText('Offline component acceptance', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Button label', exact: true }).inputValue(), 'Read my offline notes');
  await page.reload(); await page.getByRole('button', { name: 'Read my offline notes', exact: true }).first().waitFor();
  await page.goto(new URL(detail, base).href);
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label="Button label"]')?.value === 'Read the latest signatures');
  await page.goto(new URL('/components?catalog=device', base).href); await page.getByRole('button', { name: 'Mine', exact: true }).click();
  await page.getByRole('link', { name: 'Offline component acceptance', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Guestbook reader · Guestbook demo', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await page.getByRole('button', { name: 'In my library', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('link', { name: 'Offline component acceptance', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Args \(1\)/ }).click();
  await page.getByRole('textbox', { name: 'Button label', exact: true }).fill('Card draft argument');
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await page.getByPlaceholder('Version name').fill('Independent grid version');
  await page.reload(); await page.getByPlaceholder('Version name').waitFor();
  assert.equal(await page.getByPlaceholder('Version name').inputValue(), 'Independent grid version');
  assert.equal(await page.getByRole('textbox', { name: 'Button label', exact: true }).inputValue(), 'Card draft argument');
  await layout(page, 'component-card-editor', bounds);
  await page.getByRole('button', { name: 'Save to my Things', exact: true }).click();
  await page.getByPlaceholder('Version name').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Mine', exact: true }).click();
  await page.getByRole('link', { name: 'Independent grid version', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Offline component acceptance', exact: true }).count(), 1);
  await page.getByRole('link', { name: 'Independent grid version', exact: true }).click();
  await page.getByRole('button', { name: 'Card draft argument', exact: true }).first().waitFor();
  assert.notEqual(page.url(), copyUrl);
  await page.goto(copyUrl); await page.getByRole('button', { name: 'Read my offline notes', exact: true }).first().waitFor();
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'anonymous-verification.json'), JSON.stringify({ anonymous: true, offlineProbe: true, nativeArgumentRendering: true, draftRecovery: true, cardDraftRecovery: true, independentCopies: true, originalUnchanged: true, libraryMembership: true, copyUrl, bounds, writes, errors }, null, 2));
 } catch (error) {
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'anonymous-failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'anonymous-failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), writes, errors }, null, 2)); } throw error;
 } finally { await browser.close(); }
});
test('account component versions complete and sync while draft writes never finish', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const headers = { Origin: new URL(base!).origin }, ids: string[] = [], errors: string[] = []; let stalled = 0;
 const username = `componentqa-${randomUUID().slice(0, 8)}`;
 try {
  const registration = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username, email: `${username}@example.test`, password: randomUUID() + randomUUID() } }); assert.equal(registration.status(), 200);
  await context.route('**/api/v1/drafts*', route => { if (route.request().method() === 'POST') { stalled++; return new Promise(() => {}); } return route.continue(); });
  page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.goto(new URL(detail, base).href); await ready(page);
  await edit(page, 'Account draft-independent component', 'Independent content completion');
  await page.getByRole('button', { name: 'Save with this audience', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('demo-guestbook-reader'));
  const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!); ids.push(id);
  await page.getByRole('button', { name: 'Independent content completion', exact: true }).first().waitFor();
  assert.ok(stalled > 0);
  await page.waitForFunction(async id => { const response = await fetch(`/api/v1/things?id=${encodeURIComponent(id)}`); const value = await response.json(); return response.ok && value.ok && !!value.thing; }, id);
  const response = await context.request.get(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href); const content = (await response.json()).thing;
  assert.equal(content.author.username, username); assert.equal(content.crystal.savedArgs.label, 'Independent content completion'); assert.equal(content.crystal.forkOf, 'component-demo-guestbook-reader');
  const localUrl = page.url();
  await page.goto(new URL(`/components/demo-guestbook-reader?catalog=online&design=${id}`, base).href);
  await page.getByRole('button', { name: 'Independent content completion', exact: true }).first().waitFor();
  await context.route('**/api/v1/components/browse*', route => route.abort('failed'));
  await page.reload(); await page.getByRole('button', { name: 'Retry component', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Independent content completion', exact: true }).first().waitFor();
  await context.unroute('**/api/v1/components/browse*');
  await page.getByRole('button', { name: 'Retry component', exact: true }).click();
  await page.getByRole('button', { name: 'Retry component', exact: true }).waitFor({ state: 'hidden' });
  await page.goto(localUrl);
  await context.setOffline(true); await page.reload(); await page.getByRole('button', { name: 'Independent content completion', exact: true }).first().waitFor();
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  assert.deepEqual(errors, []);
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'account-draft-independent.png'), fullPage: true }); await writeFile(resolve(artifacts, 'account-verification.json'), JSON.stringify({ stalledDraftRequests: stalled, componentCreated: true, synced: true, offlineReload: true, failedRefreshRetainsPreview: true, errors }, null, 2)); }
 } finally {
  await context.setOffline(false); await context.unrouteAll({ behavior: 'ignoreErrors' });
  for (const id of ids.reverse()) await context.request.delete(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href, { headers });
  await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers }); await browser.close();
 }
});
