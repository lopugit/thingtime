import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_LOCAL_PLAIN_COMMENT_URL, playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts=process.env.TT_LOCAL_PLAIN_COMMENT_ARTIFACTS;
test('native plain comment recovery is explicit, preserves edits and posts independently of drafts', { skip:!base||!playwrightPath,timeout:150_000 },async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),headers={Origin:new URL(base!).origin};
 const url=(path:string)=>new URL(path,base).href,errors:string[]=[],writes:string[]=[],bounds:unknown[]=[];
 let id='',owner='',offline=false,legacyKey='',original='Earlier comment text';
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
 const legacy=async(value?:string)=>page.evaluate(async({key,value}:{key:string;value?:string})=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('localforage');req.onupgradeneeded=()=>req.result.createObjectStore('keyvaluepairs');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('keyvaluepairs',value===undefined?'readonly':'readwrite'),req=value===undefined?tx.objectStore('keyvaluepairs').get(key):tx.objectStore('keyvaluepairs').put(value,key);tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 },{key:legacyKey,value});
 const input=page.getByPlaceholder('Write a comment… 💬',{exact:true}),recovery=page.getByRole('button',{name:'Recover earlier comment draft',exact:true});
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='plainqa-'+randomUUID().slice(0,8);
  const registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});assert.equal(registration.status(),200,await registration.text());owner=(await registration.json()).user.id;
  const created=await context.request.post(url('/api/v1/things'),{headers,data:{thingtime:['data'],crystal:{name:'Plain draft recovery fixture'},acl:['tt:user']}});assert.equal(created.status(),200,await created.text());id=(await created.json()).thing.id;
  legacyKey=`tt-draft:${owner}:${id}`;
  await page.goto(url('/thing/'+id));await input.waitFor();await legacy(original);await page.reload();await recovery.waitFor();assert.equal(await input.inputValue(),'');
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await context.setOffline(true);
  await input.fill('Keep current');await input.press('End');await input.press('Shift+Enter');await input.pressSequentially('comment');await page.getByText('Draft saved on this device ✓',{exact:true}).waitFor();
  await recovery.click();const dialog=page.getByRole('dialog').filter({hasText:'Earlier comment draft'});
  await dialog.getByRole('button',{name:'Earlier text draft',exact:true}).click();await dialog.locator('pre').getByText(original,{exact:true}).waitFor();
  original='Changed earlier comment';await legacy(original);
  await dialog.getByRole('button',{name:'Append to comment',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'The earlier draft changed.'}).waitFor();
  assert.equal(await input.inputValue(),'Keep current\ncomment');await dialog.getByRole('button',{name:'Earlier text draft',exact:true}).click();await dialog.locator('pre').getByText(original,{exact:true}).waitFor();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(async()=>{await document.fonts.ready;});
   const box=await dialog.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1);bounds.push({width,box});
   const button=dialog.getByRole('button',{name:'Append to comment',exact:true});await button.scrollIntoViewIfNeeded();
   assert.equal(await button.evaluate((button:HTMLElement)=>{const b=button.getBoundingClientRect();return[0.1,0.5,0.9].every(p=>button.contains(document.elementFromPoint(b.x+b.width*p,b.y+b.height/2)));}),true);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`review-${width}.png`),animations:'disabled'});
  }
  await dialog.getByRole('button',{name:'Append to comment',exact:true}).click();await dialog.waitFor({state:'hidden'});
  let combined='Keep current\ncomment\n\n'+original;assert.equal(await input.inputValue(),combined);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await input.evaluate((element:HTMLElement)=>element.scrollIntoView({block:'center'}));
   const button=page.getByRole('button',{name:'Send comment',exact:true});
   assert.equal(await button.evaluate((button:HTMLElement)=>{const b=button.getBoundingClientRect();return button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`composer-${width}.png`),animations:'disabled'});
  }
  await page.getByText('Draft saved on this device ✓',{exact:true}).waitFor();await page.reload();await input.waitFor();
  await page.waitForFunction((expected:string)=>(document.querySelector('textarea[placeholder="Write a comment… 💬"]') as HTMLTextAreaElement)?.value===expected,combined);
  assert.equal(await legacy(),original);
  await page.evaluate(() => {
   const put = IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put = function(value: any, ...args: any[]) {
    if (this.name === 'records' && value?.collection === 'drafts') throw Error('Fixture draft storage failure');
    return put.call(this, value, ...args);
   };
  });
  combined += ' Sending despite draft storage failure.';
  await input.fill(combined);await page.getByRole('button',{name:'Retry save',exact:true}).waitFor();
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.getByLabel('Comments results',{exact:true}).getByText(combined,{exact:true}).count(),0,'IME confirmation must not send');
  await input.press('Enter');
  await page.waitForFunction(()=>(document.querySelector('textarea[placeholder="Write a comment… 💬"]') as HTMLTextAreaElement)?.value==='');
  await page.getByLabel('Comments results',{exact:true}).getByText(combined,{exact:true}).waitFor();assert.equal(await input.inputValue(),'');assert.equal(await legacy(),original);
  await page.reload();await input.waitFor();assert.equal(await input.inputValue(),'');await page.getByLabel('Comments results',{exact:true}).getByText(combined,{exact:true}).waitFor();assert.equal(await legacy(),original);
  // A corrupt legacy source produces a visible error and cannot overwrite the current input.
  await legacy('x'.repeat(512*1024));await recovery.click();await dialog.getByRole('button',{name:'Earlier text draft',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'too large'}).waitFor();assert.equal(await input.inputValue(),'');assert.equal((await legacy() as string).length,512*1024);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();offline=false;await context.setOffline(false);
  const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible())await reconnect.click();
  let received:any[]=[];
  for(let attempt=0;attempt<80;attempt++){
   const response=await context.request.get(url('/api/v1/things?target='+id+'&thingtime=comment&commentProjection=true&limit=20'));assert.equal(response.status(),200);
   received=(await response.json()).comments||[];if(received.some(row=>row.text===combined))break;
   await page.waitForTimeout(100);
  }
  assert.equal(received.filter(row=>row.text===combined).length,1,'Local comment syncs exactly once after verified reconnect');
  assert.equal(received.find(row=>row.text===combined).author.id,owner);
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({explicitRecovery:true,changedReviewRefused:true,currentTextKept:true,coldOfflineReload:true,sourceKeptAfterPosting:true,postingDespiteDeviceDraftFailure:true,shiftEnterAndEnter:true,imeDoesNotSubmit:true,accountReconnectExactlyOnce:true,invalidSourcePreserved:true,bounds,writes,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,writes},null,2));}throw error;}
 finally{try{offline=false;await context.setOffline(false);if(id)await context.request.delete(url('/api/v1/things'),{headers,data:{id}});if(owner)await context.request.post(url('/api/v1/auth/logout'),{headers,data:{}});}finally{await browser.close();}}
});
