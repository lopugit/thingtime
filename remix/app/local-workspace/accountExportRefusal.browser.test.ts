import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeTransferArchive } from '../utils/thingTransfer/archive';
const base=process.env.TT_LOCAL_FILE_EXPORT_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_LOCAL_FILE_EXPORT_ARTIFACTS;
test('the normal offline Download dialog cannot reuse a dependency after a known account read refusal',{skip:!base||!playwrightPath,timeout:150000},async()=>{
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),reader=await context.newPage();
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin},ids:string[]=[],downloads:string[]=[],errors:string[]=[],mutations:string[]=[];let offline=false;
 page.setDefaultTimeout(20000);reader.setDefaultTimeout(20000);
 const recordRequest=(r:any)=>{if(offline&&!['GET','HEAD','OPTIONS'].includes(r.method()))mutations.push(new URL(r.url()).pathname);};
 for(const tab of [page,reader]){tab.on('pageerror',(e:Error)=>errors.push(e.message));tab.on('request',recordRequest);}
 page.on('download',(download:any)=>downloads.push(download.suggestedFilename()));
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='export-refusal-'+randomUUID().slice(0,8);
  const registered=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});assert.equal(registered.status(),200,await registered.text());
  const create=async(thingtime:string[],crystal:any)=>{const response=await context.request.post(url('/api/v1/things'),{headers,data:{thingtime,crystal,acl:['tt:user']}});assert.equal(response.status(),200,await response.text());const id=(await response.json()).thing.id;ids.push(id);return id;};
  const dependency=await create(['component'],{name:'Export refusal dependency',componentKey:'export-refusal',version:1,render:{tag:'p',children:'Previously authorized component'}});
  const root=await create(['webpage'],{name:'Export refusal page',blocks:[{id:'card',type:'component',component:dependency}]});
  await page.goto(url('/things'));const link=page.getByRole('link',{name:'Export refusal page',exact:true});await link.waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  const open=async()=>{await link.click({button:'right'});await page.getByRole('menuitem',{name:'📥 Download…',exact:true}).click();};
  await open();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
  const bundle=await decodeTransferArchive(await readFile((await(await downloading).path())!));assert.deepEqual(new Set(bundle.manifest.things.map(row=>row.id)),new Set([root,dependency]));
  await page.getByRole('dialog').waitFor({state:'detached'});await open();
  assert.equal((await context.request.delete(url('/api/v1/things'),{headers,data:{id:dependency}})).status(),200);
  const refused=reader.waitForResponse((r:any)=>new URL(r.url()).pathname==='/api/v1/things'&&new URL(r.url()).searchParams.get('id')===dependency&&r.status()===404);
  await reader.goto(url('/thing/'+dependency));await refused;
  await reader.getByText(/not found|not available|could not|couldn't|no longer/i).first().waitFor();
  offline=true;await context.setOffline(true);await page.getByRole('button',{name:'Download',exact:true}).click();
  const error=page.getByRole('dialog').getByRole('alert');await error.waitFor();assert.match(await error.innerText(),/Complete export content|no longer available|Missing component|not saved/i);assert.equal(downloads.length,1);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await error.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`refused-export-${width}.png`)});}
  assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({normalInitialExport:true,knownDependencyRefusal:true,crossTab:true,offlineRedownloadRefused:true,downloads:downloads.length,mutations,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),reader:await reader.locator('body').innerText().catch(()=>''),downloads,mutations,errors},null,2));}throw error;}
 finally{await context.setOffline(false).catch(()=>{});for(const id of ids.reverse())await context.request.delete(url('/api/v1/things'),{headers,data:{id}}).catch(()=>{});await browser.close();}
});
