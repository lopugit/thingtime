import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { INSTRUCTION_CHAIN_SEED, instructionChainDigest, splitInstructionParts } from '../lopu/instructionTransfer';

const base = process.env.TT_LOCAL_INSTRUCTIONS_URL;
const artifacts = process.env.TT_LOCAL_INSTRUCTIONS_ARTIFACTS;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

// Keep protocol acceptance independently runnable when editor performance
// fails first. This does not replace the full native clipboard test below.
test('native legacy instruction reads refuse transferred records in both authenticated request paths', {
 skip: !base || !artifacts || !playwrightPath, timeout: 120_000
}, async t => {
 assert.equal(new URL(base!).hostname, '127.0.0.1');
 assert.ok(process.env.TT_RENDER_SESSION);
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
 const manifest = await (await fetch(base + '/.well-known/thingtime-capabilities.json')).json();
 assert.equal(manifest.origin, base);
 assert.ok(capabilitySatisfies(manifest.features?.['api.settings-lopu-prompt']?.version, '2.0.0'));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 t.after(() => browser.close());
 const context = await browser.newContext(), guest = await browser.newContext();
 const username = 'instruction-read-' + randomUUID().slice(0, 8);
 const registered = await context.request.post(base + '/api/v1/auth/register', {
  headers: { Origin: base! }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
 });
 assert.equal(registered.status(), 200, 'Isolated synthetic registration failed.');
 const ownerId = (await registered.json()).user.id;
 const page = await context.newPage();
 await page.goto(base + '/api/v1/health/nitro');
 // Exercise the browser's authenticated same-origin path. The isolated
 // production bundle keeps Secure cookies; the raw test client's loopback
 // cookie behavior is not evidence of the browser's authenticated response.
 const command = async (command: unknown) => {
  const response = await page.evaluate(async ({ ownerId, command }) => {
   const response = await fetch('/api/v1/settings/lopu-prompt', { method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' },
    body: JSON.stringify({ operation: 'instruction-transfer', expectedOwnerId: ownerId, command }) });
   return { status: response.status, body: await response.json() };
  }, { ownerId, command });
  if (response.status !== 200) {
   const code = typeof response.body?.code === 'string' && /^[A-Z_]{1,80}$/.test(response.body.code) ? response.body.code : 'UNAVAILABLE';
   await mkdir(artifacts!, { recursive: true });
   await writeFile(resolve(artifacts!, 'legacy-protocol-command-refusal.json'), JSON.stringify({ status: response.status, code }, null, 2));
  }
  assert.equal(response.status, 200, 'Isolated instruction command failed.');
  return response.body;
 };
 const initial = await command({ action: 'snapshot' });
 assert.deepEqual(initial.personal, { revision: null, instructions: [] });
 const parts = [...splitInstructionParts([{ id: randomUUID(), text: 'Exact 🌟\n'.repeat(12_000), enabled: true }])];
 let digest = INSTRUCTION_CHAIN_SEED;
 for (const part of parts) digest = await instructionChainDigest(digest, part);
 const attemptId = randomUUID();
 await command({ action: 'begin', attemptId, expectedRevision: null, partCount: parts.length, digest });
 for (let offset = 0; offset < parts.length; offset++) await command({ action: 'parts', attemptId, offset, parts: [parts[offset]] });
 const receipt = await command({ action: 'commit', attemptId });
 assert.equal(receipt.transfer.status, 'committed');
 const snapshot = await command({ action: 'snapshot' });
 assert.equal(snapshot.personal.reference.attemptId, attemptId);
 assert.equal(snapshot.personal.reference.digest, digest);
 const direct = await context.request.get(base + '/api/v1/settings/lopu-prompt');
 const body = await direct.json();
 const scoped = await page.evaluate(async ownerId => {
  const response = await fetch('/api/v1/settings/lopu-prompt', { credentials: 'same-origin', cache: 'no-store', redirect: 'error',
   headers: { 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
  const body = await response.json();
  return { status: response.status, code: body?.code, hasPersonal: !!body?.personal, rowCount: body?.personal?.instructions?.length };
 }, ownerId);
 const publicRead = await guest.request.get(base + '/api/v1/settings/lopu-prompt');
 const publicBody = await publicRead.json();
 await mkdir(artifacts!, { recursive: true });
 await writeFile(resolve(artifacts!, 'legacy-protocol-result.json'), JSON.stringify({
  direct: { status: direct.status(), code: body?.code, hasPersonal: !!body?.personal, rowCount: body?.personal?.instructions?.length },
  scoped, guest: { status: publicRead.status(), personal: publicBody.personal },
  transferredParts: parts.length, committed: receipt.transfer.status === 'committed'
 }, null, 2));
 if (direct.status() === 200) assert.deepEqual(body.personal, { revision: null, instructions: [] });
 else { assert.equal(direct.status(), 413); assert.equal(body.code, 'USE_INSTRUCTION_TRANSFER'); }
 assert.equal(scoped.status, 413); assert.equal(scoped.code, 'USE_INSTRUCTION_TRANSFER');
 assert.equal(publicRead.status(), 200); assert.deepEqual(publicBody.personal, { revision: null, instructions: [] });
});

test('native account instructions save offline and reconcile lost replies and reviewed conflicts independently', {
 skip: !base || !artifacts || !playwrightPath, timeout: 420_000
}, async t => {
 assert.equal(new URL(base!).hostname, '127.0.0.1');
 assert.ok(process.env.TT_RENDER_SESSION);
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
 const manifest = await (await fetch(base + '/.well-known/thingtime-capabilities.json')).json();
 assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.origin, base);
 assert.ok(capabilitySatisfies(manifest.features?.['api.settings-lopu-prompt']?.version, '2.0.0'));
 await mkdir(artifacts!, { recursive: true });
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 t.after(() => browser.close());
 // This disposable context uses only synthetic clipboard text. The native
 // paste path retains browser undo; CDP insertText (locator.fill) has a
 // separate Chromium many-hard-line insertion bottleneck even on a blank page.
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
 const guest = await browser.newContext();
 const page = await context.newPage(), network = await context.newCDPSession(page);
 const browserControl = await browser.newBrowserCDPSession();
 const errors: string[] = [], offlineWrites: string[] = [], checks: string[] = [], writes: any[] = [], viewports: unknown[] = [];
 const instructionRequests: { method: string; bytes: number }[] = [];
 let capacityProof: unknown;
 let phase = 'account setup and prior instruction regressions';
 const fixtureStartedAt = Date.now(), phaseMarks: { phase: string; elapsedMs: number }[] = [];
 const markPhase = (value: string) => { phase = value; phaseMarks.push({ phase, elapsedMs: Date.now() - fixtureStartedAt }); };
 let offline = false, ownerId = '', hold = false, heldReceipt: any;
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 t.after(release);
 const observePage = () => {
 page.setDefaultTimeout(30_000);
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => {
  if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname);
  if (new URL(request.url()).pathname === '/api/v1/settings/lopu-prompt' && !request.headers()['x-thingtime-fixture-readback'])
   instructionRequests.push({ method: request.method(), bytes: Buffer.byteLength(request.postData() || '', 'utf8') });
 });
 };
 observePage();
 const connectivity = async (value: boolean) => {
  if (!value) offline = false;
  await context.setOffline(value);
  await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
  assert.equal(await page.evaluate(() => navigator.onLine), !value);
  offline = value;
 };
 let independentSnapshot: any;
 const api = async (method: string, data?: unknown) => {
 const result = await page.evaluate(async ({ method, data, ownerId, known }) => {
  const headers = { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Fixture-Readback': '1' };
  const send = async (payload: unknown) => {
   const body = JSON.stringify(payload);
   for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('/api/v1/settings/lopu-prompt', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, body });
    if (response.status === 429 && attempt === 0) { await new Promise(resolve => setTimeout(resolve, Math.max(60_000, (Number(response.headers.get('Retry-After')) || 60) * 1000))); continue; }
    return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() };
   }
   throw Error('Independent instruction request remained rate limited');
  };
  if (method !== 'GET') return send(data);
  const command = (command: unknown) => send({ operation: 'instruction-transfer', expectedOwnerId: ownerId, command });
  const result = await command({ action: 'snapshot' });
  if (result.status !== 200) throw Error('Independent instruction snapshot failed: ' + result.status);
  const personal = result.body.personal;
  if (!personal.reference) return result;
  if (known?.revision === personal.revision) return { ...result, body: { ...result.body, personal: known } };
  const instructions: { id: string; text: string; enabled: boolean }[] = [];
  let digest = '0'.repeat(64), open: { id: string; text: string; enabled: boolean } | undefined;
  for (let ordinal = 0; ordinal < personal.reference.partCount; ordinal++) {
   await new Promise(resolve => setTimeout(resolve, 2500));
   const read = await command({ action: 'read-part', attemptId: personal.reference.attemptId, ordinal });
   if (read.status !== 200) throw Error('Independent instruction part failed: ' + read.status);
   const raw = read.body.part, part = { id: raw.id, enabled: raw.enabled, text: raw.text, start: raw.start, end: raw.end };
   const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digest + '\n' + JSON.stringify(part)));
   digest = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
   if (part.start) { if (open) throw Error('Overlapping independent instruction rows'); open = { id: part.id, enabled: part.enabled, text: part.text }; }
   else { if (!open || open.id !== part.id || open.enabled !== part.enabled) throw Error('Independent instruction continuity failed'); open.text += part.text; }
   if (part.end) { if (!open) throw Error('Missing independent instruction start'); instructions.push(open); open = undefined; }
  }
  if (open || digest !== personal.reference.digest) throw Error('Independent instruction digest failed');
  return { ...result, body: { ...result.body, personal: { revision: personal.revision, instructions } } };
 }, { method, data, ownerId, known: independentSnapshot });
 if (method === 'GET' && result.status === 200) independentSnapshot = result.body.personal;
 return result;
 };
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
 const inSync = () => editor.getByRole('status').filter({ hasText: 'Device and account instructions are in sync.' }).waitFor({ timeout: 180_000 });
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
  const original = 'Keep my exact wording.\nMy offline work completes locally — 日本語. ' + 'Exact private preference. '.repeat(4200) + 'End of original.';
  assert.ok(Buffer.byteLength(JSON.stringify({ instructions: [{ id: 'one', text: original, enabled: true }] })) > 96 * 1024);
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
   const body = request.postDataJSON();
   if (body.scope !== 'personal' && !['begin', 'parts', 'commit', 'abort'].includes(body.command?.action)) return route.continue();
   writes.push(body);
   if (!hold || body.command?.action !== 'commit') return route.continue();
   hold = false;
   const response = await route.fetch();
   assert.equal(response.status(), 200);
   heldReceipt = await response.json();
   await gate;
   await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture lost save reply' }) });
  });
  hold = true;
  await connectivity(false);
  await poll(async () => heldReceipt, value => value?.transfer?.status === 'committed');
  const newer = original + '\nA newer device edit survives the lost reply.';
  await editor.getByLabel('Instruction 1', { exact: true }).fill(newer);
  await save();
  assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).inputValue(), newer);
  release();
  await inSync();
  const saved = await api('GET');
  assert.equal(saved.status, 200); assert.match(saved.cache!, /no-store/);
  assert.equal(saved.body.personal.instructions[0].text, newer);
  assert.equal(saved.body.personal.instructions[1].enabled, false);
  const committedAttempt = heldReceipt.transfer.attemptId;
  assert.equal(writes.filter(body => body.command?.action === 'commit' && body.command.attemptId === committedAttempt).length, 1);
  assert.equal(writes.filter(body => body.command?.action === 'commit').length, 2);
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
  await connectivity(true);
  markPhase('oversized Settings input readiness');
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
  markPhase('oversized paragraph Settings save');
  const guidance = editor.getByRole('status').filter({ hasText: 'Saved on this device.' });
  try { await capacityInput.fill(paragraph, { timeout: 30_000 }); }
  catch (error) {
   // Playwright otherwise repeats the complete synthetic payload in its call
   // log. Keep the action failure and readiness evidence bounded and useful.
   throw new Error('Oversized Settings input failed after enabled/editable/focus checks: ' + String(error).split('\n')[0].slice(0, 300));
  }
  await save();
  await guidance.waitFor();
  assert.equal(await capacityEquals(paragraph), true, 'the long paragraph is saved exactly');

  markPhase('12000-hard-line native paste and undo');
  await page.evaluate(text => navigator.clipboard.writeText(text), hardLinePayload);
  await capacityInput.click(); await capacityInput.press('Control+A');
  await network.send('Performance.enable');
  const prePaste = { phaseMarks, browserProcesses: await browserControl.send('SystemInfo.getProcessInfo'), rendererMetrics: await network.send('Performance.getMetrics'),
   document: await capacityInput.evaluate((element: HTMLTextAreaElement) => ({ characters: element.value.length, hardLines: element.value.split('\n').length, elements: document.getElementsByTagName('*').length, focused: document.activeElement === element, disabled: element.disabled, readOnly: element.readOnly })) };
  await writeFile(resolve(artifacts!, 'capacity-paste-preflight.json'), JSON.stringify(prePaste, null, 2));
  // Keep host/automation elapsed time separate from native editing and the
  // first rendered frame. Capture metadata only, never the instruction text.
  const pasteProbe = await capacityInput.evaluateHandle((element: HTMLTextAreaElement) => {
   const started = performance.now();
   const events: { type: string; elapsedMs: number; inputType?: string }[] = [];
   const longTasks: { elapsedMs: number; durationMs: number }[] = [];
   const recordTasks = (entries: PerformanceEntry[]) => {
    for (const entry of entries) if (entry.startTime >= started)
     longTasks.push({ elapsedMs: entry.startTime - started, durationMs: entry.duration });
   };
   const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver(list => recordTasks(list.getEntries())) : null;
   observer?.observe({ type: 'longtask' });
   const record = (event: Event) => {
    events.push({ type: event.type, elapsedMs: performance.now() - started,
     ...('inputType' in event ? { inputType: (event as InputEvent).inputType } : {}) });
    if (event.type === 'input') requestAnimationFrame(() => {
     events.push({ type: 'first-frame-after-input', elapsedMs: performance.now() - started });
    });
   };
   for (const type of ['paste', 'beforeinput', 'input']) element.addEventListener(type, record, true);
   return { finish: async () => {
    // This observation is outside pasteMs; it must not weaken or add to the
    // unchanged end-to-end acceptance threshold below.
    await new Promise<void>(resolveFrame => requestAnimationFrame(() => resolveFrame()));
    if (observer) { recordTasks(observer.takeRecords()); observer.disconnect(); }
    for (const type of ['paste', 'beforeinput', 'input']) element.removeEventListener(type, record, true);
    return { events, longTasks, observedMs: performance.now() - started };
   } };
  });
  const pasteStarted = Date.now();
  await capacityInput.press('Control+V', { timeout: 20_000 });
  assert.equal(await capacityEquals(hardLinePayload), true, 'native paste preserves every hard line');
  const pasteMs = Date.now() - pasteStarted;
  const nativeTimings = await pasteProbe.evaluate((probe: { finish: () => Promise<unknown> }) => probe.finish());
  await pasteProbe.dispose();
  await writeFile(resolve(artifacts!, 'capacity-paste-result.json'), JSON.stringify({ pasteMs, nativeTimings, exact: true, hardLines: hardLinePayload.split('\n').length, rendererMetrics: await network.send('Performance.getMetrics'), browserProcesses: await browserControl.send('SystemInfo.getProcessInfo') }, null, 2));
  assert.ok(pasteMs < 5000, `Native multiline paste took ${pasteMs} ms`);
  await capacityInput.press('Control+Z'); assert.equal(await capacityEquals(paragraph), true, 'native undo restores the preceding complete instruction');
  await capacityInput.press('Control+Shift+Z'); assert.equal(await capacityEquals(hardLinePayload), true, 'native redo restores every hard line');
  await capacityInput.press('Control+End'); await page.keyboard.type(suffix);
  assert.equal(await capacityEquals(oversized), true, 'normal typing remains editable after the bulk paste');
  markPhase('12000-hard-line local Settings save');
  const saveStarted = Date.now(); await save(); const localSaveMs = Date.now() - saveStarted;
  assert.ok(localSaveMs < 5000, `Local multiline save took ${localSaveMs} ms`);
  assert.equal(await page.locator('.lopuToast').filter({ hasText: 'Lopu instructions saved on this device' }).count(), 1,
   'consecutive paragraph and multiline saves must update one visible success notification');
  await guidance.waitFor();
  assert.match(await guidance.innerText(), /Saved on this device/);
  assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).evaluate((element: HTMLTextAreaElement, expected: string) => element.value === expected, oversized), true);
  assert.equal(await capacityEquals(oversized), true, 'oversized local save remains immediately editable while offline');
  assert.ok(instructionRequests.every(request => request.method !== 'POST' || request.bytes <= 96 * 1024), 'no oversized POST may be sent');

  markPhase('oversized status responsive layout');
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
  markPhase('oversized offline reload');
  await connectivity(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll(() => editor.getByLabel('Instruction 1', { exact: true }).evaluate((element: HTMLTextAreaElement, expected: string) => element.value === expected, oversized), value => value === true);
  await guidance.waitFor();
  assert.equal(await editor.getByLabel('Enable instruction 2', { exact: true }).isChecked(), false);
  checks.push('oversized normal Settings save completes locally with pending-sync status at desktop and both phone widths; offline cold reload retains exact Unicode and disabled rows');

  markPhase('resumable account upload and independent readback');
  await connectivity(false);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
  await inSync();
  const afterCapacity = (await api('GET')).body.personal;
  assert.equal(afterCapacity.instructions[0].text, oversized); assert.equal(afterCapacity.instructions[1].enabled, false);
  assert.notEqual(afterCapacity.revision, beforeCapacity.revision);
  assert.equal(afterCapacity.instructions[0].text.split('\n').length, 12_002);
  const legacyRead = await context.request.get(base + '/api/v1/settings/lopu-prompt');
  const legacyBody = await legacyRead.json();
  const legacySummary = (status: number, body: any) => ({ status, ok: body?.ok, code: body?.code,
   hasPersonal: !!body?.personal, hasReference: !!body?.personal?.reference,
   rowCount: body?.personal?.instructions?.length, characters: body?.personal?.instructions?.[0]?.text?.length,
   revisionMatches: body?.personal?.revision === afterCapacity.revision });
  const pageLegacy = await page.evaluate(async ownerId => {
   const response = await fetch('/api/v1/settings/lopu-prompt', { credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
   const body = await response.json();
   return { status: response.status, ok: body?.ok, code: body?.code, hasPersonal: !!body?.personal,
    hasReference: !!body?.personal?.reference, rowCount: body?.personal?.instructions?.length,
    characters: body?.personal?.instructions?.[0]?.text?.length };
  }, ownerId);
  // Diagnose the two normal request paths without retaining private text or
  // credentials. A legacy read must refuse a reference, never flatten it.
  await writeFile(resolve(artifacts!, 'legacy-read-result.json'), JSON.stringify({ request: legacySummary(legacyRead.status(), legacyBody), page: pageLegacy }, null, 2));
  if (legacyRead.status() === 200) assert.deepEqual(legacyBody.personal, { revision: null, instructions: [] });
  else { assert.equal(legacyRead.status(), 413); assert.equal(legacyBody.code, 'USE_INSTRUCTION_TRANSFER'); }
  assert.equal(pageLegacy.status, 413); assert.equal(pageLegacy.code, 'USE_INSTRUCTION_TRANSFER');
  const publicBase = await guest.request.get(base + '/api/v1/settings/lopu-prompt?scope=base');
  assert.equal(publicBase.status(), 200); const publicBaseBody = await publicBase.json();
  assert.equal(typeof publicBaseBody.base.basePrompt, 'string'); assert.equal('personal' in publicBaseBody, false);
  assert.ok(instructionRequests.every(request => request.method !== 'POST' || request.bytes <= 96 * 1024));
  capacityProof = { oversizedUtf8Bytes, hardLines: oversized.split('\n').length, pasteMs, localSaveMs, nativeUndoRedoExact: true, postPasteTypingExact: true, paragraphSavedExactly: true, offlineReloadRetained: true,
   exactResumableAccountReadback: true, postByteLengths: instructionRequests.filter(request => request.method === 'POST').map(request => request.bytes) };
  checks.push('large exact Unicode and hard-line instructions sync through bounded requests after offline cold reload; independent account readback matches all content and disabled rows');
  markPhase('anonymous ACL regression');
  const publicRead = await guest.request.get(base + '/api/v1/settings/lopu-prompt');
  assert.equal(publicRead.status(), 200);
  assert.deepEqual((await publicRead.json()).personal, { revision: null, instructions: [] });
  const guestWrite = await guest.request.post(base + '/api/v1/settings/lopu-prompt', { headers: { Origin: base! }, data: { scope: 'personal', revision: null, instructions: [] } });
  assert.equal(guestWrite.status(), 401);
  const malformed = await guest.request.post(base + '/api/v1/settings/lopu-prompt', { headers: { Origin: base!, 'Content-Type': 'application/json' }, data: 'x'.repeat(96 * 1024 + 1) });
  assert.equal(malformed.status(), 413);
  const guestTransfer = await guest.request.post(base + '/api/v1/settings/lopu-prompt', { headers: { Origin: base!, 'X-Thingtime-Expected-Data-Plane': 'home' }, data: { operation: 'instruction-transfer', expectedOwnerId: ownerId, command: { action: 'snapshot' } } });
  assert.equal(guestTransfer.status(), 401);
  checks.push('built v2 manifest, base-only public read, legacy reference refusal, anonymous transfer refusal and oversized malformed-body refusal');
  assert.deepEqual(errors, []); assert.deepEqual(offlineWrites, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ capability: { origin: manifest.origin, feature: 'api.settings-lopu-prompt', version: manifest.features['api.settings-lopu-prompt'].version }, phaseMarks, checks, viewports, writes: writes.length, lostReplyAcknowledgedWithoutReplay: true, capacityProof, anonymousPrivateRows: 0, anonymousWrite: guestWrite.status(), errors, offlineWrites }, null, 2));
 } catch (error) {
  const diagnostic = async (read: Promise<unknown>) => {
   let timer: ReturnType<typeof setTimeout> | undefined;
   try { return await Promise.race([read, new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), 3000); })]); }
   catch (cause) { return { error: String(cause).slice(0, 300) }; }
   finally { if (timer) clearTimeout(timer); }
  };
  const browserProcesses = await diagnostic(browserControl.send('SystemInfo.getProcessInfo'));
  const rendererMetrics = await diagnostic(network.send('Performance.getMetrics'));
  const screenshotCaptured = await page.screenshot({ path: resolve(artifacts!, 'failure.png'), timeout: 5000 }).then(() => true, () => false);
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => null);
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), phase, phaseMarks, elapsedMs: Date.now() - fixtureStartedAt, browserProcesses, rendererMetrics, checks, errors, offlineWrites, instructionRequests, writes: writes.length,
   screenshotCaptured, bodyReadable: body !== null, body }, null, 2));
  throw error;
 } finally { release(); await context.close(); await guest.close(); }
});
