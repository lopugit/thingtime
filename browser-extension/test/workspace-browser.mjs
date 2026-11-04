// Synthetic UI acceptance only. Uses a disposable profile, reserved .test origin,
// no accounts or credentials, and removes its profile/windows on completion.
import {mkdtemp, mkdir, rm, writeFile, cp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {exercisePasswordWorkspace} from './vault-browser-scenario.mjs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const modulePath = process.argv[process.argv.indexOf('--playwright') + 1];
if (!process.argv.includes('--playwright') || !modulePath) throw new Error('Pass --playwright /absolute/path/to/playwright/index.mjs');
const {chromium} = await import(pathToFileURL(modulePath));
const source = fileURLToPath(new URL('../', import.meta.url));
const extension = await mkdtemp(path.join(tmpdir(), 'thingtime-workspace-extension-'));
await cp(source,extension,{recursive:true,filter:p=>!p.includes('/test')});
execFileSync(process.execPath,[fileURLToPath(new URL('../../remix/scripts/build-password-extension.mjs',import.meta.url))]);
const {ZipReader,Uint8ArrayReader,Uint8ArrayWriter}=createRequire(new URL('../../remix/package.json',import.meta.url))('@zip.js/zip.js');
const packaged=new ZipReader(new Uint8ArrayReader(new Uint8Array(await readFile(new URL('../../remix/public/downloads/thingtime-passwords-extension.zip',import.meta.url)))));
const packagedFiles=await packaged.getEntries();await writeFile(path.join(extension,'qr.js'),await packagedFiles.find(e=>e.filename==='qr.js').getData(new Uint8ArrayWriter()));await packaged.close();
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.background.service_worker='acceptance-driver.js';
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
await writeFile(path.join(extension,'acceptance-driver.js'),`import './background.js';
import {createWorkspaceController} from './workspace.js';
import {safeOrigin} from './protocol.js';
const testController=createWorkspaceController(chrome,safeOrigin);
globalThis.fixtureFallbacks=[];
globalThis.fixtureProviderReplies=[];
globalThis.fixtureVaultDeliveries=[];const originalSend=chrome.tabs.sendMessage.bind(chrome.tabs);chrome.tabs.sendMessage=async(...args)=>{const result=await originalSend(...args);if(args[1]?.action==='vault-fill-values')globalThis.fixtureVaultDeliveries.push({tabId:args[0],documentId:args[2]?.documentId,ok:result?.ok===true});return result;};
chrome.runtime.onMessage.addListener(message=>{if(message?.action==='provider-response')globalThis.fixtureProviderReplies.push({id:message.id,errorName:message.error?.name});});
chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.action==='native-fallback'&&sender.url===chrome.runtime.getURL('popup.html'))globalThis.fixtureFallbacks.push({action:message.action,tabId:message.tabId,requestId:message.requestId});});
globalThis.openFixtureWorkspace=async()=>{const [tab]=await chrome.tabs.query({url:'https://workspace-fixture.test/'});return testController.open(tab);};`);
const profile = await mkdtemp(path.join(tmpdir(), 'thingtime-workspace-profile-'));
const output = process.env.THINGTIME_WORKSPACE_EVIDENCE || path.join(tmpdir(), 'thingtime-workspace-evidence');
const catalogOnly=process.argv.includes('--catalog-only');
await mkdir(output, {recursive:true});
await writeFile(path.join(output,'runtime.json'),JSON.stringify({profile,extension,browserExecutable:chromium.executablePath(),synthetic:true},null,2));
let context;let passwordWorkspaceAcceptance=null;
try {
 const headless=catalogOnly;
 context = await chromium.launchPersistentContext(profile, {headless, ...(headless?{channel:'chromium'}:{}), viewport:null, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const extensionOrigin = worker.url().split('/').slice(0,3).join('/');
 await context.route('https://workspace-fixture.test/**', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Disposable website fixture</title><h1>Website fixture</h1>'}));
 const site = await context.newPage();await site.goto('https://workspace-fixture.test/');
 // Establish the same ephemeral target tuple captured by the toolbar. The
 // synthetic bridge requests below have no account or credential.
 await worker.evaluate(async()=>{await Promise.all([globalThis.openFixtureWorkspace(),globalThis.openFixtureWorkspace()]);});
 const workspaceCount=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:chrome.runtime.getURL('popup.html')});return tabs.length;});
 assert.equal(workspaceCount,1,'Rapid toolbar-equivalent opens reuse one actual Chrome workspace');
 const page = context.pages().find(p=>p.url()===`${extensionOrigin}/popup.html`) || await context.waitForEvent('page');
 await page.waitForURL(`${extensionOrigin}/popup.html`);await page.getByText('Passkeys off',{exact:true}).waitFor();
 await page.locator('#target').filter({hasText:'https://workspace-fixture.test'}).waitFor();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const providerUIOrigin=process.argv.find(arg=>arg.startsWith('--provider-ui-origin='))?.slice('--provider-ui-origin='.length);
 if(providerUIOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(providerUIOrigin))throw new Error('Use an explicit loopback origin for the synthetic actual-provider fixture');
 async function check(name) {
  await page.locator('header img.mark').waitFor();
  assert.equal(await page.locator('header img.mark').evaluate(image=>image.complete && image.naturalWidth===128 && image.getAttribute('alt')===''),true,`${name}: official decorative tree loads`);
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width,`${name}: horizontal overflow`);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});await page.evaluate(()=>window.scrollTo(0,0));
 }
 async function exerciseSlowCatalog(){
 // Test the real account bridge over a reserved synthetic origin. The second
 // complete catalog is delayed beyond the old roster deadline and fails once.
 const catalogOrigin='https://catalog-fixture.test';
 await context.route(`${catalogOrigin}/**`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Synthetic vault</title><script>
  const owner='synthetic-catalog-owner';
  const accounts=[{id:owner,username:'fixture-owner',active:true}];
  const catalog=Array.from({length:64},(_,i)=>({id:'entry-'+i,title:'Amazon account '+String(i).padStart(2,'0'),username:'fixture-'+i+'@example.test',domains:['workspace-fixture.test'],origins:['https://workspace-fixture.test'],fillEligible:true}));
  window.catalogRequests=0;window.catalogCancelled=0;
  document.addEventListener('thingtime:extension-accounts-cancel',()=>window.catalogCancelled++);
  document.addEventListener('thingtime:extension-accounts-request',event=>{
   const {nonce,operation}=JSON.parse(event.detail);
   const send=reply=>document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-response',{detail:JSON.stringify({version:1,nonce,...reply})}));
   if(operation==='discover'){send({accounts});return;}
   window.catalogRequests++;
   if(window.holdCatalog){
    window.releaseCatalog=error=>send(error?{error:true}:{accounts,catalog:[...catalog,{...catalog[0],id:'new',title:'Amazon root account',username:'fixture-root@example.test'}]});
   }else send({accounts,catalog});
  });
 </script>`}));
 const catalogPage=await context.newPage();await catalogPage.goto(catalogOrigin);
 await page.getByRole('tab',{name:'Config'}).click();await page.locator('#origin').fill(catalogOrigin);await page.getByRole('button',{name:'Save connection',exact:true}).click();
 await page.getByRole('tab',{name:'Overview'}).click();await page.locator('#vault-count').getByText('64 saved accounts',{exact:true}).waitFor();
 assert.equal(await page.locator('.vault-account').count(),50);
 await page.getByRole('button',{name:'Load more accounts'}).click();
 assert.equal(await page.locator('.vault-account').count(),64);
 await catalogPage.evaluate(()=>window.holdCatalog=true);
 const firstFill=page.locator('.vault-account button').first();
 await firstFill.focus();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await catalogPage.waitForFunction(()=>typeof window.releaseCatalog==='function');
 assert.equal(await firstFill.evaluate(button=>document.activeElement===button),true);
 const requests=await catalogPage.evaluate(()=>window.catalogRequests);
 for(const width of [960,375]){
  await page.setViewportSize({width,height:740});
  await page.locator('#vault-search').fill('fixture-63');
  await page.locator('.vault-account').getByText('fixture-63@example.test',{exact:true}).waitFor();
  assert.equal(await page.locator('#vault-progress:visible').count(),1);
  assert.equal(await page.locator('#vault-status').textContent(),'');
  if(width===375){
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.vault-spinner').evaluate(spinner=>getComputedStyle(spinner).animationName),'none');
  }
  await check(`catalog-refresh-${width}`);
 }
 await page.locator('#vault-refresh').click();
 assert.equal(await catalogPage.evaluate(()=>window.catalogRequests),requests,'Repeated refresh coalesces while request is pending');
 // Give the prior 2.5-second cutoff time to fire if it regresses.
 await new Promise(resolve=>setTimeout(resolve,2700));
 assert.equal(await page.locator('#vault-progress').isVisible(),true);
 const filteredFill=page.locator('.vault-account button');
 await filteredFill.focus();
 await catalogPage.evaluate(()=>{window.releaseCatalog(true);delete window.releaseCatalog;});
 await page.locator('#vault-status').getByText('Saved accounts could not be loaded. Choose Refresh to retry.',{exact:true}).waitFor();
 assert.equal(await page.locator('#vault-progress').isVisible(),false);
 assert.equal(await page.locator('.vault-account').getByText('fixture-63@example.test',{exact:true}).count(),1);
 assert.equal(await filteredFill.evaluate(button=>document.activeElement===button),true);
 await page.locator('#vault-refresh').click();await catalogPage.waitForFunction(()=>typeof window.releaseCatalog==='function');
 await page.locator('#vault-search').fill('amazon root');
 await catalogPage.evaluate(()=>{window.releaseCatalog(false);delete window.releaseCatalog;});
 await page.locator('.vault-account').getByText('fixture-root@example.test',{exact:true}).waitFor();
 assert.equal(await page.locator('#vault-progress').isVisible(),false);
 await page.locator('#vault-refresh').click();await catalogPage.waitForFunction(()=>typeof window.releaseCatalog==='function');
 await page.locator('#vault-lock').click();
 await catalogPage.waitForFunction(()=>window.catalogCancelled===1);
 await catalogPage.evaluate(()=>window.releaseCatalog(false));
 await page.getByRole('heading',{name:'Connection locked',exact:true}).waitFor();
 assert.equal(await page.locator('.vault-account').count(),0);
 assert.equal(await page.locator('#vault-search').inputValue(),'');
 await catalogPage.close();
 }
 if(catalogOnly){
  await exerciseSlowCatalog();
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'result.json'),JSON.stringify({status:'pass',synthetic:true,checks:['64-entry catalog','slow refresh on desktop and mobile','cached search and paging','coalescing','error/retry','lock cancels refresh'],errors},null,2));
  console.log(`Synthetic Chrome workspace catalog acceptance passed. Evidence: ${output}`);
 }else{
 await check('overview-desktop');
 await page.getByRole('tab',{name:'Requests'}).click();await page.getByText('No active passkey requests.',{exact:false}).waitFor();await check('requests-desktop');
 await page.getByRole('tab',{name:'Config'}).click();
 await page.locator('#width').fill('1100');await page.locator('#height').fill('820');await page.locator('#font-size').fill('20');await page.getByRole('button',{name:'Save appearance',exact:true}).click();await page.getByText('Appearance saved.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'20px');
 await page.reload();await page.getByRole('tab',{name:'Config'}).click();assert.equal(await page.locator('#width').inputValue(),'1100');assert.equal(await page.locator('#font-size').inputValue(),'20');await check('config-desktop');
 await page.evaluate(async()=>{const w=await chrome.windows.getCurrent();await chrome.windows.update(w.id,{left:Math.round(screen.availLeft+screen.availWidth-w.width*.9),top:Math.round(screen.availTop+screen.availHeight-w.height*.9)});});
 await page.getByRole('button',{name:'Apply size to this window'}).click();
 await page.getByText('Saved dimensions applied to this window, fitted to the available screen.',{exact:true}).waitFor();
 await page.waitForFunction(async()=>{const w=await chrome.windows.getCurrent();return w.left>=screen.availLeft&&w.top>=screen.availTop&&w.left+w.width<=screen.availLeft+screen.availWidth&&w.top+w.height<=screen.availTop+screen.availHeight;},{},{timeout:5000});
 const positioned=await page.evaluate(async()=>({window:await chrome.windows.getCurrent(),screen:{left:screen.availLeft,top:screen.availTop,width:screen.availWidth,height:screen.availHeight}}));
 assert.ok(positioned.window.left>=positioned.screen.left && positioned.window.top>=positioned.screen.top);
 assert.ok(positioned.window.left+positioned.window.width<=positioned.screen.left+positioned.screen.width && positioned.window.top+positioned.window.height<=positioned.screen.top+positioned.screen.height);
 await page.getByRole('tab',{name:'Config'}).focus();await page.keyboard.press('ArrowRight');await page.getByRole('tab',{name:'Help',selected:true}).waitFor();await page.keyboard.press('Home');await page.getByRole('tab',{name:'Overview',selected:true}).waitFor();
 // Retarget while the workspace remains focused: session storage events, not
 // tabs.sendMessage (a content-script-only channel), must refresh the label.
 await worker.evaluate(async()=>{await chrome.storage.session.remove('workspaceTarget');});
 await page.getByText('No current website selected.',{exact:false}).waitFor();
 await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({url:'https://workspace-fixture.test/'});const frame=await chrome.webNavigation.getFrame({tabId:tab.id,frameId:0});await chrome.storage.session.set({workspaceTarget:{tabId:tab.id,windowId:tab.windowId,documentId:frame.documentId,origin:'https://workspace-fixture.test'}});});
 await page.locator('#target').filter({hasText:'https://workspace-fixture.test'}).waitFor();
 // Exercise the real page content bridge and background admission/handshake.
 // The provider is a reserved .test fixture; no key is generated or signed and
 // fallback is observed at the page bridge without starting native OS WebAuthn.
 await context.route('https://provider-fixture.test/**', route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Disposable provider fixture</title><h1>Approval fixture</h1><script>
 const emit=(name,detail)=>document.dispatchEvent(new CustomEvent(name,{detail:JSON.stringify(detail)}));
 const ready=()=>emit('thingtime:password-provider-ready',{version:1});
 document.addEventListener('thingtime:password-provider-init',ready);
 document.addEventListener('thingtime:password-provider-request',event=>{window.fixtureRequest=JSON.parse(event.detail);document.body.dataset.requestReady='true';});
 ready();
 </script>`}));
 await page.getByRole('tab',{name:'Config'}).click();await page.locator('#enabled').check();await page.locator('#origin').fill('https://provider-fixture.test');await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.getByText('Thingtime is enabled.',{exact:false}).waitFor();
 const requester=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({url:'https://workspace-fixture.test/'});return {tabId:tab.id,windowId:tab.windowId};});
 const oldOpened=context.waitForEvent('page');const oldWindow=await worker.evaluate(()=>chrome.windows.create({url:'https://workspace-fixture.test/old-meta-quest',type:'normal',focused:true}));const oldMeta=await oldOpened;await oldMeta.waitForURL('https://workspace-fixture.test/old-meta-quest');await oldMeta.evaluate(()=>document.title='Meta Quest · old synthetic tab');
 async function startBridgeRequest(type) {
  const opened=context.waitForEvent('page');
  await site.evaluate(type=>{
   window.fixtureReply=null;
   const id=crypto.randomUUID();
   const receive=event=>{const value=JSON.parse(event.detail);if(value.id!==id)return;document.removeEventListener('thingtime:extension-response',receive);window.fixtureReply={value,focused:document.hasFocus()};};
   document.addEventListener('thingtime:extension-response',receive);
   document.dispatchEvent(new CustomEvent('thingtime:extension-request',{detail:JSON.stringify({version:1,id,type,publicKey:{challenge:'AQID',timeout:60000,...(type==='get'?{rpId:'workspace-fixture.test'}:{rp:{id:'workspace-fixture.test',name:'Disposable fixture'},user:{id:'AQID',name:'fixture',displayName:'Fixture'},pubKeyCredParams:[{type:'public-key',alg:-7}]})}})}));
  },type);
  const provider=await opened;await provider.waitForURL('https://provider-fixture.test/passwords/provider');await provider.waitForFunction(()=>window.fixtureRequest?.version===1);
  const approval=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({url:'https://provider-fixture.test/passwords/provider'});const win=await chrome.windows.get(tab.windowId);return {id:win.id,type:win.type};});assert.equal(approval.type,'popup');assert.notEqual(approval.id,requester.windowId);assert.notEqual(approval.id,oldWindow.id);
  const delivered=await provider.evaluate(()=>({id:window.fixtureRequest.id,type:window.fixtureRequest.type,origin:window.fixtureRequest.origin}));
  assert.equal(delivered.origin,'https://workspace-fixture.test');assert.equal(delivered.type,type);
  await page.bringToFront();await page.getByRole('tab',{name:'Requests'}).click();await page.getByRole('button',{name:'Refresh requests'}).click();
  const card=page.locator('#requests article');await card.getByText('https://workspace-fixture.test',{exact:true}).waitFor();await card.getByRole('heading',{name:type==='create'?'Save a passkey':'Sign in with a passkey'}).waitFor();
  assert.equal(await page.locator('#request-count').textContent(),'1');
  return {provider,delivered};
 }
 const active=await startBridgeRequest('get');await check('requests-active-desktop');
 await page.setViewportSize({width:375,height:740});await check('requests-active-375');
 await page.getByRole('button',{name:'Use another passkey provider',exact:true}).click();
 await site.waitForFunction(()=>window.fixtureReply?.value.fallback===true);
 const fallback=await site.evaluate(()=>window.fixtureReply);const focusDiagnostic=await worker.evaluate(async()=>({last:(await chrome.windows.getLastFocused()).id,focused:(await chrome.windows.getAll()).filter(w=>w.focused).map(w=>w.id)}));await writeFile(path.join(output,'focus-diagnostic.json'),JSON.stringify({requester,oldWindowId:oldWindow.id,focusDiagnostic,sourceDOMFocus:fallback.focused,oldDOMFocus:await oldMeta.evaluate(()=>document.hasFocus()),note:'Both documents can report hasFocus in this automation runtime; Chrome focused-window metadata is the exclusive window oracle.'},null,2));assert.equal(focusDiagnostic.last,requester.windowId);assert.deepEqual(focusDiagnostic.focused,[requester.windowId]);assert.equal(oldMeta.isClosed(),false);
 assert.equal(fallback.focused,true,'Fallback returns to the focused original website before page bridge delivery');
 assert.deepEqual(await worker.evaluate(()=>globalThis.fixtureFallbacks.at(-1)),{action:'native-fallback',tabId:requester.tabId,requestId:active.delivered.id});
 assert.equal(active.provider.isClosed(),true);
 const focusedRequester=await worker.evaluate(async ({tabId,windowId})=>({tab:await chrome.tabs.get(tabId),window:await chrome.windows.get(windowId)}),requester);assert.equal(focusedRequester.tab.active,true);assert.equal(focusedRequester.window.focused,true);
 await page.getByText('No active passkey requests.',{exact:false}).waitFor();assert.equal(await page.locator('#request-count').textContent(),'0');
 const cancelled=await startBridgeRequest('create');
 await cancelled.provider.evaluate(()=>document.dispatchEvent(new CustomEvent('thingtime:password-provider-response',{detail:JSON.stringify({version:1,id:window.fixtureRequest.id,error:{name:'AbortError'}})})));
 await site.waitForFunction(()=>window.fixtureReply?.value.error?.name==='AbortError');assert.equal((await site.evaluate(()=>window.fixtureReply)).focused,true);
 assert.equal(cancelled.provider.isClosed(),true);
 await page.bringToFront();await page.getByRole('button',{name:'Refresh requests'}).click();await page.getByText('No active passkey requests.',{exact:false}).waitFor();assert.equal(await page.locator('#request-count').textContent(),'0');
 if(providerUIOrigin){
  await page.bringToFront();await page.getByRole('tab',{name:'Config'}).click();await page.locator('#origin').fill(providerUIOrigin);await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.getByText('Thingtime is enabled.',{exact:false}).waitFor();
  const opening=context.waitForEvent('page');
  await site.evaluate(()=>{window.fixtureReply=null;const id=crypto.randomUUID();window.fixtureOriginalId=id;document.addEventListener('thingtime:extension-response',function receive(event){const value=JSON.parse(event.detail);if(value.id!==id)return;document.removeEventListener('thingtime:extension-response',receive);window.fixtureReply={value,focused:document.hasFocus()};});document.dispatchEvent(new CustomEvent('thingtime:extension-request',{detail:JSON.stringify({version:1,id,type:'create',publicKey:{challenge:'AQID',rp:{id:'workspace-fixture.test',name:'Synthetic site'},user:{id:'BAUG',name:'fixture@example.test',displayName:'Synthetic account'},pubKeyCredParams:[{type:'public-key',alg:-7}],excludeCredentials:[{type:'public-key',id:'AQID'}],attestation:'none'}})}));});
  const provider=await opening;await provider.waitForURL(`${providerUIOrigin}/passwords/provider`);provider.on('pageerror',e=>errors.push(e.message));
  await provider.getByRole('button',{name:'Verify and save passkey',exact:true}).waitFor();await provider.getByLabel('Thingtime account password',{exact:true}).fill('synthetic-fixture-only');await provider.getByRole('button',{name:'Verify and save passkey',exact:true}).click();
  await provider.getByRole('button',{name:'Return to website',exact:true}).waitFor();
  assert.equal(await provider.getByRole('button',{name:'Refresh saved passkeys',exact:true}).count(),0);assert.equal(await provider.getByRole('button',{name:'Verify and save passkey',exact:true}).count(),0);assert.equal(await provider.getByRole('button',{name:'Use another passkey provider',exact:true}).count(),0);assert.equal(await provider.locator('input[type="password"]').count(),0);
  const operations=await provider.evaluate(()=>window.passwordProviderFixture.operations);assert.ok(operations.includes('verify-passkey'));assert.equal(operations.includes('save')||operations.includes('fill'),false);assert.equal(await site.evaluate(()=>window.fixtureReply),null);
  for(const width of [960,375]){await provider.setViewportSize({width,height:740});await provider.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));assert.ok(await provider.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await provider.screenshot({path:path.join(output,`actual-provider-terminal-${width}.png`),fullPage:true});}
  const request=await provider.evaluate(()=>window.passwordProviderFixture.request);await provider.getByRole('button',{name:'Return to website',exact:true}).click();await site.waitForFunction(()=>window.fixtureReply?.value.error?.name==='InvalidStateError');const reply=await site.evaluate(()=>window.fixtureReply);assert.equal(reply.value.id,await site.evaluate(()=>window.fixtureOriginalId));assert.deepEqual(await worker.evaluate(()=>globalThis.fixtureProviderReplies.at(-1)),{id:request.id,errorName:'InvalidStateError'});assert.equal(reply.focused,true);assert.equal(provider.isClosed(),true);
  await page.bringToFront();await page.getByRole('tab',{name:'Requests'}).click();await page.getByRole('button',{name:'Refresh requests'}).click();await page.getByText('No active passkey requests.',{exact:false}).waitFor();assert.equal(await page.locator('#request-count').textContent(),'0');
  passwordWorkspaceAcceptance=await exercisePasswordWorkspace({context,worker,site,page,origin:providerUIOrigin,output});
  await page.getByRole('tab',{name:'Config'}).click();
 }
 await exerciseSlowCatalog();
 await page.setViewportSize({width:960,height:760});
 await page.getByRole('tab',{name:'Config'}).click();await page.locator('#enabled').uncheck();await page.locator('#origin').fill('https://thingtime.com');await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.getByText('Thingtime is off.',{exact:false}).waitFor();
 // Viewport changes model resizing without touching the user's browser.
 for(const viewport of [{width:375,height:740},{width:740,height:375}]){
  await page.setViewportSize(viewport);
  for(const tab of ['Overview','Requests','Config','Help']){await page.getByRole('tab',{name:tab}).click();await check(`${tab.toLowerCase()}-${viewport.width}`);}
 }
 await page.setViewportSize({width:375,height:740});await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.getByRole('tab',{name:'Config'}).click();await page.locator('#font-size').fill('32');await page.getByRole('button',{name:'Save appearance',exact:true}).click();await check('config-dark-large-text');
 await page.getByRole('tab',{name:'Help'}).click();await check('help-dark-large-text');await page.getByRole('tab',{name:'Overview'}).click();await check('overview-dark-large-text');
 await site.goto('https://workspace-fixture.test/navigated');await page.getByRole('tab',{name:'Overview'}).click();await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('No current website selected.',{exact:false}).waitFor();
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'result.json'),JSON.stringify({status:'pass',synthetic:true,passwordWorkspaceAcceptance,checks:['screen fit','all tabs desktop/narrow/landscape','32px text dark/reduced-motion','keyboard tabs','appearance save/reload','stale document target','rendered active get/create requests via content bridge','exact fallback request identity','fallback/cancellation requester focus and request cleanup','dedicated popup with two same-site windows and original requester return','64-entry slow catalog refresh, cached search, retry, coalescing and lock'],actualProviderFixture:providerUIOrigin?{status:'pass',syntheticAPI:true,checks:['actual component excluded create','no approval refresh or fallback','password input cleared','explicit return exact two-hop identity','requester focus and cleanup']}:null,errors},null,2));
 console.log(`Synthetic Chrome workspace acceptance passed. Evidence: ${output}`);
 }
} finally {await context?.close();await rm(profile,{recursive:true,force:true});await rm(extension,{recursive:true,force:true});}
