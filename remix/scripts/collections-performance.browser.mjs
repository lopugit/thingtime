/** Real Builder renderer with synthetic Action transport; no personal data or profile. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { ports } = require('./worktree-ports.cjs').resolveDevContext();
const origin = `http://127.0.0.1:${ports.web}`;
const output = resolve(process.argv[2] || '/tmp/thingtime-collections-browser');
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px system-ui;margin:0}#root{max-width:900px;margin:auto;padding:16px}button,input,select{min-height:44px} [data-fixture-row]{padding:8px;border-bottom:1px solid #ddd}</style><div id="root"></div><script type="module" src="/scripts/collections-performance.browser.fixture.tsx"></script></html>`;
const server = await createServer({ root, configFile:false, envDir:false, publicDir:false, resolve:{alias:{'~':join(root,'app')}}, server:{host:'127.0.0.1',port:ports.web,strictPort:true,hmr:false}, plugins:[{name:'collection-fixture',transform(code,id){if(id.endsWith('/Builder/webpageRuntime.tsx'))return code+'\nexport const FixtureRuntimeContext = WebpageRuntimeContext;';},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/fixture-collections'))return next(); try{res.setHeader('content-type','text/html');res.end(await vite.transformIndexHtml(req.url,html));}catch(e){next(e)}})}}] });
let browser;
const results = [];
try {
 await mkdir(output,{recursive:true,mode:0o700});
 await server.listen();
 browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.TT_CHROMIUM_EXECUTABLE});
 for (const [profile,viewport] of Object.entries({desktop:{width:1280,height:840}, mobile:{width:390,height:844}})) {
  const context=await browser.newContext({viewport,isMobile:profile==='mobile',hasTouch:profile==='mobile',reducedMotion:'reduce'});
  const page=await context.newPage(); page.setDefaultTimeout(12000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  let dataset='A', deny=false, requests=[];
  await page.route(origin+'/.well-known/thingtime-capabilities.json', route=>route.fulfill({json:{schemaVersion:1,origin,features:{'api.actions-run':{version:'1.39.0'},'api.webpages-resolve':{version:'1.11.0'},'api.attachment-content':{version:'1.12.0'},'api.things':{version:'1.49.0'},'api.things-update':{version:'1.18.0'}}}}));
  await page.route(origin+'/api/v1/actions/run', async route=>{
   const body=route.request().postDataJSON(); assert.equal(body.action,'fixture-list');
   const input=body.inputs||{}; const offset=Number(input.cursor ?? input.offset ?? 0); const limit=Number(input.limit ?? 25);
   const snapshot=dataset; const refused=deny; requests.push({offset,limit,dataset:snapshot});
   await new Promise(ok=>setTimeout(ok,40));
   if (refused) return route.fulfill({json:{ok:true,status:'error',errorStatus:403,error:'Access revoked'}});
   const items=Array.from({length:Math.max(0,Math.min(limit,58-offset))},(_,i)=>({id:`row-${offset+i+1}`,label:`${snapshot} record ${offset+i+1}`}));
   await route.fulfill({json:{ok:true,status:'ok',cache:'no-store',result:{items,offset,nextOffset:offset+items.length<58?offset+items.length:null,nextCursor:offset+items.length<58?String(offset+items.length):null,total:58}}});
  });
  try {
   await page.goto(origin+'/fixture-collections',{timeout:60000});
   await page.getByText('A record 1',{exact:true}).waitFor();
   await page.getByLabel('Fixture draft').fill('Keep this draft');
   await page.waitForTimeout(150);
   await page.evaluate(()=>{
    window.fixtureTimings=[];
    window.measureJump=(value,expected)=>new Promise((resolve,reject)=>{const start=performance.now();const done=()=>{if(document.body.textContent?.includes(expected)){observer.disconnect();resolve(performance.now()-start)}};const observer=new MutationObserver(done);observer.observe(document.body,{subtree:true,childList:true,characterData:true});const sel=document.querySelector('select[aria-label="Page of Fixture records"]');sel.value=value;sel.dispatchEvent(new Event('change',{bubbles:true}));done();setTimeout(()=>{observer.disconnect();reject(Error('jump timed out'))},5000)});
    window.measurePage=(selector,expected)=>new Promise((resolve,reject)=>{
     const start=performance.now(); const done=()=>{if(document.body.textContent?.includes(expected)){window.fixtureTimings.push(performance.now()-start);observer.disconnect();resolve()}};
     const observer=new MutationObserver(done); observer.observe(document.body,{subtree:true,childList:true,characterData:true});
     document.querySelector(selector).click();done();setTimeout(()=>{observer.disconnect();reject(Error('page transition timed out'))},5000);
    });
   });
   await page.evaluate(()=>window.measurePage('[aria-label="Next page of Fixture records"]','A record 11'));
   const timing=await page.evaluate(()=>window.fixtureTimings.at(-1));
   assert.ok(timing<=150,`prefetched/loaded page transition ${timing}ms exceeded 150ms`);
   assert.equal(await page.getByLabel('Fixture draft').inputValue(),'Keep this draft');
   assert.ok(!requests.some(request => request.offset === 10 && request.limit === 10), 'loaded adjacent slice must not be fetched again');
   const coldJump = await page.evaluate(()=>window.measureJump('6','A record 51'));
   assert.ok(requests.some(request => request.offset === 50 && request.limit === 10), 'arbitrary jump uses offset');
   await page.getByRole('button',{name:'Select item 48'}).click();
   await page.getByText('A record 48',{exact:true}).waitFor();
   const selected = page.locator('[data-tt-collection-selected="true"]').filter({hasText:'A record 48'});
   assert.equal(await selected.count(),1);
   await page.waitForFunction(() => { const el = [...document.querySelectorAll('[data-tt-collection-selected]')].find(x=>x.textContent?.includes('A record 48'))?.firstElementChild; if (!el) return false; const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
   await page.getByLabel('Search Fixture records').fill('record 48');
   await page.getByText('A record 48',{exact:true}).waitFor();
   await page.getByLabel('Search Fixture records').fill('');
   dataset='B';
   await page.getByRole('button',{name:'Switch fixture database'}).click();
   await page.waitForFunction(()=>!document.body.textContent?.includes('A record'));
   await page.getByText('B record 1',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
   await page.getByText('Fixture page bottom').waitFor({state:'visible'});
   await page.screenshot({path:join(output,`${profile}.png`),fullPage:true});
   deny=true;
   await page.getByLabel('Page of Fixture records',{exact:true}).selectOption('6');
   await page.getByText('Access revoked',{exact:true}).first().waitFor();
   await page.waitForFunction(()=>!document.body.textContent?.includes('B record'));
   // Retain an offset page in A, then fail a background prefetch in B before
   // any foreground B offset write. The old implementation promoted A pages
   // into B's token even though the viewer/account had not changed.
   await page.route(origin+'/fixture-scope-load', async route => {
    const input = route.request().postDataJSON();
    const snapshot = dataset;
    if (input.offset === 30) return route.fulfill({ json: { status: 'error', errorStatus: 503, error: 'Temporary prefetch failure' } });
    if (input.offset === 40) return route.fulfill({ json: { throwStatus: Number(input.variant === 'second' ? 401 : 403) } });
    if (input.offset === 45) { await new Promise(ok => setTimeout(ok, 100)); return route.fulfill({ json: { status: 'error', errorStatus: 503, error: 'Old prefetch failed late' } }); }
    const offset = input.offset || 0;
    return route.fulfill({ json: { status: 'ok', result: { offset, items: [{ id: String(offset), label: snapshot + ' scope row ' + offset }], total: 58, nextCursor: 'next' } } });
   });
   dataset = 'scope-A';
   await page.goto(origin+'/fixture-collections-scope',{timeout:60000});
   await page.waitForFunction(() => window.scopeCollection?.items[0]?.label === 'scope-A scope row 0');
   const scopeState = () => page.locator('[data-scope-state]').innerText();
   const offset = (start, prefetch = false) => page.evaluate(([start, prefetch]) => window.scopeCollection.loadPage(start, 10, prefetch), [start, prefetch]);
   for (const boundary of ['data plane', 'source']) {
    await offset(50);
    assert.ok((await scopeState()).includes(dataset + ' scope row 50'));
    // Leave a failure from the previous token outstanding across the switch.
    await page.evaluate(() => { window.oldScopePrefetch = window.scopeCollection.loadPage(45, 10, true); });
    dataset = boundary === 'data plane' ? 'scope-B' : 'scope-C';
    await page.getByRole('button', { name: 'Switch scope ' + boundary }).click();
    await page.waitForFunction(expected => window.scopeCollection?.items[0]?.label === expected, dataset + ' scope row 0');
    await offset(30, true);
    await page.evaluate(() => window.oldScopePrefetch);
    assert.ok(!(await scopeState()).includes('scope-A scope row'), 'old offset rows must not cross the data-plane boundary');
    if (boundary === 'source') assert.ok(!(await scopeState()).includes('scope-B scope row'), 'old offset rows must not cross the source boundary');
    assert.deepEqual(await page.evaluate(() => window.scopeCollection.pageData), {});
   }
   await offset(50);
   await offset(40, true); // thrown 401 clears initial and offset pages together
   await page.waitForFunction(() => window.scopeCollection.items.length === 0 && Object.keys(window.scopeCollection.pageData).length === 0);
   assert.ok((await scopeState()).includes('Thrown access refusal'));
   await page.getByRole('button', { name: 'Switch scope source' }).click();
   await page.waitForFunction(() => window.scopeCollection?.items.length === 1);
   await offset(50);
   await offset(40, true); // thrown 403 has the identical privacy boundary
   await page.waitForFunction(() => window.scopeCollection.items.length === 0 && Object.keys(window.scopeCollection.pageData).length === 0);
   assert.deepEqual(errors,[]);
   results.push({profile,correctRowTransitionMs:timing,coldJumpMs:coldJump,scopeBoundaries: ['same-account data-plane', 'same-account source', 'late old prefetch', 'thrown 401', 'thrown 403'],requests});
  } catch (error) { console.error('Fixture diagnostics:', await page.locator('body').innerText().catch(()=>''), errors, requests); await page.screenshot({path:join(output,`${profile}-failure.png`),fullPage:true}).catch(()=>{}); throw error; } finally {await context.close()}
 }
 await writeFile(join(output,'timings.json'),JSON.stringify({layer:'Real Builder renderer; synthetic Action transport',results},null,2));
 console.log(JSON.stringify(results));
} finally {await browser?.close();await server.close()}
