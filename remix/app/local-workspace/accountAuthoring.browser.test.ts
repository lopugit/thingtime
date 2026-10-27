import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_AUTHORING_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_AUTHORING_ARTIFACTS;
test('native account post composer commits offline and syncs its private canonical content once', {skip:!base || !playwrightPath,timeout:180_000},async()=>{
 assert.ok(['127.0.0.1','localhost'].includes(new URL(base!).hostname));
 const {chromium}=await import(playwrightPath!),browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const url=(path:string)=>new URL(path,base).href,headers={Origin:new URL(base!).origin},errors:string[]=[],writes:string[]=[];
 let id='',offline=false;page.setDefaultTimeout(20_000);page.on('pageerror',(error:Error)=>errors.push(error.message));
 page.on('request',(request:any)=>{if(offline&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
 try{
  if(artifacts)await mkdir(resolve(artifacts),{recursive:true});
  const username='authorqa-'+randomUUID().slice(0,8),text='An editable private post created while offline.';
  const registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});assert.equal(registration.status(),200,await registration.text());
  await page.goto(url('/feed'));
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await context.setOffline(true);await page.reload();
  await page.getByRole('button',{name:"What's on your mind? ✨",exact:true}).click();
  await page.getByLabel('Who can see this post',{exact:true}).selectOption('private');
  await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(text,{delay:15});
  await page.getByRole('button',{name:'Post ✨',exact:true}).click();
  const card=page.locator('[data-thing-id]').filter({hasText:text}).first();await card.waitFor();id=await card.getAttribute('data-thing-id');assert.ok(id);
  await page.goto(url('/post/'+id));await page.reload();await page.getByText(text,{exact:true}).waitFor();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(artifacts)await page.screenshot({animations:'disabled',path:resolve(artifacts,`post-${width}.png`)});}
  assert.deepEqual(writes,[]);
  offline=false;await context.setOffline(false);await page.reload();let result:any;
  for(let attempt=0;attempt<40;attempt++){const response=await context.request.get(url('/api/v1/things?id='+id));if(response.status()===200){result=await response.json();break;}assert.equal(response.status(),404);await page.waitForTimeout(500);}
  assert.equal(result?.thing?.id,id);assert.equal(result.thing.crystal.text,text);assert.ok(result.thing.crystal.richText?.blocks?.length);assert.deepEqual(result.thing.acl,['tt:user']);
  await page.reload();await page.getByText(text,{exact:true}).waitFor();assert.deepEqual(errors,[]);
  if(artifacts)await writeFile(resolve(artifacts,'verification.json'),JSON.stringify({offlineNativeCreate:true,coldReload:true,privateSync:true,canonicalRichText:true,stableId:id,viewports:[1440,390,320],offlineWrites:writes,errors},null,2));
 }catch(error){if(artifacts){await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({body:await page.locator('body').innerText().catch(()=>''),errors,writes},null,2));}throw error;}
 finally{await context.setOffline(false).catch(()=>{});if(id)await context.request.delete(url('/api/v1/things'),{headers,data:{id}}).catch(()=>{});await browser.close();}
});
