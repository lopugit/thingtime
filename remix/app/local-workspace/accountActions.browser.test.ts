import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTransfer } from '../utils/thingTransfer/format';
const base=process.env.TT_LOCAL_ACTIONS_URL,output=process.env.TT_LOCAL_ACTIONS_ARTIFACTS;
test('native account Action runs after cold offline reload and syncs content without replay', {skip:!base||!output||!process.env.TT_SHARED_PLAYWRIGHT_PATH,timeout:240000},async()=>{
 const origin=new URL(base!).origin;assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
 const {chromium}=await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
 const browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const url=(path:string)=>new URL(path,origin).href,headers={Origin:origin,'X-Thingtime-Expected-Data-Plane':'home'};
 const writes:any[]=[],errors:string[]=[],bounds:any[]=[],cleanup:string[]=[];let offline=false;
 await mkdir(output!,{recursive:true});page.setDefaultTimeout(20000);
 context.on('request',(request:any)=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push({path:new URL(request.url()).pathname,offline,actor:request.headers()['x-thingtime-expected-actor'],plane:request.headers()['x-thingtime-expected-data-plane']});});
 page.on('pageerror',(error:Error)=>errors.push(error.message));
 try{
  const health=await context.request.get(url('/api/v1/mongodb/status'));assert.equal(health.status(),200);const status=await health.json();assert.equal(status.host,'127.0.0.1:22463');assert.equal(status.custom,false);assert.equal(status.connected,true);
  const username='localaction-'+randomUUID().slice(0,8);
  const registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});assert.equal(registration.status(),200);
  const root=await context.request.get(url('/api/root-data'));assert.equal(root.status(),200);const owner=(await root.json()).user.id;assert.ok(owner);
  await page.goto(url('/things'));
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;},undefined,{timeout:95000});
  offline=true;await context.setOffline(true);await page.reload();
  await page.getByRole('button',{name:'Import…',exact:true}).click();
  await page.getByRole('textbox',{name:'Copied Thingtime content',exact:true}).fill(JSON.stringify({format:'thingtime.transfer',version:1,roots:['action'],files:[],things:[
   {id:'schema',thingtime:['schema'],crystal:{name:'offline-action-note',fields:[{name:'name',type:'string'},{name:'message',type:'string'}]}},
   {id:'action',thingtime:['action'],crystal:{name:'Offline account Action',version:1,capabilities:[{capability:'things.create'}],steps:[{op:'things.create',schema:'schema',values:{name:'Offline Action result',message:'Action wrote this offline'}},{op:'return',value:'$step.1.id'}]}}
  ]}));
  await page.getByRole('button',{name:'Read pasted content',exact:true}).click();await page.getByRole('button',{name:'Import private copies',exact:true}).click();
  await page.getByRole('link',{name:'Offline account Action',exact:true}).waitFor();
  await page.goto(url('/actions'));await page.getByTestId('action-card-link').filter({hasText:'Offline account Action'}).click();
  await page.waitForURL(/\/actions\/[^/?]+/);
  const actionUrl=page.url(),actionId=new URL(actionUrl).pathname.split('/').pop()!;cleanup.push(actionId);
  await page.reload();await page.getByRole('button',{name:'Run action',exact:true}).click();
  await page.getByText('This device',{exact:true}).waitFor();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.reload();await page.getByText('This device',{exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(size.width,size.scrollWidth);bounds.push(size);
   await page.screenshot({path:resolve(output!,`account-action-${width}.png`),fullPage:true});
  }
  await page.goto(url('/things'));const link=page.getByRole('link',{name:'Offline Action result',exact:true});await link.waitFor();assert.equal(await link.count(),1);
  await link.click();await page.getByRole('button',{name:'Transfer',exact:true}).waitFor();
  await page.getByRole('button',{name:'Transfer',exact:true}).click();await page.getByRole('menuitem',{name:'Export / Download…',exact:true}).click();
  await page.getByRole('combobox',{name:'Download format'}).selectOption('json');const ready=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
  const path=await(await ready).path();const json=await readFile(path!,'utf8'),bundle=parseTransfer(json);
  const data=bundle.things.find(row=>row.thingtime.includes('data'))!,schema=bundle.things.find(row=>row.thingtime.includes('schema'))!;cleanup.push(schema.id);
  const dataId=data.id;cleanup.push(dataId);
  assert.equal(data.crystal.message,'Action wrote this offline');assert.equal(data.crystal.schemaId,schema.id);assert.equal(bundle.things.length,2);
  await writeFile(resolve(output!,'account-action-result.thingtime.json'),json);
  assert.deepEqual(writes.filter(row=>row.offline),[]);
  offline=false;await context.setOffline(false);await page.goto(url('/things'));
  let remote:any;
  for(let attempt=0;attempt<40;attempt++){
   const response=await context.request.get(url('/api/v1/things?id='+encodeURIComponent(dataId)));
   if(response.status()===200){const body=await response.json();if(body.thing?.crystal?.message==='Action wrote this offline'){remote=body.thing;break;}}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(remote,'reconnection syncs the completed local effect');assert.equal(remote.author.id,owner);assert.deepEqual(remote.acl,['tt:user']);
  const list=await context.request.get(url('/api/v1/things?thingtime=data'));assert.equal(list.status(),200);assert.equal((await list.json()).things.filter((row:any)=>row.crystal.name==='Offline Action result').length,1);
  assert.equal(writes.filter(row=>row.path==='/api/v1/actions/run').length,0);
  for(const write of writes.filter(row=>row.path==='/api/v1/things')){assert.equal(write.actor,owner);assert.equal(write.plane,'home');}
  assert.deepEqual(errors,[]);
  await writeFile(resolve(output!,'verification.json'),JSON.stringify({normalImport:true,coldOfflineExecution:true,localHistoryAfterReload:true,canonicalExport:true,syncWithoutReplay:true,bounds,writes,errors},null,2));
 }catch(error){await page.screenshot({path:resolve(output!,'failure.png'),fullPage:true});await writeFile(resolve(output!,'failure.json'),JSON.stringify({error:String(error),body:await page.locator('body').innerText(),writes,errors},null,2));throw error;}
 finally{
  await context.setOffline(false);await page.close();
  for(const id of cleanup)await context.request.delete(url('/api/v1/things?id='+encodeURIComponent(id)),{headers}).catch(()=>{});
  await context.close();await browser.close();
 }
});
