import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeTransferArchive, decodeTransferArchive, transferChecksum } from '../utils/thingTransfer/archive';
import { validateTransfer, serializeTransfer } from '../utils/thingTransfer/format';
import { recordingTransferFile } from '../utils/thingTransfer/recording';

const base = process.env.TT_LOCAL_FILE_IMPORT_URL, adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_FILE_IMPORT_ARTIFACTS;
test('normal account file imports finish offline, render after cold reload, and sync independent private copies', { skip: !base || !adminFile || !playwrightPath, timeout: 180_000 }, async () => {
 assert.ok(['127.0.0.1','localhost'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!), browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), admin = await browser.newContext(), guest = await browser.newContext(), page = await context.newPage();
 const url = (path: string) => new URL(path, base).href, headers = { Origin: new URL(base!).origin }, ids = new Set<string>(), fileIds = new Set<string>(), writes: any[] = [], errors: string[] = [], failures: {path:string;status:number;error?:string}[] = [];
 let offline = false;
 page.on('console', (message:any) => { if(message.type()==='error' && /Content Security Policy|Cross-Origin|CORS/.test(message.text())) errors.push(message.text().replace(/\?[^\s"']+/g,'?redacted').slice(0,400)); });
 page.on('requestfailed', (request:any) => { const u=new URL(request.url()); if(u.pathname.includes('/attachments/')) failures.push({path:u.origin+u.pathname,status:0,error:request.failure()?.errorText}); });
 page.setDefaultTimeout(20_000); page.on('pageerror', (e: Error) => errors.push(e.message));
 page.on('request', (request: any) => { const path = new URL(request.url()).pathname; if (!['GET','HEAD','OPTIONS'].includes(request.method())) { let body: any; try { body = request.postDataJSON(); } catch { /* Binary upload body. */ } writes.push({ path, body, offline, actor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'] }); if (path === '/api/v1/things' && body?.shareId) ids.add(body.shareId); } });
 page.on('response', async (response: any) => { const path=new URL(response.url()).pathname; if(path.startsWith('/api/v1/attachments/') && response.status()>=400) { const body=await response.json().catch(()=>null); failures.push({path,status:response.status(),error:body?.code||body?.error}); } });
 page.on('response', async (response: any) => { if (new URL(response.url()).pathname === '/api/v1/attachments/uploads' && response.status() === 200) { const body = await response.json().catch(() => null); if (body?.upload?.id) fileIds.add(body.upload.id); } });
 const read = async (id: string) => { const response = await context.request.get(url('/api/v1/things?id=' + id)); return response.status() === 200 ? (await response.json()).thing : null; };
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const credentials = JSON.parse(await readFile(adminFile!, 'utf8'));
  assert.equal((await admin.request.post(url('/api/v1/login'), { headers, data: { username: credentials.username, password: credentials.password } })).status(), 200);
  const username = 'file-import-' + randomUUID().slice(0,8);
  const response = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } }); assert.equal(response.status(), 200, await response.text()); const owner = (await response.json()).user.id;
  for(const scope of ['private','public']) assert.equal((await admin.request.post(url('/api/v1/admin/users/public-uploads'), { headers, data: { userId: owner, enabled: true, scope } })).status(), 200);
  await page.goto(url('/things'));
  await page.getByRole('button', { name: 'Import…', exact: true }).waitFor();
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  const bytes = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width=120; c.height=168; const x=c.getContext('2d')!; x.fillStyle='#f4cfad'; x.fillRect(0,0,120,168); x.fillStyle='#984b39'; x.font='16px serif'; x.fillText('Imported file',10,80); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  const manifest = validateTransfer({ format: 'thingtime.transfer', version: 1, roots: ['folder','reply'], things: [
   { id: 'folder', thingtime: ['folder'], crystal: { name: 'Offline imported files' } },
   { id: 'component', thingtime: ['component'], folderId: 'folder', crystal: { name: 'Imported image component', componentKey: 'imported-image', version: 1, render: { tag: 'img', props: { src: '/api/v1/attachments/content?id=portable-bytes', alt: 'Imported offline picture', style: { width: '120px', maxWidth: '100%', margin: '24px auto', display: 'block', borderRadius: '16px' } } } } },
   { id: 'page', thingtime: ['webpage'], folderId: 'folder', crystal: { name: 'Imported image page', blocks: [{ id: 'image', type: 'component', component: 'component' }] } },
   { id: 'post', thingtime: ['post'], folderId: 'folder', crystal: { type: 'text', text: 'Imported bound post' } },
   { id: 'reply', thingtime: ['post','comment'], targetId: 'post', crystal: { type: 'text', text: 'Imported bound reply' } },
   { id: 'file', thingtime: ['attachment'], folderId: 'folder', crystal: { recordingFileId: 'portable-bytes', filePurpose: 'file' } }
  ], files: [{ id: 'portable-bytes', targetId: 'file', path: 'files/000000', name: 'imported.png', mime: 'image/png', bytes: bytes.length, sha256: await transferChecksum(bytes), title: 'Imported portrait', description: 'Independent portable bytes' }, ...await Promise.all(['first','second','reply-image'].map(async(id,index)=>({id,targetId:index===2?'reply':'post',path:'files/'+String(index+1).padStart(6,'0'),name:id+'.png',mime:'image/png',bytes:bytes.length,sha256:await transferChecksum(bytes)})))], attachmentOrder: ['portable-bytes','second','first','reply-image'] });
  const archive = await encodeTransferArchive({ manifest, files: new Map(manifest.files.map(file=>[file.id,bytes])) });
  offline = true; await context.setOffline(true);
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles({ name: 'files.thingtime.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await page.getByText('Files save on this device now.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Upload 4 files', exact: true }).count(), 0);
  for (const width of [1440,390,320]) { await page.setViewportSize({ width, height: width===1440?1000:844 }); await page.evaluate(() => document.fonts.ready); const box=await page.getByRole('dialog').evaluate((node: HTMLElement)=>({width:node.getBoundingClientRect().width,client:node.clientWidth,scroll:node.scrollWidth})); assert.ok(box.width<=width); assert.equal(box.client,box.scroll); if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`import-dialog-${width}.png`)}); }
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await page.getByRole('link', { name: 'Offline imported files', exact: true }).click();
  await page.waitForURL(value => value.searchParams.has('folder'));
  const folderId = new URL(page.url()).searchParams.get('folder')!; ids.add(folderId);
  const pageLink=page.getByRole('link',{name:'Imported image page',exact:true}); await pageLink.waitFor(); const pageHref=(await pageLink.getAttribute('href'))!, pageId=new URL(pageHref,base).pathname.split('/').at(-1)!; ids.add(pageId);
  const componentHref=await page.getByRole('link',{name:'Imported image component',exact:true}).getAttribute('href'); const componentId=new URL(componentHref!,base).pathname.split('/').at(-1)!; ids.add(componentId);
  await pageLink.click(); await page.waitForURL(value=>value.pathname==='/p/'+pageId);
  const image=page.getByRole('img',{name:'Imported offline picture',exact:true}); await image.waitFor(); await image.evaluate((img:HTMLImageElement)=>img.decode());
  assert.equal(await image.evaluate((img:HTMLImageElement)=>img.naturalWidth),120); assert.ok((await image.getAttribute('src'))?.startsWith('blob:'));
  await page.reload(); await image.waitFor(); await image.evaluate((img:HTMLImageElement)=>img.decode());
  for(const width of [1440,390,320]) { await page.setViewportSize({width,height:width===1440?1000:844}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width); if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`imported-page-${width}.png`)}); }
  await page.goto(url('/things')); await page.getByRole('link',{name:'Offline imported files',exact:true}).click({button:'right'}); await page.getByRole('menuitem',{name:'📥 Download…',exact:true}).click();
  const downloading=page.waitForEvent('download'); await page.getByRole('button',{name:'Download',exact:true}).click(); const zip=await readFile((await(await downloading).path())!), exported=await decodeTransferArchive(zip);
  assert.equal(exported.manifest.things.length,5); assert.equal(exported.manifest.files.length,3);
  const file=exported.manifest.things.find(row=>row.thingtime[0]==='attachment')!; recordingTransferFile(file,exported.manifest); for(const data of exported.files.values())assert.deepEqual(Buffer.from(data),bytes);
  const post=exported.manifest.things.find(row=>row.thingtime.includes('post'))!;ids.add(post.id);
  assert.deepEqual(exported.manifest.files.filter(file=>file.targetId===post.id).map(file=>file.name),['second.png','first.png']);
  await page.goto(url('/post/'+post.id));await page.getByText('Imported bound reply',{exact:true}).waitFor();
  const replyHref=(await page.locator('a[href^="/post/"]').evaluateAll((links:HTMLAnchorElement[])=>[...new Set(links.map(link=>link.getAttribute('href')))])).find((href:string)=>href!=='/post/'+post.id)!;assert.ok(replyHref);const replyId=replyHref.split('/').at(-1)!;ids.add(replyId);
  await page.goto(url(replyHref));await page.reload();await page.getByText('Imported bound reply',{exact:true}).waitFor();
  const replyImage=page.getByRole('button',{name:'View reply-image.png',exact:true}).locator('img');await replyImage.evaluate((img:HTMLImageElement)=>img.decode());assert.equal(await replyImage.evaluate((img:HTMLImageElement)=>img.naturalWidth),120);
  assert.ok((await replyImage.getAttribute('src'))?.startsWith('blob:'));
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await replyImage.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`imported-reply-${width}.png`)});}
  assert.deepEqual(writes.filter(row=>row.offline),[]); assert.equal(await read(pageId),null);
  offline=false; await context.setOffline(false); await page.goto(url('/things'));
  let component:any;
  for(let n=0;n<150;n++){component=await read(componentId);if(component?.crystal?.render?.props?.src?.includes('att_') && fileIds.size===4 && (await Promise.all([...ids].map(read))).every(Boolean))break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert.equal(fileIds.size,4); const accountFileId=new URL(component.crystal.render.props.src,base).searchParams.get('id')!; assert.ok(component?.crystal.render.props.src.includes(accountFileId)); assert.ok(!JSON.stringify(component.crystal).includes('local-file-'));
  let stored:any;
  for(let n=0;n<100;n++){stored=await read(accountFileId);if(stored?.folderId===folderId && stored?.crystal.title==='Imported portrait')break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert.equal(stored?.folderId,folderId); assert.equal(stored?.crystal.title,'Imported portrait'); assert.equal(stored.author.id,owner); assert.equal(stored.visibility,'private');
  assert.equal((await guest.request.get(url('/api/v1/things?id='+accountFileId))).status(),404);
  const original=await context.request.get(url('/api/v1/attachments/content?id='+accountFileId+'&cache=bytes&download=1')); assert.equal(original.status(),200); assert.deepEqual(await original.body(),bytes);
  const remotePost=await(await context.request.get(url('/api/v1/things?id='+post.id))).json(),remoteReply=await(await context.request.get(url('/api/v1/things?id='+replyId))).json();
  assert.deepEqual(remotePost.post.attachments.map((file:any)=>file.name),['second.png','first.png']);assert.deepEqual(remoteReply.post.attachments.map((file:any)=>file.name),['reply-image.png']);assert.equal(remoteReply.thing.targetId,post.id);assert.deepEqual(remoteReply.thing.acl,['tt:inherit']);
  for(const item of [...remotePost.post.attachments,...remoteReply.post.attachments]){assert.deepEqual(await(await context.request.get(url('/api/v1/attachments/content?id='+item.id+'&download=1'))).body(),bytes);assert.equal((await guest.request.get(url('/api/v1/attachments/content?id='+item.id))).status(),404);}
  assert.equal(writes.some(row=>row.path==='/api/v1/things/import'),false);
  for(const row of writes.filter(row=>row.path==='/api/v1/things'||row.path==='/api/v1/things/comment'||row.path==='/api/v1/attachments/uploads')) {assert.equal(row.actor,owner);assert.equal(row.plane,'home');}
  await page.goto(url('/p/'+pageId)); await image.waitFor(); await image.evaluate((img:HTMLImageElement)=>img.decode()); assert.equal(await image.evaluate((img:HTMLImageElement)=>img.naturalWidth),120);
  assert.deepEqual(errors,[]);
  if(artifacts){await writeFile(resolve(artifacts,'imported-export.thingtime.zip'),zip);await writeFile(resolve(artifacts,'imported-export.thingtime.json'),serializeTransfer(exported.manifest));await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({boundPostAndReplyImport:true,orderedBoundMedia:true,offlineNormalImport:true,coldNativePreview:true,canonicalReexport:true,exactBytes:true,privateUpload:true,canonicalMediaRemap:true,independentQueues:true,viewports:[1440,390,320],writes,errors},null,2));}
 }catch(error){if(artifacts){await page.screenshot({animations:'disabled',path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,writes,failures},null,2));}throw error;}finally{
  await context.setOffline(false).catch(()=>{});
  for(const id of fileIds) await context.request.post(url('/api/v1/attachments/delete'),{headers,data:{id}}).catch(()=>{});
  for(const id of ids) await context.request.delete(url('/api/v1/things'),{headers,data:{id}}).catch(()=>{});
  await browser.close();
 }
});
