import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_BOUND_MEDIA_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_BOUND_MEDIA_ARTIFACTS;
const adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE;
test('native account media saves offline and binds exact private bytes after verification', {skip:!base || !playwrightPath || !adminFile,timeout:180_000},async()=>{
 assert.ok(['127.0.0.1','localhost'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),admin=await browser.newContext(),guest=await browser.newContext(),page=await context.newPage();
 const url=(path:string)=>new URL(path,base).href,errors:string[]=[],writes:string[]=[];
 const uploads:string[]=[];
 let id='',commentId='',offline=false;page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 const request=async(method:string,target:string,options?:{data?:unknown})=>{
  const result=await page.evaluate(async({method,target,data})=>{const response=await fetch(target,{method,headers:data===undefined?undefined:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const bytes=new Uint8Array(await response.arrayBuffer()),text=new TextDecoder().decode(bytes);let json:unknown;try{json=JSON.parse(text);}catch{}return {status:response.status,text,json,bytes:Array.from(bytes)};},{method,target,data:options?.data});
  return {status:()=>result.status,json:async()=>result.json,body:async()=>Buffer.from(result.bytes),text:async()=>result.text};
 };
 const ownerRequest={get:(target:string)=>request('GET',target),patch:(target:string,options?:{data?:unknown})=>request('PATCH',target,options),post:(target:string,options?:{data?:unknown})=>request('POST',target,options)};
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 const connectivity=async(value:boolean)=>{offline=value;await context.setOffline(value);await cdp.send('Network.overrideNetworkState',{offline:value,latency:1,downloadThroughput:100_000_000,uploadThroughput:100_000_000,connectionType:'ethernet'});};
 page.on('request',(request:any)=>{if(new URL(request.url()).pathname==='/api/v1/attachments/uploads'&&request.method()==='POST')uploads.push(request.url());if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='authorqa-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID(),text='An editable private post created while offline.';
  await page.goto(url('/.well-known/thingtime-capabilities.json'));
  const registration=await page.evaluate(async input=>{const response=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{username,email:username+'@example.test',password});
  assert.equal(registration.status,200,JSON.stringify(registration.body));const owner=registration.body.user;
  assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),owner.id,'browser session must match the disposable owner');
  await page.goto(url('/feed'));
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=280;const x=c.getContext('2d')!;x.fillStyle='#f3d5b7';x.fillRect(0,0,200,280);x.fillStyle='#95482f';x.font='20px serif';x.fillText('Offline portrait',30,140);return c.toDataURL('image/png').split(',')[1];}),'base64');
  await connectivity(true);await page.reload();
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  await page.getByRole('button',{name:'🖼️ Photos',exact:true}).click();
  await page.getByLabel('Who can see this post',{exact:true}).selectOption('private');
  await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(text,{delay:15});
  await page.locator('input[type=file]').first().setInputFiles([{name:'offline-portrait.png',mimeType:'image/png',buffer:png},{name:'second-portrait.png',mimeType:'image/png',buffer:png}]);
  await page.getByText('offline-portrait.png',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Post ✨',exact:true}).click();
  const card=page.locator('[data-thing-id]').filter({hasText:text}).first();await card.waitFor();id=await card.getAttribute('data-thing-id');assert.ok(id);
  await page.goto(url('/post/'+id));await page.reload();await page.getByText(text,{exact:true}).waitFor();
  const image=page.locator('img[src^="blob:"]').first();await image.waitFor();await image.evaluate((img:HTMLImageElement)=>img.decode());assert.equal(await image.evaluate((img:HTMLImageElement)=>img.naturalWidth),200);
  assert.equal(await image.evaluate((img:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d')!.drawImage(img,0,0);return c.toDataURL('image/png').split(',')[1];}),png.toString('base64'));
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await image.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`post-${width}.png`)});}
  const commentText='A private reply with device media.';
  await page.getByRole('button',{name:'Open full comment composer',exact:true}).click();
  await page.getByRole('button',{name:'🖼️ Photos',exact:true}).click();
  await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(commentText,{delay:15});
  await page.locator('input[type=file]').first().setInputFiles({name:'reply-portrait.png',mimeType:'image/png',buffer:png});
  await page.getByText('reply-portrait.png',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Comment 💬',exact:true}).click();
  // The button changes its label while submitting; wait for the actual
  // composer to close after the local transaction commits before reloading.
  await page.locator('.ce-paragraph[contenteditable="true"]').waitFor({state:'detached'});
  await page.getByText(commentText,{exact:true}).waitFor();
  await page.reload();await page.getByText(commentText,{exact:true}).waitFor();
  const replyImage=page.getByRole('button',{name:'View reply-portrait.png',exact:true}).locator('img');
  await replyImage.scrollIntoViewIfNeeded();await replyImage.evaluate((img:HTMLImageElement)=>img.decode());assert.equal(await replyImage.evaluate((img:HTMLImageElement)=>img.naturalWidth),200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,'comment-320.png')});
  assert.deepEqual(writes,[]);assert.deepEqual(uploads,[]);
  const credentials=JSON.parse(await readFile(adminFile!,'utf8')),adminPage=await admin.newPage();
  await adminPage.goto(url('/.well-known/thingtime-capabilities.json'));
  assert.equal(await adminPage.evaluate(async input=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,credentials),200);
  assert.equal(await adminPage.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.isAdmin;}),true);
  assert.equal(await adminPage.evaluate(async userId=>(await fetch('/api/v1/admin/users/public-uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,enabled:true,scope:'public'})})).status,owner.id),200);
  await connectivity(false);await page.reload();
  const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible()&&await reconnect.isEnabled())await reconnect.click();
  const restoredUser=await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;});
  if(restoredUser!==owner.id){
   assert.equal(restoredUser,undefined,'offline session recovery must not select a different account');
   assert.equal(await page.evaluate(async input=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,{username,password}),200);
   assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),owner.id);
   await page.reload();
  }
  assert.equal(await page.evaluate(()=>navigator.onLine),true,'Chromium must leave offline mode before account sync');
  assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),owner.id,'the live browser must retain the exact owner session');
  let result:any;
  for(let attempt=0;attempt<80;attempt++){const response=await ownerRequest.get(url('/api/v1/things?id='+id));if(response.status()===200){result=await response.json();if(result?.thing?.id===id)break;}else assert.equal(response.status(),404);await page.waitForTimeout(500);}
  assert.equal(result?.thing?.id,id,JSON.stringify({keys:Object.keys(result||{}),code:result?.code,error:result?.error}));assert.equal(result.thing.crystal.text,text);assert.ok(result.thing.crystal.richText?.blocks?.length);assert.deepEqual(result.thing.acl,['tt:user']);
  assert.equal(result.post.attachments.length,2);assert.deepEqual(result.post.attachments.map((file:any)=>file.name),['offline-portrait.png','second-portrait.png']);const attachment=result.post.attachments[0];
  let comment:any;
  for(let attempt=0;attempt<80;attempt++){
   const response=await ownerRequest.get(url('/api/v1/things?target='+id+'&thingtime=comment&commentProjection=true&limit=20'));assert.equal(response.status(),200);
   const matches=(await response.json()).comments.filter((row:any)=>row.text===commentText);assert.ok(matches.length<=1);
   if(matches.length){commentId=matches[0].id;comment=await(await ownerRequest.get(url('/api/v1/things?id='+commentId))).json();break;}
   await page.waitForTimeout(500);
  }
  assert.ok(commentId,'the offline media comment must sync after its parent');assert.equal(comment.thing.targetId,id);assert.deepEqual(comment.thing.acl,['tt:inherit']);assert.equal(comment.post.attachments.length,1);
  const replyContent=await ownerRequest.get(url('/api/v1/attachments/content?id='+comment.post.attachments[0].id+'&download=1'));assert.equal(replyContent.status(),200);assert.deepEqual(await replyContent.body(),png);
  assert.equal((await guest.request.get(url('/api/v1/things?id='+commentId))).status(),404);
  assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+comment.post.attachments[0].id))).status(),404);
  assert.equal(uploads.length,3);
  const content=await ownerRequest.get(url('/api/v1/attachments/content?id='+attachment.id+'&download=1'));assert.equal(content.status(),200);assert.deepEqual(await content.body(),png);
  assert.equal((await guest.request.get(url('/api/v1/things?id='+id))).status(),404);assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+attachment.id))).status(),404);
  await page.getByTestId('account-sync-status').waitFor({state:'detached'});
  const originalIds=result.post.attachments.map((file:any)=>file.id), reversed=[...originalIds].reverse();
  const stale=await ownerRequest.patch(url('/api/v1/things'),{data:{id,expectedUpdatedAt:'2000-01-01T00:00:00.000Z',crystal:{text:'Stale'},attachmentIds:reversed}});assert.equal(stale.status(),409);
  let read=await(await ownerRequest.get(url('/api/v1/things?id='+id))).json();assert.deepEqual(read.post.attachments.map((file:any)=>file.id),originalIds);assert.equal(read.thing.crystal.text,text);
  const invalid=await ownerRequest.patch(url('/api/v1/things'),{data:{id,expectedUpdatedAt:read.thing.updatedAt,crystal:{type:'invalid'},attachmentIds:reversed}});assert.equal(invalid.status(),400);
  read=await(await ownerRequest.get(url('/api/v1/things?id='+id))).json();assert.deepEqual(read.post.attachments.map((file:any)=>file.id),originalIds);
  const ordered=await ownerRequest.patch(url('/api/v1/things'),{data:{id,expectedUpdatedAt:read.thing.updatedAt,crystal:{text},attachmentIds:reversed}});assert.equal(ordered.status(),200,await ordered.text());
  read=await(await ownerRequest.get(url('/api/v1/things?id='+id))).json();assert.deepEqual(read.post.attachments.map((file:any)=>file.id),reversed);
  await page.reload();await page.getByText(text,{exact:true}).waitFor();await page.getByRole('button',{name:'View offline-portrait.png',exact:true}).scrollIntoViewIfNeeded();await image.waitFor();await image.evaluate((img:HTMLImageElement)=>img.decode());assert.deepEqual(errors,[]);
  await page.getByRole('region',{name:'Account file sync',exact:true}).waitFor({state:'detached'});
  const removedIds=[result.post.attachments.find((file:any)=>file.name==='second-portrait.png').id,comment.post.attachments[0].id];
  await connectivity(true);
  for(const [target,name,body] of [[id,'second-portrait.png',text],[commentId,'reply-portrait.png',commentText]]){
   await page.goto(url('/post/'+target));await page.getByText(body,{exact:true}).waitFor();
   await page.getByRole('button',{name:'Post options',exact:true}).first().click();
   await page.getByText('Edit',{exact:true}).click();
   await page.getByRole('button',{name:'Delete '+name,exact:true}).click();
   await page.getByRole('region',{name:'Account file sync',exact:true}).waitFor();
   await page.reload();await page.getByText(body,{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'View '+name,exact:true}).count(),0);
   await page.getByText(body,{exact:true}).scrollIntoViewIfNeeded();
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
   if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,target===id?'removed-post-320.png':'removed-comment-320.png')});
  }
  assert.deepEqual(writes,[]);
  const deletions:any[]=[];let lost=false;
  await page.route('**/api/v1/attachments/delete',async(route:any)=>{
   if(route.request().method()!=='POST')return route.continue();
   const body=route.request().postDataJSON();deletions.push(body);const response=await route.fetch();
   if(!lost&&response.status()===200){lost=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Simulated lost receipt'})});}
   return route.fulfill({response});
  });
  await connectivity(false);await page.reload();
  await page.getByText(commentText,{exact:true}).waitFor();
  for(let attempt=0;attempt<100&&deletions.length<3;attempt++)await page.waitForTimeout(500);
  await page.getByRole('region',{name:'Account file sync',exact:true}).waitFor({state:'detached',timeout:60000});
  assert.equal(lost,true);assert.ok(deletions.length>=3);
  const first=deletions[0],retries=deletions.filter(row=>row.id===first.id);assert.ok(retries.length>=2);for(const retry of retries)assert.deepEqual(retry,first);
  for(const fileId of removedIds)assert.equal((await ownerRequest.get(url('/api/v1/attachments/content?id='+fileId))).status(),404);
  const retainedPost=await(await ownerRequest.get(url('/api/v1/things?id='+id))).json();assert.equal(retainedPost.post.attachments.length,1);assert.equal(retainedPost.thing.crystal.text,text);
  const retainedComment=await(await ownerRequest.get(url('/api/v1/things?id='+commentId))).json();assert.equal(retainedComment.post.attachments.length,0);assert.equal(retainedComment.thing.crystal.text,commentText);
  const replay=await ownerRequest.post(url('/api/v1/attachments/uploads'),{data:{requestId:first.requestId,filename:'late.png',contentType:'image/png',sizeBytes:png.length,purpose:first.targetId===id?'post':'comment'}});
  assert.equal(replay.status(),409);assert.equal((await replay.json()).code,'upload_cancelled');
  await page.unroute('**/api/v1/attachments/delete');assert.deepEqual(errors,[]);
  await connectivity(true);await page.goto(url('/post/'+id));await page.getByText(text,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Post options',exact:true}).first().click();
  await page.getByRole('menuitem',{name:/^(?:🗑️\s*)?Delete$/}).click();
  await page.getByText(text,{exact:true}).waitFor({state:'hidden'});
  await page.reload();assert.equal(await page.getByText(text,{exact:true}).count(),0);
  assert.deepEqual(writes,[],'offline parent deletion must make no mutation request');
  await connectivity(false);await page.reload();
  let parentGone=false,reviewedConflict=false;
  for(let attempt=0;attempt<40;attempt++){const response=await ownerRequest.get(url('/api/v1/things?id='+id));if(response.status()===404){parentGone=true;break;}assert.equal(response.status(),200);if(await page.getByText('1 sync conflict. Your local edits are preserved.',{exact:true}).isVisible())break;await page.waitForTimeout(500);}
  if(!parentGone){
   await page.getByText('Review sync',{exact:true}).click();
   await page.getByRole('button',{name:'Compare versions',exact:true}).click();
   await page.getByText('Review this deletion',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Delete reviewed account version',exact:true}).click();
   reviewedConflict=true;
   for(let attempt=0;attempt<100;attempt++){const response=await ownerRequest.get(url('/api/v1/things?id='+id));if(response.status()===404){parentGone=true;break;}assert.equal(response.status(),200);await page.waitForTimeout(500);}
  }
  assert.equal(parentGone,true,'the account parent deletion must reconcile');
  assert.equal((await ownerRequest.get(url('/api/v1/things?id='+commentId))).status(),404);
  assert.equal((await ownerRequest.get(url('/api/v1/attachments/content?id='+attachment.id))).status(),404);
  assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+attachment.id))).status(),404);
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({offlineBoundRemoval:true,durableDeletionReplay:true,offlineParentAndDescendantDeletion:true,reviewedConflict,offlineCommentMedia:true,commentId,atomicAttachmentEdit:true,offlineNativeMedia:true,exactBytes:true,anonymousReadDenied:true,uploads:uploads.length,coldReload:true,privateSync:true,canonicalRichText:true,stableId:id,viewports:[1440,390,320],offlineWrites:writes,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});const localRows=await page.evaluate(async()=>{const request=indexedDB.open('thingtime.local-workspaces.v1');const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise<any[]>((resolve,reject)=>{const read=db.transaction('records').objectStore('records').getAll();read.onsuccess=()=>resolve(read.result.map((row:any)=>({collection:row.collection,id:row.id,state:row.value?.state,operation:row.value?.operation,targetId:row.value?.targetId,error:row.value?.error,phase:row.value?.phase})));read.onerror=()=>reject(read.error);});}finally{db.close();}}).catch(()=>[]);await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,writes,uploads,localRows},null,2));}throw error;}
 finally{await connectivity(false).catch(()=>{});if(id)await page.evaluate(async id=>{await fetch('/api/v1/things',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});},id).catch(()=>{});await browser.close();}
});

