import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
const root = resolve(import.meta.dirname, '..'), port = 28227;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-sync-continuity-ui'));
const require = createRequire(join(root, '../MCP/package.json'));
const dir=await mkdtemp(join(tmpdir(),'thingtime-sync-continuity-'));
let context,server;const results=[],errors=[];
try {
 await mkdir(evidence,{recursive:true});
 await require('esbuild').build({entryPoints:[join(root,'scripts/sync-continuity.browser.tsx')],bundle:true,format:'esm',platform:'browser',target:'esnext',outfile:join(dir,'fixture.js'),tsconfig:join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},logLevel:'error',loader:{'.wasm':'file'},plugins:[{name:'synthetic-no-bootstrap',setup(build){
  build.onResolve({filter:/mobile-sync-editor\.browser$/},()=>({path:join(root,'scripts/mobile-sync-editor.browser.tsx'),sideEffects:true}));
  build.onLoad({filter:/environmentGateway\.ts$/},()=>({contents:'export const gatewayDescriptor = () => null;',loader:'ts'}));
  build.onLoad({filter:/mobile-sync-editor\.browser\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('{taskQA && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}','{false && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}'),loader:'tsx',resolveDir:join(root,'scripts')}));
 }}]});
 const bundle=await readFile(join(dir,'fixture.js'));
 server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':req.url==='/fixture.js'?'application/javascript':'text/html','Cache-Control':'no-store'});res.end(req.url==='/fixture.js'?bundle:'<!doctype html><title>[QA] Attention regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});
 server.listen(port,'127.0.0.1');await once(server,'listening');
 context=await require('playwright').chromium.launchPersistentContext(join(dir,'profile'),{headless:true,downloadsPath:join(dir,'downloads'),acceptDownloads:false});
 const page=context.pages()[0];page.on('pageerror',e=>{errors.push(e.message);console.error('fixture-pageerror:',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('fixture-console:',m.text());});
 for(const [label,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${port}/?platform=desktop&tasks&history&cold`);
  await page.getByRole('status',{name:'Verifying this Mac’s account connection',exact:true}).waitFor();
  assert.equal(await page.getByRole('status',{name:'Verifying this Mac’s account connection',exact:true}).count(),1);
  await page.evaluate(()=>window.continuityFixture.releaseContext());
  await page.locator('article').filter({has:page.getByRole('heading',{name:'Conflicting documents',exact:true})}).getByRole('button',{name:'Expand folder',exact:true}).click();
  await page.getByText('Automatic sync',{exact:true}).click();
  const panel=page.locator('[data-settings-document="file-sync-automation"]');
  await page.evaluate(()=>window.continuityFixture.attention());
  await panel.getByRole('button',{name:'Retry automatic sync',exact:true}).waitFor();
  for(const kind of ['retry','scheduled']){
   const before=await page.evaluate(()=>window.continuityFixture.state().held);
   const savedBefore=await page.evaluate(()=>JSON.stringify(window.syncInspectionFixture.savedRows()));
   await page.evaluate(()=>window.continuityFixture.hold());
   let name;
   if(kind==='scheduled'){
    await page.getByRole('button',{name:'Edit',exact:true}).first().click();
    name=page.getByRole('textbox',{name:'Sync config name',exact:true});
    await name.fill(`${label} ${kind} preserved`);await name.focus();assert.equal(await name.evaluate(node=>node===document.activeElement),true,'input is focused before scheduled discovery');await name.evaluate(node=>{window.continuityDraftNode=node;});
   }
   const y=await page.evaluate(()=>scrollY);
   await panel.evaluate(node=>{window.continuityPanelNode=node;});
   if(kind==='retry')await panel.getByRole('button',{name:'Retry automatic sync',exact:true}).click();
   else await page.evaluate(()=>window.continuityFixture.schedule());
   await page.waitForFunction(before=>window.continuityFixture.state().held>before,before);
   if(name)assert.equal(await page.getByRole('button',{name:'Save sync config',exact:true}).isDisabled(),true,'active saved configuration cannot be changed');
   const currentY=await page.evaluate(()=>scrollY);
   await page.evaluate(()=>window.continuityFixture.release());
   await page.waitForFunction(()=>window.continuityFixture.state().task?.active===false);
   assert.equal(await page.evaluate(()=>window.continuityFixture.state().task?.status),'complete','actual runner finishes synthetic empty inventories');
   assert.equal(await page.evaluate(()=>JSON.stringify(window.syncInspectionFixture.savedRows())),savedBefore,'running saved configuration remains unchanged');
   assert.equal(await panel.evaluate(node=>node===window.continuityPanelNode),true,'same settings subtree survives task host ending');
   if(name){
    assert.equal(await name.inputValue(),`${label} ${kind} preserved`);
    assert.equal(await name.evaluate(node=>node===window.continuityDraftNode),true,'same mounted input survives scheduled task');
    assert.equal(await name.evaluate(node=>node===document.activeElement),true);
   }
   const position=await page.evaluate(()=>({y:scrollY,max:Math.max(0,document.documentElement.scrollHeight-innerHeight)}));
   assert.ok(Math.abs(position.y-Math.min(currentY,position.max))<=height/4,'scroll stays in the same region while status text reflows and completion content shrinks: '+JSON.stringify({position,currentY}));
   assert.equal(await page.getByRole('button',{name:'Collapse folder',exact:true}).count(),1);
   assert.equal(await page.getByRole('status',{name:'Verifying this Mac’s account connection',exact:true}).count(),0);
   await page.screenshot({path:join(evidence,`${label}-${kind}-preserved.png`),fullPage:true});
   if(name)await page.getByRole('button',{name:'Discard draft',exact:true}).first().click();
  }
  await page.evaluate(()=>scrollTo(0,0));for(let n=0;n<40;n++){if(await page.evaluate(()=>scrollY+innerHeight>=document.body.scrollHeight-1))break;await page.evaluate(()=>scrollBy(0,innerHeight*.8));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{localStorage.clear();window.continuityFixture.invalidate();});
  await page.getByText('Folders on this Mac',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('textbox',{name:'Sync config name',exact:true}).count(),0);
  results.push({viewport:label,actualExplicitRetry:true,actualScheduledDiscovery:true,sameInputNode:true,expansionDraftFocusScrollPreserved:true,identityClear:true,noOverflow:true});
 }
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({ok:true,results,evidence}));
}catch(error){if(context){const page=context.pages()[0];await page.screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3000));}throw error;}
finally{await context?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
