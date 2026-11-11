import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import crypto from 'node:crypto';
const evidence=import.meta.dirname,root=resolve(evidence,'../../..'),remix=join(root,'remix');
const require=createRequire(join(remix,'package.json')),esbuild=createRequire(require.resolve('tsx'))('esbuild');
const {platformRuntimePlugin}=await import(join(remix,'scripts/platform-runtime-plugin.mjs'));
const scratch=await mkdtemp(join(tmpdir(),'thingtime-device-home-ui-'));let browser,server,origin;
const results=[],errors=[];
try{
 const plugin=platformRuntimePlugin();
 await esbuild.build({entryPoints:[join(evidence,'fixture.tsx')],nodePaths:[join(remix,'node_modules')],bundle:true,format:'esm',platform:'browser',target:'esnext',outfile:join(scratch,'fixture.js'),tsconfig:join(remix,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},loader:{'.wasm':'file'},plugins:[{name:'actual-platform-document',setup(build){build.onResolve({filter:/^virtual:thingtime-platform-document$/},args=>({path:args.path,namespace:'platform-document'}));build.onLoad({filter:/.*/,namespace:'platform-document'},args=>({contents:plugin.load(plugin.resolveId(args.path)),loader:'js'}));}}],logLevel:'error'});
 const bundle=await readFile(join(scratch,'fixture.js'));
 server=createServer((request,response)=>{if(request.url==='/fixture-root-check'){setTimeout(()=>{response.writeHead(200,{'Content-Type':'application/json'});response.end('{}');},25);return;}response.writeHead(200,{'Content-Type':request.url==='/fixture.js'?'application/javascript':'text/html','Cache-Control':'no-store'});response.end(request.url==='/fixture.js'?bundle:'<!doctype html><title>[LC] Synthetic device-home recovery</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
 browser=await createRequire(join(root,'MCP/package.json'))('playwright').chromium.launch({headless:true,chromiumSandbox:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  const measure=async label=>{
   for(const position of ['top','bottom']){await page.evaluate(position=>scrollTo(0,position==='top'?0:document.documentElement.scrollHeight),position);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${label} overflow`);}
   const boxes=await page.locator('main button').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return{text:node.textContent,x:b.x,y:b.y,width:b.width,height:b.height};}));
   for(const b of boxes){assert.ok(b.x>=0&&b.x+b.width<=width+1);assert.ok(b.height>=44);}
   await page.screenshot({path:join(evidence,`${width}-${label}.png`),fullPage:true});return boxes;
  };
  try{
   await page.goto(origin);const button=page.getByRole('button',{name:'Work on this device',exact:true});await button.waitFor();
   const ready=await measure('ready');
   await page.getByRole('button',{name:'Try again',exact:true}).focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal(await button.evaluate(node=>node===document.activeElement),true);await page.screenshot({path:join(evidence,`${width}-keyboard.png`),fullPage:true});await page.keyboard.press('Enter');
   await page.waitForFunction(()=>window.recoveryFixture.snapshot().attempts===1);assert.equal(await button.getAttribute('aria-busy'),'true');assert.equal(await button.isDisabled(),true);assert.equal(await page.getByRole('heading',{name:'We couldn’t load your session'}).count(),1);
   assert.equal(await button.locator('[aria-hidden="true"]').count(),1);await measure('busy');
   await page.evaluate(()=>window.recoveryFixture.reject());await page.getByRole('alert').waitFor();assert.equal(await button.isEnabled(),true);assert.equal(await button.getAttribute('aria-busy'),'false');await measure('error');
   await button.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>window.recoveryFixture.snapshot().attempts===2);assert.equal(await page.getByRole('alert').count(),0);await page.evaluate(()=>window.recoveryFixture.resolve());await page.getByRole('heading',{name:'Synthetic initialization acknowledged'}).waitFor();
   for(const mode of ['existing','unsupported','nonretryable']){await page.goto(origin+'/?mode='+mode);await page.getByRole('heading',{name:'We couldn’t load your session'}).waitFor();if(mode!=='nonretryable')await page.waitForFunction(()=>window.recoveryFixture?.snapshot().availabilitySettled);assert.equal(await button.count(),0);assert.equal(await page.evaluate(()=>window.recoveryFixture.snapshot().attempts),0);await measure(mode);}
   await page.goto(origin);await button.waitFor();await page.evaluate(()=>window.recoveryFixture.invalidate());await button.waitFor({state:'detached'});
   results.push({width,readyButtonBounds:ready,checks:['real RootRecovery/router/controller','keyboard Tab+Enter+Space','single inline busy and disabled action','failure alert and retry clears prior error','controlled synthetic success revalidation','existing/unsupported/nonretryable hidden','identity invalidation hides action','top-bottom scroll and bounds in every state']});
  }catch(error){await page.screenshot({path:join(evidence,`${width}-failure.png`),fullPage:true});await writeFile(join(evidence,`${width}-failure.json`),JSON.stringify({message:error.message,errors,body:await page.locator('body').innerText(),fixture:await page.evaluate(()=>window.recoveryFixture?.snapshot())},null,2)+'\n');throw error;}finally{await context.close();}
 }
 assert.deepEqual(errors,[]);
 const files=['remix/app/components/Layout/RootRecovery.tsx','remix/app/components/Settings/DesktopConnectionRecovery.tsx','remix/app/local-workspace/localHomeBootstrap.ts','remix/app/local-workspace/localHomeBootstrap.client.ts','remix/app/utils/rootIdentity.ts','remix/app/utils/rootDataRecovery.ts'];
 const hashes={};for(const file of files)hashes[file]=crypto.createHash('sha256').update(await readFile(join(root,file))).digest('hex');
 await writeFile(join(evidence,'verification.json'),JSON.stringify({scope:'synthetic host/controlled response only; actual RootRecovery and shared React/router/controller; not native persistence acceptance',command:'node artifacts/anonymous-release-2026-11-12/device-home-recovery-ui/run.mjs',sourceHashes:hashes,results,errors},null,2)+'\n');
 console.log(JSON.stringify({ok:true,results}));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});await writeFile(join(evidence,'cleanup.json'),JSON.stringify({browserClosed:true,serverClosed:!server?.listening,temporaryBundleRemoved:true,scope:'only task-owned browser contexts, listener and scratch directory'},null,2)+'\n');}
