import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { accountPostProjection } from './accountPosts';
const base = process.env.TT_LOCAL_DISCUSSIONS_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_DISCUSSIONS_ARTIFACTS;
test('account Thing discussions retain actual comments through cold offline native reads', { skip: !base || !playwrightPath, timeout: 180_000 }, async () => {
 assert.ok(['127.0.0.1','localhost'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!), browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), guest = await browser.newContext(), page = await context.newPage();
 const url = (path: string) => new URL(path, base).href, headers = { Origin: new URL(base!).origin }, errors: string[] = [], writes: string[] = [];
 let id = '', offline = false;
 page.setDefaultTimeout(20_000); page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { if (offline && !['GET','HEAD','OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const username = 'discussionqa-' + randomUUID().slice(0,8);
  const registration = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID()+randomUUID() } });
  assert.equal(registration.status(),200,await registration.text());
  const created = await context.request.post(url('/api/v1/things'), { headers, data: { thingtime: ['data'], crystal: { name: 'Retained discussion fixture' }, acl: ['tt:user'] } });
  assert.equal(created.status(),200,await created.text()); const body = await created.json(); id = body.thing?.id || body.id; assert.ok(id);
  await page.goto(url('/thing/'+id));
  await page.getByPlaceholder('Write a comment… 💬',{exact:true}).fill('A real account comment retained on this device.');
  const sent = page.waitForResponse((response:any) => new URL(response.url()).pathname === '/api/v1/things/comment' && response.request().method() === 'POST');
  await page.getByRole('button',{name:'Send comment',exact:true}).click();
  const receipt = await sent; assert.equal(receipt.status(),200,await receipt.text());
  await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reply to '+username,exact:true}).click();
  await page.getByPlaceholder('Reply to '+username+'… 💬',{exact:true}).fill('A retained nested account reply.');
  const replySent = page.waitForResponse((response:any)=>new URL(response.url()).pathname==='/api/v1/things/comment'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Send reply',exact:true}).click();assert.equal((await replySent).status(),200);
  await page.reload();await page.getByRole('button',{name:'View replies',exact:true}).first().click();await page.getByText('A retained nested account reply.',{exact:true}).waitFor();
  const comments = await context.request.get(url('/api/v1/things?target='+id+'&thingtime=comment&commentProjection=true&limit=20'));
  assert.equal(comments.status(),200); const commentId = (await comments.json()).comments[0].id;
  const canonical = await context.request.get(url('/api/v1/things?id='+commentId)); assert.equal(canonical.status(),200); const canonicalBody=await canonical.json();
  try { accountPostProjection(canonicalBody.post); } catch(error) { if(artifacts)await writeFile(resolve(artifacts,'projection-failure.json'),JSON.stringify({error:String(error),post:canonicalBody.post},null,2));throw error; }
  await page.goto(url('/post/'+commentId)); await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor();
  if(artifacts)await writeFile(resolve(artifacts,'online-post.txt'),await page.locator('body').innerText());
  await page.goto(url('/thing/'+id)); await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  assert.equal((await guest.request.get(url('/api/v1/things?id='+id+'&commentProjection=true'))).status(),404);
  offline=true;await context.setOffline(true);
  await page.goto(url('/post/'+commentId));await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor();
  await page.goto(url('/thing/'+id));await page.reload();
  await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor();
  await page.getByText('Showing discussions saved on this device. More comments may be available online.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'View replies',exact:true}).first().click();await page.getByText('A retained nested account reply.',{exact:true}).waitFor();
  assert.equal(await page.getByText('This workspace is offline. Reconnect and confirm your account before syncing.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Refresh comments',exact:true}).click();
  await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor();
  for(const width of [1440,390,320]) { await page.setViewportSize({width,height:width===1440?1000:844});await page.getByText('A real account comment retained on this device.',{exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`discussion-${width}.png`)}); }
  assert.equal(await page.getByText('Shared media requires a newer server. Please refresh after the update.',{exact:true}).count(),0);
  assert.deepEqual(writes,[]);
  offline=false;await context.setOffline(false);await page.reload();await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor();
  assert.equal((await context.request.delete(url('/api/v1/things'),{headers,data:{id}})).status(),200);
  await page.getByRole('button',{name:'Refresh comments',exact:true}).click();
  await page.getByText('A real account comment retained on this device.',{exact:true}).waitFor({state:'hidden'});
  offline=true;await context.setOffline(true);await page.reload();
  await page.getByText('This discussion is not saved on this device. Open it online to retain it.',{exact:true}).waitFor();
  assert.equal(await page.getByText('A real account comment retained on this device.',{exact:true}).count(),0);
  await page.goto(url('/post/'+commentId));
  await page.getByText('This workspace is offline. Reconnect and confirm your account before syncing.',{exact:true}).waitFor();
  assert.equal(await page.getByText('A real account comment retained on this device.',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({coldOfflineRead:true,coldOfflineNestedReply:true,offlineRefresh:true,refusalClearedCache:true,refusalClearedAlternatePermalink:true,anonymousDenied:true,viewports:[1440,390,320],offlineWrites:writes,errors},null,2));
 } catch(error) { if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,writes},null,2));} throw error; }
 finally { await context.setOffline(false).catch(()=>{});if(id)await context.request.delete(url('/api/v1/things'),{headers,data:{id}}).catch(()=>{});await browser.close(); }
});
