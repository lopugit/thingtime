import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTransfer } from '../utils/thingTransfer/format';
const base = process.env.TT_LOCAL_SCHEMA_URL, output = process.env.TT_LOCAL_SCHEMA_ARTIFACTS;
for (const account of [false, true]) test(`${account ? 'offline account' : 'anonymous'} schema-backed native detail renders after normal import and cold reload`,
 {skip: !base || !output || !process.env.TT_SHARED_PLAYWRIGHT_PATH, timeout: 180000}, async () => {
 const origin = new URL(base!).origin;
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
 const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
 const browser = await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true});
 const context = await browser.newContext({viewport:{width:1440,height:1000}}), page = await context.newPage();
 const errors:string[]=[], writes:string[]=[], schemaReads:string[]=[], bounds:any[]=[];
 const label = account ? 'account' : 'anonymous'; let offline = false;
 await mkdir(output!,{recursive:true}); page.setDefaultTimeout(20000);
 page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{
  if (!offline) return;
  const path = new URL(request.url()).pathname;
  if (!['GET','HEAD','OPTIONS'].includes(request.method())) writes.push(path);
  if (path === '/api/v1/things') schemaReads.push(request.url());
 });
 const url=(path:string)=>new URL(path,origin).href;
 try {
  if (account) {
   const status=await context.request.get(url('/api/v1/mongodb/status')); assert.equal(status.status(),200);
   const health=await status.json();assert.equal(health.host,'127.0.0.1:22463');assert.equal(health.custom,false);assert.equal(health.connected,true);
   const username='schemadetail-'+randomUUID().slice(0,8);
   const registration=await context.request.post(url('/api/v1/auth/register'),{headers:{Origin:origin,'X-Thingtime-Expected-Data-Plane':'home'},data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
   assert.equal(registration.status(),200);
  }
  // This request shares only this new browser context's cookie jar. Read its
  // body before navigation so boot/service-worker reloads cannot discard it.
  const root = await context.request.get(url('/api/root-data'));
  assert.equal(root.status(),200);const rootData=await root.json();
  await page.goto(url('/things'));
  if (account) assert.ok(rootData.user?.id); else assert.equal(rootData.user,null);
  await page.waitForFunction(async()=>{
   await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;
   for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;
   return false;
  },undefined,{timeout:95000});
  offline=true;await context.setOffline(true);await page.reload();
  await page.getByRole('button',{name:'Import…',exact:true}).click();
  await page.getByRole('textbox',{name:'Copied Thingtime content',exact:true}).fill(JSON.stringify({format:'thingtime.transfer',version:1,roots:['record'],files:[],things:[
   {id:'shape',thingtime:['schema'],crystal:{name:'Local card shape',fields:[{name:'message',type:'string'}],render:{tag:'article',props:{style:{padding:'24px',maxWidth:'400px',margin:'24px auto',background:'#fff4dc',borderRadius:'20px',textAlign:'center'}},children:'Native schema: {message}'}}},
   {id:'record',thingtime:['data'],crystal:{name:'Local schema record',schemaId:'shape',message:'Editable without a connection'}}
  ]}));
  await page.getByRole('button',{name:'Read pasted content',exact:true}).click();
  await page.getByRole('button',{name:'Import private copies',exact:true}).click();
  await page.getByRole('link',{name:'Local schema record',exact:true}).click();
  const preview=page.getByTestId('thing-data-template');
  await preview.getByText('Native schema: Editable without a connection',{exact:true}).waitFor();
  const detailUrl=page.url();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.reload();
   await preview.getByText('Native schema: Editable without a connection',{exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);
   const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(size.width,size.scrollWidth);bounds.push(size);
   await page.screenshot({path:resolve(output!,`${label}-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Transfer',exact:true}).click();
  await page.getByRole('menuitem',{name:'Export / Download…',exact:true}).click();
  await page.getByRole('combobox',{name:'Download format'}).selectOption('json');
  const ready=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
  const download=await ready, path=await download.path();assert.ok(path);
  const json=await readFile(path!,'utf8'), exported=parseTransfer(json);
  assert.equal(exported.things.length,2);
  const schema=exported.things.find(row=>row.thingtime.includes('schema'))!;
  const data=exported.things.find(row=>row.thingtime.includes('data'))!;
  assert.equal(data.crystal.schemaId,schema.id);assert.equal(data.crystal.message,'Editable without a connection');
  assert.deepEqual(exported.roots,[data.id]);assert.doesNotMatch(json,/"ownerId"|"acl"|"receiptPlane"/);
  await writeFile(resolve(output!,`${label}.thingtime.json`),json);
  // Remove only this fixture's local schema through its normal library menu.
  // The data remains inspectable, but no cached render can mask the missing dependency.
  await page.setViewportSize({width:1440,height:1000});await page.goto(url('/things'));
  await page.getByRole('link',{name:String(schema.crystal.name),exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:/Delete/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('link',{name:String(schema.crystal.name),exact:true}).waitFor({state:'hidden'});
  await page.goto(detailUrl);
  await page.getByRole('alert').filter({hasText:'Schema preview unavailable:'}).waitFor();
  assert.equal(await preview.count(),0);
  await page.getByRole('button',{name:'Retry schema preview',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Schema preview unavailable:'}).waitFor();
  assert.equal(await preview.count(),0);
  assert.equal(await page.getByText('Shared media requires a newer server. Please refresh after the update.',{exact:true}).count(),0);
  await page.screenshot({path:resolve(output!,`${label}-missing-schema.png`),fullPage:true});
  assert.deepEqual(writes,[]);assert.deepEqual(schemaReads,[]);assert.deepEqual(errors,[]);
  await writeFile(resolve(output!,`${label}-verification.json`),JSON.stringify({account,offline:true,normalImport:true,coldReload:true,missingSchemaReported:true,canonicalExport:true,dependencyCount:2,detailUrl,bounds,writes,schemaReads,errors},null,2));
 }catch(error){await page.screenshot({path:resolve(output!,`${label}-failure.png`),fullPage:true});await writeFile(resolve(output!,`${label}-failure.json`),JSON.stringify({error:String(error),body:await page.locator('body').innerText(),errors,writes,schemaReads},null,2));throw error;}
 finally{await context.close();await browser.close();}
});
