import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { splitTimelineEvent } from '../timeline/records';
const base=process.env.TT_LOCAL_ACCOUNT_RESTORE_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_LOCAL_ACCOUNT_RESTORE_ARTIFACTS;

test('native account History restores and undoes retained versions offline before verified sync',{skip:!base||!playwrightPath,timeout:180_000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname),'Disposable loopback fixtures only');
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),guest=await browser.newContext(),page=await context.newPage();
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin};
 const titles=['Original account history fixture','First offline history edit','Second offline history edit'];
 const errors:string[]=[],offlineWrites:string[]=[],pushes:any[]=[],timelineRequests:string[]=[];let thingId='',ownerId='',offline=false;
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(r:any)=>{if(new URL(r.url()).pathname==='/api/v1/timeline')timelineRequests.push(r.method());if(!['GET','HEAD','OPTIONS'].includes(r.method())){
  if(offline)offlineWrites.push(new URL(r.url()).pathname);
  if(new URL(r.url()).pathname==='/api/v1/timeline')pushes.push(r.postDataJSON());
 }});
 const history=page.getByRole('dialog',{name:'History',exact:true});
 const open=async()=>{await page.getByRole('button',{name:'Thing actions',exact:true}).click();await page.getByRole('menuitem',{name:/History/}).click();await history.waitFor();};
 const close=async()=>{await history.getByRole('button',{name:'Close',exact:true}).click();await history.waitFor({state:'detached'});};
 const recorded=async()=>page.evaluate(async({ownerId,thingId})=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('thingtime.local-workspaces.v1');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  try{return await new Promise<any[]>((resolve,reject)=>{const req=db.transaction('records','readonly').objectStore('records').getAll();req.onsuccess=()=>resolve(req.result.filter(row=>row.collection==='timeline-events'&&row.value.event.ownerId===ownerId&&row.value.event.thingId===thingId).map(row=>row.value));req.onerror=()=>reject(req.error);});}finally{db.close();}
 },{ownerId,thingId});
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='localhistory-'+randomUUID().slice(0,8),registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(registration.status(),200,await registration.text());ownerId=(await registration.json()).user.id;
  const created=await context.request.post(url('/api/v1/things'),{headers,data:{thingtime:['data'],crystal:{name:titles[0],value:'Private canonical History fixture'},acl:['tt:user']}});
  assert.equal(created.status(),200,await created.text());thingId=(await created.json()).thing.id;
  await page.goto(url('/thing/'+thingId));await open();await history.getByRole('button',{name:new RegExp('Created Thing '+titles[0])}).waitFor();await close();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await context.setOffline(true);
  for(const title of titles.slice(1)){
   await page.getByRole('button',{name:'Thing actions',exact:true}).click();await page.getByRole('menuitem',{name:'✏️ Rename',exact:true}).click();
   await page.getByRole('textbox',{name:'Thing title',exact:true}).fill(title);await page.getByRole('button',{name:'Rename',exact:true}).click();
   await page.getByRole('heading',{name:title,exact:true}).waitFor();
  }
  const before=await recorded();assert.equal(before.length,2);
  await page.reload();await page.getByRole('heading',{name:titles[2],exact:true}).waitFor();await open();
  await history.getByRole('button',{name:new RegExp('Edited Thing on this device '+titles[1])}).click();
  const requestCount=timelineRequests.length;
  await history.getByRole('button',{name:'Restore this version…',exact:true}).click();
  await history.getByRole('heading',{name:'Review restore',exact:true}).waitFor();
  await history.getByRole('button',{name:'Restore this version',exact:true}).click();
  await history.getByText('Version saved. The previous versions are still in your Timeline.',{exact:true}).waitFor();
  assert.equal(timelineRequests.length,requestCount);await close();
  await page.getByRole('heading',{name:titles[1],exact:true}).waitFor();await page.reload();
  await page.getByRole('heading',{name:titles[1],exact:true}).waitFor();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await open();
   await history.getByRole('button',{name:new RegExp('Edited Thing on this device '+titles[1])}).click();
   const details=width===1440?history:page.getByRole('dialog',{name:'Version details',exact:true});
   await details.getByRole('button',{name:'Undo this change…',exact:true}).click();
   await details.getByRole('heading',{name:'Review undo',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
   const bounds=await details.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`account-history-undo-${width}.png`),animations:'disabled'});
   if(width===320){await details.getByRole('button',{name:'Undo this change',exact:true}).click();await details.getByText('Undid this change. Every version is still in your Timeline.',{exact:true}).waitFor();}
   else await details.getByRole('button',{name:'Cancel',exact:true}).click();
   if(width!==1440)await details.getByRole('button',{name:'Close',exact:true}).click();await close();
  }
  await page.getByRole('heading',{name:titles[0],exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:titles[0],exact:true}).waitFor();
  assert.equal((await recorded()).length,4);assert.ok((await recorded()).every(row=>row.receipt===null&&row.event.source==='client'&&row.event.mode==='draft'));
  assert.deepEqual(offlineWrites,[]);assert.equal(timelineRequests.length,requestCount);
  const remoteBefore=await context.request.get(url('/api/v1/things?id='+thingId));assert.equal((await remoteBefore.json()).thing.crystal.name,titles[0]);
  offline=false;await context.setOffline(false);await page.setViewportSize({width:1440,height:1000});
  const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible())await reconnect.click();
  let accepted=false;
  for(let n=0;n<150;n++){if((await recorded()).every(row=>row.receipt!==null)){accepted=true;break;}await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(accepted,'History receives real server receipts after reconnect');
  const remote=await context.request.get(url('/api/v1/things?id='+thingId));assert.equal((await remote.json()).thing.crystal.name,titles[0]);
  const endpoint=await context.request.get(url('/api/v1/timeline?'+new URLSearchParams({thingId,ownerId,dataPlane:JSON.parse(before[0].scope)[1]})));assert.equal(endpoint.status(),200,await endpoint.text());
  const entries=(await endpoint.json()).entries;for(const row of await recorded()){
   const entry=entries.find((entry:any)=>entry.event.id===row.event.id);assert.ok(entry);assert.deepEqual(entry.receipt,row.receipt);assert.deepEqual(splitTimelineEvent(entry.event).event,row.event);
  }
  assert.equal((await guest.request.get(url('/api/v1/things?id='+thingId))).status(),404);
  assert.equal((await guest.request.get(url('/api/v1/timeline?thingId='+thingId))).status(),401);
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({thingId,ownerId,deviceEvents:before.map(row=>row.event.id),nativeEdits:true,coldOfflineReload:true,intermediateVersions:true,canonicalReceipts:true,privateGuestRefusals:true,viewports:[1440,390,320],offlineWrites,errors,historyPushCount:pushes.length,nativeRestore:true,nativeUndo:true,deviceVersionCount:4},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),thingId,errors,offlineWrites,pushes},null,2));}throw error;}
 finally{await page.close();await context.setOffline(false).catch(()=>{});if(thingId)await context.request.delete(url('/api/v1/things'),{headers,data:{id:thingId}}).catch(()=>{});await guest.close();await context.close();await browser.close();}
});