test('removing an unsubmitted account image leaves no upload or binding', {skip:!base||!playwrightPath,timeout:90_000},async()=>{
 assert.ok(['127.0.0.1','localhost'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const url=(path:string)=>new URL(path,base).href,uploads:string[]=[],errors:string[]=[],writes:string[]=[];
 let id='',offline=false;page.setDefaultTimeout(15_000);
 page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{const path=new URL(request.url()).pathname;if(path==='/api/v1/attachments/uploads'&&request.method()==='POST')uploads.push(path);if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(path);});
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 const connectivity=async(value:boolean)=>{offline=value;await context.setOffline(value);await cdp.send('Network.overrideNetworkState',{offline:value,latency:1,downloadThroughput:100_000_000,uploadThroughput:100_000_000,connectionType:'ethernet'});};
 try{
  const username='discardqa-'+randomUUID().slice(0,8),text='Post without the discarded selection.';
  await page.goto(url('/.well-known/thingtime-capabilities.json'));
  const registration=await page.evaluate(async input=>{const response=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{username,email:username+'@example.test',password:randomUUID()+randomUUID()});
  assert.equal(registration.status,200,JSON.stringify(registration.body));const ownerId=registration.body.user.id;
  assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/v1/auth/me');return (await response.json()).user?.id;}),ownerId);
  await page.goto(url('/feed'));
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=30;canvas.height=30;canvas.getContext('2d')!.fillRect(0,0,30,30);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  await connectivity(true);await page.reload();
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  await page.getByRole('button',{name:'🖼️ Photos',exact:true}).click();
  await page.getByLabel('Who can see this post',{exact:true}).selectOption('private');
  await page.locator('.ce-paragraph[contenteditable="true"]').first().fill(text);
  await page.locator('input[type=file]').first().setInputFiles({name:'discard-before-submit.png',mimeType:'image/png',buffer:png});
  await page.getByText('discard-before-submit.png',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Delete discard-before-submit.png',exact:true}).click();
  await page.getByText('discard-before-submit.png',{exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Post ✨',exact:true}).click();
  const card=page.locator('[data-thing-id]').filter({hasText:text}).first();await card.waitFor();id=await card.getAttribute('data-thing-id');assert.ok(id);
  await page.goto(url('/post/'+id));await page.reload();await page.getByText(text,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'View discard-before-submit.png',exact:true}).count(),0);
  assert.deepEqual(writes,[]);assert.deepEqual(uploads,[]);
  await connectivity(false);await page.reload();const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});if(await reconnect.isVisible()&&await reconnect.isEnabled())await reconnect.click();
  let read:any;
  for(let attempt=0;attempt<60;attempt++){const result=await page.evaluate(async id=>{const response=await fetch('/api/v1/things?id='+encodeURIComponent(id));return {status:response.status,body:await response.json()};},id);if(result.status===200&&result.body.thing?.id===id){read=result.body;break;}await page.waitForTimeout(500);}
  assert.equal(read?.thing?.id,id,'the text-only post must sync');assert.equal(read.thing.crystal.text,text);assert.deepEqual(read.post.attachments,[]);
  assert.deepEqual(uploads,[],'a discarded selection must never start an upload');assert.deepEqual(errors,[]);
  if(artifacts){await mkdir(resolve(artifacts),{recursive:true});await writeFile(resolve(artifacts,'discard-before-submit.json'),JSON.stringify({ownerId,id,textOnly:true,noUpload:true,noOfflineWrites:true,errors},null,2));}
 }finally{await connectivity(false).catch(()=>{});if(id)await page.evaluate(async id=>{await fetch('/api/v1/things',{method:'DELETE',headers:{'Content-Type':'application/json','Origin':location.origin},body:JSON.stringify({id})});},id).catch(()=>{});await browser.close();}
});
