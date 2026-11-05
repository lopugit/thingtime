import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_FILE_SYNC_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_FILE_SYNC_ARTIFACTS;
test('normal account file picker and native media finish offline without waiting for upload', {skip:!base||!playwrightPath,timeout:120_000}, async()=>{
 assert.ok(['127.0.0.1','localhost'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!);
 const browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
 page.setDefaultTimeout(15_000);
 const url=(path:string)=>new URL(path,base).href, modules=new Map<string,string>(),errors:string[]=[],writes:string[]=[];
 let offline=false;
 page.on('pageerror',(e:Error)=>errors.push(e.message));
 page.on('request',(r:any)=>{const path=new URL(r.url()).pathname;if(['/app/local-workspace/runtime.client.ts','/app/local-workspace/accountApi.client.ts','/app/components/Sharing/SharedMedia.tsx'].includes(path)||path.includes('/deps/react'))modules.set(path,r.url());if(offline&&!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(path);});
 const navigate=async(path:string)=>{await page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},path);};
 try {
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='file-ui-'+randomUUID().slice(0,8);
  const response=await context.request.post(url('/api/v1/auth/register'),{headers:{Origin:new URL(base!).origin},data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(response.status(),200,await response.text());
  await page.goto(url('/things?files=thingtime'));
  const files=page.getByTestId('filesystem-browser'); await files.getByRole('button',{name:'Add files',exact:true}).waitFor();
  await files.getByRole('button',{name:'Refresh',exact:true}).waitFor({state:'visible'});
  await page.waitForLoadState('networkidle');
  const paths=['/app/local-workspace/runtime.client.ts','/app/local-workspace/accountApi.client.ts'].map(p=>modules.get(p));assert.ok(paths.every(Boolean));
  await page.evaluate(paths=>{(window as any).__fileUiModules=paths;},paths);
  const sharedModules = [...modules.entries()].filter(([path])=>path.endsWith('/react.js')||path.endsWith('/react-dom_client.js')||path.endsWith('/SharedMedia.tsx')).map(([,url])=>url);
  assert.equal(sharedModules.length,3);
  await page.evaluate(async paths=>{(window as any).__sharedProbeModules=await Promise.all(paths.map(path=>import(path)));},sharedModules);
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=168;const x=c.getContext('2d')!;x.fillStyle='#f4cfad';x.fillRect(0,0,120,168);x.fillStyle='#984b39';x.font='18px serif';x.fillText('Device file',12,80);return c.toDataURL('image/png').split(',')[1];}),'base64');
  offline=true;await context.setOffline(true);
  await files.locator('input[type=file]').setInputFiles({name:'offline-native.png',mimeType:'image/png',buffer:png});
  await files.getByText('offline-native.png',{exact:true}).first().waitFor();
  await files.getByRole('button',{name:'New folder',exact:true}).click();
  await files.getByRole('textbox',{name:'New folder name'}).fill('Offline folder');
  await files.getByRole('button',{name:'Create',exact:true}).click();
  await files.getByText('Offline folder',{exact:true}).first().waitFor();
  const localId=await page.evaluate(async()=>{const [runtime,api]=await Promise.all((window as any).__fileUiModules.map((path:string)=>import(path)));const scope=runtime.currentAccountWorkspace();const rows=await api.accountWorkspaceWorker(scope).files.library();return rows.things.find((row:any)=>row.crystal.name==='offline-native.png')?.id;});
  assert.match(localId,/^local-file-/);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({path:resolve(artifacts,`file-browser-${width}.png`)});}
  await page.setViewportSize({width:1440,height:1000});
  await files.getByRole('checkbox',{name:'Select offline-native.png',exact:true}).locator('..').click();
  await files.getByRole('button',{name:'Cut',exact:true}).click();
  await files.getByText('Offline folder',{exact:true}).first().dblclick();
  await page.waitForURL('**/things?files=thingtime&folder=*');
  await files.getByRole('button',{name:'Paste (1)',exact:true}).click();
  await files.getByText('offline-native.png',{exact:true}).first().waitFor();
  const destination = new URL(page.url()).searchParams.get('folder'); assert.ok(destination);
  assert.equal(await page.evaluate(async(id:string)=>{const [runtime,api]=await Promise.all((window as any).__fileUiModules.map((path:string)=>import(path)));return (await api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.views([id]))[0]?.folderId;},localId),destination);
  const downloadPromise=page.waitForEvent('download');await files.getByText('offline-native.png',{exact:true}).first().dblclick();
  const download=await downloadPromise;assert.deepEqual(await readFile((await download.path())!),png);
  await navigate(`/media/${localId}`);
  await page.getByRole('link',{name:'Download',exact:true}).scrollIntoViewIfNeeded();
  const image=page.locator('img[src^="blob:"]').first();await image.waitFor();await image.evaluate((img:HTMLImageElement)=>img.decode());
  assert.equal(await image.evaluate((img:HTMLImageElement)=>img.naturalWidth),120);
  const blob=await image.getAttribute('src');assert.ok(blob?.startsWith('blob:'));
  await page.evaluate((id:string)=>{
   const modules=(window as any).__sharedProbeModules.map((module:any)=>module.default||module), React=modules.find((m:any)=>m.createElement), dom=modules.find((m:any)=>m.createRoot), shared=modules.find((m:any)=>m.SharedMediaProvider);
   const host=document.createElement('div');document.body.append(host);
   (window as any).__sharedProbeRoot=dom.createRoot(host);
   (window as any).__sharedProbeRoot.render(React.createElement(shared.SharedMediaProvider,{sharedRoot:'foreign-page'},React.createElement(()=>{const media=shared.useSharedMediaUrl();return React.createElement('img',{id:'shared-local-file-probe',src:media('/api/v1/attachments/content?id='+id)||undefined});})));
  },localId);
  const probe=page.locator('#shared-local-file-probe');await probe.waitFor({state:'attached'});
  assert.ok(!(await probe.getAttribute('src'))?.startsWith('blob:'),'Shared content cannot borrow active account device bytes');
  await page.evaluate(()=>{(window as any).__sharedProbeRoot.unmount();});
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await image.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({path:resolve(artifacts,`native-file-${width}.png`)});}
  assert.deepEqual(writes,[],'Offline UI writes must not issue remote mutations');
  // Delete through the existing facade. The mounted native preview must retire
  // its object URL, without waiting for navigation or a remote request.
  await page.evaluate(async(id:string)=>{const [runtime,api]=await Promise.all((window as any).__fileUiModules.map((path:string)=>import(path)));const scope=runtime.currentAccountWorkspace();await api.accountApi({things:{},attachments:{}},{id:scope.ownerId},scope.dataPlane).things.remove({id});},localId);
  await page.waitForFunction((previous:string)=>!document.querySelector(`img[src="${previous}"]`),blob);
  assert.equal(await page.evaluate(async(src:string)=>{try{await fetch(src);return true;}catch{return false;}},blob),false);
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({localId,offlinePicker:true,folder:true,movedToFolder:destination,sharedContextRefused:true,exactDownload:true,nativeImage:[120,168],viewports:[1440,390,320],revoked:true,writes,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}finally{await browser.close();}
});
