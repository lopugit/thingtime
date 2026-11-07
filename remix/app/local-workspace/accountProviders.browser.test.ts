import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_ACCOUNT_PROVIDERS_URL,artifacts=process.env.TT_ACCOUNT_PROVIDERS_ARTIFACTS,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH;
const phrase='Disposable provider workspace passphrase',value=' synthetic retained account fixture ',localValue=' synthetic offline provider fixture ';
test('account provider Settings saves offline, retains only selected values and reviews conflicts before independent sync',{skip:!base||!artifacts||!playwrightPath,timeout:240_000},async()=>{
 const origin=new URL(base!).origin;assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const headers={Origin:origin,'X-Thingtime-Expected-Data-Plane':'home'},created=new Set<string>(),errors:string[]=[],offlineWrites:string[]=[],bounds:unknown[]=[];
 let offline=false,ownerId:string|undefined;
 page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))offlineWrites.push(new URL(request.url()).pathname);});
 const url=(path:string)=>new URL(path,origin).href;
 const post=(data:unknown)=>context.request.post(url('/api/v1/lopu/vault'),{headers,data});
 const metadata=async()=>{const response=await post({action:'sync-metadata',expectedOwnerId:ownerId});assert.equal(response.status(),200);return response.json();};
 const unlock=async()=>{await page.getByLabel('Device vault passphrase',{exact:true}).fill(phrase);await page.getByRole('button',{name:'Unlock device vault',exact:true}).click();};
 const row=(name:string)=>page.getByText(name,{exact:true}).locator('..').locator('..');
 const inspect=()=>page.evaluate(async(needles:string[])=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('thingtime.local-workspaces.v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{
   const rows:any[]=await new Promise((resolve,reject)=>{const request=db.transaction('records').objectStore('records').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const raw=JSON.stringify(rows)+JSON.stringify(Object.entries(localStorage));
   return{leak:needles.some(x=>raw.includes(x)),commands:rows.filter(x=>x.collection==='provider-vault-commands').length,anonymous:rows.filter(x=>x.collection.startsWith('provider-vault')&&JSON.parse(x.scope)[0]==='anonymous').length};
  }finally{db.close();}
 },[phrase,value,localValue]);
 try{
  await mkdir(artifacts!,{recursive:true});const username='providers-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID();
  const registered=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password}});assert.equal(registered.status(),200);ownerId=(await registered.json()).user.id;
  const existing=await post({action:'save-secret',name:'Account selected value',key:'SELECTED_FIXTURE',value,groupId:null});assert.equal(existing.status(),200);const remoteId=(await existing.json()).entry.id;created.add(remoteId);
  await page.goto(url('/settings/security#secure-vault'));await page.getByRole('button',{name:'Create device vault',exact:true}).waitFor();
  await page.getByLabel('Device vault passphrase',{exact:true}).fill(phrase);await page.getByLabel('Confirm device vault passphrase',{exact:true}).fill(phrase);await page.getByRole('button',{name:'Create device vault',exact:true}).click();
  await page.getByText('Account selected value',{exact:true}).waitFor();assert.equal((await inspect()).leak,false);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Show Account selected value',exact:true}).click();
  await page.getByLabel('Current password',{exact:true}).fill(password);await page.getByRole('button',{name:'Verify and show',exact:true}).click();
  await page.getByLabel('Account selected value credential',{exact:true}).waitFor();assert.equal(await page.getByLabel('Account selected value credential',{exact:true}).inputValue(),value);
  await page.getByRole('button',{name:'Keep this value offline',exact:true}).click();
  await page.getByLabel('Account selected value credential',{exact:true}).waitFor({state:'detached'});
  assert.deepEqual(await inspect(),{leak:false,commands:0,anonymous:0});
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await context.setOffline(true);assert.equal(await page.evaluate(async()=>{try{await fetch('/api/root-data',{cache:'no-store'});return false;}catch{return true;}}),true);
  await page.getByLabel('New vault environment').fill('Device environment');await page.getByRole('button',{name:'Add environment',exact:true}).click();await page.getByRole('button',{name:'Delete Device environment',exact:true}).waitFor();
  await page.getByLabel('Secret display name').fill('Offline credential');await page.getByLabel('Secret key',{exact:true}).fill('OFFLINE_FIXTURE');await page.getByLabel('Secret value',{exact:true}).fill(localValue);await page.getByLabel('Secret environment',{exact:true}).selectOption({label:'Device environment'});await page.getByRole('button',{name:'Save secret',exact:true}).click();await page.getByText('Offline credential',{exact:true}).waitFor();
  assert.deepEqual(await inspect(),{leak:false,commands:2,anonymous:0});
  // This fixture's own account context can represent a second device while the browser is offline.
  const deviceGroup=await page.getByLabel('Secret environment',{exact:true}).locator('option').filter({hasText:'Device environment'}).getAttribute('value');assert.ok(deviceGroup);created.add(deviceGroup);
  const collision=await post({action:'sync-write',expectedOwnerId:ownerId,command:{action:'create-group',id:deviceGroup,writeId:randomUUID(),expectedVersion:null,name:'Account environment'}});assert.equal(collision.status(),200);
  for(const[width,height]of[[1440,1000],[390,844],[320,844]]){
   await page.setViewportSize({width,height});await page.reload();await page.getByRole('button',{name:'Unlock device vault',exact:true}).waitFor();await unlock();await page.getByText('Offline credential',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Show Account selected value',exact:true}).click();await page.getByLabel('Account selected value credential',{exact:true}).waitFor();assert.equal(await page.getByLabel('Account selected value credential',{exact:true}).inputValue(),value);await page.getByRole('button',{name:'Hide',exact:true}).click();
   const measured=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(measured.width,measured.scrollWidth);bounds.push(measured);
   await page.locator('#secure-vault').screenshot({path:resolve(artifacts!,`account-provider-${width}.png`),animations:'disabled'});
  }
  assert.deepEqual(offlineWrites,[]);offline=false;await context.setOffline(false);await page.reload();await page.getByRole('button',{name:'Unlock device vault',exact:true}).waitFor();await unlock();
  await page.getByRole('button',{name:'Keep device versions as new entries',exact:true}).waitFor();
  const review=page.getByLabel('Review provider vault conflict');assert.ok((await review.innerText()).includes('Device environment'));assert.ok((await review.innerText()).includes('Offline credential'));
  await review.evaluate((element:HTMLElement)=>element.scrollIntoView({block:'center'}));
  assert.equal(await page.getByRole('button',{name:'Keep device versions as new entries',exact:true}).evaluate((element:HTMLElement)=>{const b=element.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!hit&&element.contains(hit);}),true);
  await review.screenshot({path:resolve(artifacts!,'account-provider-conflict-320.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Keep device versions as new entries',exact:true}).click();await page.getByText('Device vault · no pending account changes',{exact:true}).waitFor();
  const after=await metadata();for(const item of [...after.groups,...after.entries])created.add(item.id);
  assert.equal(after.groups.length,2);assert.equal(after.entries.length,2);assert.equal(after.groups.find((x:any)=>x.id===deviceGroup).name,'Account environment');
  const copiedGroup=after.groups.find((x:any)=>x.id!==deviceGroup);assert.equal(after.entries.find((x:any)=>x.name==='Offline credential').groupId,copiedGroup.id);
  assert.deepEqual(await inspect(),{leak:false,commands:0,anonymous:0});assert.deepEqual(errors,[]);
  await writeFile(resolve(artifacts!,'verification.json'),JSON.stringify({offline:true,encrypted:true,selectedFreshRetention:true,coldReload:true,reviewedEnvironmentCopy:true,originalAccountPreserved:true,bounds,offlineWrites,errors},null,2));
 }catch(error){await page.screenshot({path:resolve(artifacts!,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(resolve(artifacts!,'failure.json'),JSON.stringify({name:(error as Error).name,message:(error as Error).message,errors,offlineWrites},null,2));throw error;}
 finally{
  try{
   offline=false;await context.setOffline(false);
   if(ownerId){const snapshot=await metadata();for(const item of [...snapshot.entries,...snapshot.groups]){created.add(item.id);const removed=await post({action:'delete',id:item.id});assert.equal(removed.status(),200);}const remaining=await metadata();assert.deepEqual(remaining.groups,[]);assert.deepEqual(remaining.entries,[]);await writeFile(resolve(artifacts!,'cleanup.json'),JSON.stringify({fixtureOnly:true,entriesCleaned:true}));}
  }finally{await context.close();await browser.close();}
 }
});
