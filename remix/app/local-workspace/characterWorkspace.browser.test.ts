import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.env.TT_RENDER_ORIGIN, playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts=process.env.TT_CHARACTER_WORKSPACE_ARTIFACTS,adminFile=process.env.TT_CHARACTER_ADMIN_FIXTURE;
test('native Character posts, files and History finish offline, cold reload and sync independently of drafts',{skip:!base||!playwrightPath||!adminFile,timeout:240_000},async()=>{
 assert.equal(new URL(base!).hostname,'127.0.0.1');
 const health=await(await fetch(base+'/api/v1/health/nitro')).json();assert.equal(health.testEnvironment.mode,'isolated-agent-test');assert.equal(health.testEnvironment.sessionId,process.env.TT_RENDER_SESSION);
 const {chromium}=await import(playwrightPath!);
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.TT_SHARED_CHROME_PATH});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),audit=await browser.newContext(),guest=await browser.newContext(),admin=await browser.newContext();
 const page=await context.newPage(),readback=await audit.newPage();page.setDefaultTimeout(60_000);
 const network=await context.newCDPSession(page);await network.send('Network.enable');
 const connectivity=async(offline:boolean)=>{await context.setOffline(offline);await network.send('Network.overrideNetworkState',{offline,latency:1,downloadThroughput:100_000_000,uploadThroughput:100_000_000,connectionType:'ethernet'});};
 await connectivity(false);
 const errors:string[]=[],offlineWrites:string[]=[],views:any[]=[],uploads:any[]=[],failedResponses:any[]=[];let offline=false,postId='',actor='',failedDraftWrites=0;
 page.on('response',async response=>{if(response.status()>=400)failedResponses.push({path:new URL(response.url()).pathname,status:response.status()});if(new URL(response.url()).pathname.startsWith('/api/v1/attachments/uploads')){const body=await response.json().catch(()=>null);uploads.push({path:new URL(response.url()).pathname,status:response.status(),code:body?.code,error:response.status()>=400?body?.error:undefined});}});
 page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('request',(r:any)=>{if(offline&&!['GET','HEAD','OPTIONS'].includes(r.method()))offlineWrites.push(new URL(r.url()).pathname);});
 const poll=async(read:()=>Promise<any>,accept:(value:any)=>boolean)=>{for(let n=0;n<100;n++){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,200));}throw Error('Expected native state did not settle');};
 const imageName='character-colors.png';let imageBase64='';
 const text='A Character post saved fully offline.',filename='character-note.txt',fileText='Original Character attachment bytes.';
 try {
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='char-local-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID();
  const registered=await context.request.post(base+'/api/v1/auth/register',{headers:{Origin:base!},data:{username,email:username+'@example.test',password}});assert.equal(registered.status(),200);const owner=(await registered.json()).user;
  await page.goto(base+'/feed');assert.equal(await page.evaluate(async()=> (await(await fetch('/api/v1/auth/me')).json()).user?.id),owner.id);
  const create=await page.evaluate(async body=>{const r=await fetch('/api/v1/auth/characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{operation:'create',requestId:randomUUID(),displayName:'Offline author',loginMode:'switch'});assert.equal(create.status,200);actor=create.data.character.user.id;
  const administrator=JSON.parse(await readFile(adminFile!,'utf8'));
  const adminPage=await admin.newPage();await adminPage.goto(base+'/.well-known/thingtime-capabilities.json');
  assert.equal(await adminPage.evaluate(async credentials=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).status,administrator),200);
  assert.equal(await adminPage.evaluate(async userId=>(await fetch('/api/v1/admin/users/public-uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,enabled:true,scope:'all'})})).status,actor),200,'the isolated fixture grants uploads through the normal admin API');
  await readback.goto(base+'/.well-known/thingtime-capabilities.json');assert.equal(await readback.evaluate(async credentials=>(await fetch('/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).status,{username,password}),200);
  const remote=()=>readback.evaluate(async({id,actor})=>{const r=await fetch('/api/v1/things?id='+id,{headers:{'X-Thingtime-Character':actor}});return {status:r.status,data:await r.json()};},{id:postId,actor});
  imageBase64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#f8ddb1';ctx.fillRect(0,0,240,160);ctx.fillStyle='#ad5e47';ctx.fillRect(80,40,80,80);return canvas.toDataURL('image/png').split(',')[1];});
  await page.reload();await page.getByLabel('Post as',{exact:true}).first().selectOption(actor);
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  await connectivity(true);assert.equal(await page.evaluate(()=>navigator.onLine),false);offline=true;
  await page.reload();await page.getByLabel('Post as',{exact:true}).first().selectOption(actor);
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  const editor=page.locator('.ce-paragraph[contenteditable="true"]').first();await editor.pressSequentially(text);
  await page.getByTitle('Add photos, videos and files to this post',{exact:true}).click();
  await page.getByRole('group',{name:'Post attachments',exact:true}).locator('input[type=file]').setInputFiles([{name:filename,mimeType:'text/plain',buffer:Buffer.from(fileText)},{name:imageName,mimeType:'image/png',buffer:Buffer.from(imageBase64,'base64')}]);
  await page.getByText(filename,{exact:true}).waitFor();await page.getByText('Draft saved on this device ✓',{exact:true}).first().waitFor();
  await page.getByLabel('Who can see this post',{exact:true}).selectOption('private');
  await page.getByRole('button',{name:'Post ✨',exact:true}).click();
  await page.waitForURL((url:URL)=>url.pathname.startsWith('/post/')&&url.searchParams.get('character')===actor);postId=new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByText(text,{exact:true}).waitFor();await page.reload();await page.getByText(text,{exact:true}).waitFor();await page.getByText(filename,{exact:true}).first().waitFor();
  assert.equal((await remote()).status,404,'offline post must not exist in the account');
  const decodedImage=async()=>page.waitForFunction(()=>[...document.images].some(image=>image.src.startsWith('blob:')&&image.complete&&image.naturalWidth===240&&image.naturalHeight===160));
  await decodedImage();
  const postUrl=page.url(),oldImageUrl=await page.evaluate(()=>[...document.images].find(image=>image.naturalWidth===240)!.src);
  await page.goto(base+'/things');await page.getByLabel('Workspace',{exact:true}).waitFor();
  assert.equal(await page.locator(`a[href^="/post/${postId}"]`).count(),0,'the principal library cannot borrow actor content');
  assert.equal(await page.evaluate(async url=>{try{await fetch(url);return true;}catch{return false;}},oldImageUrl),false,'leaving the actor releases its object URL');
  await page.getByLabel('Workspace',{exact:true}).selectOption(actor);
  await page.waitForURL((url:URL)=>url.pathname==='/things'&&url.searchParams.get('character')===actor);
  const entry=page.locator(`a[href^="/post/${postId}"]`).first();await entry.waitFor();
  assert.equal(new URL(await entry.getAttribute('href'),base).searchParams.get('character'),actor);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});
   await page.evaluate(async()=>{await document.fonts.ready;for(let y=0;y<=document.documentElement.scrollHeight;y+=innerHeight/2){scrollTo(0,y);await new Promise(requestAnimationFrame);}scrollTo(0,0);});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`character-library-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await entry.click();await page.waitForURL((url:URL)=>url.pathname==='/post/'+postId&&url.searchParams.get('character')===actor);await decodedImage();
  // The normal quick-comment selector must use the same local actor queue.
  const commentText='A local Character reply remains in this conversation.';
  await page.getByPlaceholder('Write a comment… 💬',{exact:true}).fill(commentText);
  await page.getByRole('button',{name:'Send comment',exact:true}).click();await page.locator('p').filter({hasText:commentText}).waitFor();
  await poll(()=>page.getByPlaceholder('Write a comment… 💬',{exact:true}).inputValue(),value=>value==='');
  await page.reload();await page.locator('p').filter({hasText:commentText}).waitFor();await decodedImage();
  const replyLink=page.locator(`a[href^="/post/"]`);
  const replyHref=await replyLink.evaluateAll((links,postId)=>links.map(link=>link.getAttribute('href')).find(href=>href&&!href.startsWith('/post/'+postId)),postId);
  assert.ok(replyHref,'the reply timestamp exposes a real permalink');assert.equal(new URL(replyHref,base).searchParams.get('character'),actor);
  await page.goto(new URL(replyHref,base).href);await page.locator('p').filter({hasText:commentText}).waitFor();
  const parentLink=page.getByRole('link',{name:'View full conversation 🧵',exact:true});assert.equal(new URL(await parentLink.getAttribute('href'),base).searchParams.get('character'),actor);
  await parentLink.click();await page.getByText(text,{exact:true}).waitFor();await decodedImage();
  assert.equal(new URL(page.url()).pathname,new URL(postUrl).pathname);

  const retained=await page.evaluate(async({actor,id})=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('thingtime.local-workspaces.v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   try{return await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve(r.result.filter(row=>row.collection==='things'&&JSON.parse(row.scope)[0]==='delegated-account'&&JSON.parse(row.scope)[3]===actor).map(row=>({id:row.id,value:row.value})));r.onerror=()=>reject(r.error);});}finally{db.close();}
  },{actor,id:postId});
  assert.ok(retained.some(row=>row.id===postId),'independent device records retain the actor post');
  const history=page.getByRole('dialog',{name:'History',exact:true});
  await page.getByRole('button',{name:'Post options',exact:true}).click();await page.getByRole('menuitem',{name:/History/}).click();await history.waitFor();
  await history.getByRole('button',{name:/Created Thing/}).first().click();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`character-history-${width}.png`),animations:'disabled'});
   views.push({width,height:width===1440?1000:844});
  }
  if(await page.getByRole('dialog',{name:'Version details',exact:true}).isVisible())await page.getByRole('dialog',{name:'Version details',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
  await history.getByRole('button',{name:'Open History browser',exact:true}).click();
  await page.waitForURL((url:URL)=>url.pathname==='/history'&&url.searchParams.get('character')===actor);
  await history.waitFor({state:'hidden'});
  await page.getByRole('button',{name:/Created Thing/}).first().click();
  await page.getByRole('button',{name:'Open Thing',exact:true}).click();
  await page.waitForURL((url:URL)=>url.pathname==='/thing/'+postId&&url.searchParams.get('character')===actor);
  await page.getByRole('link',{name:'Open post page',exact:true}).click();
  await page.waitForURL((url:URL)=>url.pathname==='/post/'+postId&&url.searchParams.get('character')===actor);
  await decodedImage();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(async()=>{await document.fonts.ready;for(let y=0;y<=document.documentElement.scrollHeight;y+=innerHeight/2){scrollTo(0,y);await new Promise(requestAnimationFrame);}scrollTo(0,0);});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   const syncBounds=await page.locator('section[aria-label*="sync"]').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {label:element.getAttribute('aria-label'),x:r.x,width:r.width};}).filter(r=>r.width>0));
   assert.ok(syncBounds.length>0,'offline status panels are visible');
   for(const r of syncBounds)assert.ok(Math.abs(r.x+r.width/2-width/2)<=1,`${r.label} must be centered at ${width}px: ${JSON.stringify(r)}`);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`character-post-${width}.png`),fullPage:true,animations:'disabled'});
  }
  assert.deepEqual(offlineWrites,[]);
  // Leave a new, unsent Character draft queued while the completed post syncs.
  // Its deliberate server failure must neither delay nor undo that post.
  const permalink=page.url();await page.goto(base+'/feed');
  await page.getByLabel('Post as',{exact:true}).first().selectOption(actor);
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially('My next Character draft stays separate.');
  await page.getByText('Draft saved on this device ✓',{exact:true}).first().waitFor();
  await page.goto(permalink);await page.getByText(text,{exact:true}).waitFor();
  await page.route('**/api/v1/drafts',async route=>{if(route.request().method()==='POST'){failedDraftWrites++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Synthetic draft outage'})});}return route.continue();});
  offline=false;await connectivity(false);
  const accepted=await poll(remote,value=>value.status===200);assert.equal(accepted.data.post.author.id,actor);assert.equal(accepted.data.post.text,text);assert.deepEqual(accepted.data.post.acl,['tt:user']);
  assert.equal(accepted.data.post.attachments.length,2);
  const remoteFile=accepted.data.post.attachments.find((file:any)=>file.name===filename).id;
  const downloaded=await readback.evaluate(async({id,actor})=>{const response=await fetch('/api/v1/attachments/content?id='+id+'&download=1&cache=bytes',{headers:{'X-Thingtime-Character':actor}});return {status:response.status,text:await response.text()};},{id:remoteFile,actor});
  assert.equal(downloaded.status,200);assert.equal(downloaded.text,fileText);
  assert.equal((await guest.request.get(base+'/api/v1/things?id='+postId)).status(),404);
  const guestPage=await guest.newPage();await guestPage.goto(permalink);
  await guestPage.getByText('This Character is unavailable in this workspace.',{exact:true}).waitFor();
  assert.equal((await guestPage.locator('body').innerText()).includes(text),false);
  // The same selector still completes normal comments with no account session.
  const anonymousWrites:string[]=[];guestPage.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))anonymousWrites.push(new URL(request.url()).pathname);});
  await guestPage.goto(base+'/feed');await guestPage.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  await guestPage.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially('An anonymous native post.');
  await guestPage.getByRole('button',{name:'Save on this device',exact:true}).click();await guestPage.waitForURL((url:URL)=>url.pathname.startsWith('/post/'));
  await guestPage.getByPlaceholder('Write a comment… 💬',{exact:true}).fill('Anonymous quick reply.');
  await guestPage.getByRole('button',{name:'Send comment',exact:true}).click();
  await poll(()=>guestPage.getByPlaceholder('Write a comment… 💬',{exact:true}).inputValue(),value=>value==='');
  await guestPage.reload();await guestPage.locator('p').filter({hasText:'Anonymous quick reply.'}).waitFor();
  assert.deepEqual(anonymousWrites,[],'guest content completion never attempts account writes');
  if(artifacts)await guestPage.screenshot({path:resolve(artifacts,'anonymous-quick-reply.png'),fullPage:true,animations:'disabled'});

  assert.equal((await readback.evaluate(async id=>(await fetch('/api/v1/things?id='+id)).status,postId)),404,'principal cannot silently read as the Character');
  await page.reload();await page.getByText(text,{exact:true}).waitFor();await poll(async()=>failedDraftWrites,value=>value>0);
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({anonymousQuickReply:true,offlinePost:true,offlineFile:true,offlineImage:true,retiredImageUrl:true,characterLibrary:true,characterReplies:true,characterHistoryNavigation:true,coldReload:true,principalHistory:true,independentDraftSync:true,postId,actor,views,offlineWrites,errors,failedDraftWrites,uploads,failedResponses},null,2));
 } catch(error:any) {
  if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({message:error.message,body:await page.locator('body').innerText().catch(()=>''),offlineWrites,errors,postId,actor,uploads,failedResponses},null,2));}throw error;
 } finally {await browser.close();}
});
