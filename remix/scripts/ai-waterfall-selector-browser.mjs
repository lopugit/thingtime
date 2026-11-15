// Synthetic component regression only: real React/Chakra selector, no account or backend.
// TT_PLAYWRIGHT_MODULE points to an installed Playwright module when not a dependency.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await mkdtemp(join(root, '.waterfall-browser-'));
const evidence = process.env.TT_WATERFALL_EVIDENCE_DIR || await mkdtemp(join(tmpdir(), 'thingtime-waterfall-evidence-'));
await mkdir(evidence, { recursive: true });
const config = (effort = 'medium') => ({ version: 1, entries: [{ endpointId: 'server:anthropic', modelId: 'claude-opus-5-5', effort, speed: 'normal' }] });
const saved = (id, name, effort = 'medium') => ({ id, name, config: config(effort), updatedAt: '2026-11-15T00:00:00Z' });
await writeFile(join(fixture, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
await writeFile(join(fixture, 'fixture.tsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { AiWaterfallSelector } from '../app/components/AI/AiWaterfallSelector';
import { aiWaterfallEndpoints } from '../app/api/utils/ai/waterfallCatalog';
import { getAiModelCatalogEntry, publicAiModel } from '../app/api/utils/ai/modelsCore';
const status={configured:true,verified:null,checkedAt:null};
const endpoints=aiWaterfallEndpoints([], [publicAiModel(getAiModelCatalogEntry('claude-opus-5-5'), true, {anthropic:status,openai:status})]);
function Harness(){
 const [props,setProps]=React.useState({isOpen:false,value:null,items:[],initialSaved:undefined,generation:0});
 window.fixture={update:(patch)=>setProps(p=>({...p,...patch})), reset:(patch)=>setProps(p=>({isOpen:true,value:null,items:[],initialSaved:undefined,...patch,generation:p.generation+1}))};
 return <ChakraProvider><main><h1>Synthetic waterfall selector acceptance fixture</h1></main><AiWaterfallSelector key={props.generation} {...props} endpoints={endpoints} onClose={()=>setProps(p=>({...p,isOpen:false}))} onApply={(config)=>{window.applied=config}} library={{items:props.items,save:async(input)=>{window.savedInputs=[...(window.savedInputs||[]),input];return {...input,id:input.id||'fixture-new',updatedAt:'2026-11-15T01:00:00Z'}}}}/></ChakraProvider>
}
createRoot(document.getElementById('root')).render(<Harness/>);
`);
let browser, server;
const results=[];
try {
 server=await createServer({configFile:false,root,plugins:[react(),{name:'fixture-layer-constants',enforce:'pre',resolveId(id){if(id==='~/components/Nav/Drawer/useDrawer')return '\0fixture-layers'},load(id){if(id==='\0fixture-layers')return 'export const DRAWER_MODAL_OVERLAY_Z=10240; export const DRAWER_MODAL_Z=10250;'}}],resolve:{alias:{'~':join(root,'app')}},server:{host:'127.0.0.1',port:Number(process.env.TT_WATERFALL_BROWSER_PORT||19873),strictPort:true},logLevel:'warn'});
 await server.listen();
 const {chromium}=await import(process.env.TT_PLAYWRIGHT_MODULE||'playwright');
 browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.TT_CHROMIUM_EXECUTABLE?{executablePath:process.env.TT_CHROMIUM_EXECUTABLE}:{})});
 for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.config.server.port}/${fixture.slice(root.length+1)}/index.html`);
  await page.waitForFunction(()=>!!window.fixture);
  const update=async(patch,reset=false)=>page.evaluate(({patch,reset})=>window.fixture[reset?'reset':'update'](patch),{patch,reset});
  const picker=page.getByLabel('Select saved waterfall');
  const name=page.getByLabel('Waterfall name');
  const effort=page.getByLabel('Reasoning effort for attempt 1');
  const expectValue=async(locator,value)=>{await locator.waitFor(); await page.waitForFunction(({label,value})=>document.querySelector('[aria-label="'+label+'"]')?.value===value,{label:await locator.getAttribute('aria-label'),value}); assert.equal(await locator.inputValue(),value)};
  const row=saved('saved-main','Everyday coding');
  await update({value:config(),items:[]},true);
  await expectValue(picker,'');
  await update({items:[row]});
  await expectValue(picker,'saved-main'); await expectValue(name,'Everyday coding');
  assert.equal(await page.getByRole('status').textContent(),'Saved');
  await name.fill('Renamed existing');
  await page.getByRole('button',{name:'Save waterfall',exact:true}).click();
  await page.waitForFunction(()=>window.savedInputs?.length===1);
  assert.deepEqual(await page.evaluate(()=>({id:window.savedInputs[0].id,updatedAt:window.savedInputs[0].updatedAt})),{id:'saved-main',updatedAt:row.updatedAt});
  results.push(label+': delayed matching and save existing identity');
  const explicit=saved('explicit','Explicit library entry','high');
  await update({value:config(),items:[row,explicit],initialSaved:explicit},true);
  await expectValue(picker,'explicit'); await expectValue(name,'Explicit library entry'); await expectValue(effort,'medium');
  await update({items:[row,{...explicit,name:'Background rename'}]});
  await expectValue(name,'Explicit library entry');
  results.push(label+': explicit initialSaved priority and refresh preservation');
  await update({value:config('low'),items:[row]},true); await expectValue(picker,''); await expectValue(name,''); await expectValue(effort,'low');
  await update({value:null,items:[row]},true); await expectValue(picker,''); await expectValue(page.getByLabel('AI selection mode'),'inherit');
  assert.equal(await effort.count(),0);
  results.push(label+': unmatched and inherited contexts stay unsaved');
  await update({value:config(),items:[]},true); await expectValue(name,'');
  await name.fill('My in-progress name'); await effort.selectOption('xhigh');
  await update({items:[row]}); await expectValue(picker,''); await expectValue(name,'My in-progress name'); await expectValue(effort,'xhigh');
  results.push(label+': edits before delayed library arrival preserved');
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); await page.getByRole('dialog').waitFor({state:'hidden'});
  await update({isOpen:true,value:config('high'),items:[row,saved('new-context','Current context','high')]});
  await expectValue(picker,'new-context'); await expectValue(name,'Current context'); await expectValue(effort,'high');
  results.push(label+': cancel and reopen selects current context');
  await effort.selectOption('max'); await effort.selectOption('low'); await effort.selectOption('medium'); await effort.selectOption('high'); await effort.selectOption('xhigh');
  const opts=await effort.locator('option').evaluateAll(xs=>xs.map(x=>x.value)); assert.deepEqual(opts,['','low','medium','high','xhigh','max']);
  await page.screenshot({path:join(evidence,label+'-top.png'),fullPage:true});
  const body=page.locator('.chakra-modal__body'); await body.evaluate(e=>{e.scrollTop=e.scrollHeight});
  await page.getByRole('button',{name:'Apply waterfall',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(evidence,label+'-bottom.png'),fullPage:true});
  const bounds=await page.getByRole('dialog').boundingBox(); assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]); await context.close();
 }
 await writeFile(join(evidence,'results.json'),JSON.stringify({kind:'synthetic actual React component; no production persistence',results},null,2));
 console.log(JSON.stringify({passed:results.length,evidence,results},null,2));
} finally {await browser?.close();await server?.close();await rm(fixture,{recursive:true,force:true});}
