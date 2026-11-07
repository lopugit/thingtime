import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';
const origin=process.env.TT_PASSWORD_NATIVE_URL,kind=process.env.TT_VAULT_MEMORY_SCENARIO,out='/tmp/native-artifacts';
const phase=async name=>fs.writeFile(out+'/phase.json',JSON.stringify({name,at:new Date().toISOString()}));
const exact='  Exact synthetic 🦄 e\u0301 漢字 \t'.repeat(100000)+'\n  Exact final multiline sentinel 🦊  \n';
test('isolated password memory phase '+kind,{timeout:300000},async()=>{
 const {chromium}=await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);let browser;
 try{
 await phase('before-browser');browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true,args:['--enable-automation']});const browserCDP=await browser.newBrowserCDPSession();const commandLine=await browserCDP.send('Browser.getBrowserCommandLine');assert.equal(commandLine.arguments.includes('--no-sandbox'),false);await browserCDP.detach();await fs.writeFile(out+'/actual-browser-sandbox.json',JSON.stringify({chromiumSandbox:true,noSandboxArgument:false}));browser.on('disconnected',()=>phase('browser-disconnected').catch(()=>{}));
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);
 await page.exposeFunction('nativeMemoryPhase',name=>phase(name));
 await page.addInitScript(()=>{addEventListener('change',e=>{if(e.target instanceof HTMLInputElement&&e.target.type==='file')void window.nativeMemoryPhase('file-input-change-dispatched')},true);const put=IDBObjectStore.prototype.put;let noted=false;IDBObjectStore.prototype.put=function(value,...args){if(!noted&&this.name==='records'&&value.collection==='@bytes'&&String(value.id).startsWith('password-file:')){noted=true;void window.nativeMemoryPhase('first-encrypted-file-frame-idb-put')}return Reflect.apply(put,this,[value,...args])}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,200)));
 const initial=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/root-data');await page.goto(origin+'/passwords');assert.equal((await(await initial).json()).user,null);
 await page.waitForFunction(async()=>{await navigator.serviceWorker.ready;return !!navigator.serviceWorker.controller});await page.context().setOffline(true);
 const phrase='Disposable bounded memory vault phrase';await page.getByLabel('Device vault passphrase',{exact:true}).fill(phrase);await page.getByLabel('Confirm device vault passphrase',{exact:true}).fill(phrase);await page.getByRole('button',{name:'Create device vault',exact:true}).click();
 await page.getByRole('button',{name:'Add password',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Memory fixture '+kind);
 await page.getByLabel('Custom field label',{exact:true}).fill('Memory note');await page.getByLabel('Custom field type',{exact:true}).selectOption('notes');await page.getByRole('button',{name:'Add custom field',exact:true}).click();
 await phase('before-note-fill');await page.getByLabel('Memory note',{exact:true}).fill(kind==='large-note'?exact:'Small synthetic note',{timeout:150000});await phase('after-note-fill');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await page.getByRole('button',{name:'Memory fixture '+kind+' login',exact:true}).waitFor();await phase('after-entry-save');
 if(kind==='small-note-file'){
  const handle=await fs.open('/tmp/memory-66MiB.bin','w');try{for(let n=0;n<66;n++)await handle.write(new Uint8Array(1024*1024).fill(n%251))}finally{await handle.close()}
  await phase('before-setInputFiles');await page.getByLabel('Add password attachment',{exact:true}).setInputFiles('/tmp/memory-66MiB.bin',{timeout:90000});await phase('after-setInputFiles');
  await page.getByText('memory-66MiB.bin ·',{exact:false}).waitFor({timeout:120000});await phase('after-file-upload-complete');
 }
 await page.getByRole('heading',{name:'Edit entry',exact:true}).locator('..').getByRole('button',{name:'Close',exact:true}).click();await phase('after-editor-close');await page.reload();await phase('after-cold-reload-locked');
 await page.getByLabel('Device vault passphrase',{exact:true}).fill(phrase);await page.getByRole('button',{name:'Unlock device vault',exact:true}).click();await page.getByRole('button',{name:'Memory fixture '+kind+' login',exact:true}).click();assert.ok(await page.getByLabel('Memory note',{exact:true}).inputValue()===(kind==='large-note'?exact:'Small synthetic note'));
 if(kind==='small-note-file'){
 await page.getByText('memory-66MiB.bin ·',{exact:false}).waitFor();
 const offered=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const downloaded=await offered;assert.equal(await downloaded.failure(),null);
 await downloaded.saveAs('/tmp/verified-vault-file.bin');const hash=async path=>{const h=createHash('sha256');let bytes=0;for await(const b of createReadStream(path)){h.update(b);bytes+=b.length}return {bytes,sha256:h.digest('hex')}};
 const actual=await hash('/tmp/verified-vault-file.bin'),expected=await hash('/tmp/memory-66MiB.bin');assert.deepEqual(actual,expected);assert.equal(actual.bytes,66*1024*1024);await fs.writeFile(out+'/download-verification.json',JSON.stringify(actual,null,2));

 const observations=[];
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.locator('.tt.devKit').count(),0,'Password manager has no floating DevKit control');
  const check=async()=>{
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const layout=await page.evaluate(()=>{
    const panel=document.querySelector('[data-lopu-launcher-clearance]'),launcher=document.querySelector('.lopuLauncher');
    if(!panel||!launcher)throw Error('Expected real password editor and launcher');
    const a=panel.getBoundingClientRect(),b=launcher.getBoundingClientRect();
    const intersects=a.left<b.right+8&&a.right>b.left-8&&a.top<b.bottom+8&&a.bottom>b.top-8;
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,y:scrollY,intersects,launcherVisibility:getComputedStyle(launcher).visibility};
   });
   assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));
   if(width<768)assert.equal(layout.launcherVisibility,layout.intersects?'hidden':'visible',JSON.stringify(layout));
   observations.push(layout);
  };
  await check();let previous=-1;
  for(let n=0;n<30;n++){
   const pos=await page.evaluate(()=>({y:scrollY,end:scrollY+innerHeight>=document.documentElement.scrollHeight}));
   if(pos.end||pos.y===previous)break;previous=pos.y;await page.evaluate(()=>scrollBy(0,innerHeight*.75));await check();
  }
  await page.getByLabel('Memory note',{exact:true}).focus();
  assert.equal(await page.getByLabel('Memory note',{exact:true}).evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByLabel('Memory note',{exact:true}).evaluate(el=>document.activeElement===el),false);
  await page.getByRole('button',{name:'Show',exact:true}).click();await page.getByRole('button',{name:'Hide',exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));await check();await page.screenshot({path:out+'/vault-'+width+'.png',fullPage:true});
 }
 for(const width of [390,320]){
  assert.ok(observations.some(row=>row.width===width&&row.intersects&&row.launcherVisibility==='hidden'));
  assert.ok(observations.some(row=>row.width===width&&!row.intersects&&row.launcherVisibility==='visible'));
 }
 await fs.writeFile(out+'/layout-observations.json',JSON.stringify(observations,null,2));

}await phase('after-exact-cold-readback');assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/result.json',JSON.stringify({kind,passed:true,noteChars:kind==='large-note'?exact.length:20,fileBytes:kind==='small-note-file'?66*1024*1024:0,errors},null,2));
 }catch(e){await fs.writeFile(out+'/result.json',JSON.stringify({kind,passed:false,message:e.message.split('Call log:')[0].slice(0,300)},null,2));throw Error(e.message.split('Call log:')[0].slice(0,300))}
 finally{await phase('before-browser-cleanup');if(browser)await browser.close().catch(()=>{});await phase('after-browser-cleanup');await fs.writeFile(out+'/observer-stop','done')}
});
