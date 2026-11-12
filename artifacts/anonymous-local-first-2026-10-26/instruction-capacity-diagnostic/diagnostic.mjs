
const {chromium}=await import('/opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs');
const fs=await import('node:fs/promises');
const payload='Native capacity fixture\n'+'🌟漢"\\\n'.repeat(12000)+'End of exact preference.';
const results=[];
for(const mode of ['value','fill-spellcheck-off','fill-spellcheck-on','fill-latin']) {
 const browser=await chromium.launch({executablePath:"/ms-playwright/chromium-1248/chrome-linux-arm64/chrome",headless:true,chromiumSandbox:true});
 const page=await browser.newPage();let result={mode,bytes:Buffer.byteLength(payload),hardLines:payload.split('\n').length};
 try {
  await page.setContent('<textarea aria-label="Instructions" style="width:600px;height:160px"></textarea>');
  await page.locator('textarea').evaluate((el,check)=>el.spellcheck=check,mode==='fill-spellcheck-on');
  const text=mode==='fill-latin'?('line\n'.repeat(12000)):payload;
  const start=Date.now();
  if(mode==='value') await page.locator('textarea').evaluate((el,text)=>{el.value=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));},text);
  else await page.locator('textarea').fill(text,{timeout:30000});
  result.milliseconds=Date.now()-start;
  result.exact=await page.locator('textarea').evaluate((el,text)=>el.value===text,text);
  const tick=Date.now();await page.evaluate(()=>new Promise(requestAnimationFrame));result.frameMs=Date.now()-tick;
 } catch(e) {result.error=String(e).split('\n')[0].slice(0,180);}
 results.push(result);console.log(JSON.stringify(result));
 await Promise.race([browser.close(),new Promise(r=>setTimeout(r,3000))]);
}
console.log('RESULT '+JSON.stringify(results));process.exit(0);
