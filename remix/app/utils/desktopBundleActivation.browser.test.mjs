// Actual renderer module + browser MutationObserver. Host/route/background and
// persistence are synthetic controls; this is not native activation acceptance.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(repo, 'MCP/package.json'));
const { buildSync } = require('esbuild'), { chromium } = require('playwright');
let server, browser, origin;
const observations = [], evidence = process.env.THINGTIME_BUNDLE_ACTIVATION_EVIDENCE_DIR;
before(async () => {
 const script = buildSync({ bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent',
  tsconfig: path.join(repo, 'remix/tsconfig.json'), stdin: { resolveDir: path.join(repo, 'remix'), loader: 'ts', contents: `
  import {watchDesktopBundleActivation} from './app/utils/desktopBundleActivation';
  import {desktopBundleSafety} from './app/utils/desktopBundleSafety';
  const blocked=new URL(location.href).searchParams.has('blocked');
  if(blocked){const field=document.createElement('textarea');field.value='Synthetic unsaved draft';document.body.append(field);}
  let releaseWrite,listener;
  const write=new Promise(resolve=>{releaseWrite=resolve;});
  const receipts=[],policies=[];
  globalThis.fixture={phase:'idle',receipts,policies,resolve:()=>releaseWrite(),changed:()=>desktopBundleSafety.changed()};
  const off=desktopBundleSafety.register({kind:'persistence',ready:()=>true,automaticUpdates:()=>true,
   checkpoint:async()=>{fixture.phase='saving';await write;fixture.phase='written';return()=>true;}});
  const bridge={bundleActivationVersion:'1.3.0',getInfo:async()=>({sessionHash:'synthetic',nativeFeatures:{origin:location.origin,
   features:{'native.web-bundle-activation':{version:'1.3.0',methods:['set-policy','checkpoint']}}}}),
   onBundleActivation:callback=>{listener=callback;return()=>{};},bundleActivationCheckpoint:async value=>{receipts.push(value);return true;},
   setBundleUpdatePolicy:async value=>{policies.push(value.enabled);return true;}};
  const doc={hasFocus:()=>false,documentElement:document.documentElement,querySelector:document.querySelector.bind(document),querySelectorAll:document.querySelectorAll.bind(document)};
  const router={state:{initialized:true,navigation:{state:'idle'},errors:null},subscribe:()=>()=>{}};
  const close=watchDesktopBundleActivation({bridge,router,document:doc,window,isHealthy:()=>true,idleMs:0});
  fixture.prepare=()=>listener({type:'prepare',nonce:crypto.randomUUID()});
  fixture.close=()=>{close();off();};`
 } }).outputFiles[0].contents;
 server=createServer((request,response)=>{
  response.setHeader('Content-Type',request.url==='/fixture.js'?'text/javascript':'text/html');
  response.end(request.url==='/fixture.js'?script:'<!doctype html><meta charset="utf-8"><p id="counter">Idle page</p><script src="/fixture.js"></script>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,chromiumSandbox:true});
});
after(async()=>{
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,'renderer-browser-regression.json'),JSON.stringify({scope:'Actual module/real browser MutationObserver; synthetic host and background; no native acceptance',browserVersion:browser?.version(),observations},null,2)+'\n');}
 await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
});
async function open(t,query=''){
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
 await page.goto(origin+'/'+query);await page.waitForFunction(()=>window.fixture?.policies.includes(true));return page;
}
test('real browser DOM invalidation during persistence revokes the lease and reports cancel-dom',async t=>{
 const page=await open(t);await page.evaluate(()=>window.fixture.prepare());await page.waitForFunction(()=>window.fixture.phase==='saving');
 await page.evaluate(()=>{document.querySelector('#counter').textContent='A real DOM mutation';});
 await page.waitForFunction(()=>window.fixture.receipts.some(value=>!value.ready&&value.reason==='cancel-dom'));
 await page.evaluate(()=>window.fixture.resolve());await page.waitForFunction(()=>window.fixture.phase==='written');
 const ready=await page.evaluate(()=>window.fixture.receipts.some(value=>value.ready));assert.equal(ready,false);
 observations.push({case:'real-mutation-observer',ready:false,reason:'cancel-dom'});
});
test('safety invalidation during persistence has its own category and cannot certify a late write',async t=>{
 const page=await open(t);await page.evaluate(()=>window.fixture.prepare());await page.waitForFunction(()=>window.fixture.phase==='saving');
 await page.evaluate(()=>window.fixture.changed());await page.waitForFunction(()=>window.fixture.receipts.some(value=>value.reason==='cancel-safety'));
 await page.evaluate(()=>window.fixture.resolve());
 await page.waitForFunction(()=>window.fixture.phase==='written');
 assert.equal(await page.evaluate(()=>window.fixture.receipts.some(value=>value.ready)),false);
 observations.push({case:'safety-during-persistence',ready:false,reason:'cancel-safety'});
});
test('pre-ready draft refusal starts no durable write; an unchanged page must fulfill one before readiness',async t=>{
 const blocked=await open(t,'?blocked');await blocked.evaluate(()=>window.fixture.prepare());
 await blocked.waitForFunction(()=>window.fixture.receipts.some(value=>value.reason==='unknown-draft'));
 assert.equal(await blocked.evaluate(()=>window.fixture.phase),'idle');
 const healthy=await open(t);await healthy.evaluate(()=>window.fixture.prepare());await healthy.waitForFunction(()=>window.fixture.phase==='saving');
 assert.equal(await healthy.evaluate(()=>window.fixture.receipts.some(value=>value.ready)),false);
 await healthy.evaluate(()=>window.fixture.resolve());await healthy.waitForFunction(()=>window.fixture.receipts.some(value=>value.ready&&value.reason==='renderer-ready'));
 observations.push({case:'pre-ready-versus-durable',draftRefusedBeforeWrite:true,unchangedPageWaitedForWrite:true});
});
