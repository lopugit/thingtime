import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_LOCAL_ACCOUNT_DRAFTS_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_ACCOUNT_DRAFTS_ARTIFACTS;

test('native account drafts survive offline reload and draft sync failures never block posting', {
 skip: !base || !playwrightPath, timeout: 180_000
}, async () => {
 assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const guest = await browser.newContext(), page = await context.newPage();
 const url = (path: string) => new URL(path, base).href, headers = { Origin: new URL(base!).origin };
 const errors: string[] = [], offlineWrites: string[] = [], routeErrors: string[] = [];
 const heldResponses: Promise<unknown>[] = [];
 let offline = false, failedDraftWrites = 0, postId = '';
 let releaseDraft!: () => void; const draftGate = new Promise<void>(resolve => { releaseDraft = resolve; });
 page.setDefaultTimeout(25_000);
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => {
  if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname);
 });
 const poll = async (read: () => Promise<any>, accept: (value: any) => boolean, attempts = 100) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
   const value = await read(); if (accept(value)) return value;
   await page.waitForTimeout(400);
  }
  throw Error('The account did not converge within 40 seconds');
 };
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const username = 'draftqa-' + randomUUID().slice(0, 8);
  const registration = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registration.status(), 200, await registration.text());
  const owner = (await registration.json()).user;
  await page.goto(url('/feed'));
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  });
  offline = true; await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).click();
  const text = 'My native draft survives an offline restart.';
  await page.getByLabel('Who can see this post', { exact: true }).selectOption('private');
  await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(text);
  await page.getByText('Draft saved on this device ✓', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Load drafts & templates', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Your drafts & templates' });
  await dialog.getByRole('button', { name: /My native draft survives/ }).waitFor();
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await page.evaluate(async () => { await document.fonts.ready; });
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `draft-picker-${width}.png`), animations: 'disabled' });
  }
  await page.reload();
  if (await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).count()) await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).click();
  await poll(() => page.locator('.ce-paragraph[contenteditable="true"]').first().innerText(), value => value === text);
  assert.deepEqual(offlineWrites, []);
  offline = false; await context.setOffline(false); await page.reload();
  const drafts = await poll(async () => (await context.request.get(url('/api/v1/drafts'))).json(), value => value.drafts?.some((row: any) => row.name.includes('My native draft')));
  const draftId = drafts.drafts.find((row: any) => row.name.includes('My native draft')).id;
  const canonical = await (await context.request.get(url('/api/v1/drafts?id=' + draftId))).json();
  assert.match(canonical.draft.snapshot, /My native draft survives an offline restart/);
  assert.equal((await guest.request.get(url('/api/v1/drafts?id=' + draftId))).status(), 401);
  assert.equal((await guest.request.get(url('/api/v1/things?id=' + draftId))).status(), 404);
  const templateId = randomUUID(), writeId = randomUUID();
  const template = { operation: 'save', expectedActor: owner.id, id: templateId, writeId, revision: 0, mode: 'template', content: { name: 'Offline reusable template', surface: 'post', context: canonical.draft.context, snapshot: canonical.draft.snapshot, attachmentIds: [] } };
  const created = await context.request.post(url('/api/v1/drafts'), { headers, data: template });
  assert.equal(created.status(), 200, await created.text());
  const retry = await context.request.post(url('/api/v1/drafts'), { headers, data: template });
  assert.equal(retry.status(), 200, await retry.text());
  assert.equal((await retry.json()).draft.revision, (await created.json()).draft.revision);
  const changed = await context.request.post(url('/api/v1/drafts'), { headers, data: { ...template, revision: 1, writeId: randomUUID(), content: { ...template.content, name: 'Must not replace template' } } });
  assert.equal(changed.status(), 409, await changed.text());
  await page.route('**/api/v1/drafts', async (route: any) => {
   if (route.request().method() !== 'POST') return route.continue();
   failedDraftWrites++;
   const response = draftGate.then(() => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture draft sync failure' }) })).catch((error: Error) => { routeErrors.push(error.message); });
   heldResponses.push(response); await response;
  });
  if (await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).count()) await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).click();
  await poll(() => page.locator('.ce-paragraph[contenteditable="true"]').first().innerText(), value => value === text);
  const suffix = ' Posting works while draft sync fails.';
  await page.locator('.ce-paragraph[contenteditable="true"]').first().press('ControlOrMeta+A');
  await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(text + suffix);
  await page.getByText('Draft saved on this device ✓', { exact: true }).first().waitFor();
  await poll(async () => failedDraftWrites, value => value > 0);
  await page.getByRole('button', { name: 'Post ✨', exact: true }).click();
  const card = page.locator('[data-thing-id]').filter({ hasText: text + suffix }).first();
  await card.waitFor(); postId = await card.getAttribute('data-thing-id'); assert.ok(postId);
  const published = await poll(async () => (await context.request.get(url('/api/v1/things?id=' + postId))).json(), value => value.thing?.id === postId, 20);
  assert.equal(published.thing.crystal.text, text + suffix); assert.deepEqual(published.thing.acl, ['tt:user']);
  assert.equal((await guest.request.get(url('/api/v1/things?id=' + postId))).status(), 404);
  releaseDraft(); await Promise.all(heldResponses); await page.unroute('**/api/v1/drafts'); await page.reload();
  await poll(async () => (await context.request.get(url('/api/v1/drafts?id=' + draftId))).status(), value => value === 404);
  assert.equal((await context.request.get(url('/api/v1/drafts?id=' + templateId))).status(), 200);
  assert.deepEqual(errors, []); assert.deepEqual(routeErrors, []); assert.deepEqual(offlineWrites, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ offlineReload: true, privateDraftSync: true, immutableTemplateRetry: true, failedDraftWrites, independentPrivatePost: postId, postSyncedBeforeDraftReleased: true, retirementConverged: true, templatePreserved: true, viewports: [1440, 390, 320], errors, offlineWrites }, null, 2));
 } catch (error) {
  if (artifacts) {
   await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
   await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText().catch(() => ''), errors, offlineWrites, failedDraftWrites, routeErrors }, null, 2));
  }
  throw error;
 } finally {
  releaseDraft(); await Promise.all(heldResponses); await context.setOffline(false).catch(() => {});
  if (postId) await context.request.delete(url('/api/v1/things'), { headers, data: { id: postId } }).catch(() => {});
  await browser.close();
 }
});
