#!/usr/bin/env node
// Uses disposable accounts, Chromium profiles and a real localhost replica/API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { Resvg } from '@resvg/resvg-js';

const source = fileURLToPath(new URL('..', import.meta.url));
const evidence = process.env.IMAGE_PRESENTATION_EVIDENCE_DIR;
assert(evidence && resolve(evidence) !== source && !resolve(evidence).startsWith(source + '/'), 'Set IMAGE_PRESENTATION_EVIDENCE_DIR outside the app checkout');
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'tt-image-presentation-'));
const basePort = Number(process.env.IMAGE_PRESENTATION_BASE_PORT || 18661);
assert(Number.isInteger(basePort) && basePort > 1024 && basePort < 65531);
const ports = { api: basePort, db: basePort + 1, web: basePort + 2, hmr: basePort + 3 };
const replicaSet = 'image_presentation';
const apiOrigin = `http://127.0.0.1:${ports.api}`;
const origin = `http://127.0.0.1:${ports.web}`;
const linkedImage = origin + '/image-presentation-fixture.png';
const username = 'image-presentation-owner';
const imageBytes = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="150"><rect width="360" height="150" fill="#4c1d95"/><circle cx="130" cy="70" r="50" fill="#f9a8d4"/><circle cx="230" cy="85" r="40" fill="#fbbf24"/></svg>').render().asPng();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = [];
const env = {
  PATH: process.env.PATH, HOME: directory, TMPDIR: directory, NODE_ENV: 'production', HOST: '127.0.0.1',
  PORT: String(ports.api), TT_API_PORT: String(ports.api), TT_WEB_PORT: String(ports.web), TT_HMR_PORT: String(ports.hmr),
  MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=${replicaSet}`,
  THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(directory, 'attachments'), THINGTIME_DATA_ENV: 'development',
  JWT_SECRET: randomBytes(48).toString('hex')
};
function start(name, executable, args, overrides = {}, cwd = directory) {
  const child = spawn(executable, args, { cwd, env: { ...env, ...overrides }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', error => console.error(name, error.code));
  child.stdout.resume(); child.stderr.resume();
  children.push(child);
  return child;
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
  await exit;
  clearTimeout(timeout);
}
async function ready(child, base) {
  for (let attempt = 0; attempt < 140; attempt++) {
    assert.equal(child.exitCode, null, 'Fixture process stopped before capability discovery');
    try { if ((await fetch(base + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(700) })).ok) return; } catch {}
    await delay(250);
  }
  throw Error('Fixture did not start: ' + base);
}
async function request(path, body, cookie, status = 200) {
  const response = await fetch(apiOrigin + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: apiOrigin, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  assert.equal(response.status, status, path + ': ' + (data.error || 'unexpected status'));
  return { data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}

let mongo, browser, page;
const checks = [];
const recordCheck = (message) => { checks.push(message); console.log(message); };
try {
  for (const port of Object.values(ports)) {
    const listener = createServer();
    await new Promise((done, fail) => listener.once('error', fail).listen(port, '127.0.0.1', done));
    await new Promise(done => listener.close(done));
  }
  const fixtureImage = join(directory, 'image.png');
  await writeFile(fixtureImage, imageBytes);
  await mkdir(join(directory, 'db'));
  start('MongoDB', process.env.THINGTIME_TEST_MONGOD || 'mongod', ['--dbpath', join(directory, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', replicaSet, '--nounixsocket']);
  mongo = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  for (let attempt = 0; ; attempt++) {
    try { await mongo.connect(); break; } catch (error) { if (attempt === 30) throw error; await delay(250); }
  }
  // Replica infrastructure only. Product records use HTTP.
  await mongo.db('admin').command({ replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  for (let attempt = 0; ; attempt++) {
    if ((await mongo.db('admin').command({ hello: 1 })).isWritablePrimary) break;
    assert(attempt < 100, 'Fixture replica did not elect a primary');
    await delay(200);
  }
  await mongo.close();
  let server = start('Nitro', process.execPath, [join(source, '.output/server/index.mjs')]);
  await ready(server, apiOrigin);
  const health = (await request('/api/v1/health/mongodb')).data;
  assert.equal(health.dbName, 'thingtime');
  assert.equal(health.replicaSet, replicaSet);
  assert.equal(health.custom, false);
  const manifest = (await request('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, apiOrigin);
  assert.equal(manifest.features['api.users-profile'].version, '1.2.0');
  assert.equal(manifest.features['api.subspaces-update'].version, '1.6.0');
  const account = await request('/api/v1/auth/register', { username, email: username + '@example.invalid', password: randomBytes(24).toString('hex'), displayName: 'Image Presentation' });
  const { cookie } = account;
  assert(cookie);
  await stop(server);
  children.pop();
  server = start('Nitro', process.execPath, [join(source, '.output/server/index.mjs')], { ADMIN_USERNAMES: username });
  await ready(server, apiOrigin);
  await request('/api/v1/users/profile', { bannerUrl: linkedImage }, cookie);
  await request('/api/v1/users/profile', { bannerPresentation: { zoom: 160 } }, undefined, 401);
  await request('/api/v1/users/profile', { bannerPresentation: { attributes: { srcset: linkedImage } } }, cookie, 400);
  const readProfile = async () => (await request('/api/v1/users/profile?username=' + username)).data.profile;
  assert.equal((await readProfile()).bannerPresentation, undefined);
  const replacementImage = linkedImage + '?replacement=1';
  await request('/api/v1/users/profile', { bannerUrl: replacementImage }, cookie);
  await request('/api/v1/users/profile', { bannerPresentation: { zoom: 140 }, bannerPresentationSource: linkedImage }, cookie, 409);
  await request('/api/v1/users/profile', { bannerPresentation: null, bannerPresentationSource: linkedImage }, cookie, 409);
  assert.equal((await readProfile()).bannerUrl, replacementImage);
  assert.equal((await readProfile()).bannerPresentation, undefined);
  await request('/api/v1/users/profile', { bannerUrl: linkedImage }, cookie);
  recordCheck('authoritative source conflict refused without mutating the replacement');
  const vite = start('Vite', process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite'; import {readFileSync} from 'node:fs'; const image=readFileSync(process.env.FIXTURE_IMAGE); const server=await createServer({envFile:false,plugins:[{name:'image-presentation-fixture',configureServer(server){server.middlewares.use('/image-presentation-fixture.png',(_req,res)=>res.writeHead(200,{'Content-Type':'image/png'}).end(image));}}],server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`], { NODE_ENV: 'development', FIXTURE_IMAGE: fixtureImage }, source);
  await ready(vite, origin);
  console.log(`Fixture ready: ${origin}; API ${apiOrigin}; evidence ${evidence}`);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
  const context = await browser.newContext({ viewport: { width: 1350, height: 950 } });
  await context.addCookies(cookie.split('; ').map(value => {
    const split = value.indexOf('=');
    return { name: value.slice(0, split), value: value.slice(split + 1), url: origin, httpOnly: true, sameSite: 'Lax' };
  }));
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const openProfileEditor = async () => {
    await page.goto(origin + '/profile', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Edit profile/ }).click({ timeout: 120000 });
    return page.locator('[data-image-editor]');
  };
  const resizeProfile = async (mobile) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1350, height: 950 });
    await page.locator(mobile ? '.editProfileSheet' : '.editProfileModal').waitFor({ state: 'attached', timeout: 5000 });
  };
  const openBannerEditor = () => page.getByRole('button', { name: 'Edit banner image' }).click({ timeout: 30000 });
  const verifyLayout = async (dialog, filename) => {
    const body = dialog.locator('.chakra-modal__body');
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(evidence, filename), animations: 'disabled' });
  };
  let dialog = await openProfileEditor();
  const displayName = page.getByPlaceholder('How you appear around Thingtime');
  await displayName.fill('Image draft resize fixture');
  await openBannerEditor();
  await dialog.getByLabel('Image fit').selectOption('contain');
  await dialog.getByLabel('Zoom (%)', { exact: true }).fill('75');
  await dialog.getByLabel('Horizontal anchor (%)', { exact: true }).fill('35');
  await dialog.getByLabel('Top offset (px)', { exact: true }).fill('4');
  await dialog.getByLabel('Horizontal padding (px)', { exact: true }).fill('12');
  await dialog.getByRole('tab', { name: 'CSS' }).click();
  await dialog.getByText('Edit CSS declarations as text').click();
  await dialog.getByLabel('Custom CSS declarations').fill('opacity: 0.75;\nfilter: saturate(0.8);');
  await dialog.getByRole('tab', { name: 'HTML' }).click();
  await dialog.getByRole('button', { name: 'Add attribute', exact: true }).click();
  await dialog.getByLabel('HTML attribute name').fill('alt');
  await dialog.getByLabel('HTML attribute value').fill('Two colored circles');
  await dialog.getByRole('button', { name: 'Add attribute', exact: true }).click();
  const preview = dialog.getByTestId('image-editor-preview').locator('img');
  assert.equal(await preview.getAttribute('alt'), 'Two colored circles');
  assert.equal(await preview.evaluate(image => image.style.objectFit), 'contain');
  assert.equal(await preview.evaluate(image => image.style.opacity), '0.75');
  await verifyLayout(dialog, 'desktop-html.png');
  for (const mobile of [true, false]) {
    await resizeProfile(mobile);
    assert(await dialog.isVisible(), 'Resizing must leave the open image editor mounted');
    assert.equal(await dialog.getByRole('tab', { name: 'HTML' }).getAttribute('aria-selected'), 'true');
    assert.equal(await preview.getAttribute('alt'), 'Two colored circles');
    assert.equal(await preview.evaluate(image => image.style.opacity), '0.75');
    assert.equal(await displayName.inputValue(), 'Image draft resize fixture');
    await verifyLayout(dialog, mobile ? 'mobile-resized-html.png' : 'desktop-resized-html.png');
  }
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await resizeProfile(true);
  await openBannerEditor();
  assert.equal(await dialog.getByLabel('Zoom (%)', { exact: true }).inputValue(), '75');
  assert.equal(await preview.getAttribute('alt'), 'Two colored circles');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await readProfile()).bannerPresentation, undefined, 'Apply keeps outer profile save pending');
  const profileWrite = page.waitForResponse(response => response.url().endsWith('/api/v1/users/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Save/ }).last().click();
  assert((await profileWrite).ok());
  const saved = await readProfile();
  assert.equal(saved.displayName, 'Image draft resize fixture');
  assert.equal(saved.bannerUrl, linkedImage);
  assert.equal(saved.bannerPresentation.zoom, 75);
  assert.equal(saved.bannerPresentation.anchorX, 35);
  assert.equal(saved.bannerPresentation.paddingX, 12);
  assert.equal(saved.bannerPresentation.css.opacity, '0.75');
  assert.equal(saved.bannerPresentation.attributes.alt, 'Two colored circles');
  recordCheck('open and applied image drafts survive both viewport directions and exact profile save');

  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, hasTouch: true });
  await visitor.goto(origin + '/profile/' + username, { waitUntil: 'domcontentloaded' });
  const publicBanner = visitor.getByRole('img', { name: 'Two colored circles' });
  await publicBanner.waitFor({ timeout: 120000 });
  assert.equal(await publicBanner.getAttribute('src'), linkedImage);
  assert.equal(await publicBanner.evaluate(image => getComputedStyle(image).opacity), '0.75');
  await visitor.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await visitor.screenshot({ path: join(evidence, 'mobile-public-profile.png'), fullPage: true });
  await visitor.close();

  await page.setViewportSize({ width: 390, height: 844 });
  dialog = await openProfileEditor();
  await openBannerEditor();
  assert.equal(await dialog.getByLabel('Zoom (%)', { exact: true }).inputValue(), '75');
  await dialog.getByLabel('Horizontal padding (px)').focus();
  await verifyLayout(dialog, 'mobile-framing.png');
  await dialog.getByLabel('Zoom (%)', { exact: true }).fill('300');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  const trigger = page.getByRole('button', { name: 'Edit banner image' });
  assert(await trigger.isVisible(), 'Escape closes only the inner dialog');
  await trigger.evaluate(button => new Promise((resolve, reject) => {
    const deadline = Date.now() + 2500;
    function check() {
      if (document.activeElement === button) resolve(undefined);
      else if (Date.now() > deadline) reject(new Error('Image editor did not restore trigger focus'));
      else requestAnimationFrame(check);
    }
    check();
  }));
  assert.equal((await readProfile()).bannerPresentation.zoom, 75);
  await page.getByRole('button', { name: 'Edit banner image' }).click();
  dialog = page.locator('[data-image-editor]');
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await dialog.getByTestId('image-editor-preview').locator('img').evaluate(image => image.style.objectFit), 'cover');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  const resetWrite = page.waitForResponse(response => response.url().endsWith('/api/v1/users/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Save/ }).last().click();
  assert((await resetWrite).ok());
  assert.equal((await readProfile()).bannerPresentation, undefined);
  assert.equal((await readProfile()).bannerUrl, linkedImage);
  recordCheck('mobile public placement, persisted framing, cancel, reset, and original linked source');

  await page.getByRole('button', { name: /Edit profile/ }).click();
  await page.getByLabel('Choose banner image').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: imageBytes });
  await page.getByText(/Ready to save/).waitFor({ timeout: 90000 });
  await openBannerEditor();
  dialog = page.locator('[data-image-editor]');
  await dialog.getByLabel('Zoom (%)', { exact: true }).fill('140');
  await resizeProfile(false);
  assert.equal(await dialog.getByLabel('Zoom (%)', { exact: true }).inputValue(), '140');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await resizeProfile(true);
  await page.getByText(/Ready to save/).waitFor();
  const uploadWrite = page.waitForResponse(response => response.url().endsWith('/api/v1/users/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Save/ }).last().click();
  assert((await uploadWrite).ok());
  const uploaded = await readProfile();
  assert.match(uploaded.bannerUrl, /^\/api\/v1\/attachments\/content\?id=/);
  assert.equal(uploaded.bannerPresentation.zoom, 140);
  const content = await fetch(apiOrigin + uploaded.bannerUrl, { headers: { Cookie: cookie } });
  assert(content.ok);
  assert(Buffer.from(await content.arrayBuffer()).equals(imageBytes), 'Presentation leaves the original uploaded PNG bytes intact');
  recordCheck('managed upload survives resize with exact attachment binding, original PNG bytes and saved presentation');
  // Settings uses the same modal. Commit raw CSS while its textarea still has
  // focus; the save may not reuse the value from before that last keystroke.
  await page.goto(origin + '/settings?tab=profile', { waitUntil: 'domcontentloaded' });
  await page.locator('details[data-settings-section] > summary').filter({ hasText: 'How you show up on your profile page' }).click({ timeout: 60000 });
  await page.getByRole('button', { name: 'Edit banner image' }).click({ timeout: 60000 });
  dialog = page.locator('[data-image-editor]');
  await dialog.getByRole('tab', { name: 'CSS' }).click();
  await dialog.getByText('Edit CSS declarations as text').click();
  await dialog.getByLabel('Custom CSS declarations').fill('opacity: .63 !important');
  assert.equal(await dialog.getByTestId('image-editor-preview').locator('img').evaluate(image => image.style.getPropertyPriority('opacity')), 'important');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const settingsWrite = page.waitForResponse(response => response.url().endsWith('/api/v1/users/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Save/ }).last().click();
  assert((await settingsWrite).ok());
  assert.equal((await readProfile()).bannerPresentation.css.opacity, '.63 !important');
  assert.equal((await readProfile()).bannerUrl, uploaded.bannerUrl);
  recordCheck('Settings → Profile immediate Apply saves latest raw CSS and retains the managed original');

  const avatarStyle = { zoom: 125, css: { opacity: '0.66' }, attributes: { alt: 'Styled identity fixture' } };
  await request('/api/v1/users/profile', { avatarUrl: linkedImage, avatarPresentation: avatarStyle }, cookie);
  const roster = (await request('/api/v1/auth/accounts', undefined, cookie)).data.accounts;
  assert.deepEqual(roster.find(row => row.user.id === account.data.user.id).user.avatarPresentation, avatarStyle);
  const posted = (await request('/api/v1/things', {
    thingtime: ['post'], acl: ['tt:all'], crystal: { type: 'text', text: 'Image presentation test post' }
  }, cookie)).data.post;
  assert(posted?.id, 'Real post creation must return a post id');
  const postReader = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await postReader.goto(origin + '/post/' + posted.id, { waitUntil: 'domcontentloaded' });
  const postAvatar = postReader.getByRole('img', { name: 'Styled identity fixture' }).first();
  await postAvatar.waitFor({ timeout: 60000 });
  assert.equal(await postAvatar.evaluate(image => getComputedStyle(image).opacity), '0.66');
  await postReader.close();
  recordCheck('styled avatar renders in the public post and roster projection');

  const recipientName = 'image-presentation-recipient';
  const recipient = await request('/api/v1/auth/register', {
    username: recipientName, email: recipientName + '@example.invalid', password: randomBytes(24).toString('hex')
  });
  const chat = (await request('/api/v1/chats', { chatType: 'dm', memberIds: [recipient.data.user.id] }, cookie)).data.chat;
  const messageText = 'A message with a styled avatar';
  await request('/api/v1/chats/messages', { chatId: chat.id, text: messageText }, cookie);
  await request('/api/v1/chats/requests', { chatId: chat.id, accept: true }, recipient.cookie);
  const messageReadback = (await request('/api/v1/chats/messages?chatId=' + chat.id, undefined, recipient.cookie)).data;
  assert.deepEqual(messageReadback.messages.find(message => message.text === messageText)?.author?.avatarPresentation, avatarStyle);
  const recipientPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await recipientPage.context().addCookies(recipient.cookie.split('; ').map(value => {
    const split = value.indexOf('=');
    return { name: value.slice(0, split), value: value.slice(split + 1), url: origin, httpOnly: true, sameSite: 'Lax' };
  }));
  await recipientPage.goto(origin + '/messages?chat=' + chat.id, { waitUntil: 'domcontentloaded' });
  await recipientPage.getByText(messageText, { exact: true }).last().waitFor({ timeout: 45000 });
  const messageAvatar = recipientPage.getByRole('img', { name: 'Styled identity fixture' }).first();
  await messageAvatar.waitFor({ timeout: 60000 });
  assert.equal(await messageAvatar.evaluate(image => getComputedStyle(image).opacity), '0.66');
  await recipientPage.close();
  recordCheck('styled avatar survives exact chat readback and renders in recipient Messenger');
  assert.deepEqual(errors, [], 'No page errors during acceptance');
  await writeFile(join(evidence, 'profile-acceptance.json'), JSON.stringify({ checks }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, 'profile-failure.png') }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await mongo?.close();
  // Optional, bounded hold for an independent browser check on this fixture.
  const hold = process.env.IMAGE_PRESENTATION_HOLD_FILE;
  if (hold && children.length === 3) {
    await writeFile(hold, 'Remove this marker to stop the isolated fixture.\n');
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline && await stat(hold).catch(() => false)) await delay(1000);
    await rm(hold, { force: true });
  }
  for (const child of children.reverse()) await stop(child);
  await rm(directory, { recursive: true, force: true });
}
