import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, '../MCP/package.json'));
const scratch = await mkdtemp(join(tmpdir(), 'thingtime-connection-glance-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-connection-glance-evidence'));
let context, server;
try {
 const source = `import React,{useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {ChakraProvider} from '@chakra-ui/react';
 import {SyncFolderCard} from '../app/components/Devices/SyncFolderCard';
 import {photoDownloadPreparation, syncFolderActivityLabel} from '../app/components/Devices/syncFolderCardBlocks';
 import {syncConnectionGlance} from '../app/fileSync/connectionGlance';
 function Fixture() {
  const [mode, setMode] = useState('live');
  Object.assign(window, { glanceFixture: { mode: setMode } });
  const metadata = mode === 'metadata', complete = mode === 'complete' || mode === 'photos-limited', photos = mode.startsWith('photos-');
  const waiting = mode === 'photos-wifi' || mode === 'photos-icloud-wait', failed = mode === 'photos-error', partial = mode === 'photos-partial';
  const preparation = photoDownloadPreparation(mode === 'photos-fetch' ? { fraction: 0.64 } : mode === 'photos-fetch-start' ? { fraction: 0 } : undefined);
  const running = ['live', 'growing', 'metadata', 'photos-preparing', 'photos-background-refused'].includes(mode) || !!preparation;
  const directions = {
   upload: { operations: metadata ? 1 : 2, confirmed: complete ? 2 : metadata ? 0 : 1, bytesTotal: metadata ? '0' : '1000', bytesConfirmed: complete ? '1000' : metadata ? '0' : '500' },
   download: { operations: metadata ? 0 : 1, confirmed: complete ? 1 : 0, bytesTotal: metadata ? '0' : '200', bytesConfirmed: complete ? '200' : '0' }
  };
  const refused = mode === 'photos-background-refused';
  const progress = photos ? { stage: partial || complete ? 'complete' : preparation || refused ? 'transferring' : 'scanning', confirmed: refused ? 1 : 0, total: refused ? 3 : 0,
    ...(refused ? { backgroundTransfer: 'foreground-only' } : {}),
    ...(partial ? { coverage: 'partial', skipped: 2 } : {}), ...(mode === 'photos-limited' ? { photoAccess: 'limited' } : {}),
    message: mode === 'photos-icloud-wait' ? 'An original is only in iCloud. Download it in Photos or explicitly allow cellular in this connection.' : waiting ? 'Waiting for Wi-Fi.' : undefined }
   : { stage: complete ? 'complete' : 'transferring', confirmed: 1, total: 3, directions, totalFinal: mode !== 'growing', direction: 'upload', bytes: 500, size: 500 };
  const reading = value => ({ status: 'known', value, unit: 'Mbps', requestedWindowMs: 1000, observedDurationMs: 1000 });
  const glance = syncConnectionGlance({ progress, rates: photos ? undefined : { upload: reading(3), download: reading(2) },
   online: mode !== 'offline', active: running, paused: mode === 'paused', waiting, preparing: !!preparation, mode: photos ? 'backup' : 'two-way', deviceLabel: photos ? 'iPhone' : 'Mac' });
  const stats = syncFolderActivityLabel({ paused: mode === 'paused', rootsReady: true, hasRoot: true, taskPaused: false, running, waiting, failed, photos, progress });
  return <ChakraProvider><main style={{ maxWidth: 1000, margin: 'auto', padding: 16 }}>
   <SyncFolderCard title={photos ? 'Photos Library' : 'Desktop'} path={photos ? 'Photos Library' : '/Synthetic/Desktop'}
    description={photos ? 'Backup to cloud' : 'Two-way sync'} stats={preparation ? '' : stats} scopeKey="glance-fixture" glance={glance} preparation={preparation}
    error={failed ? 'An original is unavailable. Open Photos and download it from iCloud, then retry.' : ''}>
    <p>Expanded settings only</p>
   </SyncFolderCard><div style={{ height: 500 }}>End of connection fixture</div></main></ChakraProvider>;
 }
 createRoot(document.getElementById('root')).render(<Fixture/>);`;
 await require('esbuild').build({stdin:{contents:source,loader:'tsx',resolveDir:join(root,'scripts')},bundle:true,format:'esm',platform:'browser',target:'esnext',outfile:join(scratch,'fixture.js'),tsconfig:join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},logLevel:'error',loader:{'.wasm':'file'}});
 const bundle=await readFile(join(scratch,'fixture.js'));
 server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':request.url==='/fixture.js'?'application/javascript':'text/html','Cache-Control':'no-store'});response.end(request.url==='/fixture.js'?bundle:'<!doctype html><meta charset="utf-8"><title>[QA] Folder transfer glance</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});server.listen(28270,'127.0.0.1');await once(server,'listening');
 context=await require('playwright').chromium.launchPersistentContext(join(scratch,'profile'),{headless:true,downloadsPath:join(scratch,'downloads'),acceptDownloads:false});
 const page=context.pages()[0],errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')console.error(message.text());});await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:28270'?route.continue():route.abort());await mkdir(evidence,{recursive:true});
 for(const[label,width,height]of[['desktop',1440,1000],['mobile',375,812]]){
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:28270');await page.getByRole('heading',{name:'Desktop',exact:true}).waitFor();
  await page.getByText('Mac · downloads received',{exact:true}).waitFor();await page.getByText('Thingtime · uploads received',{exact:true}).waitFor();
  assert.equal(await page.getByText('Expanded settings only',{exact:true}).isVisible(),false,'glance must remain visible without expanded settings');
  assert.equal(await page.getByText('50%',{exact:true}).count(),1,'unfenced old-file bytes must not double-count confirmed progress');await page.getByText('3 Mbps live',{exact:true}).waitFor();await page.getByText('500 B not yet confirmed',{exact:true}).waitFor();
  await page.screenshot({path:join(evidence,label+'-live-collapsed.png'),fullPage:true});
  await page.evaluate(()=>window.glanceFixture.mode('growing'));await page.getByText('50% · known so far, still growing',{exact:true}).waitFor();
  await page.evaluate(()=>window.glanceFixture.mode('paused'));await page.getByText('0 Mbps · paused',{exact:true}).first().waitFor();assert.equal(await page.getByText('0 Mbps · paused',{exact:true}).count(),2);
  await page.evaluate(()=>window.glanceFixture.mode('offline'));await page.getByText('Unavailable · device offline',{exact:true}).first().waitFor();assert.equal(await page.getByText('Unavailable · device offline',{exact:true}).count(),2);assert.equal(await page.getByText('3 Mbps live',{exact:true}).count(),0);
  await page.evaluate(()=>window.glanceFixture.mode('metadata'));await page.getByText('0 / 1 operations confirmed',{exact:true}).waitFor();await page.getByText('No work in this direction',{exact:true}).waitFor();assert.equal(await page.getByText('100%',{exact:true}).count(),0);
  await page.evaluate(()=>window.glanceFixture.mode('complete'));await page.getByText('100%',{exact:true}).first().waitFor();assert.equal(await page.getByText('100%',{exact:true}).count(),2);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(evidence,label+'-complete-collapsed.png'),fullPage:true});
  await page.evaluate(() => window.glanceFixture.mode('photos-preparing'));
  await page.getByRole('status').filter({ hasText: 'Preparing Photos backup…' }).waitFor();
  await page.getByText('Off for this connection', { exact: true }).waitFor();
  assert.equal(await page.getByText('Measuring live speed…', { exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator('article').innerText(), /0 of 0|0 \/ 0/);
  await page.evaluate(() => window.glanceFixture.mode('photos-background-refused'));
  await page.getByRole('status').filter({ hasText: '1 of 3 operations confirmed · Keep Thingtime open; iOS could not schedule background processing.' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(evidence, label + '-photos-background-refused.png'), fullPage: true });
  await page.evaluate(() => window.glanceFixture.mode('photos-fetch-start'));
  const iCloud = page.getByRole('progressbar', { name: 'Downloading an original from iCloud', exact: true });
  await iCloud.waitFor();
  assert.equal(await iCloud.getAttribute('aria-valuenow'), null);
  await page.evaluate(() => window.glanceFixture.mode('photos-fetch'));
  await page.getByText('64%', { exact: true }).waitFor();
  assert.equal(await iCloud.getAttribute('aria-valuenow'), '64');
  assert.equal(await page.getByRole('progressbar').count(), 1);
  assert.equal(await page.getByText('Measuring live speed…', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Expanded settings only', { exact: true }).isVisible(), false);
  await page.screenshot({ path: join(evidence, label + '-photos-fetch.png'), fullPage: true });
  await page.evaluate(() => window.glanceFixture.mode('photos-icloud-wait'));
  await iCloud.waitFor({ state: 'hidden' });
  await page.getByRole('status').filter({ hasText: /only in iCloud.*allow cellular/ }).waitFor();
  await page.screenshot({ path: join(evidence, label + '-photos-icloud-wait.png'), fullPage: true });
  await page.evaluate(() => window.glanceFixture.mode('photos-limited'));
  await page.getByRole('status').filter({ hasText: 'Selected photos backed up.' }).waitFor();
  assert.equal(await page.getByText('Last transfer finished.', { exact: true }).count(), 0);
  await page.evaluate(() => window.glanceFixture.mode('photos-wifi'));
  await page.getByRole('status').filter({ hasText: 'Waiting for Wi-Fi.' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.screenshot({ path: join(evidence, label + '-photos-wifi.png'), fullPage: true });
  await page.getByRole('button', { name: 'Expand folder', exact: true }).click();
  await page.getByText('Expanded settings only', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Collapse folder', exact: true }).click();
  await page.evaluate(() => window.glanceFixture.mode('photos-error'));
  await page.getByRole('alert').filter({ hasText: 'An original is unavailable.' }).waitFor();
  assert.equal(await page.getByText('Expanded settings only', { exact: true }).isVisible(), false);
  await page.screenshot({ path: join(evidence, label + '-photos-error.png'), fullPage: true });
  await page.evaluate(() => window.glanceFixture.mode('photos-partial'));
  await page.getByRole('status').filter({ hasText: 'Partial backup · 2 items need review.' }).waitFor();
  assert.equal(await page.getByText('Last transfer finished.', { exact: true }).count(), 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight); y += height / 2) {
   await page.evaluate(y => scrollTo(0, y), y);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.screenshot({ path: join(evidence, label + '-photos-partial.png'), fullPage: true });
 }
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,views:['desktop','mobile'],checks:['collapsed directional fields','live rates','durable-only percentages','growing totals','paused zero vs offline unknown','folder-only work','empty lane','Photos preparation and upload-only lanes','collapsed Wi-Fi wait and Photos error','partial backup coverage','iCloud original preparation','limited Photos access','background scheduler refusal','full scroll overflow']},null,2));console.log('Connection glance desktop/mobile checks passed. Evidence: '+evidence);
}catch(error){if(context?.pages()[0]){await context.pages()[0].screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});console.error((await context.pages()[0].locator('body').innerText()).slice(0,3500));}throw error;}finally{await context?.close();if(server){server.close();await once(server,'close');}await rm(scratch,{recursive:true,force:true});}
