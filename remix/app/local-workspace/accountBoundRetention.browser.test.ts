import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.TT_LOCAL_BOUND_MEDIA_URL,adminFile=process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_LOCAL_BOUND_MEDIA_ARTIFACTS;
test('a fresh device retains existing private post/comment originals and edits/removes them offline', {skip:!base||!adminFile||!playwrightPath,timeout:180000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const seed=await browser.newContext(),admin=await browser.newContext(),guest=await browser.newContext(),device=await browser.newContext({viewport:{width:1440,height:1000}}),page=await device.newPage();
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin},errors:string[]=[],writes:string[]=[],uploadRequests:string[]=[],deletions:any[]=[],responses:any[]=[],readbacks:any[]=[],uploaded:string[]=[];
 let root='',offline=false;page.setDefaultTimeout(20000);
 page.on('pageerror',(error:Error)=>errors.push(error.message));page.on('request',(r:any)=>{const path=new URL(r.url()).pathname;if(offline&&!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(path);if(path==='/api/v1/attachments/uploads'&&r.method()==='POST')uploadRequests.push(path);if(path==='/api/v1/attachments/delete'&&r.method()==='POST')deletions.push(r.postDataJSON());});
 page.on('response',async(r:any)=>{const path=new URL(r.url()).pathname;if(path==='/api/v1/things'&&!['GET','HEAD','OPTIONS'].includes(r.request().method())){const body=await r.json().catch(()=>({}));responses.push({status:r.status(),method:r.request().method(),id:r.request().postDataJSON()?.id,error:body.error,code:body.code});}});
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='retain-post-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID();
  const registered=await seed.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password}});assert.equal(registered.status(),200,await registered.text());const user=(await registered.json()).user;
  const credentials=JSON.parse(await readFile(adminFile!,'utf8'));assert.equal((await admin.request.post(url('/api/v1/login'),{headers,data:{username:credentials.username,password:credentials.password}})).status(),200);
  assert.equal((await admin.request.post(url('/api/v1/admin/users/public-uploads'),{headers,data:{userId:user.id,enabled:true,scope:'public'}})).status(),200);
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=280;const x=c.getContext('2d')!;x.fillStyle='#f5d7ba';x.fillRect(0,0,200,280);x.fillStyle='#974c39';x.font='20px serif';x.fillText('Existing original',25,140);return c.toDataURL('image/png').split(',')[1];}),'base64');
  const upload=async(purpose:string,name:string)=>{
   const start=await seed.request.post(url('/api/v1/attachments/uploads'),{headers,data:{requestId:randomUUID(),filename:name,contentType:'image/png',sizeBytes:png.length,purpose}});assert.equal(start.status(),200,await start.text());const id=(await start.json()).upload.id;uploaded.push(id);
   const parts=await seed.request.post(url('/api/v1/attachments/uploads/parts'),{headers,data:{uploadId:id,parts:[{partNumber:1,checksumSha256:createHash('sha256').update(png).digest('base64')}]}});assert.equal(parts.status(),200,await parts.text());const part=(await parts.json()).parts[0];assert.ok(['localhost','127.0.0.1'].includes(new URL(part.url,base).hostname));
   assert.equal((await guest.request.put(new URL(part.url,base).href,{headers:part.headers,data:png})).status(),200);const complete=await seed.request.post(url('/api/v1/attachments/uploads/complete'),{headers,data:{uploadId:id}});assert.equal(complete.status(),200,await complete.text());return id;
  };
  const first=await upload('post','retained-post.png'),second=await upload('post','retained-second.png');
  const created=await seed.request.post(url('/api/v1/things'),{headers,data:{type:'text',text:'Existing private post.',acl:['tt:user'],attachmentIds:[first,second]}});assert.equal(created.status(),200,await created.text());root=(await created.json()).post.id;assert.ok(root);
  const replyFile=await upload('comment','retained-reply.png');const reply=await seed.request.post(url('/api/v1/things/comment'),{headers,data:{id:root,shareId:randomUUID(),text:'Existing private reply.',attachmentIds:[replyFile]}});assert.equal(reply.status(),200,await reply.text());const replyId=(await reply.json()).comment.id;assert.ok(replyId);
  const descriptor=await seed.request.get(url('/api/v1/attachments/content?id='+first+'&cache=retain&download=1'),{headers});assert.equal(descriptor.status(),200,await descriptor.text());assert.equal((await descriptor.json()).file.targetId,root);assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+first+'&cache=retain&download=1'),{headers})).status(),401);
  assert.equal((await device.request.post(url('/api/v1/login'),{headers,data:{username,password}})).status(),200);
  for(const [id,text,name] of [[root,'Existing private post.','retained-post.png'],[replyId,'Existing private reply.','retained-reply.png']]){
   await page.goto(url('/post/'+id));await page.getByText(text,{exact:true}).waitFor();
   const image=page.getByRole('button',{name:'View '+name,exact:true}).locator('img');await image.waitFor();
   await page.waitForFunction(name=>{const button=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='View '+name);return button?.querySelector('img')?.src.startsWith('blob:');},name);
   await image.evaluate((img:HTMLImageElement)=>img.decode());assert.equal(await image.evaluate((img:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d')!.drawImage(img,0,0);return c.toDataURL('image/png').split(',')[1];}),png.toString('base64'));
  }
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await device.setOffline(true);
  for(const [id,text,name] of [[root,'Existing private post.','retained-second.png'],[replyId,'Existing private reply.','retained-reply.png']]){
   await page.goto(url('/post/'+id));await page.reload();await page.getByText(text,{exact:true}).waitFor();
   await page.getByRole('button',{name:'View '+name,exact:true}).locator('img').evaluate((img:HTMLImageElement)=>img.decode());
   await page.getByRole('button',{name:'Post options',exact:true}).first().click();await page.getByText('Edit',{exact:true}).click();
   await page.getByRole('button',{name:'Delete '+name,exact:true}).click();await page.getByRole('region',{name:'Account file sync',exact:true}).waitFor();
   const edited=text+' Edited offline.';await page.locator('.ce-paragraph[contenteditable="true"]').first().fill(edited);await page.getByRole('button',{name:'Save ✨',exact:true}).click();await page.getByRole('button',{name:'Save ✨',exact:true}).waitFor({state:'detached'});
   await page.reload();await page.getByText(edited,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'View '+name,exact:true}).count(),0);
   for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await page.getByText(edited,{exact:true}).scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`${id===root?'post':'reply'}-${width}.png`)});}
  }
  assert.deepEqual(writes,[]);assert.deepEqual(uploadRequests,[]);
  offline=false;await device.setOffline(false);await page.reload();
  let settled=false;
  for(let attempt=0;attempt<100;attempt++){
   const post=await(await seed.request.get(url('/api/v1/things?id='+root))).json(),comment=await(await seed.request.get(url('/api/v1/things?id='+replyId))).json();
   readbacks.splice(0,readbacks.length,...[post,comment].map(result=>({id:result.thing?.id,text:result.thing?.crystal?.text,thingtime:result.thing?.thingtime,attachments:result.post?.attachments?.map((file:any)=>file.id),error:result.error})));
   if(post.thing?.crystal.text==='Existing private post. Edited offline.'&&comment.thing?.crystal.text==='Existing private reply. Edited offline.'&&post.post.attachments.length===1&&comment.post.attachments.length===0){settled=true;break;}await page.waitForTimeout(500);
  }
  assert.equal(settled,true);assert.ok(deletions.length>=2);assert.ok(deletions.every(input=>input.retainReceipt===true&&!('requestId'in input)&&[root,replyId].includes(input.targetId)));assert.deepEqual(uploadRequests,[]);
  for(const id of [second,replyFile])assert.equal((await seed.request.get(url('/api/v1/attachments/content?id='+id))).status(),404);
  assert.deepEqual(await(await seed.request.get(url('/api/v1/attachments/content?id='+first+'&download=1'))).body(),png);assert.equal((await guest.request.get(url('/api/v1/things?id='+root))).status(),404);assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({freshDevice:true,existingPrivatePostAndComment:true,exactRetainedBytes:true,offlineEditAndRemoval:true,existingIdDeletionReceipts:true,noUploads:true,privateReadDenied:true,viewports:[1440,390,320],writes,errors},null,2));
 }catch(error){await page.getByText('Review sync',{exact:true}).click({timeout:2000}).catch(()=>{});if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,writes,uploadRequests,deletions,responses,readbacks},null,2));}throw error;}
 finally{await device.setOffline(false).catch(()=>{});if(root)await seed.request.delete(url('/api/v1/things'),{headers,data:{id:root}}).catch(()=>{});for(const id of uploaded)await seed.request.post(url('/api/v1/attachments/delete'),{headers,data:{id}}).catch(()=>{});await browser.close();}
});
