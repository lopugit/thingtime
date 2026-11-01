import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';
const root = resolve(import.meta.dirname, '..'), port = 28197;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-sync-pause-ui'));
const require = createRequire(join(root, '../MCP/package.json'));
if (!process.env.TT_SYNC_PAUSE_WORKER) {
 const dir = await mkdtemp(join(tmpdir(), 'thingtime-sync-pause-'));
 try {
  const original = join(root, 'app/fileSync/journal.client.ts');
  await require('esbuild').build({ entryPoints: [join(root, 'scripts/sync-pause.browser.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error', plugins: [{name:'isolated-pause-gates', setup(build) {
   build.onResolve({filter:/mobile-sync-editor\.browser$/},()=>({path:join(root,'scripts/mobile-sync-editor.browser.tsx'),sideEffects:true}));
   build.onResolve({filter:/journal\.client(?:\.ts)?$/},()=>({path:'journal',namespace:'pause-journal'}));
   build.onResolve({filter:/journal\.client\.ts\?real$/},()=>({path:original}));
   build.onLoad({filter:/.*/,namespace:'pause-journal'},()=>({contents:`export * from ${JSON.stringify(original+'?real')}; import {openSyncJournal as open} from ${JSON.stringify(original+'?real')}; export async function openSyncJournal(...args){const journal=await open(...args);return {...journal,jobs:(...args)=>{const jobs=journal.jobs(...args);return {...jobs,read:async()=>{const fixture=window.pauseFixture;if(fixture?.holdReads){fixture.reads++;await fixture.readGate;}return jobs.read();}};}};}`,resolveDir:root}));
   build.onLoad({filter:/mobile-sync-editor\.browser\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('{taskQA && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}','{false && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}'),loader:'tsx',resolveDir:join(root,'scripts')}));
  }}] });
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:dir,TT_SYNC_PAUSE_WORKER:dir};
  await verifyAccountBackupIsolation(port,env);
  const child=isolatedAccountBackupProcess(process.execPath,[import.meta.filename,evidence],{env,stdio:'inherit'},port,true);
  const timeout=setTimeout(()=>child.kill('SIGTERM'),120_000);
  try {const [code]=await once(child,'exit');assert.equal(code,0);}finally{clearTimeout(timeout);}
 } finally {await rm(dir,{recursive:true,force:true});}
} else {
 const dir=process.env.TT_SYNC_PAUSE_WORKER,bundle=await readFile(join(dir,'fixture.js'));
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':req.url==='/fixture.js'?'application/javascript':'text/html','Cache-Control':'no-store'});res.end(req.url==='/fixture.js'?bundle:'<!doctype html><title>[QA] Pause regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});
 server.listen(port,'127.0.0.1');await once(server,'listening');
 let context;const results=[],errors=[];
 try {
  await mkdir(evidence,{recursive:true});
  context=await require('playwright').chromium.launchPersistentContext(join(dir,'profile'),{headless:true,downloadsPath:join(dir,'downloads'),acceptDownloads:false});
  const page=context.pages()[0];page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')console.error('browser-console:',msg.text());});page.on('requestfailed',request=>console.error('browser-request:',request.url(),request.failure()?.errorText));
  const probe=await context.newPage();await assert.rejects(probe.goto('http://192.0.2.1:443/blocked',{timeout:3000}));await probe.close();
  const readJobs=()=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('thingtime-file-sync-v1');r.onsuccess=()=>resolve(r.result);});try{return await new Promise(resolve=>{const r=db.transaction('sync-admitted-jobs').objectStore('sync-admitted-jobs').getAll();r.onsuccess=()=>resolve(r.result);});}finally{db.close();}});
  for(const [label,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
   await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${port}/?platform=desktop&tasks&home`);
   await page.getByRole('button',{name:'Edit',exact:true}).first().waitFor();
   await page.evaluate(()=>window.pauseFixture.start());
   await page.getByRole('button',{name:'Pause sync',exact:true}).first().waitFor();
   await page.evaluate(()=>window.pauseFixture.hold());
   await page.getByRole('button',{name:'Leave Files screen',exact:true}).click();
   await page.getByRole('button',{name:'Reopen Files screen',exact:true}).click();
   await page.waitForFunction(()=>window.pauseFixture.reads>0);
   const pause=page.getByRole('button',{name:'Pause sync',exact:true});
   assert.ok(await pause.count()>=2,'both connection and automatic pause controls present');
   for(const button of await pause.all())assert.equal(await button.isEnabled(),true);
   const priority=page.locator('textarea').first();await priority.fill('Important/unfinished-draft');
   const readsBefore=await page.evaluate(()=>window.pauseFixture.reads);
   await page.evaluate(()=>window.pauseFixture.storm());
   await page.waitForFunction(()=>document.body.innerText.includes('1000 of 2000 operations confirmed'));
   assert.equal(await priority.inputValue(),'Important/unfinished-draft');assert.equal(await priority.evaluate(el=>document.activeElement===el),true);
   assert.equal(await page.evaluate(()=>window.pauseFixture.reads),readsBefore);
   assert.equal(await page.evaluate(()=>window.pauseFixture.state().task.progress.confirmed),1000);
   const resourceStatus=page.locator('[data-settings-document="file-sync-resource-status"]');
   await resourceStatus.getByText('sync CPU: 12% of total CPU capacity.',{exact:true}).waitFor();
   await resourceStatus.getByText('effective simultaneous file/folder transfers: 2.',{exact:true}).waitFor();
   await resourceStatus.getByText('effective indexing workers: 3.',{exact:true}).waitFor();
   await resourceStatus.getByText('upload pace: 312.5 bytes/s cap.',{exact:true}).waitFor();
   await resourceStatus.screenshot({path:join(evidence,`${label}-resources-current.png`)});
   await pause.last().click();
   assert.equal(await page.evaluate(()=>window.pauseFixture.state().aborted),true);
   assert.equal(await page.evaluate(()=>window.pauseFixture.state().task.stopping),true);
   const stopping=page.getByRole('button',{name:'Pausing…',exact:true});
   await stopping.first().waitFor();for(const button of await stopping.all())assert.equal(await button.isDisabled(),true);
   await page.screenshot({path:join(evidence,`${label}-stopping.png`),fullPage:true});
   await page.evaluate(()=>{window.pauseFixture.releaseReads();window.pauseFixture.releasePause();});
   await page.waitForFunction(()=>window.pauseFixture.state().task?.active===false);
   await resourceStatus.getByText('Last reported sync CPU: 12% of total CPU capacity.',{exact:true}).waitFor();
   await resourceStatus.getByText(/Saved observation; this is not a current CPU measurement/).waitFor();
   await resourceStatus.getByRole('button',{name:'Edit layout',exact:true}).click();
   await resourceStatus.locator('[data-block-id="sync-resource-status-cpu"]').click();
   for(const [id,text]of [['sync-resource-status-cpu','Observed: {syncResources.cpu}'],['sync-resource-status-transfers','Concurrency: {syncResources.transfers}']]){
    await page.getByRole('combobox',{name:'Select block',exact:true}).selectOption(id);
    await page.getByRole('textbox',{name:'Block text',exact:true}).fill(text);
   }
   await page.getByRole('button',{name:'Close builder',exact:true}).click();
   await resourceStatus.getByRole('button',{name:'Save layout',exact:true}).click();
   await resourceStatus.getByText('Unsaved layout',{exact:true}).waitFor({state:'hidden'});
   await resourceStatus.getByRole('button',{name:'Done editing layout',exact:true}).click();
   await resourceStatus.getByText('Observed: Last reported sync CPU: 12% of total CPU capacity.',{exact:true}).waitFor();
   await resourceStatus.screenshot({path:join(evidence,`${label}-resources-saved.png`)});
   assert.equal((await readJobs())[0].state,'paused');console.log(label,'pause-during-held-read-immediate-abort-stopping-durable-PASS');
   await page.reload();await page.getByRole('button',{name:'Resume automatic sync',exact:true}).waitFor();
   assert.equal((await readJobs())[0].state,'paused');
   assert.equal(await page.evaluate(()=>window.pauseFixture.state().task),null);
   await page.getByRole('button',{name:'Edit',exact:true}).first().click();
   const resources=page.locator('[data-settings-document="file-sync-resources"]');
   await resources.getByRole('textbox',{name:'Upload speed',exact:true}).fill('2.5');
   await resources.getByRole('combobox',{name:'Upload speed unit',exact:true}).selectOption('Kbps');
   await resources.getByRole('textbox',{name:'Maximum simultaneous file and folder transfers',exact:true}).fill('2');
   await resources.getByRole('textbox',{name:'Maximum indexing workers',exact:true}).fill('3');
   await resources.getByRole('textbox',{name:'CPU target (%)',exact:true}).fill('25');
   const cpu=resources.getByRole('textbox',{name:'CPU target (%)',exact:true});await cpu.fill('101');
   assert.equal(await cpu.inputValue(),'101');assert.equal(await page.getByRole('button',{name:'Save connection',exact:true}).isDisabled(),true);await cpu.fill('25');assert.equal(await page.getByRole('button',{name:'Save connection',exact:true}).isEnabled(),true);
   await resources.getByRole('button',{name:'Edit layout',exact:true}).click();
   await resources.locator('[data-block-id="resources-title"]').click();
   for(const [id,text]of [['resources-title','My resource limits'],['upload-label','My upload ceiling'],['upload-kbps','Kilobits per second']]){
    await page.getByRole('combobox',{name:'Select block',exact:true}).selectOption(id);
    await page.getByRole('textbox',{name:'Block text',exact:true}).fill(text);
   }
   for(const id of ['upload-input','upload-unit','transfer-concurrency-input','cpu-percent-input']){
    await page.getByRole('combobox',{name:'Select block',exact:true}).selectOption(id);
    assert.equal(await page.getByRole('combobox',{name:'Select block',exact:true}).inputValue(),id);
   }
   await page.getByRole('button',{name:'Close builder',exact:true}).click();
   await resources.getByRole('button',{name:'Save layout',exact:true}).click();
   await resources.getByText('Unsaved layout',{exact:true}).waitFor({state:'hidden'});
   await resources.getByRole('button',{name:'Done editing layout',exact:true}).click();
   await page.getByRole('button',{name:'Save connection',exact:true}).click();
   await page.getByRole('button',{name:'Save connection',exact:true}).waitFor({state:'hidden'});
   const config=await page.evaluate(()=>window.syncInspectionFixture.savedRows().find(row=>row.thingtime.includes('file-sync')).crystal);
   assert.equal(config.configurationVersion,3);assert.equal(config.resourceLimits.uploadBytesPerSecond,312.5);assert.equal(config.resourceLimits.cpuPercent,25);
   await page.getByRole('button',{name:'Edit',exact:true}).first().click();
   const name=page.getByRole('textbox',{name:'Connection name',exact:true});await name.fill(`${label} draft preserved`);
   const before=await name.inputValue();
   await page.evaluate(()=>window.dispatchEvent(new Event('tt:sync-jobs-changed')));
   assert.equal(await name.inputValue(),before);assert.equal(await name.evaluate(el=>document.activeElement===el),true);
   await page.evaluate(()=>scrollTo(0,0));
   for(let step=0;step<40;step++){const end=await page.evaluate(()=>scrollY+innerHeight>=document.body.scrollHeight-1);if(end)break;await page.evaluate(()=>scrollBy(0,innerHeight*.8));}

   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:join(evidence,`${label}-draft.png`),fullPage:true});
   results.push({viewport:label,pauseDuringDelayedRead:true,immediateAbort:true,stopping:true,reloadPaused:true,draftPreserved:true,progressStormFocusPreserved:true,resourceFormBuilderEdits:true,invalidDraftBlocksSave:true,currentAndSavedResourceStatus:true,nestedStatusBuilderEdits:true});
   // Remove only synthetic fixture storage between viewport cases.
   await page.evaluate(async()=>{localStorage.clear();await new Promise(resolve=>{const r=indexedDB.deleteDatabase('thingtime-file-sync-v1');r.onsuccess=r.onblocked=()=>resolve();});});
  }
  assert.deepEqual(errors,[]);await writeFile(join(evidence,'results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({ok:true,results,evidence}));
 }catch(error){if(context){const page=context.pages()[0];await page.screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error(JSON.stringify({errors,body:await page.locator('body').innerText().catch(()=>''),failure:error.message}));}throw error;}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
}
