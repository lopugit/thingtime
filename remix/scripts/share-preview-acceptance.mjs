#!/usr/bin/env node
// Real API/browser acceptance in a disposable replica, account and browser.
// No production env files, credentials, personal profiles or application data.
// Prerequisite: a current node-server Nitro build. Browser UI uses isolated Vite.
// SHARE_PREVIEW_EVIDENCE_DIR is required; PLAYWRIGHT_MODULE,
// CHROMIUM_EXECUTABLE and THINGTIME_TEST_MONGOD may select installed tooling.
// SHARE_PREVIEW_ACCEPTANCE_SCOPE=contrast runs only the final contrast/copy
// feedback observations after previously passing the complete acceptance.
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { Resvg } from '@resvg/resvg-js';

if (process.argv.includes('--browser-worker')) { await browserAcceptance(); process.exit(); }
const source = fileURLToPath(new URL('..', import.meta.url));
const evidence = process.env.SHARE_PREVIEW_EVIDENCE_DIR;
assert(evidence, 'Set SHARE_PREVIEW_EVIDENCE_DIR to retain acceptance evidence.');
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'tt-share-preview-'));
const ports = { api: 26871, db: 26872, web: 26873, hmr: 26874 };
const origin = `http://127.0.0.1:${ports.api}`;
const username = 'share-preview-acceptance';
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Keep process configuration explicit; never inherit provider/production env.
const runtime = { PATH: process.env.PATH, TMPDIR: temporary, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=share_preview`,
  JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
  THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(temporary, 'attachments'), TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
function start(command, args, extra = {}, cwd = temporary) {
  const child = spawn(command, args, { cwd, detached: true, env: { ...runtime, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data);
  const result = { child, log: () => log }; children.push(result); return result;
}
async function stop(running) {
  const kill = signal => { try { process.kill(-running.child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  const exited = running.child.exitCode !== null || running.child.signalCode !== null;
  const exit = exited ? Promise.resolve() : once(running.child, 'exit');
  kill('SIGTERM'); const forced = setTimeout(() => kill('SIGKILL'), 3000);
  await exit; clearTimeout(forced); kill('SIGKILL');
}
async function ready(running, target = origin) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (running.child.exitCode !== null) throw new Error(running.log());
    try { if ((await fetch(`${target}/.well-known/thingtime-capabilities.json`, { signal: AbortSignal.timeout(700) })).ok) return; } catch { /* bounded readiness */ }
    await delay(200);
  }
  throw new Error(`Server readiness failed: ${running.log()}`);
}
async function api(path, body, cookie) {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); assert.equal(response.status, 200, `${path}: ${JSON.stringify(data)}`);
  return { data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
let mongoClient, server, database;
try {
  for (const port of Object.values(ports)) { const socket = createServer(); await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => socket.close(resolve)); }
  await mkdir(join(temporary, 'db'));
  database = start(process.env.THINGTIME_TEST_MONGOD || 'mongod', ['--dbpath', join(temporary, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'share_preview', '--nounixsocket']);
  mongoClient = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  for (let attempt = 0;; attempt++) { try { await mongoClient.connect(); break; } catch (error) { if (attempt > 30) throw error; await delay(250); } }
  // Infrastructure only. All product identities/content/media use real APIs.
  await mongoClient.db('admin').command({ replSetInitiate: { _id: 'share_preview', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  for (let attempt = 0;; attempt++) { if ((await mongoClient.db('admin').command({ hello: 1 })).isWritablePrimary) break; assert(attempt < 100); await delay(200); }
  await mongoClient.close();
  server = start(process.execPath, [join(source, '.output/server/index.mjs')]); await ready(server);
  const registration = await api('/api/v1/auth/register', { username, email: `${username}@example.invalid`, displayName: 'Preview Test Owner', password: randomBytes(24).toString('hex') });
  const cookie = registration.cookie;
  // Environment-admin names are reserved during registration. Promote only
  // after the real local signup; this grants disposable upload approval.
  await stop(server); server = start(process.execPath, [join(source, '.output/server/index.mjs')], { ADMIN_USERNAMES: username }); await ready(server);
  const publicPage = (await api('/api/v1/things', { thingtime: ['webpage'], acl: ['tt:all'], crystal: { name: 'Untitled page', blocks: [{ id: 'heading', type: 'text', style: 'heading', text: 'A live page from independent saved blocks' }, { id: 'body', type: 'text', text: 'An independently saved description for browser acceptance.' }] } }, cookie)).data.thing;
  const privatePage = (await api('/api/v1/things', { thingtime: ['webpage'], acl: ['tt:user'], crystal: { name: 'Never disclose private acceptance content', blocks: [{ id: 'secret', type: 'text', text: 'Private acceptance detail' }] } }, cookie)).data.thing;
  const attachments = [];
  for (const [index, colour] of ['#b22672', '#086d68'].entries()) {
    const bytes = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${colour}"/><circle cx="300" cy="200" r="130" fill="#f4e8b7"/></svg>`).render().asPng();
    const upload = (await api('/api/v1/attachments/uploads', { requestId: randomUUID(), filename: `Preview source ${index + 1}.png`, contentType: 'image/png', sizeBytes: bytes.length, purpose: 'post' }, cookie)).data.upload;
    const parts = (await api('/api/v1/attachments/uploads/parts', { uploadId: upload.id, parts: [{ partNumber: 1, checksumSha256: createHash('sha256').update(bytes).digest('base64') }] }, cookie)).data.parts;
    for (const part of parts) { const target = new URL(part.url, origin); assert.equal(target.origin, origin); const response = await fetch(target, { method: 'PUT', headers: part.headers, body: bytes }); assert(response.ok); }
    const completed = (await api('/api/v1/attachments/uploads/complete', { uploadId: upload.id }, cookie)).data.attachment;
    assert(completed?.id); attachments.push(completed.id);
  }
  const post = (await api('/api/v1/things', { type: 'text', text: 'A real two-photo post from the isolated acceptance API.', visibility: 'public', attachmentIds: attachments }, cookie)).data.post;
  assert(post?.id);
  const manifest = (await (await fetch(`${origin}/.well-known/thingtime-capabilities.json`)).json());
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.features['api.social-previews'].version, '1.2.0');
  assert.equal(manifest.features['api.social-card'].version, '1.4.0');
  const pageReadback = (await api(`/api/v1/things?id=${publicPage.id}`, undefined, cookie)).data.thing;
  const postReadback = (await api(`/api/v1/things?id=${post.id}`, undefined, cookie)).data.post;
  assert.equal(postReadback.text, post.text);
  const pageMeta = (await api(`/api/v1/social-previews?path=${encodeURIComponent('/p/' + publicPage.id)}`)).data;
  assert.equal(pageMeta.title, `${pageReadback.crystal.blocks[0].text} on Thingtime`);
  const privateMeta = (await api(`/api/v1/social-previews?path=${encodeURIComponent('/p/' + privatePage.id)}`, undefined, cookie)).data;
  assert.equal(privateMeta.publicContent, false);
  assert.doesNotMatch(JSON.stringify(privateMeta), /Never disclose|Private acceptance detail/);
  await writeFile(join(evidence, 'api-evidence.json'), JSON.stringify({ isolatedOrigin: origin, publicPageId: publicPage.id, privatePageId: privatePage.id, postId: post.id, attachments, pageTitle: pageMeta.title, postText: postReadback.text, privateAnonymousFallback: true, capabilities: { 'api.social-previews': '1.2.0', 'api.social-card': '1.4.0' } }, null, 2));
  const vite = start(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`], { NODE_ENV: 'development' }, source);
  const webOrigin = `http://127.0.0.1:${ports.web}`; await ready(vite, webOrigin);
  const fixture = join(temporary, 'browser-fixture.json');
  await writeFile(fixture, JSON.stringify({ origin: webOrigin, apiOrigin: origin, cookie, publicPageId: publicPage.id, privatePageId: privatePage.id, postId: post.id }), { mode: 0o600 });
  const extra = Object.fromEntries(Object.entries({ PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE: process.env.CHROMIUM_EXECUTABLE, SHARE_PREVIEW_EVIDENCE_DIR: evidence, SHARE_PREVIEW_ACCEPTANCE_SCOPE: process.env.SHARE_PREVIEW_ACCEPTANCE_SCOPE }).filter(([, value]) => value));
  const browser = start(process.execPath, [join(source, 'scripts/share-preview-acceptance.mjs'), '--browser-worker', fixture], extra, source);
  const timeout = setTimeout(() => { try { process.kill(-browser.child.pid, 'SIGTERM'); } catch {} }, 600000);
  const [code] = await once(browser.child, 'exit'); clearTimeout(timeout); assert.equal(code, 0, browser.log()); console.log(browser.log());
} catch (error) {
  console.error(error.message); process.exitCode = 1;
  if (server) await writeFile(join(evidence, 'server.log'), server.log(), { mode: 0o600 });
  if (database) await writeFile(join(evidence, 'database.log'), database.log(), { mode: 0o600 });
} finally {
  await mongoClient?.close();
  for (const running of children.reverse()) await stop(running);
  await rm(temporary, { recursive: true, force: true });
}

