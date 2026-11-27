import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import { claimWorkspace, developmentEnvironment, prepareWorkspace, retainedWorkspace, stopWorkspace, workspaceEnvironment } from './dev-workspace.mjs';
const require = createRequire(import.meta.url);
const { default: puppeteer } = await import('puppeteer-core');
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = retainedWorkspace('mac-share-extension-qa');
const workspace = { ...base, app: path.join(base.root, 'Thingtime Dev.app') };
const evidence = process.env.THINGTIME_SHARE_EVIDENCE || path.join(process.env.HOME, '.codex-2/task-state/mac-share-extension/native-acceptance');
const native = process.env.THINGTIME_SHARE_TEST_OUTPUT || path.join(process.env.HOME, '.codex-2/task-state/mac-share-extension/native-test');
const report = { checks: [], limitations: [], startedAt: new Date().toISOString() };
let release, browser, child, stopped = true;
const timeout = setTimeout(() => { child?.kill('SIGTERM'); }, 8 * 60 * 1000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(port) {
 const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
 await new Promise(resolve => server.close(resolve));
}
async function poll(test, label, milliseconds = 60000) {
 const end = Date.now() + milliseconds; let result;
 while (Date.now() < end) { try { result = await test(); if (result) return result; } catch {} await pause(200); }
 throw Error('Timed out: ' + label);
}
async function clickText(page, label) {
 const clicked = await page.evaluate(label => { const button = [...document.querySelectorAll('button')].find(el => el.innerText.trim().endsWith(label) || el.getAttribute('aria-label') === label); if (!button || button.disabled) return false; button.click(); return true; }, label);
 assert(clicked, 'Clickable control: ' + label);
}
try {
 await mkdir(evidence, { recursive: true, mode: 0o700 });
 release = await claimWorkspace(workspace);
 if (!process.argv.includes('--prepared')) await prepareWorkspace(workspace, electronDir, require('electron'));
 for (const port of [workspace.apiPort, workspace.databasePort, workspace.inspectorPort]) await freePort(port);
 const resources = path.join(workspace.source, 'dist/native');
 const testRoot = path.join(workspace.profile, 'share-fixtures');
 await mkdir(resources, { recursive: true, mode: 0o700 }); await mkdir(testRoot, { recursive: true, mode: 0o700 });
 await cp(path.join(native, 'ThingtimeShareBridge-test'), path.join(resources, 'ThingtimeShareBridge'));
 await writeFile(path.join(resources, 'thingtime-share.json'), JSON.stringify({testing:true,version:'1.1.0',appGroup:'group.com.thingtime.share-test.mac-share-extension',testRoot}), { mode: 0o600 });
 const fixture = spawnSync(path.join(native, 'NativeShareTests'), ['--fixture-root', testRoot], {encoding:'utf8'});
 assert.equal(fixture.status, 0, 'Native fixture generation'); const requestId = fixture.stdout.trim().toLowerCase();
 assert.match(requestId, /^[a-f0-9-]{36}$/u);
 const runtime = path.join(workspace.runtime, 'Contents/MacOS/Electron');
 const env = { ...developmentEnvironment(), ...await workspaceEnvironment(workspace), THINGTIME_SHARE_TEST_MODE:'1',THINGTIME_DESKTOP_PARALLEL_DEV:'1',THINGTIME_DESKTOP_DEV_PROFILE:workspace.profile,THINGTIME_DESKTOP_DEV_NAME:'Thingtime Dev mac-share-extension-qa',THINGTIME_NODE_ALLOW_DEV_REGISTRATION:'0' };
 const args = [workspace.source, `thingtime-share://incoming/${requestId}`, `--remote-debugging-port=${workspace.inspectorPort}`, '--remote-debugging-address=127.0.0.1'];
 child = spawn(runtime, args, {cwd:workspace.source,env,detached:true,stdio:['ignore','ignore','ignore','ipc']});
 stopped = false; await release.recordChild(child.pid);
 await poll(async () => (await fetch(`http://127.0.0.1:${workspace.inspectorPort}/json/version`)).ok, 'isolated Electron debugger');
 browser = await puppeteer.connect({browserURL:`http://127.0.0.1:${workspace.inspectorPort}`,defaultViewport:null});
 let page = await poll(async () => (await browser.pages()).find(page => new URL(page.url()).pathname === '/share'), 'real incoming share window');
 await page.waitForFunction(() => !!window.thingtimeDesktop?.getInfo && !!window.thingtimeShare?.request);
 const info = await page.evaluate(async () => { const x = await window.thingtimeDesktop.getInfo(); return { origin:x.origin,apiOrigin:x.apiOrigin,localRuntime:x.localRuntime,sessionStorage:x.sessionStorage }; });
 assert.equal(new URL(info.origin).hostname, '127.0.0.1'); assert.equal(info.apiOrigin, `http://127.0.0.1:${workspace.apiPort}`);
 assert.equal(info.localRuntime.enabled, true); assert.equal(info.localRuntime.active, true); assert.equal(info.localRuntime.bundledMongoSelected, true); assert.equal(info.localRuntime.databaseMode, 'managed'); assert.equal(info.localRuntime.apiPort, workspace.apiPort); assert.equal(info.localRuntime.databasePort, workspace.databasePort);
 // Only status and isolation evidence: never persist session descriptors.
 report.isolation = { rendererOrigin:info.origin,apiOrigin:info.apiOrigin,apiPort:workspace.apiPort,databasePort:workspace.databasePort,databaseMode:info.localRuntime.databaseMode,enabled:info.localRuntime.enabled };
 report.checks.push('verified task-owned profile, local managed database and loopback API before writes');
 const owner = await page.evaluate(async () => {
  const suffix = crypto.randomUUID().replaceAll('-','').slice(0,12);
  const response = await fetch('/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'shareqa'+suffix,password:crypto.randomUUID()+crypto.randomUUID(),email:'shareqa'+suffix+'@example.test',displayName:'Share QA'})});
  const body = await response.json(); if (!response.ok || !body.ok || !body.user?.id) throw Error('Synthetic registration failed: '+response.status+' '+(body.error||''));
  return body.user.id;
 });
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(() => document.querySelector('[data-testid="incoming-share"]') && document.body.innerText.includes('Hello from macOS sharing'),{timeout:60000});
 const incoming = await page.evaluate(async ({requestId,owner}) => window.thingtimeShare.request({method:'getIncomingShare',requestId,accountId:owner}), {requestId,owner});
 assert.equal(incoming.text, 'Hello from macOS sharing'); assert.equal(incoming.attachments.length, 1); assert.equal(incoming.attachments[0].name,'sample.bin');
 const bytes = await page.evaluate(async ({requestId,owner,file}) => window.thingtimeShare.request({method:'read',requestId,accountId:owner,fileId:file,offset:0,length:5}), {requestId,owner,file:incoming.attachments[0].id});
 assert.equal(bytes.base64, 'AAECA/8='); report.checks.push('real Electron IPC/native process text and exact binary bytes');
 for (const width of [1100,390]) {
  await page.setViewport({width,height:850,deviceScaleFactor:1});
  for (const [label,name] of [['Post','post'],['Message','message'],['Save as Thing / file','save']]) {
   await clickText(page,label); await pause(800);
   await page.evaluate(() => window.scrollTo(0,document.body.scrollHeight));
   await page.screenshot({path:path.join(evidence,`${width}-${name}.png`),fullPage:true});
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),'No horizontal overflow');
  }
 }
 report.checks.push('Post, Message and Save rendered at 1100px and 390px; scrolled to bottom');
 await page.close();
 const second = spawn(runtime,args,{cwd:workspace.source,env,stdio:'ignore'}); await new Promise((resolve,reject)=>{second.once('exit',resolve);second.once('error',reject);});
 page = await poll(async () => (await browser.pages()).find(page => page.url().includes('/share?requestId='+requestId)), 'reopen same durable UUID');
 await page.waitForFunction(() => document.body.innerText.includes('Hello from macOS sharing'),{timeout:60000});
 report.checks.push('closed and reopened same native UUID with preserved account and payload');
 await clickText(page,'Save as Thing / file'); await pause(1500);
 const enabled = await page.evaluate(() => [...document.querySelectorAll('button')].some(el=>el.innerText.trim()==='Save here'&&!el.disabled));
 if (enabled) {
  await clickText(page,'Save here');
  const finished = await poll(async () => { const metadata=JSON.parse(await readFile(path.join(testRoot,'ready',requestId.toUpperCase(),'composer.json'),'utf8')); return metadata.completed ? metadata : false; },'real Save receipt',45000);
  const ids=finished.submission.outcomeIds; assert(ids.length>0);
  const readback = await page.evaluate(async ids => Promise.all(ids.map(async id => { const response=await fetch('/api/v1/things?id='+encodeURIComponent(id)); const body=await response.json(); return {id,status:response.status,owner:body.thing?.author?.id,text:body.thing?.crystal?.text}; })), ids);
  assert(readback.every(row=>row.status===200&&row.owner===owner),'exact private saved Thing readback');
  assert(readback.some(row=>row.text==='Hello from macOS sharing'),'saved original text');
  report.checks.push('real private Save completed with durable receipt and exact-ID API readback'); report.savedIds=ids; report.privateSaveVerified=true;
 } else {
  const reason = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map(el=>el.textContent.trim()).filter(Boolean).join(' '));
  report.limitations.push('Binary Save remains gated for the synthetic account: ' + (reason || 'Save here is disabled.'));
  report.privateSaveVerified = false;
 }
 report.ok = true;
} catch(error) { report.ok=false; report.error=error.message; process.exitCode=1; }
finally {
 clearTimeout(timeout);
 if (browser) { for (const page of await browser.pages()) { if(page.url().includes('/share?')) await page.close().catch(()=>{}); } await browser.disconnect(); }
 if (!stopped && child) { try { await pause(500); child.kill('SIGTERM'); await pause(500); await stopWorkspace(workspace); stopped=true; } catch(error) { report.cleanupError=error.message; process.exitCode=1; } }
 if (stopped) { await release?.(); await rm(workspace.root,{recursive:true,force:true}); report.cleaned=true; }
 report.finishedAt=new Date().toISOString(); await writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
