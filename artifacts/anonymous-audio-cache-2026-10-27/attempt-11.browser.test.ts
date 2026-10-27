import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.TT_AUDIO_ORIGIN, session = process.env.TT_AUDIO_SESSION, artifacts = process.env.TT_AUDIO_ARTIFACTS;
const wav = (frequency: number) => {
 const count = 8000, bytes = Buffer.alloc(44 + count * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
 for (let n = 0; n < count; n++) bytes.writeInt16LE(Math.round(Math.sin(n * frequency * 2 * Math.PI / 8000) * 5000), 44 + n * 2);
 return bytes;
};

test('ordinary audio player fences delayed saves across queue/account changes and keeps exact offline originals', { skip: !origin || !session || !artifacts, timeout: 240_000 }, async () => {
 assert.equal(new URL(origin!).hostname, '127.0.0.1');
 const health = await (await fetch(origin + '/api/v1/health/nitro', { redirect: 'error' })).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment.sessionId, session);
 const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
 const browser = await chromium.launch({ executablePath: process.env.TT_AUDIO_CHROME, headless: true, chromiumSandbox: true, args: ['--no-proxy-server', '--disable-background-networking'] });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), admin = await browser.newContext(), author = await browser.newContext(), page = await context.newPage(), adminPage = await admin.newPage(), authorPage = await author.newPage();
 const headers = { Origin: origin! }, username = 'audio-' + randomUUID().slice(0, 12), password = randomUUID() + randomUUID();
 const servedModules: { path: string; sha256: string }[] = [], moduleChecks: Promise<void>[] = [];
 page.on('response', (response: any) => { const path = new URL(response.url()).pathname; if (response.ok() && path.startsWith('/assets/') && /\.(?:js|css)$/.test(path)) { const check = (async () => { const served = await response.body(), packaged = await readFile(resolve('/tmp/app/public', '.' + path)); assert.deepEqual(served, packaged, 'Served module must equal this fresh package: ' + path); servedModules.push({ path, sha256: createHash('sha256').update(served).digest('hex') }); })(); moduleChecks.push(check); void check.catch(() => {}); } });
 const call = (target: any, path: string, data?: any) => target.evaluate(async ({ path, data }: any) => { const response = await fetch(path, data === undefined ? { signal: AbortSignal.timeout(30_000) } : { signal: AbortSignal.timeout(30_000), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, value: await response.json() }; }, { path, data });
 const errors: string[] = [], boundaries: any[] = [], ids: string[] = [], requests: any[] = [], audioResponses: any[] = [];
 page.on('response', (response: any) => { const url = new URL(response.url()); if (url.pathname === '/api/v1/attachments/content') audioResponses.push({ id: url.searchParams.get('id'), mode: url.searchParams.get('cache'), status: response.status() }); }); let postId = '', heldId = '', release: (() => void) | undefined, requestHeld: (() => void) | undefined, rejectHeld: ((error: Error) => void) | undefined;
 page.setDefaultTimeout(25_000); page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { const url = new URL(request.url()); if (url.pathname === '/api/v1/attachments/content' && request.resourceType() === 'fetch') requests.push({ id: url.searchParams.get('id'), mode: url.searchParams.get('cache'), expectedActor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'], serviceWorker: request.serviceWorker()?.url() || null }); });
 const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
 const online = async (offline: boolean) => { await context.setOffline(offline); await cdp.send('Network.overrideNetworkState', { offline, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
 const click = (name: string) => page.getByRole('button', { name, exact: true }).click();
 const source = () => page.locator('audio source').first().getAttribute('src');
 const waitIdentity = async (id: string | null) => {
  await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
  await page.waitForFunction(async (id: string | null) => ((await (await fetch('/api/root-data')).json()).user?.id || null) === id, id);
  // Observe root refresh completion in the actual app, not only an independent API read.
  await page.waitForTimeout(300);
 };
 const delayedSave = async (id: string) => {
  heldId = id; const waiting = new Promise<void>((resolve, reject) => { requestHeld = resolve; rejectHeld = reject; }); void waiting.catch(() => {});
  await click('Save full file offline'); await Promise.race([waiting, page.waitForTimeout(30_000).then(() => { throw Error('The player did not issue its original-bytes save request; inspect captured DOM and request modes.'); })]);
 };
 await mkdir(artifacts!, { recursive: true });
 try {
  // Separate native-media diagnostic: Chromium may retain historical currentSrc
  // even after load() has emptied a detached element's playable resource.
  const nativeMedia = await page.evaluate(async bytes => {
   const audio = document.createElement('audio'), source = document.createElement('source'), url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
   source.src = url; audio.append(source); document.body.append(audio);
   await audio.play(); audio.pause(); const before = { currentSrc: audio.currentSrc, readyState: audio.readyState };
   audio.remove(); audio.removeAttribute('src'); audio.querySelectorAll('source').forEach(source => source.removeAttribute('src')); audio.load();
   await new Promise(resolve => setTimeout(resolve, 100));
   const after = { currentSrc: audio.currentSrc, paused: audio.paused, readyState: audio.readyState, networkState: audio.networkState, srcAttribute: audio.getAttribute('src'), sources: [...audio.querySelectorAll('source')].map(source => source.getAttribute('src')) };
   let playingEvents = 0; audio.addEventListener('playing', () => playingEvents++);
   const playback = audio.play().then(() => 'played', (error: DOMException) => error.name);
   const beforeCancellation = await Promise.race([playback, new Promise<string>(resolve => setTimeout(() => resolve('pending without source'), 250))]);
   audio.pause(); audio.load();
   const playResult = await Promise.race([playback, new Promise<string>(resolve => setTimeout(() => resolve('cancellation timed out'), 1_000))]);
   URL.revokeObjectURL(url); return { before, after, beforeCancellation, playResult, playingEvents };
  }, [...wav(110)]);
  await writeFile(resolve(artifacts!, 'native-media-api.json'), JSON.stringify(nativeMedia, null, 2));
  assert.equal(nativeMedia.after.paused, true); assert.equal(nativeMedia.after.readyState, 0); assert.equal(nativeMedia.after.networkState, 3); assert.equal(nativeMedia.after.srcAttribute, null); assert.deepEqual(nativeMedia.after.sources, [null]); assert.equal(nativeMedia.beforeCancellation, 'pending without source'); assert.equal(nativeMedia.playResult, 'AbortError'); assert.equal(nativeMedia.playingEvents, 0);
  await online(false);
  const administrator = JSON.parse(await readFile(process.env.TT_AUDIO_ADMIN_FIXTURE!, 'utf8'));
  const loggedIn = await admin.request.post(origin + '/api/v1/login', { headers, data: { username: administrator.username, password: administrator.password } }); assert.equal(loggedIn.status(), 200);
  const registration = await context.request.post(origin + '/api/v1/auth/register', { headers, data: { username, email: username + '@example.test', password } }); assert.equal(registration.status(), 200);
  const ownerId = (await registration.json()).user.id;
  const authorName = 'audio-author-' + randomUUID().slice(0, 10);
  const authorRegistration = await author.request.post(origin + '/api/v1/auth/register', { headers, data: { username: authorName, email: authorName + '@example.test', password: randomUUID() + randomUUID() } }); assert.equal(authorRegistration.status(), 200); const authorId = (await authorRegistration.json()).user.id;
  // The isolated API jar and Chromium differ on secure loopback cookies. Move
  // only these synthetic sessions through the supported context API in memory,
  // then use each browser's normal same-origin session/CSRF path.
  await admin.addCookies((await admin.request.storageState()).cookies); await context.addCookies((await context.request.storageState()).cookies); await author.addCookies((await author.request.storageState()).cookies);
  await adminPage.goto(origin + '/things'); await page.goto(origin + '/things'); await authorPage.goto(origin + '/things');
  assert.equal((await call(adminPage, '/api/root-data')).value.user?.id, administrator.ownerId);
  assert.equal((await call(page, '/api/root-data')).value.user?.id, ownerId); assert.equal((await call(authorPage, '/api/root-data')).value.user?.id, authorId);
  assert.equal((await call(adminPage, '/api/v1/admin/users/public-uploads', { userId: authorId, enabled: true, scope: 'public' })).status, 200);
  const files = [wav(220), wav(440)];
  for (const [index, bytes] of files.entries()) {
   const start = await call(authorPage, '/api/v1/attachments/uploads', { requestId: randomUUID(), filename: `fixture-track-${index + 1}.wav`, contentType: 'audio/wav', sizeBytes: bytes.length, purpose: 'post' }); assert.equal(start.status, 200, JSON.stringify(start.value)); const uploadId = start.value.upload.id;
   const signed = await call(authorPage, '/api/v1/attachments/uploads/parts', { uploadId, parts: [{ partNumber: 1, checksumSha256: createHash('sha256').update(bytes).digest('base64') }] }); assert.equal(signed.status, 200); const part = signed.value.parts[0]; assert.equal(new URL(part.url).hostname, '127.0.0.1');
   assert.equal((await author.request.put(part.url, { headers: part.headers, data: bytes })).status(), 200);
   const completed = await call(authorPage, '/api/v1/attachments/uploads/complete', { uploadId }); assert.equal(completed.status, 200, JSON.stringify(completed.value)); ids.push(completed.value.attachment.id);
  }
  const seeded = await call(authorPage, '/api/v1/things', { thingtime: ['post'], crystal: { type: 'text', text: 'Two synthetic ordinary audio tracks.' }, visibility: 'public', attachmentIds: ids }); assert.equal(seeded.status, 200, JSON.stringify(seeded.value)); const post = seeded.value; postId = post.thing?.id || post.post?.id || post.id; assert.ok(postId);
  await author.close();
  await page.goto(origin + '/post/' + postId); await page.getByRole('button', { name: '1. fixture-track-1.wav', exact: true }).waitFor();
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; });
  await context.route('**/api/v1/attachments/content?**', async (route: any) => {
   const request = route.request(), url = new URL(request.url()), mode = url.searchParams.get('cache');
   if (request.resourceType() !== 'fetch' || url.searchParams.get('id') !== heldId || mode !== 'original-bytes') return route.continue();
   let response: any;
   try { response = await route.fetch({ timeout: 30_000 }); }
   catch (error: any) { audioResponses.push({ id: url.searchParams.get('id'), mode, routeFetchError: error?.name || 'Error' }); rejectHeld?.(Error('Intercepted original audio fetch failed.')); try { await route.abort(); } catch { /* Already retired. */ } return; }
   audioResponses.push({ id: url.searchParams.get('id'), mode, interceptedStatus: response.status(), serviceWorker: request.serviceWorker()?.url() || null });
   if (response.status() !== 200) { rejectHeld?.(Error('Intercepted original audio returned HTTP ' + response.status())); await route.fulfill({ response }); return; }
   const waiting = new Promise<void>(resolve => { release = resolve; }); heldId = ''; requestHeld?.(); await waiting;
   try { await route.fulfill({ response }); } catch { /* The expected selected-track/account abort may already have retired it. */ }
  });
  console.log('Audio checkpoint: independent author/viewer fixture and remote player ready');
  // A completed remote read is held just before delivery to the production player.
  await delayedSave(ids[0]); await click('2. fixture-track-2.wav'); release!(); await page.waitForTimeout(400);
  assert.equal(await source(), '/api/v1/attachments/content?id=' + ids[1]); assert.equal(await page.getByRole('button', { name: 'Use streaming', exact: true }).count(), 0);
  console.log('Audio checkpoint: delayed track-save fence passed');
  await click('Save full file offline'); await page.getByRole('button', { name: 'Use streaming', exact: true }).waitFor(); const saved = await source(); assert.ok(saved?.startsWith('blob:'));
  const exact = Buffer.from(await page.evaluate(async url => [...new Uint8Array(await (await fetch(url!)).arrayBuffer())], saved)); assert.deepEqual(exact, files[1]);
  const decoded = await page.locator('audio').first().evaluate(async (audio: HTMLAudioElement) => { await audio.play(); return { duration: audio.duration, readyState: audio.readyState, paused: audio.paused }; }); assert.equal(decoded.duration, 1); assert.ok(decoded.readyState >= 2); assert.equal(decoded.paused, false); await page.locator('audio').first().evaluate((audio: HTMLAudioElement) => audio.pause()); console.log('Audio checkpoint: exact original saved, decoded and played');
  const sameIdentityReload = page.waitForResponse((r: any) => new URL(r.url()).pathname === '/api/root-data'); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh'))); await sameIdentityReload; await page.waitForTimeout(300); assert.equal(await source(), saved, 'Equivalent attachment/identity refresh must preserve the active local Blob');
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await page.evaluate(async () => { const roots = [document.scrollingElement!, ...[...document.querySelectorAll<HTMLElement>('body *')].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)]; for (const root of roots) { if (root.scrollHeight > 40000) throw Error('Unexpected repeating audio page'); for (let top = 0; top <= root.scrollHeight; top += Math.max(200, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); if (document.documentElement.scrollWidth > innerWidth) throw Error('Horizontal overflow'); } } });
   const geometry = await page.locator('audio').first().evaluate((audio: HTMLAudioElement) => { const bounds = audio.getBoundingClientRect(); return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: bounds.left, right: bounds.right, audioWidth: bounds.width }; }); assert.equal(geometry.width, geometry.scrollWidth); assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.audioWidth > 0); boundaries.push(geometry);
   await page.locator('audio').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(artifacts!, `audio-${width}.png`) });
  }
  // A no-login refresh must keep the account-bound copy inaccessible. A late
  // pending owner download must not create an anonymous playback source.
  await click('1. fixture-track-1.wav'); await delayedSave(ids[0]);
  await page.locator('audio').first().evaluate((audio: HTMLAudioElement) => audio.pause());
  assert.equal(await page.getByRole('button', { name: '1. fixture-track-1.wav', exact: true }).getAttribute('aria-current'), 'true', 'Account-boundary race must retain the selected pending track');
  const logoutPage = await context.newPage();
  const logoutCdp = await context.newCDPSession(logoutPage); await logoutCdp.send('Network.enable'); await logoutCdp.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
  await logoutPage.goto(origin + '/post/' + postId);
  await logoutPage.getByRole('button', { name: 'Log out', exact: true }).waitFor();
  assert.equal(await logoutPage.evaluate(() => navigator.onLine), true);
  await writeFile(resolve(artifacts!, 'logout-tab.json'), JSON.stringify({ url: logoutPage.url(), logoutButtons: await logoutPage.getByRole('button', { name: 'Log out', exact: true }).count(), body: await logoutPage.locator('body').innerText() }, null, 2));
  assert.equal(await logoutPage.getByRole('button', { name: 'Log out', exact: true }).count(), 1);
  let releaseRoot!: () => void, rootHeld!: () => void;
  const rootGate = new Promise<void>(resolve => { releaseRoot = resolve; }), pendingRoot = new Promise<void>(resolve => { rootHeld = resolve; });
  await page.route('**/api/root-data', async (route: any) => { rootHeld(); await rootGate; try { await route.continue(); } catch { /* A newer pending root refresh can supersede this one. */ } });
  await page.evaluate(() => { (window as any).__audioBeforeIdentity = document.querySelector('audio'); });
  const pendingDiagnostic = () => page.evaluate(() => { const old = (window as any).__audioBeforeIdentity as HTMLAudioElement | undefined; return { body: document.body.innerText, mountedAudioCount: document.querySelectorAll('audio').length, sourceCount: document.querySelectorAll('audio source[src]').length, old: old ? { connected: old.isConnected, paused: old.paused, currentSrc: old.currentSrc, srcAttribute: old.getAttribute('src'), sources: [...old.querySelectorAll('source')].map(source => source.getAttribute('src')), readyState: old.readyState, networkState: old.networkState } : null }; });
  await writeFile(resolve(artifacts!, 'before-pending-root.json'), JSON.stringify(await pendingDiagnostic(), null, 2));
  // The real logout UI broadcasts rootIdentity.changed() from another tab.
  // Keep this page's actual root response pending. The root may retain stale
  // post metadata or unmount it; neither path may leave native playback alive.
  await logoutPage.getByRole('button', { name: 'Log out', exact: true }).click();
  await Promise.race([pendingRoot, page.waitForTimeout(30_000).then(() => { throw Error('Main page did not start its pending root refresh after real second-tab logout.'); })]);
  await writeFile(resolve(artifacts!, 'pending-root-start.json'), JSON.stringify(await pendingDiagnostic(), null, 2));
  try { await page.waitForFunction(() => { const old = (window as any).__audioBeforeIdentity as HTMLAudioElement; return !document.querySelector('audio source[src]') && old.paused && old.readyState === 0 && old.networkState === 3 && !old.getAttribute('src') && !old.querySelector('source[src]'); }, undefined, { timeout: 5_000 }); }
  catch (error) { await writeFile(resolve(artifacts!, 'pending-root-failed.json'), JSON.stringify(await pendingDiagnostic(), null, 2)); throw error; }
  const pendingState = await pendingDiagnostic();
  assert.equal(pendingState.sourceCount, 0); assert.equal(pendingState.old?.paused, true); assert.equal(pendingState.old?.readyState, 0); assert.equal(pendingState.old?.networkState, 3); assert.equal(pendingState.old?.srcAttribute, null); assert.deepEqual(pendingState.old?.sources, [null]);
  const retiredPlayback = await page.evaluate(async () => {
   const old = (window as any).__audioBeforeIdentity as HTMLAudioElement; let playingEvents = 0; old.addEventListener('playing', () => playingEvents++);
   const playback = old.play().then(() => 'played', (error: DOMException) => error.name);
   const beforeCancellation = await Promise.race([playback, new Promise<string>(resolve => setTimeout(() => resolve('pending without source'), 250))]);
   const nativeState = { readyState: old.readyState, networkState: old.networkState, srcAttribute: old.getAttribute('src'), sources: [...old.querySelectorAll('source')].map(source => source.getAttribute('src')) };
   old.pause(); old.load(); const playResult = await Promise.race([playback, new Promise<string>(resolve => setTimeout(() => resolve('cancellation timed out'), 1_000))]);
   return { beforeCancellation, nativeState, playResult, playingEvents, paused: old.paused };
  });
  await writeFile(resolve(artifacts!, 'retired-playback.json'), JSON.stringify(retiredPlayback, null, 2));
  assert.equal(retiredPlayback.beforeCancellation, 'pending without source'); assert.equal(retiredPlayback.nativeState.readyState, 0); assert.equal(retiredPlayback.nativeState.networkState, 3); assert.equal(retiredPlayback.nativeState.srcAttribute, null); assert.deepEqual(retiredPlayback.nativeState.sources, [null]); assert.equal(retiredPlayback.playResult, 'AbortError'); assert.equal(retiredPlayback.playingEvents, 0); assert.equal(retiredPlayback.paused, true);
  release!(); await page.waitForTimeout(300); assert.equal(await page.locator('audio source[src]').count(), 0, 'Late saved bytes cannot reopen a source while identity is unresolved');
  await writeFile(resolve(artifacts!, 'pending-root.json'), JSON.stringify(pendingState, null, 2));
  console.log('Audio checkpoint: pending root has no native source');
  releaseRoot(); await page.unroute('**/api/root-data'); await logoutPage.close(); await waitIdentity(null); await page.waitForTimeout(300);
  assert.ok(!(await source())?.startsWith('blob:')); assert.equal(await page.getByRole('button', { name: 'Use streaming', exact: true }).count(), 0);
  await click('2. fixture-track-2.wav'); assert.equal(await page.getByRole('button', { name: 'Use offline copy', exact: true }).count(), 0, 'Anonymous playback cannot adopt the owner cache');
  await click('Save full file offline'); await page.getByRole('button', { name: 'Use streaming', exact: true }).waitFor(); assert.ok((await source())?.startsWith('blob:'), 'Ordinarily authorized public audio remains saveable anonymously');
  await online(true); await page.reload(); await page.getByRole('button', { name: '2. fixture-track-2.wav', exact: true }).click(); await click('Use offline copy'); assert.ok((await source())?.startsWith('blob:'));
  const offlineDecoded = await page.locator('audio').first().evaluate(async (audio: HTMLAudioElement) => { await audio.play(); return { duration: audio.duration, readyState: audio.readyState, paused: audio.paused }; }); assert.equal(offlineDecoded.duration, 1); assert.ok(offlineDecoded.readyState >= 2); assert.equal(offlineDecoded.paused, false); await page.locator('audio').first().evaluate((audio: HTMLAudioElement) => audio.pause());
  await online(false); assert.equal((await call(page, '/api/v1/login', { username, password })).status, 200); await waitIdentity(ownerId); await click('2. fixture-track-2.wav'); await click('Use offline copy'); assert.ok((await source())?.startsWith('blob:'));
  await click('Remove offline copy'); await page.getByRole('button', { name: 'Save full file offline', exact: true }).waitFor(); assert.ok(!(await source())?.startsWith('blob:'));
  assert.deepEqual(errors, []); await Promise.all(moduleChecks); assert.ok(servedModules.some(module => module.path.endsWith('.js')));
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return { status: document.fonts.status, bodyFamily: getComputedStyle(document.body).fontFamily, faces: [...document.fonts].map(face => ({ family: face.family, status: face.status })) }; });
  await writeFile(resolve(artifacts!, 'served-modules.json'), JSON.stringify({ servedModules, fonts }, null, 2));
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ postId, attachments: ids, selectedTrackRaceFenced: true, ownerToAnonymousRaceFenced: true, pendingRootSourceRemoved: true, equivalentRefreshPreserved: true, exactOriginalSha256: createHash('sha256').update(files[1]).digest('hex'), anonymousPublicSave: true, offlineReloadPlayback: true, decoded, offlineDecoded, removal: true, boundaries, requests, audioResponses, errors }, null, 2));
 } catch (error) { release?.(); await Promise.allSettled(moduleChecks); await writeFile(resolve(artifacts!, 'served-modules-partial.json'), JSON.stringify({ servedModules }, null, 2)); await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ message: String(error), body: await page.locator('body').innerText().catch(() => ''), postId, ids, requests, audioResponses, errors }, null, 2)); throw error; }
 finally { await author.close(); await admin.close(); await context.close(); await browser.close(); }
});
