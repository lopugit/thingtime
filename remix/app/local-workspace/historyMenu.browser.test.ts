import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_LOCAL_HISTORY_MENU_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_LOCAL_HISTORY_MENU_ARTIFACTS;

test('owned account History opens from the offline menu and retires on a native account switch',{skip:!base||!playwrightPath,timeout:180_000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),control=await context.newPage();
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin},users:{id:string;username:string}[]=[],errors:string[]=[],offlineWrites:string[]=[];
 let thingId='',offline=false;const title='Private History menu fixture',value='Account A recorded private value';
 page.setDefaultTimeout(20_000);control.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(r:any)=>{if(offline&&!['GET','HEAD','OPTIONS'].includes(r.method()))offlineWrites.push(new URL(r.url()).pathname);});
 const history=page.getByRole('dialog',{name:'History',exact:true});
 const open=async()=>{await page.getByRole('button',{name:'Thing actions',exact:true}).click();await page.getByRole('menuitem',{name:/History/}).click();await history.getByRole('button',{name:new RegExp('Created Thing '+title)}).waitFor();};
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  for(let n=0;n<2;n++){
   const username='historyqa-'+randomUUID().slice(0,8),r=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
   assert.equal(r.status(),200,await r.text());users.push({id:(await r.json()).user.id,username});
   if(n===0){const created=await context.request.post(url('/api/v1/things'),{headers,data:{thingtime:['data'],crystal:{name:title,value},acl:['tt:user']}});assert.equal(created.status(),200,await created.text());thingId=(await created.json()).thing.id;}
  }
  await control.goto(url('/settings/account'));
  await control.getByRole('button',{name:new RegExp('^Switch to .*'+users[0].username)}).click();
  await page.goto(url('/thing/'+thingId));await open();
  await history.getByRole('button',{name:new RegExp('Created Thing '+title)}).click();await history.getByRole('button',{name:'View data',exact:true}).click();
  await history.locator('pre').filter({hasText:value}).waitFor();await history.getByRole('button',{name:'Close',exact:true}).click();await history.waitFor({state:'detached'});
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await context.setOffline(true);await page.reload();await open();
  await history.getByRole('button',{name:new RegExp('Created Thing '+title)}).click();await history.getByRole('button',{name:'View data',exact:true}).click();
  await history.locator('pre').filter({hasText:value}).waitFor();await history.getByRole('button',{name:'Close',exact:true}).click();await history.waitFor({state:'detached'});await open();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});if(!await history.count())await open();
   await page.evaluate(()=>document.fonts.ready);const bounds=await history.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   const entry=history.getByRole('button',{name:new RegExp('Created Thing '+title)});await entry.scrollIntoViewIfNeeded();await entry.click();
   const details=width===1440?history:page.getByRole('dialog',{name:'Version details',exact:true});
   await details.getByRole('button',{name:'View data',exact:true}).click();const recorded=details.locator('pre').filter({hasText:value});await recorded.scrollIntoViewIfNeeded();await recorded.waitFor();
   if(artifacts)await page.screenshot({path:resolve(artifacts,`account-history-${width}.png`),animations:'disabled'});
   if(width!==1440)await details.getByRole('button',{name:'Close',exact:true}).click();
   await history.getByRole('button',{name:'Close',exact:true}).click();await history.waitFor({state:'detached'});
  }
  assert.deepEqual(offlineWrites,[]);
  offline=false;await context.setOffline(false);await page.reload();await page.setViewportSize({width:1440,height:1000});await open();
  await control.getByRole('button',{name:new RegExp('^Switch to .*'+users[1].username)}).click();
  await history.waitFor({state:'hidden'});
  await page.waitForFunction((value:string)=>!document.body.innerText.includes(value),value);
  assert.equal((await context.request.get(url('/api/v1/things?id='+thingId))).status(),404);
  await control.getByRole('button',{name:new RegExp('^Switch to .*'+users[0].username)}).click();
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(await history.count(),0);await open();
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({thingId,offlineMenu:true,cachedCanonicalVersion:true,accountSwitchClosesHistory:true,returningAccountDoesNotReopenHistory:true,privateAccountRefusal:true,viewports:[1440,390,320],offlineWrites,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),thingId,errors,offlineWrites},null,2));}throw error;}
 finally{await page.close();await control.close();await context.setOffline(false).catch(()=>{});if(users[0])await context.request.post(url('/api/v1/auth/accounts/switch'),{headers,data:{userId:users[0].id}}).catch(()=>{});if(thingId)await context.request.delete(url('/api/v1/things'),{headers,data:{id:thingId}}).catch(()=>{});await browser.close();}
});
