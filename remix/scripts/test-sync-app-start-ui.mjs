import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';

const root = resolve(import.meta.dirname, '..'), port = 28347;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-sync-app-start'));
const require = createRequire(join(root, '../MCP/package.json'));
const dir = await mkdtemp(join(tmpdir(), 'thingtime-sync-app-start-'));
let context, server, page;
const errors = [];
try {
 let source = await readFile(join(root, 'scripts/mobile-sync-editor.browser.tsx'), 'utf8');
 source = source.replace('<CurrentPageBuilderFixture><Fixture /></CurrentPageBuilderFixture>', '<CurrentPageBuilderProvider><Fixture /></CurrentPageBuilderProvider>');
 source = source.replace('<ChakraProvider>', '<ChakraProvider><CurrentPageBuilderToggle />');
 source = source.replace('{taskQA && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}',
  "{taskQA && !new URLSearchParams(location.search).has('seed') && <><NativeSyncBootstrap ownerId={ownerId} generation={0} /><SyncStartupNotice ownerId={ownerId} generation={0} /></>}");
 source += `
import { syncStartup } from '../app/fileSync/syncStartup';
import { SyncStartupNotice } from '../app/fileSync/SyncStartupNotice';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import { CurrentPageBuilderProvider, CurrentPageBuilderToggle } from '../app/components/Builder/CurrentPageBuilder';
const startupEvents:any[]=[];
window.addEventListener('tt:sync-startup-started',(event:any)=>startupEvents.push(event.detail));
const unhandledFixtureRequests:string[]=[];
const fixtureTrace:string[]=[];
const fixtureFetch=window.fetch;
window.fetch=async(input:any,init?:any)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 fixtureTrace.push('fetch '+url.pathname+url.search);
 if(url.pathname==='/api/v1/webpages/resolve') return Response.json({ok:false},{status:404});
 if(url.pathname==='/api/v1/capabilities') return Response.json({ok:true,schemaVersion:1,origin:location.origin,
  features:Object.fromEntries(Object.entries(thingtimeCapabilityManifest(location.origin).features).map(([key,value])=>[key,value.version]))});
 if(url.pathname==='/api/v1/notifications/record') return Response.json({ok:true});
 if(url.pathname==='/api/v1/things/storage-policy') return Response.json({ok:true,revision:null,rules:[],nextCursor:null});
 const result=await fixtureFetch(input,init);
 if(url.pathname.startsWith('/api/') && result.headers.get('content-type')?.includes('text/html')) unhandledFixtureRequests.push(url.pathname+url.search);
 return result;
};
if(new URLSearchParams(location.search).has('hold-discovery')) {
 const originalFetch=window.fetch;
 let held=false;
 window.fetch=async(input:any,init?:any)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
  if(!held && url.pathname==='/api/v1/things' && rows.some(row=>row.thingtime.includes('file-sync') && row.id===url.searchParams.get('id'))) {
   held=true;
   await new Promise<void>(resolve=>Object.assign(window,{releaseDiscovery:resolve}));
  }
  return originalFetch(input,init);
 };
}
Object.assign(window, { appStartFixture: {
 read: syncStartup.read,
 events:()=>startupEvents,
 unhandled:()=>unhandledFixtureRequests,
 trace:()=>fixtureTrace,
 photoWakes:()=>startupPhotoWakes,
 enablePhotos() {
  const existing=rows.find(row=>row.thingtime.includes('file-sync'));
  const photoRoot='33333333-3333-4333-8333-333333333333';
  const photo={...structuredClone(existing),id:'startup-photo-config',crystal:{...structuredClone(existing.crystal),sourceKind:'photos',localRootId:photoRoot}};
  rows.push(photo); roots.push({id:photoRoot,name:'Photos',sourceKind:'photos',photoAccess:'full',readOnly:true});
  const bridge=window.thingtimeNativeBridge!, original=bridge.postMessage;
  bridge.filePhotoAutomationVersion='1.8.0';
  bridge.postMessage=(message:any)=>{
   const request=message.payload;
   fixtureTrace.push('native '+request.action);
   if(!['photo-run-status','wake-photo-run'].includes(request.action)) return original(message);
   if(request.action==='wake-photo-run') startupPhotoWakes++;
   queueMicrotask(()=>window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent,{detail:{type:'mobile-files-result',payload:{...request,roots,
    configurationRevision:photo.updatedAt,photoRunProgress:{stage:'ready',confirmed:{photos:0,videos:0,other:0,wifiBytes:0,mobileBytes:0,unknownBytes:0}},
    ...(request.action==='wake-photo-run'?{photoWakeRevision:request.configurationRevision,photoRunWake:{status:'running'}}:{})}}})));
  };
 },
 navigate: () => router.navigate('/?another-page=1'),
 async seed() {
  const row = rows.find(row => row.thingtime.includes('file-sync'));
  const saved = readOwnedFileSyncConfiguration(row, ownerId);
  const scope:any = {origin:location.origin,ownerId,deviceId,dataPlane:'home',rootId:saved.id};
  const journal = await openSyncJournal();
  try { const jobs=journal.jobs({scope,currentScope:()=>scope});
   const job=await jobs.admit(saved,crypto.randomUUID(),300000); await jobs.finish(job,Date.now());
  } finally {journal.close();}
 }
} });
let startupPhotoWakes=0;
if(new URLSearchParams(location.search).has('busy')) {
 void nativeSyncTasks.start({origin:location.origin,ownerId,deviceId,dataPlane:'home',rootId:'already-running'},
  () => new Promise<void>(resolve=>Object.assign(window,{releaseBusy:resolve})));
}
`;
 await require('esbuild').build({ stdin: { contents: source, loader: 'tsx', resolveDir: join(root, 'scripts') }, bundle: true,
  format: 'esm', platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
 const bundle = await readFile(join(dir, 'fixture.js'));
 server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': req.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  res.end(req.url === '/fixture.js' ? bundle : '<!doctype html><title>[QA] Automatic sync startup</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
 });
 server.listen(port, '127.0.0.1'); await once(server, 'listening');
 const { chromium } = require('playwright');
 context = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, acceptDownloads: false });
 page = context.pages()[0]; const results = [];
 page.on('pageerror', error => errors.push(error.message));
 await mkdir(evidence, { recursive: true });
 const base = `http://127.0.0.1:${port}/?platform=ios&tasks&away&hold-scan`;
 await page.goto(base + '&seed');
 await page.waitForFunction(() => !!window.appStartFixture);
 await page.evaluate(() => window.appStartFixture.seed());
 await page.goto(base + '&hold-discovery');
 await page.waitForFunction(() => !!window.releaseDiscovery);
 await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
 await page.getByText('Checking automatic sync…', { exact: true }).waitFor();
 assert.equal(await page.getByText('Device File Syncing has been started for all configs', { exact: true }).count(), 0);
 await page.getByRole('button', { name: 'Leave Files screen', exact: true }).click();
 await page.evaluate(() => window.releaseDiscovery());
 await page.waitForFunction(() => window.syncInspectionFixture.pendingScans() === 1);
 assert.equal(await page.getByRole('button', { name: 'Upload now', exact: true }).count(), 0, 'sync starts on a non-Files page');
 await page.getByText('Device File Syncing has been started for all configs', { exact: true }).waitFor();
 assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans), 1, 'StrictMode admits once');
 const lists = await page.evaluate(() => window.syncInspectionFixture.observations.lists);
 await page.evaluate(async () => { window.appStartFixture.enablePhotos(); await window.appStartFixture.navigate(); dispatchEvent(new Event('focus')); dispatchEvent(new Event('pageshow')); });
 await page.waitForFunction(() => window.appStartFixture.photoWakes() > 0, undefined, { timeout: 8000 });
 assert.equal(await page.evaluate(() => window.syncInspectionFixture.pendingScans()), 1, 'route discovery does not cancel the active automatic run');
 assert.ok(await page.evaluate(() => window.syncInspectionFixture.observations.lists) > lists);
 await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
 await page.getByText('Sync is in progress', { exact: true }).waitFor();
 assert.equal(await page.getByText('Device File Syncing has been started for all configs', { exact: true }).count(), 1);
 assert.equal(await page.evaluate(() => window.appStartFixture.events().length), 1);
 for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
  await page.setViewportSize({ width, height });
  for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight); y += height / 2) await page.evaluate(y => scrollTo(0, y), y);
  await page.evaluate(() => scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(evidence, name + '-sync-start.png'), fullPage: true });
 }
 await page.getByRole('button', { name: 'Release scan', exact: true }).click();
 await page.waitForFunction(() => window.syncInspectionFixture.task() && !window.syncInspectionFixture.task()?.active);
 const terminal = await page.evaluate(() => window.syncInspectionFixture.task()?.progress);
 assert.equal(terminal.stage, 'complete', JSON.stringify(terminal));
 results.push('Held discovery exposes one immediate checking status and no success; scheduled ordinary backup starts from a non-device route before its five-minute local cadence; a route wake discovers and wakes Photos while that automatic folder scan remains held; Files shows live progress; clustered route/focus/pageshow and StrictMode do not duplicate ordinary admission or Lopu feedback.');
 // The same saved scheduled job must queue behind an accepted transfer,
 // then start as soon as that lane settles, without cancelling it or Retry.
 await page.goto(base + '&seed'); await page.waitForFunction(() => !!window.appStartFixture); await page.evaluate(() => window.appStartFixture.seed());
 await page.goto(base + '&busy');
 await page.waitForFunction(() => window.appStartFixture.read()?.entries.some(entry => entry.outcome === 'waiting'));
 assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans), 0);
 assert.equal(await page.evaluate(() => window.syncInspectionFixture.task()?.scope.rootId), 'already-running');
 await page.evaluate(() => window.releaseBusy());
 await page.waitForFunction(() => window.syncInspectionFixture.pendingScans() === 1);
 results.push('An existing ordinary transfer remains untouched; its verified scheduled sibling queues and starts automatically when the lane becomes free.');
 assert.deepEqual(errors, []);
 await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors, isolatedProfile: true, normalNetworking: true }, null, 2));
 console.log(JSON.stringify({ passed: results.length, evidence }));
} catch (error) {
 await mkdir(evidence, { recursive: true });
 const observed = await page?.evaluate(() => ({ startup: window.appStartFixture?.read(), observations: window.syncInspectionFixture?.observations,
  task: { status: window.syncInspectionFixture?.task()?.status, progress: window.syncInspectionFixture?.task()?.progress }, unhandled:window.appStartFixture?.unhandled(), trace:window.appStartFixture?.trace(), body: document.body.innerText.slice(-6000) })).catch(() => null);
 await writeFile(join(evidence, 'failure.json'), JSON.stringify({ error: String(error), errors, observed }, null, 2));
 await page?.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
 throw error;
} finally {
 await context?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
 await rm(dir, { recursive: true, force: true });
}
