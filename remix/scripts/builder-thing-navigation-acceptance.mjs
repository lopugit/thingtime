#!/usr/bin/env node
// Disposable real API acceptance with separate database, account and browser profile.
// Normal networking; no production credentials or application env files are loaded.
// Only replica-set initialization uses the Mongo driver; product data uses APIs.
// Prerequisite: npm --prefix remix run build:client and a node-server Nitro build.
// Set BUILDER_NAVIGATION_EVIDENCE_DIR; optional PLAYWRIGHT_MODULE and
// CHROMIUM_EXECUTABLE choose an installed test runner/browser. The default
// mongod comes from PATH (THINGTIME_TEST_MONGOD may override it).
// BUILDER_NAVIGATION_SUPPLEMENTAL=1 runs only UI creation and final menu checks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
if (process.argv.includes('--browser-worker')) { await browserAcceptance(); process.exit(); }
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-builder-navigation-'));
const ports = { api: 19651, db: 19652, web: 19653, hmr: 19654 };
const origin = `http://127.0.0.1:${ports.api}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=builder_navigation`;
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
  const db=database=start(process.env.THINGTIME_TEST_MONGOD || 'mongod',['--dbpath',join(dir,'db'),'--port',String(ports.db),'--bind_ip','127.0.0.1','--replSet','builder_navigation','--nounixsocket']);
  const client=mongoClient=new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`,{serverSelectionTimeoutMS:1000});
  for(let n=0;;n++) { try{await client.connect();break}catch(e){if(n>20)throw e;await delay(300)} }
  await client.db('admin').command({replSetInitiate:{_id:'builder_navigation',members:[{_id:0,host:`127.0.0.1:${ports.db}`}]}});
  for(let n=0;;n++){if((await client.db('admin').command({hello:1})).isWritablePrimary)break;if(n>100)throw Error('Replica not primary');await delay(200)}
  await client.close();
  server=start(process.execPath,['.output/server/index.mjs']); await ready(server);
  const owner=await api('/api/v1/auth/register',{body:{username:'navigation-owner',email:'navigation-owner@example.invalid',password,displayName:'Navigation Owner'}});
  const other=await api('/api/v1/auth/register',{body:{username:'navigation-other',email:'navigation-other@example.invalid',password,displayName:'Navigation Other'}});
  const cases=[];
  for(const [kind,marked,crystal] of [
    ['webpage',true,{name:'Navigation Page',blocks:[{id:'heading',type:'text',text:'Independent live page source'}]}],
    ['component',true,{name:'Navigation Component',componentKey:'navigation-component',render:{tag:'div',children:['Component source']}}],
    ['action',true,{name:'Navigation Action',actionKey:'navigation-action',steps:[{op:'return',value:'Action source'}]}],
    ['schema',true,{name:'Navigation Schema',fields:[{name:'name',type:'string',required:true}]}],
    ['data',true,{name:'Navigation Builder Data',text:'Editable Builder data'}],
    ['folder',true,{name:'Navigation App',builderApp:true,description:'Editable app'}],
    ['data',false,{name:'Navigation Ordinary Data',text:'Ordinary data'}]
  ]){
    const automatic=['webpage','component','action','schema'].includes(kind);
    const result=await api('/api/v1/things',{cookie:owner.cookie,body:{thingtime:automatic||!marked?[kind]:[kind,'builder-thing'],acl:['tt:all'],crystal}});
    const thing=result.data.thing;
    assert.equal(thing.thingtime.includes('builder-thing'),marked,'Saved marker for '+kind);
    const saved=(await api('/api/v1/things?id='+thing.id,{cookie:owner.cookie})).data.thing;
    assert.deepEqual(saved.thingtime,thing.thingtime,'Exact marker readback');
    cases.push({...saved,marked,kind});
  }
  const legacy=(await api('/api/v1/things',{cookie:owner.cookie,body:{thingtime:['data'],crystal:{name:'Legacy migration data'}}})).data.thing;
  await api('/api/v1/things/update',{cookie:owner.cookie,body:{id:legacy.id,thingtime:['data','builder-thing'],crystal:{name:'Legacy migration data updated'}}});
  const migrated=(await api('/api/v1/things?id='+legacy.id,{cookie:owner.cookie})).data.thing;
  assert(migrated.thingtime.includes('builder-thing'),'POST update alias retains explicit Builder marker');
  const denied=await api('/api/v1/things/update',{cookie:owner.cookie,body:{id:legacy.id,thingtime:['schema'],crystal:{name:'Invalid kind change'}},status:null});
  assert(denied.status>=400,'Update alias refuses content-kind change');
  const capabilities=(await (await fetch(origin+'/.well-known/thingtime-capabilities.json')).json()).features;
  assert.equal(capabilities['api.things'].version,'1.46.0');assert.equal(capabilities['api.things-update'].version,'1.15.0');
  const evidenceDir=process.env.BUILDER_NAVIGATION_EVIDENCE_DIR;assert(evidenceDir);await mkdir(evidenceDir,{recursive:true});
  await writeFile(join(evidenceDir,'api-readback.json'),JSON.stringify(cases.map(({id,thingtime,crystal,marked,kind})=>({id,thingtime,name:crystal.name,marked,kind})),null,2));
  const vite=start(process.execPath,['--input-type=module','-e',`import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`],{NODE_ENV:'development'});
  const webOrigin=`http://127.0.0.1:${ports.web}`;await ready(vite,webOrigin);
  const fixture=join(dir,'browser-fixture.json');
  await writeFile(fixture,JSON.stringify({origin:webOrigin,cookie:owner.cookie,otherCookie:other.cookie,cases}),{mode:0o600});
  const ui=start(process.execPath,['scripts/builder-thing-navigation-acceptance.mjs','--browser-worker',fixture],{PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE,CHROMIUM_EXECUTABLE:process.env.CHROMIUM_EXECUTABLE,BUILDER_NAVIGATION_EVIDENCE_DIR:evidenceDir,BUILDER_NAVIGATION_SUPPLEMENTAL:process.env.BUILDER_NAVIGATION_SUPPLEMENTAL});
  const timeout=setTimeout(()=>{try{process.kill(-ui.child.pid,'SIGTERM')}catch{}},600000);
  const result=await once(ui.child,'exit');clearTimeout(timeout);assert.equal(result[0],0,ui.log());console.log(ui.log());
} catch(error) {
  console.error(error.message);
  await mkdir(process.env.BUILDER_NAVIGATION_EVIDENCE_DIR || dir,{recursive:true});
  if(database) await writeFile(join(process.env.BUILDER_NAVIGATION_EVIDENCE_DIR || dir,'builder-navigation-db.log'),database.log(),{mode:0o600});
  if(server) await writeFile(join(process.env.BUILDER_NAVIGATION_EVIDENCE_DIR || dir,'builder-navigation-server.log'),server.log(),{mode:0o600});
  process.exitCode=1;
} finally {
  await mongoClient?.close();
  for(const child of children.reverse()) await stop({child});
  await rm(dir,{recursive:true,force:true});
}

