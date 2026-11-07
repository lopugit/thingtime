import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin=process.env.TT_ACTION_SEARCH_ORIGIN, session=process.env.TT_ACTION_SEARCH_SESSION, artifacts=process.env.TT_ACTION_SEARCH_ARTIFACTS;
const fixture=process.env.TT_ACTION_SEARCH_FIXTURE, puppeteerPath=process.env.TT_ACTION_SEARCH_PUPPETEER, executablePath=process.env.TT_ACTION_SEARCH_CHROME;
test('native Agent Tasks installs, creates, lists and edits children offline; server mine scope preserves owner isolation', {
 skip:!origin||!session||!artifacts||!fixture||!puppeteerPath||!executablePath,timeout:180_000
},async t=>{
 assert.equal(new URL(origin!).hostname,'127.0.0.1');
 const health=await(await fetch(origin+'/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode,'isolated-agent-test');assert.equal(health.testEnvironment.sessionId,session);
 const manifest=await(await fetch(origin+'/.well-known/thingtime-capabilities.json')).json();assert.equal(manifest.features['api.things-search'].version,'1.4.0');
 await mkdir(artifacts!,{recursive:true});
 // Disposable API identities stay entirely inside the enforced test namespace.
 // They have no password, personal browser profile, host credential or external destination.
 const client=()=>{let cookies='';return async(path:string,body?:unknown)=>{
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin!,'Content-Type':'application/json',...(cookies?{Cookie:cookies}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const set=response.headers.getSetCookie();if(set.length)cookies=set.map(value=>value.split(';')[0]).join('; ');
  return {status:response.status,cache:response.headers.get('Cache-Control'),body:await response.json()};
 };};
 const owner=client(),other=client(),anon=client();
 assert.equal((await owner('/api/v1/auth/temporary',{})).status,201);assert.equal((await other('/api/v1/auth/temporary',{})).status,201);
 const own=await owner('/api/v1/things',{thingtime:['data'],crystal:{name:'Owned search fixture'},acl:['tt:user']});assert.equal(own.status,200);
 const foreign=await other('/api/v1/things',{thingtime:['data'],crystal:{name:'Foreign search fixture'},acl:['tt:all']});assert.equal(foreign.status,200);
 const scoped=await owner('/api/v1/things/search',{scope:'mine',thingtime:'data',sort:'newest'});assert.equal(scoped.status,200);
 assert.deepEqual(scoped.body.things.map((row:any)=>row.id),[own.body.thing.id]);
 const visible=await owner('/api/v1/things/search',{thingtime:'data',sort:'newest'});assert.equal(visible.status,200);assert.ok(visible.body.things.some((row:any)=>row.id===foreign.body.thing.id));
 const get=await owner('/api/v1/things/search?scope=mine&thingtime=data');assert.equal(get.status,200);assert.deepEqual(get.body.things.map((row:any)=>row.id),[own.body.thing.id]);
 assert.equal((await anon('/api/v1/things/search',{scope:'mine'})).status,401);
 assert.equal((await owner('/api/v1/things/search?scope=mine&anon=1')).status,401);
 assert.equal((await owner('/api/v1/things/search',{scope:{ownerId:'forged'}})).status,400);
 t.diagnostic('Built server manifest and real API owner scope verified');
 const {default:puppeteer}=await import(puppeteerPath!);
 const browser=await puppeteer.launch({executablePath,headless:true,pipe:true,protocolTimeout:30_000,args:['--no-proxy-server','--disable-background-networking']});
 t.signal.addEventListener('abort',()=>{void browser.close();},{once:true});
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(20_000);
 const errors:string[]=[],requests:string[]=[],views:unknown[]=[];
 page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(req:any)=>{const path=new URL(req.url()).pathname;if(/^\/api\/v1\/(things|drafts|actions|auth\/temporary)(\/|$)/.test(path))requests.push(`${req.method()} ${path}`);});
 const button=async(text:string)=>{
  const handle=await page.waitForFunction((value:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent?.trim()===value&&!el.disabled),{},text);
  const el=handle.asElement();await el.click();await handle.dispose();
 };
 const fill=async(selector:string,value:string)=>{const el=await page.waitForSelector(selector,{visible:true});await el.click();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await el.type(value);};
 const capture=async(label:string)=>{for(const width of [1440,390,320]){
  await page.setViewport({width,height:width===1440?1000:844});await page.evaluate(()=>document.fonts.ready);
  const bounds=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(bounds.scrollWidth,bounds.width,label);views.push({label,...bounds});
  for(const bottom of [false,true]){
   await page.evaluate(async(bottom:boolean)=>{for(const root of [document.scrollingElement!,...[...document.querySelectorAll<HTMLElement>('body *')].filter(el=>/auto|scroll/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1)]){
    if(root.scrollHeight>40000)throw Error('Repeating content');if(!bottom){root.scrollTop=0;continue;}
    for(let top=0;top<=root.scrollHeight;top+=Math.max(100,root.clientHeight/2)){root.scrollTop=top;await new Promise(requestAnimationFrame);}
   }},bottom);
   await page.screenshot({path:resolve(artifacts!,`${label}-${width}${bottom?'-bottom':''}.png`)});
  }
 }};
 try{
  await page.setViewport({width:1440,height:1000});await page.goto(origin+'/builder/demos/agent-tasks',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-testid="suite-detail-install"]');
  assert.equal(await page.evaluate(async()=> (await(await fetch('/api/root-data')).json()).user),null);
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;},{timeout:90_000});
  await page.setOfflineMode(true);await page.click('[data-testid="suite-detail-install"]');
  await page.waitForFunction(()=>location.pathname.startsWith('/p/agent-tasks'));
  await page.waitForSelector('input[name="title"]',{visible:true});
  await fill('input[name="title"]','Offline native task');await fill('textarea[name="description"]','Editable task with independent todos and progress.');await button('Create task');
  await page.waitForSelector('a[href^="/p/agent-tasks-detail?taskId="]');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('a[href^="/p/agent-tasks-detail?taskId="]');
  await page.waitForFunction(()=>document.body.innerText.includes('Offline native task'));
  await capture('offline-task-board');await page.setViewport({width:1440,height:1000});
  await page.click('a[href^="/p/agent-tasks-detail?taskId="]');await page.waitForSelector('input[name="title"]',{visible:true});
  await fill('input[name="title"]','Verify local child record');await button('Add todo');
  await page.waitForFunction(()=>document.body.innerText.includes('Verify local child record'));
  await button('Mark complete');await page.waitForFunction(()=>[...document.querySelectorAll('span')].some(el=>el.textContent==='Complete'));
  await fill('textarea[name="body"]','Native progress retained after reload.');await button('Save update');
  await page.waitForFunction(()=>document.body.innerText.includes('Native progress retained after reload.'));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.innerText.includes('Verify local child record')&&document.body.innerText.includes('Native progress retained after reload.'));
  await capture('offline-task-detail');
  await page.addScriptTag({path:fixture});const proof=await page.evaluate(()=>(window as any).actionSearchFixture.proof());
  assert.equal(proof.data.length,3);assert.ok(proof.data.some((row:any)=>row.crystal.done===true));
  await writeFile(resolve(artifacts!,'agent-tasks.transfer.json'),proof.json);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  await writeFile(resolve(artifacts!,'verification.json'),JSON.stringify({checks:['Built manifest 1.4.0','real API owner filter on GET and POST','anonymous and forced anonymous mine scope refused','invalid scope refused','normal no-login gallery install offline','normal task/todo/progress creation and completion','cold offline reload','canonical export of independently editable records'],views,requests,errors},null,2));
 }catch(error){await page.addScriptTag({path:fixture}).catch(()=>{});const failureProof=await page.evaluate(()=>(window as any).actionSearchFixture?.proof()).catch(()=>null);await writeFile(resolve(artifacts!,'failure-proof.json'),JSON.stringify({proof:failureProof,errors,requests},null,2));await page.screenshot({path:resolve(artifacts!,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts!,'failure.txt'),await page.$eval('body',(el:HTMLElement)=>el.innerText).catch(()=>'Unavailable'));throw error;}
 finally{await context.close();await browser.close();}
});
