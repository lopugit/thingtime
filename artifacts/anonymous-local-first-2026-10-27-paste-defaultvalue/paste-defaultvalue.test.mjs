import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base=process.env.TT_LOCAL_INSTRUCTIONS_URL,artifacts=process.env.TT_LOCAL_INSTRUCTIONS_ARTIFACTS;
test('diagnostic native textarea defaultValue/history', {timeout:240000},async t=>{
 const {chromium}=await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
 const browser=await chromium.launch({executablePath:process.env.TT_SHARED_CHROME_PATH,headless:true,chromiumSandbox:true});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 const username='paste-defaultvalue-'+randomUUID().slice(0,8);
 const reg=await context.request.post(base+'/api/v1/auth/register',{headers:{Origin:base},data:{username,email:username+'@example.test',password:randomUUID()+randomUUID()}});assert.equal(reg.status(),200);
 const paragraph='Native capacity fixture — 日本語 🌟 "quoted" \\ exact wording.\n'+'Keep this saved instruction editable, private, and available offline. '.repeat(1700)+'End of the exact device preference.';
 const payload=['Native capacity fixture',...Array(12000).fill('🌟漢"'+String.fromCharCode(92)),'End of exact preference.'].join('\n')+' Edited after paste.';
 assert.equal(Buffer.byteLength(payload,'utf8'),120068);assert.equal(payload.split('\n').length,12002);
 const original='Keep my exact wording.\nMy offline work completes locally — 日本語. '+'Exact private preference. '.repeat(4200)+'End of original.';
 const results=[];
 for(const mode of ['product-history','clone-history','clone-default-sync-history','product-clear-default-history']){
  const page=await context.newPage();page.setDefaultTimeout(25000);
  await page.goto(base+'/settings/lopu#lopu-instructions',{waitUntil:'domcontentloaded'});
  const editor=page.locator('#lopu-instructions');await editor.getByRole('button',{name:'Add instruction',exact:true}).click();
  let input=editor.getByLabel('Instruction 1',{exact:true});await input.waitFor();
  if(mode.startsWith('clone')){
   await input.evaluate(element=>{const clone=element.cloneNode(false);clone.setAttribute('aria-label','Diagnostic clone');clone.value='';clone.defaultValue='';element.replaceWith(clone);});
   input=editor.getByLabel('Diagnostic clone',{exact:true});
  }
  if(mode==='clone-default-sync-history')await input.evaluate(element=>element.addEventListener('input',()=>{element.defaultValue=element.value;}));
  if(mode==='product-clear-default-history')await input.evaluate(element=>document.addEventListener('input',event=>{if(event.target===element)element.defaultValue='';}));
  for(const value of [original,original+'\nA newer device edit survives the lost reply.','Retain my saved device choice for device','Independent account change for account',paragraph])await input.fill(value);
  await page.evaluate(()=>document.fonts.ready);await input.scrollIntoViewIfNeeded();await input.click();await input.press('Control+A');
  await page.evaluate(text=>navigator.clipboard.writeText(text),payload);
  const before=await input.evaluate(element=>({value:element.value.length,defaultValue:element.defaultValue.length,textContent:element.textContent.length,selected:element.selectionEnd-element.selectionStart,connected:element.isConnected}));
  await input.evaluate(element=>{window.__events=[];window.__start=performance.now();for(const type of ['paste','beforeinput','input'])element.addEventListener(type,event=>window.__events.push({type,at:performance.now()-window.__start,inputType:event.inputType,value:element.value.length,defaultValue:element.defaultValue.length,textContent:element.textContent.length}),{capture:true});});
  const started=Date.now();let result;
  try{
   await input.press('Control+V',{timeout:25000});const exact=await input.evaluate((e,p)=>e.value===p,payload),pasteMs=Date.now()-started;
   const after=await input.evaluate(e=>({value:e.value.length,defaultValue:e.defaultValue.length,textContent:e.textContent.length}));
   await input.press('Control+Z');const undoExact=await input.evaluate((e,p)=>e.value===p,paragraph);
   await input.press('Control+Shift+Z');const redoExact=await input.evaluate((e,p)=>e.value===p,payload);
   result={mode,pasteMs,strictFiveSecondPass:pasteMs<5000,exact,undoExact,redoExact,before,after};
  }catch(error){result={mode,before,error:String(error).split('\n')[0],elapsedMs:Date.now()-started};}
  result.events=await page.evaluate(()=>window.__events);results.push(result);
  await writeFile(artifacts+'/paste-defaultvalue.json',JSON.stringify({diagnosticOnly:true,payloadUtf8Bytes:Buffer.byteLength(payload,'utf8'),hardLines:12002,results},null,2));
  console.log(JSON.stringify({mode,pasteMs:result.pasteMs,exact:result.exact,undoExact:result.undoExact,redoExact:result.redoExact,error:result.error}));await page.close();
 }
 assert.ok(results.every(r=>r.exact&&r.undoExact&&r.redoExact),'diagnostic integrity');await context.close();
});
