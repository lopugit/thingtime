import { readFile } from 'node:fs/promises';
import { chromium } from '../../MCP/node_modules/playwright/index.mjs';
const start=performance.now();
const log=(stage,value)=>console.log(JSON.stringify({ms:Math.round(performance.now()-start),stage,value}));
const policy=JSON.parse(await readFile('../remix/dist/draft-preview/policy.json','utf8'));
const browser=await chromium.launch({headless:true,chromiumSandbox:true,args:['--js-flags=--max-old-space-size=256']});
try {
 const context=await browser.newContext();
 const assets=new Map(await Promise.all(['index.html','runner.js'].map(async name=>['/draft-preview/'+name,await readFile('../remix/dist/draft-preview/'+name)])));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());log('request',url.pathname);
  if(url.origin!=='http://127.0.0.1:19898'||!assets.has(url.pathname)) return route.abort();
  await route.fulfill({body:assets.get(url.pathname),contentType:url.pathname.endsWith('.js')?'text/javascript':'text/html',headers:{'Content-Security-Policy':policy.contentSecurityPolicy}}); log('fulfilled',url.pathname);
 });
 const page=await context.newPage();
 page.on('pageerror',e=>log('pageerror',e.message));
 page.on('console',m=>log('console',m.text().slice(0,500)));
 page.on('load',()=>log('load'));
 page.on('domcontentloaded',()=>log('domcontentloaded'));
 await page.goto('http://127.0.0.1:19898/draft-preview/index.html',{waitUntil:'load',timeout:24000});
 log('loaded',await page.evaluate(()=>({ready:document.readyState,api:!!window.thingtimeDraft})));
} finally {await browser.close();}
