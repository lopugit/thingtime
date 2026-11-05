import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_LOCAL_ACCOUNT_RECOVERY_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_LOCAL_ACCOUNT_RECOVERY_ARTIFACTS;

test('normal account History recovers a completed deletion offline and recreates the private Thing on reconnect',{skip:!base||!playwrightPath,timeout:180_000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname),'Disposable loopback fixtures only');
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),guest=await browser.newContext(),page=await context.newPage();
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin},title='Private offline recovery fixture';
 const errors:string[]=[],offlineWrites:string[]=[],writes:any[]=[];let thingId='',offline=false;
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(r:any)=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())){const path=new URL(r.url()).pathname;if(offline)offlineWrites.push(path);writes.push({path,method:r.method(),body:r.postDataJSON()});}});
 const remote=()=>context.request.get(url('/api/v1/things?id='+thingId));
 const until=async(check:()=>Promise<boolean>)=>{for(let n=0;n<150;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,200));}assert.fail('Account content did not converge');};
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='recovery-'+randomUUID().slice(0,8),registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(registration.status(),200,await registration.text());
  const created=await context.request.post(url('/api/v1/things'),{headers,data:{thingtime:['data'],crystal:{name:title,value:'Native recovery keeps editable content'},acl:['tt:user']}});
  assert.equal(created.status(),200,await created.text());thingId=(await created.json()).thing.id;
  await page.goto(url('/thing/'+thingId));await page.getByRole('button',{name:'Thing actions',exact:true}).click();await page.getByRole('menuitem',{name:/History/}).click();
  const history=page.getByRole('dialog',{name:'History',exact:true});await history.getByRole('button',{name:new RegExp('Created Thing '+title)}).waitFor();await history.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(url('/things'));await page.getByRole('link',{name:title,exact:true}).waitFor();
  const checkbox=page.getByRole('checkbox',{name:'Select '+title,exact:true});await page.locator('label').filter({has:checkbox}).click();await page.getByRole('button',{name:'🗑️ Delete',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Delete',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await until(async()=> (await remote()).status()===404);
  await page.getByRole('link',{name:'Timeline',exact:true}).click();await page.getByRole('button',{name:new RegExp('Deleted Thing on this device '+title)}).waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await context.setOffline(true);await page.reload();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.getByRole('button',{name:new RegExp('Deleted Thing on this device '+title)}).click();
   const details=width===1440?page:page.getByRole('dialog',{name:'Version details',exact:true});
   await details.getByRole('button',{name:'Recover this Thing…',exact:true}).click();await details.getByRole('heading',{name:'Recover deleted Thing',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`account-history-recovery-${width}.png`),animations:'disabled'});
   if(width===320){await details.getByRole('button',{name:'Recover Thing privately',exact:true}).click();await details.getByText('Version saved. The previous versions are still in your Timeline.',{exact:true}).waitFor();}
   else await details.getByRole('button',{name:'Cancel',exact:true}).click();
   await details.getByRole('button',{name:'Close preview',exact:true}).click();
  }
  await page.getByRole('button',{name:'← Things',exact:true}).click();await page.getByRole('link',{name:title,exact:true}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.deepEqual(offlineWrites,[]);assert.equal((await remote()).status(),404);
  offline=false;await context.setOffline(false);const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible())await reconnect.click();
  await until(async()=> (await remote()).status()===200);const recovered=(await(await remote()).json()).thing;
  assert.equal(recovered.id,thingId);assert.equal(recovered.crystal.name,title);assert.equal(recovered.crystal.value,'Native recovery keeps editable content');assert.deepEqual(recovered.acl,['tt:user']);
  assert.ok(writes.some(row=>row.path==='/api/v1/things'&&row.method==='POST'&&row.body.shareId===thingId),'normal authenticated create recreates the deleted ID');
  assert.equal((await guest.request.get(url('/api/v1/things?id='+thingId))).status(),404);assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({thingId,completedRemoteDeletion:true,nativeOfflineRecovery:true,coldOfflineReload:true,privateCanonicalRecreate:true,guestRefused:true,viewports:[1440,390,320],offlineWrites,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),thingId,errors,offlineWrites,writes},null,2));}throw error;}
 finally{await page.close();await context.setOffline(false).catch(()=>{});if(thingId)await context.request.delete(url('/api/v1/things'),{headers,data:{id:thingId}}).catch(()=>{});await guest.close();await context.close();await browser.close();}
});
