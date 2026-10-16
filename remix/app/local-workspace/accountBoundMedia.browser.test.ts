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
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin},errors:string[]=[],writes:string[]=[];
 const uploads:string[]=[];
 let id='',commentId='',offline=false;page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{if(new URL(request.url()).pathname==='/api/v1/attachments/uploads'&&request.method()==='POST')uploads.push(request.url());if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='authorqa-'+randomUUID().slice(0,8),text='An editable private post created while offline.';
  const registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});assert.equal(registration.status(),200,await registration.text());const owner=(await registration.json()).user;
  await page.goto(url('/feed'));
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=280;const x=c.getContext('2d')!;x.fillStyle='#f3d5b7';x.fillRect(0,0,200,280);x.fillStyle='#95482f';x.font='20px serif';x.fillText('Offline portrait',30,140);return c.toDataURL('image/png').split(',')[1];}),'base64');
  offline=true;await context.setOffline(true);await page.reload();
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
  await page.getByRole('button',{name:'Comment 💬',exact:true}).waitFor({state:'detached'});
  await page.getByText(commentText,{exact:true}).waitFor();
  await page.reload();await page.getByText(commentText,{exact:true}).waitFor();
  const replyImage=page.getByRole('button',{name:'View reply-portrait.png',exact:true}).locator('img');
  await replyImage.scrollIntoViewIfNeeded();await replyImage.evaluate((img:HTMLImageElement)=>img.decode());assert.equal(await replyImage.evaluate((img:HTMLImageElement)=>img.naturalWidth),200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,'comment-320.png')});
  assert.deepEqual(writes,[]);assert.deepEqual(uploads,[]);
  const credentials=JSON.parse(await readFile(adminFile!,'utf8'));assert.equal((await admin.request.post(url('/api/v1/login'),{headers,data:{username:credentials.username,password:credentials.password}})).status(),200);
  const approval=await admin.request.post(url('/api/v1/admin/users/public-uploads'),{headers,data:{userId:owner.id,enabled:true,scope:'public'}});assert.equal(approval.status(),200,await approval.text());
  offline=false;await context.setOffline(false);await page.reload();let result:any;
  for(let attempt=0;attempt<80;attempt++){const response=await context.request.get(url('/api/v1/things?id='+id));if(response.status()===200){result=await response.json();break;}assert.equal(response.status(),404);await page.waitForTimeout(500);}
  assert.equal(result?.thing?.id,id);assert.equal(result.thing.crystal.text,text);assert.ok(result.thing.crystal.richText?.blocks?.length);assert.deepEqual(result.thing.acl,['tt:user']);
  assert.equal(result.post.attachments.length,2);const attachment=result.post.attachments[0];
  let comment:any;
  for(let attempt=0;attempt<80;attempt++){
   const response=await context.request.get(url('/api/v1/things?target='+id+'&thingtime=comment&commentProjection=true&limit=20'));assert.equal(response.status(),200);
   const matches=(await response.json()).comments.filter((row:any)=>row.text===commentText);assert.ok(matches.length<=1);
   if(matches.length){commentId=matches[0].id;comment=await(await context.request.get(url('/api/v1/things?id='+commentId))).json();break;}
   await page.waitForTimeout(500);
  }
  assert.ok(commentId,'the offline media comment must sync after its parent');assert.equal(comment.thing.targetId,id);assert.deepEqual(comment.thing.acl,['tt:inherit']);assert.equal(comment.post.attachments.length,1);
  const replyContent=await context.request.get(url('/api/v1/attachments/content?id='+comment.post.attachments[0].id+'&download=1'));assert.equal(replyContent.status(),200);assert.deepEqual(await replyContent.body(),png);
  assert.equal((await guest.request.get(url('/api/v1/things?id='+commentId))).status(),404);
  assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+comment.post.attachments[0].id))).status(),404);
  assert.equal(uploads.length,3);
  const content=await context.request.get(url('/api/v1/attachments/content?id='+attachment.id+'&download=1'));assert.equal(content.status(),200);assert.deepEqual(await content.body(),png);
  assert.equal((await guest.request.get(url('/api/v1/things?id='+id))).status(),404);assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+attachment.id))).status(),404);
  await page.getByTestId('account-sync-status').waitFor({state:'detached'});
  const originalIds=result.post.attachments.map((file:any)=>file.id), reversed=[...originalIds].reverse();
  const stale=await context.request.patch(url('/api/v1/things'),{headers,data:{id,expectedUpdatedAt:'2000-01-01T00:00:00.000Z',crystal:{text:'Stale'},attachmentIds:reversed}});assert.equal(stale.status(),409);
  let read=await(await context.request.get(url('/api/v1/things?id='+id))).json();assert.deepEqual(read.post.attachments.map((file:any)=>file.id),originalIds);assert.equal(read.thing.crystal.text,text);
  const invalid=await context.request.patch(url('/api/v1/things'),{headers,data:{id,expectedUpdatedAt:read.thing.updatedAt,crystal:{type:'invalid'},attachmentIds:reversed}});assert.equal(invalid.status(),400);
  read=await(await context.request.get(url('/api/v1/things?id='+id))).json();assert.deepEqual(read.post.attachments.map((file:any)=>file.id),originalIds);
  const ordered=await context.request.patch(url('/api/v1/things'),{headers,data:{id,expectedUpdatedAt:read.thing.updatedAt,crystal:{text},attachmentIds:reversed}});assert.equal(ordered.status(),200,await ordered.text());
  read=await(await context.request.get(url('/api/v1/things?id='+id))).json();assert.deepEqual(read.post.attachments.map((file:any)=>file.id),reversed);
  await page.reload();await page.getByText(text,{exact:true}).waitFor();await page.getByRole('button',{name:'View offline-portrait.png',exact:true}).scrollIntoViewIfNeeded();await image.waitFor();await image.evaluate((img:HTMLImageElement)=>img.decode());assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({offlineCommentMedia:true,commentId,atomicAttachmentEdit:true,offlineNativeMedia:true,exactBytes:true,anonymousReadDenied:true,uploads:uploads.length,coldReload:true,privateSync:true,canonicalRichText:true,stableId:id,viewports:[1440,390,320],offlineWrites:writes,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,writes,uploads},null,2));}throw error;}
 finally{await context.setOffline(false).catch(()=>{});if(id)await context.request.delete(url('/api/v1/things'),{headers,data:{id}}).catch(()=>{});await browser.close();}
});
