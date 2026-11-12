import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { workspaceDraftContext } from './workspaceDraft';
const base = process.env.TT_LOCAL_RICH_DRAFT_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_RICH_DRAFT_ARTIFACTS;
test('rich composers isolate automatic recovery and copy templates into their current workspace', { skip: !base || !playwrightPath, timeout: 160_000 }, async () => {
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width:1440,height:1000 } }), page = await context.newPage();
 const origin = new URL(base!).origin, url = (path:string) => new URL(path,base).href, headers = { Origin:origin };
 const ids:string[] = [], errors:string[] = [], requests:string[] = [];
 page.setDefaultTimeout(20_000); page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{if(new URL(request.url()).pathname==='/api/v1/drafts')requests.push(request.url());});
 const poll = async (read:()=>Promise<any>, accept:(value:any)=>boolean) => {
  for(let n=0;n<100;n++){const value=await read();if(accept(value))return value;await page.waitForTimeout(250);}throw Error('Rich draft did not converge');
 };
 const paragraph=page.locator('.ce-paragraph[contenteditable="true"]').first();
 const open=async()=>{const button=page.getByRole('button',{name:"What's on your mind? ✨",exact:true});await Promise.race([button.waitFor(),paragraph.waitFor()]);if(await button.isVisible())await button.click();await paragraph.waitFor();};
 try {
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='richscope-'+randomUUID().slice(0,8);
  const registered=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(registered.status(),200,await registered.text());const owner=(await registered.json()).user.id;
  await page.goto(url('/feed'));await page.waitForFunction(()=>localStorage.getItem('thingtime:local-workspace-root:v1')?.startsWith('["account"'));
  const pointer=await page.evaluate(()=>JSON.parse(localStorage.getItem('thingtime:local-workspace-root:v1')!));
  const scope={kind:'account' as const,origin,ownerId:owner,dataPlane:pointer[4]};
  const ownContext=await workspaceDraftContext(scope,'post:new:'),foreignContext=await workspaceDraftContext({...scope,dataPlane:'other-fixture-plane'},'post:new:');
  const seed=async(name:string,draftContext:string,mode='draft',pendingSubmission:unknown=null)=>{
   const id=randomUUID();ids.push(id);const response=await context.request.post(url('/api/v1/drafts'),{headers,data:{operation:'save',id,writeId:randomUUID(),revision:0,mode,expectedActor:owner,
    content:{name,surface:'post',context:draftContext,attachmentIds:[],snapshot:JSON.stringify({postEditorValue:{kind:'rich-text',blocks:[{type:'paragraph',data:{text:'<b>'+name+'</b>'}}]},visibility:'private',attachments:[],pendingSubmission})}}});
   assert.equal(response.status(),200,await response.text());return id;
  };
  const own=await seed('My matching rich draft',ownContext);
  await seed('Different database private draft',foreignContext);
  const legacy=await seed('Earlier unscoped private draft','post:new:','draft',{shareId:'do-not-replay',payload:{text:'Earlier operation'},attachmentIds:[],postType:'text',expectation:null,unknownOutcome:true});
  const template=await seed('Reusable rich template','post:new:','template');
  await page.reload();await open();await poll(()=>paragraph.innerText(),text=>text==='My matching rich draft');
  assert.equal(await paragraph.locator('b').innerText(),'My matching rich draft');
  assert.equal(await page.getByRole('button',{name:'Post ✨',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Load drafts & templates',exact:true}).click();
  const dialog=page.getByRole('dialog').filter({hasText:'Your drafts & templates'});
  await dialog.getByRole('button',{name:/Reusable rich template/}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:/Different database|Earlier unscoped/}).count(),0);
  await dialog.getByRole('button',{name:/Reusable rich template/}).click();await dialog.waitFor({state:'hidden'});
  await poll(()=>paragraph.innerText(),text=>text==='Reusable rich template');
  const copies=await poll(async()=>(await context.request.get(url('/api/v1/drafts'))).json(),result=>result.drafts?.some((row:any)=>row.name==='Reusable rich template'&&row.mode==='draft'&&row.context===ownContext));
  const copy=copies.drafts.find((row:any)=>row.name==='Reusable rich template'&&row.mode==='draft');ids.push(copy.id);assert.notEqual(copy.id,template);
  assert.equal((await(await context.request.get(url('/api/v1/drafts?id='+template))).json()).draft.revision,1);
  assert.equal((await(await context.request.get(url('/api/v1/drafts?id='+legacy))).json()).draft.revision,1);
  assert.equal((await(await context.request.get(url('/api/v1/drafts?id='+own))).json()).draft.context,ownContext);
  // A fresh browser store with only this disposable account's session must
  // retain the exact uncertain operation in its own workspace, without replay.
  const pendingOperation={shareId:randomUUID(),payload:{text:'Scoped uncertain operation',visibility:'private'},attachmentIds:[],postType:'text',expectation:null,unknownOutcome:true};
  const pendingId=await seed('Scoped uncertain operation',ownContext,'draft',pendingOperation);
  const session=await context.storageState();
  const fresh=await browser.newContext({storageState:{cookies:session.cookies,origins:[]}}),freshPage=await fresh.newPage();
  const freshWrites:string[]=[];freshPage.on('request',(request:any)=>{const path=new URL(request.url()).pathname;if(!['GET','HEAD','OPTIONS'].includes(request.method())&&path!=='/api/v1/things/search')freshWrites.push(path);});
  await freshPage.goto(url('/feed'));await freshPage.getByRole('button',{name:'Check and retry safely',exact:true}).waitFor();
  await freshPage.reload();await freshPage.getByRole('button',{name:'Check and retry safely',exact:true}).waitFor();
  const pendingRead=(await(await context.request.get(url('/api/v1/drafts?id='+pendingId))).json()).draft;
  assert.deepEqual(JSON.parse(pendingRead.snapshot).pendingSubmission,pendingOperation);assert.equal(pendingRead.revision,1);assert.deepEqual(freshWrites,[]);
  await fresh.close();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  await context.setOffline(true);await page.reload();await open();await poll(()=>paragraph.innerText(),text=>text==='Reusable rich template');
  // Workspace identity is available on first render, even if WebCrypto stalls.
  await page.addInitScript(()=>{
   const digest=crypto.subtle.digest.bind(crypto.subtle);
   crypto.subtle.digest=async(algorithm,data)=>{
    if(new TextDecoder().decode(data).startsWith('["account",'))return new Promise(()=>{});
    return digest(algorithm,data);
   };
  });
  await page.reload();await open();await poll(()=>paragraph.innerText(),text=>text==='Reusable rich template');
  await paragraph.press('ControlOrMeta+A');await paragraph.pressSequentially('Immediate rich editing after recovery');
  await page.getByText('Draft saved on this device ✓',{exact:true}).first().waitFor();
  await page.reload();await open();await poll(()=>paragraph.innerText(),text=>text==='Immediate rich editing after recovery');
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(async()=>{await document.fonts.ready;});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`rich-${width}.png`),animations:'disabled'});
  }
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({ownContext,foreignContext,canonicalTemplateCopy:copy.id,originalsUnchanged:true,pendingOperationPreservedWithoutReplay:true,coldOfflineRecovery:true,synchronousIdentityAndEditing:true,viewports:[1440,390,320],errors,accountDraftRequests:requests.length},null,2));
 }catch(error){
  if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,requests},null,2));}throw error;
 }finally{
  await page.close();await context.setOffline(false).catch(()=>{});
  for(const id of ids){const response=await context.request.get(url('/api/v1/drafts?id='+id)).catch(()=>null);if(response?.ok())await context.request.post(url('/api/v1/drafts'),{headers,data:{operation:'delete',id,revision:(await response.json()).draft.revision}}).catch(()=>{});}
  await context.request.post(url('/api/v1/auth/logout'),{headers}).catch(()=>{});await browser.close();
 }
});


