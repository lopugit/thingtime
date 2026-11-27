import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, '../MCP/package.json'));
const dir = await mkdtemp(join(tmpdir(), 'tt-photo-visible-limits-'));
const evidence = resolve(process.argv[2] || '/tmp/thingtime-photo-visible-limits');
const placementOnly = process.argv.includes('--placement-only');
let server, browser;
try {
 await mkdir(evidence, { recursive: true });
 await require('esbuild').build({ entryPoints: [join(root, 'scripts/remote-device-sync.browser.tsx')], bundle: true, format: 'esm', platform: 'browser',
  target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), loader: { '.wasm': 'file' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
 const bundle = await readFile(join(dir, 'fixture.js'));
 server = createServer((req,res) => { res.writeHead(200, {'Content-Type': req.url==='/fixture.js' ? 'application/javascript' : 'text/html'});
  res.end(req.url==='/fixture.js' ? bundle : '<!doctype html><title>[QA] Saved Photos upload limits</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>'); });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 browser = await require('playwright').chromium.launch({ headless: true });
 for (const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
  const context = await browser.newContext({ viewport: {width,height} }); const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', e => console.error(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?nativeOnly&scopedPhotoLimits&paused&budget`);
  const device = page.getByRole('group', {name:'Device Photos upload limits',exact:true});
  const folder = page.getByRole('group', {name:'Folder Photos upload limits',exact:true});
  const config = page.getByRole('group', {name:'Photos upload limits and notifications',exact:true}).first();
  for (const group of [device,folder,config]) await group.getByRole('textbox', {name:'Average upload speed',exact:true}).waitFor();
  assert.equal(await config.getByRole('textbox',{name:'Average upload speed',exact:true}).inputValue(),'0.625');
  assert.equal(await config.getByRole('combobox',{name:'Upload speed unit',exact:true}).inputValue(),'MB/s');
  if (placementOnly) {
   const card = config.locator('xpath=ancestor::article[1]');
   const controls = await config.boundingBox();
   const header = await card.locator('[data-block-id="folder-card-title"]').boundingBox();
   const destination = await card.locator('[data-block-id="folder-card-destination"]').boundingBox();
   const activity = await card.locator('[data-block-id="folder-card-activity-summary"]').boundingBox();
   const metrics = await card.locator('[data-block-id="connection-glance"]').boundingBox();
   assert.ok(header && controls && destination && activity && metrics);
   assert.ok(header.y < controls.y && destination.y + destination.height <= controls.y);
   assert.ok(controls.y + controls.height <= activity.y, 'upload controls precede backup activity');
   assert.ok(controls.y + controls.height <= metrics.y, 'upload controls precede transfer metrics');
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
   await page.screenshot({path:join(evidence,`${label}-placement.png`),fullPage:true});
   await context.close(); continue;
  }
  // Saved card starts collapsed; these fields do not depend on its disclosure or Edit.
  await page.getByRole('button', {name:'Expand folder',exact:true}).first().waitFor();
  const set = async (group, speed) => {
   await group.getByRole('combobox',{name:'Hourly data unit',exact:true}).selectOption('MB');
   await group.getByRole('textbox',{name:'Upload data per hour',exact:true}).fill(String(Number(speed) * 2000));
   await group.getByRole('textbox', {name:'Average upload speed',exact:true}).fill(speed);
   const parent = group.locator('xpath=ancestor::*[self::section or self::article][1]');
   await parent.getByRole('button', {name:'Save upload settings',exact:true}).click();
   await parent.getByText('Saved upload settings',{exact:true}).waitFor();
  };
  await set(device,'1'); await set(folder,'0.5'); await set(config,'0.25');
  await page.reload();
  await assert.doesNotReject(() => device.getByRole('textbox',{name:'Average upload speed',exact:true}).waitFor());
  for (const [group,value] of [[device,'1'],[folder,'0.5'],[config,'0.25']]) {
   await page.waitForFunction(({name,value}) => [...document.querySelectorAll('fieldset')].some(fieldset => fieldset.getAttribute('aria-label')===name && fieldset.querySelector('input[name="speed"]')?.value===value), {name:await group.getAttribute('aria-label'),value});
  }
  for (const [group,value] of [[device,2_000_000_000],[folder,1_000_000_000],[config,500_000_000]]) {
   const amount = Number(await group.getByRole('textbox',{name:'Upload data per hour',exact:true}).inputValue());
   const unit = await group.getByRole('combobox',{name:'Hourly data unit',exact:true}).inputValue();
   assert.equal(amount * (unit === 'GB' ? 1_000_000_000 : 1_000_000),value);
  }
  await config.getByRole('textbox',{name:'Average upload speed',exact:true}).fill('invalid');
  await config.getByRole('alert').waitFor();
  assert.equal(await config.locator('xpath=ancestor::article[1]').getByRole('button',{name:'Save upload settings',exact:true}).isDisabled(),true);
  await config.getByRole('textbox',{name:'Average upload speed',exact:true}).fill('0.125');
  await page.reload(); // unsaved configuration edits use existing durable journal
  await page.waitForFunction(() => [...document.querySelectorAll('fieldset')].some(f => f.getAttribute('aria-label')==='Photos upload limits and notifications' && f.querySelector('input[name="speed"]')?.value==='0.125'));
  await folder.getByRole('textbox',{name:'Average upload speed',exact:true}).waitFor();
  await page.evaluate(() => window.scrollTo(0,document.body.scrollHeight));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await page.screenshot({path:join(evidence,`${label}.png`),fullPage:true});
  await context.close();
 }
 if (!placementOnly) {
 const activeContext = await browser.newContext({viewport:{width:390,height:844}});
 const activePage = await activeContext.newPage(); activePage.setDefaultTimeout(10000);
 await activePage.goto(`http://127.0.0.1:${server.address().port}/?nativeOnly&nativeActivity&scopedPhotoLimits&budget`);
 const activeConfig = activePage.getByRole('group',{name:'Photos upload limits and notifications',exact:true}).first();
 await activeConfig.getByRole('textbox',{name:'Average upload speed',exact:true}).waitFor();
 await activePage.evaluate(() => window.remoteSyncFixture.setNativePhotoDiscovery(0));
 await activeConfig.locator('xpath=ancestor::article[1]').getByRole('button',{name:'Pause sync',exact:true}).waitFor();
 await activeConfig.getByRole('textbox',{name:'Average upload speed',exact:true}).fill('0.4');
 const activeCard = activeConfig.locator('xpath=ancestor::article[1]');
 await activeCard.getByRole('button',{name:'Save upload settings',exact:true}).click();
 await activeCard.getByText('Saved upload settings',{exact:true}).waitFor();
 assert.ok(await activePage.evaluate(() => Object.entries(localStorage).some(([key,value]) => key.startsWith('remote-sync-fixture-rows:') && !key.includes(':policy:') && value.includes('400000'))));
 await enableCurrentPageBuilder(activePage);
 const deviceDocument = activePage.locator('[data-settings-document="photo-backup-device-limits"]');
 await deviceDocument.getByRole('button',{name:'Edit layout',exact:true}).click();
 await deviceDocument.locator('[data-block-id="speed-input"]').click();
 const selection = activePage.getByRole('combobox',{name:'Select block',exact:true});
 for (const id of ['speed-label','speed-input','photo-speed-unit','data-input','photo-data-unit']) {
  await selection.selectOption(id); assert.equal(await selection.inputValue(),id);
 }
 await selection.selectOption('photo-backup-limits-heading');
 await activePage.getByRole('textbox',{name:'Block text',exact:true}).fill('Device Photos upload settings');
 await activePage.getByRole('button',{name:'Close builder',exact:true}).click();
 await deviceDocument.getByRole('button',{name:'Save layout',exact:true}).click();
 await deviceDocument.getByText('Unsaved layout',{exact:true}).waitFor({state:'hidden'});
 await deviceDocument.getByRole('button',{name:'Done editing layout',exact:true}).click();
 await activePage.reload(); await activePage.getByText('Device Photos upload settings',{exact:true}).waitFor();
 await activeContext.close();
 const oldContext = await browser.newContext(); const oldPage = await oldContext.newPage(); oldPage.setDefaultTimeout(10000);
 await oldPage.goto(`http://127.0.0.1:${server.address().port}/?nativeOnly&paused&budget`);
 const oldDevice = oldPage.getByRole('group',{name:'Device Photos upload limits',exact:true});
 await oldDevice.getByText('Update Thingtime on this iPhone to manage shared device and folder upload limits.').waitFor();
 assert.equal(await oldDevice.getByRole('textbox',{name:'Average upload speed',exact:true}).isDisabled(),true);
 await oldContext.close();
 }
 await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,views:['desktop','mobile'],checks:placementOnly ? ['header and destination precede controls','controls precede backup activity and transfer metrics','desktop/mobile no overflow'] : ['collapsed saved card','three scopes','save and reload','durable unsaved config edit','full page overflow','invalid limit cannot save','active policy-only CAS save','old native upgrade explanation','independent Builder fields and saved layout reload']},null,2));
 console.log(`PASS: saved-card upload limits ${placementOnly ? 'placement' : 'save/reload and Builder'} desktop/mobile; evidence ${evidence}`);
} finally { await browser?.close(); server?.close(); await rm(dir,{recursive:true,force:true}); }
