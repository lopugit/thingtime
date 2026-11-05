// Isolated real UI/local-persistence regression; catalog and identity are synthetic.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { ports } = require('./worktree-ports.cjs').resolveDevContext();
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = resolve(process.argv[2] || '/tmp/thingtime-lopu-launcher-acceptance');
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const server = await createServer({root, configFile:false, envDir:false, publicDir:false, resolve:{alias:{'~':join(root,'app')}},server:{host:'127.0.0.1',port:ports.web,strictPort:true,hmr:false},plugins:[{name:'launcher-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/launcher-acceptance')return next();try{res.setHeader('content-type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><title>[LC] Lopu icon acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/lopu-launcher.browser.fixture.tsx"></script></body></html>'));}catch(e){next(e)}})}}]});
let browser;
const outcomes=[];
try{
 await server.listen();await mkdir(evidence,{recursive:true,mode:0o700});
 browser=await chromium.launch({channel:process.env.TT_CHROMIUM_EXECUTABLE?undefined:'chrome',executablePath:process.env.TT_CHROMIUM_EXECUTABLE,chromiumSandbox:true});
 for(const [name,viewport] of Object.entries({desktop:{width:1440,height:1000},mobile:{width:390,height:844}})){
  const context=await browser.newContext({viewport,reducedMotion:"reduce"});
  try{await exercise(context,name);}catch(error){for(const page of context.pages())await page.screenshot({path:join(evidence,name+"-failure.png"),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
 }
 await writeFile(join(evidence,'results.json'),JSON.stringify(outcomes,null,2));
 console.log(JSON.stringify(outcomes,null,2));
}finally{await browser?.close();await server.close();}
async function exercise(context,name){
 const page=await context.newPage();page.setDefaultTimeout(25000);
 page.on('pageerror',e=>console.error('PAGEERROR',e.message));
 await page.goto('http://127.0.0.1:'+ports.web+'/launcher-acceptance',{waitUntil:'domcontentloaded',timeout:120000});
 const state=page.getByTestId('preference-state');
 await state.waitFor();await assertState(false);
 assert.equal(await page.locator('.lopuLauncher').count(),0,'Fresh preference hides icon');
 await page.getByRole('button',{name:'Full chat',exact:true}).click();
 await page.getByRole('button',{name:'Chat settings',exact:true}).click();
 const toggle=page.getByLabel('Show floating Lopu icon',{exact:true});
 await toggle.waitFor();assert.equal(await toggle.isChecked(),false);
 // Exercise the ordinary toggle action and reload immediately, without a
 // fixture-only persistence flush or waiting out the provider's debounce.
 await toggle.locator('..').click();
 await page.reload();await assertState(true);
 await page.getByRole('button',{name:'Full chat',exact:true}).click();
 await page.getByRole('button',{name:'Chat settings',exact:true}).click();
 await assertPanelFits();await page.screenshot({path:join(evidence,name+'-chat-settings.png')});
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Home',exact:true}).click();
 await page.locator('.lopuLauncher').waitFor();
 await page.reload();await assertState(true);await page.locator('.lopuLauncher').waitFor();
 const second=await context.newPage();await second.goto('http://127.0.0.1:'+ports.web+'/launcher-acceptance');await second.locator('.lopuLauncher').waitFor();
 await page.getByRole('button',{name:'User settings',exact:true}).click();
 // User settings uses the real collapsible SettingsSection composition.
 if(!(await toggle.isVisible()))await page.getByText('Lopu 🦄',{exact:true}).click();
 await toggle.waitFor();assert.equal(await toggle.isChecked(),true);
 await setToggle(false);await assertState(false);
 await page.screenshot({path:join(evidence,name+'-user-settings.png'),fullPage:true});
 assert.equal(await page.locator('.lopuLauncher').count(),0);
 await second.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="preference-state"]')?.textContent||'{}').launcher===false);await second.close();
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
 await page.getByRole('button',{name:'Home',exact:true}).click();
 await page.locator('.nav-lopu-button').click();
 await page.getByRole('button',{name:'Chat settings',exact:true}).click();
 assert.equal(await toggle.isChecked(),false);
 await setToggle(true);await assertState(true);
 await setToggle(false);await assertState(false);
 await assertPanelFits();await page.screenshot({path:join(evidence,name+'-floating-settings.png')});
 const panel=page.getByRole('dialog',{name:'Chat settings',exact:true});
 const last=panel.getByLabel('Vercel chat management',{exact:true});await last.scrollIntoViewIfNeeded();
 await page.keyboard.press('Escape');
 if(name==='desktop'){
  await page.getByRole('button',{name:'Minimise',exact:true}).click();
  assert.equal(await page.locator('.lopuLauncher').count(),0,'Minimising must honor icon off');
  await page.locator('.nav-lopu-button').click();
  await page.getByRole('button',{name:'Chat settings',exact:true}).waitFor();
 }
 await flush();await page.reload();await assertState(false);
 assert.equal(await page.locator('.lopuLauncher').count(),0);
 const stored=await page.evaluate(()=>window.launcherEvidence.read());assert.equal(stored.launcher,false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');
 outcomes.push({viewport:name,result:'pass',persistedLauncher:stored.launcher,coverage:'fresh default, page/window gear, real SettingsContent, icon visibility, navigation, reload, saved readback, popover scroll and viewport bounds'});
 async function assertPanelFits(){
  const rect=await page.getByRole('dialog',{name:'Chat settings',exact:true}).boundingBox();
  const viewport=page.viewportSize();
  assert.ok(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1,'Settings panel remains within viewport');
 }
 async function setToggle(value){
  if(await toggle.isChecked()!==value){await toggle.locator('..').click();}
  assert.equal(await toggle.isChecked(),value);
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
 }
 async function flush(){await page.evaluate(()=>window.launcherEvidence.flush());}
 async function assertState(value){await page.waitForFunction(v=>JSON.parse(document.querySelector('[data-testid="preference-state"]')?.textContent||'{}').launcher===v,value);}
}
