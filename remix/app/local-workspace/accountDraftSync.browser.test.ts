import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_LOCAL_ACCOUNT_DRAFTS_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_ACCOUNT_DRAFTS_ARTIFACTS;

test('native account drafts survive offline reload and post and draft sync failures stay independent', {
 skip: !base || !playwrightPath, timeout: 300_000
}, async () => {
 assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
 const health = await (await fetch(new URL('/api/v1/health/nitro', base!), { redirect: 'error' })).json();
 assert.ok(process.env.TT_RENDER_SESSION, 'Use the disposable isolated browser runtime.');
 assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const guest = await browser.newContext(), page = await context.newPage();
 const url = (path: string) => new URL(path, base).href, headers = { Origin: new URL(base!).origin };
 const errors: string[] = [], offlineWrites: string[] = [], routeErrors: string[] = [];
 const responses: { path: string; status: number }[] = [];
 const heldResponses: Promise<unknown>[] = [];
 const composerPostRequests: any[] = [];
 const postRequests: any[] = [], postFailures: string[] = [], postStatuses: number[] = [];
 const blockedPostText = 'Pending private post ' + randomUUID();
 const independentDraftText = 'Draft survives a pending post ' + randomUUID();
 let offline = false, failedDraftWrites = 0, failedPostWrites = 0, postId = '', reversePostId = '', independentDraftId = '', ownerId = '';
 const network = await context.newCDPSession(page);
 const connectivity = async (value: boolean) => {
  offline = value;
  await context.setOffline(value);
  // The OS fixture intentionally has loopback only. Explicitly model the
  // browser's online signal as well as transport; no external route is added.
  await network.send('Network.overrideNetworkState', { offline: value, latency: 1,
   downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
  assert.equal(await page.evaluate(() => navigator.onLine), !value);
 };
 let releaseDraft!: () => void; const draftGate = new Promise<void>(resolve => { releaseDraft = resolve; });
 let releasePost!: () => void; const postGate = new Promise<void>(resolve => { releasePost = resolve; });
 const isBlockedPost = (request: any) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/things' && request.postDataJSON()?.crystal?.text === blockedPostText;
 page.setDefaultTimeout(25_000);
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('response', (response: any) => {
  const path = new URL(response.url()).pathname;
  if (['/api/root-data', '/api/v1/drafts', '/api/v1/things'].includes(path)) responses.push({ path, status: response.status() });
  if (isBlockedPost(response.request())) postStatuses.push(response.status());
 });
 page.on('request', (request: any) => {
  if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname);
  if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/things') composerPostRequests.push(request.postDataJSON());
  if (isBlockedPost(request)) postRequests.push(request.postDataJSON());
 });
 page.on('requestfailed', (request: any) => { if (isBlockedPost(request)) postFailures.push(request.failure()?.errorText || 'Request failed'); });
 // Use Chromium's normal secure-loopback cookie policy. Playwright's separate
 // APIRequestContext does not send a Secure session cookie to HTTP loopback.
 const api = async (method: string, path: string, data?: unknown) => {
  const result = await page.evaluate(async ({ method, path, data, ownerId }) => {
   const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
    headers: { 'X-Thingtime-Expected-Actor': ownerId, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
   return { status: response.status, body: await response.text() };
  }, { method, path, data, ownerId });
  return { status: () => result.status, text: async () => result.body, json: async () => JSON.parse(result.body) };
 };
 const poll = async (read: () => Promise<any>, accept: (value: any) => boolean, attempts = 100) => {
  let last: any;
  for (let attempt = 0; attempt < attempts; attempt++) {
   const value = last = await read(); if (accept(value)) return value;
   await page.waitForTimeout(400);
  }
  throw Error('The account did not converge within the bounded retry window: ' + JSON.stringify(last));
 };
 try {
  await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const username = 'draftqa-' + randomUUID().slice(0, 8);
  const registration = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registration.status(), 200, await registration.text());
  const owner = (await registration.json()).user;
  ownerId = owner.id;
  await page.goto(url('/feed'));
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  });
  await connectivity(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await page.reload();
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
  await connectivity(false); await page.reload();
  const drafts = await poll(async () => (await api('GET', '/api/v1/drafts')).json(), value => value.drafts?.some((row: any) => row.name.includes('My native draft')));
  const draftId = drafts.drafts.find((row: any) => row.name.includes('My native draft')).id;
  const canonical = await (await api('GET', '/api/v1/drafts?id=' + draftId)).json();
  assert.match(canonical.draft.snapshot, /My native draft survives an offline restart/);
  assert.equal((await guest.request.get(url('/api/v1/drafts?id=' + draftId))).status(), 401);
  assert.equal((await guest.request.get(url('/api/v1/things?id=' + draftId))).status(), 404);
  const templateId = randomUUID(), writeId = randomUUID();
  const template = { operation: 'save', expectedActor: owner.id, id: templateId, writeId, revision: 0, mode: 'template', content: { name: 'Offline reusable template', surface: 'post', context: canonical.draft.context, snapshot: canonical.draft.snapshot, attachmentIds: [] } };
  const created = await api('POST', '/api/v1/drafts', template);
  assert.equal(created.status(), 200, await created.text());
  const retry = await api('POST', '/api/v1/drafts', template);
  assert.equal(retry.status(), 200, await retry.text());
  assert.equal((await retry.json()).draft.revision, (await created.json()).draft.revision);
  const changed = await api('POST', '/api/v1/drafts', { ...template, revision: 1, writeId: randomUUID(), content: { ...template.content, name: 'Must not replace template' } });
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
  // This final edit intentionally races the autosave debounce. The native
  // composer must publish its live Editor.js snapshot, independently of the held save.
  const immediate = ' Final immediate edit.';
  await page.locator('.ce-paragraph[contenteditable="true"]').first().press('End');
  await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(immediate);
  await page.getByRole('button', { name: 'Post ✨', exact: true }).click();
  const card = page.locator('[data-thing-id]').filter({ hasText: text + suffix + immediate }).first();
  await card.waitFor(); postId = await card.getAttribute('data-thing-id'); assert.ok(postId);
  const published = await poll(async () => (await api('GET', '/api/v1/things?id=' + postId)).json(), value => value.thing?.id === postId, 20);
  assert.equal(published.thing.crystal.text, text + suffix + immediate);
  const firstWrites = composerPostRequests.filter(row => row.shareId === postId);
  assert.equal(firstWrites.length, 1);
  assert.deepEqual(published.thing.crystal.richText, firstWrites[0].crystal.richText, 'exact remote readback preserves the live editor document'); assert.deepEqual(published.thing.acl, ['tt:user']);
  assert.equal((await guest.request.get(url('/api/v1/things?id=' + postId))).status(), 404);
  releaseDraft(); await Promise.all(heldResponses);
  await poll(async () => responses, rows => rows.some((row: any) => row.path === '/api/v1/drafts' && row.status === 503));
  await page.unroute('**/api/v1/drafts'); await page.reload();
  // Reload can retire a worker with its durable 60-second claim still live.
  // Wait through that existing lease before expecting remote draft retirement.
  await poll(async () => (await api('GET', '/api/v1/drafts?id=' + draftId)).status(), value => value === 404, 225);
  assert.equal((await api('GET', '/api/v1/drafts?id=' + templateId)).status(), 200);

  // Reverse direction: only this newly authored private post is held. The
  // normal composer must start and synchronize another working draft meanwhile.
  await page.route('**/api/v1/things', async (route: any) => {
   if (!isBlockedPost(route.request())) return route.continue();
   failedPostWrites++;
   const response = postGate.then(() => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture post sync failure' }) })).catch((error: Error) => { routeErrors.push(error.message); });
   heldResponses.push(response); await response;
  });
  if (await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).count()) await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).click();
  await page.getByLabel('Who can see this post', { exact: true }).selectOption('private');
  const editor = page.locator('.ce-paragraph[contenteditable="true"]').first();
  await editor.press('ControlOrMeta+A'); await editor.pressSequentially(blockedPostText);
  await page.getByText('Draft saved on this device ✓', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Post ✨', exact: true }).click();
  const pendingCard = page.locator('[data-thing-id]').filter({ hasText: blockedPostText }).first();
  await pendingCard.waitFor(); reversePostId = await pendingCard.getAttribute('data-thing-id'); assert.ok(reversePostId);
  await poll(async () => failedPostWrites, value => value > 0, 20);
  assert.equal(postRequests[0].shareId, reversePostId);
  assert.deepEqual(postRequests[0].acl, ['tt:user']);
  if (await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).count()) await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).click();
  await page.getByLabel('Who can see this post', { exact: true }).selectOption('private');
  await editor.press('ControlOrMeta+A'); await editor.pressSequentially(independentDraftText);
  await page.getByText('Draft saved on this device ✓', { exact: true }).first().waitFor();
  const independentDrafts = await poll(async () => (await api('GET', '/api/v1/drafts')).json(),
   value => value.drafts?.some((row: any) => row.name === independentDraftText), 20);
  independentDraftId = independentDrafts.drafts.find((row: any) => row.name === independentDraftText).id;
  const savedIndependentDraft = await (await api('GET', '/api/v1/drafts?id=' + independentDraftId)).json();
  assert.ok(savedIndependentDraft.draft.snapshot.includes(independentDraftText));
  assert.notEqual(independentDraftId, draftId);
  assert.equal((await api('GET', '/api/v1/things?id=' + reversePostId)).status(), 404);
  assert.deepEqual(postStatuses, []); assert.deepEqual(postFailures, []);
  assert.equal((await guest.request.get(url('/api/v1/drafts?id=' + independentDraftId))).status(), 401);
  assert.equal((await guest.request.get(url('/api/v1/things?id=' + independentDraftId))).status(), 404);
  if (artifacts) await page.screenshot({ path: resolve(artifacts, 'draft-synced-post-pending.png'), animations: 'disabled' });
  releasePost(); await Promise.all(heldResponses);
  await poll(async () => postStatuses, value => value.includes(503), 20);
  await page.unroute('**/api/v1/things');
  // Allow the ordinary scheduler to retry its frozen write; a surviving durable
  // claim can take 60 seconds after retirement, so keep this wait bounded at 90.
  const retriedPost = await poll(async () => (await api('GET', '/api/v1/things?id=' + reversePostId)).json(),
   value => value.thing?.id === reversePostId, 225);
  assert.equal(retriedPost.thing.crystal.text, blockedPostText);
  assert.deepEqual(retriedPost.thing.acl, ['tt:user']); assert.equal(retriedPost.thing.author.id, ownerId);
  assert.ok(postRequests.length >= 2);
  for (const request of postRequests) assert.deepEqual(request, postRequests[0]);
  const remotePosts = await (await api('GET', '/api/v1/things?thingtime=post&limit=200')).json();
  assert.equal(remotePosts.nextCursor, null);
  assert.equal(composerPostRequests.filter(row => row.shareId === postId).length, 1, 'late draft failure and reload cannot duplicate the first post');
  assert.deepEqual(remotePosts.things.filter((row: any) => row.crystal.text === text + suffix + immediate).map((row: any) => row.id), [postId]);
  assert.deepEqual(remotePosts.things.filter((row: any) => row.crystal.text === blockedPostText).map((row: any) => row.id), [reversePostId]);
  assert.equal((await guest.request.get(url('/api/v1/things?id=' + reversePostId))).status(), 404);
  await poll(() => editor.innerText(), value => value === independentDraftText);
  const preservedDraft = await (await api('GET', '/api/v1/drafts?id=' + independentDraftId)).json();
  assert.equal(preservedDraft.draft.snapshot, savedIndependentDraft.draft.snapshot);
  await page.reload();
  if (await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).count()) await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).click();
  await poll(() => editor.innerText(), value => value === independentDraftText);
  if (artifacts) await page.screenshot({ path: resolve(artifacts, 'post-retried-draft-preserved.png'), animations: 'disabled' });
  assert.deepEqual(errors, []); assert.deepEqual(routeErrors, []); assert.deepEqual(offlineWrites, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ offlineReload: true, privateDraftSync: true, immutableTemplateRetry: true, failedDraftWrites, independentPrivatePost: postId, postSyncedBeforeDraftReleased: true, latestImmediateEditorSnapshot: true, exactRichTextReadback: true, exactlyOneFirstPost: true, retirementConverged: true, templatePreserved: true, failedPostWrites, reversePostId, independentDraftId, draftSyncedBeforePostReleased: true, postRetrySameIdentity: true, postAttempts: postRequests.length, exactlyOneRetriedPost: true, workingDraftPreservedAfterPostRetryAndReload: true, postStatuses, postFailures, viewports: [1440, 390, 320], errors, offlineWrites }, null, 2));
 } catch (error) {
  if (artifacts) {
   await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
   await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText().catch(() => ''), browserOnline: await page.evaluate(() => navigator.onLine).catch(() => null), errors, offlineWrites, failedDraftWrites, failedPostWrites, reversePostId, independentDraftId, postRequests, postStatuses, postFailures, routeErrors, responses }, null, 2));
  }
  throw error;
 } finally {
  releaseDraft(); releasePost(); await Promise.all(heldResponses); await page.unroute('**/api/v1/things').catch(() => {}); await context.setOffline(false).catch(() => {});
  if (postId) await api('DELETE', '/api/v1/things', { id: postId }).catch(() => {});
  if (reversePostId) await api('DELETE', '/api/v1/things', { id: reversePostId }).catch(() => {});
  await browser.close();
 }
});
