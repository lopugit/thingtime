import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.env.TT_CHARACTER_DRAFTS_URL || process.env.TT_RENDER_ORIGIN;
const playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts=process.env.TT_CHARACTER_DRAFTS_ARTIFACTS;
test('native delegated drafts survive offline reload and failed sync does not block Character posting',{skip:!base||!playwrightPath,timeout:240_000},async()=>{
 assert.equal(new URL(base).hostname,'127.0.0.1');
 const health=await(await fetch(base+'/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode,'isolated-agent-test');
 if(process.env.TT_RENDER_SESSION)assert.equal(health.testEnvironment.sessionId,process.env.TT_RENDER_SESSION);
 const {chromium}=await import(playwrightPath);
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.TT_SHARED_CHROME_PATH});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),guest=await browser.newContext(),page=await context.newPage();
 // The runtime has no external network interface. Emulate connectivity to its
 // loopback app; Docker's independently verified network boundary stays intact.
 const network=await context.newCDPSession(page);
 await network.send('Network.enable');
 const connectivity=async offline=>{
  await context.setOffline(offline);
  await network.send('Network.overrideNetworkState',{offline,latency:1,downloadThroughput:100_000_000,uploadThroughput:100_000_000,connectionType:'ethernet'});
 };
 await connectivity(false);
 const headers={Origin:base},url=path=>new URL(path,base).href,errors=[],offlineRequests=[],views=[],responses=[];
 let offline=false,failedDraftWrites=0,postId='',storageUsage;
 page.setDefaultTimeout(30_000);page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error' && message.text().includes('same key'))errors.push(message.text());});
 page.on('response',response=>{const path=new URL(response.url()).pathname;if(['/api/root-data','/api/v1/auth/characters'].includes(path))responses.push({path,status:response.status(),method:response.request().method()});});
 page.on('request',request=>{if(offline && (!['GET','HEAD','OPTIONS'].includes(request.method()) || new URL(request.url()).pathname==='/api/v1/auth/characters'))offlineRequests.push(new URL(request.url()).pathname);});
 const poll=async(read,accept)=>{for(let i=0;i<100;i++){const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,200));}throw Error('Expected Character state did not settle');};
 const open=async()=>{const trigger=page.getByRole('button',{name:"What's on your mind? ✨",exact:true});if(await trigger.count())await trigger.click();await page.locator('.ce-paragraph[contenteditable="true"]').first().waitFor();};
 const choose=async actor=>{await page.getByLabel('Post as',{exact:true}).first().selectOption(actor);await open();assert.equal(await page.locator('.ce-paragraph[contenteditable="true"]').count(),1,'Changing Character must leave exactly one editor');};
 const editor=()=>page.locator('.ce-paragraph[contenteditable="true"]').first();
 const write=async text=>{await editor().press('ControlOrMeta+A');await editor().pressSequentially(text);await page.getByText('Draft saved on this device ✓',{exact:true}).first().waitFor();};
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='char-draft-'+randomUUID().slice(0,8);
  const registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(registration.status(),200,await registration.text());const owner=(await registration.json()).user;
  await page.goto(url('/feed'));
  assert.equal(await page.evaluate(async()=> (await (await fetch('/api/v1/auth/me')).json()).user?.id),owner.id,'Browser must authenticate the disposable API registration');
  const create=async displayName=>{const response=await page.evaluate(async body=>{const r=await fetch('/api/v1/auth/characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{operation:'create',requestId:randomUUID(),displayName,loginMode:'switch'});assert.equal(response.status,200,JSON.stringify(response.data));return response.data.character.user.id;};
  const a=await create('Draft actor A'),b=await create('Draft actor B');
  await page.reload();assert.equal(await page.evaluate(()=>navigator.onLine),true,'Loopback test must start with Chromium online');await page.getByLabel('Post as',{exact:true}).first().selectOption(a);
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await connectivity(true);await page.reload();await choose(a);await write('Actor A draft stays with Actor A.');
  await choose(b);await write('Actor B draft stays with Actor B.');
  await choose(owner.id);await write('Owner draft stays with the owner.');
  await page.reload();await choose(a);await poll(()=>editor().innerText(),value=>value==='Actor A draft stays with Actor A.');
  await page.getByRole('button',{name:'Load drafts & templates',exact:true}).click();
  const dialog=page.getByRole('dialog').filter({hasText:'Your drafts & templates'});
  await dialog.getByRole('button',{name:/Actor A draft stays/}).waitFor();
  assert.equal((await dialog.innerText()).includes('Actor B draft'),false);assert.equal((await dialog.innerText()).includes('Owner draft'),false);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(()=>document.fonts.ready);
   views.push(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})));
   assert.equal(views.at(-1).scrollWidth,width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`character-drafts-${width}.png`),animations:'disabled'});
  }
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await choose(b);await poll(()=>editor().innerText(),value=>value==='Actor B draft stays with Actor B.');
  await choose(owner.id);await poll(()=>editor().innerText(),value=>value==='Owner draft stays with the owner.');
  assert.deepEqual(offlineRequests,[]);
  await page.goto(url('/settings/things'));
  const storage=page.getByTestId('workspace-storage-settings'),storageCard=page.locator('details').filter({has:storage});
  await storageCard.locator(':scope > summary').click();await storage.getByRole('status').waitFor();
  await page.getByText('Local copies, drafts and pending edits for this account and its Characters in the selected database. Remote account storage and other databases are measured separately.',{exact:true}).waitFor();
  // Independent source of truth: inspect logical record bytes in this clean
  // fixture, including each Character, instead of calling the meter's adapter.
  storageUsage=await page.evaluate(async principal=>{
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('thingtime.local-workspaces.v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   try{return await new Promise((resolve,reject)=>{const request=db.transaction('records').objectStore('records').getAll();request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const rows=request.result.filter(row=>{const scope=JSON.parse(row.scope);return scope[1]===location.origin && ((scope[0]==='account'&&scope[2]===principal&&scope[3]==='home')||(scope[0]==='delegated-account'&&scope[2]===principal&&scope[4]==='home'));});
    resolve({bytes:rows.reduce((sum,row)=>sum+row.bytes,0),records:rows.length,actors:[...new Set(rows.filter(row=>JSON.parse(row.scope)[0]==='delegated-account').map(row=>JSON.parse(row.scope)[3]))].sort()});
   };});}finally{db.close();}
  },owner.id);
  assert.deepEqual(storageUsage.actors,[a,b].sort());
  await storage.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await poll(()=>storage.getByRole('status').innerText(),text=>text===`${storageUsage.bytes.toLocaleString()} bytes stored · ${storageUsage.records.toLocaleString()} records`);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});
   await page.evaluate(async()=>{await document.fonts.ready;for(let y=0;y<=document.documentElement.scrollHeight;y+=innerHeight/2){scrollTo(0,y);await new Promise(requestAnimationFrame);}});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   await storageCard.evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+window.scrollY-65));
   if(artifacts)await page.screenshot({path:resolve(artifacts,`character-storage-${width}.png`),animations:'disabled'});
  }
  await page.goto(url('/feed'));await choose(owner.id);await poll(()=>editor().innerText(),value=>value==='Owner draft stays with the owner.');
  assert.deepEqual(offlineRequests,[]);
  await page.route('**/api/v1/drafts',async route=>{if(route.request().method()==='POST'){failedDraftWrites++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Synthetic unavailable draft sync'})});}return route.continue();});
  const rosterReads=()=>responses.filter(row=>row.path==='/api/v1/auth/characters'&&row.method==='GET').length;
  const beforeReconnect=rosterReads();offline=false;await connectivity(false);
  await poll(async()=>rosterReads(),value=>value>beforeReconnect);await choose(a);
  await poll(()=>editor().innerText(),value=>value==='Actor A draft stays with Actor A.');
  await page.getByLabel('Who can see this post',{exact:true}).selectOption('private');
  const text='Actor A posts independently of draft sync.';await write(text);
  await poll(async()=>failedDraftWrites,value=>value>0);
  const posted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/things' && response.request().method()==='POST');
  await page.getByRole('button',{name:'Post ✨',exact:true}).click();
  const created=await posted;assert.equal(created.status(),200);postId=(await created.json()).post.id;assert.ok(postId);
  await page.getByText(text,{exact:true}).waitFor();
  const response=await page.evaluate(async ({id,actor})=>{const r=await fetch('/api/v1/things?id='+id,{headers:{'X-Thingtime-Character':actor}});return {status:r.status,data:await r.json()};},{id:postId,actor:a});assert.equal(response.status,200);
  const post=response.data.post;assert.equal(post.author.id,a);assert.equal(post.text,text);assert.deepEqual(post.acl,['tt:user']);
  assert.equal((await guest.request.get(url('/api/v1/things?id='+postId))).status(),404);
  const sync=page.getByRole('region',{name:'Character draft sync',exact:true});
  await sync.getByText('Review draft sync',{exact:true}).click();
  const beforeRetry=failedDraftWrites;await sync.getByRole('button',{name:'Retry draft sync',exact:true}).first().click();
  await poll(async()=>failedDraftWrites,value=>value>beforeRetry);
  await page.getByText(text,{exact:true}).waitFor();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(async()=>{for(let y=0;y<=document.documentElement.scrollHeight;y+=innerHeight/2){scrollTo(0,y);await new Promise(requestAnimationFrame);}});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`character-post-${width}.png`),fullPage:true,animations:'disabled'});
  }
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({offlineCharacterDrafts:true,coldReload:true,ownerAndActorIsolation:true,storageUsage,reconnectRosterRefresh:true,syncReviewAndRetry:true,independentPrivatePost:postId,failedDraftWrites,views,errors,offlineRequests},null,2));
 }catch(error){
  if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({message:error.message,body:await page.locator('body').innerText().catch(()=>''),errors,offlineRequests,failedDraftWrites,responses},null,2));}throw error;
 }finally{await browser.close();}
});
