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
 const source = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ChakraProvider}from'@chakra-ui/react';import{DeviceSyncResources}from'../app/components/Devices/DeviceSyncResources';
 function Fixture(){const[revision,setRevision]=useState(0),[known,setKnown]=useState(true),[policy,setPolicy]=useState({transferBytesPerSecond:625000,scanBytesPerSecond:625000,cpuPercent:15});Object.assign(window,{resourceFixture:{refresh:()=>setRevision(x=>x+1),unknown:()=>setKnown(false),policy:()=>policy}});const remote={origin:'https://resource-fixture.invalid',policy:{...policy},active:known,status:'Synthetic selected device · observed '+revision,resources:known?{version:1,cpuPercent:3,cpuStatus:'measured',cpuScopes:['source-thread','indexer-process','transport-process'],effectiveTransferConcurrency:1,effectiveIndexingConcurrency:1,currentUploadBytesPerSecond:125000,currentDownloadBytesPerSecond:62500,scanBytesPerSecond:100000,memoryBytes:67108864,measuredAt:Date.now()}:undefined,save:async next=>{setPolicy(next);return next;}};return <ChakraProvider><main style={{maxWidth:1000,margin:'auto',padding:16}}><DeviceSyncResources ownerId='resource-fixture-owner' deviceId='resource-fixture-device' allowed={true} remote={remote}/><div style={{height:600}}>End of resource fixture</div></main></ChakraProvider>;}createRoot(document.getElementById('root')).render(<Fixture/>);`;
 await require('esbuild').build({ stdin:{contents:source,loader:'tsx',resolveDir:join(root,'scripts')},bundle:true,format:'esm',platform:'browser',target:'esnext',outfile:join(scratch,'fixture.js'),tsconfig:join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},logLevel:'error',loader:{'.wasm':'file'} });
 const bundle = await readFile(join(scratch,'fixture.js'));
 server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':request.url==='/fixture.js'?'application/javascript':'text/html','Cache-Control':'no-store'});response.end(request.url==='/fixture.js'?bundle:'<!doctype html><meta charset="utf-8"><title>[QA] Sync resource dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});
 server.listen(28269,'127.0.0.1');await once(server,'listening');
 context=await require('playwright').chromium.launchPersistentContext(join(scratch,'profile'),{headless:true,downloadsPath:join(scratch,'downloads'),acceptDownloads:false});
 const page=context.pages()[0], errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Fixture browser error:',error.message);});
 page.on('console',message=>{if(message.type()==='error')console.error('Fixture console:',message.text());});
 await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:28269'?route.continue():route.abort());
 await mkdir(evidence,{recursive:true});
 for(const[label,width,height]of[['desktop',1440,1000],['mobile',375,812]]){
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:28269');
  await page.getByRole('heading',{name:'Total Sync & Backup usage'}).waitFor();
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
  await page.evaluate(()=>window.resourceFixture.unknown());
  await page.getByText('Unavailable / 2.5 Mbps shared',{exact:true}).waitFor();
  assert.equal(await page.locator('progress').count(),0,'unknown values must not animate indeterminate progress');
  assert.equal(await page.locator('[role="meter"][aria-hidden="true"]').count(),4,'unknown bars are decorative, never announced as measured zero');
  await page.screenshot({path:join(evidence,label+'-unavailable.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,views:['desktop','mobile'],checks:['actual Builder bar primitives','background edit preservation','selected-device save','full scroll and overflow','unknown static bars']},null,2));console.log('Sync resource dashboard desktop/mobile checks passed. Evidence: '+evidence);
}catch(error){if(context?.pages()[0]){await context.pages()[0].screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error((await context.pages()[0].locator('body').innerText()).slice(0,2500));}throw error;}finally{await context?.close();if(server){server.close();await once(server,'close');}await rm(scratch,{recursive:true,force:true});}
