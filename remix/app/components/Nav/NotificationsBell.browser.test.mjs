// Actual NotificationsBell, Chakra Popover and native draft guard in isolated
// Chromium. Account and notification transport are synthetic; no native proof.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(path.join(repo, 'MCP/package.json'));
const { build } = require('esbuild'), { chromium } = require('playwright');
const { installActivityObserver } = require(path.join(repo, 'electron/test/fixtures/native-auto-local.cjs'));
const evidence = process.env.THINGTIME_NOTIFICATIONS_EVIDENCE_DIR, observations = [];
let server, browser, origin;
before(async () => {
 if (evidence) await mkdir(evidence, { recursive: true });
 const script = (await build({ bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: path.join(repo, 'remix/tsconfig.json'),
  plugins: [{ name: 'synthetic-account-transport', setup(build) {
   build.onResolve({ filter: /^(~\/hooks\/useApi|~\/hooks\/useCurrentUser|~\/components\/Profile\/ProfilePage)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
   build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: path.join(repo, 'remix'), contents:
    args.path.endsWith('useApi') ? 'export const useApi=()=>window.fixtureApi;' : args.path.endsWith('useCurrentUser') ? 'export const useCurrentUser=()=>window.fixtureUser;' :
     'import React from "react";export const ProfileAvatarCircle=()=> <span aria-label="Synthetic avatar"/>;' }));
  } }], stdin: { resolveDir: path.join(repo, 'remix'), sourcefile: 'notification-bell-fixture.tsx', loader: 'tsx', contents: `
  import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router';
  import {ChakraProvider} from '@chakra-ui/react';import {NotificationsBell} from './app/components/Nav/NotificationsBell';
  import {hasUnknownDesktopDraft} from './app/utils/desktopBundleActivation';
  const calls=[],resolvers=[];
  const row=(index)=>({id:'synthetic-'+index,type:'account-created',category:'account',actorId:'',actorUsername:null,actorName:null,actorAvatarUrl:null,
   targetId:null,postId:null,preview:'Disposable notification '+index,title:'Disposable notification '+index,readAt:null,createdAt:'2026-11-12T00:00:00.000Z'});
  let hold=false,rows=Array.from({length:24},(_,index)=>row(index));
  window.fixtureUser={id:'synthetic-notification-owner',temporary:false};
  window.fixtureApi={v1:{notifications:{list:async(request)=>{calls.push({operation:'list',limit:request.limit});
   if(request.limit===20&&hold)return new Promise(resolve=>resolvers.push(resolve));
   return {notifications:request.limit===1?[]:rows,unreadCount:7};},markRead:async(request)=>{calls.push({operation:'markRead',all:request.all});return {ok:true};}}}};
  function Fixture(){const [revision,setRevision]=React.useState(0);
   window.fixture={calls,hold:()=>{hold=true;},release:()=>{hold=false;resolvers.splice(0).forEach(resolve=>resolve({notifications:rows,unreadCount:0}));},
    switchUser:user=>{window.fixtureUser=user;setRevision(value=>value+1);},guard:()=>hasUnknownDesktopDraft(document)};
   return <MemoryRouter><div style={{minHeight:'180vh',padding:'24px',background:'#fafafb'}}><nav style={{display:'flex',justifyContent:'flex-end'}}><NotificationsBell/></nav><h1>Notification lifecycle fixture</h1><p>Actual bell and notification rows; synthetic identity and transport.</p><button id="outside" style={{position:"fixed",left:"12px",bottom:"12px"}}>Outside focus target</button></div></MemoryRouter>;
  }
  createRoot(document.getElementById('root')).render(<ChakraProvider><Fixture/></ChakraProvider>);`
  } })).outputFiles[0].contents;
 server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/fixture.js' ? script : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>'); });
 server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
 browser = await chromium.launch({ headless: true, chromiumSandbox: true });
 if (evidence) await mkdir(evidence, { recursive: true });
});
after(async () => {
 if (evidence) await writeFile(path.join(evidence, 'component-regression.json'), JSON.stringify({
  scope: 'Actual bell/Chakra/guard browser regression; synthetic account/API/avatar only; no app/Mongo acceptance', browserVersion: browser?.version(),
  sourceSha256: createHash('sha256').update(await readFile(new URL('./NotificationsBell.tsx', import.meta.url))).digest('hex'), observations
 }, null, 2) + '\n');
 await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
});
async function open(t, width = 1440) {
 const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 } }); t.after(() => context.close());
 await context.addInitScript(installActivityObserver);
 const page = await context.newPage(); page.on('pageerror', error => { throw error; });
 await page.goto(origin); await page.waitForFunction(() => window.fixture?.calls.some(call => call.operation === 'list'));
 return page;
}
const bell = page => page.getByRole('button', { name: /^Notifications/ });
async function shot(page, name) { if (evidence) await page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true }); }
test('closed authenticated bell has no mounted dialog and does not falsely report an unknown draft', async t => {
 const page = await open(t);
 const state = await page.evaluate(() => ({ guard: window.fixture.guard(), dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => ({
  tag: element.tagName, role: element.getAttribute('role'), notificationPopover: element.classList.contains('chakra-popover__content'),
  children: element.childElementCount, visibility: getComputedStyle(element.parentElement).visibility
 })), calls: window.fixture.calls, documentStartObserverActive: Array.isArray(window.__nativeAutoActivity) && window.__nativeAutoActivity.length > 0 }));
 observations.push({ case: 'cold-closed-authenticated', ...state }); await shot(page, 'closed-desktop');
 assert.equal(state.dialogs.length, 0); assert.equal(state.guard, false);
 assert.equal(state.documentStartObserverActive, true, 'The real init-script observer must survive an initially missing documentElement');
 assert.equal(state.calls.some(call => call.operation === 'markRead'), false, 'Closed badge refresh must not mark notifications read');
});
test('real keyboard open/close keeps legitimate dialog protection, focus, cached rows and a usable narrow panel', async t => {
 for (const width of [1440, 390]) {
  const page = await open(t, width); await bell(page).focus(); await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog'); await panel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('Disposable notification 0'));
  assert.equal(await page.evaluate(() => window.fixture.guard()), true, 'Open dialog must retain the unchanged safety veto');
  const bounds = await panel.boundingBox(); assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, 'Popover stays inside viewport');
  await shot(page, 'open-top-' + width);
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight; }); await shot(page, 'open-bottom-' + width);
  await panel.evaluate(element => { element.scrollTop = 0; });
  await panel.getByRole('link', { name: 'See all' }).focus(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Notifications'), null, { timeout: 5000 });
  assert.equal(await bell(page).evaluate(element => document.activeElement === element), true, 'Escape returns focus to its trigger');
  assert.equal(await page.evaluate(() => window.fixture.guard()), false);
  await page.evaluate(() => window.fixture.hold()); await bell(page).click(); await panel.waitFor({ state: 'visible' });
  assert.ok(await panel.textContent().then(value => value.includes('Disposable notification 0')), 'Cached rows remain usable during refresh');
  await page.evaluate(() => window.fixture.release());
  await page.locator('#outside').click({ timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
  assert.equal(await page.locator('#outside').evaluate(element => document.activeElement === element), true, 'Outside click keeps its selected focus target');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await shot(page, 'closed-bottom-' + width);
  observations.push({ case: 'open-close-refresh', width, openGuarded: true, closedUnguarded: true, keyboardFocusReturned: true, outsideClickFocusRetained: true, cachedRowsRetained: true, noOverflow: true });
 }
});
test('identity withdrawal removes the panel and ignores its old delayed notification result', async t => {
 const page = await open(t); await page.evaluate(() => window.fixture.hold()); await bell(page).click();
 await page.getByRole('dialog').waitFor({ state: 'visible' });
 await page.evaluate(() => window.fixture.switchUser(null));
 await page.getByRole('link', { name: 'Notification history' }).waitFor({ state: 'visible' });
 await page.evaluate(() => window.fixture.release());
 assert.equal(await page.locator('[role="dialog"]').count(), 0); assert.equal(await page.evaluate(() => window.fixture.guard()), false);
 observations.push({ case: 'identity-withdrawal', panelRemoved: true, lateResultNotRendered: true });
});
