import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, '../MCP/package.json'));
const scratch = await mkdtemp(join(tmpdir(), 'thingtime-sync-resources-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-sync-resources-evidence'));
let context, server;
try {
 const localFixture = {
  name: 'local-resource-fixture',
  setup(build) {
   build.onResolve({ filter: /^~\/fileSync\/(nativeSyncHost|nativeSyncTasks)\.client$/ }, ({ path, importer }) =>
    importer.endsWith('/DeviceSyncResources.tsx') ? { path, namespace: 'local-resource-fixture' } : undefined);
   build.onLoad({ filter: /.*/, namespace: 'local-resource-fixture' }, ({ path }) => ({
    contents: path.includes('nativeSyncHost') ? `
     const local = new URLSearchParams(location.search).get('mode') === 'local';
     const host = {
      origin: () => location.origin,
      capabilities: { fileAccessVersion: '1.16.0', fileResourceLimitsVersion: '1.1.0' },
      request: async () => ({ roots: [], deviceResourceLimits: { transferBytesPerSecond: 5000000, scanBytesPerSecond: 5000000, cpuPercent: 15 } })
     };
     export const getNativeSyncAdapter = () => local ? { platform: 'macos' } : undefined;
     export const createNativeSyncHost = async () => host;
    ` : `
     let run = null;
     const listeners = new Set();
     window.startLocalResourceFixture = () => {
      run = { scope: { ownerId: 'resource-fixture-owner', deviceId: 'resource-fixture-device', origin: location.origin, dataPlane: 'home' }, active: true, progress: {} };
      for (const listener of listeners) listener();
     };
     export const nativeSyncTasks = {
      read: () => run,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }
     };
    `
   }));
  }
 };
 const source = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ChakraProvider}from'@chakra-ui/react';import{createMemoryRouter,RouterProvider}from'react-router';import{DeviceSyncResources}from'../app/components/Devices/DeviceSyncResources';import{rootIdentity}from'../app/utils/rootIdentity';
 function Fixture(){const[revision,setRevision]=useState(0),[mode,setMode]=useState('active'),[policy,setPolicy]=useState({transferBytesPerSecond:625000,scanBytesPerSecond:625000,cpuPercent:15});Object.assign(window,{resourceFixture:{invalidate:()=>rootIdentity.changed(),refresh:()=>setRevision(x=>x+1),setMode,policy:()=>policy}});const remote={origin:window.location.origin,policy:{...policy},checking:mode==='refreshing',active:mode==='active'||mode==='stale'||mode==='refreshing',online:mode!=='unknown',observedAt:Date.now()+3_600_000,receivedAt:Date.now(),status:'Synthetic selected device · observed '+revision,refresh:async()=>setRevision(x=>x+1),resources:mode==='unknown'||mode==='refreshing'?undefined:{version:1,cpuPercent:3,cpuStatus:'measured',cpuScopes:['source-thread','indexer-process','transport-process'],effectiveTransferConcurrency:1,effectiveIndexingConcurrency:1,currentUploadBytesPerSecond:125000,currentDownloadBytesPerSecond:62500,scanBytesPerSecond:100000,memoryBytes:67108864,measuredAt:Date.now()+3_600_000-(mode==='idle'||mode==='stale'?5000:0)},save:async next=>{setPolicy(next);return next;}};return <ChakraProvider><main style={{maxWidth:1000,margin:'auto',padding:16}}><DeviceSyncResources ownerId='resource-fixture-owner' deviceId='resource-fixture-device' allowed={true} remote={location.search ? undefined : remote}/><div style={{height:600}}>End of resource fixture</div></main></ChakraProvider>;}
 const router=createMemoryRouter([{id:'root',path:'*',element:<Fixture/>}],{hydrationData:{loaderData:{root:{user:null,dataPlane:'home'}}}});createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`;
 await require('esbuild').build({ stdin:{contents:source,loader:'tsx',resolveDir:join(root,'scripts')},bundle:true,plugins:[localFixture],format:'esm',platform:'browser',target:'esnext',outfile:join(scratch,'fixture.js'),tsconfig:join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},logLevel:'error',loader:{'.wasm':'file'} });
 const bundle = await readFile(join(scratch,'fixture.js'));
 const requests = [];
 let failNextMinute = true;
 let origin;
 server=createServer(async (request,response)=>{
  const reply = (value, status = 200) => { response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value)); };
  if(request.url==='/.well-known/thingtime-capabilities.json')return reply({schemaVersion:1,origin,features:{'api.devices-sync-control':{version:'1.4.0'}}});
  if(request.url==='/api/v1/devices/sync-control'){
   const chunks=[];for await(const chunk of request) chunks.push(chunk);
   const body=JSON.parse(Buffer.concat(chunks).toString());
   if(request.headers['x-thingtime-expected-actor']!=='resource-fixture-owner'||request.headers['x-thingtime-expected-data-plane']!=='home'||request.headers['x-thingtime-expected-api-origin']!==origin||body.deviceId!=='resource-fixture-device'||body.command.action!=='history')return reply({ok:false,error:'Fixture scope mismatch'},400);
   const range=body.command.range;requests.push(range);
   await new Promise(resolve=>setTimeout(resolve,200));
   if(range.to-range.from===60_000&&failNextMinute){failNextMinute=false;return reply({ok:false,error:'Fixture history interrupted'},503);}
   const rows={uploadMbps:2,downloadMbps:0,scanMbps:1,cpuPercent:null,memoryBytes:67108864}, keys=Object.keys(rows);
   const empty=range.to-range.from===86_400_000;
   const buckets=Array.from({length:range.bucketCount},(_,i)=>{
    const measured=!empty&&(i===0||i===2);
    return {from:range.from+Math.floor((range.to-range.from)*i/range.bucketCount),to:range.from+Math.floor((range.to-range.from)*(i+1)/range.bucketCount),samples:Number(measured),
      ...Object.fromEntries(keys.map(key=>[key,measured?rows[key]:null])),
      measured:Object.fromEntries(keys.map(key=>[key,Number(measured&&rows[key]!=null)]))};
   });
   return reply({ok:true,status:'complete',result:{range,buckets,latest:empty?null:{at:buckets[2].from,status:'running',...rows},firstObservedAt:empty?null:buckets[0].from,sampleCount:empty?0:2}});
  }
  response.writeHead(200,{'Content-Type':request.url==='/fixture.js'?'application/javascript':'text/html','Cache-Control':'no-store'});response.end(request.url==='/fixture.js'?bundle:'<!doctype html><meta charset="utf-8"><title>[QA] Sync resource dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
 context=await require('playwright').chromium.launchPersistentContext(join(scratch,'profile'),{headless:true,downloadsPath:join(scratch,'downloads'),acceptDownloads:false});
 const page=context.pages()[0], errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Fixture browser error:',error.message);});
 page.on('console',message=>{if(message.type()==='error')console.error('Fixture console:',message.text());});
 await mkdir(evidence,{recursive:true});
 for(const[label,width,height]of[['desktop',1440,1000],['mobile',375,812]]){
  await page.setViewportSize({width,height});await page.goto(origin);
  await page.getByRole('heading',{name:'Total Sync & Backup usage'}).waitFor();
  await page.getByText('Measuring Sync and Backup on this device.',{exact:true}).waitFor();
  assert.equal(await page.locator('[role="meter"]').count(),4,'Builder must render existing editable bar primitives');
  await page.getByText('Device resource targets',{exact:true}).click();
  const target=page.getByRole('spinbutton',{name:'transfer budget (Mbps)'});await target.fill('2.5');
  await page.evaluate(()=>window.resourceFixture.refresh());assert.equal(await target.inputValue(),'2.5','background status must preserve an unfinished target edit');
  await page.getByRole('button',{name:'Save device targets'}).click();
  await page.getByText('Selected device targets saved.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.resourceFixture.policy().transferBytesPerSecond),312500);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'resource card must not overflow');
  await page.screenshot({path:join(evidence,label+'-expanded.png'),fullPage:true});
  await page.getByRole('button',{name:'5 min',exact:true}).click();
  await page.getByText(/2 recorded readings/).waitFor();
  assert.equal(requests.at(-1).to-requests.at(-1).from,300_000);
  assert.ok(Math.abs(requests.at(-1).to-(Date.now()+3_600_000)) < 5_000,'rolling history follows the source clock');
  assert.equal(await page.getByRole('button',{name:'5 min',exact:true}).getAttribute('aria-pressed'),'true');
  const refresh=page.getByRole('button',{name:'Refresh history',exact:true});
  await refresh.click();
  await page.getByText('Reading history…',{exact:true}).waitFor();
  assert.equal(await page.getByText(/2 recorded readings/).isVisible(),true,'refresh must retain the previous chart');
  assert.equal(await refresh.evaluate(node=>node===document.activeElement),true,'refresh must keep focus');
  await page.getByText('Reading history…',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.locator('[data-block-id="device-history-uploadmbps-bar"][hidden]').count(),22,'missing intervals must remain gaps');
  assert.equal(await page.locator('[data-block-id="device-history-trends"]').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),2);
  await page.getByText('Device resource targets',{exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:join(evidence,label+'-history-top.png')});
  await page.getByText('Interval readings',{exact:true}).click();
  await page.getByText('Download: 0 Mbps',{exact:true}).first().waitFor();
  await page.getByText('Sync CPU: Unavailable',{exact:true}).first().waitFor();
  await page.getByText('No readings',{exact:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'history and its expanded readings must not overflow');
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await page.screenshot({path:join(evidence,label+'-history.png'),fullPage:true});
  failNextMinute=true;
  await page.getByRole('button',{name:'1 min',exact:true}).click();
  await page.getByText('Reading history…',{exact:true}).waitFor();
  assert.equal(await page.getByText(/No measurements in this window/).isVisible(),false);
  await page.getByText('Fixture history interrupted',{exact:true}).waitFor();
  assert.equal(await page.getByText('Fixture history interrupted',{exact:true}).count(),1);
  await refresh.click();
  await page.getByText(/2 recorded readings/).waitFor();
  await page.getByRole('button',{name:'24 hours',exact:true}).click();
  await page.getByText(/No measurements in this window/).waitFor();
  await page.getByRole('button',{name:'Custom',exact:true}).click();
  await page.getByLabel('From',{exact:true}).fill('2026-10-01T10:00');
  await page.getByLabel('To',{exact:true}).fill('2026-10-01T11:45');
  await page.getByRole('button',{name:'Apply dates'}).click();
  await page.getByText(/2 recorded readings/).waitFor();
  assert.equal(requests.at(-1).to-requests.at(-1).from,105*60_000);
  assert.equal(requests.at(-1).to, await page.evaluate(()=>Date.parse('2026-10-01T11:45')),'custom dates use the requested absolute range');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'custom date controls must not overflow');
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await page.evaluate(()=>window.resourceFixture.setMode('stale'));
  await page.getByText(/Last measurements · waiting for a new reading/).waitFor();
  await page.getByText('1.5 Mbps / 2.5 Mbps shared',{exact:true}).waitFor();
  await page.evaluate(()=>window.resourceFixture.setMode('refreshing'));
  await page.getByText(/Last measurements · waiting for a new reading/).waitFor();
  await page.getByText('1.5 Mbps / 2.5 Mbps shared',{exact:true}).waitFor();
  await page.getByText('3% (3 of 3 scopes) · last measured / 15 % target',{exact:true}).waitFor();
  await page.screenshot({path:join(evidence,label+'-refresh-retained.png'),fullPage:true});
  await page.evaluate(()=>window.resourceFixture.setMode('idle'));
  await page.getByText(/Idle · no active Sync or Backup/).waitFor();
  await page.getByText('0 Mbps / 2.5 Mbps shared',{exact:true}).waitFor();
  await page.evaluate(()=>window.resourceFixture.setMode('unknown'));
  await page.getByText('1.5 Mbps / 2.5 Mbps shared',{exact:true}).waitFor();
  await page.getByText(/Last measurements · waiting for a new reading/).waitFor();
  assert.equal(await page.locator('progress').count(),0,'unknown values must not animate indeterminate progress');
  assert.equal(await page.locator('[role="meter"][aria-hidden="true"]').count(),0,'retained readings remain labeled historical measurements');
  await page.screenshot({path:join(evidence,label+'-unavailable.png'),fullPage:true});
 }
 await page.goto(origin+'/?mode=remote-missing');
 await page.getByText('No resource reading yet.',{exact:true}).waitFor();
 assert.equal(await page.locator('[role="meter"][aria-hidden="true"]').count(),4,'cold start does not invent measurements');
 await page.goto(origin+'/?mode=local');
 await page.getByText('0 Mbps / 40 Mbps shared',{exact:true}).waitFor();
 assert.equal(await page.getByText('Remote device resources are unavailable.',{exact:true}).count(),0);
 await page.evaluate(()=>window.startLocalResourceFixture());
 await page.getByText('Unavailable / 40 Mbps shared',{exact:true}).waitFor();
 await page.evaluate(()=>window.resourceFixture.invalidate());
 await page.getByText('Sign in to view this device’s private Sync resources.',{exact:true}).waitFor();
 assert.equal(await page.getByText('0 Mbps / 40 Mbps shared',{exact:true}).count(),0);
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,views:['desktop','mobile'],checks:['actual Builder bar primitives','background edit preservation','selected-device save','full scroll and overflow','cold unknown bars and retained historical readings','history window and custom date transport','measured zero vs missing intervals','confirmed idle and scoped monotonic sample retention','identity invalidation clears measurements','local idle and active readings vs missing remote']},null,2));console.log('Sync resource dashboard desktop/mobile checks passed. Evidence: '+evidence);
}catch(error){if(context?.pages()[0]){await context.pages()[0].screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error((await context.pages()[0].locator('body').innerText()).slice(0,2500));}throw error;}finally{await context?.close();if(server){server.close();await once(server,'close');}await rm(scratch,{recursive:true,force:true});}
