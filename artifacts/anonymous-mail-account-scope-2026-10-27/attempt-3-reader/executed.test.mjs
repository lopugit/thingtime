/* global MailScopeFixture */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const base=process.env.TT_MAIL_SCOPE_URL,dir=process.env.TT_MAIL_SCOPE_ARTIFACTS || '/tmp/native-artifacts';
const fixture=process.env.TT_MAIL_SCOPE_FIXTURE || '/tmp/check/mail-scope.fixture.js';
test('account-scoped offline reader clears before root identity resolves and opens only the next scope', {skip:!base || !process.env.TT_RENDER_SESSION || !process.env.TT_SHARED_PLAYWRIGHT_PATH || !process.env.TT_SHARED_CHROME_PATH,timeout:150000}, async t=>{
 const health=await fetch(base+'/api/v1/health/nitro').then(r=>r.json());
 assert.equal(health.testEnvironment.mode,'isolated-agent-test');assert.equal(health.testEnvironment.sessionId,process.env.TT_RENDER_SESSION);
 const {chromium}=await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
 const browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});
 let release=()=>{};t.after(async()=>{release();await browser.close()});t.signal.addEventListener('abort',()=>{release();void browser.close()},{once:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);
 const errors=[],mail=[],checks=[];let retired=false,pending=false;
 page.on('pageerror',e=>errors.push(e.message));
 context.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/v1/mail'))mail.push({url:r.url(),retired,pending})});
 const registration=async()=>{const username='mail-scope-'+randomUUID();const r=await context.request.post(base+'/api/v1/auth/register',{headers:{Origin:base},data:{username,password:'Fixture-'+randomUUID()+'-9a!',email:username+'@example.test'}});assert.equal(r.status(),200);return (await r.json()).user.id;};
 const inject=()=>page.evaluate(readFile(fixture,'utf8'));
 const seed=async(id,marker)=>{await page.evaluate(await readFile(fixture,'utf8'));return page.evaluate(({id,marker})=>MailScopeFixture.seed(id,marker),{id,marker})};
 const expand=async()=>{const summary=page.locator('summary').filter({has:page.getByText('All inboxes',{exact:true})}).first();await summary.waitFor();if(!await summary.evaluate(el=>el.parentElement.open))await summary.click()};
 const open=async subject=>{await expand();await page.getByRole('button').filter({hasText:subject}).click();await page.getByRole('heading',{level:2,name:subject,exact:true}).waitFor()};
 try{
 const a=await registration();await page.goto(base+'/mail');await expand();const A=await seed(a,'ACCOUNT A');
 await page.reload();await open(A.subject);await page.getByText(A.body,{exact:true}).waitFor();
 await context.setOffline(true);assert.equal(await page.evaluate(async()=>{try{await fetch('/api/root-data',{cache:'no-store'});return false}catch{return true}}),true);
 await page.getByText(A.body,{exact:true}).waitFor();checks.push('normal account reader exact synthetic canonical encrypted data remains visible offline');
 await context.setOffline(false);
 const b=await registration();const B=await seed(b,'ACCOUNT B');
 let rootHeldResolve;const rootHeld=new Promise(r=>rootHeldResolve=r),held=new Promise(r=>release=r);
 await context.route('**/api/root-data*',async route=>{if(pending){rootHeldResolve();await held;}await route.continue()});
 pending=true;retired=true;
 await page.evaluate(()=>{const channel=new BroadcastChannel('thingtime:root-identity');channel.postMessage('identity-changed');channel.close()});
 await rootHeld;
 await page.getByText('Refreshing your session',{exact:true}).waitFor();
 assert.equal(await page.getByText(A.body,{exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:A.subject,exact:true}).count(),0);
 await page.screenshot({path:dir+'/pending-cleared.png'});checks.push('real cross-tab identity invalidation unmounts old reader while root response is held');
 assert.deepEqual(mail.filter(r=>r.retired),[],'no mail requests while new identity is unresolved');
 pending=false;release();await open(B.subject);await page.getByText(B.body,{exact:true}).waitFor();
 assert.equal(await page.getByText(A.body,{exact:true}).count(),0);
 assert.ok(mail.filter(r=>r.retired).every(r=>new URL(r.url).searchParams.get('expectedOwnerId')===b),'no retired-owner request');
 await page.evaluate(await readFile(fixture,'utf8'));
 const proof=await page.evaluate(async({a,b})=>({a:await MailScopeFixture.proof(a),b:await MailScopeFixture.proof(b)}),{a,b});
 assert.deepEqual(proof.a,[{subject:A.subject,text:A.body}]);assert.deepEqual(proof.b,[{subject:B.subject,text:B.body}]);
 const renderedReaders=[];
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:844});await page.getByText(B.body,{exact:true}).waitFor();
  await page.evaluate(async()=>{
   await document.fonts.ready;
   const roots=[document.scrollingElement,...[...document.querySelectorAll('body *')].filter(el=>/auto|scroll/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1)].filter(Boolean);
   for(const root of roots){
    if(root.scrollHeight>40000)throw Error('Unexpected repeating mail content');
    root.scrollTop=0;await new Promise(requestAnimationFrame);
    for(let top=0;top<=root.scrollHeight;top+=Math.max(100,root.clientHeight/2)){
     root.scrollTop=top;await new Promise(requestAnimationFrame);
     if(document.documentElement.scrollWidth>innerWidth)throw Error('Horizontal overflow while scrolling mail');
    }
    root.scrollTop=root.scrollHeight;await new Promise(requestAnimationFrame);
   }
  });
  await page.screenshot({path:dir+`/new-scope-${width}-bottom.png`});
  await page.getByText(B.body,{exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));
  const rendered=await page.evaluate(({subject,body})=>{
   const nodes=[...document.querySelectorAll('h2,p')].filter(el=>el.textContent===subject||el.textContent===body);
   return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,targets:nodes.map(el=>{
    const r=el.getBoundingClientRect();const points=[.2,.5,.8].flatMap(x=>[.25,.5,.75].map(y=>({x:r.left+r.width*x,y:r.top+r.height*y})));
    return {text:el.textContent,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,
     unobscured:points.every(p=>{const hit=document.elementFromPoint(p.x,p.y);return hit===el||el.contains(hit)})};
   })};
  },B);
  await page.screenshot({path:dir+`/new-scope-${width}-reader.png`});
  assert.ok(rendered.documentWidth<=width,JSON.stringify(rendered));assert.equal(rendered.targets.length,2,JSON.stringify(rendered));
  for(const target of rendered.targets){assert.ok(target.x>=0&&target.right<=width&&target.y>=0&&target.bottom<=844,JSON.stringify(rendered));assert.equal(target.unobscured,true,JSON.stringify(rendered));}
  renderedReaders.push(rendered);
 }
 checks.push('1440/390/320px top-to-bottom scrolling without horizontal overflow; exact reader subject/body inside viewport and unobscured at sampled points; normal fixed controls retained');
 checks.push('next root-confirmed account opens its separate saved reader; same message ID does not reuse previous selection; old partition retained unchanged');assert.deepEqual(errors,[]);
 await writeFile(dir+'/verification.json',JSON.stringify({checks,renderedReaders,proof,mail:mail.map(r=>({owner:new URL(r.url).searchParams.get('expectedOwnerId'),retired:r.retired,pending:r.pending})),errors,limits:['synthetic disposable account transition on one loopback origin','no provider mail, native transport, selected-origin change, or installed-app acceptance']},null,2));
 }catch(e){await page.screenshot({path:dir+'/failure.png'}).catch(()=>{});await writeFile(dir+'/failure.json',JSON.stringify({error:e.message,text:await page.locator('body').innerText().catch(()=>''),mail,errors},null,2));throw e}
});
