import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {isolatedAccountBackupProcess,verifyAccountBackupIsolation} from './account-backup-isolation.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const evidence=process.env.TT_REVIEW_EVIDENCE || join(tmpdir(),'thingtime-editable-review-evidence');
const port=28188;
if(!process.env.TT_REVIEW_WORKER){
 const dir=await mkdtemp(join(tmpdir(),'thingtime-review-qa-')); const req=createRequire(root+'/remix/package.json');
 await createRequire(req.resolve('tsx/package.json'))('esbuild').build({entryPoints:[join(root,'remix/scripts/editable-sync-review.browser.tsx')],bundle:true,format:'esm',platform:'browser',tsconfig:join(root,'remix/tsconfig.json'),outfile:join(dir,'fixture.js'),define:{'process.env.NODE_ENV':'"development"'},loader:{'.png':'dataurl','.svg':'dataurl'},logLevel:'error'});
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:dir,TT_REVIEW_WORKER:dir,TT_REVIEW_EVIDENCE:evidence,...(process.env.TT_PLAYWRIGHT_MODULE?{TT_PLAYWRIGHT_MODULE:process.env.TT_PLAYWRIGHT_MODULE}:{})};
 await verifyAccountBackupIsolation(port,env);const child=isolatedAccountBackupProcess(process.execPath,[import.meta.filename],{env,stdio:'inherit'},port,true);const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
 try{const [code]=await once(child,'exit');assert.equal(code,0);}finally{clearTimeout(timer);await rm(dir,{recursive:true,force:true});}
}else{
 const dir=process.env.TT_REVIEW_WORKER;const req=createRequire(import.meta.url);const {chromium}=req(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
 const bundle=await readFile(join(dir,'fixture.js'));const server=createServer((r,res)=>{res.writeHead(200,{'Content-Type':r.url==='/fixture.js'?'application/javascript':'text/html','Cache-Control':'no-store'});res.end(r.url==='/fixture.js'?bundle:'<!doctype html><title>[QA] Sync review journal</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');});server.listen(port,'127.0.0.1');await once(server,'listening');
 let context;const launch=(profile='profile')=>chromium.launchPersistentContext(join(dir,profile),{headless:true,downloadsPath:join(dir,'downloads'),acceptDownloads:false});
 try{
  await mkdir(evidence,{recursive:true});context=await launch();let page=context.pages()[0];
  const errors=[]; page.on('pageerror',e=>{errors.push(String(e));console.log('BROWSER_ERROR',String(e));});
  await page.setViewportSize({width:1440,height:1000}); await page.goto('http://127.0.0.1:'+port);console.log('PAGE_LOADED');
  await page.waitForFunction(()=>!!window.reviewUIFixture,{timeout:30000});
  await page.getByRole('heading',{name:'Review 22 sync conflicts'}).waitFor();
  const fields=page.getByRole('combobox');assert.equal(await fields.count(),20);
  await fields.first().selectOption('remote');await page.getByText('1 of 22 choices ready',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.reviewUIFixture.saved())).rows[0].from,'remote');
  await page.getByRole('button',{name:'Next conflicts',exact:true}).click();await page.getByText('21–22 of 22',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Previous conflicts',exact:true}).click();await page.getByText('1–20 of 22',{exact:true}).waitFor();assert.equal(await fields.first().inputValue(),'remote');
  await page.getByRole('button',{name:'Fail next page read',exact:true}).click();await page.getByRole('button',{name:'Next conflicts',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Synthetic interrupted'}).waitFor();assert.equal(await fields.count(),20);
  assert.equal(await page.getByRole('button',{name:'Save versions and ignore',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'Reload review',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic interrupted'}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Edit layout',exact:true}).click();
  await page.locator('[data-block-id="review-retention"]').click();
  await page.getByRole('textbox',{name:'Block text',exact:true}).fill('Both versions can be saved in your private Timeline. {review.retentionMessage}');
  for (const [id,text] of [['review-path','File: {item.path}'],['review-choice-empty','Select a version'],['review-next','Next conflicts →']]) {
   await page.getByRole('combobox',{name:'Select block',exact:true}).selectOption(id);
   await page.getByRole('textbox',{name:'Block text',exact:true}).fill(text);
  }
  await page.screenshot({path:join(evidence,'builder-edit.png')});
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  await page.getByRole('button',{name:'Save layout',exact:true}).click();await page.getByText('Unsaved layout',{exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Done editing layout',exact:true}).click();
  const layout=await page.evaluate(()=>window.reviewUIFixture.layout());assert.ok(JSON.stringify(layout.crystal.blocks).includes('Both versions can be saved'));
  assert.ok(!JSON.stringify(layout).includes('file-00-'));assert.ok(!JSON.stringify(layout).includes('review-draft'));
  await context.close();context=null;context=await launch();page=context.pages()[0];page.on('pageerror',e=>{errors.push(String(e));console.log('BROWSER_ERROR',String(e));});
  await page.goto('http://127.0.0.1:'+port);console.log('PAGE_LOADED');await page.getByText('1 of 22 choices ready',{exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox').first().inputValue(),'remote');await page.getByText(/^Both versions can be saved/).waitFor();await page.getByText('File: file-00-a-long-name-that-must-wrap-on-a-small-phone.txt',{exact:true}).waitFor();assert.equal(await page.getByRole('combobox').first().locator('option').first().textContent(),'Select a version');assert.ok(await page.getByRole('button',{name:'Next conflicts →',exact:true}).isVisible());
  const scrolls=[];for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
   let steps=0;for(;;){const m=await page.evaluate(()=>({y:scrollY,h:innerHeight,total:document.documentElement.scrollHeight,w:innerWidth,sw:document.documentElement.scrollWidth}));assert.ok(m.sw<=m.w,JSON.stringify(m));steps++;if(m.y+m.h>=m.total-1)break;assert.ok(steps<60);await page.evaluate(()=>scrollBy(0,innerHeight*0.8));}
   await page.screenshot({path:join(evidence,name+'-bottom.png')});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(evidence,name+'.png')});scrolls.push({name,steps});
  }
  await page.getByRole('button',{name:'Cancel review',exact:true}).click();await page.getByText('Review result: cancel',{exact:true}).waitFor();
  for (const action of ['retain','resolve']) {
   await context.close();context=null;context=await launch(action);page=context.pages()[0];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto('http://127.0.0.1:'+port);await page.getByRole('heading',{name:'Review 22 sync conflicts'}).waitFor();
   if(action==='resolve') {
    for(let n=0;n<20;n++){await page.getByRole('combobox').nth(n).selectOption('remote');await page.getByText(`${n+1} of 22 choices ready`,{exact:true}).waitFor();}
    await page.getByRole('button',{name:'Next conflicts',exact:true}).click();await page.getByText('21–22 of 22',{exact:true}).waitFor();
    for(let n=0;n<2;n++){await page.getByRole('combobox').nth(n).selectOption('local');await page.getByText(`${21+n} of 22 choices ready`,{exact:true}).waitFor();}
   }
   await page.getByRole('button',{name:action==='retain'?'Save versions and ignore':'Apply choices and sync',exact:true}).click();
   await page.getByText('Review result: '+action,{exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);const result={rows:22,pageSize:20,choiceRecoveredAfterProcessRestart:true,layoutSavedAndReloaded:true,nestedEdits:['retention text','repeated path','select option','navigation button'],failedPagePreservesRows:true,scrolls,explicitCancel:true,resolveAndRetain:true,coverage:'Production editable review/Builder and real IndexedDB journal; synthetic layout API, not installed native transfer acceptance'};
  await writeFile(join(evidence,'browser-result.json'),JSON.stringify(result,null,2));console.log('EDITABLE_REVIEW_BROWSER_PASS',JSON.stringify(result));
 }catch(error){if(context){await writeFile(join(evidence,'failed-dom.txt'),await context.pages()[0].locator('body').innerText());await context.pages()[0].screenshot({path:join(evidence,'failed.png')});}throw error;}finally{await context?.close();server.close();await once(server,'close');}
}
