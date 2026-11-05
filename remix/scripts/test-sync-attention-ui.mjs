import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
const root = resolve(import.meta.dirname, '..'), port = 28217;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-sync-attention-ui'));
const require = createRequire(join(root, '../MCP/package.json'));
const dir=await mkdtemp(join(tmpdir(),'thingtime-sync-attention-'));
let context,server;const results=[],errors=[];
try {
 await mkdir(evidence,{recursive:true});
 await require('esbuild').build({entryPoints:[join(root,'scripts/sync-attention.browser.tsx')],bundle:true,format:'esm',platform:'browser',target:'esnext',outfile:join(dir,'fixture.js'),tsconfig:join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},logLevel:'error',loader:{'.wasm':'file'},plugins:[{name:'synthetic-no-bootstrap',setup(build){
  build.onResolve({filter:/mobile-sync-editor\.browser$/},()=>({path:join(root,'scripts/mobile-sync-editor.browser.tsx'),sideEffects:true}));
  build.onLoad({filter:/environmentGateway\.ts$/},()=>({contents:'export const gatewayDescriptor = () => null;',loader:'ts'}));
  build.onLoad({filter:/mobile-sync-editor\.browser\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('{taskQA && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}','{false && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}'),loader:'tsx',resolveDir:join(root,'scripts')}));
 }}]});
 await require('esbuild').build({entryPoints:[join(root,'scripts/remote-device-sync.browser.tsx')],bundle:true,format:'esm',platform:'browser',target:'esnext',outfile:join(dir,'remote.js'),tsconfig:join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},loader:{'.wasm':'file'},logLevel:'error',plugins:[{name:'remote-attention-state',setup(build){build.onLoad({filter:/remote-device-sync\.browser\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('jobs: [], task: null','jobs: [{ connectionId: "documents-sync", state: "attention", intervalMs: 300000 }], task: null'),loader:'tsx',resolveDir:join(root,'scripts')}));}}]});
 const remoteBundle=await readFile(join(dir,'remote.js'));
 const bundle=await readFile(join(dir,'fixture.js'));
 server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'application/javascript':'text/html','Cache-Control':'no-store'});res.end(req.url==='/remote.js'?remoteBundle:req.url==='/fixture.js'?bundle:'<!doctype html><title>[QA] Attention regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="'+(req.url==='/remote'?'/remote.js':'/fixture.js')+'"></script>');});
 server.listen(port,'127.0.0.1');await once(server,'listening');
 context=await require('playwright').chromium.launchPersistentContext(join(dir,'profile'),{headless:true,downloadsPath:join(dir,'downloads'),acceptDownloads:false});
 const page=context.pages()[0];page.on('pageerror',e=>{errors.push(e.message);console.error('fixture-pageerror:',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('fixture-console:',m.text());});
 for(const [label,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${port}/?platform=desktop&tasks`);
  await page.getByRole('button',{name:'Expand folder',exact:true}).last().click();
  await page.getByRole('button',{name:'Edit',exact:true}).first().waitFor();
  await page.getByText('Automatic sync',{exact:true}).click();
  const panel=page.locator('[data-settings-document="file-sync-automation"]');
  for(const kind of ['legacy','generic','authorization']){
   await page.evaluate(kind=>window.attentionFixture.fail(kind),kind);
   await panel.getByRole('button',{name:'Retry automatic sync',exact:true}).waitFor();
   await panel.getByText(kind==='authorization'?/cloud request was refused/:/failure reason is unavailable/).waitFor();
   assert.doesNotMatch(await panel.innerText(),/changed settings|synthetic-secret|synthetic-private/);
   assert.equal(await panel.getByRole('button',{name:'Retry automatic sync',exact:true}).isEnabled(),true);
   await page.screenshot({path:join(evidence,`${label}-${kind}.png`),fullPage:true});
  }
  await page.reload();await page.getByRole('button',{name:'Expand folder',exact:true}).last().click();await page.getByText('Automatic sync',{exact:true}).click();await panel.getByText(/cloud request was refused/).waitFor();
  const select=panel.getByRole('combobox',{name:'Automatic sync interval',exact:true});await select.selectOption('900000');
  await page.evaluate(()=>window.dispatchEvent(new Event('tt:sync-jobs-changed')));
  await panel.getByText(/cloud request was refused/).waitFor();assert.equal(await select.inputValue(),'900000');
  await panel.getByRole('button',{name:'Pause sync',exact:true}).click();
  await panel.getByRole('button',{name:'Resume automatic sync',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Expand folder',exact:true}).last().click();await page.getByText('Automatic sync',{exact:true}).click();await panel.getByRole('button',{name:'Resume automatic sync',exact:true}).waitFor();
  assert.equal(await select.inputValue(),'300000');
  await page.evaluate(()=>scrollTo(0,0));
  for(let step=0;step<40;step++){if(await page.evaluate(()=>scrollY+innerHeight>=document.body.scrollHeight-1))break;await page.evaluate(()=>scrollBy(0,innerHeight*.8));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(evidence,`${label}-paused.png`),fullPage:true});
  results.push({viewport:label,legacy:true,generic:true,allowlistedFailure:true,redaction:true,reload:true,draftSurvivesRefresh:true,pauseSurvivesReload:true,noOverflow:true});
 }
 for(const [label,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${port}/remote`);
  await page.getByRole('heading',{name:'Device sync & backup',exact:true}).waitFor();
  await page.locator('summary').filter({hasText:'Manage sync connections'}).click();
  await page.evaluate(()=>window.remoteSyncFixture.setOnline(true));
  await page.getByRole('button',{name:'Refresh device',exact:true}).click();
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Documents backup',exact:true})});
  await card.getByRole('button',{name:'Expand folder',exact:true}).click();
  await card.locator('summary').filter({hasText:'Automatic sync'}).click();
  await card.getByText(/Automatic sync needs attention.*failure reason is unavailable/).waitFor();
  assert.doesNotMatch(await card.innerText(),/changed settings|different settings/);
  await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(evidence,`${label}-remote-attention.png`),fullPage:true});
  results.push({viewport:label,remoteAttentionUnknown:true,noOverflow:true});
 }
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({ok:true,results,evidence}));
}catch(error){if(context){const page=context.pages()[0];await page.screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3000));}throw error;}
finally{await context?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
