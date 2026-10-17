import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_LOCAL_POST_TEMPLATE_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_LOCAL_POST_TEMPLATE_ARTIFACTS,adminFile=process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE;
for(const account of [true,false])test(`${account?'offline account':'anonymous'} post templates keep independent media after source deletion`,{skip:!base||!playwrightPath||(account&&!adminFile),timeout:180_000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!);
 const browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),guest=await browser.newContext();
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin},errors:string[]=[],offlineWrites:string[]=[],accountDraftRequests:string[]=[];
 const directory=artifacts&&resolve(artifacts,account?'account':'anonymous');
 let offline=false,owner='',sourceId='',postId='',templateId='';
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{const path=new URL(request.url()).pathname;if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))offlineWrites.push(path);if(path==='/api/v1/drafts')accountDraftRequests.push(request.method());});
 const poll=async(read:()=>Promise<any>,accept:(value:any)=>boolean)=>{for(let n=0;n<120;n++){const value=await read();if(accept(value))return value;await page.waitForTimeout(300);}throw Error('Template fixture did not converge');};
 const records=()=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('thingtime.local-workspaces.v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
 });
 const post=async(text:string)=>{
  await page.getByRole('button',{name:account?'Post ✨':'Save on this device',exact:true}).click();
  if(account){const card=page.locator('[data-thing-id]').filter({hasText:text}).first();await card.waitFor();return await card.getAttribute('data-thing-id');}
  await page.waitForURL(/\/post\/local-post-/);await page.getByText(text,{exact:true}).waitFor();return new URL(page.url()).pathname.split('/').pop()!;
 };
 try{
  if(directory)await mkdir(directory,{recursive:true});
  if(account){const username='templateqa-'+randomUUID().slice(0,8),response=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});assert.equal(response.status(),200,await response.text());owner=(await response.json()).user.id;}
  await page.goto(url('/feed'));await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=220;const x=c.getContext('2d')!;x.fillStyle='#f4c9b1';x.fillRect(0,0,160,220);x.fillStyle='#945747';x.fillRect(30,70,100,80);return c.toDataURL('image/png').split(',')[1];}),'base64');
  offline=true;await context.setOffline(true);await page.reload();
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();await page.getByRole('button',{name:'🖼️ Photos',exact:true}).click();
  if(account)await page.getByLabel('Who can see this post',{exact:true}).selectOption('private');
  const text='Original offline template source';await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(text,{delay:12});
  await page.locator('input[type=file]').first().setInputFiles({name:'template-source.png',mimeType:'image/png',buffer:png});await page.getByText('template-source.png',{exact:true}).first().waitFor();
  sourceId=await post(text);assert.ok(sourceId);await page.goto(url('/post/'+sourceId));await page.reload();await page.getByText(text,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Post options',exact:true}).first().click();await page.getByText('Save as template',{exact:true}).click();
  const saved=await poll(records,rows=>rows.some((r:any)=>r.collection==='drafts'&&r.value.draft?.mode==='template'&&!r.value.deleted));
  const template=saved.find((r:any)=>r.collection==='drafts'&&r.value.draft?.mode==='template'&&!r.value.deleted).value.draft;templateId=template.id;
  const sourceFile=saved.find((r:any)=>r.collection==='things'&&r.value.targetId===sourceId&&r.value.thingtime.includes('attachment')).id;
  assert.equal(template.attachmentIds.length,1);assert.notEqual(template.attachmentIds[0],sourceFile);
  await page.getByRole('button',{name:'Post options',exact:true}).first().click();await page.getByText('Delete',{exact:true}).click();
  await poll(records,rows=>!rows.some((r:any)=>r.collection==='things'&&r.id===sourceId));
  await page.goto(url('/feed'));await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  await page.getByRole('button',{name:'Load drafts & templates',exact:true}).click();const dialog=page.getByRole('dialog').filter({hasText:'Your drafts & templates'});
  await dialog.getByRole('button',{name:new RegExp(text)}).click();await dialog.waitFor({state:'hidden'});
  const editor=page.locator('.ce-paragraph[contenteditable="true"]').first();await poll(()=>editor.innerText(),value=>value===text);
  const working=await poll(records,rows=>rows.some((r:any)=>r.collection==='drafts'&&!r.value.deleted&&r.value.source?.id===templateId));
  const copy=working.find((r:any)=>r.collection==='drafts'&&!r.value.deleted&&r.value.source?.id===templateId).value.draft;
  assert.notEqual(copy.attachmentIds[0],template.attachmentIds[0]);assert.match(copy.context,/:workspace:[a-f0-9]{64}$/);
  const copyText='Independent post made from offline template';await editor.press('ControlOrMeta+A');await editor.pressSequentially(copyText,{delay:12});
  postId=await post(copyText);await page.goto(url('/post/'+postId));await page.reload();await page.getByText(copyText,{exact:true}).waitFor();
  const image=page.getByRole('button',{name:'View template-source.png',exact:true}).locator('img');await image.evaluate((img:HTMLImageElement)=>img.decode());
  assert.equal(await image.evaluate((img:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d')!.drawImage(img,0,0);return c.toDataURL('image/png').split(',')[1];}),png.toString('base64'));
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await image.scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(directory)await page.screenshot({path:resolve(directory,`independent-${width}.png`),animations:'disabled'});}
  assert.deepEqual(offlineWrites,[]);let synced=false;
  if(account){
   const admin=await browser.newContext(),credentials=JSON.parse(await readFile(adminFile!,'utf8'));
   assert.equal((await admin.request.post(url('/api/v1/login'),{headers,data:{username:credentials.username,password:credentials.password}})).status(),200);
   const approved=await admin.request.post(url('/api/v1/admin/users/public-uploads'),{headers,data:{userId:owner,enabled:true,scope:'public'}});assert.equal(approved.status(),200,await approved.text());await admin.close();
   offline=false;await context.setOffline(false);await page.reload();
   const remote=await poll(async()=>{const r=await context.request.get(url('/api/v1/things?id='+postId));return r.status()===200?r.json():null;},value=>value?.post?.attachments?.length===1);
   const remoteTemplate=await poll(async()=>{const r=await context.request.get(url('/api/v1/drafts?id='+templateId));return r.status()===200?r.json():null;},value=>value?.draft?.attachmentIds?.length===1);
   assert.deepEqual(remote.thing.acl,['tt:user']);assert.notEqual(remote.post.attachments[0].id,remoteTemplate.draft.attachmentIds[0]);
   for(const id of [remote.post.attachments[0].id,remoteTemplate.draft.attachmentIds[0]]){const bytes=await context.request.get(url('/api/v1/attachments/content?id='+id+'&download=1'));assert.equal(bytes.status(),200);assert.deepEqual(await bytes.body(),png);assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+id))).status(),404);}
   assert.equal((await context.request.get(url('/api/v1/things?id='+sourceId))).status(),404);assert.equal((await guest.request.get(url('/api/v1/things?id='+postId))).status(),404);synced=true;
   // A retained account post must also delete offline through the native menu.
   offline=true;await context.setOffline(true);await page.reload();
   await page.getByRole('button',{name:'Post options',exact:true}).first().click();await page.getByText('Delete',{exact:true}).click();
   await poll(records,rows=>!rows.some((r:any)=>r.collection==='things'&&r.id===postId));
   assert.deepEqual(offlineWrites,[]);
   offline=false;await context.setOffline(false);await page.goto(url('/feed'));
   await poll(async()=> (await context.request.get(url('/api/v1/things?id='+postId))).status(),status=>status===404);
   assert.equal((await context.request.get(url('/api/v1/attachments/content?id='+remote.post.attachments[0].id))).status(),404);
   const preserved=await context.request.get(url('/api/v1/attachments/content?id='+remoteTemplate.draft.attachmentIds[0]+'&download=1'));
   assert.equal(preserved.status(),200);assert.deepEqual(await preserved.body(),png);

  }else assert.deepEqual(accountDraftRequests,[]);
  assert.deepEqual(errors,[]);if(directory)await writeFile(resolve(directory,'verification.json'),JSON.stringify({sourceId,postId,templateId,sourceDeleted:true,independentBytes:true,templatePreserved:true,syncedPostDeleted:account,offlineWrites,anonymousAccountRequests:account?undefined:accountDraftRequests,synced,viewports:[1440,390,320],errors},null,2));
 }catch(error){if(directory){await page.screenshot({path:resolve(directory,'failure.png')}).catch(()=>{});await writeFile(resolve(directory,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),sourceId,postId,templateId,errors,offlineWrites,accountDraftRequests},null,2));}throw error;
 }finally{
  await page.close();offline=false;await context.setOffline(false).catch(()=>{});
  if(account){for(const id of [sourceId,postId].filter(Boolean))await context.request.delete(url('/api/v1/things'),{headers,data:{id}}).catch(()=>{});if(templateId){const r=await context.request.get(url('/api/v1/drafts?id='+templateId)).catch(()=>null);if(r?.ok())await context.request.post(url('/api/v1/drafts'),{headers,data:{operation:'delete',id:templateId,revision:(await r.json()).draft.revision}}).catch(()=>{});}await context.request.post(url('/api/v1/auth/logout'),{headers}).catch(()=>{});}
  await browser.close();
 }
});
