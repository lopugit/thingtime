import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';

const base=process.env.TT_LOCAL_BLOBS_URL, playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts=process.env.TT_LOCAL_BLOBS_ARTIFACTS;
const digestFile=async(path:string)=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');};
test('native anonymous files save, copy, cold-reload, preview and download offline beyond 64 MiB', {skip:!base||!playwrightPath||!artifacts,timeout:240_000}, async(t)=>{
 assert.equal(new URL(base!).hostname,'127.0.0.1');
 // Fail closed unless the runner's inherited OS boundary rejects direct egress.
 for(const host of ['203.0.113.1','::ffff:203.0.113.1']) {
  const code=await new Promise(resolve=>{const s=net.connect({host,port:443});s.setTimeout(1500);s.on('error',(e:any)=>resolve(e.code));s.on('timeout',()=>{s.destroy();resolve('timeout');});s.on('connect',()=>{s.destroy();resolve('CONNECTED');});});
  assert.equal(code,'EPERM');
 }
 await mkdir(artifacts!,{recursive:true});
 const source=resolve(artifacts!,'large-original.bin'), output=createWriteStream(source), chunk=Buffer.alloc(1024*1024,73);
 for(let i=0;i<70;i++)if(!output.write(chunk))await once(output,'drain'); output.end();await once(output,'finish');
 const expectedHash=await digestFile(source);
 const {chromium}=await import(playwrightPath!), browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}), page=await context.newPage();
 page.setDefaultTimeout(25_000);
 const errors:string[]=[], writes:string[]=[], bounds:{width:number;scrollWidth:number}[]=[];
 page.on('pageerror',(e:Error)=>errors.push(e.message));
 page.on('request',(r:any)=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(new URL(r.url()).pathname);});
 await context.addInitScript(()=>{
  const original=Blob.prototype.arrayBuffer;
  (window as any).__wholeFileReads=0;
  Blob.prototype.arrayBuffer=function(){if(this.size>1024*1024){(window as any).__wholeFileReads++;throw Error('Unexpected whole-file read');}return original.call(this);};
 });
 const navigate=async(path:string)=>page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},path);
 const files=page.getByTestId('filesystem-browser');
 try {
  await assert.rejects(context.request.get('http://203.0.113.1/',{timeout:3000}),/EPERM/);
  await page.goto(new URL('/things?files=thingtime',base!).href);
  await files.getByRole('button',{name:'Add files',exact:true}).waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready; if(!navigator.serviceWorker.controller)return false;for(const name of await caches.keys())if(name.startsWith('thingtime:offline-shell:')&&await(await caches.open(name)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=168;const x=c.getContext('2d')!;x.fillStyle='#f4cfad';x.fillRect(0,0,120,168);x.fillStyle='#984b39';x.font='18px serif';x.fillText('Native file',15,80);return c.toDataURL('image/png').split(',')[1];}),'base64');
  await context.setOffline(true);
  await files.locator('input[type=file]').setInputFiles(source);
  await files.getByText('large-original.bin',{exact:true}).first().waitFor();
  await files.locator('input[type=file]').setInputFiles({name:'native-image.png',mimeType:'image/png',buffer:png});
  await files.getByText('native-image.png',{exact:true}).first().waitFor();
  await files.getByRole('button',{name:'New folder',exact:true}).click();
  await files.getByRole('textbox',{name:'New folder name'}).fill('Independent files');
  await files.getByRole('button',{name:'Create',exact:true}).click();
  await files.getByText('Independent files',{exact:true}).first().waitFor();
  await files.getByRole('checkbox',{name:'Select large-original.bin',exact:true}).locator('..').click();
  await files.getByRole('button',{name:'Copy',exact:true}).click();
  await files.getByText('Independent files',{exact:true}).first().dblclick();
  await files.getByRole('button',{name:'Paste (1)',exact:true}).click();
  await files.getByText('large-original.bin',{exact:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>(window as any).__wholeFileReads),0);
  await page.reload();await files.getByText('large-original.bin',{exact:true}).first().waitFor();
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:width===1440?1000:844});
   const scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);assert.equal(scrollWidth,width);bounds.push({width,scrollWidth});
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:resolve(artifacts!,`files-top-${width}.png`)});
   await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));await page.screenshot({path:resolve(artifacts!,`files-bottom-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:1000});
  const waiting=page.waitForEvent('download');await files.getByText('large-original.bin',{exact:true}).first().dblclick();
  const download=await waiting;assert.equal(await digestFile((await download.path())!),expectedHash);
  await download.saveAs(resolve(artifacts!,'large-downloaded.bin'));
  await navigate('/things?files=thingtime');await files.getByText('native-image.png',{exact:true}).first().waitFor();
  const nativeId=await page.evaluate(async()=>{
   const request=indexedDB.open('thingtime.local-workspaces.v1');const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   try {const request=db.transaction('records').objectStore('records').index('collection').getAll([JSON.stringify(['anonymous',1]),'things']);const rows=await new Promise<any[]>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return rows.find(row=>row.value.crystal.name==='native-image.png')?.id;}finally{db.close();}
  });assert.match(nativeId,/^local-/);
  await navigate('/media/'+nativeId);
  const image=page.locator('img[src^="blob:"]').first();await image.waitFor();await image.evaluate((img:HTMLImageElement)=>img.decode());
  assert.deepEqual(await image.evaluate((img:HTMLImageElement)=>[img.naturalWidth,img.naturalHeight]),[120,168]);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await image.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);await page.screenshot({path:resolve(artifacts!,`image-${width}.png`)});await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));}
  const retained=await page.evaluate(async()=>{const open=indexedDB.open('thingtime.local-workspaces.v1');const db=await new Promise<IDBDatabase>(resolve=>{open.onsuccess=()=>resolve(open.result);});try{const q=db.transaction('records').objectStore('records').getAll();const rows=await new Promise<any[]>(resolve=>{q.onsuccess=()=>resolve(q.result);});return {accountRecords:rows.filter(r=>r.scope!==JSON.stringify(['anonymous',1])).length,commands:rows.filter(r=>/commands|account-files/.test(r.collection)).length,blobFiles:rows.filter(r=>r.collection==='@bytes'&&r.value instanceof Blob).length};}finally{db.close();}});
  assert.equal(retained.accountRecords,0);assert.equal(retained.commands,0);assert.ok(retained.blobFiles>=3);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>(window as any).__wholeFileReads),0);
  await writeFile(resolve(artifacts!,'verification.json'),JSON.stringify({anonymous:true,offline:true,bytes:70*1024*1024,sha256:expectedHash,exactNativeDownload:true,independentCopy:true,coldReload:true,nativeImage:[120,168],wholeFileReads:0,bounds,retained,writes,errors},null,2));
 }catch(error){await page.screenshot({path:resolve(artifacts!,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts!,'failure.txt'),await page.locator('body').innerText().catch(()=>''));throw error;}
});
