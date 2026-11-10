import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importPasswordCsv } from '../passwords/transfer';
import { emptyPasswordEntry } from '../passwords/model';
const base = process.env.TT_ACCOUNT_PASSWORDS_URL, artifacts = process.env.TT_ACCOUNT_PASSWORDS_ARTIFACTS, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const phrase = 'Disposable account device vault phrase 🦄', secret = ' synthetic account device credential 🦄  ';

test('account password UI retains encrypted offline edits and syncs with reviewed conflict copies', { skip: !base || !artifacts || !playwrightPath, timeout: 240_000 }, async () => {
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const url = (path: string) => new URL(path,base).href, headers = { Origin: new URL(base!).origin };
 let offline = false; const offlineWrites: string[] = [], errors: string[] = [], bounds: any[] = [];
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { if (offline && !['GET','HEAD','OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname); });
 const unlock = async () => { await page.getByLabel('Device vault passphrase', { exact: true }).fill(phrase); await page.getByRole('button', { name: 'Unlock device vault', exact: true }).click(); };
 const button = (title: string) => page.getByRole('button', { name: `${title} login`, exact: true });
 const storage = () => page.evaluate(async (secrets: string[]) => {
  const db = await new Promise<IDBDatabase>((resolve,reject) => { const req = indexedDB.open('thingtime.local-workspaces.v1'); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
  try { const rows: any[] = await new Promise((resolve,reject) => { const req=db.transaction('records').objectStore('records').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); });
   const raw=JSON.stringify(rows)+rows.filter(row=>row.value instanceof Uint8Array).map(row=>new TextDecoder().decode(row.value)).join('')+JSON.stringify(Object.entries(localStorage));
   return { leak: secrets.some(secret=>raw.includes(secret)), commands:rows.filter(row=>row.collection==='password-vault-commands').length, anonymousPasswords:rows.filter(row=>row.collection==='password-vault-records'&&JSON.parse(row.scope)[0]==='anonymous').length };
  } finally { db.close(); }
 },[phrase,secret,'Original account credential','Offline device credential','Other account device']);
 try {
  await mkdir(artifacts!,{recursive:true});
  const username='localvault-'+randomUUID().slice(0,8), registration=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(registration.status(),200); const ownerId=(await registration.json()).user.id, id=randomUUID();
  const entry={...emptyPasswordEntry(),title:'Original account credential',fields:[{id:'username',label:'Username',type:'text',value:'fixture'},{id:'password',label:'Password',type:'password',value:secret}]};
  const request=async(data:any)=>context.request.post(url('/api/v1/passwords'),{headers,data:{expectedOwnerId:ownerId,...data}});
  const initial=await request({operation:'save',id,writeId:randomUUID(),revision:0,entry}); assert.equal(initial.status(),200);
  await page.goto(url('/passwords')); await page.getByRole('button',{name:'Create device vault',exact:true}).waitFor();
  await page.getByLabel('Device vault passphrase',{exact:true}).fill(phrase);await page.getByLabel('Confirm device vault passphrase',{exact:true}).fill(phrase);await page.getByRole('button',{name:'Create device vault',exact:true}).click();
  await button(entry.title).waitFor();
  await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)return false;for(const key of await caches.keys())if(key.startsWith('thingtime:offline-shell:')&&await(await caches.open(key)).match('/__thingtime_offline_shell_complete__'))return true;return false;});
  offline=true;await context.setOffline(true);assert.equal(await page.evaluate(async()=>{try{await fetch('/api/root-data',{cache:'no-store'});return false;}catch{return true;}}),true);
  await button(entry.title).click();await page.getByLabel('Title',{exact:true}).fill('Offline device credential');await page.getByRole('button',{name:'Save entry',exact:true}).click();await button('Offline device credential').waitFor();
  assert.deepEqual(await storage(),{leak:false,commands:1,anonymousPasswords:0});
  for(const [width,height] of [[1440,1000],[390,844],[320,844]]){
   await page.setViewportSize({width,height});await page.reload();await page.getByRole('button',{name:'Unlock device vault',exact:true}).waitFor();await unlock();await button('Offline device credential').click();
   assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),secret);assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'password');
   const measured=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(measured.width,measured.scrollWidth);bounds.push(measured);
   await page.screenshot({path:resolve(artifacts!,`account-passwords-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await page.getByRole('button',{name:'Export',exact:true}).click();await page.getByLabel('Export format',{exact:true}).selectOption('chrome');
  await page.getByText('I understand the downloaded file contains unencrypted secrets.',{exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download export',exact:true}).click();
  const exportPath=resolve(artifacts!,'synthetic-account-passwords.csv');await(await downloading).saveAs(exportPath);
  const parsed=importPasswordCsv(await readFile(exportPath,'utf8'));assert.equal(parsed.entries.length,1);assert.equal(parsed.entries[0].title,'Offline device credential');assert.equal(parsed.entries[0].fields.find(field=>field.id==='password')?.value,secret);
  // A separate authorized fixture write represents another device while this UI is offline.
  const competing=await request({operation:'save',id,writeId:randomUUID(),revision:1,entry:{...entry,title:'Other account device'}});assert.equal(competing.status(),200);
  assert.deepEqual(offlineWrites,[]);offline=false;await context.setOffline(false);await page.reload();await page.getByRole('button',{name:'Unlock device vault',exact:true}).waitFor();await unlock();
  await page.getByRole('button',{name:'Keep device version as new entry',exact:true}).waitFor();await page.getByRole('button',{name:'Keep device version as new entry',exact:true}).click();
  await button('Other account device').waitFor();await button('Offline device credential').waitFor();
  await page.getByText('Device vault · no pending account changes',{exact:true}).waitFor();
  const exported=await request({operation:'export'});assert.equal(exported.status(),200);const entries=(await exported.json()).entries;
  assert.equal(entries.length,2);assert.deepEqual(new Set(entries.map((row:any)=>row.entry.title)),new Set(['Other account device','Offline device credential']));
  assert.equal(entries.find((row:any)=>row.id===id).entry.title,'Other account device');assert.ok(entries.every((row:any)=>row.entry.fields.find((field:any)=>field.id==='password').value===secret));
  assert.deepEqual(await storage(),{leak:false,commands:0,anonymousPasswords:0});assert.deepEqual(errors,[]);
  const secondName='localvault-'+randomUUID().slice(0,8),second=await context.request.post(url('/api/v1/auth/register'),{headers,data:{username:secondName,email:secondName+'@example.test',password:randomUUID()+randomUUID()}});
  assert.equal(second.status(),200);const secondId=(await second.json()).user.id;assert.notEqual(secondId,ownerId);
  await page.reload();await page.getByRole('button',{name:'Create device vault',exact:true}).waitFor();assert.equal(await button('Offline device credential').count(),0);
  const denied=await context.request.post(url('/api/v1/passwords'),{headers,data:{expectedOwnerId:secondId,operation:'read',id}});assert.equal(denied.status(),404);
  await writeFile(resolve(artifacts!,'verification.json'),JSON.stringify({offline:true,encrypted:true,coldReload:true,offlineExport:true,accountSwitchIsolation:true,reviewedConflictCopy:true,canonicalServerEntries:2,offlineWrites,errors,bounds},null,2));
 } catch(error){await page.screenshot({path:resolve(artifacts!,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(resolve(artifacts!,'failure.json'),JSON.stringify({name:(error as Error).name,message:(error as Error).message,errors,offlineWrites},null,2));throw error;}
 finally {await context.close();await browser.close();}
});
