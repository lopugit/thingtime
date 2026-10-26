import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

const base = process.env.TT_LOCAL_INSTRUCTIONS_URL;
const artifacts = process.env.TT_LOCAL_INSTRUCTIONS_ARTIFACTS;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

test('native account instructions save offline and reconcile lost replies and reviewed conflicts independently', {
 skip: !base || !artifacts || !playwrightPath, timeout: 360_000
}, async t => {
 assert.equal(new URL(base!).hostname, '127.0.0.1');
 assert.ok(process.env.TT_RENDER_SESSION);
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
 const manifest = await (await fetch(base + '/.well-known/thingtime-capabilities.json')).json();
 assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.origin, base);
 assert.ok(capabilitySatisfies(manifest.features?.['api.settings-lopu-prompt']?.version, '1.1.0'));
 await mkdir(artifacts!, { recursive: true });
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 t.after(() => browser.close());
 // This disposable context uses only synthetic clipboard text. The native
 // paste path retains browser undo; CDP insertText (locator.fill) has a
 // separate Chromium many-hard-line insertion bottleneck even on a blank page.
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
 const guest = await browser.newContext(), page = await context.newPage();
 const network = await context.newCDPSession(page);
 const errors: string[] = [], offlineWrites: string[] = [], checks: string[] = [], writes: any[] = [], viewports: unknown[] = [];
 const instructionRequests: { method: string; bytes: number }[] = [];
 let capacityProof: unknown;
 let phase = 'account setup and prior instruction regressions';
 let offline = false, ownerId = '', hold = false, heldReceipt: any;
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 t.after(release);
 page.setDefaultTimeout(30_000);
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => {
  if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname);
  if (new URL(request.url()).pathname === '/api/v1/settings/lopu-prompt' && !request.headers()['x-thingtime-fixture-readback'])
   instructionRequests.push({ method: request.method(), bytes: Buffer.byteLength(request.postData() || '', 'utf8') });
 });
 const connectivity = async (value: boolean) => {
  if (!value) offline = false;
  await context.setOffline(value);
  await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
  assert.equal(await page.evaluate(() => navigator.onLine), !value);
  offline = value;
 };
 const api = async (method: string, data?: unknown) => page.evaluate(async ({ method, data, ownerId }) => {
  const response = await fetch('/api/v1/settings/lopu-prompt', { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
   headers: { 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Fixture-Readback': '1', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
   ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() };
 }, { method, data, ownerId });
 const poll = async (read: () => Promise<any>, accept: (value: any) => boolean) => {
  let last: any;
  for (let attempt = 0; attempt < 100; attempt++) {
   last = await read(); if (accept(last)) return last;
   await page.waitForTimeout(300);
  }
  throw new Error('Instructions did not converge: ' + JSON.stringify(last));
 };
 const editor = page.locator('#lopu-instructions');
 const save = async () => {
  await editor.getByRole('button', { name: 'Save instructions', exact: true }).click();
  // The Saving… state is also disabled. Wait for the completed local receipt,
  // rather than treating the start of an asynchronous save as completion.
  await poll(async () => {
   const button = editor.getByRole('button', { name: 'Save instructions', exact: true });
   return await button.isVisible() && await button.isDisabled();
  }, value => value === true);
 };
 const inSync = () => editor.getByRole('status').filter({ hasText: 'Device and account instructions are in sync.' }).waitFor({ timeout: 90_000 });
 try {
  await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 2000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
  const username = 'instructions-' + randomUUID().slice(0, 8);
  const registered = await context.request.post(base + '/api/v1/auth/register', { headers: { Origin: base! }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registered.status(), 200, 'Synthetic registration failed; authentication response intentionally omitted.');
  ownerId = (await registered.json()).user.id;
  // Runtime status polling can keep the network busy after the editor is
  // hydrated. Wait for the actual Settings controls, then verify account sync
  // and the complete offline shell independently before disconnecting.
  await page.goto(base + '/settings/lopu#lopu-instructions', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await editor.getByRole('button', { name: 'Add instruction', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await poll(() => editor.getByRole('button', { name: 'Add instruction', exact: true }).isEnabled(), value => value === true);
  await editor.getByRole('button', { name: 'Save instructions', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await connectivity(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await inSync();
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  }, undefined, { timeout: 90_000 });
  await connectivity(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await editor.getByRole('button', { name: 'Add instruction', exact: true }).click();
  const original = 'Keep my exact wording.\nMy offline work completes locally — 日本語.';
  await editor.getByLabel('Instruction 1', { exact: true }).fill(original);
  await editor.getByRole('button', { name: 'Add instruction', exact: true }).click();
  await editor.getByLabel('Instruction 2', { exact: true }).fill('Keep this disabled preference.');
  await editor.locator('label').filter({ has: page.locator('input[aria-label="Enable instruction 2"]') }).click();
  assert.equal(await editor.getByLabel('Enable instruction 2', { exact: true }).isChecked(), false);
  await save();
  await editor.getByRole('status').filter({ hasText: 'Saved on this device.' }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll(() => editor.getByLabel('Instruction 1', { exact: true }).inputValue(), value => value === original);
  assert.equal(await editor.getByLabel('Enable instruction 2', { exact: true }).isChecked(), false);
  checks.push('offline normal settings save and cold reload retain exact Unicode and disabled rows');
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await editor.scrollIntoViewIfNeeded();
   await page.evaluate(async () => { await document.fonts.ready; });
   const bounds = await editor.evaluate((element: HTMLElement) => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
   assert.equal(bounds.scrollWidth, width); assert.ok(bounds.left >= 0 && bounds.right <= width);
   viewports.push(bounds);
   await page.screenshot({ path: resolve(artifacts!, `instructions-offline-${width}.png`), animations: 'disabled' });
  }
  assert.deepEqual(offlineWrites, []);
  await page.route('**/api/v1/settings/lopu-prompt', async (route: any) => {
   const request = route.request();
   if (request.method() !== 'POST' || request.headers()['x-thingtime-fixture-readback']) return route.continue();
   writes.push(request.postDataJSON());
   if (!hold) return route.continue();
   hold = false;
   const response = await route.fetch();
   assert.equal(response.status(), 200);
   heldReceipt = await response.json();
   await gate;
   await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture lost save reply' }) });
  });
  hold = true;
  await connectivity(false);
  await poll(async () => heldReceipt, value => value?.personal?.instructions?.[0]?.text === original);
  const newer = original + '\nA newer device edit survives the lost reply.';
  await editor.getByLabel('Instruction 1', { exact: true }).fill(newer);
  await save();
  assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).inputValue(), newer);
  release();
  await inSync();
  const saved = await api('GET');
  assert.equal(saved.status, 200); assert.equal(saved.cache, 'no-store');
  assert.equal(saved.body.personal.instructions[0].text, newer);
  assert.equal(saved.body.personal.instructions[1].enabled, false);
  assert.equal(writes.filter(body => body.instructions[0].text === original).length, 1);
  assert.equal(writes.filter(body => body.instructions[0].text === newer).length, 1);
  checks.push('server commits before a lost reply; newer local save completes while reply is held; read acknowledgement avoids duplicate replay');

  for (const choice of ['device', 'account'] as const) {
   const before = await api('GET');
   const remoteText = `Independent account change for ${choice}`;
   const remoteRows = before.body.personal.instructions.map((row: any, index: number) => index ? row : { ...row, text: remoteText });
   const changed = await api('POST', { scope: 'personal', revision: before.body.personal.revision, instructions: remoteRows });
   assert.equal(changed.status, 200);
   const deviceText = `Retain my saved device choice for ${choice}`;
   await editor.getByLabel('Instruction 1', { exact: true }).fill(deviceText); await save();
   await editor.getByRole('status').filter({ hasText: 'Account instructions changed.' }).waitFor();
   assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).inputValue(), deviceText);
   await editor.getByText('Compare account instructions', { exact: true }).click();
   await editor.getByText('Enabled: ' + remoteText, { exact: true }).waitFor();
   const priorWrites = writes.length;
   await editor.getByRole('button', { name: choice === 'device' ? 'Use saved device version' : 'Use account version', exact: true }).click();
   await inSync();
   const expected = choice === 'device' ? deviceText : remoteText;
   assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).inputValue(), expected);
   assert.equal((await api('GET')).body.personal.instructions[0].text, expected);
   assert.equal(writes.length - priorWrites, choice === 'device' ? 1 : 0);
   checks.push(`explicit ${choice} conflict choice preserves the reviewed revision and exact content`);
  }

  // Save through the ordinary editor; the independent account read must keep
  // its prior value while the device retains this larger, unsynchronized edit.
  const beforeCapacity = (await api('GET')).body.personal;
  phase = 'oversized Settings input readiness';
  const paragraph = 'Native capacity fixture — 日本語 🌟 "quoted" \\ exact wording.\n' +
   'Keep this saved instruction editable, private, and available offline. '.repeat(1700) + 'End of the exact device preference.';
  const hardLinePayload = ['Native capacity fixture', ...Array(12_000).fill('🌟漢"' + String.fromCharCode(92)), 'End of exact preference.'].join('\n');
  const suffix = ' Edited after paste.';
  const oversized = hardLinePayload + suffix;
  const oversizedUtf8Bytes = Buffer.byteLength(oversized, 'utf8');
  assert.ok(oversizedUtf8Bytes > 96 * 1024); assert.equal(oversized.split('\n').length, 12_002);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const capacityInput = editor.getByLabel('Instruction 1', { exact: true });
  const capacityEquals = (text: string) => capacityInput.evaluate((element: HTMLTextAreaElement, expected: string) => element.value === expected, text);
  await capacityInput.waitFor({ state: 'visible', timeout: 30_000 });
  await poll(() => capacityInput.isEditable(), value => value === true);
  await capacityInput.scrollIntoViewIfNeeded(); await capacityInput.click();
  const inputReadiness = await capacityInput.evaluate((element: HTMLTextAreaElement) => {
   const box = element.getBoundingClientRect();
   return { disabled: element.disabled, readOnly: element.readOnly, focused: document.activeElement === element,
    width: box.width, height: box.height, previousCharacters: element.value.length };
  });
  assert.equal(inputReadiness.disabled, false); assert.equal(inputReadiness.readOnly, false); assert.equal(inputReadiness.focused, true);
  await writeFile(resolve(artifacts!, 'capacity-input-readiness.json'), JSON.stringify({ ...inputReadiness, oversizedUtf8Bytes, hardLines: oversized.split('\n').length }, null, 2));
  await page.screenshot({ path: resolve(artifacts!, 'instructions-capacity-before-input.png'), animations: 'disabled' });
  phase = 'oversized paragraph Settings save';
  const guidance = editor.getByRole('status').filter({ hasText: 'Account sync supports requests up to 96 KiB.' });
  try { await capacityInput.fill(paragraph, { timeout: 30_000 }); }
  catch (error) {
   // Playwright otherwise repeats the complete synthetic payload in its call
   // log. Keep the action failure and readiness evidence bounded and useful.
   throw new Error('Oversized Settings input failed after enabled/editable/focus checks: ' + String(error).split('\n')[0].slice(0, 300));
  }
  await save();
  await guidance.waitFor();
  assert.equal(await capacityEquals(paragraph), true, 'the long paragraph is saved exactly');

  phase = '12000-hard-line native paste and undo';
  await page.evaluate(text => navigator.clipboard.writeText(text), hardLinePayload);
  await capacityInput.click(); await capacityInput.press('Control+A');
  const pasteStarted = Date.now();
  await capacityInput.press('Control+V', { timeout: 5000 });
  assert.equal(await capacityEquals(hardLinePayload), true, 'native paste preserves every hard line');
  const pasteMs = Date.now() - pasteStarted;
  assert.ok(pasteMs < 5000, `Native multiline paste took ${pasteMs} ms`);
  await capacityInput.press('Control+Z'); assert.equal(await capacityEquals(paragraph), true, 'native undo restores the preceding complete instruction');
  await capacityInput.press('Control+Shift+Z'); assert.equal(await capacityEquals(hardLinePayload), true, 'native redo restores every hard line');
  await capacityInput.press('Control+End'); await page.keyboard.type(suffix);
  assert.equal(await capacityEquals(oversized), true, 'normal typing remains editable after the bulk paste');
  phase = '12000-hard-line local Settings save';
  const saveStarted = Date.now(); await save(); const localSaveMs = Date.now() - saveStarted;
  assert.ok(localSaveMs < 5000, `Local multiline save took ${localSaveMs} ms`);
  assert.equal(await page.locator('.lopuToast').filter({ hasText: 'Lopu instructions saved on this device' }).count(), 1,
   'consecutive paragraph and multiline saves must update one visible success notification');
  await guidance.waitFor();
  assert.match(await guidance.innerText(), /saved on this device.*Shorten the instructions/);
  assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).evaluate((element: HTMLTextAreaElement, expected: string) => element.value === expected, oversized), true);
  assert.equal(JSON.stringify((await api('GET')).body.personal) === JSON.stringify(beforeCapacity), true, 'oversized device edit must not replace account content');
  assert.ok(instructionRequests.every(request => request.method !== 'POST' || request.bytes <= 96 * 1024), 'no oversized POST may be sent');

  phase = 'oversized status responsive layout';
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await page.evaluate(async () => { await document.fonts.ready; });
   // Scroll the page's real containers through their entire range. Textarea
   // content has its own intentional scrolling and is not a page overflow.
   for (const bottom of [false, true]) {
    await page.evaluate(async (bottom: boolean) => {
     const roots = [...new Set([document.scrollingElement!, ...[...document.querySelectorAll<HTMLElement>('body *')]
      .filter(element => !element.matches('textarea,input,select') && /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)])];
     for (const root of roots) {
      if (root.scrollHeight > 40_000) throw Error('Unexpected repeating page content');
      root.scrollTop = 0;
      if (bottom) for (let top = 0; top <= root.scrollHeight; top += Math.max(100, root.clientHeight / 2)) {
       root.scrollTop = top; await new Promise(requestAnimationFrame);
      }
     }
    }, bottom);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(artifacts!, `instructions-capacity-${width}-${bottom ? 'bottom' : 'top'}.png`), animations: 'disabled' });
   }
   // Playwright's nearest-edge scrolling does not account for the fixed nav.
   // Center the complete message before checking its first, middle and last lines.
   await guidance.evaluate(async (element: HTMLElement) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
   });
   const bounds = await guidance.evaluate((element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.thingtimeTopNav');
    if (!header) throw Error('Expected the native Settings fixed header');
    const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
    const inset = Math.min(lineHeight / 2, box.height / 2);
    const hitPoints = [
     { line: 'first', y: box.top + inset },
     { line: 'middle', y: box.top + box.height / 2 },
     { line: 'last', y: box.bottom - inset },
    ].flatMap(point => [box.left + 2, box.left + box.width / 2, box.right - 2].map(x => {
     const hit = document.elementFromPoint(x, point.y);
     return { ...point, x, unobscured: !!hit && (hit === element || element.contains(hit)) };
    }));
    return { label: 'capacity guidance', width: innerWidth, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
     headerBottom, hitPoints, unobscured: hitPoints.every(point => point.unobscured),
     viewportHeight: innerHeight, contentWidth: element.scrollWidth, clientWidth: element.clientWidth, height: box.height, lineHeight };
   });
   // Preserve the observed hit-test geometry even when an overlay regression
   // fails below; a failure screenshot alone cannot show every sampled point.
   await writeFile(resolve(artifacts!, `instructions-capacity-guidance-${width}-bounds.json`), JSON.stringify(bounds, null, 2));
   assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= bounds.viewportHeight);
   assert.ok(bounds.top > bounds.headerBottom, 'the first line must start below the fixed header');
   assert.equal(bounds.unobscured, true, 'first, middle and last guidance lines must not be covered by another panel');
   assert.ok(bounds.contentWidth <= bounds.clientWidth && bounds.height >= bounds.lineHeight, 'size guidance must fit and remain readable');
   viewports.push(bounds);
   await page.screenshot({ path: resolve(artifacts!, `instructions-capacity-guidance-${width}.png`), animations: 'disabled' });
  }
  phase = 'oversized offline reload';
  await connectivity(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll(() => editor.getByLabel('Instruction 1', { exact: true }).evaluate((element: HTMLTextAreaElement, expected: string) => element.value === expected, oversized), value => value === true);
  await guidance.waitFor();
  assert.equal(await editor.getByLabel('Enable instruction 2', { exact: true }).isChecked(), false);
  checks.push('oversized normal Settings save stays local with actionable size guidance at desktop and both phone widths; offline cold reload retains exact Unicode and disabled rows');

  phase = 'oversized retry observation';
  await connectivity(false);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
  const requestsBeforeWait = instructionRequests.length, observationStart = Date.now();
  await page.waitForTimeout(65_000);
  const observedRetryWindowMs = Date.now() - observationStart;
  const repeatInstructionRequests = instructionRequests.length - requestsBeforeWait;
  assert.ok(observedRetryWindowMs >= 60_000);
  assert.equal(instructionRequests.length, requestsBeforeWait, 'blocked revision must not repeat GET or POST after the former 60-second retry interval');
  assert.equal(JSON.stringify((await api('GET')).body.personal) === JSON.stringify(beforeCapacity), true);
  phase = 'shortened Settings save and account readback';
  const shortened = 'Shortened native instruction after the account size refusal.';
  await editor.getByLabel('Instruction 1', { exact: true }).fill(shortened); await save();
  await inSync();
  const afterCapacity = (await api('GET')).body.personal;
  assert.equal(afterCapacity.instructions[0].text, shortened); assert.equal(afterCapacity.instructions[1].enabled, false);
  assert.ok(instructionRequests.every(request => request.method !== 'POST' || request.bytes <= 96 * 1024));
  capacityProof = { oversizedUtf8Bytes, hardLines: oversized.split('\n').length, pasteMs, localSaveMs, nativeUndoRedoExact: true, postPasteTypingExact: true, paragraphSavedExactly: true, accountUnchangedWhileBlocked: true, offlineReloadRetained: true,
   observedRetryWindowMs, repeatInstructionRequests,
   shortenedAccountReadback: true, postByteLengths: instructionRequests.filter(request => request.method === 'POST').map(request => request.bytes) };
  checks.push('blocked revision sends no oversized POST or repeated request across a real 60-second retry window; shortening through Settings resumes normal account sync');
  phase = 'anonymous ACL regression';
  const publicRead = await guest.request.get(base + '/api/v1/settings/lopu-prompt');
  assert.equal(publicRead.status(), 200);
  assert.deepEqual((await publicRead.json()).personal, { revision: null, instructions: [] });
  const guestWrite = await guest.request.post(base + '/api/v1/settings/lopu-prompt', { headers: { Origin: base! }, data: { scope: 'personal', revision: null, instructions: [] } });
  assert.equal(guestWrite.status(), 401);
  assert.deepEqual(errors, []); assert.deepEqual(offlineWrites, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks, viewports, writes: writes.length, lostReplyAcknowledgedWithoutReplay: true, capacityProof, anonymousPrivateRows: 0, anonymousWrite: guestWrite.status(), errors, offlineWrites }, null, 2));
 } catch (error) {
  const screenshotCaptured = await page.screenshot({ path: resolve(artifacts!, 'failure.png'), timeout: 5000 }).then(() => true, () => false);
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => null);
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), phase, checks, errors, offlineWrites, instructionRequests, writes: writes.length,
   screenshotCaptured, bodyReadable: body !== null, body }, null, 2));
  throw error;
 } finally { release(); await context.close(); await guest.close(); }
});
