import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_LOCAL_ACCOUNT_RECOVERY_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_LOCAL_ACCOUNT_RECOVERY_ARTIFACTS;

test('normal account History recovers a completed deletion offline and recreates the private Thing on reconnect',{skip:!base||!playwrightPath,timeout:180_000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname),'Disposable loopback fixtures only');
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),verifier=await browser.newContext(),guest=await browser.newContext(),page=await context.newPage(),verifierPage=await verifier.newPage();
 const url=(path:string)=>new URL(path,base).href,title='Private offline recovery fixture';
 const errors:string[]=[],offlineWrites:string[]=[],writes:any[]=[];let thingId='',offline=false;
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(r:any)=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())){const path=new URL(r.url()).pathname;if(offline)offlineWrites.push(path);writes.push({path,method:r.method(),...(!path.startsWith('/api/v1/auth/')&&!path.includes('/login')?{body:r.postDataJSON()}:{})});}});
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 const connectivity=async(value:boolean)=>{offline=value;await context.setOffline(value);await cdp.send('Network.overrideNetworkState',{offline:value,latency:1,downloadThroughput:100_000_000,uploadThroughput:100_000_000,connectionType:'ethernet'});};
 const remote=()=>verifierPage.evaluate(async id=>{const response=await fetch('/api/v1/things?id='+encodeURIComponent(id));return {status:response.status,body:await response.json()};},thingId);
 const until=async(check:()=>Promise<boolean>)=>{for(let n=0;n<150;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,200));}assert.fail('Account content did not converge');};
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});await connectivity(false);
  const username='recovery-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID();await page.goto(url('/.well-known/thingtime-capabilities.json'));
  const registration=await page.evaluate(async input=>{const response=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{username,email:username+'@example.test',password});
  assert.equal(registration.status,200,JSON.stringify(registration.body));
  assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),registration.body.user.id);
  await verifierPage.goto(url('/.well-known/thingtime-capabilities.json'));
  assert.equal(await verifierPage.evaluate(async input=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,{username,password}),200);
  assert.equal(await verifierPage.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),registration.body.user.id);
  const created=await page.evaluate(async input=>{const response=await fetch('/api/v1/things',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{thingtime:['data'],crystal:{name:title,value:'Native recovery keeps editable content'},acl:['tt:user']});
  assert.equal(created.status,200,JSON.stringify(created.body));thingId=created.body.thing.id;
  await page.goto(url('/thing/'+thingId));await page.getByRole('button',{name:'Thing actions',exact:true}).click();await page.getByRole('menuitem',{name:/History/}).click();
  const history=page.getByRole('dialog',{name:'History',exact:true});await history.getByRole('button',{name:new RegExp('Created Thing '+title)}).waitFor();await history.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(url('/things'));await page.getByRole('link',{name:title,exact:true}).waitFor();
  const checkbox=page.getByRole('checkbox',{name:'Select '+title,exact:true});await checkbox.focus();await checkbox.press('Space');assert.equal(await checkbox.isChecked(),true);await page.getByRole('button',{name:'🗑️ Delete',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Delete',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await until(async()=> (await remote()).status===404);
  await page.getByRole('link',{name:'Timeline',exact:true}).click();await page.getByRole('button',{name:new RegExp('Deleted Thing on this device '+title)}).waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  await connectivity(true);await page.reload();
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
  await page.reload();await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.deepEqual(offlineWrites,[]);assert.equal((await remote()).status,404);
  await connectivity(false);const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible()&&await reconnect.isEnabled())await reconnect.click();
  await until(async()=> (await remote()).status===200);const recovered=(await remote()).body.thing;
  assert.equal(recovered.id,thingId);assert.equal(recovered.crystal.name,title);assert.equal(recovered.crystal.value,'Native recovery keeps editable content');assert.deepEqual(recovered.acl,['tt:user']);
  assert.ok(writes.some(row=>row.path==='/api/v1/things'&&row.method==='POST'&&row.body.shareId===thingId),'normal authenticated create recreates the deleted ID');
  assert.equal((await guest.request.get(url('/api/v1/things?id='+thingId))).status(),404);assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({thingId,completedRemoteDeletion:true,nativeOfflineRecovery:true,coldOfflineReload:true,privateCanonicalRecreate:true,guestRefused:true,viewports:[1440,390,320],offlineWrites,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),thingId,errors,offlineWrites,writes},null,2));}throw error;}
 finally{await connectivity(false).catch(()=>{});await page.close();if(thingId)await verifierPage.evaluate(async id=>{await fetch('/api/v1/things',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});},thingId).catch(()=>{});await guest.close();await verifier.close();await context.close();await browser.close();}
});

