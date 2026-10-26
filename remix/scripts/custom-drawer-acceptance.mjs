#!/usr/bin/env node
// Disposable real API acceptance. All application/backend network is OS fenced.
// Only replica-set initialization uses the Mongo driver; product data uses APIs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--browser') { await browserAcceptance(process.argv[3]); process.exit(0); }
const { MongoClient } = await import('mongodb');
const browserBinary = process.env.CHROMIUM_EXECUTABLE || (await import(process.env.PLAYWRIGHT_MODULE || 'playwright')).chromium.executablePath();
await readFile(browserBinary);
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-custom-drawer-'));
const ports = { api: 19851, db: 19852, web: 19853, hmr: 19854 };
const origin = `http://127.0.0.1:${ports.api}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=customDrawer`;
const children = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const password = randomBytes(24).toString('hex');
const evidence = process.env.CUSTOM_DRAWER_EVIDENCE_DIR;
assert(evidence, 'Set CUSTOM_DRAWER_EVIDENCE_DIR to an absolute task-owned output directory');
assert(evidence.startsWith('/'), 'Evidence path must be absolute');
await mkdir(evidence, { recursive: true });
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
  TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
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
  } throw new Error('Server not ready; see task-owned server logs');
}
async function api(path,{body,cookie,as,method,status=200}={}) {
  console.log(`${method||(body?'POST':'GET')} ${path.split('?')[0]}`);
  const response=await fetch(origin+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(as?{'X-Thingtime-Character':as}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return {data,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
let server;
try {
  assert.equal(process.platform,'darwin','Requires OS sandbox; no unrestricted fallback');
  await readFile(join(cwd,'.output/server/index.mjs'));
  for (const port of Object.values(ports)) { const listener=createServer(); await new Promise((r,j)=>{listener.once('error',j);listener.listen(port,'127.0.0.1',r)}); await new Promise(r=>listener.close(r)); }
  const preflight=start(process.execPath,['--input-type=module','-e',`for(const url of ['http://1.1.1.1:80/','http://127.0.0.1:${trap.address().port}/redirect']){try{await fetch(url,{signal:AbortSignal.timeout(2000)});throw Error('BOUNDARY_FAILED')}catch(e){if(e.cause?.code!=='EPERM')throw e}}`]);
  assert.equal((await once(preflight.child,'exit'))[0],0,preflight.log()); assert.equal(trapHits,1);
  await mkdir(join(dir,'db'));
  start(process.env.MONGOD_EXECUTABLE || '/opt/homebrew/bin/mongod',['--dbpath',join(dir,'db'),'--port',String(ports.db),'--bind_ip','127.0.0.1','--replSet','customDrawer','--nounixsocket']);
  const client=new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`,{serverSelectionTimeoutMS:1000});
  try {
    for(let n=0;;n++) { try{await client.connect();break}catch(e){if(n>20)throw e;await delay(300)} }
    await client.db('admin').command({replSetInitiate:{_id:'customDrawer',members:[{_id:0,host:`127.0.0.1:${ports.db}`} ]}});
    for(let n=0;;n++){if((await client.db('admin').command({hello:1})).isWritablePrimary)break;if(n>100)throw Error('Replica not primary');await delay(200)}
  } finally { await client.close(); }
  server=start(process.execPath,['.output/server/index.mjs']); await ready(server);
  const manifest=(await api('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin,origin,'Manifest must describe selected isolated origin');
  for (const [feature,minimum] of Object.entries({'api.auth-register':[1,3,1],'api.things':[1,0,0],'api.things-search':[1,3,0]})) {
    const version=manifest.features[feature]?.version;assert.match(version || '',/^\d+\.\d+\.\d+$/,'Missing semantic feature '+feature);
    const actual=version.split('.').map(Number);assert.equal(actual[0],minimum[0],feature+' incompatible major');
    assert(actual[1]>minimum[1] || (actual[1]===minimum[1] && actual[2]>=minimum[2]),feature+' below minimum');
  }
  const account=await api('/api/v1/auth/register',{body:{username:'drawer-acceptance-owner',email:'drawer@example.invalid',password,displayName:'Drawer acceptance'}});
  assert(account.data.user.id,'Disposable owner must exist');
  const alternate=await api('/api/v1/auth/register',{body:{username:'drawer-acceptance-alternate',email:'alternate@example.invalid',password,displayName:'Separate drawer account'}});
  const thing=(await api('/api/v1/things',{cookie:account.cookie,body:{thingtime:['webpage'],acl:['tt:user'],crystal:{name:'Drawer acceptance attached page',blocks:[{id:'nested-container',type:'container',children:[{id:'nested-title',type:'text',text:'Attached drawer page'}]}]}}})).data;
  const thingId=thing.thing?.id || thing.post?.id; assert(thingId,'API fixture must return a Thing ID');
  await writeFile(join(evidence,'backend-result.json'),JSON.stringify({ok:true,origin,backendDirectIpBlocked:true,backendRedirectBlocked:true,disposableReplicaSet:true,manifestNegotiated:true,realApiRegistration:true,privateThingId:thingId,productionAccess:false},null,2));
  const vite=start(process.execPath,['--input-type=module','-e',`import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`],{NODE_ENV:'development'});
  const webOrigin=`http://127.0.0.1:${ports.web}`;await ready(vite,webOrigin);
  const fixture=join(dir,'browser-fixture.json');
  await writeFile(fixture,JSON.stringify({origin:webOrigin,cookie:account.cookie,alternateCookie:alternate.cookie,thingId,redirect:`http://127.0.0.1:${trap.address().port}/redirect`,evidence}),{mode:0o600});
  const ui=start(process.execPath,['scripts/custom-drawer-acceptance.mjs','--browser',fixture],{PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE,CHROMIUM_EXECUTABLE:browserBinary});
  const timeout=setTimeout(()=>{try{process.kill(-ui.child.pid,'SIGTERM')}catch{}},300_000);
  const uiExit=await once(ui.child,'exit');clearTimeout(timeout);
  assert.equal(uiExit[0],0,ui.log());console.log(ui.log());
  await writeFile(join(evidence,'result.json'),JSON.stringify({ok:true,origin:webOrigin,ports,backendNetworkDenied:true,disposableReplicaSet:true,productionAccess:false},null,2));
} catch(error) {
  console.error(error.message);process.exitCode=1;
  await writeFile(join(evidence,'result.json'),JSON.stringify({ok:false,error:error.message,productionAccess:false},null,2));
} finally {
  for (const child of children.reverse()) await stop({child});
  await new Promise(r=>trap.close(r));
  await rm(dir,{recursive:true,force:true});
}

async function browserAcceptance(fixturePath) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
  const out=fixture.evidence;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  context.setDefaultTimeout(15_000);context.setDefaultNavigationTimeout(30_000);
  let page=await context.newPage(); const errors=[];const steps=[];const measurements=[];
  const note=async step=>{steps.push(step);await writeFile(join(out,'progress.json'),JSON.stringify(steps,null,2));};
  const capture=async name=>{
    await page.evaluate(async()=>{const end=document.documentElement.scrollHeight;for(let y=0;y<end;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,30))}window.scrollTo(0,0)});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' horizontal overflow');
    measurements.push(await page.evaluate(name=>({name,viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,scopes:[...document.querySelectorAll('[data-settings-document],.drawerMenuScroll,dialog[open]')].map(e=>({scope:e.getAttribute('data-settings-document')||e.className||e.tagName,width:e.getBoundingClientRect().width,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}))}),name));
    await writeFile(join(out,'layout-measurements.json'),JSON.stringify(measurements,null,2));
    for(const scope of measurements.at(-1).scopes){if(scope.right>0 && scope.left<measurements.at(-1).viewport)assert(scope.scrollWidth<=scope.clientWidth+1,name+' internal overflow: '+scope.scope+' '+scope.scrollWidth+' > '+scope.clientWidth);}
    await page.screenshot({path:join(out,name+'.png'),fullPage:true});await page.screenshot({path:join(out,name+'-viewport.png')});
    const menuScroll=page.locator('.drawerMenuScroll').first();if(await menuScroll.isVisible()){await menuScroll.evaluate(e=>{e.scrollTop=e.scrollHeight});await page.screenshot({path:join(out,name+'-menu-bottom.png')});await menuScroll.evaluate(e=>{e.scrollTop=0});}
    const modal=page.getByRole('dialog',{name:'Custom drawer item',exact:true});
    if(await modal.isVisible()){await modal.evaluate(e=>{e.scrollTop=e.scrollHeight});await page.screenshot({path:join(out,name+'-bottom.png'),fullPage:true});await modal.evaluate(e=>{e.scrollTop=0});}
  };
  const openDrawer=async()=>{const trigger=page.getByRole('button',{name:'Open menu',exact:true});if(await trigger.isVisible())await trigger.click();};
  try {
    for(const url of ['http://1.1.1.1:80/',fixture.redirect]){
      let denied=false;try{await page.goto(url,{timeout:4000})}catch(error){assert(/ERR_NETWORK_ACCESS_DENIED|ERR_ACCESS_DENIED/.test(error.message),error.message);denied=true}assert(denied,'Browser egress must fail closed');
    }
    await note('Browser direct-IP and redirect egress denied');const probePage=page;page=await context.newPage();await probePage.close();
    await context.addCookies(fixture.cookie.split('; ').map(pair=>{const split=pair.indexOf('=');return{name:pair.slice(0,split),value:pair.slice(split+1),url:fixture.origin,httpOnly:true,sameSite:'Lax'}}));
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(fixture.origin+'/feed',{waitUntil:'domcontentloaded'});
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await capture('baseline-feed-'+viewport.width)}await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:/Open menu|Close menu/}).waitFor({timeout:60000});
    const trigger=page.getByRole('button',{name:'Open menu',exact:true});
    if(await trigger.isVisible()){await trigger.hover();await page.locator('.drawerHoverPopup').getByRole('button',{name:'Add +',exact:true}).click();await page.mouse.move(1000,700);}else{await page.getByRole('button',{name:'Close menu',exact:true}).click();await trigger.hover();await page.locator('.drawerHoverPopup').getByRole('button',{name:'Add +',exact:true}).click();await page.mouse.move(1000,700);}
    await note('Hover-preview Add opens persistent panel editor');
    const menu=page.locator('[data-settings-document="custom-drawer-menu"]');
    const dialog=page.getByRole('dialog',{name:'Custom drawer item',exact:true});await dialog.waitFor();
    await dialog.getByLabel('Emoji',{exact:true}).fill('🧭');await dialog.getByLabel('Title',{exact:true}).fill('Drawer acceptance relative');
    await dialog.getByLabel('Hover tooltip',{exact:true}).fill('Drawer acceptance tooltip');
    await dialog.getByLabel('URL (relative or https://)',{exact:true}).fill('javascript:alert(1)');
    await dialog.getByRole('button',{name:'Save item',exact:true}).click();await dialog.getByRole('alert').waitFor();
    await dialog.getByLabel('URL (relative or https://)',{exact:true}).fill('/feed?drawer-acceptance=relative');
    await capture('drawer-popup-desktop');
    await page.setViewportSize({width:390,height:844});await capture('drawer-popup-mobile');
    await dialog.getByRole('button',{name:'Save item',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await menu.getByRole('link',{name:'Drawer acceptance relative',exact:true}).waitFor();
    await note('Add popup validates URL and saves relative link');
    await page.reload({waitUntil:'domcontentloaded'});await openDrawer();
    const relative=menu.getByRole('link',{name:'Drawer acceptance relative',exact:true});await relative.waitFor();assert.equal(await relative.getAttribute('title'),'Drawer acceptance tooltip');
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await capture('drawer-menu-'+viewport.width)}
    const originalRoute=page.url();const [newTab]=await Promise.all([context.waitForEvent('page'),relative.click({modifiers:['Meta']})]);await newTab.waitForLoadState('domcontentloaded');assert.equal(page.url(),originalRoute);assert(newTab.url().includes('drawer-acceptance=relative'));await newTab.close();await note('Modified click opens task-owned tab and preserves current route');
    await relative.click();await page.waitForURL('**/feed?drawer-acceptance=relative');
    await note('Relative link survives reload and navigates');
    await page.setViewportSize({width:1440,height:1000});await openDrawer();
    await menu.getByRole('button',{name:'Add +',exact:true}).click();
    await dialog.getByLabel('Commander: search Things',{exact:true}).fill('zzqxyvnonexistent65937');await dialog.getByText('No matching Things. Try another search.',{exact:true}).waitFor();
    await dialog.getByLabel('Commander: search Things',{exact:true}).fill('Drawer acceptance attached page');
    const result=dialog.getByRole('button',{name:/Drawer acceptance attached page/});await result.waitFor();
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await capture('drawer-commander-results-'+viewport.width)}await page.setViewportSize({width:1440,height:1000});
    await result.click();
    await dialog.getByText('Attached Thing: Drawer acceptance attached page',{exact:true}).waitFor();
    await dialog.getByLabel('Title',{exact:true}).fill('Drawer acceptance Thing');
    await dialog.getByRole('button',{name:'Save item',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await note('Commander attached real persisted Thing without navigating');
    const attachedLink=menu.getByRole('link',{name:'Drawer acceptance Thing',exact:true});assert((await attachedLink.getAttribute('href')).includes(fixture.thingId));
    await attachedLink.click();await page.getByText('Attached drawer page',{exact:true}).waitFor();
    await note('Attached Thing destination renders the independent API fixture');
    await page.goto(fixture.origin+'/settings/appearance',{waitUntil:'domcontentloaded'});
    const expandSettings=async()=>{const summary=page.locator('summary').filter({hasText:'Custom drawer items'});const details=summary.locator('..');if(!await details.getAttribute('open').then(v=>v!==null))await summary.click();};await expandSettings();
    const settings=page.locator('[data-settings-document="custom-drawer-settings"]');await settings.waitFor({timeout:30000});
    const row=settings.getByRole('link',{name:'Drawer acceptance relative',exact:true}).locator('..');
    await row.getByRole('button',{name:'Edit',exact:true}).click();
    for(const [label,value] of [['Emoji','🧭'],['Title','Drawer acceptance relative'],['Hover tooltip','Drawer acceptance tooltip'],['URL (relative or https://)','/feed?drawer-acceptance=relative']])assert.equal(await dialog.getByLabel(label,{exact:true}).inputValue(),value,'Edit prefill '+label);
    await dialog.getByLabel('Title',{exact:true}).fill('Drawer acceptance edited');
    await dialog.getByLabel('URL (relative or https://)',{exact:true}).fill(fixture.origin+'/feed?drawer-acceptance=absolute');
    await dialog.getByRole('button',{name:'Save item',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await page.reload({waitUntil:'domcontentloaded'});await expandSettings();await settings.getByRole('link',{name:'Drawer acceptance edited',exact:true}).waitFor();
    await note('Settings edit persists absolute URL');
    await settings.getByRole('link',{name:'Drawer acceptance edited',exact:true}).click();await page.waitForURL('**/feed?drawer-acceptance=absolute');
    await page.goto(fixture.origin+'/settings/appearance',{waitUntil:'domcontentloaded'});await expandSettings();
    await note('Absolute URL navigates to its exact destination');
    // Actual Builder controls edit individually selectable nested blocks and the repeated template.
    await settings.getByRole('button',{name:'Edit layout',exact:true}).click();await settings.getByRole('button',{name:'Open Builder inspector',exact:true}).click();
    const select=page.getByRole('combobox',{name:'Select block',exact:true});await select.waitFor();
    for(const [id,text] of [['custom-drawer-heading','My drawer links'],['custom-drawer-add-label','Add shortcut +'],['custom-drawer-icon','{item.emoji} ✨'],['custom-drawer-title','{item.title} ✓'],['drawer-title-label','Link title']]) {
      await select.selectOption(id);const input=page.getByLabel('Block text',{exact:true});await input.fill(text);assert.equal(await input.inputValue(),text);
    }
    await select.selectOption('drawer-title');await page.getByLabel('Element placeholder',{exact:true}).fill('A personal link title');
    await page.getByTestId('builder-save').click();await settings.getByText('Unsaved layout',{exact:true}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Close builder',exact:true}).click();
    await settings.getByRole('button',{name:'Done editing layout',exact:true}).click();
    await page.reload({waitUntil:'domcontentloaded'});await expandSettings();await settings.getByRole('heading',{name:'My drawer links',exact:true}).waitFor();
    await settings.getByRole('button',{name:'Add shortcut +',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('Title',{exact:true}).getAttribute('placeholder'),'A personal link title');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await settings.getByRole('button',{name:'Add shortcut +',exact:true}).evaluate(e=>{if(document.activeElement!==e)throw Error('Escape must restore Add focus')});
    await note('Builder nested heading, button label, icon, repeated title and field label selectable; saved layout survives reload');
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await capture('drawer-settings-'+viewport.width)}
    const editedRow=settings.getByRole('link',{name:'Drawer acceptance edited ✓',exact:true}).locator('..');
    await editedRow.getByRole('button',{name:'Remove',exact:true}).click();await settings.getByRole('link',{name:'Drawer acceptance edited ✓',exact:true}).waitFor({state:'hidden'});
    await page.reload({waitUntil:'domcontentloaded'});await expandSettings();assert.equal(await settings.getByRole('link',{name:'Drawer acceptance edited ✓',exact:true}).count(),0);
    await note('Settings remove survives reload');
    await settings.getByRole('button',{name:'Add shortcut +',exact:true}).click();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});await settings.getByRole('button',{name:'Add shortcut +',exact:true}).evaluate(e=>{if(document.activeElement!==e)throw Error('Cancel must restore Add focus')});
    const longTitle='Long drawer title '+ 'VeryLongUnbrokenLabel'.repeat(12);
    await settings.getByRole('button',{name:'Add shortcut +',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).fill(longTitle);await dialog.getByLabel('URL (relative or https://)',{exact:true}).fill('/feed');await dialog.getByRole('button',{name:'Save item',exact:true}).click();await dialog.waitFor({state:'hidden'});
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await capture('long-drawer-settings-'+viewport.width);await openDrawer();await capture('long-drawer-menu-'+viewport.width);await page.getByRole('button',{name:'Close menu',exact:true}).click();}
    await note('Long unbroken titles wrap without overflow at desktop/mobile; Cancel restores focus');
    const useSession=async cookie=>{await context.clearCookies();await context.addCookies(cookie.split('; ').map(pair=>{const split=pair.indexOf('=');return{name:pair.slice(0,split),value:pair.slice(split+1),url:fixture.origin,httpOnly:true,sameSite:'Lax'}}));await page.reload({waitUntil:'domcontentloaded'});await expandSettings();};
    await useSession(fixture.alternateCookie);assert.equal(await settings.getByRole('link',{name:/Drawer acceptance/}).count(),0);await settings.getByRole('button',{name:'Add +',exact:true}).waitFor();
    await useSession(fixture.cookie);await settings.getByRole('link',{name:'Drawer acceptance Thing ✓',exact:true}).waitFor();
    await note('Account separation fences custom items and edited layouts, original account restores');
    assert.equal(errors.length,0,'Unhandled browser errors: '+errors.join('; '));
    await writeFile(join(out,'browser-result.json'),JSON.stringify({ok:true,steps,errors,desktopAndMobile:true,realApiThing:fixture.thingId,browserNetworkDenied:true},null,2));
    console.log(JSON.stringify({ok:true,steps,errors}));
  } catch(error) {await page.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(out,'browser-result.json'),JSON.stringify({ok:false,error:error.message,steps,errors},null,2));throw error;}
  finally {await browser.close();}
}
