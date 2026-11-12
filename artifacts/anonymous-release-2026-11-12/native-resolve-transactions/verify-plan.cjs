const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const {chromium}=require(require.resolve('playwright',{paths:[path.join(root,'MCP')]}));
(async()=>{
 const source=path.join(root,'docs/progress/anonymous-local-first.html'),out=path.join(root,'artifacts/anonymous-release-2026-11-12/native-resolve-transactions/plan');
 await fs.mkdir(out,{recursive:true}); const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 const results=[],errors=[];let clean=false;
 try{
  for(const width of [1440,390,320]){
   const context=await browser.newContext({viewport:{width,height:width===1440?1000:844}}),page=await context.newPage();
   page.on('pageerror',e=>errors.push(e.message));await page.goto('file://'+source);await page.evaluate(()=>document.fonts.ready);
   const counts=await page.evaluate(()=>({done:document.querySelectorAll('.task[data-status="done"]').length,local:document.querySelectorAll('.task[data-status="local"]').length,todo:document.querySelectorAll('.task[data-status="todo"]').length,stats:[...document.querySelectorAll('.stat strong')].map(e=>Number(e.textContent))}));
   assert.deepEqual(counts.stats,[counts.done,counts.local,counts.todo]);
   let steps=0,bottom=false;
   while(steps++<500){const state=await page.evaluate(()=>({top:scrollY,height:innerHeight,total:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}));assert.equal(state.overflow,false);if(state.top+state.height>=state.total-1){bottom=true;break;}await page.evaluate(()=>scrollBy({top:innerHeight*.8,behavior:'instant'}));}
   assert.equal(bottom,true);await page.screenshot({path:path.join(out,'bottom-'+width+'.png')});
   for(const filter of ['todo','done','local','p0','all']){await page.locator('[data-filter="'+filter+'"]').click();const good=await page.evaluate(filter=>[...document.querySelectorAll('.task:not([hidden])')].every(e=>filter==='all'||filter==='todo'&&e.dataset.status!=='done'||filter==='p0'&&e.dataset.priority==='P0'||e.dataset.status===filter),filter);assert.equal(good,true);}
   await page.locator('#search').fill('missing-search-fixture-5c9469');assert.equal(await page.locator('.task:not([hidden])').count(),0);await page.locator('#search').fill('');
   assert.equal(await page.locator('.task:not([hidden])').count(),counts.done+counts.local+counts.todo);
   const links=await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].every(a=>!a.hash||document.getElementById(a.hash.slice(1))));assert.equal(links,true);
   await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(out,'viewport-'+width+'.png')});await page.locator('#native-resolution-services').scrollIntoViewIfNeeded();await page.locator('#native-resolution-services').screenshot({path:path.join(out,'resolution-'+width+'.png')});
   results.push({width,counts,scroll:{steps,bottom},filters:true,emptySearch:true,navigationTargets:true});await context.close();
  }
 }finally{await browser.close();clean=true;}
 assert.deepEqual(errors,[]);const receipt={passed:true,source:'docs/progress/anonymous-local-first.html',sourceSha256:crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'),scope:'Static plan in isolated task-owned Chromium; no account session',viewports:results,errors,cleanup:clean};await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({passed:true,widths:results.map(x=>x.width),cleanup:clean}));
})().catch(e=>{console.error(e);process.exitCode=1});
