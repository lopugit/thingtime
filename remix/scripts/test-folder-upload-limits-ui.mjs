import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, '../MCP/package.json'));
const dir = await mkdtemp(join(tmpdir(), 'tt-folder-limits-ui-')), evidence = resolve(process.argv[2] || '/tmp/thingtime-folder-upload-limits-ui');
let server, browser;
try {
 await mkdir(evidence, { recursive: true });
 let source = await readFile(join(root, 'scripts/mobile-sync-editor.browser.tsx'), 'utf8');
 source = `import { SyncConfigurationForm } from '../app/components/Devices/MobileSyncConnections';
 import { PhotoTransferScopeControls } from '../app/components/Devices/PhotoTransferScopeControls';\n` + source.replace('<Fixture />', '<FolderLimitsFixture />');
 source += `
 const limitsTransport = { origin: canonicalOrigin, currentOrigin: () => canonicalOrigin, fetch: (input,init={}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, canonicalOrigin);
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return Promise.resolve(fixtureJson(thingtimeCapabilityManifest(canonicalOrigin)));
  const headers = new Headers(init.headers);
  headers.set('X-Thingtime-Expected-Api-Origin',canonicalOrigin); headers.set('X-Thingtime-Expected-Actor',ownerId); headers.set('X-Thingtime-Expected-Data-Plane','home');
  return window.fetch(location.origin+url.pathname+url.search,{...init,headers});
 }};
 function FolderLimitsFixture() {
  const [supported,setSupported] = useState(true);
  const [draft,setDraft] = useState<any>(() => JSON.parse(localStorage.getItem('folder-upload-saved') || 'null') || {
   version:1,id:'folder-config',baseUpdatedAt:'2026-11-11T00:00:00Z',exclusions:'',pending:false,
   configuration:{configurationVersion:1,name:'Documents backup',localRootId:'folder-root',deviceId,remoteFolderId:'cloud-documents',sourceKind:'folder',mode:'backup',paused:false,network:'wifi',chargingOnly:false,propagateDeletes:false,excludedPaths:[]}
  });
  const request = async (_owner,input) => {
   const key='upload-policy:'+(input.rootId || 'device');
   if(input.action==='set-upload-policy') localStorage.setItem(key,JSON.stringify(input.uploadPolicy));
   return {roots:[],deviceId,rootId:input.rootId,uploadPolicy:JSON.parse(localStorage.getItem(key)||'{"uploadBytesPerSecond":750000,"uploadBytesPerHour":10000000}')};
  };
  Object.assign(window,{folderLimitsDraft:()=>draft,folderLimitsSupported:setSupported});
  return <ChakraProvider><Box maxWidth="760px" margin="auto" padding={4}>
   <Text as="h1">Folder backup upload settings</Text>
   <PhotoTransferScopeControls generalUploads supported={supported} ownerId={ownerId} deviceId={deviceId} scopeKey="folder-test-device" accountTransport={limitsTransport} request={request} assertCurrent={()=>{}} />
   <PhotoTransferScopeControls generalUploads supported={supported} ownerId={ownerId} deviceId={deviceId} rootId="folder-root" scopeKey="folder-test-root" accountTransport={limitsTransport} request={request} assertCurrent={()=>{}} />
   <SyncConfigurationForm iosManagedResources uploadPolicySupported={supported} draft={draft} roots={[{id:'folder-root',name:'Documents'}]} folders={[]} disabled={false} onChange={setDraft} scopeKey="folder-test-config" accountTransport={limitsTransport} />
   <Button onClick={()=>localStorage.setItem('folder-upload-saved',JSON.stringify(draft))}>Save fixture configuration</Button>
   <Text id="end-of-settings">End of settings</Text>
  </Box></ChakraProvider>;
 }
 `;
 await require('esbuild').build({stdin:{contents:source,resolveDir:join(root,'scripts'),loader:'tsx'},bundle:true,format:'esm',platform:'browser',target:'esnext',outfile:join(dir,'fixture.js'),tsconfig:join(root,'tsconfig.json'),loader:{'.wasm':'file'},define:{'process.env.NODE_ENV':'"development"'},logLevel:'error'});
 const bundle=await readFile(join(dir,'fixture.js'));
 server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':req.url==='/fixture.js'?'application/javascript':'text/html'});res.end(req.url==='/fixture.js'?bundle:'<!doctype html><title>[QA] Folder upload settings</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 browser=await require('playwright').chromium.launch({headless:true});
 const results=[];
 for(const [label,width,height] of [['desktop',1440,1000],['phone',390,844]]) {
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('fixture page error:',e.message)});page.setDefaultTimeout(12000);
  await page.goto('http://127.0.0.1:'+server.address().port+'/?platform=desktop&tasks');
  const device=page.getByRole('region',{name:'Device upload settings'}),folder=page.getByRole('region',{name:'Folder upload settings'});
  const config=page.locator('[data-settings-document="sync-upload-configuration-limits"]');
  await config.getByLabel('Average upload speed',{exact:true}).waitFor().catch(async error=>{await page.screenshot({path:join(evidence,label+'-initial-failure.png'),fullPage:true});console.error('fixture initial body:',(await page.locator('body').innerText()).slice(0,2500));throw error});
  await config.getByLabel('Average upload speed',{exact:true}).fill('2');
  await config.getByLabel('Upload data per hour',{exact:true}).fill('100');
  assert.deepEqual(await page.evaluate(()=>window.folderLimitsDraft().configuration.uploadPolicy),{uploadBytesPerSecond:2000000,uploadBytesPerHour:100000000});
  assert.equal(await page.getByLabel('Direction',{exact:true}).isDisabled(),true,'v5 iOS policy cannot enter an unsupported direction');
  await page.getByText('This iPhone supports upload limits for Backup (keep deleted files). The saved direction and limits are retained.',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.folderLimitsDraft().configuration)).mode,'backup');
  await config.getByLabel('Average upload speed',{exact:true}).fill('');
  await config.getByLabel('Upload data per hour',{exact:true}).fill('');
  assert.deepEqual(await page.evaluate(()=>window.folderLimitsDraft().configuration.uploadPolicy),{});
  assert.equal(await page.getByLabel('Direction',{exact:true}).isDisabled(),true,'empty policy remains v5 and cannot silently discard the saved contract');
  await config.getByLabel('Average upload speed',{exact:true}).fill('2');
  await config.getByLabel('Upload data per hour',{exact:true}).fill('100');
  await config.getByLabel('Upload speed unit',{exact:true}).selectOption('Mbps');
  assert.equal(await config.getByLabel('Average upload speed',{exact:true}).inputValue(),'16');
  assert.equal((await page.evaluate(()=>window.folderLimitsDraft().configuration)).configurationVersion,5);
  for(const region of [device,folder]) {
   await region.getByLabel('Average upload speed',{exact:true}).fill('1');
   await region.getByLabel('Upload data per hour',{exact:true}).fill('500');
   await region.getByLabel('Upload speed unit',{exact:true}).selectOption('MB/s');
   await region.getByLabel('Hourly data unit',{exact:true}).selectOption('MB');
   await region.getByRole('button',{name:'Save upload settings',exact:true}).click();
   await region.getByText('Saved upload settings',{exact:true}).waitFor();
   const storageKey=region===device?'device':'folder-root';
   assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem('upload-policy:'+key)),storageKey),{uploadBytesPerSecond:1000000,uploadBytesPerHour:500000000},'independent edits and repeated unit events must save the displayed draft');
   await region.getByLabel('Average upload speed',{exact:true}).fill('2.000000');
   await region.getByLabel('Hourly data unit',{exact:true}).selectOption('MB');
   await region.getByLabel('Upload data per hour',{exact:true}).fill('');
   await region.getByRole('button',{name:'Save upload settings',exact:true}).click();
   await region.getByText('Saved upload settings',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem('upload-policy:'+key)),storageKey),{uploadBytesPerSecond:2000000},'second save must retain edited speed while clearing hourly budget');
  }
  await page.getByRole('button',{name:'Save fixture configuration'}).click();
  await page.reload();await config.getByLabel('Average upload speed',{exact:true}).waitFor();
  assert.equal(await config.getByLabel('Average upload speed',{exact:true}).inputValue(),'16');
  assert.equal(await folder.getByLabel('Average upload speed',{exact:true}).inputValue(),'2');
  assert.equal(await device.getByLabel('Average upload speed',{exact:true}).inputValue(),'2');
  assert.equal(await folder.getByLabel('Upload data per hour',{exact:true}).inputValue(),'');
  await config.getByLabel('Upload data per hour',{exact:true}).fill('0');
  await config.getByRole('alert').waitFor();
  await config.getByLabel('Upload data per hour',{exact:true}).fill('100');
  await page.evaluate(()=>window.folderLimitsSupported(false));
  assert.equal(await config.getByLabel('Average upload speed',{exact:true}).isDisabled(),true);
  await page.getByText('Update Thingtime on this iPhone to manage upload speed and hourly data limits.',{exact:true}).waitFor();
  await page.evaluate(()=>window.folderLimitsSupported(true));
  assert.equal(await page.locator('summary').filter({hasText:'Resource limits'}).count(),0,'iOS has no duplicate unsupported resource section');
  assert.equal(await page.getByLabel('CPU target (%)',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('Download speed',{exact:true}).count(),0);
  for(let i=0;i<20;i++) {const end=await page.evaluate(()=>{window.scrollBy(0,innerHeight*0.8);return scrollY+innerHeight>=document.documentElement.scrollHeight});if(end)break;}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' no horizontal overflow');
  await page.screenshot({path:join(evidence,label+'.png'),fullPage:true});
  await enableCurrentPageBuilder(page);
  await config.getByRole('button',{name:'Edit layout',exact:true}).click();
  await config.locator('[data-block-id="photo-backup-limits-heading"]').click();
  const select=page.getByRole('combobox',{name:'Select block',exact:true});
  await select.selectOption('photo-backup-limits-heading');
  await page.getByRole('textbox',{name:'Block text',exact:true}).fill('Backup upload limits');
  await select.selectOption('speed-input');assert.equal(await select.inputValue(),'speed-input');
  await select.selectOption('photo-speed-unit');assert.equal(await select.inputValue(),'photo-speed-unit');
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  await config.getByRole('button',{name:'Save layout',exact:true}).click();
  await config.getByText('Unsaved layout',{exact:true}).waitFor({state:'hidden'});
  await config.getByRole('button',{name:'Done editing layout',exact:true}).click();
  await page.reload();await config.getByText('Backup upload limits',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);results.push({label,configReadback:true,scopeReadback:true,oldHostDisabled:true,builderNestedSelection:true});await context.close();
 }
 await writeFile(join(evidence,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({evidence,results}));
} finally {await browser?.close();if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
