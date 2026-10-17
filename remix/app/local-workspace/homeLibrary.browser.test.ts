import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTransfer } from '../utils/thingTransfer/format';
const base = process.env.TT_HOME_LIBRARY_URL, output = process.env.TT_HOME_LIBRARY_ARTIFACTS;
test('native home library imports, edits and exports offline independently of selected storage',
 {skip: !base || !output || !process.env.TT_SHARED_PLAYWRIGHT_PATH, timeout: 180000}, async () => {
 const origin = new URL(base!).origin;
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
 const {chromium} = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
 const browser = await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true});
 const context = await browser.newContext({viewport:{width:1440,height:1000}}), page = await context.newPage();
 const errors:string[]=[], writes:string[]=[], bounds:any[]=[];
 let offline=false;
 page.setDefaultTimeout(25000);
 page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{if(offline && !['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
 await mkdir(output!,{recursive:true});
 const url=(path:string)=>new URL(path,origin).href;
 const importBundle=async(things:any[],roots:string[])=>{
  await page.getByRole('button',{name:'Import…',exact:true}).click();
  await page.getByRole('textbox',{name:'Copied Thingtime content',exact:true}).fill(JSON.stringify({format:'thingtime.transfer',version:1,roots,files:[],things}));
  await page.getByRole('button',{name:'Read pasted content',exact:true}).click();
  await page.getByRole('button',{name:'Import private copies',exact:true}).click();
 };
 const dismiss=async()=>{
  for(let i=0;i<15;i++){const button=page.locator('.lopuToast').getByRole('button',{name:'Close',exact:true}).first();if(!await button.isVisible())break;await button.click();}
  await page.locator('.lopuToast').first().waitFor({state:'hidden'});
 };
 try {
  const status=await context.request.get(url('/api/v1/mongodb/status'));assert.equal(status.status(),200);
  const health=await status.json();assert.equal(health.host,'127.0.0.1:22463');assert.equal(health.custom,false);assert.equal(health.connected,true);
  const username='homelibrary-'+randomUUID().slice(0,8);
  const registration=await context.request.post(url('/api/v1/auth/register'),{headers:{Origin:origin,'X-Thingtime-Expected-Data-Plane':'home'},data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(registration.status(),200);const owner=(await registration.json()).user.id;
  await page.goto(url('/things'));await page.getByRole('link',{name:'Home library',exact:true}).click();
  await page.waitForURL((value:URL)=>value.searchParams.get('localPlane')==='home');
  const homeUrl=page.url();
  await page.waitForFunction(async()=>{
   await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;
   for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;
   return false;
  }, undefined, {timeout:95000});
  offline=true;await context.setOffline(true);await page.reload();
  await importBundle([
   {id:'folder',thingtime:['folder'],crystal:{name:'Home mixed bundle'}},
   {id:'theme',thingtime:['theme'],folderId:'folder',crystal:{name:'Home peach theme',theme:{colors:{accent:'#bf8068'}}}},
   {id:'data',thingtime:['data'],folderId:'folder',crystal:{name:'Home companion',value:'Editable companion'}}
  ],['folder']);
  await page.getByRole('link',{name:'Home mixed bundle',exact:true}).click();
  await page.waitForURL((value:URL)=>!!value.searchParams.get('folder'));
  assert.equal(new URL(page.url()).searchParams.get('localPlane'),'home');
  const folderUrl=page.url(), folderId=new URL(folderUrl).searchParams.get('folder')!;
  await page.getByRole('link',{name:'Home companion',exact:true}).waitFor();
  await page.reload();await page.getByRole('link',{name:'Home companion',exact:true}).waitFor();
  const detailHref=await page.getByRole('link',{name:'Home companion',exact:true}).getAttribute('href');
  assert.equal(new URL(detailHref!,origin).searchParams.get('dataPlane'),'home');
  assert.equal(new URL(detailHref!,origin).searchParams.get('historyOwner'),owner);
  await page.getByRole('link',{name:'Home companion',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:/Rename/}).click();
  await page.getByRole('textbox',{name:'Thing title'}).fill('Home edited companion');
  await page.getByRole('button',{name:'Rename',exact:true}).click();
  await page.getByRole('link',{name:'Home edited companion',exact:true}).waitFor();
  // Only this disposable browser's offline content pointer is changed. This
  // cannot create authenticated authority or select a remote database.
  const custom='custom-'+'a'.repeat(64);
  await page.evaluate(({owner,custom})=>localStorage.setItem('thingtime:local-workspace-root:v1',JSON.stringify(['account',1,location.origin,owner,custom])),{owner,custom});
  await page.goto(url('/things'));await page.getByRole('link',{name:'Home library',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Home mixed bundle',exact:true}).count(),0);
  await importBundle([{id:'other',thingtime:['data'],crystal:{name:'Selected companion'}}],['other']);
  await page.getByRole('link',{name:'Selected companion',exact:true}).waitFor();
  await page.getByRole('link',{name:'Home library',exact:true}).click();
  await page.getByRole('link',{name:'Home mixed bundle',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Selected companion',exact:true}).count(),0);
  const second=await context.newPage();
  second.on('pageerror',(error:Error)=>errors.push(error.message));
  await second.goto(folderUrl);await second.getByRole('link',{name:'Home edited companion',exact:true}).waitFor();
  await page.goto(folderUrl);
  await page.getByRole('link',{name:'Home edited companion',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:/Rename/}).click();
  await page.getByRole('textbox',{name:'Thing title'}).fill('Home final companion');
  await page.getByRole('button',{name:'Rename',exact:true}).click();
  await second.getByRole('link',{name:'Home final companion',exact:true}).waitFor();
  await second.close();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.goto(folderUrl);
   await page.getByRole('link',{name:'Home final companion',exact:true}).waitFor();
   await dismiss();await page.evaluate(()=>document.fonts.ready);
   const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(size.width,size.scrollWidth);bounds.push(size);
   await page.screenshot({path:resolve(output!,`home-${width}.png`),fullPage:true});
   await page.goto(homeUrl);await page.getByRole('link',{name:'Home mixed bundle',exact:true}).click({button:'right'});
   await page.getByRole('menuitem',{name:'📥 Download…',exact:true}).click();
   await page.getByRole('combobox',{name:'Download format'}).selectOption('json');
   const ready=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
   const download=await ready, path=await download.path();assert.ok(path);
   const json=await readFile(path!,'utf8'), manifest=parseTransfer(json);
   assert.equal(manifest.things.length,3);assert.deepEqual(manifest.roots,[folderId]);
   const theme=manifest.things.find(row=>row.thingtime.includes('theme'))!;
   assert.equal(theme.folderId,folderId);assert.equal((theme.crystal.theme as any).colors.accent,'#bf8068');
   assert.equal(manifest.things.find(row=>row.thingtime.includes('data'))!.crystal.title,'Home final companion');
   assert.doesNotMatch(json,/"ownerId"|"acl"|"receiptPlane"|"revision"/);
   await writeFile(resolve(output!,`home-${width}.json`),json);
  }
  await page.goto(url('/things?localPlane=home&workspaceOwner=another-account'));
  await page.getByRole('alert').filter({hasText:'does not match'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Home mixed bundle',exact:true}).count(),0);
  const remote=await context.request.get(url('/api/v1/things?folder=root'),{headers:{'X-Thingtime-Expected-Data-Plane':'home','X-Thingtime-Expected-Actor':owner}});
  assert.equal(remote.status(),200);assert.equal((await remote.json()).things.some((row:any)=>row.id===folderId),false);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  await writeFile(resolve(output!,'verification.json'),JSON.stringify({bounds,offlineWrites:writes,errors,mixedExports:3,selectedIsolated:true,crossTabRefresh:true,foreignLinkRefused:true,remoteFolder:false,customPlane:'offline restored identity; live selected-custom acceptance remains required'},null,2));
 }catch(error){await page.screenshot({path:resolve(output!,'failure.png'),fullPage:true});await writeFile(resolve(output!,'failure.json'),JSON.stringify({body:await page.locator('body').innerText(),errors,writes},null,2));throw error;}
 finally{await context.close();await browser.close();}
});
