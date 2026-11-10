import fs from 'node:fs';
import { once } from 'node:events';
import { chromium } from '/opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs';
const bytes=0x100000001,fd=fs.openSync('/tmp/zip64-source.bin','w');fs.ftruncateSync(fd,bytes);fs.writeSync(fd,Buffer.from([173]),0,1,bytes-1);fs.closeSync(fd);
const browserInfo=JSON.parse(fs.readFileSync('/opt/thingtime-browser/browser.json'));
const browser=await chromium.launch({executablePath:browserInfo.executable,headless:true,chromiumSandbox:true});
try {
 const page=await browser.newPage();await page.setContent('<input type="file">');await page.addScriptTag({path:'/tmp/zip64-bundle.js'});await page.locator('input').setInputFiles('/tmp/zip64-source.bin');
 const preflight=await page.evaluate(async()=>{const f=document.querySelector('input').files[0];return {bytes:f.size,last:[...new Uint8Array(await f.slice(0x100000000).arrayBuffer())],nodeBackend:typeof process!=='undefined'}});
 if(preflight.bytes!==bytes||preflight.last.length!==1||preflight.last[0]!==173||preflight.nodeBackend)throw Error('Native File preflight failed '+JSON.stringify(preflight));console.error('file preflight passed');
 const result=await page.evaluate(async ({digest,trailingDigest})=>{const file=document.querySelector('input').files[0],trailing=new TextEncoder().encode('actual trailing ZIP64 offset fixture\n');window.archive=await Zip64Codec.encodeTransferArchiveBlob({manifest:{format:'thingtime.transfer',version:1,roots:['root'],things:[{id:'root',thingtime:['data'],crystal:{}}],files:[{id:'large',targetId:'root',path:'files/000000',name:'source.bin',mime:'application/octet-stream',bytes:file.size,sha256:digest},{id:'trailing',targetId:'root',path:'files/000001',name:'trailing.txt',mime:'text/plain',bytes:trailing.length,sha256:trailingDigest}]},files:new Map([['large',file],['trailing',new Blob([trailing])]])});return {archiveBytes:window.archive.size,last:[...new Uint8Array(await window.archive.slice(-98,-94).arrayBuffer())]};},JSON.parse(fs.readFileSync('/tmp/zip64-expected.json')));
 console.error('encoded '+JSON.stringify(result));
 for(let offset=0;offset<result.archiveBytes;offset+=1024*1024){const chunk=await page.evaluate(async offset=>{const a=new Uint8Array(await window.archive.slice(offset,offset+1024*1024).arrayBuffer());let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s);},offset);if(!process.stdout.write(Buffer.from(chunk,'base64')))await once(process.stdout,'drain');}
 fs.writeFileSync('/tmp/zip64-browser-result.json',JSON.stringify({preflight,...result,browserVersion:browser.version()}));
} finally {await browser.close();fs.rmSync('/tmp/zip64-source.bin',{force:true});}
