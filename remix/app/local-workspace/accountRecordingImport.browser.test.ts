import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeTransferArchive, decodeTransferArchive, transferChecksum } from '../utils/thingTransfer/archive';
import { validateTransfer, serializeTransfer } from '../utils/thingTransfer/format';

const base = process.env.TT_LOCAL_RECORDING_IMPORT_URL, adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE,
 playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_RECORDING_IMPORT_ARTIFACTS;
const wave = () => {
 const samples=8000*2, bytes=Buffer.alloc(44+samples*2);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
 bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);
 bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
 for(let n=0;n<samples;n++)bytes.writeInt16LE(Math.round(Math.sin(n*2*Math.PI*440/8000)*500),44+n*2);
 return bytes;
};
test('recordings import, play, export, retain and delete offline through native account surfaces',
 {skip:!base||!adminFile||!playwrightPath,timeout:240_000},async()=>{
 assert.ok(['127.0.0.1','localhost'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),admin=await browser.newContext(),guest=await browser.newContext();
 const page=await context.newPage(),url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin};
 const writes:any[]=[],retainedWrites:any[]=[],deletions:any[]=[],observations:any[]=[],errors:string[]=[];let offline=false,fileId='',folderId='',retainedContext:any,lost=0,activePage=page;
 page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{if(!['GET','HEAD','OPTIONS'].includes(request.method())){let body:any;try{body=request.postDataJSON();}catch{}writes.push({path:new URL(request.url()).pathname,body,offline});}});
 page.on('response',async(response:any)=>{if(new URL(response.url()).pathname==='/api/v1/attachments/uploads'&&response.status()===200)fileId=(await response.json()).upload.id;});
 const shell=async(p:any)=>p.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
 const playable=async(p:any)=>{const audio=p.locator('audio').filter({has:p.locator('source[src^="blob:"]')}).first();await audio.waitFor({state:'attached'});await audio.evaluate(async(a:HTMLAudioElement)=>{await a.play();});await p.waitForFunction(()=>{const a=document.querySelector('audio');return !!a&&a.currentTime>0.05&&!a.error;});assert.equal(await audio.evaluate((a:HTMLAudioElement)=>a.duration),2);await audio.evaluate((a:HTMLAudioElement)=>a.pause());return audio;};
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const administrator=JSON.parse(await readFile(adminFile!,'utf8'));
  assert.equal((await admin.request.post(url('/api/v1/login'),{headers,data:{username:administrator.username,password:administrator.password}})).status(),200);
  const username='recording-import-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID();
  const registered=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password}});assert.equal(registered.status(),200,await registered.text());const owner=(await registered.json()).user.id;
  assert.equal((await admin.request.post(url('/api/v1/admin/users/public-uploads'),{headers,data:{userId:owner,enabled:true,scope:'private'}})).status(),200);
  await page.goto(url('/things'));await page.getByRole('button',{name:'Import…',exact:true}).waitFor();await shell(page);
  const bytes=wave(),manifest=validateTransfer({format:'thingtime.transfer',version:1,roots:['folder'],things:[
   {id:'folder',thingtime:['folder'],crystal:{name:'Offline recordings'}},
   {id:'recording',thingtime:['attachment'],folderId:'folder',crystal:{recordingFileId:'audio-bytes'}}
  ],files:[{id:'audio-bytes',targetId:'recording',path:'files/000000',name:'recording.wav',mime:'audio/wav',bytes:bytes.length,sha256:await transferChecksum(bytes),title:'Imported recording'}]});
  const zip=await encodeTransferArchive({manifest,files:new Map([['audio-bytes',bytes]])});
  offline=true;await context.setOffline(true);await page.getByRole('button',{name:'Import…',exact:true}).click();
  await page.getByLabel('Thingtime transfer files',{exact:true}).setInputFiles({name:'recording.thingtime.zip',mimeType:'application/zip',buffer:Buffer.from(zip)});
  await page.getByText('Files save on this device now.',{exact:false}).waitFor();await page.getByRole('button',{name:'Import private copies',exact:true}).click();
  await page.getByRole('link',{name:'Offline recordings',exact:true}).click();await page.waitForURL((value:URL)=>value.searchParams.has('folder'));folderId=new URL(page.url()).searchParams.get('folder')!;
  const recording=page.getByRole('link',{name:'Imported recording',exact:true});await recording.click();await page.reload();await playable(page);assert.equal(await page.getByRole('button',{name:'Save full file offline',exact:true}).count(),0);
  await page.getByRole('button',{name:'Edit file details',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Offline recording title');await page.getByRole('button',{name:'Save file details',exact:true}).click();await page.getByRole('heading',{name:'Offline recording title',exact:true}).first().waitFor();await page.reload();await playable(page);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await page.getByRole('link',{name:'Download',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`recording-${width}.png`)});}
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download',exact:true}).click();assert.deepEqual(await readFile((await(await download).path())!),bytes);
  await page.goto(url('/things'));await page.getByRole('link',{name:'Offline recordings',exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'📥 Download…',exact:true}).click();
  const exporting=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const exportedZip=await readFile((await(await exporting).path())!),exported=await decodeTransferArchive(exportedZip);
  assert.equal(exported.manifest.things.find(row=>row.thingtime[0]==='attachment')!.crystal.filePurpose,undefined);assert.equal(exported.manifest.files[0].title,'Offline recording title');assert.deepEqual(Buffer.from(exported.files.get(exported.manifest.files[0].id)!),bytes);assert.deepEqual(writes.filter(row=>row.offline),[]);
  offline=false;await context.setOffline(false);await page.goto(url('/things'));
  let remote:any;
  for(let n=0;n<150;n++){if(fileId){const response=await context.request.get(url('/api/v1/things?id='+fileId));remote=(await response.json()).thing;if(remote?.folderId===folderId&&remote?.crystal.title==='Offline recording title')break;}await new Promise(resolve=>setTimeout(resolve,200));}
  assert.equal(remote?.folderId,folderId);assert.equal(remote?.crystal.title,'Offline recording title');
  const descriptor='/api/v1/attachments/content?id='+fileId+'&cache=retain&download=1';
  const receipt=await context.request.get(url(descriptor));assert.equal(receipt.status(),200,await receipt.text());const retainedDescriptor=await receipt.json();assert.equal(retainedDescriptor.file.purpose,'recording');assert.equal(retainedDescriptor.file.attachment.title,'Offline recording title');
  assert.equal((await guest.request.get(url(descriptor))).status(),401);assert.equal((await admin.request.get(url(descriptor))).status(),404);
  assert.equal(writes.filter(row=>row.path==='/api/v1/attachments/uploads').length,1);assert.equal(writes.find(row=>row.path==='/api/v1/attachments/uploads').body.purpose,'recording');
  // A new browser context has no imported device bytes: the normal media route
  // must retain the existing recording under its actual account identity.
  await context.close();retainedContext=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  assert.equal((await retainedContext.request.post(url('/api/v1/login'),{headers,data:{username,password}})).status(),200);
  const retained=await retainedContext.newPage();activePage=retained;let retainedOffline=false;
  retained.on('response',async(response:any)=>{const u=new URL(response.url());if(u.pathname==='/api/v1/things'&&u.searchParams.get('id')===fileId){try{const b=await response.json(),t=b.thing;observations.push({status:response.status(),error:b.error,id:t?.id,author:t?.author?.id,updatedAt:t?.updatedAt,folderId:t?.folderId,title:t?.crystal?.title});}catch{}}});
  retained.setDefaultTimeout(20_000);retained.on('pageerror',(error:Error)=>errors.push(error.message));
  retained.on('request',(request:any)=>{if(!['GET','HEAD','OPTIONS'].includes(request.method())){let body:any;try{body=request.postDataJSON();}catch{}retainedWrites.push({path:new URL(request.url()).pathname,body,offline:retainedOffline});}});
  await retained.goto(url('/things?folder='+folderId));await retained.getByRole('link',{name:'Offline recording title',exact:true}).click();await playable(retained);await shell(retained);
  retainedOffline=true;await retainedContext.setOffline(true);await retained.reload();await playable(retained);
  await retained.getByRole('button',{name:'Edit file details',exact:true}).click();await retained.getByLabel('Title',{exact:true}).fill('Retained recording title');await retained.getByRole('button',{name:'Save file details',exact:true}).click();await retained.getByRole('heading',{name:'Retained recording title',exact:true}).first().waitFor();await retained.reload();await playable(retained);
  await retained.goto(url('/things?folder='+folderId));await retained.getByRole('link',{name:'Retained recording title',exact:true}).click({button:'right'});await retained.getByRole('menuitem',{name:/Delete/}).click();await retained.getByRole('dialog').getByRole('button',{name:/Delete/}).click();
  await retained.getByRole('link',{name:'Retained recording title',exact:true}).waitFor({state:'hidden'});assert.deepEqual(retainedWrites.filter(row=>row.offline),[]);

  await retainedContext.route('**/api/v1/attachments/delete',async(route:any)=>{const body=route.request().postDataJSON();if(body.id!==fileId)return route.continue();deletions.push(body);const response=await route.fetch();if(!lost&&response.status()===200){lost++;return route.abort('failed');}return route.fulfill({response});});
  retainedOffline=false;await retainedContext.setOffline(false);await retained.goto(url('/things'));
  for(let n=0;n<350&&deletions.length<2;n++){if(await retained.getByText('File changes need review.',{exact:false}).count()){await retained.locator('summary').filter({hasText:'Review file sync'}).click();const review=retained.getByRole('button',{name:'Review file deletion',exact:true});if(await review.count()){await review.click();await retained.getByText('Current account version',{exact:true}).waitFor();}throw Error('Deletion unexpectedly requires review');}await new Promise(resolve=>setTimeout(resolve,200));}
  await retained.getByRole('region',{name:'Account file sync',exact:true}).waitFor({state:'hidden',timeout:75000});assert.equal(lost,1);assert.ok(deletions.length>=2);assert.deepEqual(deletions[0],deletions.at(-1));assert.equal(deletions[0].retainReceipt,true);assert.equal(deletions[0].requestId,undefined);
  assert.equal((await retainedContext.request.get(url(descriptor))).status(),404);assert.equal(retainedWrites.some(row=>row.path.includes('/attachments/uploads')),false);assert.deepEqual(errors,[]);
  // The same portable recording is usable without ever establishing an account.
  const anonymous=await guest.newPage(),anonymousWrites:string[]=[];activePage=anonymous;
  anonymous.setDefaultTimeout(20_000);anonymous.on('pageerror',(error:Error)=>errors.push(error.message));
  anonymous.on('request',(request:any)=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))anonymousWrites.push(new URL(request.url()).pathname);});
  await anonymous.goto(url('/things'));await anonymous.getByRole('button',{name:'Import…',exact:true}).waitFor();await shell(anonymous);
  await guest.setOffline(true);await anonymous.getByRole('button',{name:'Import…',exact:true}).click();
  await anonymous.getByLabel('Thingtime transfer files',{exact:true}).setInputFiles({name:'recording.thingtime.zip',mimeType:'application/zip',buffer:Buffer.from(zip)});
  await anonymous.getByRole('button',{name:'Import private copies',exact:true}).click();
  await anonymous.getByRole('link',{name:'Offline recordings',exact:true}).click();await anonymous.getByRole('link',{name:'Imported recording',exact:true}).click();
  await anonymous.reload();await playable(anonymous);assert.equal(await anonymous.getByRole('button',{name:'Save full file offline',exact:true}).count(),0);
  await anonymous.getByRole('button',{name:'Edit file details',exact:true}).click();
  await anonymous.getByLabel('Title',{exact:true}).fill('Anonymous recording title');
  await anonymous.getByLabel('Display filename',{exact:true}).fill('my-recording.wav');
  await anonymous.getByLabel('Description',{exact:true}).fill('Edited on this device while offline.');
  await anonymous.getByRole('button',{name:'Save file details',exact:true}).click();
  await anonymous.getByRole('heading',{name:'Anonymous recording title',exact:true}).first().waitFor();
  await anonymous.reload();await playable(anonymous);
  await anonymous.getByRole('heading',{name:'Anonymous recording title',exact:true}).first().waitFor();
  await anonymous.getByText('Edited on this device while offline.',{exact:true}).waitFor();
  for(const width of [1440,390,320]){await anonymous.setViewportSize({width,height:width===1440?1000:844});await anonymous.getByRole('button',{name:'Edit file details',exact:true}).scrollIntoViewIfNeeded();assert.equal(await anonymous.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await anonymous.screenshot({animations:'disabled',path:resolve(artifacts,`anonymous-recording-${width}.png`)});}
  const anonymousUrl=anonymous.url();
  await anonymous.goto(url('/things'));await anonymous.getByRole('link',{name:'Offline recordings',exact:true}).click({button:'right'});await anonymous.getByRole('menuitem',{name:'📥 Download…',exact:true}).click();
  const anonymousDownload=anonymous.waitForEvent('download');await anonymous.getByRole('button',{name:'Download',exact:true}).click();
  const anonymousZip=await readFile((await(await anonymousDownload).path())!),anonymousExport=await decodeTransferArchive(anonymousZip);
  assert.equal(anonymousExport.manifest.files[0].title,'Anonymous recording title');
  assert.equal(anonymousExport.manifest.files[0].description,'Edited on this device while offline.');
  assert.equal(anonymousExport.manifest.files[0].filenamePreview,'my-recording.wav');
  assert.deepEqual(Buffer.from(anonymousExport.files.get(anonymousExport.manifest.files[0].id)!),bytes);
  assert.ok(!serializeTransfer(anonymousExport.manifest).includes('canEditLocalFileDetails'));
  if(artifacts){await writeFile(resolve(artifacts,'anonymous-recording.thingtime.zip'),anonymousZip);await writeFile(resolve(artifacts,'anonymous-recording.thingtime.json'),serializeTransfer(anonymousExport.manifest));}
  await anonymous.goto(anonymousUrl);
  await guest.setOffline(false);await anonymous.reload();await playable(anonymous);await anonymous.waitForLoadState('networkidle');
  assert.deepEqual(anonymousWrites,[]);assert.deepEqual(errors,[]);
  if(artifacts){await writeFile(resolve(artifacts,'recording.thingtime.zip'),exportedZip);await writeFile(resolve(artifacts,'recording.thingtime.json'),serializeTransfer(exported.manifest));await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({anonymousOfflinePlayback:true,anonymousOfflineMetadata:true,anonymousMetadataExport:true,anonymousRemoteWrites:anonymousWrites,offlineImport:true,coldNativePlayback:true,offlineMetadata:true,canonicalRecordingExport:true,exactBytes:true,purposePreserved:true,retainedInCleanContext:true,offlineNativeDelete:true,lostDeletionReceipt:true,noReupload:true,viewports:[1440,390,320],writes,retainedWrites,errors},null,2));}
 }catch(error){if(artifacts){const active=activePage;await active.screenshot({animations:'disabled',path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await active.locator('body').innerText().catch(()=>''),writes,retainedWrites,deletions,lost,observations,errors},null,2));}throw error;}finally{
  await retainedContext?.setOffline(false);await context.setOffline(false).catch(()=>{});
  const request=retainedContext?.request||context.request;
  if(fileId)await request.post(url('/api/v1/attachments/delete'),{headers,data:{id:fileId}}).catch(()=>{});
  if(folderId)await request.delete(url('/api/v1/things'),{headers,data:{id:folderId}}).catch(()=>{});
  await browser.close();
 }
});
