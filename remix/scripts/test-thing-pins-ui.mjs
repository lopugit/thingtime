#!/usr/bin/env node
// Disposable real API acceptance with separate database, account and browser profile.
// Normal networking; no production credentials or application env files are loaded.
// Only replica-set initialization uses the Mongo driver; product data uses APIs.
// Prerequisite: npm --prefix remix run build:client and a node-server Nitro build.
// Set THING_PINS_EVIDENCE_DIR; optional PLAYWRIGHT_MODULE and
// CHROMIUM_EXECUTABLE choose an installed test runner/browser. The default
// mongod comes from PATH (THINGTIME_TEST_MONGOD may override it).
// THING_PINS_API_ONLY=1 skips browsers; THING_PINS_SKIP_API=1 reuses prior API evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-thing-pins-'));
const ports = { api: 19861, db: 19862, web: 19863, hmr: 19864 };
const origin = `http://127.0.0.1:${ports.api}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=thing_pins`;
const children = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const password = randomBytes(24).toString('hex');
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
  THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(dir, 'attachments'), TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
function start(executable,args,extra={}) {
  const child = spawn(executable,args, {cwd,detached:true,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
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
  for(const port of Object.values(ports)) { const listener=createServer(); await new Promise((r,j)=>{listener.once('error',j);listener.listen(port,'127.0.0.1',r)});await new Promise(r=>listener.close(r)); }
  await mkdir(join(dir,'db'));
  const db=database=start(process.env.THINGTIME_TEST_MONGOD || 'mongod',['--dbpath',join(dir,'db'),'--port',String(ports.db),'--bind_ip','127.0.0.1','--replSet','thing_pins','--nounixsocket']);
  const client=mongoClient=new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`,{serverSelectionTimeoutMS:1000});
  for(let n=0;;n++) { try{await client.connect();break}catch(e){if(n>20)throw e;await delay(300)} }
  await client.db('admin').command({replSetInitiate:{_id:'thing_pins',members:[{_id:0,host:`127.0.0.1:${ports.db}`}]}});
  for(let n=0;;n++){if((await client.db('admin').command({hello:1})).isWritablePrimary)break;if(n>100)throw Error('Replica not primary');await delay(200)}
  await client.close();
  server=start(process.execPath,['.output/server/index.mjs']); await ready(server);
  const manifest=(await api('/.well-known/thingtime-capabilities.json')).data;assert.equal(manifest.origin,origin);assert.equal(manifest.features['api.things-pins'].version,'1.0.0');
  const owner=await api('/api/v1/auth/register',{body:{username:'navigation-owner',email:'navigation-owner@example.invalid',password,displayName:'Navigation Owner'}});
  const other=await api('/api/v1/auth/register',{body:{username:'navigation-other',email:'navigation-other@example.invalid',password,displayName:'Navigation Other'}});
  await stop(server); env.ADMIN_USERNAMES='navigation-owner'; server=start(process.execPath,['.output/server/index.mjs']); await ready(server);
  await api('/api/v1/admin/rate-limits',{cookie:owner.cookie,body:{endpoints:{'things.write':{limit:10000,windowMs:60000,enabled:true},'things.read':{limit:10000,windowMs:60000,enabled:true}}}});
  const challenge=(await api('/api/v1/devices/pairing',{cookie:owner.cookie,body:{}})).data;
  const {privateKey,publicKey:key}=generateKeyPairSync('ed25519');const publicKey=key.export({type:'spki',format:'der'}).subarray(-32).toString('base64url');const nonce=randomBytes(32).toString('base64url'),credential='ttnode_'+randomBytes(32).toString('base64url');
  const prepared=(await api('/api/v1/devices/pairing/claim',{body:{op:'prepare',pairingSecret:challenge.pairing.pairingSecret,publicKey,nonce}})).data;
  const {pairingId,serverNonce}=prepared.proof;const device={name:'Synthetic Pin Device',platform:'macos',model:'Synthetic fixture',osVersion:'test',appVersion:'1.0.0'};
  const fields=['thingtime-device-pairing-claim-v1',pairingId,challenge.pairing.pairingSecret,credential,publicKey,nonce,serverNonce,device.name,device.platform,device.model,device.osVersion,device.appVersion,'0'];const bytes=Buffer.concat(fields.map(value=>{const data=Buffer.from(value,'utf8');return Buffer.concat([Buffer.from(data.length+':'),data]);}));
  const paired=(await api('/api/v1/devices/pairing/claim',{body:{op:'complete',pairingSecret:challenge.pairing.pairingSecret,credential,device,capabilities:[],proof:{pairingId,publicKey,nonce,serverNonce,signature:sign(null,bytes,privateKey).toString('base64url')}}})).data;const deviceId=paired.device.id;
  const cases=[];
  for (let i=0;i<8;i++) {
    cases.push((await api('/api/v1/things',{cookie:owner.cookie,body:{thingtime:['folder','builder-thing'],acl:['tt:all'],crystal:{name:i===1?'Hidden middle fixture':i>2?`Unpinned fixture ${i}`:`Visiblepin ${i}`,builderApp:true}}})).data.thing);
  }
  const evidenceDir=process.env.THING_PINS_EVIDENCE_DIR; assert(evidenceDir); await mkdir(evidenceDir,{recursive:true});
  await writeFile(join(evidenceDir,'manifest-receipt.json'),JSON.stringify({origin:manifest.origin,feature:'api.things-pins',version:manifest.features['api.things-pins'].version},null,2));
  const chat=(await api('/api/v1/chats',{cookie:owner.cookie,body:{chatType:'group',name:'Synthetic pin archive chat',memberIds:[]}})).data.chat;
  const privateBody='SYNTHETIC_PRIVATE_BODY_NO_PIN_DISCLOSURE';const message=(await api('/api/v1/chats/messages',{cookie:owner.cookie,body:{chatId:chat.id,text:privateBody}})).data.message;const protectedPath=['acceptance-protected'];
  await api('/api/v1/things/pins',{cookie:owner.cookie,status:404,body:{path:protectedPath,revision:'0',operation:'pin',thingId:message.id}});
  await api('/api/v1/things/actions',{cookie:owner.cookie,body:{id:message.id,action:'archive'}});
  await api('/api/v1/things/pins',{cookie:other.cookie,status:404,body:{path:protectedPath,revision:'0',operation:'pin',thingId:message.id}});
  await api('/api/v1/things/pins',{cookie:owner.cookie,body:{path:protectedPath,revision:'0',operation:'pin',thingId:message.id}});
  const protectedPins=(await api('/api/v1/things/pins?'+new URLSearchParams({path:JSON.stringify(protectedPath)}),{cookie:owner.cookie})).data;
  assert.equal(protectedPins.pins[0].thingId,message.id);assert.equal(protectedPins.pins[0].presentation.libraryArchivePresentation,'metadata');assert(!JSON.stringify(protectedPins).includes(privateBody),'pin read never discloses protected message body');
  await api('/api/v1/things/actions',{cookie:owner.cookie,body:{id:message.id,action:'restore'}});
  assert.equal((await api('/api/v1/things/pins?'+new URLSearchParams({path:JSON.stringify(protectedPath)}),{cookie:owner.cookie})).data.pins.length,0,'active protected message omitted');
  await writeFile(join(evidenceDir,'protected-receipt.json'),JSON.stringify({checks:['active protected owner pin denied','foreign archived target pin denied','own archived metadata pin/read accepted without body','restored active protected source omitted']},null,2));

  if(!process.env.THING_PINS_API_ONLY){
  const vite=start(process.execPath,['--input-type=module','-e',`import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`],{NODE_ENV:'development'});
  const webOrigin=`http://127.0.0.1:${ports.web}`; await ready(vite,webOrigin);
  await browserAcceptance({origin:webOrigin,cookie:owner.cookie,otherCookie:other.cookie,cases,apiOrigin:origin,deviceId},evidenceDir);
  }
  if(!process.env.THING_PINS_SKIP_API){
  const usage=async()=>(await api('/api/v1/auth/me',{cookie:other.cookie})).data.user.storage;
  const baseline=await usage();assert.equal(baseline.status,'ready');
  const billPath=['acceptance-accounting'];let billRevision='0';
  const bill=async(operation)=>{billRevision=(await api('/api/v1/things/pins',{cookie:other.cookie,body:{path:billPath,revision:billRevision,operation,thingId:cases[0].id}})).data.revision;return (await usage()).usedBytes;};
  const pinnedBytes=await bill('pin'),unpinnedBytes=await bill('unpin'),repinnedBytes=await bill('pin');
  assert(pinnedBytes>unpinnedBytes,'unpin refunds the billable pin row');assert(unpinnedBytes>baseline.usedBytes,'scope header remains billed after unpin');assert.equal(repinnedBytes,pinnedBytes,'repin reuses billed header without leaked accounting');
  await writeFile(join(evidenceDir,'accounting-receipt.json'),JSON.stringify({baseline:baseline.usedBytes,pinnedBytes,unpinnedBytes,repinnedBytes,checks:['header plus pin charged','unpin refunds only pin','retained header remains billed and reused']},null,2));
  const path=['acceptance-pagination']; let revision='0'; const allIds=[];
  for(let i=0;i<66;i++) {
    const item=(await api('/api/v1/things',{cookie:owner.cookie,body:{thingtime:['data'],acl:['tt:all'],crystal:{name:'Pagination '+i}}})).data.thing;
    allIds.push(item.id);
    revision=(await api('/api/v1/things/pins',{cookie:owner.cookie,body:{path,revision,operation:'pin',thingId:item.id}})).data.revision;
  }
  const readPins=async(cookie,scope=path)=>{let cursor,rev;const pins=[];let pages=0;do{const result=(await api('/api/v1/things/pins?'+new URLSearchParams({path:JSON.stringify(scope),...(cursor?{cursor,revision:rev}:{})}),{cookie})).data;rev=result.revision;cursor=result.nextCursor;pins.push(...result.pins);pages++;assert(pages<10);}while(cursor);return {revision:rev,pins:pins.sort((a,b)=>a.order-b.order),pages};};
  const saved=await readPins(owner.cookie);assert.deepEqual(saved.pins.map(p=>p.thingId),allIds);assert.equal(saved.pages,2);
  const race=await Promise.all(allIds.slice(0,2).map(thingId=>api('/api/v1/things/pins',{cookie:owner.cookie,status:null,body:{path,revision,operation:'unpin',thingId}})));
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  assert.equal((await readPins(owner.cookie,['acceptance-other-path'])).pins.length,0);
  await api('/api/v1/things/pins',{cookie:other.cookie,body:{path,revision:'0',operation:'pin',thingId:allIds[0]}});
  assert.deepEqual((await readPins(other.cookie)).pins.map(p=>p.thingId),[allIds[0]]);
  assert.equal((await readPins(owner.cookie)).pins.length,65);
  await api('/api/v1/things/update',{cookie:owner.cookie,body:{id:allIds[0],acl:['tt:owner']}});assert.equal((await readPins(other.cookie)).pins.length,0,'revoked target omitted without disclosure');
  await api('/api/v1/things/update',{cookie:owner.cookie,body:{id:allIds[0],acl:['tt:all']}});assert.deepEqual((await readPins(other.cookie)).pins.map(p=>p.thingId),[allIds[0]],'regranted target recovers original private pin');
  await api('/api/v1/things/pins?'+new URLSearchParams({path:JSON.stringify(path),cursor:'invalid',revision}),{cookie:owner.cookie,status:400});assert.equal((await readPins(owner.cookie)).pins.length,65,'valid read recovers after invalid cursor refusal');
  await writeFile(join(evidenceDir,'api-receipt.json'),JSON.stringify({checks:['66 persisted pins through two real GET pages retain order','concurrent same-revision mutations produce one success and one 409','same target across independent account and path','target ACL revoke hides pin and regrant restores it','invalid cursor refusal followed by successful valid read'],count:66},null,2));

  }
} catch(error) {
  console.error(error.stack);
  await mkdir(process.env.THING_PINS_EVIDENCE_DIR || dir,{recursive:true});
  if(database) await writeFile(join(process.env.THING_PINS_EVIDENCE_DIR || dir,'db.log'),database.log(),{mode:0o600});
  if(server) await writeFile(join(process.env.THING_PINS_EVIDENCE_DIR || dir,'server.log'),server.log(),{mode:0o600});
  process.exitCode=1;
} finally {
  await mongoClient?.close();
  for(const child of children.reverse()) await stop({child});
  await rm(dir,{recursive:true,force:true});
}

async function browserAcceptance(fixture,out){
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
 const cookies=value=>value.split('; ').map(pair=>{let i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:fixture.origin,httpOnly:true,sameSite:'Lax'}});
 await context.addCookies(cookies(fixture.cookie)); const page=await context.newPage(); const errors=[],checks=[];let pendingPins=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/v1/things/pins')pendingPins++});page.on('requestfinished',r=>{if(new URL(r.url()).pathname==='/api/v1/things/pins')pendingPins--});page.on('requestfailed',r=>{if(new URL(r.url()).pathname==='/api/v1/things/pins')pendingPins--});page.on('pageerror',e=>errors.push(e.message));
 const tile=id=>page.locator(`[data-thing-id="${id}"]`).first();
 try {
   await page.goto(fixture.origin+'/things?view=grid'); await tile(fixture.cases[0].id).waitFor({timeout:90000});
   await page.screenshot({path:join(out,'initial.png'),fullPage:true});
   const ids=fixture.cases.map(t=>t.id);
   const pinIds=()=>page.locator('[data-pin-surface]').first().locator('[data-pin-id]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.pinId))]);
   const goto=async(path,id=ids[0])=>{await page.goto(fixture.origin+path);await tile(id).waitFor({timeout:90000});};
   const menu=async(id)=>{await tile(id).hover();await tile(id).getByRole('button',{name:/actions$/}).click();await page.getByRole('menuitem').first().waitFor();};
   const waitPins=async(expected)=>{await page.waitForFunction(expected=>{const surface=document.querySelector('[data-pin-surface]');return JSON.stringify(surface?[...new Set([...surface.querySelectorAll('[data-pin-id]')].map(n=>n.dataset.pinId))]:[])===JSON.stringify(expected)},expected);for(let n=0;pendingPins&&n<300;n++)await delay(100);assert.equal(pendingPins,0,'pin request completes');};
   for(const id of ids.slice(0,3)){await menu(id);await page.getByRole('menuitem',{name:/Pin/}).click();}
   await waitPins(ids.slice(0,3)); checks.push('three menu pin writes render in insertion order');
   await page.reload(); await waitPins(ids.slice(0,3)); checks.push('pin order persists after reload');
   await page.getByRole('heading',{name:'Things',exact:true}).click();await page.keyboard.press('Meta+a');
   for(const id of ids.slice(0,3))assert.equal(await tile(id).getByRole('checkbox').isChecked(),true,'Cmd+A includes pinned '+id);
   await page.keyboard.press('Escape');checks.push('Cmd+A includes pinned entries');

   for(const view of ['grid','list','columns']){
     await goto('/things?view='+view+'&sort=name-desc&group=kind'); await waitPins(ids.slice(0,3));
     await page.screenshot({path:join(out,'desktop-'+view+'.png'),fullPage:true});
   }
   checks.push('grid, list, columns, grouping and sorting retain scope/order');
   await goto('/things?view=list&q=Visiblepin%202',ids[2]);await page.waitForTimeout(400);assert((await pinIds()).includes(ids[2]),'filtered pin remains');
   await goto('/things?view=grid&q=Visiblepin');await waitPins([ids[0],ids[2]]);
   await page.getByRole('heading',{name:'Things',exact:true}).click();await page.keyboard.press('Meta+a');for(const id of [ids[0],ids[2]])assert(await tile(id).getByRole('checkbox').isChecked(),'all-pinned filtered Cmd+A');await page.keyboard.press('Escape');checks.push('Cmd+A works when every visible item is pinned');
   await menu(ids[0]);await page.getByRole('menuitem',{name:/Reorder pins/}).click();
   await page.getByRole('button',{name:/Drag Visiblepin 0 to reorder pins/}).press('End');await waitPins([ids[2],ids[0]]);
   await page.getByRole('button',{name:'Done',exact:true}).click();
   await goto('/things?view=grid');await waitPins([ids[2],ids[1],ids[0]]);
   await menu(ids[0]);await page.getByRole('menuitem',{name:/Reorder pins/}).click();await page.getByRole('button',{name:/Drag Visiblepin 0 to reorder pins/}).press('Home');await waitPins([ids[0],ids[2],ids[1]]);
   await page.getByRole('button',{name:/Drag Hidden middle fixture to reorder pins/}).press('ArrowLeft');await waitPins(ids.slice(0,3));await page.getByRole('button',{name:'Done',exact:true}).click();
   checks.push('filtered reorder preserves hidden middle pin slot');
   await goto('/builder?view=grid'); assert.deepEqual(await pinIds(),[],'Builder root has independent pins');
   await menu(ids[0]);await page.getByRole('menuitem',{name:/Pin/}).click();await waitPins([ids[0]]);
   for(const [parent,target] of [[ids[4],ids[0]],[ids[5],ids[2]]]){
     const saved=await page.evaluate(async({parent,target})=>(await fetch('/api/v1/things/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:['/things',parent],revision:'0',operation:'pin',thingId:target})})).json(),{parent,target});assert(saved.ok);
     await goto('/things?folder='+parent,target);await waitPins([target]);await page.reload();await waitPins([target]);
   }
   checks.push('independent parent paths hydrate exact pinned Things outside current folder and persist');
   await goto('/things?files=thingtime');
   await menu(ids[0]);await page.getByRole('menuitem',{name:/Pin/}).click();
   await menu(ids[2]);await page.getByRole('menuitem',{name:/Pin/}).click();
   await page.getByRole('button',{name:'Reorder pins',exact:true}).click();await page.getByRole('button',{name:/Drag Visiblepin 0 to reorder pins/}).press('End');
   await page.getByRole('button',{name:'Done',exact:true}).click();for(let n=0;pendingPins&&n<300;n++)await delay(100);await page.reload();
   await tile(ids[0]).getByLabel('Pinned here').waitFor();
   const cloudOrder=await page.locator('[data-pin-surface] [data-thing-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.thingId));assert.deepEqual(cloudOrder.slice(0,2),[ids[2],ids[0]]);
   await page.getByRole('combobox',{name:'File view',exact:true}).selectOption('list');await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'cloud-files-mobile-list.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000});
   checks.push('stored cloud folder pins have independent scope, reorder/reload and mobile list');
   await goto('/things?view=grid'); await waitPins(ids.slice(0,3));checks.push('same Thing independently pinned in Things and Builder');
   await menu(ids[0]);await page.getByRole('menuitem',{name:/Reorder pins/}).click();
   const handle=id=>page.locator(`[data-pin-surface] [data-pin-id="${id}"]`).first().getByRole('button',{name:/^Drag/});
   await handle(ids[0]).focus();await page.keyboard.press('End');await waitPins([ids[1],ids[2],ids[0]]);
   await handle(ids[0]).press('Home');await waitPins(ids.slice(0,3));
   checks.push('keyboard Home and End reorder');
   const first=await handle(ids[0]).boundingBox(),last=await handle(ids[2]).boundingBox(); assert(first&&last);
   await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:12});await page.mouse.up();
   assert.notDeepEqual(await pinIds(),ids.slice(0,3),'pointer drag changes order');checks.push('pointer drag reorder');
   const afterPointer=await pinIds();await waitPins(afterPointer);await page.getByRole('button',{name:'Done',exact:true}).click();await page.reload();await waitPins(afterPointer);checks.push('reorder persists through reload');
   await page.setViewportSize({width:390,height:844});await waitPins(afterPointer);
   await menu(ids[0]);await page.getByRole('menuitem',{name:/Reorder pins/}).click();
   const earlier=page.getByRole('button',{name:/^Move .* earlier$/}).last();await earlier.tap();
   assert.notDeepEqual(await pinIds(),afterPointer,'touch earlier control changes order');await waitPins(await pinIds());checks.push('mobile touch reorder');
   await page.screenshot({path:join(out,'mobile-reorder.png'),fullPage:true});await page.getByRole('button',{name:'Done',exact:true}).click();
   for(const width of [390,1440]){await page.setViewportSize({width,height:width===390?844:1000});for(const view of ['grid','list','columns']){
     await goto('/things?view='+view);await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=500){scrollTo(0,y);await new Promise(r=>setTimeout(r,15))}scrollTo(0,0)});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+width+' '+view);await menu(ids[3]);await page.screenshot({path:join(out,`${width}-${view}-menu.png`),fullPage:true});await page.keyboard.press('Escape');
   }} checks.push('desktop/mobile all views scroll top-bottom and opened menus without overflow');
   const beforeDevice=await pinIds();await page.getByRole('button',{name:'Synthetic Pin Device actions',exact:true}).click();await page.getByRole('menuitem',{name:/Pin/}).click();await waitPins([...beforeDevice,fixture.deviceId]);
   await page.getByRole('button',{name:'Synthetic Pin Device actions',exact:true}).click();await page.getByRole('menuitem',{name:/Reorder pins/}).click();await page.getByRole('button',{name:'Drag Synthetic Pin Device to reorder pins',exact:true}).press('Home');await waitPins([fixture.deviceId,...beforeDevice]);await page.getByRole('button',{name:'Done',exact:true}).click();await page.reload();await waitPins([fixture.deviceId,...beforeDevice]);
   await page.screenshot({path:join(out,'device-mixed-pins-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'device-mixed-pins-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000});
   await page.getByRole('button',{name:'Synthetic Pin Device actions',exact:true}).click();await page.getByRole('menuitem',{name:/Unpin/}).click();await waitPins(beforeDevice);checks.push('real synthetic signed device pairing, mixed Thing/device pin/reorder/reload and desktop/mobile');
   await menu(ids[0]);await page.getByRole('menuitem',{name:/Unpin/}).click();assert(!(await pinIds()).includes(ids[0]));checks.push('unpin removes only selected entry');
   await context.clearCookies();await context.addCookies(cookies(fixture.otherCookie));await page.reload();await tile(ids[0]).waitFor();assert.deepEqual(await pinIds(),[],'independent account sees no owner pins');checks.push('independent account pins isolated');
   assert.deepEqual(errors,[]);
   await writeFile(join(out,'receipt.json'),JSON.stringify({checks,errors},null,2));
 } catch(error) {await page.screenshot({path:join(out,'failure.png'),fullPage:true});await writeFile(join(out,'browser-failure.json'),JSON.stringify({error:error.stack,errors,checks,url:page.url(),text:await page.locator('body').innerText()},null,2));throw error;}
 finally {await context.close();await browser.close();}
}