async function browserAcceptance(){
 const {readFile}=await import('node:fs/promises');const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const fixture=JSON.parse(await readFile(process.argv.at(-1),'utf8'));const out=process.env.BUILDER_NAVIGATION_EVIDENCE_DIR;
 await rm(join(out,'browser-failure.json'),{force:true});await rm(join(out,'failure.png'),{force:true});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
 const cookies=value=>value.split('; ').map(pair=>{let i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:fixture.origin,httpOnly:true,sameSite:'Lax'}});
 await context.addCookies(cookies(fixture.cookie));const page=await context.newPage();const errors=[],checks=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>requests.push({url:r.url(),error:r.failure()?.errorText}));
 const tile=id=>page.locator(`[data-thing-id="${id}"]`).first();
 const open=async(view='grid')=>{await page.goto(fixture.origin+'/things?view='+view,{waitUntil:'domcontentloaded'});await tile(fixture.cases[0].id).waitFor({timeout:90000})};
 const measure=async name=>{await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,20))}scrollTo(0,document.documentElement.scrollHeight)});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');await page.screenshot({path:join(out,name+'.png'),fullPage:true})};
 try{
 const uiCreated=[];
 await page.goto(fixture.origin+'/builder');await page.getByRole('button',{name:'New app',exact:true}).click();const appDialog=page.getByRole('dialog');await appDialog.getByLabel(/^Name/).fill('UI Created Navigation App');
 const appResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/things'&&r.request().method()==='POST');await appDialog.getByRole('button',{name:'Save app',exact:true}).click();const appCreated=(await (await appResponse).json()).thing;assert(appCreated.thingtime.includes('builder-thing'));uiCreated.push(appCreated.id);await appDialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('menuitem',{name:'New data thing'}).click();await page.waitForURL(u=>u.pathname==='/schemas');
 const schema=fixture.cases.find(t=>t.kind==='schema');await page.goto(fixture.origin+'/schemas/'+schema.id);const form=page.getByTestId('schema-detail-form');await form.getByRole('textbox').first().fill('UI Created Navigation Data');
 const dataResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/things'&&r.request().method()==='POST');await form.getByRole('button',{name:'Create thing',exact:true}).click();const dataCreated=(await (await dataResponse).json()).thing;assert(dataCreated.thingtime.includes('builder-thing'));uiCreated.push(dataCreated.id);
 for(const id of uiCreated){const saved=await page.evaluate(async id=>(await fetch('/api/v1/things?id='+id)).json(),id);assert(saved.thing.thingtime.includes('builder-thing'));}await writeFile(join(out,'ui-created-readback.json'),JSON.stringify({ids:uiCreated,markerRetained:true},null,2));checks.push('Builder New app and New data thing UI creation exact marker readback');
 for(const width of (process.env.BUILDER_NAVIGATION_SUPPLEMENTAL==='1'?[]:[1440,390])){

  await page.setViewportSize({width,height:width===390?844:1000});
  for(const view of ['grid','list','columns']){
   for(const thing of fixture.cases){
    await open(view);const card=tile(thing.id);await card.waitFor();
    const link=card.getByTestId('thing-title-link');const href=await link.getAttribute('href');
    assert.equal(href.startsWith('/builder'),thing.marked,'Owner title destination '+thing.kind);
    await card.getByRole('button',{name:thing.crystal.name+' actions',exact:true}).click();
    const menu=page.getByRole('menu').last();await menu.waitFor();
    assert.equal(await menu.getByText('Open in Builder',{exact:true}).count(),thing.marked?1:0,'Builder menu '+thing.kind);
    assert.equal(await menu.getByText('Open live page',{exact:true}).count(),['webpage','component','action','schema'].includes(thing.kind)?1:0,'Live menu '+thing.kind);
    if(thing.kind==='webpage'){const live=menu.getByText('Open live page',{exact:true});await live.click();await page.waitForURL(u=>u.pathname.startsWith('/p/'));await page.getByText('Independent live page source',{exact:true}).waitFor();checks.push(width+' '+view+' live webpage source');await open(view);await tile(thing.id).getByRole('button',{name:thing.crystal.name+' actions',exact:true}).click();}
    await measure(width+'-'+view+'-'+thing.kind+(thing.marked?'':'-ordinary')+'-menu');await page.keyboard.press('Escape');
    await tile(thing.id).getByTestId('thing-title-link').click();await page.waitForURL(u=>thing.marked?u.pathname==='/builder':u.pathname.startsWith('/thing/'));
    if(thing.marked&&thing.kind!=='folder'&&thing.kind!=='webpage')await page.getByRole('dialog').waitFor({timeout:30000});
    await measure(width+'-'+view+'-'+thing.kind+(thing.marked?'':'-ordinary')+'-opened');checks.push(width+' '+view+' '+thing.kind+' owner navigation/menu');
   }
  }
 }
 if(process.env.BUILDER_NAVIGATION_SUPPLEMENTAL==='1'){
  await page.setViewportSize({width:390,height:844});await open();const example=fixture.cases.find(t=>t.kind==='webpage');await tile(example.id).getByRole('button',{name:example.crystal.name+' actions',exact:true}).tap();const menu=page.getByRole('menu').last();await menu.waitFor();
  await menu.getByText('Open in Builder',{exact:true}).scrollIntoViewIfNeeded();await menu.getByText('Open live page',{exact:true}).scrollIntoViewIfNeeded();await menu.getByText('Open live page',{exact:true}).waitFor();const bounds=await menu.boundingBox();assert(bounds&&bounds.y>=0&&bounds.y+bounds.height<=844+1,'Mobile menu stays within viewport');
  const topAction=menu.getByText('Open Thing',{exact:true});await topAction.scrollIntoViewIfNeeded();await topAction.waitFor();await menu.getByText('Open in Builder',{exact:true}).scrollIntoViewIfNeeded();const icons=await menu.locator('svg.lucide-blocks,svg.lucide-globe').count();const menuText=await menu.innerText();assert(icons>=2||(menuText.includes('🧱')&&menuText.includes('🌐')),'Shared Builder/live icons rendered in active theme language');await page.screenshot({path:join(out,'mobile-menu-final-icons.png')});checks.push('Mobile menu scroll exposes Builder/live actions with shared theme Builder/live icons');await menu.getByRole('menuitem',{name:/Open in Builder/}).focus();await page.keyboard.press('Enter');await page.waitForURL(u=>u.pathname==='/builder'&&u.searchParams.get('page')===example.id);checks.push('Keyboard Enter activates Open in Builder exact saved page');
  await writeFile(join(out,'browser-result.json'),JSON.stringify({ok:true,checks,errors,origin:fixture.origin},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,out}));return;
 }
 const editable=fixture.cases.find(t=>t.kind==='data'&&t.marked);await open();await tile(editable.id).getByTestId('thing-title-link').click();await page.waitForURL(u=>u.pathname==='/builder');
 await page.getByRole('dialog').getByRole('button',{name:'Source',exact:true}).click();
 await page.getByLabel('Definition source').fill(JSON.stringify({...editable.crystal,text:'Saved through opened Builder definition'}));
 await page.getByRole('button',{name:'Save definition',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden',timeout:60000});
 const edited=await page.evaluate(async id=>(await fetch('/api/v1/things?id='+id)).json(),editable.id);assert.equal(edited.thing.crystal.text,'Saved through opened Builder definition');assert(edited.thing.thingtime.includes('builder-thing'));
 await page.goto(fixture.origin+'/builder?thing='+editable.id);await page.getByRole('dialog').getByRole('button',{name:'Source',exact:true}).click();assert((await page.getByLabel('Definition source').inputValue()).includes('Saved through opened Builder definition'));checks.push('Builder source edit saves, exact readback retains marker, reload restores edit');
 await page.goto(fixture.origin+'/thing/'+editable.id);const persistedOwner=page.getByRole('button',{name:'Thing actions',exact:true});await persistedOwner.waitFor();await persistedOwner.focus();await persistedOwner.press('ArrowDown');await page.getByRole('menu').last().getByText('Open in Builder',{exact:true}).waitFor();await page.keyboard.press('Escape');checks.push('shared persisted menu exposes owned Builder route and keyboard ArrowDown/Escape');
 await context.clearCookies();await context.addCookies(cookies(fixture.otherCookie));

 const shared=fixture.cases.find(t=>t.kind==='component');await page.goto(fixture.origin+'/thing/'+shared.id);const persisted=page.getByRole('button',{name:'Thing actions',exact:true});await persisted.waitFor();await persisted.click();const sharedMenu=page.getByRole('menu').last();await sharedMenu.waitFor();assert.equal(await sharedMenu.getByText('Open in Builder',{exact:true}).count(),0);await sharedMenu.getByText('Open live page',{exact:true}).waitFor();await measure('nonowner-persisted-menu');await page.keyboard.press('Escape');
 for(const thing of fixture.cases.filter(t=>t.marked&&t.kind!=='folder')){
   await page.goto(fixture.origin+'/builder?thing='+thing.id,{waitUntil:'domcontentloaded'});const dialog=page.getByRole('dialog');await dialog.getByText('Save a private copy before editing this definition.',{exact:true}).waitFor({timeout:30000});assert(await dialog.getByRole('button',{name:'Save definition',exact:true}).isDisabled(),'Nonowner editor cannot save');
 }checks.push('nonowner public Things retain viewer navigation and hide Builder editing');assert.deepEqual(errors,[],'Uncaught browser errors');
 await writeFile(join(out,'browser-result.json'),JSON.stringify({ok:true,checks,errors,origin:fixture.origin,accountData:'disposable isolated replica'},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,out}));
 }catch(e){await page.screenshot({path:join(out,'failure.png'),fullPage:true});await writeFile(join(out,'browser-failure.json'),JSON.stringify({message:e.message,url:page.url(),errors,requests,body:(await page.locator('body').innerText()).slice(0,4000)},null,2));throw e}finally{await browser.close()}
}
