import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, '../MCP/package.json'));
const dir = await mkdtemp(join(tmpdir(), 'tt-photo-stable-ui-'));
const evidence = resolve(process.argv[2] || '/tmp/thingtime-photo-stable-ui');
let server, browser;
try {
 await mkdir(evidence, { recursive: true });
 let source = await readFile(join(root, 'scripts/mobile-sync-editor.browser.tsx'), 'utf8');
 source = `import { SyncFolderCard } from '../app/components/Devices/SyncFolderCard';
 import { SyncConfigurationForm } from '../app/components/Devices/MobileSyncConnections';
 import { nativePhotoActivityDisplay, nativePhotoRunGlance } from '../app/components/Devices/nativePhotoRunView';\n` + source;
 source = `import { photoQueueDisplay } from '../app/components/Devices/syncFolderCardBlocks';\n` + source;
 source = source.replace('<Fixture />', '<PhotoStableFixture />');
 source += `
 const photoTransport = { origin: canonicalOrigin, currentOrigin: () => canonicalOrigin, fetch: (input,init={}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, canonicalOrigin);
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return Promise.resolve(fixtureJson(thingtimeCapabilityManifest(canonicalOrigin)));
  const headers = new Headers(init.headers);
  headers.set('X-Thingtime-Expected-Api-Origin',canonicalOrigin);headers.set('X-Thingtime-Expected-Actor',ownerId);headers.set('X-Thingtime-Expected-Data-Plane','home');
  return window.fetch(location.origin+url.pathname+url.search,{...init,headers});
 }};
 function PhotoStableFixture() {
  const [view, setView] = useState<any>();
  const [draft, setDraft] = useState<any>(() => JSON.parse(localStorage.getItem('photo-stable-saved') || 'null') || {
   version: 1, id: 'photos-test', baseUpdatedAt: null, exclusions: '', pending: false,
   configuration: { configurationVersion: 4, name: 'Photo backup', localRootId: 'photo-root', deviceId,
    remoteFolderId: 'cloud-documents', sourceKind: 'photos', mode: 'backup', network: 'wifi', paused: false,
    chargingOnly: false, propagateDeletes: false }
  });
  Object.assign(window, { photoStableView: setView, photoStableDraft: () => draft });
  return <ChakraProvider><Box maxWidth="760px" margin="auto" padding={4}>
   <Text as="h1">Photos backup UI regression</Text>
   <SyncFolderCard title="Photo backup with a long but readable configuration name" path="Photo Library" description="Photos backup" stats="Native backup status"
    uploadOnly glance={nativePhotoRunGlance(view)} photoQueue={photoQueueDisplay({pending:view?.progress?.pendingOriginals,
     unavailable:view?.progress?.unavailableOriginals,unavailableReasons:view?.progress?.unavailableReasons})}
    photoActivity={nativePhotoActivityDisplay(view, false, true)} scopeKey="stable-photo-ui" accountTransport={photoTransport} expanded>
    <SyncConfigurationForm draft={draft} roots={[{id:'photo-root', name:'Photo Library', sourceKind:'photos', photoAccess:'full'}]}
     folders={[]} disabled={false} photoAutomation onChange={setDraft} accountTransport={photoTransport} scopeKey="stable-photo-editor" />
    <Button onClick={() => localStorage.setItem('photo-stable-saved', JSON.stringify(draft))}>Save fixture settings</Button>
   </SyncFolderCard><Text id="after-card">End of backup settings</Text>
  </Box></ChakraProvider>;
 }
 `;
 await require('esbuild').build({ stdin: { contents: source, resolveDir: join(root, 'scripts'), loader: 'tsx' }, bundle: true,
  format: 'esm', platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
  loader: { '.wasm': 'file' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
 const bundle = await readFile(join(dir, 'fixture.js'));
 server = createServer((req,res) => {res.writeHead(200, {'Content-Type':req.url==='/fixture.js'?'application/javascript':'text/html'});
  res.end(req.url==='/fixture.js'?bundle:'<!doctype html><title>[QA] Photos backup</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 browser = await require('playwright').chromium.launch({headless:true});
 const results = [];
 for (const [label,width,height] of [['desktop',1440,1000],['phone',390,844]]) {
  const context = await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?platform=desktop&tasks&photos');
  await page.getByLabel('Average upload speed',{exact:true}).waitFor();
  await page.getByText('Backup activity',{exact:true}).waitFor();
  const activity=page.locator('details[data-block-id="folder-card-activity"]');
  assert.equal(await activity.evaluate(el=>el.open),true,'activity starts expanded');
  assert.equal(await page.locator('[data-block-id="connection-glance-download"]').count(),0,'Photos backup has no inactive download panel');
  const bounds = () => page.locator('#after-card').evaluate(el=>el.getBoundingClientRect().top+window.scrollY);
  const blockBounds=()=>page.locator('[data-block-id]').evaluateAll(els=>Object.fromEntries(els.filter(el=>el.dataset.blockId.includes('activity')||el.dataset.blockId.includes('connection-glance')).map(el=>[el.dataset.blockId,{y:el.getBoundingClientRect().top+scrollY,h:el.getBoundingClientRect().height}])));
  const beforeBlocks=await blockBounds(); const before=await bounds();
  const progress={stage:'uploading',pendingOriginals:75985,unavailableOriginals:30000,unavailableReasons:{'cloud-download':20000,'photo-read':10000},confirmed:{photos:32,videos:2,other:0,wifiBytes:4000000,mobileBytes:0,unknownBytes:0},uploadBytesPerSecond:591250,currentFile:{sentBytes:2000000,totalBytes:3000000},
   activity:{phase:'uploading',indexed:{photos:100,videos:20,files:120},prepared:{completed:5,total:10},backlogOriginals:88,
    events:Array.from({length:15},(_,i)=>({phase:'uploading',at:new Date(1700000000000+i*1000).toISOString()}))}};
  await page.evaluate(progress=>window.photoStableView({revision:'v1',stale:false,progress}),progress);
  await page.getByText('4.73 Mbps live',{exact:true}).waitFor();
  const after=await bounds();
  await page.screenshot({path:join(evidence,label+'-uploading.png'),fullPage:true});
  if(Math.abs(before-after)>2){const afterBlocks=await blockBounds();console.log(Object.fromEntries(Object.entries(afterBlocks).filter(([id,b])=>JSON.stringify(b)!==JSON.stringify(beforeBlocks[id])).map(([id,b])=>[id,{before:beforeBlocks[id],after:b}])));await page.screenshot({path:join(evidence,label+'-failed.png'),fullPage:true});}
  assert.ok(Math.abs(before-after)<=2, label+' stable initial→upload bounds '+JSON.stringify({before,after}));
  await page.evaluate(progress=>window.photoStableView({revision:'v1',stale:true,progress}),progress);
  await page.getByText('Upload speed unavailable',{exact:true}).waitFor();
  assert.ok(Math.abs(after-await bounds())<=2,label+' stable stale bounds');
  for(const phase of ['indexing','downloading','checking-cloud','publishing']) {
   await page.evaluate(({progress,phase})=>window.photoStableView({revision:'v1',stale:false,progress:{...progress,
    activity:{...progress.activity,phase,indexing:{completed:32,total:120,unit:'assets'},latestFound:{kind:'photo'},downloadFraction:phase==='downloading'?0.47:undefined}}}),{progress,phase});
   await page.waitForTimeout(30);
   assert.ok(Math.abs(after-await bounds())<=2,label+' stable '+phase+' bounds');
  }
  await activity.locator('summary').click();
  assert.equal(await activity.evaluate(el=>el.open),false,'user can collapse activity');
  for(const phase of ['indexing','downloading','uploading']) {
   await page.evaluate(({progress,phase})=>window.photoStableView({revision:'v1',stale:false,progress:{...progress,activity:{...progress.activity,phase}}}),{progress,phase});
   await page.waitForTimeout(30);
   assert.equal(await activity.evaluate(el=>el.open),false,'collapse survives '+phase+' refresh');
  }
  await page.screenshot({path:join(evidence,label+'-collapsed.png'),fullPage:true});
  await activity.locator('summary').click();
  assert.equal(await activity.evaluate(el=>el.open),true,'activity reopens');
  await page.evaluate(()=>window.photoStableView(undefined));
  await page.locator('[data-block-id="folder-card-activity-download-progress"]').waitFor({state:'hidden'});
  const speed=page.getByLabel('Average upload speed',{exact:true});
  await page.getByLabel('Upload speed unit',{exact:true}).selectOption('MB/s'); await speed.fill('2.5');
  await page.getByLabel('Hourly data unit',{exact:true}).selectOption('GB');
  await page.getByLabel('Upload data per hour',{exact:true}).fill('3');
  await page.getByRole('button',{name:'Save fixture settings',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.photoStableDraft().configuration.photoAutomation.uploadBytesPerSecond),2500000);
  assert.equal(await page.evaluate(()=>window.photoStableDraft().configuration.photoAutomation.uploadBytesPerHour),3000000000);
  await page.reload();await speed.waitFor();assert.equal(await speed.inputValue(),'2.5');
  assert.equal(await page.getByLabel('Upload data per hour',{exact:true}).inputValue(),'3');
  await page.evaluate(async()=>{
   for(let y=0;y<document.body.scrollHeight;y+=innerHeight){scrollTo(0,y);await new Promise(resolve=>requestAnimationFrame(resolve));}
   scrollTo(0,document.body.scrollHeight);
  });
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(evidence,label+'-settings.png'),fullPage:true});
  await enableCurrentPageBuilder(page);
  const card=page.locator('[data-settings-document="device-sync-folder-card"]');
  await card.getByRole('button',{name:'Edit layout',exact:true}).click();
  await card.locator('[data-block-id="folder-card-activity-indexed-value"]').click();
  const selection=page.getByRole('combobox',{name:'Select block',exact:true});
  await selection.selectOption('folder-card-activity-event-label');
  assert.equal(await selection.inputValue(),'folder-card-activity-event-label');
  await page.getByRole('textbox',{name:'Block text',exact:true}).fill('Event · {item.label}');
  await selection.selectOption('folder-card-activity-title');
  await page.getByRole('textbox',{name:'Block text',exact:true}).fill('Backup activity log');
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  await card.getByRole('button',{name:'Save layout',exact:true}).click();
  await card.getByText('Unsaved layout',{exact:true}).waitFor({state:'hidden'});
  await card.getByRole('button',{name:'Done editing layout',exact:true}).click();
  await page.reload();
  await page.getByText('Backup activity log',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);results.push({label,before,after,settingsReadback:true,builderNestedSelection:true});
  await context.close();
 }
 await writeFile(join(evidence,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({evidence,results}));
} finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
