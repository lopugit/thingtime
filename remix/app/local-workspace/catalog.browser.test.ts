import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_CATALOG_URL, artifacts = process.env.TT_LOCAL_CATALOG_ARTIFACTS, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const enabled = !!base && !!playwrightPath;
const ready = (page: any) => page.waitForFunction(async () => {
 await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
 for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
 return false;
});
async function allCards(page: any, expected: number) {
 for (let attempt = 0; attempt < 10; attempt++) {
  if (await page.getByTestId('component-card-title').count() === expected) return;
  const more = page.getByRole('button', { name: 'Load more', exact: true });
  if (await more.count()) {
   await more.scrollIntoViewIfNeeded();
   // The sentinel may consume this button between scrolling and clicking.
   await more.click({timeout:1000}).catch(() => {});
  }
  await page.waitForTimeout(200);
 }
 assert.equal(await page.getByTestId('component-card-title').count(), expected);
}
test('account catalogue discovery retains all visited pages for offline native editing and cross-tab refresh', { skip: !enabled, timeout: 180_000 }, async () => {
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!), browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width:1440,height:1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const headers = { Origin:new URL(base!).origin }, ids:string[] = [], errors:string[] = [], requests:any[] = [], bounds:any[] = [];
 context.on('page', other => other.on('pageerror', (e:Error)=>errors.push(e.message))); page.on('pageerror',(e:Error)=>errors.push(e.message));
 context.on('request', (r:any) => { const url=new URL(r.url()); if(url.pathname.includes('/browse')) requests.push({ path:url.pathname,query:url.search,actor:r.headers()['x-thingtime-expected-actor'],plane:r.headers()['x-thingtime-expected-data-plane'] }); });
 try {
  if(artifacts) await mkdir(resolve(artifacts),{recursive:true});
  const username=`catalogqa-${randomUUID().slice(0,8)}`;
  const registration=await context.request.post(new URL('/api/v1/auth/register',base).href,{headers,data:{username,email:`${username}@example.test`,password:randomUUID()+randomUUID()}}); assert.equal(registration.status(),200); const owner=(await registration.json()).user.id;
  for(let n=1;n<=23;n++) {
   const name=`Catalogue card ${String(n).padStart(2,'0')}`;
   const response=await context.request.post(new URL('/api/v1/things',base).href,{headers,data:{thingtime:['component'],crystal:{name,componentKey:`catalogue-card-${n}`,version:1,render:{tag:'p',children:`Native catalogue ${n}`}},visibility:'private'}});
   assert.equal(response.status(),200); ids.push((await response.json()).thing.id);
  }
  const schema=await context.request.post(new URL('/api/v1/things',base).href,{headers,data:{thingtime:['schema'],crystal:{name:'Catalogue schema',fields:[{name:'note',type:'string',description:'Catalogue note'}]},visibility:'private'}});
  assert.equal(schema.status(),200,await schema.text()); const schemaId=(await schema.json()).thing.id; ids.push(schemaId);
  // Seed only through real server APIs. Browse is the first device read of these definitions.
  await page.goto(new URL('/components?catalog=online',base).href); await ready(page); await page.getByRole('button',{name:'Mine',exact:true}).click();
  await page.getByRole('link',{name:'Catalogue card 23',exact:true}).waitFor(); await allCards(page,23);
  await page.goto(new URL('/schemas?source=online',base).href); await page.getByRole('button',{name:'Mine',exact:true}).click(); await page.getByRole('link',{name:'Catalogue schema',exact:true}).waitFor();
  assert.ok(requests.filter(r=>r.path==='/api/v1/components/browse' && r.query.includes('mine=1')).some(r=>r.query.includes('cursor=')));
  assert.ok(requests.length); assert.ok(requests.every(r=>r.actor===owner && r.plane));
  await context.setOffline(true);
  assert.equal(await page.evaluate(async()=>{try{await fetch('/api/root-data?catalog-offline-probe',{cache:'no-store'});return false;}catch{return true;}}),true);
  const writes:string[]=[]; const capture=(r:any)=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())) writes.push(new URL(r.url()).pathname);}; context.on('request',capture);
  await page.goto(new URL('/components?catalog=device',base).href); await page.getByRole('button',{name:'Mine',exact:true}).click(); await page.getByRole('link',{name:'Catalogue card 23',exact:true}).waitFor(); await allCards(page,23);
  assert.equal(await page.getByRole('link',{name:'Catalogue card 01',exact:true}).count(),1);
  const detail=await context.newPage(); await detail.goto(new URL(`/components/${ids[22]}?catalog=device`,base).href); await detail.getByText('Native catalogue 23',{exact:true}).first().waitFor();
  await detail.getByTestId('component-source-inputs').fill('{ unfinished concurrent input');
  const edit=await context.newPage(); await edit.goto(detail.url()); await edit.getByRole('button',{name:'Component settings',exact:true}).click(); await edit.getByRole('menuitem',{name:'Rename…',exact:true}).click();
  await edit.getByRole('dialog').getByRole('textbox').fill('Catalogue renamed in another tab'); await edit.getByRole('dialog').getByRole('button',{name:'Rename',exact:true}).click();
  await page.getByRole('link',{name:'Catalogue renamed in another tab',exact:true}).waitFor(); await detail.getByText('Catalogue renamed in another tab',{exact:true}).first().waitFor();
  assert.equal(await detail.getByTestId('component-source-inputs').inputValue(),'{ unfinished concurrent input');
  await page.reload(); await page.getByRole('link',{name:'Catalogue renamed in another tab',exact:true}).waitFor(); await allCards(page,23);
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:width===1440?1000:844}); await page.evaluate(()=>window.scrollTo(0,0)); const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth})); assert.equal(size.width,size.scroll); bounds.push(size);
   if(artifacts) await page.screenshot({path:resolve(artifacts,`account-catalog-${width}.png`)});
  }
  await page.goto(new URL('/schemas?source=device',base).href); await page.getByRole('button',{name:'Mine',exact:true}).click(); await page.getByRole('link',{name:'Catalogue schema',exact:true}).click();
  await page.getByRole('button',{name:'Create thing',exact:true}).waitFor(); await page.getByPlaceholder('Catalogue note', {exact:true}).fill('Locally authored from discovered schema'); await page.getByRole('button',{name:'Create thing',exact:true}).click();
  const data=page.getByRole('link',{name:'Open thing',exact:true}); await data.waitFor(); ids.push((await data.getAttribute('href')).split('/').pop());
  const schemas=await context.newPage(); await schemas.goto(new URL('/schemas?source=device',base).href); await schemas.getByRole('button',{name:'Mine',exact:true}).click(); await schemas.getByRole('link',{name:'Catalogue schema',exact:true}).waitFor();
  await edit.goto(new URL('/schemas?source=device',base).href); await edit.getByRole('button',{name:'Create a Schema',exact:true}).click();
  await edit.getByPlaceholder('Schema name — e.g. Table').fill('Schema created in another tab'); await edit.getByRole('textbox',{name:'Field name',exact:true}).fill('note');
  await edit.getByRole('button',{name:'Save schema ✨',exact:true}).click();
  const created=schemas.getByRole('link',{name:'Schema created in another tab',exact:true}); await created.waitFor(); ids.push((await created.getAttribute('href')).split('/').pop());
  assert.deepEqual(writes,[]); assert.deepEqual(errors,[]); context.off('request',capture);
  if(artifacts) await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({onlinePagesRetained:23,ownedSchemaRetained:true,coldOfflinePaging:true,nativeEditing:true,crossTabBrowseAndDetail:true,crossTabSchemas:true,unfinishedControlsPreserved:true,offlineSchemaData:true,bounds,writes,errors,requests},null,2));
 } catch(error) { if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText(),requests,errors},null,2));}throw error; }
 finally { for(const tab of context.pages()) await tab.close(); await context.setOffline(false); for(const id of ids.reverse()) await context.request.delete(new URL(`/api/v1/things?id=${id}`,base).href,{headers}); await context.request.post(new URL('/api/v1/auth/logout',base).href,{headers}); await browser.close(); }
});