test('History recovers a deleted post, comment, and exact bound files after the account cascade',
 {skip:!base||!playwrightPath||!process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE,timeout:300_000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname),'Disposable loopback fixtures only');
 const {chromium}=await import(playwrightPath!);
 const browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),verifier=await browser.newContext(),admin=await browser.newContext(),guest=await browser.newContext();
 const page=await context.newPage(),verifierPage=await verifier.newPage(),url=(path:string)=>new URL(path,base).href;
 const errors:string[]=[],offlineWrites:string[]=[],uploads:string[]=[],deletes:string[]=[];
 const parentText='Private parent History recovery '+randomUUID().slice(0,8),childText='Private child History recovery '+randomUUID().slice(0,8);
 let parentId='',childId='',offline=false,ownerId='';
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{const path=new URL(request.url()).pathname;if(path==='/api/v1/attachments/uploads'&&request.method()==='POST')uploads.push(path);if(path==='/api/v1/attachments/delete'&&request.method()==='POST')deletes.push(path);if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))offlineWrites.push(path);});
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 const connectivity=async(value:boolean)=>{offline=value;await context.setOffline(value);await cdp.send('Network.overrideNetworkState',{offline:value,latency:1,downloadThroughput:100_000_000,uploadThroughput:100_000_000,connectionType:'ethernet'});};
 const until=async<T>(read:()=>Promise<T|null>,label:string)=>{for(let n=0;n<120;n++){const value=await read();if(value!==null)return value;await page.waitForTimeout(500);}assert.fail(label);};
 const ownerGet=async(path:string)=>{const result=await verifierPage.evaluate(async path=>{const response=await fetch(path);return {status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};},path);const body=Buffer.from(result.bytes);return {status:()=>result.status,json:async()=>JSON.parse(body.toString('utf8')),body:async()=>body};};
 const thing=async(id:string)=>ownerGet('/api/v1/things?id='+encodeURIComponent(id));
 const file=async(id:string)=>ownerGet('/api/v1/attachments/content?id='+encodeURIComponent(id)+'&download=1');
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='historymedia-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID();
  await page.goto(url('/.well-known/thingtime-capabilities.json'));
  const registered=await page.evaluate(async input=>{const response=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{username,email:username+'@example.test',password});
  assert.equal(registered.status,200,JSON.stringify(registered.body));ownerId=registered.body.user.id;
  assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),ownerId);
  await verifierPage.goto(url('/.well-known/thingtime-capabilities.json'));
  assert.equal(await verifierPage.evaluate(async input=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,{username,password}),200);
  assert.equal(await verifierPage.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),ownerId);
  const adminPage=await admin.newPage(),credentials=JSON.parse(await readFile(process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE!,'utf8'));
  await adminPage.goto(url('/.well-known/thingtime-capabilities.json'));
  assert.equal(await adminPage.evaluate(async input=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,credentials),200);
  assert.equal(await adminPage.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.isAdmin;}),true);
  assert.equal(await adminPage.evaluate(async id=>(await fetch('/api/v1/admin/users/public-uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:id,enabled:true,scope:'public'})})).status,ownerId),200);
  await page.goto(url('/feed'));
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=96;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#6943a7';ctx.fillRect(0,0,80,96);ctx.fillStyle='#fef1bc';ctx.fillRect(12,18,56,60);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  await connectivity(true);await page.reload();
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();await page.getByRole('button',{name:'🖼️ Photos',exact:true}).click();
  await page.getByLabel('Who can see this post',{exact:true}).selectOption('private');
  await page.locator('.ce-paragraph[contenteditable="true"]').first().fill(parentText);
  await page.locator('input[type=file]').first().setInputFiles({name:'history-parent.png',mimeType:'image/png',buffer:png});
  await page.getByText('history-parent.png',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Post ✨',exact:true}).click();
  const card=page.locator('[data-thing-id]').filter({hasText:parentText}).first();await card.waitFor();parentId=(await card.getAttribute('data-thing-id'))!;assert.ok(parentId);
  await page.goto(url('/post/'+parentId));await page.getByText(parentText,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Open full comment composer',exact:true}).click();await page.getByRole('button',{name:'🖼️ Photos',exact:true}).click();
  await page.locator('.ce-paragraph[contenteditable="true"]').first().fill(childText);
  await page.locator('input[type=file]').first().setInputFiles({name:'history-child.png',mimeType:'image/png',buffer:png});
  await page.getByText('history-child.png',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Comment 💬',exact:true}).click();
  await page.locator('.ce-paragraph[contenteditable="true"]').waitFor({state:'detached',timeout:60_000});
  await page.reload();await page.getByText(childText,{exact:true}).waitFor();
  assert.deepEqual(offlineWrites,[]);assert.deepEqual(uploads,[]);
  await connectivity(false);await page.reload();
  const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible()&&await reconnect.isEnabled())await reconnect.click();
  const currentOwner=await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;});
  if(currentOwner!==ownerId){assert.equal(currentOwner,undefined);assert.equal(await page.evaluate(async input=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,{username,password}),200);await page.reload();}
  assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),ownerId);
  const parent=await until(async()=>{const response=await thing(parentId);return response.status()===200?(await response.json()):null;},'parent account sync did not complete');
  assert.equal(parent.thing.id,parentId);assert.equal(parent.thing.crystal.text,parentText);assert.deepEqual(parent.thing.acl,['tt:user']);
  assert.equal(parent.post.attachments.length,1);const oldParentFileId=parent.post.attachments[0].id;
  const child=await until(async()=>{const response=await ownerGet('/api/v1/things?target='+parentId+'&thingtime=comment&commentProjection=true&limit=20');assert.equal(response.status(),200);const matches=(await response.json()).comments.filter((row:any)=>row.text===childText);assert.ok(matches.length<=1);return matches.length?matches[0]:null;},'child account sync did not complete');
  childId=child.id;const childRead=await(await thing(childId)).json();assert.equal(childRead.thing.targetId,parentId);assert.equal(childRead.post.attachments.length,1);const oldChildFileId=childRead.post.attachments[0].id;
  assert.deepEqual(await(await file(oldParentFileId)).body(),png);assert.deepEqual(await(await file(oldChildFileId)).body(),png);
  assert.equal((await guest.request.get(url('/api/v1/things?id='+parentId))).status(),404);
  assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+oldChildFileId))).status(),404);
  assert.equal(uploads.length,2);
  await page.getByTestId('account-sync-status').waitFor({state:'detached'});
  await connectivity(true);await page.goto(url('/post/'+parentId));await page.getByRole('button',{name:'Post options',exact:true}).first().click();
  await page.getByRole('menuitem',{name:/^(?:🗑️\s*)?Delete$/}).click();await page.getByText(parentText,{exact:true}).waitFor({state:'hidden'});
  await page.reload();assert.equal(await page.getByText(parentText,{exact:true}).count(),0);assert.deepEqual(offlineWrites,[]);
  await connectivity(false);await page.reload();
  await until(async()=>{const parentResponse=await thing(parentId),childResponse=await thing(childId);return parentResponse.status()===404&&childResponse.status()===404?true:null;},'parent and child account deletion did not settle');
  await until(async()=>{const a=await file(oldParentFileId),b=await file(oldChildFileId);return a.status()===404&&b.status()===404?true:null;},'bound file cleanup did not settle');
  assert.ok(deletes.length<=2,'the parent cascade must not repeat file cleanup requests');
  await page.goto(url('/history?thing='+encodeURIComponent(parentId)+'&operation=delete'));
  const deleted=page.getByRole('button',{name:/Deleted Thing on this device/}).first();await deleted.waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;return !!navigator.serviceWorker.controller;});
  await connectivity(true);await page.reload();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await deleted.click();
   const details=width===1440?page:page.getByRole('dialog',{name:'Version details',exact:true});
   await details.getByRole('button',{name:'Recover this Thing…',exact:true}).click();
   await details.getByRole('heading',{name:'Recover deleted Thing',exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`bound-history-${width}.png`)});
   if(width===320){await details.getByRole('button',{name:'Recover Thing privately',exact:true}).click();await details.getByText('Version saved. The previous versions are still in your Timeline.',{exact:true}).waitFor();}
   else await details.getByRole('button',{name:'Cancel',exact:true}).click();
   await details.getByRole('button',{name:'Close preview',exact:true}).click();
  }
  await page.goto(url('/post/'+parentId));await page.getByText(parentText,{exact:true}).waitFor();await page.getByText(childText,{exact:true}).waitFor();
  for(const name of ['history-parent.png','history-child.png']){const image=page.getByRole('button',{name:'View '+name,exact:true}).locator('img');await image.waitFor();assert.deepEqual(await image.evaluate((img:HTMLImageElement)=>[img.naturalWidth,img.naturalHeight]),[80,96],'restored offline image must render from retained bytes');}
  await page.reload();await page.getByText(childText,{exact:true}).waitFor();assert.deepEqual(offlineWrites,[]);
  assert.equal((await thing(parentId)).status(),404);assert.equal((await thing(childId)).status(),404);
  await connectivity(false);await page.reload();if(await reconnect.isVisible()&&await reconnect.isEnabled())await reconnect.click();
  const recovered=await until(async()=>{const a=await thing(parentId),b=await thing(childId);return a.status()===200&&b.status()===200?{parent:await a.json(),child:await b.json()}:null;},'grouped account recovery did not converge');
  assert.equal(recovered.parent.thing.id,parentId);assert.equal(recovered.child.thing.id,childId);assert.equal(recovered.child.thing.targetId,parentId);
  assert.equal(recovered.parent.thing.crystal.text,parentText);assert.equal(recovered.child.thing.crystal.text,childText);
  assert.deepEqual(recovered.parent.thing.acl,['tt:user']);assert.deepEqual(recovered.child.thing.acl,['tt:inherit']);
  assert.equal(recovered.parent.post.attachments.length,1);assert.equal(recovered.child.post.attachments.length,1);
  const newParentFileId=recovered.parent.post.attachments[0].id,newChildFileId=recovered.child.post.attachments[0].id;
  assert.notEqual(newParentFileId,oldParentFileId);assert.notEqual(newChildFileId,oldChildFileId);
  assert.deepEqual(await(await file(newParentFileId)).body(),png);assert.deepEqual(await(await file(newChildFileId)).body(),png);
  assert.equal((await guest.request.get(url('/api/v1/things?id='+childId))).status(),404);
  assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+newParentFileId))).status(),404);
  await page.getByRole('region',{name:'Account file sync',exact:true}).waitFor({state:'detached'});
  assert.equal(uploads.length,4,'one new upload per acknowledged deleted file');assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'bound-recovery-verification.json'),JSON.stringify({parentId,childId,oldParentFileId,oldChildFileId,newParentFileId,newChildFileId,exactBytes:true,private:true,coldOfflineReload:true,groupedRecovery:true,uploads:uploads.length,deletes:deletes.length,offlineWrites,viewports:[1440,390,320],errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'bound-recovery-failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'bound-recovery-failure.json'),JSON.stringify({parentId,childId,ownerId,body:await page.locator('body').innerText().catch(()=>''),errors,offlineWrites,uploads:uploads.length,deletes:deletes.length},null,2));}throw error;}
 finally{await connectivity(false).catch(()=>{});if(parentId)await verifierPage.evaluate(async id=>{await fetch('/api/v1/things',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});},parentId).catch(()=>{});await guest.close();await admin.close();await verifier.close();await context.close();await browser.close();}
});
