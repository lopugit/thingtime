import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_POST_DELETE_ORIGIN, session = process.env.TT_POST_DELETE_SESSION, artifacts = process.env.TT_POST_DELETE_ARTIFACTS;
test('native PostCard deletion persists anonymously and across account offline reload, cancellation and lost replies', { skip: !base || !session || !artifacts, timeout: 300_000 }, async () => {
 assert.equal(new URL(base ).hostname, '127.0.0.1');
 const health = await (await fetch(base + '/api/v1/health/nitro')).json(); assert.equal(health.testEnvironment.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment.sessionId, session);
 const selectedPhase = process.env.TT_POST_DELETE_PHASE || 'combined'; assert.ok(['combined', 'anonymous', 'account'].includes(selectedPhase), 'Choose an explicit supported fixture phase');
 const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH );
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true, args: ['--no-proxy-server', '--disable-background-networking', '--js-flags=--max-old-space-size=128'] });
 await mkdir(artifacts , { recursive: true });
 const checks           = [], bounds            = [], mutations        = [], errors           = []; let currentPhase               = () => '', current     , releaseHeldDelete             = () => {}; 
 try {
  for (const account of selectedPhase === 'account' ? [true] : selectedPhase === 'anonymous' ? [false] : [false, true]) {
   let phase = ''; currentPhase = () => phase;
   const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); current = page;
   await context.addInitScript(() => {
    const events            = []; (window       ).__postQuoteTransitions = events;
    for (const capture of [true, false]) for (const type of ['pointerdown', 'click', 'focusin', 'keydown']) document.addEventListener(type, event => {
     const target = event.target instanceof Element ? event.target.closest('button,[role="menuitem"],textarea') : null;
     const label = target?.getAttribute('aria-label'), placeholder = target?.getAttribute('placeholder'), menuText = target?.getAttribute('role') === 'menuitem' ? target.textContent?.trim() : null;
     if (label !== 'Repost' && placeholder !== 'Add your thoughts…' && menuText !== 'Quote post ✏️' && !(event instanceof KeyboardEvent && event.key === 'Escape')) return;
     const trigger = document.querySelector('button[aria-label="Repost"]'), textarea = document.querySelector('textarea[placeholder="Add your thoughts…"]');
     const active = document.activeElement; const menus = Array.from(document.querySelectorAll('[role=menu]')).map(menu => ({ expanded: menu.getAttribute('aria-expanded'), hidden: menu.getAttribute('aria-hidden'), dataState: menu.getAttribute('data-state'), visibility: getComputedStyle(menu).visibility, display: getComputedStyle(menu).display }));
     events.push({ type, capture, defaultPrevented: event.defaultPrevented, trusted: event.isTrusted, path: event.composedPath().filter(value => value instanceof Element).slice(0, 6).map(value => ({ tag: (value           ).tagName, role: (value           ).getAttribute('role'), label: (value           ).getAttribute('aria-label') })), active: { tag: active?.tagName, label: active?.getAttribute('aria-label'), placeholder: active?.getAttribute('placeholder') }, menus, at: performance.now(), target: { tag: target?.tagName, label, placeholder, menuText }, key: event instanceof KeyboardEvent ? event.key : undefined, repostExpanded: trigger?.getAttribute('aria-expanded'), quotePresent: !!textarea, quoteVisible: !!textarea && getComputedStyle(textarea).visibility !== 'hidden' && textarea.getBoundingClientRect().height > 0 });
     if (events.length > 100) events.shift();
    }, capture);
   });
   const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); let offline = false, ownerId = '';
   const records = () => page.evaluate(async ({ account, ownerId }     ) => { const scope = JSON.stringify(account ? ['account', location.origin, ownerId, 'home'] : ['anonymous', 1]); const db = await new Promise             ((resolve, reject) => { const r = indexedDB.open('thingtime.local-workspaces.v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); try { return await new Promise       ((resolve, reject) => { const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result.filter((row     ) => row.scope === scope)); r.onerror = () => reject(r.error); }); } finally { db.close(); } }, { account, ownerId });
   const api = async (pathname        , data      ) => { const r = await page.evaluate(async ({ pathname, data }     ) => { const response = await fetch(pathname, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined); return { status: response.status, body: await response.json() }; }, { pathname: new URL(pathname, base).pathname + new URL(pathname, base).search, data }); return { status: () => r.status, json: async () => r.body }; };
   const queueSnapshot = async () => (await records()).filter((r     ) => r.collection === 'thing-sync').map((r     ) => ({ id: r.id, scope: r.scope, state: r.value.state, deleted: r.value.deleted, phase: r.value.phase, retryAt: r.value.retryAt, claimExpiresAt: r.value.claim?.expiresAt, pendingMethod: r.value.pending?.method, error: r.value.error, baseId: r.value.base?.id, targetId: r.value.local?.targetId, inFlight: r.value.inFlight ? { method: r.value.inFlight.method, id: r.value.inFlight.id, attempted: r.value.inFlight.attempted } : null }));
   const settled = async () => { for (let n = 0; n < 100; n++) { const rows = await records(); if (!rows.some((r     ) => r.collection === 'thing-sync' && r.value.state !== 'synced')) return; await page.waitForTimeout(300); } throw Error('Deletion queue did not settle'); };
   const connectivity = async (value         ) => { offline = value; await context.setOffline(value); await cdp.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
   page.setDefaultTimeout(20_000); page.on('pageerror', (e       ) => errors.push(e.message));
   page.on('request', (r     ) => { if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(r.method()) && new URL(r.url()).pathname.startsWith('/api/v1/things')) mutations.push({ phase, offline, method: r.method(), body: r.postDataJSON() }); });
   const ready = () => page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
   const create = async (text        , media = false) => {
    await page.goto(base + '/feed'); await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).click();
    if (account) await page.getByLabel('Who can see this post', { exact: true }).selectOption('private');
    if (media) { await page.getByRole('button', { name: '🖼️ Photos', exact: true }).click(); const buffer = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d') .fillRect(0, 0, 20, 20); return c.toDataURL('image/png').split(',')[1]; }), 'base64'); await page.locator('input[type=file]').first().setInputFiles({ name: 'delete-fixture.png', mimeType: 'image/png', buffer }); await page.getByText('delete-fixture.png', { exact: true }).first().waitFor(); }
    await page.locator('.ce-paragraph[contenteditable="true"]').first().fill(text); await page.getByRole('button', { name: account ? 'Post ✨' : 'Save on this device', exact: true }).click();
    if (!account) { await page.waitForURL((url     ) => url.pathname.startsWith('/post/')); return new URL(page.url()).pathname.split('/').pop() ; } const card = page.locator('[data-thing-id]').filter({ hasText: text }).first(); await card.waitFor(); const id = await card.getAttribute('data-thing-id'); assert.ok(id); return id;
   };
   const reviewQuoteLayout = async (width        ) => {
    const repost = page.getByRole('button', { name: 'Repost', exact: true }).first();
    const quote = page.getByPlaceholder('Add your thoughts…', { exact: true });
    const beforeWrites = mutations.length, beforeIds = (await records()).filter((row     ) => row.collection === 'things').map((row     ) => row.id).sort();
    const measure = async (stage        ) => {
     const result = await repost.evaluate((trigger             ) => {
      const describe = (element             ) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft, overflowX: getComputedStyle(element).overflowX }; };
      const main = document.querySelector             ('.mainFlexChildrenContainer'); if (!main) throw Error('Main container is missing');
      const actions = trigger.parentElement .parentElement ;
      let card                     = actions; while (card && Number.parseFloat(getComputedStyle(card).borderTopWidth) < 1) card = card.parentElement;
      if (!card) throw Error('Post card is missing');
      const hiddenAncestors = []; for (let current                     = trigger; current; current = current.parentElement) if (['hidden', 'clip'].includes(getComputedStyle(current).overflowX)) hiddenAncestors.push(describe(current));
      const active = document.activeElement;
      const popup = document.querySelector             ('.chakra-popover__content:has(textarea[placeholder="Add your thoughts…"])');
      return { viewport: innerWidth, main: describe(main), card: describe(card), actions: describe(actions), hiddenAncestors, popup: popup ? describe(popup) : null, repostExpanded: trigger.getAttribute('aria-expanded'), recentTransitions: (window       ).__postQuoteTransitions?.slice(-15), focus: { tag: active?.tagName, label: active?.getAttribute('aria-label'), placeholder: active?.getAttribute('placeholder') } };
     });
     bounds.push({ phase, width, quoteStage: stage, ...result });
     for (const [name, value] of Object.entries({ main: result.main, card: result.card, actions: result.actions })) {
      assert.equal(value.scrollLeft, 0, `${name} shifts horizontally during quote ${stage}`);
      assert.ok(value.scrollWidth <= value.clientWidth + 1, `${name} has hidden overflow during quote ${stage}: ${JSON.stringify(value)}`);
     }
     assert.ok(result.hiddenAncestors.every((value     ) => value.scrollLeft === 0), `A hidden ancestor shifted during quote ${stage}`);
     if (stage === 'open') { assert.ok(result.popup); assert.ok(result.popup.left >= -1 && result.popup.right <= width + 1, 'The open quote composer must fit the viewport'); }
     return result;
    };
    const open = async () => { await repost.click(); await page.getByRole('menuitem', { name: 'Quote post ✏️', exact: true }).click(); await quote.waitFor(); await quote.focus(); assert.equal(await quote.evaluate((element             ) => element === document.activeElement), true); };
    await measure('before'); await open(); await measure('open'); await page.screenshot({ path: resolve(artifacts , `${phase}-quote-open-${width}.png`) });
    await page.keyboard.press('Escape'); await quote.waitFor({ state: 'hidden' }); await measure('after-escape');
    await repost.focus(); await repost.scrollIntoViewIfNeeded(); assert.equal(await repost.evaluate((element             ) => element === document.activeElement), true); await measure('trigger-focused');
    await open(); await page.getByRole('heading', { name: 'Post 📌', exact: true }).click(); await quote.waitFor({ state: 'hidden' }); await measure('after-outside-close'); await page.screenshot({ path: resolve(artifacts , `${phase}-quote-closed-${width}.png`) });
    assert.equal(mutations.length, beforeWrites, 'Opening, focusing and dismissing a quote must not mutate account content');
    assert.deepEqual((await records()).filter((row     ) => row.collection === 'things').map((row     ) => row.id).sort(), beforeIds, 'Dismissed quote controls must not create local Things');
   };
   const menuDelete = async (id        , text        ) => {
    await page.goto(base + '/post/' + id); await page.getByText(text, { exact: true }).waitFor();
    for (const width of [1440, 390, 320]) {
     await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
     await page.evaluate(async () => { for (const root of [document.scrollingElement , ...Array.from(document.querySelectorAll             ('body *')).filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)]) { if (root.scrollHeight > 40000) throw Error('Recursive content'); for (let top = 0; top <= root.scrollHeight; top += Math.max(200, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); if (document.documentElement.scrollWidth > innerWidth) throw Error('Overflow'); } root.scrollTop = 0; } });
     if (account) await reviewQuoteLayout(width);
     await page.getByRole('button', { name: 'Post options', exact: true }).first().click(); await page.getByRole('menuitem', { name: /^(?:🗑️\s*)?Delete$/ }).waitFor();
     const layout = await page.evaluate(() => { const main = document.querySelector             ('.mainFlexChildrenContainer'); if (!main) throw Error('Main layout container is missing'); const rect = main.getBoundingClientRect(); return { documentWidth: document.documentElement.scrollWidth, main: { left: rect.left, right: rect.right, clientWidth: main.clientWidth, scrollWidth: main.scrollWidth, scrollLeft: main.scrollLeft, overflowX: getComputedStyle(main).overflowX } }; });
     bounds.push({ phase, width, ...layout }); await page.screenshot({ path: resolve(artifacts , `${phase}-menu-${width}.png`) });
     assert.equal(layout.main.scrollLeft, 0, 'Opening the post menu must not shift content within a hidden overflow container');
     assert.ok(layout.main.scrollWidth <= layout.main.clientWidth + 1, `Post descendants overflow the main container: ${JSON.stringify(layout.main)}`);
     if (width !== 320) await page.keyboard.press('Escape');
    }
    await page.getByRole('menuitem', { name: /^(?:🗑️\s*)?Delete$/ }).click(); await page.getByText(text, { exact: true }).waitFor({ state: 'hidden' });
    await page.reload(); await page.getByText(text, { exact: true }).waitFor({ state: 'hidden' }); checks.push(phase + ': offline delete and cold reload');
   };
   await connectivity(false);
   if (account) { await page.goto(base + '/feed'); const username = 'delete-' + randomUUID().slice(0, 8), password = randomUUID() + randomUUID(); const r = await api('/api/v1/auth/register', { username, email: username + '@example.test', password }); assert.equal(r.status(), 200); ownerId = (await r.json()).user.id; const login = await api('/api/v1/login', { username, password }); assert.equal(login.status(), 200); assert.equal((await login.json()).user.id, ownerId); }
   await page.goto(base + '/feed'); await ready();
   if (!account) {
    phase = 'anonymous'; await connectivity(true); const text = 'Anonymous post and media deleted on device.'; const id = await create(text, true);
    await page.goto(base + '/post/' + id); await page.getByText(text, { exact: true }).waitFor();
    await page.getByPlaceholder('Write a comment… 💬', { exact: true }).fill('Anonymous child removed with parent.'); await page.getByPlaceholder('Write a comment… 💬', { exact: true }).press('Enter'); await page.getByRole('paragraph').filter({ hasText: 'Anonymous child removed with parent.' }).waitFor();
    const beforeDelete = await records(); const removedIds = beforeDelete.filter((r     ) => r.collection === 'things').map((r     ) => r.id); assert.ok(removedIds.length >= 3); await menuDelete(id, text); const afterDelete = await records(); assert.equal(afterDelete.filter((r     ) => ['things', '@bytes'].includes(r.collection) && removedIds.includes(r.id)).length, 0); checks.push('anonymous: exact post/comment/media/bytes removed'); await page.getByRole('paragraph').filter({ hasText: 'Anonymous child removed with parent.' }).waitFor({ state: 'hidden' });
    assert.equal(mutations.filter(r => r.phase === phase).length, 0); checks.push('anonymous: no HTTP mutation');
   } else {
    phase = 'account'; const text = 'Synthetic owner post deleted offline.';
    const r = await api('/api/v1/things', { thingtime: ['post'], crystal: { type: 'text', text }, visibility: 'private' }); assert.equal(r.status(), 200); const created = await r.json(), id = created.thing?.id || created.post?.id || created.id; assert.ok(id, 'Canonical create returned an identity');
    const retainedText = 'Unrelated retained post proves live Feed rendering.'; const retained = await api('/api/v1/things', { thingtime: ['post'], crystal: { type: 'text', text: retainedText }, visibility: 'private' }); assert.equal(retained.status(), 200);
    await page.goto(base + '/post/' + id); await page.getByText(text, { exact: true }).waitFor();
    await page.getByPlaceholder('Write a comment… 💬', { exact: true }).fill('Account child removed with parent.'); await page.getByPlaceholder('Write a comment… 💬', { exact: true }).press('Enter'); await page.getByRole('paragraph').filter({ hasText: 'Account child removed with parent.' }).waitFor();
    await settled(); let children           = []; for (let n = 0; n < 60; n++) { const comments = await api(base + '/api/v1/things?target=' + id + '&thingtime=comment&commentProjection=true&limit=20'); children = (await comments.json()).comments.map((row     ) => row.id); if (children.length === 1) break; await page.waitForTimeout(300); } assert.equal(children.length, 1);
    await page.reload(); await page.getByRole('paragraph').filter({ hasText: 'Account child removed with parent.' }).waitFor(); await connectivity(true); await menuDelete(id, text); await page.getByRole('paragraph').filter({ hasText: 'Account child removed with parent.' }).waitFor({ state: 'hidden' });
    let lost = false, gateEntered = false, gateReleased = false;
    const deletes        = [];
    let enterDelete             , releaseDelete             ;
    const entered = new Promise      (resolve => { enterDelete = resolve; });
    const gate = new Promise      (resolve => { releaseDelete = resolve; });
    let gateTimer                                           ;
    const releaseCurrentDelete = () => { gateReleased = true; clearTimeout(gateTimer); releaseDelete(); }; releaseHeldDelete = releaseCurrentDelete;
    await context.route('**/api/v1/things**', async (route     ) => {
     if (route.request().method() !== 'DELETE') return route.continue();
     const body = route.request().postDataJSON(); deletes.push(body);
     if (!gateEntered) {
      gateEntered = true; gateTimer = setTimeout(releaseCurrentDelete, 30_000); enterDelete();
      await gate;
      const response = await route.fetch(); assert.equal(response.status(), 200);
      lost = true; await route.abort('connectionfailed');
     } else await route.continue();
    });
    await connectivity(false); await page.reload(); assert.equal(await page.evaluate(() => navigator.onLine), true);
    await writeFile(resolve(artifacts , 'reconnected-queue.json'), JSON.stringify(await queueSnapshot(), null, 2));
    let enteredTimer                                           ;
    try { await Promise.race([entered, new Promise       ((_, reject) => { enteredTimer = setTimeout(() => reject(Error('The first account DELETE was not attempted')), 100_000); })]); }
    finally { clearTimeout(enteredTimer); }
    // Holding the first DELETE makes this assertion independent of server speed.
    // The unrelated server post proves that this is the rendered live Feed.
    const feedPage = await context.newPage(); current = feedPage; feedPage.on('pageerror', (error       ) => errors.push(error.message)); const feedNetwork = await context.newCDPSession(feedPage); await feedNetwork.send('Network.enable'); await feedNetwork.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); const feedLoaded = feedPage.waitForResponse((response     ) => new URL(response.url()).pathname === '/api/v1/things/feed' && response.status() === 200);
    await feedPage.goto(base + '/feed'); assert.equal(await feedPage.evaluate(() => navigator.onLine), true); const liveFeedResponse = await feedLoaded; const liveFeed = await liveFeedResponse.json(); assert.ok(liveFeed.posts.some((post     ) => post.id === id), 'Canonical live Feed still contains the held deletion'); await writeFile(resolve(artifacts , 'held-live-feed-receipt.json'), JSON.stringify({ status: liveFeedResponse.status(), postIds: liveFeed.posts.map((post     ) => post.id), heldDeletedId: id }, null, 2));
    await feedPage.getByText(retainedText, { exact: true }).waitFor();
    assert.equal(gateReleased, false, 'The deletion must remain held during the Feed assertion');
    assert.equal(await feedPage.getByText(text, { exact: true }).count(), 0, 'A pending tombstone stays hidden in the rendered live Feed');
    await writeFile(resolve(artifacts , 'held-delete-queue.json'), JSON.stringify(await queueSnapshot(), null, 2));
    await feedPage.screenshot({ path: resolve(artifacts , 'account-live-feed-pending.png') });
    checks.push('account: live Feed masks pending tombstone while DELETE is held and unrelated post renders');
    releaseHeldDelete(); await feedPage.close(); current = page;
    for (let n = 0; n < 190; n++) { if (lost && (await api(base + '/api/v1/things?id=' + id)).status() === 404) break; await page.waitForTimeout(500); }
    await writeFile(resolve(artifacts , 'post-wait-queue.json'), JSON.stringify(await queueSnapshot(), null, 2)); assert.equal(lost, true); for (const deleted of [id, ...children]) assert.equal((await api(base + '/api/v1/things?id=' + deleted)).status(), 404);
    await settled(); await page.reload(); await page.getByText(text, { exact: true }).waitFor({ state: 'hidden' }); await settled(); checks.push('account: lost DELETE reply and exact parent/child server absence'); await context.unroute('**/api/v1/things**');
    phase = 'pending'; await page.goto(base + '/feed'); await connectivity(true); const pendingText = 'Pending create cancelled before reconnect.'; const pendingId = await create(pendingText, true); await menuDelete(pendingId, pendingText); await connectivity(false); await page.reload(); await page.waitForTimeout(2000); assert.equal((await api(base + '/api/v1/things?id=' + pendingId)).status(), 404); assert.equal(mutations.filter(r => r.phase === 'pending' && (r.method !== 'POST' || r.body?.crystal || r.body?.shareId || r.body?.attachmentIds)).length, 0); await settled(); checks.push('pending: local post/media cancelled without server create');
    await writeFile(resolve(artifacts , 'account-deletes.json'), JSON.stringify(deletes, null, 2));
   }
   await context.close();
  }
  assert.deepEqual(errors, []); assert.equal(mutations.filter(row => row.offline).length, 0); await writeFile(resolve(artifacts , 'verification.json'), JSON.stringify({ selectedPhase: process.env.TT_POST_DELETE_PHASE || 'combined', checks, bounds, mutations, errors }, null, 2));
 } catch (error) { await current?.screenshot({ path: resolve(artifacts , 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(resolve(artifacts , 'failure.json'), JSON.stringify({ phase: currentPhase(), error: String(error), body: await current?.locator('body').innerText().catch(() => ''), quoteTransitions: await current?.evaluate(() => (window       ).__postQuoteTransitions || []).catch(() => []), checks, bounds, mutations, errors }, null, 2)); throw error; }
 finally { releaseHeldDelete(); await browser.close(); }
});
