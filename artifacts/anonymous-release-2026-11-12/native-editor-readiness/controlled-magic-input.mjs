// Controlled rendering of the actual MagicInput. This isolates its mount
// ordering; it is not native keyboard or complete app acceptance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = process.cwd(), require = createRequire(path.join(repo, 'MCP/package.json'));
const { buildSync } = require('esbuild'), { chromium } = require('playwright');
const output = path.dirname(fileURLToPath(import.meta.url));
const script = buildSync({ bundle: true, platform: 'browser', format: 'iife', write: false,
 define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: path.join(repo, 'remix/tsconfig.json'), stdin: {
 resolveDir: path.join(repo, 'remix'), sourcefile: 'controlled-magic-input.tsx', loader: 'tsx', contents: `
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import {ChakraProvider} from '@chakra-ui/react';
 import {MagicInput} from './app/components/MagicInput/MagicInput';
 const expected = 'Synthetic readiness witness';
 const early = new URL(location.href).searchParams.get('early') === '1';
 globalThis.result = {early, changes:[]};
 function Fixture(){
  React.useLayoutEffect(()=>{
   const editor = document.querySelector('[contenteditable="true"]');
   result.atLayout = editor.textContent;
   if(early){editor.focus();editor.innerText=expected;editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:expected}));result.afterEarlyInput=editor.textContent;}
   requestAnimationFrame(()=>requestAnimationFrame(()=>{result.afterMountEffects=editor.textContent;result.settled=true;}));
  },[]);
  return <MagicInput placeholder="Imagine.." onValueChange={({value})=>result.changes.push(value)}/>;
 }
 createRoot(document.getElementById('root')).render(<ChakraProvider><Fixture/></ChakraProvider>);`
 } }).outputFiles[0].contents;
const server = createServer((req, res) => {
 res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
 res.end(req.url === '/fixture.js' ? script : '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>');
});
let browser;
try {
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 browser = await chromium.launch({ headless: true, chromiumSandbox: true });
 const page = await browser.newPage();
 const failures=[];page.on('pageerror', error=>failures.push(error.message));
 const origin = `http://127.0.0.1:${server.address().port}`;
 await page.goto(origin+'/?early=1'); await page.waitForFunction(()=>window.result?.settled);
 const early = await page.evaluate(()=>window.result);
 assert.equal(early.atLayout, 'Imagine..');
 assert.equal(early.afterEarlyInput, 'Synthetic readiness witness');
 assert.ok(early.changes.includes('Synthetic readiness witness'));
 assert.equal(early.afterMountEffects, '', 'Mount effect erased input delivered before initial reconciliation');
 await page.goto(origin+'/?early=0'); await page.waitForFunction(()=>window.result?.settled && document.querySelector('[contenteditable="true"]').textContent==='');
 await page.locator('[contenteditable="true"]').focus();
 await page.keyboard.type('Synthetic readiness witness');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const late = await page.evaluate(()=>({...window.result, finalText:document.querySelector('[contenteditable="true"]').textContent}));
 assert.equal(late.finalText, 'Synthetic readiness witness'); assert.deepEqual(failures,[]);
 await page.screenshot({path:path.join(output,'settled-input.png')});
 const source = await readFile(path.join(repo,'remix/app/components/MagicInput/MagicInput.tsx'));
 await writeFile(path.join(output,'controlled-result.json'),JSON.stringify({passed:true,scope:'Actual component controlled mount-order reproduction; no native app claim',sourceSha256:createHash('sha256').update(source).digest('hex'),browserVersion:browser.version(),early,late,failures},null,2)+'\n');
 console.log(JSON.stringify({passed:true,earlyTextErased:true,settledKeyboardTextRetained:true}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