test('anonymous rich drafts and posting remain local through cold offline recovery', { skip: !base || !playwrightPath, timeout: 90_000 }, async () => {
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium }=await import(playwrightPath!);
 const browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext(),page=await context.newPage(),requests:string[]=[],errors:string[]=[];
 context.on('request',(request:any)=>{if(new URL(request.url()).pathname==='/api/v1/drafts'||!['GET','HEAD','OPTIONS'].includes(request.method()))requests.push(request.url());});
 page.on('pageerror',(error:Error)=>errors.push(error.message));
 try{
  await page.goto(new URL('/feed',base).href);
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  await context.setOffline(true);
  const editor=page.locator('.ce-paragraph[contenteditable="true"]').first();await editor.pressSequentially('Anonymous rich draft stays on this device');
  await page.getByText('Draft saved on this device ✓',{exact:true}).first().waitFor();
  await page.reload();await editor.waitFor();assert.equal(await editor.innerText(),'Anonymous rich draft stays on this device');
  await page.getByRole('button',{name:'Save on this device',exact:true}).click();
  await page.waitForURL(/\/post\/local-post-/);
  await page.getByText('Anonymous rich draft stays on this device',{exact:true}).waitFor();
  await page.reload();await page.getByText('Anonymous rich draft stays on this device',{exact:true}).waitFor();
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'anonymous-verification.json'),JSON.stringify({coldOfflineRecovery:true,localPost:true,accountDraftRequestsAndMutations:requests,errors},null,2));
 }catch(error){
  if(artifacts){await page.screenshot({path:resolve(artifacts,'anonymous-failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'anonymous-failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,requests},null,2));}throw error;
 }finally{await browser.close();}
});
