#!/usr/bin/env node
// Disposable real API acceptance. All application/backend network is OS fenced.
// Only replica-set initialization uses the Mongo driver; product data uses APIs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
if (process.argv.includes('--browser-worker')) { await browserAcceptance(); process.exit(); }
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-single-click-'));
const ports = { api: 19641, db: 19642, web: 19643, hmr: 19644 };
const origin = `http://127.0.0.1:${ports.api}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=single_click`;
const children = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const password = randomBytes(24).toString('hex');
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
  THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(dir, 'attachments'), TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
let trapHits = 0;
const trap = createServer((req,res) => { trapHits++; res.writeHead(307, { Location: 'http://1.1.1.1:80/' }); res.end(); });
await new Promise(r => trap.listen(0, '127.0.0.1', r));
const policy = join(dir, 'network.sb');
await writeFile(policy, `(version 1)(allow default)(deny network*)
(allow network-bind (local unix-socket))
(allow network-inbound ${Object.values(ports).map(p => `(local ip "localhost:${p}")`).join(' ')})
(allow network-outbound ${[...Object.values(ports),trap.address().port].map(p => `(remote ip "localhost:${p}")`).join(' ')})`);
function start(executable,args,extra={}) {
  const child = spawn('/usr/bin/sandbox-exec',['-f',policy,executable,...args], {cwd,detached:true,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
  let log=''; child.stdout.on('data',d=>log+=d); child.stderr.on('data',d=>log+=d); children.push(child);
  return {child,log:()=>log};
}
async function stop(running) {
  const killGroup = signal => { try { process.kill(-running.child.pid, signal); } catch(error) { if(error.code !== 'ESRCH') throw error; } };
  const exited = running.child.exitCode !== null || running.child.signalCode !== null;
  const exit = exited ? Promise.resolve() : once(running.child, 'exit');
  killGroup('SIGTERM');
  const forced = setTimeout(() => killGroup('SIGKILL'), 3000);
  await exit; clearTimeout(forced);
  killGroup('SIGKILL');
}
async function ready(running, readyOrigin = origin) {
  for(let n=0;n<100;n++) { if(running.child.exitCode!==null) throw new Error(running.log());
    try { if((await fetch(`${readyOrigin}/.well-known/thingtime-capabilities.json`,{signal:AbortSignal.timeout(700)})).ok)return; } catch{}
    await delay(200);
  } throw new Error(`Server not ready: ${running.log()}`);
}
async function api(path,{body,cookie,as,method,status=200}={}) {
  console.log(`${method||(body?'POST':'GET')} ${path.split('?')[0]}`);
  const response=await fetch(origin+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(as?{'X-Thingtime-Character':as}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(status!==null)assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return {data,status:response.status,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
let server;
let database;
let mongoClient;
try {
  assert.equal(process.platform,'darwin','Requires OS sandbox; do not fall back to unrestricted execution');
  for(const port of Object.values(ports)) { const listener=createServer(); await new Promise((r,j)=>{listener.once('error',j);listener.listen(port,'127.0.0.1',r)});await new Promise(r=>listener.close(r)); }
  const preflight=start(process.execPath,['--input-type=module','-e',`for(const url of ['http://1.1.1.1:80/','http://127.0.0.1:${trap.address().port}/redirect']){try{await fetch(url,{signal:AbortSignal.timeout(2000)});throw Error('BOUNDARY_FAILED')}catch(e){if(e.cause?.code!=='EPERM')throw e}}`]);
  assert.equal((await once(preflight.child,'exit'))[0],0,preflight.log()); assert.equal(trapHits,1);
  await mkdir(join(dir,'db'));
  const db=database=start('/opt/homebrew/bin/mongod',['--dbpath',join(dir,'db'),'--port',String(ports.db),'--bind_ip','127.0.0.1','--replSet','single_click','--nounixsocket']);
  const client=mongoClient=new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`,{serverSelectionTimeoutMS:1000});
  for(let n=0;;n++) { try{await client.connect();break}catch(e){if(n>20)throw e;await delay(300)} }
  await client.db('admin').command({replSetInitiate:{_id:'single_click',members:[{_id:0,host:`127.0.0.1:${ports.db}`}]}});
  for(let n=0;;n++){if((await client.db('admin').command({hello:1})).isWritablePrimary)break;if(n>100)throw Error('Replica not primary');await delay(200)}
  await client.close();
  server=start(process.execPath,['.output/server/index.mjs']); await ready(server);
  const username='single-click-test';
  const owner=await api('/api/v1/auth/register',{body:{username,email:'click@example.invalid',password,displayName:'Browser acceptance'}});
  await stop(server); server=start(process.execPath,['.output/server/index.mjs'],{ADMIN_USERNAMES:username}); await ready(server);
  const create = async (kind,name,folderId) => (await api('/api/v1/things',{cookie:owner.cookie,body:{thingtime:[kind],crystal:{name,text:name},...(folderId?{folderId}:{})}})).data.thing;
  const folder=await create('folder','Acceptance folder');
  const alpha=await create('data','Acceptance alpha');
  const beta=await create('data','Acceptance beta');
  const nested=await create('data','Acceptance nested',folder.id);
  const childFolder=await create('folder','Acceptance child folder',folder.id);
  const pairing=(await api('/api/v1/devices/pairing',{cookie:owner.cookie,body:{}})).data.pairing;
  const {publicKey:publicKeyObject,privateKey}=generateKeyPairSync('ed25519');
  const publicKey=publicKeyObject.export({format:'der',type:'spki'}).subarray(-32).toString('base64url');
  const nonce=randomBytes(32).toString('base64url');
  const credential='ttnode_'+randomBytes(32).toString('base64url');
  const prepared=(await api('/api/v1/devices/pairing/claim',{body:{op:'prepare',pairingSecret:pairing.pairingSecret,publicKey,nonce}})).data.proof;
  const deviceDescriptor={name:'Acceptance computer',platform:'macos',model:'Synthetic',osVersion:'test',appVersion:'1.0.0'};
  const capabilities=[];
  const proofFields=['thingtime-device-pairing-claim-v1',prepared.pairingId,pairing.pairingSecret,credential,publicKey,nonce,prepared.serverNonce,deviceDescriptor.name,deviceDescriptor.platform,deviceDescriptor.model,deviceDescriptor.osVersion,deviceDescriptor.appVersion,String(capabilities.length),...capabilities];
  const proofBytes=Buffer.concat(proofFields.flatMap(value=>{const bytes=Buffer.from(value,'utf8');return [Buffer.from(`${bytes.length}:`,'ascii'),bytes]}));
  const signature=sign(null,proofBytes,privateKey).toString('base64url');
  const paired=(await api('/api/v1/devices/pairing/claim',{body:{op:'complete',pairingSecret:pairing.pairingSecret,credential,device:deviceDescriptor,capabilities,proof:{pairingId:prepared.pairingId,publicKey,nonce,serverNonce:prepared.serverNonce,signature}}})).data.device;
  for(const thing of [folder,alpha,beta,nested]) { const read=(await api('/api/v1/things?id='+thing.id,{cookie:owner.cookie})).data; assert(JSON.stringify(read).includes(thing.id)); }
  const bytes=Buffer.from('Thingtime single click acceptance file\n');
  const upload=(await api('/api/v1/attachments/uploads',{cookie:owner.cookie,body:{requestId:randomUUID(),filename:'Acceptance file.txt',contentType:'text/plain',sizeBytes:bytes.length,purpose:'file'}})).data.upload;
  const checksumSha256=createHash('sha256').update(bytes).digest('base64');
  const parts=(await api('/api/v1/attachments/uploads/parts',{cookie:owner.cookie,body:{uploadId:upload.id,parts:[{partNumber:1,checksumSha256}]}})).data.parts;
  for(const part of parts){const url=new URL(part.url,origin);assert.equal(url.origin,origin,'Upload must stay on isolated API origin');const sent=await fetch(url,{method:'PUT',headers:part.headers,body:bytes});assert(sent.ok,'File upload part');}
  const file=(await api('/api/v1/attachments/uploads/complete',{cookie:owner.cookie,body:{uploadId:upload.id}})).data.attachment;
  assert.equal(typeof file?.id,'string','Completed file upload must return its standalone attachment Thing id');
  const rootListing=(await api('/api/v1/things?folder=root&limit=50',{cookie:owner.cookie})).data;
  const listedThings=Array.isArray(rootListing.things)?rootListing.things:[];
  const directRead=await api('/api/v1/things?id='+encodeURIComponent(file.id),{cookie:owner.cookie,status:null});
  const moved=await api('/api/v1/things/bulk',{cookie:owner.cookie,body:{op:'move',ids:[file.id],folderId:folder.id}});
  assert.equal(moved.data.results?.[0]?.ok,true,'Move standalone uploaded file into the disposable fixture folder through the normal Things API');
  const folderListing=(await api('/api/v1/things?folder='+encodeURIComponent(folder.id)+'&limit=50',{cookie:owner.cookie})).data;
  const folderThings=Array.isArray(folderListing.things)?folderListing.things:[];
  assert(folderThings.some(thing=>thing.id===file.id),'Exact completed attachment id is present after normal API folder move');
  const fileTrace={completed:{id:file.id,kind:file.kind,thingtime:file.thingtime,keys:Object.keys(file).sort()},directRead:{status:directRead.status,keys:Object.keys(directRead.data).sort(),thing:directRead.data.thing?{id:directRead.data.thing.id,kind:directRead.data.thing.kind,thingtime:directRead.data.thing.thingtime,name:directRead.data.thing.crystal?.name}:null},rootResponseKeys:Object.keys(rootListing).sort(),rootMatches:listedThings.filter(thing=>thing.id===file.id).map(thing=>({id:thing.id,kind:thing.kind,thingtime:thing.thingtime,name:thing.crystal?.name,keys:Object.keys(thing).sort()})),folderMatches:folderThings.filter(thing=>thing.id===file.id).map(thing=>({id:thing.id,kind:thing.kind,thingtime:thing.thingtime,name:thing.crystal?.name}))};
  const evidenceDir=process.env.SINGLE_CLICK_EVIDENCE_DIR;
  if(evidenceDir){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,'attachment-id-trace.json'),JSON.stringify(fileTrace,null,2));}
  if(process.env.SINGLE_CLICK_TRACE_ONLY==='1') console.log(JSON.stringify(fileTrace));
  else {
    const vite=start(process.execPath,['--input-type=module','-e',`import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`],{NODE_ENV:'development'});
    const webOrigin=`http://127.0.0.1:${ports.web}`; await ready(vite,webOrigin);
    const fixture=join(dir,'browser-fixture.json');
    await writeFile(fixture,JSON.stringify({origin:webOrigin,cookie:owner.cookie,folder,alpha,beta,nested,childFolder,file,deviceId:paired.id,redirect:`http://127.0.0.1:${trap.address().port}/redirect`}),{mode:0o600});
    const ui=start(process.execPath,['scripts/things-single-click-acceptance.mjs','--browser-worker',fixture],{PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE,CHROMIUM_EXECUTABLE:process.env.CHROMIUM_EXECUTABLE,SINGLE_CLICK_EVIDENCE_DIR:process.env.SINGLE_CLICK_EVIDENCE_DIR});
    const timeout=setTimeout(()=>{try{process.kill(-ui.child.pid,'SIGTERM')}catch{}},240000);
    const result=await once(ui.child,'exit'); clearTimeout(timeout); assert.equal(result[0],0,ui.log()); console.log(ui.log());
  }
} catch(error) {
  console.error(error.message);
  if(database) await writeFile('/tmp/thingtime-single-click-db.log',database.log(),{mode:0o600});
  if(server) await writeFile('/tmp/thingtime-single-click-server.log',server.log(),{mode:0o600});
  process.exitCode=1;
} finally {
  await mongoClient?.close();
  for(const child of children.reverse()) await stop({child});
  await new Promise(r=>trap.close(r)); await rm(dir,{recursive:true,force:true});
}

async function browserAcceptance() {
  const {readFile} = await import('node:fs/promises');
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const fixture=JSON.parse(await readFile(process.argv.at(-1),'utf8'));
  const out=process.env.SINGLE_CLICK_EVIDENCE_DIR;
  assert(out,'SINGLE_CLICK_EVIDENCE_DIR must be explicit'); await mkdir(out,{recursive:true});await rm(join(out,'browser-failure.json'),{force:true});await rm(join(out,'browser-result.json'),{force:true});
  const downloadDir=join(out,'downloads');await mkdir(downloadDir,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--disable-background-networking','--disable-component-update','--no-proxy-server','--touch-events=enabled']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  let page=await context.newPage();const downloadCdp=await context.newCDPSession(page);await downloadCdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir,eventsEnabled:true}); const errors=[]; const failedRequests=[]; const checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  const cookies=fixture.cookie.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:fixture.origin,httpOnly:true,sameSite:'Lax'}});
  const tile=id=>page.locator(`[data-thing-id="${id}"]`).first();
  const open=async(view='grid',extra='')=>{await page.goto(`${fixture.origin}/things?view=${view}${extra}`,{waitUntil:'domcontentloaded'});await tile(fixture.folder.id).waitFor({timeout:90000});};
  const measure=async(name,fullPage=true)=>{
    await page.evaluate(async()=>{for(let y=0;y<Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,30))}scrollTo(0,document.documentElement.scrollHeight);await new Promise(r=>setTimeout(r,30))});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': viewport overflow');
    assert.equal(await page.locator('vite-error-overlay').count(),0,name+': framework overlay');
    if(fullPage) await page.screenshot({path:join(out,name+'.png'),fullPage:true});
    else {await page.screenshot({path:join(out,name+'-bottom.png'),fullPage:false});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(out,name+'.png'),fullPage:false});}
  };
  try {
    for(const url of ['http://1.1.1.1:80/',fixture.redirect]) {let denied=false;try{await page.goto(url,{timeout:4000})}catch(e){assert(/ERR_NETWORK_ACCESS_DENIED|ERR_ACCESS_DENIED/.test(e.message),e.message);denied=true}assert(denied,'OS browser network fence');}
    checks.push('browser direct-IP and redirect network denial');await context.addCookies(cookies);
    await open('grid');const treeNode=page.locator(`[data-tree-thing-id="${fixture.folder.id}"]`);await treeNode.getByRole('button').nth(1).click();await page.locator(`[data-tree-thing-id="${fixture.childFolder.id}"]`).waitFor();assert.equal(new URL(page.url()).pathname,'/things','Tree folder stays in browser');checks.push('tree folder click reveals child in place');
    for(const view of ['grid','list','columns']) {
      await open(view);assert((await page.title()).length>0,'Page title');
      const exact=await page.evaluate(async id=>(await fetch('/api/v1/things?id='+id)).json(),fixture.alpha.id);
      assert(JSON.stringify(exact).includes('Acceptance alpha'),'Exact API source matches rendered Thing');
      const folderBeforeModifiers=new URL(page.url()).searchParams.get('folder');await tile(fixture.alpha.id).click({modifiers:['Meta']});
      assert.equal(await tile(fixture.alpha.id).getByRole('checkbox',{name:'Select Acceptance alpha',exact:true}).isChecked(),true,'Cmd click selects');
      await tile(fixture.beta.id).click({modifiers:['Control']});
      assert.equal(await tile(fixture.beta.id).getByRole('checkbox',{name:'Select Acceptance beta',exact:true}).isChecked(),true,'Ctrl click selects');
      await tile(fixture.folder.id).click({modifiers:['Shift']});assert.equal(await tile(fixture.folder.id).getByRole('checkbox').isChecked(),true,'Shift click selects range endpoint');
      assert.equal(new URL(page.url()).searchParams.get('folder'),folderBeforeModifiers,'Modifier selection does not navigate');
      await tile(fixture.alpha.id).getByRole('checkbox').uncheck();
      assert.equal(await tile(fixture.alpha.id).getByRole('checkbox').isChecked(),false,'Checkbox toggles selection');
      await tile(fixture.alpha.id).getByRole('button',{name:'Acceptance alpha actions',exact:true}).focus();
      assert.equal(await tile(fixture.alpha.id).locator('.thing-item-controls').first().evaluate(el=>getComputedStyle(el).pointerEvents),'auto','Keyboard focus reveals item controls');
      await tile(fixture.alpha.id).getByRole('button',{name:'Acceptance alpha actions',exact:true}).press('ArrowDown');await page.getByRole('menu').last().waitFor();await page.keyboard.press('Escape');
      await tile(fixture.alpha.id).hover();
      await tile(fixture.alpha.id).getByRole('button',{name:'Acceptance alpha actions',exact:true}).click();
      await page.getByRole('menu').last().waitFor(); await measure(view+'-menu-desktop');await page.keyboard.press('Escape');
      await tile(fixture.alpha.id).click({button:'right'});await page.getByRole('menu').last().waitFor();await page.keyboard.press('Escape');
      const deviceCard=page.getByRole('button',{name:'Open Acceptance computer',exact:true});await deviceCard.waitFor();const beforeDeviceSelect=new URL(page.url()).search;
      await deviceCard.click({modifiers:['Meta']});assert.equal(await page.getByRole('checkbox',{name:'Select Acceptance computer',exact:true}).isChecked(),true,'Cmd click selects device');assert.equal(new URL(page.url()).search,beforeDeviceSelect,'Device modifier selection stays in view');
      const deviceCheckbox=page.getByRole('checkbox',{name:'Select Acceptance computer',exact:true});await deviceCheckbox.locator('xpath=..').click();assert.equal(await deviceCheckbox.isChecked(),false,'Device checkbox toggles selection');
      const deviceMenu=page.getByRole('button',{name:'Acceptance computer actions',exact:true});await deviceMenu.focus();await deviceMenu.press('Enter');await page.getByRole('menu').last().waitFor();await page.keyboard.press('Escape');
      await deviceCard.click({button:'right'});await page.getByRole('menu').last().waitFor();await page.keyboard.press('Escape');
      await deviceCard.click();await page.waitForURL(url=>url.searchParams.get('deviceFiles')===fixture.deviceId);checks.push(view+': device single-click opens its saved-files view; modifier, checkbox, keyboard, and context menus stay separate');
      await open(view);
      await tile(fixture.folder.id).click();
      await page.waitForURL(url=>url.searchParams.get('folder')===fixture.folder.id);
      await tile(fixture.nested.id).waitFor();if(view==='columns')await tile(fixture.folder.id).waitFor();checks.push(view+': single-click folder, Cmd/Ctrl, checkbox, ellipsis/right-click menus');
      await measure(view+'-folder-desktop');
    }
    for(const view of ['grid','list','columns']) {await open(view,'&display=preview');await measure(view+'-preview-desktop');await tile(fixture.folder.id).click();await page.waitForURL(url=>url.searchParams.get('folder')===fixture.folder.id);await tile(fixture.nested.id).waitFor();}checks.push('all three preview views preserve single-click folder navigation');
    await open('grid');await tile(fixture.alpha.id).getByTestId('thing-title-link').focus();await page.keyboard.press('Enter');await page.waitForURL(url=>url.pathname.includes(fixture.alpha.id));checks.push('keyboard Enter opens exact Thing');
    await open('grid');await tile(fixture.alpha.id).click();
    await page.waitForURL(url=>url.pathname.includes(fixture.alpha.id));checks.push('single-click data Thing opens exact detail');
    const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await touch.addCookies(cookies);page=await touch.newPage();const touchEmulation=await touch.newCDPSession(page);await touchEmulation.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});assert(await page.evaluate(()=>navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches),'Touch emulation prerequisite');page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
    const touchTargets={};
    for(const view of ['grid','list','columns']) {
      await open(view);await touchEmulation.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});assert(await page.evaluate(()=>navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches),'Touch emulation must persist after navigation');await measure(view+'-mobile',false);await touchEmulation.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});assert(await page.evaluate(()=>navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches),'Touch emulation restored after mobile screenshot');
      if(view==='grid')await writeFile(join(out,'touch-styles.json'),JSON.stringify(await tile(fixture.folder.id).evaluate(el=>({hover:matchMedia('(hover: none)').matches,coarse:matchMedia('(pointer: coarse)').matches,controls:[...el.querySelectorAll('.thing-item-controls')].map(control=>({opacity:getComputedStyle(control).opacity,pointerEvents:getComputedStyle(control).pointerEvents}))})),null,2));
      const touchCheckbox=await tile(fixture.folder.id).getByRole('checkbox').evaluate(el=>{const r=el.closest('label').getBoundingClientRect();return {width:r.width,height:r.height}});
      const touchMenu=await tile(fixture.folder.id).getByRole('button',{name:'Acceptance folder actions',exact:true}).boundingBox();
      const deviceCard=page.getByRole('button',{name:'Open Acceptance computer',exact:true});await deviceCard.waitFor();
      const deviceCheckbox=await page.getByRole('checkbox',{name:'Select Acceptance computer',exact:true}).evaluate(el=>{const r=el.closest('label').getBoundingClientRect();return {width:r.width,height:r.height}});
      const deviceMenu=await page.getByRole('button',{name:'Acceptance computer actions',exact:true}).boundingBox();
      touchTargets[view]={touchCheckbox,touchMenu,deviceCheckbox,deviceMenu,media:await page.evaluate(()=>({hoverNone:matchMedia('(hover: none)').matches,coarse:matchMedia('(pointer: coarse)').matches}))};await writeFile(join(out,'touch-targets.json'),JSON.stringify(touchTargets,null,2));
      for(const [name,box] of Object.entries({touchCheckbox,touchMenu,deviceCheckbox,deviceMenu}))assert(box.width>=44&&box.height>=44,name+': '+view+' touch target must be 44px');
      const folderBeforeControls=new URL(page.url()).search;await tile(fixture.folder.id).getByRole('button',{name:'Acceptance folder actions',exact:true}).click();await page.getByRole('menu').last().waitFor();await measure(view+'-mobile-menu',false);await touchEmulation.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await page.keyboard.press('Escape');
      const folderCheckbox=tile(fixture.folder.id).getByRole('checkbox');await folderCheckbox.locator('xpath=..').click();assert.equal(await folderCheckbox.isChecked(),true,'Touch checkbox toggles selection');assert.equal(new URL(page.url()).search,folderBeforeControls,'Touch checkbox does not navigate');await folderCheckbox.locator('xpath=..').click();
      await tile(fixture.folder.id).click();await page.waitForURL(url=>url.searchParams.get('folder')===fixture.folder.id);await tile(fixture.nested.id).waitFor();
    }
    await writeFile(join(out,'touch-targets.json'),JSON.stringify(touchTargets,null,2));checks.push('mobile grid/list/columns controls, targets, menus, folder navigation, and overflow');
    page=context.pages()[0];await page.setViewportSize({width:1440,height:1000});
    await open('grid','&files=thingtime');
    await tile(fixture.folder.id).click();await page.waitForURL(url=>url.searchParams.get('folder')===fixture.folder.id);
    await page.goto(`${fixture.origin}/things?view=grid&files=thingtime&folder=${fixture.folder.id}`,{waitUntil:'domcontentloaded'});await tile(fixture.file.id).waitFor({timeout:90000});
    const downloaded=page.waitForEvent('download');await tile(fixture.file.id).getByTestId('thing-title-link').click();const download=await downloaded;assert.equal(download.suggestedFilename(),'Acceptance file.txt');assert.equal(await readFile(await download.path(),'utf8'),'Thingtime single click acceptance file\n','Downloaded bytes match the independent upload source');
    await page.reload({waitUntil:'domcontentloaded'});await tile(fixture.file.id).waitFor({timeout:90000});
    const doubleDownloads=[];page.on('download',async d=>doubleDownloads.push({name:d.suggestedFilename(),path:await d.path()}));await page.evaluate(()=>{window.__ttClickDetails=[]});await tile(fixture.file.id).getByTestId('thing-title-link').evaluate(el=>el.addEventListener('click',event=>window.__ttClickDetails.push(event.detail),true));await tile(fixture.file.id).getByTestId('thing-title-link').dblclick({noWaitAfter:true});await page.waitForTimeout(1200);const clickDetails=await page.evaluate(()=>window.__ttClickDetails);await writeFile(join(out,'double-click-details.json'),JSON.stringify({clickDetails,downloadCount:doubleDownloads.length}));assert.equal(clickDetails[0],1,'Double-click gesture starts with one click');assert(clickDetails.length<=2,'At most one follow-up click is observed after the download begins');assert.equal(doubleDownloads.length,1,'Deliberate double-click produces exactly one file download');assert.equal(doubleDownloads[0].name,'Acceptance file.txt');assert.equal(await readFile(doubleDownloads[0].path,'utf8'),'Thingtime single click acceptance file\n');checks.push('files folder single-click navigation and exact single/double-click download behavior');
    await measure('files-desktop');
    assert.deepEqual(errors,[],'Uncaught browser errors');
    await writeFile(join(out,'browser-result.json'),JSON.stringify({ok:true,checks,errors,failedRequests,origin:fixture.origin,productionAccess:false},null,2));
    console.log(JSON.stringify({ok:true,checks,origin:fixture.origin,productionAccess:false}));
  } catch(e) {await page.screenshot({path:join(out,'failure.png'),fullPage:true});await writeFile(join(out,'browser-failure.json'),JSON.stringify({message:e.message,url:page.url(),errors,failedRequests},null,2));throw e;}
  finally {await browser.close();}
}
