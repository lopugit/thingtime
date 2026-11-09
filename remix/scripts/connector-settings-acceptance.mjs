#!/usr/bin/env node
// Disposable browser and API acceptance: start an isolated replica set and
// Node Nitro server, render the real Vite Settings page in a fresh Chrome
// profile, and exercise real preferences and private Builder layout storage.
// Prerequisite: NITRO_PRESET=node-server npm --prefix remix run build:server.
// Required CONNECTOR_SETTINGS_EVIDENCE_DIR; optional PLAYWRIGHT_MODULE,
// CHROMIUM_EXECUTABLE, and THINGTIME_TEST_MONGOD. No app .env files are loaded.
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { MongoClient } = require('mongodb');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.CONNECTOR_SETTINGS_EVIDENCE_DIR) throw new Error('Set CONNECTOR_SETTINGS_EVIDENCE_DIR to a private artifact directory.');
const evidence = resolve(process.env.CONNECTOR_SETTINGS_EVIDENCE_DIR);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const dir = await mkdtemp(join(tmpdir(), 'tt-connector-settings-'));
const ports = { web: 19501, api: 19502, db: 19503, hmr: 19504 };
const origin = `http://127.0.0.1:${ports.web}`;
const api = `http://127.0.0.1:${ports.api}`;
const manifestPath = '/.well-known/thingtime-capabilities.json';
const settingsPath = '/api/v1/settings/connector-protections';
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'development', TT_WEB_PORT: String(ports.web),
  HOST:'127.0.0.1',PORT:String(ports.api),TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr), MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=connector_protections`,
  THINGTIME_DATA_ENV: 'development', JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(dir,'attachments') };
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(command,args,name) {
  const proc=spawn(command,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
  let log=''; proc.stdout.on('data',v=>log=(log+v).replace(/token=[^\s]+/g,'token=<redacted>').slice(-25000)); proc.stderr.on('data',v=>log=(log+v).replace(/token=[^\s]+/g,'token=<redacted>').slice(-25000));
  children.push({proc,name,logs:()=>log});
  return proc;
}
async function send(base,path,{cookie,bearer,expected,body,status=200}={}) {
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),
    ...(expected?{'X-Thingtime-Expected-Actor':expected}:{}),...(body?{'Content-Type':'application/json',Origin:base}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,status,path);
  return { value:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ') };
}
const cookies=cookie=>cookie.split('; ').filter(Boolean).map(pair=>{const i=pair.indexOf('='); return {name:pair.slice(0,i),value:pair.slice(i+1),url:origin,httpOnly:true,sameSite:'Lax'}});
let browser;
let client;
try {
  for (const port of Object.values(ports)) {
    const listener=createServer(); await new Promise((ok,fail)=>{listener.once('error',fail);listener.listen(port,'127.0.0.1',ok)}); await new Promise(ok=>listener.close(ok));
  }
  await mkdir(join(dir,'db'),{recursive:true});
  start(process.env.THINGTIME_TEST_MONGOD || 'mongod',['--dbpath',join(dir,'db'),'--port',String(ports.db),'--bind_ip','127.0.0.1','--replSet','connector_protections','--nounixsocket'],'mongo');
  client=new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`,{serverSelectionTimeoutMS:700});
  for(let i=0;;i++) { try{await client.connect();break}catch(e){if(i>=15)throw e;await delay(300)} }
  await client.db('admin').command({replSetInitiate:{_id:'connector_protections',members:[{_id:0,host:`127.0.0.1:${ports.db}`}]}});
  for(let i=0;;i++) { if((await client.db('admin').command({hello:1})).isWritablePrimary)break;if(i>=80)throw Error('Replica not ready');await delay(250) }
  await client.close();
  console.log('Disposable replica set ready.');
  const nitro=start(process.execPath,['.output/server/index.mjs'],'nitro');
  const vite=start(process.execPath,['--input-type=module','-e',`import {createServer} from 'vite';const server=await createServer({envDir:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`],'vite');
  for(let i=0;;i++) {
    try {
      const result=await send(origin,manifestPath);
      assert.equal(result.value.origin,origin);
      assert.equal(result.value.features['api.settings-connector-protections'].version,'1.0.0');
      break;
    } catch(e) {if(i>=150||nitro.exitCode!==null||vite.exitCode!==null)throw e;await delay(300)}
  }
  console.log('Vite and Nitro manifest ready.');
  const register=async label=>send(api,'/api/v1/auth/register',{body:{username:'cp'+label+randomBytes(4).toString('hex'),email:`cp${label}${randomBytes(4).toString('hex')}@example.invalid`,password:randomBytes(20).toString('hex')}});
  const first=await register('first');
  const second=await register('second');
  const firstSettings=await send(api,settingsPath,{cookie:first.cookie});
  const secondSettings=await send(api,settingsPath,{cookie:second.cookie});
  const id=firstSettings.value.accountId;
  assert.notEqual(id,secondSettings.value.accountId);
  await send(api,settingsPath,{status:401});
  await send(api,settingsPath,{cookie:second.cookie,expected:id,body:{confirmations:{create:false}},status:409});
  await Promise.all(['delete','reaction'].map(key=>send(api,settingsPath,{cookie:first.cookie,expected:id,body:{confirmations:{[key]:false}}})));
  const merged=(await send(api,settingsPath,{cookie:first.cookie})).value.confirmations;
  assert.equal(merged.delete,false);assert.equal(merged.reaction,false);
  await send(api,settingsPath,{cookie:first.cookie,expected:id,body:{confirmations:{delete:true,reaction:true}}});
  browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
  const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
  const page=await context.newPage();
  page.on('response',response=>{
    if(new URL(response.url()).pathname===settingsPath&&response.status()>=400)console.log('Settings',response.request().method(),response.status());
  });
  await context.addCookies(cookies(first.cookie));
  const master=()=>page.getByRole('checkbox',{name:'Require confirmation for all actions'});
  const create=()=>page.getByRole('checkbox',{name:'Create Things',exact:true});
  const read=async key=>(await send(api,settingsPath,{cookie:first.cookie})).value.confirmations[key];
  const wait=async fn=>{for(let i=0;i<80;i++){if(await fn())return;await delay(100)}throw Error('State did not converge')};
  const take=async (name)=>{const panel=page.locator('#connector-confirmations');await panel.screenshot({path:join(evidence,name+'.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));};
  let releaseInitialRead;
  await page.route('**'+settingsPath, async route => {
    await new Promise(resolve => { releaseInitialRead = resolve; });
    await route.continue();
  }, { times: 1 });
  await page.goto(origin+'/settings/connections#connector-confirmations',{waitUntil:'domcontentloaded'});
  await page.getByRole('progressbar',{name:'Loading confirmation settings'}).waitFor();
  assert.equal(await page.locator('#connector-confirmations progress').count(),1);
  assert.equal(await create().count(),0,'Protected choices stay hidden until the account settings arrive');
  await wait(async()=>Boolean(releaseInitialRead));
  releaseInitialRead();
  await master().waitFor({timeout:60000});
  assert(await master().isChecked());
  await create().focus();await page.keyboard.press('Space');
  await wait(async()=>!(await read('create')));
  await page.locator('#connector-confirmations fieldset[aria-busy=false]').waitFor();
  assert(await create().evaluate(el=>el===document.activeElement));
  assert(await master().evaluate(el=>el.indeterminate));
  await take('desktop-mixed');
  await master().locator('xpath=ancestor::label[1]').click({timeout:5000});await wait(async()=>await read('create'));
  await page.locator('#connector-confirmations fieldset[aria-busy=false]').waitFor();
  await master().locator('xpath=ancestor::label[1]').click({timeout:5000});await wait(async()=>!(await read('workflow')));
  await page.locator('#connector-confirmations fieldset[aria-busy=false]').waitFor();
  await page.reload({waitUntil:'domcontentloaded'});await master().waitFor();assert(!(await master().isChecked()));
  assert(!(await create().isChecked()));
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{scrollTo(0,0);for(let y=0;y<=document.documentElement.scrollHeight;y+=350){scrollTo(0,y);await new Promise(r=>setTimeout(r,25));}scrollTo(0,document.documentElement.scrollHeight);});
  await take('mobile-all-off');
  let release;
  await page.route('**'+settingsPath,async route=>{
    if(route.request().method()==='POST'){await new Promise(resolve=>release=resolve);await route.fulfill({status:503,json:{ok:false,error:'synthetic outage'}});}
    else await route.continue();
  });
  await create().locator('xpath=ancestor::label[1]').click({timeout:5000});
  await page.locator('#connector-confirmations fieldset[aria-busy=true]').waitFor();
  await wait(async()=>Boolean(release));
  assert(await page.getByRole('checkbox',{name:'Delete Things'}).isVisible());
  release();
  await page.getByRole('alert').filter({hasText:'Could not verify the change'}).waitFor();
  assert(!(await create().isChecked()));
  await take('mobile-save-error');
  await page.getByRole('button',{name:'Reload settings'}).click();
  await page.getByRole('alert').filter({hasText:'Could not verify the change'}).waitFor({state:'hidden'});
  await page.unroute('**'+settingsPath);
  await page.setViewportSize({width:1440,height:960});
  const host=page.locator('[data-settings-document="connector-confirmations"]');
  await enableCurrentPageBuilder(page);
  await host.getByRole('button',{name:'Edit layout',exact:true}).click();
  await host.getByRole('button',{name:'Open Builder inspector',exact:true}).click();
  const selector=page.getByRole('combobox',{name:'Select block',exact:true});
  await selector.selectOption('connector-protections-create-label');
  await page.getByRole('textbox',{name:'Block text',exact:true}).fill('Confirm creating Things');
  await selector.selectOption('connector-protections-create-input');
  await page.getByRole('textbox',{name:'Element title',exact:true}).fill('Editable create checkbox');
  await page.getByRole('textbox',{name:'Element title',exact:true}).blur();
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  const [layoutResponse] = await Promise.all([
    page.waitForResponse(response => {
      try { return new URL(response.url()).pathname==='/api/v1/things' && ['POST','PATCH'].includes(response.request().method()) && response.request().postDataJSON()?.crystal?.pageKey==='settings-connector-confirmations'; }
      catch { return false; }
    }),
    host.getByRole('button',{name:'Save layout',exact:true}).click()
  ]);
  assert.equal(layoutResponse.status(),200);
  const layout=(await layoutResponse.json()).thing;
  const stored=(await send(api,'/api/v1/things?id='+encodeURIComponent(layout.id),{cookie:first.cookie})).value.thing;
  assert.deepEqual(stored.acl,['tt:user']);
  const flatten=blocks=>blocks.flatMap(block=>[block,...flatten(block.children||[])]);
  const blocks=flatten(stored.crystal.blocks);
  assert.equal(blocks.find(b=>b.id==='connector-protections-create-label').text,'Confirm creating Things');
  assert.equal(blocks.find(b=>b.id==='connector-protections-create-input').props.title,'Editable create checkbox');
  await page.reload({waitUntil:'domcontentloaded'});
  const edited=page.getByRole('checkbox',{name:'Confirm creating Things',exact:true});
  await edited.waitFor();
  assert.equal(await edited.getAttribute('title'),'Editable create checkbox');
  await edited.focus(); await page.keyboard.press('Space');
  await wait(async()=>await read('create'));
  console.log('Builder separately edited label and checkbox; exact private Thing readback, reload and real action passed.');

  await context.clearCookies();await context.addCookies(cookies(second.cookie));
  await page.reload({waitUntil:'domcontentloaded'});await master().waitFor();assert(await master().isChecked());
  console.log('Desktop/mobile, keyboard, mixed state, master, refresh, in-flight/error/retry, and isolated account switch passed.');
  const mint = async scopes => (await send(api,'/api/v1/tokens',{cookie:first.cookie,body:{name:'Synthetic acceptance',scopes},status:201})).value;
  const token = await mint(['things.read']);
  const policy = await send(api,settingsPath,{bearer:token.token});
  assert.equal(policy.value.accountId,id);
  await send(api,settingsPath,{bearer:token.token,body:{confirmations:{create:false}},status:401});
  const introspection = (await send(api,'/api/v1/tokens/self',{bearer:token.token})).value;
  assert(!JSON.stringify(introspection).includes('connectorConfirmations'));
  await send(api,'/api/v1/tokens/revoke',{cookie:first.cookie,body:{id:token.tokenInfo.id}});
  await send(api,settingsPath,{bearer:token.token,status:401});
  const unrelated = await mint(['agents.report']);
  await send(api,settingsPath,{bearer:unrelated.token,status:401});
  console.log('Real Settings persistence, concurrent patches, PAT read/write separation, revocation, and introspection privacy passed.');
  await writeFile(join(evidence,'result.json'), JSON.stringify({realApi:true,desktop:true,mobile:true,keyboard:true,mixed:true,saveError:true,accountSwitch:true,builderEdit:true},null,2));
} catch(error) { console.error(error);process.exitCode=1; }
finally {
  await browser?.close(); await client?.close();
  for (const {proc,name,logs} of children.reverse()) {
    if(process.exitCode && name!=='mongo') await writeFile(join(evidence,name+'.log'), logs(),{mode:0o600});
    if(proc.exitCode===null && proc.signalCode===null){const exit=once(proc,'exit');try{process.kill(-proc.pid,'SIGTERM')}catch{};await Promise.race([exit,delay(1800)]);}
    try{process.kill(-proc.pid,'SIGKILL')}catch{}
  }
  await rm(dir,{recursive:true,force:true});
}
