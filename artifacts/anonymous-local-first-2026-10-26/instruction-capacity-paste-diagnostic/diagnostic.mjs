
const {chromium}=await import('/opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs');
const {createServer}=await import('node:http');
const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end('<textarea aria-label="Instructions" style="width:600px;height:160px"></textarea>');});
await new Promise(r=>server.listen(18733,'127.0.0.1',r));
const payload=['Native capacity fixture',...Array(12000).fill('🌟漢"'+String.fromCharCode(92)),'End of exact preference.'].join(String.fromCharCode(10));
const browser=await chromium.launch({executablePath:"/ms-playwright/chromium-1248/chrome-linux-arm64/chrome",headless:true,chromiumSandbox:true});
const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();page.setDefaultTimeout(30000);await page.goto('http://127.0.0.1:18733');
const events=[];await page.exposeFunction('record',e=>events.push(e));
await page.locator('textarea').evaluate(el=>{for(const type of ['beforeinput','input','paste'])el.addEventListener(type,e=>window.record({type,inputType:e.inputType,dataLength:e.data?.length}));});
await page.evaluate(text=>navigator.clipboard.writeText(text),payload);
const start=Date.now();await page.locator('textarea').click();await page.keyboard.press('Control+V');
await page.waitForFunction(text=>document.querySelector('textarea').value===text,payload);
const result={mode:'trusted-paste',milliseconds:Date.now()-start,bytes:Buffer.byteLength(payload),hardLines:payload.split(String.fromCharCode(10)).length,events};
await page.keyboard.press('Control+Z');result.undoEmpty=await page.locator('textarea').inputValue()==='';
await page.keyboard.press('Control+Shift+Z');result.redoExact=await page.locator('textarea').inputValue()===payload;
console.log(JSON.stringify(result));await browser.close();server.close();process.exit(0);
