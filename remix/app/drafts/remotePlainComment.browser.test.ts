import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_LOCAL_REMOTE_PLAIN_URL, playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts=process.env.TT_LOCAL_REMOTE_PLAIN_ARTIFACTS;

test('native account-only plain draft recovery is read-only until explicit independent copy', {skip:!base||!playwrightPath,timeout:150_000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin};
 let owner='',parent='',reviewing=false,offline=false,accountReads=0;
 const sources=[randomUUID(),randomUUID()],errors:string[]=[],reviewWrites:unknown[]=[],sourceWrites:unknown[]=[],bounds:unknown[]=[];
 const input=page.getByPlaceholder('Write a comment… 💬',{exact:true}),open=page.getByRole('button',{name:'Recover earlier comment draft',exact:true}),dialog=page.getByRole('dialog').filter({hasText:'Earlier comment draft'});
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{
  if(new URL(request.url()).pathname!=='/api/v1/drafts')return;
  if(request.method()==='GET')accountReads++;
  if(request.method()==='POST'){
   const body=request.postDataJSON(),entry={operation:body.operation,id:body.id,sourceId:body.sourceId};
   if(reviewing)reviewWrites.push(entry);if(sources.includes(body.id)||sources.includes(body.sourceId))sourceWrites.push(entry);
  }
 });
 const raw=(id:string)=>context.request.get(url('/api/v1/drafts?id='+id));
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='remoteplain-'+randomUUID().slice(0,8),registered=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(registered.status(),200,await registered.text());owner=(await registered.json()).user.id;
  const created=await context.request.post(url('/api/v1/things'),{headers,data:{thingtime:['data'],crystal:{name:'Private remote draft fixture'},acl:['tt:user']}});
  assert.equal(created.status(),200,await created.text());parent=(await created.json()).thing.id;
  const draftContext='comment:plain:'+parent,longName='Earlier account draft with a deliberately long name for narrow phone review';
  const content={name:longName,surface:'comment',context:draftContext,snapshot:JSON.stringify({text:'Original account-only text\nwith exact breaks'}),attachmentIds:[]};
  const save=async(id:string,revision:number,mode:string,value:typeof content)=>{
   const response=await context.request.post(url('/api/v1/drafts'),{headers,data:{operation:'save',id,writeId:randomUUID(),revision,mode,content:value,expectedActor:owner}});
   assert.equal(response.status(),200,await response.text());return(await response.json()).draft;
  };
  await save(sources[0],0,'draft',content);
  const template=await save(sources[1],0,'template',{...content,name:'Earlier reusable plain template',snapshot:JSON.stringify({text:'Reusable template text'})});
  await page.goto(url('/thing/'+parent));await input.waitFor();assert.equal(await input.inputValue(),'','Unscoped account draft is never automatically adopted');
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  reviewing=true;await open.click();await dialog.getByRole('button',{name:'Find earlier account drafts',exact:true}).click();
  await dialog.getByRole('button',{name:longName,exact:true}).click();await dialog.locator('pre').getByText('Original account-only text\nwith exact breaks',{exact:true}).waitFor();
  assert.equal(await input.inputValue(),'');assert.deepEqual(reviewWrites,[]);
  const retained=await page.evaluate(async(ids:string[])=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('thingtime.local-workspaces.v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   try{return await new Promise<boolean>((resolve,reject)=>{const tx=db.transaction('records','readonly'),request=tx.objectStore('records').getAll();tx.oncomplete=()=>resolve(request.result.some(row=>ids.includes(row.id)&&['drafts','account-drafts'].includes(row.collection)));tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  },sources);assert.equal(retained,false,'Review does not retain original IDs or queue state');
  reviewing=false;await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await input.fill('Keep my current text');await page.getByText('Draft saved on this device ✓',{exact:true}).waitFor();
  await open.click();await dialog.getByRole('button',{name:longName,exact:true}).click();await dialog.locator('pre').waitFor();
  const updated=await save(sources[0],1,'draft',{...content,snapshot:JSON.stringify({text:'Newer account text\nwith exact breaks'})});
  await dialog.getByRole('button',{name:'Append to comment',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'The earlier draft changed.'}).waitFor();
  assert.equal(await input.inputValue(),'Keep my current text');await dialog.getByRole('button',{name:longName,exact:true}).click();await dialog.locator('pre').getByText('Newer account text\nwith exact breaks',{exact:true}).waitFor();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(async()=>{await document.fonts.ready;});
   const box=await dialog.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1);bounds.push({width,box});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   const button=dialog.getByRole('button',{name:'Append to comment',exact:true});await button.scrollIntoViewIfNeeded();
   assert.equal(await button.evaluate((button:HTMLElement)=>{const b=button.getBoundingClientRect();return[0.1,0.5,0.9].every(p=>button.contains(document.elementFromPoint(b.x+b.width*p,b.y+b.height/2)));}),true);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`review-${width}.png`),animations:'disabled'});
  }
  await dialog.getByRole('button',{name:'Append to comment',exact:true}).click();await dialog.waitFor({state:'hidden'});
  let combined='Keep my current text\n\nNewer account text\nwith exact breaks';assert.equal(await input.inputValue(),combined);
  await open.click();await dialog.getByRole('button',{name:'Earlier reusable plain template',exact:true}).click();await dialog.locator('pre').getByText('Reusable template text',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Append to comment',exact:true}).click();await dialog.waitFor({state:'hidden'});combined+='\n\nReusable template text';assert.equal(await input.inputValue(),combined);
  await page.getByText('Draft saved on this device ✓',{exact:true}).waitFor();offline=true;await context.setOffline(true);await page.reload();
  await page.waitForFunction((text:string)=>(document.querySelector('textarea[placeholder="Write a comment… 💬"]') as HTMLTextAreaElement)?.value===text,combined);
  await open.click();const reads=accountReads;await dialog.getByRole('button',{name:'Find earlier account drafts',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Reconnect'}).waitFor();assert.equal(accountReads,reads,'Offline review cannot issue account requests');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});offline=false;await context.setOffline(false);
  const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible())await reconnect.click();
  assert.deepEqual((await(await raw(sources[0])).json()).draft,updated);assert.deepEqual((await(await raw(sources[1])).json()).draft,template);
  assert.deepEqual(sourceWrites,[]);assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({remoteOnly:true,noAutomaticAdoption:true,reviewWrites,sourceWrites,noSourceRetention:true,changedSourceRefused:true,templatePreserved:true,coldOfflineCopy:true,offlineReadRefused:true,bounds,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,reviewWrites,sourceWrites,offline},null,2));}throw error;}
 finally{
  try{
   await context.setOffline(false);
   if(owner)for(const id of sources){
    const response=await raw(id);
    if(response.status()===200){const saved=(await response.json()).draft;await context.request.post(url('/api/v1/drafts'),{headers,data:{operation:'delete',id,revision:saved.revision,expectedActor:owner}});}
   }
   if(parent)await context.request.delete(url('/api/v1/things'),{headers,data:{id:parent}});
   if(owner)await context.request.post(url('/api/v1/auth/logout'),{headers,data:{all:true}});
  }
  finally{await browser.close();}
 }
});