async function browserAcceptance() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const fixture = JSON.parse(await readFile(process.argv.at(-1), 'utf8'));
  const out = process.env.SHARE_PREVIEW_EVIDENCE_DIR;
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addCookies(fixture.cookie.split('; ').map(pair => { const index = pair.indexOf('='); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }; }));
  const page = await context.newPage(); const errors = [], inviteWrites = [], checks = [], colours = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/api\/v1\/auth\/invites/.test(request.url()) && request.method() === 'POST') { const intent = request.postDataJSON()?.intent; if (!['list', 'create'].includes(intent)) inviteWrites.push(intent); } });
  const dialog = page.getByTestId('share-preview-dialog');
  const image = dialog.locator('img[data-block-id="share-image"]');
  const waitReady = async () => { await dialog.getByRole('status').filter({ hasText: 'Preview ready' }).waitFor({ timeout: 90000 }); await image.waitFor(); assert(await image.evaluate(node => node.complete && node.naturalWidth === 1200 && node.naturalHeight === 630)); };
  const choose = async (label, key, value) => {
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(({ key, value }) => { const image = document.querySelector('img[data-block-id="share-image"]'); return image?.getAttribute('src') && new URL(image.src).searchParams.get(key) === value && image.complete; }, { key, value }, { timeout: 90000 });
    await waitReady();
  };
  const open = async href => { await page.evaluate(href => window.dispatchEvent(new CustomEvent('thingtime:share-preview', { detail: { href } })), href); await dialog.waitFor(); await waitReady(); };
  const close = async () => { await dialog.getByRole('button', { name: 'Close share preview', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
  const inspect = async name => {
    await dialog.evaluate(async node => { for (const surface of [node, ...node.querySelectorAll('*')].filter(item => item.scrollHeight > item.clientHeight && /auto|scroll/.test(getComputedStyle(item).overflowY))) { for (let y = 0; y < surface.scrollHeight; y += 400) { surface.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 15)); } surface.scrollTo(0, surface.scrollHeight); surface.scrollTo(0, 0); } });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' horizontal overflow');
    const bounds = await dialog.boundingBox(); const viewport = page.viewportSize(); assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, name + ' dialog bounds');
    const contrast = await dialog.evaluate(node => {
      const foreground = getComputedStyle(node.querySelector('[data-block-id="share-intro-copy"]')).color;
      const background = getComputedStyle(node).backgroundColor;
      const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const a = luminance(foreground), b = luminance(background);
      return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
    assert(contrast.ratio >= 4.5, name + ' supporting text contrast'); colours.push({ name, ...contrast });
    await page.screenshot({ path: join(out, name + '.png'), mask: [page.getByRole('textbox', { name: 'Your customised link' }), page.getByRole('textbox', { name: 'Invite link', exact: true })] });
  };
  try {
    await page.goto(fixture.origin + '/things?view=grid');
    const tile = page.locator(`[data-thing-id="${fixture.publicPageId}"]`).first(); await tile.waitFor({ timeout: 90000 });
    if (process.env.SHARE_PREVIEW_ACCEPTANCE_SCOPE === 'contrast') {
      const feedback = [];
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await open('/invite#synthetic-preview-invitation'); await inspect(`${width}-supporting-copy-contrast`);
        const startedAt = Date.now();
        await dialog.getByRole('button', { name: 'Copy customised link', exact: true }).click();
        const toast = page.getByRole('status').filter({ hasText: 'Customised link copied' }).last();
        await toast.waitFor({ state: 'visible', timeout: 3000 });
        await toast.waitFor({ state: 'hidden', timeout: 4000 });
        const elapsedMs = Date.now() - startedAt;
        assert(elapsedMs < 4000, 'Copy feedback clears after its two-second lifetime');
        feedback.push({ width, elapsedMs, source: 'browser wall clock from copy click through toast disappearance' });
        await inspect(`${width}-copy-feedback-cleared`); await close();
      }
      assert.deepEqual(errors, []);
      await writeFile(join(out, 'browser-contrast-result.json'), JSON.stringify({ ok: true, scope: 'supplemental contrast and copy-feedback', colours, feedback, errors }, null, 2));
      console.log(JSON.stringify({ ok: true, scope: 'contrast', screenshots: out })); return;
    }
    await tile.click({ button: 'right' }); await page.getByRole('menu').last().getByText('Share link & customise preview', { exact: true }).click(); await dialog.waitFor(); await waitReady();
    checks.push('Normal Things menu opens customiser through installed root host'); await close();
    await page.goto(fixture.origin + '/post/' + fixture.postId);
    await page.getByRole('button', { name: 'Post options', exact: true }).click();
    await page.getByRole('menu').last().getByText('Share link & customise preview', { exact: true }).click(); await dialog.waitFor(); await waitReady();
    checks.push('Real saved post context menu opens the customiser'); await close();
    await page.goto(fixture.origin + '/settings?tab=account#gift-invites');
    const invitePanel = page.locator('#gift-invites'); await invitePanel.getByRole('button', { name: 'Create invite link', exact: true }).waitFor({ timeout: 90000 });
    await invitePanel.getByRole('button', { name: 'Create invite link', exact: true }).click();
    await invitePanel.getByRole('button', { name: 'Share link & customise preview', exact: true }).waitFor({ timeout: 60000 });
    await invitePanel.getByRole('button', { name: 'Share link & customise preview', exact: true }).click(); await dialog.waitFor(); await waitReady();
    const realInvite = await dialog.getByRole('textbox', { name: 'Your customised link' }).inputValue();
    await choose('Pink Invitation', 'previewTheme', 'pink-invitation');
    const themedInvite = new URL(await dialog.getByRole('textbox', { name: 'Your customised link' }).inputValue());
    assert(themedInvite.hash === new URL(realInvite).hash, 'Real invitation capability remains unchanged');
    await inspect('desktop-invite-panel-entry'); await close();
    const inviteStates = await page.evaluate(async () => (await (await fetch('/api/v1/auth/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'list' }) })).json()).invites.map(invite => invite.status));
    assert(inviteStates.length === 1 && inviteStates.every(status => !['claimed', 'accepted', 'used'].includes(status)), 'Preview does not consume the created invite');
    checks.push('Real zero-credit invitation UI entry preserves token and leaves invite unused');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await open('/post/' + fixture.postId);
      await choose('Colour Blocks', 'previewTheme', 'colour-blocks');
      for (const layout of ['Text', 'Photo', 'Gallery', 'Automatic']) {
        await choose(layout, 'previewLayout', layout === 'Automatic' ? 'auto' : layout.toLowerCase());
        assert.equal(await dialog.getByRole('button', { name: layout, exact: true }).getAttribute('aria-pressed'), 'true');
        await inspect(`${width}-post-${layout.toLowerCase()}`);
      }
      await close(); await open('/p/' + fixture.publicPageId); await inspect(`${width}-public-page`); await close();
      await open('/p/' + fixture.privatePageId); assert.doesNotMatch(await dialog.innerText(), /Never disclose|Private acceptance detail/); await inspect(`${width}-private-fallback`); await close();
      await open('/invite#synthetic-preview-invitation'); const hashes = new Set();
      for (const [id, label] of [['editorial', 'Editorial'], ['colour-blocks', 'Colour Blocks'], ['editorial-white', 'Editorial White'], ['pink-invitation', 'Pink Invitation'], ['night-garden', 'Night Garden']]) {
        await choose(label, 'previewTheme', id);
        const link = new URL(await dialog.getByRole('textbox', { name: 'Your customised link' }).inputValue());
        assert.equal(link.pathname, '/invite'); assert.equal(link.hash, '#synthetic-preview-invitation'); assert.equal(link.searchParams.get('previewTheme'), id);
        await dialog.getByRole('button', { name: 'Copy customised link', exact: true }).click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link.href);
        const metadata = await (await context.request.get(`${fixture.origin}/api/v1/social-previews?path=${encodeURIComponent(link.pathname + link.search + link.hash)}`)).json();
        assert.equal(metadata.ok, true); assert.equal(metadata.design.template, id); assert.equal(metadata.publicContent, false); assert.doesNotMatch(JSON.stringify(metadata), /synthetic-preview-invitation/);
        // Vite intentionally serves its static development shell. Exercise the
        // real built Nitro HTML handler using the same copied route/choices.
        const html = await (await context.request.get(fixture.apiOrigin + link.pathname + link.search)).text(); assert.match(html, new RegExp(`previewTheme=${id}`)); assert.doesNotMatch(html, /synthetic-preview-invitation/);
        const png = await context.request.get(metadata.image.url); assert.equal(png.status(), 200); hashes.add(createHash('sha256').update(await png.body()).digest('hex'));
        await inspect(`${width}-invite-${id}`);
      }
      assert.equal(hashes.size, 5); checks.push(`${width}px post layouts, public/private pages, five invitation themes, decoded PNGs, copy + metadata + HTML roundtrip`); await close();
      await open('/'); assert.match(await image.getAttribute('src'), /\/social-card\?/); await inspect(`${width}-home`); await close();
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await open('/invite#synthetic-preview-invitation');
    await enableCurrentPageBuilder(page);
    await dialog.getByRole('button', { name: 'Edit layout', exact: true }).click();
    const edits = [
      ['share-intro-copy', 'Choose a preview from these individually editable blocks.'],
      ['share-templates-name', '{item.label} choice'],
      ['share-copy', 'Copy this customised link']
    ];
    for (const [id, text] of edits) {
      await dialog.locator(`[data-block-id="${id}"]`).click();
      const drawer = page.locator('.ttBuilderDrawer').last(); await drawer.getByLabel('Block text', { exact: true }).waitFor();
      await drawer.getByLabel('Block text', { exact: true }).fill(text); assert.equal(await drawer.getByLabel('Block text', { exact: true }).inputValue(), text);
      await drawer.getByRole('button', { name: 'Close builder', exact: true }).click();
    }
    const saveResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(response.request().method()));
    await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
    const saved = await (await saveResponse).json(); assert(saved.ok && saved.thing?.id);
    const stored = await page.evaluate(async id => (await (await fetch('/api/v1/things?id=' + encodeURIComponent(id))).json()).thing, saved.thing.id);
    assert.equal(stored.crystal.pageKey, 'settings-share-preview-customiser'); assert.deepEqual(stored.acl, ['tt:user']);
    for (const [, text] of edits) assert(JSON.stringify(stored.crystal.blocks).includes(text), 'Exact saved nested block text');
    await dialog.getByRole('button', { name: 'Done editing layout', exact: true }).click(); await close(); await page.reload();
    await page.getByRole('button', { name: 'Create invite link', exact: true }).waitFor(); await open('/invite#synthetic-preview-invitation');
    await dialog.getByText(edits[0][1], { exact: true }).waitFor(); await dialog.getByRole('button', { name: 'Copy this customised link', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await dialog.getByRole('textbox', { name: 'Your customised link' }).inputValue());
    await page.setViewportSize({ width: 390, height: 844 }); await inspect('mobile-saved-individually-edited-blocks'); await close();
    checks.push('Nested text, repeated choice label and copy control individually edited through Builder, saved as private blocks, exact readback and reload retain functioning copy');
    assert.deepEqual(inviteWrites, [], 'Preview opening and copying must not consume invitations'); assert.deepEqual(errors, [], 'No uncaught browser errors');
    await writeFile(join(out, 'browser-result.json'), JSON.stringify({ ok: true, checks, errors, inviteWrites, colours, origin: fixture.origin, data: 'disposable isolated replica and account' }, null, 2));
    console.log(JSON.stringify({ ok: true, checks: checks.length, screenshots: out }));
  } catch (error) {
    await page.screenshot({ path: join(out, 'failure.png'), fullPage: true, mask: [page.getByRole('textbox', { name: 'Your customised link' }), page.getByRole('textbox', { name: 'Invite link', exact: true })] });
    await writeFile(join(out, 'browser-failure.json'), JSON.stringify({ message: error.message, errors, url: page.url(), body: (await page.locator('body').innerText()).slice(0, 5000) }, null, 2)); throw error;
  } finally { await browser.close(); }
}
