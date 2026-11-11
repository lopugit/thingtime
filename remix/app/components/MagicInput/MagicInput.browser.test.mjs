// Actual React/Chakra/MagicInput rendering in an isolated testing Chromium.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(path.join(repo, 'MCP/package.json'));
const { buildSync } = require('esbuild'), { chromium } = require('playwright');
let server, browser, origin;
const observations = [];
const output = process.env.THINGTIME_MAGIC_INPUT_EVIDENCE_DIR;
before(async () => {
 const script = buildSync({ bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: path.join(repo, 'remix/tsconfig.json'), stdin: {
  resolveDir: path.join(repo, 'remix'), sourcefile: 'magic-input-regression.tsx', loader: 'tsx', contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ChakraProvider} from '@chakra-ui/react'; import {MagicInput} from './app/components/MagicInput/MagicInput';
  const parameters=new URL(location.href).searchParams;
  const early=parameters.get('early')==='1', echo=parameters.get('echo')==='1';
  globalThis.trace={changes:[],entered:[]};
  function Fixture(){
   const [value,setValue]=React.useState(parameters.has('value')?parameters.get('value'):undefined);
   const [placeholder,setPlaceholder]=React.useState('Imagine..');
   const [counter,setCounter]=React.useState(0);
   React.useLayoutEffect(()=>{
    const editor=document.querySelector('[contenteditable="true"]');window.trace.initialText=editor.textContent;
    globalThis.initialEditor=editor;
    if(early){editor.focus();editor.innerText='Input before passive effects';editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:editor.innerText}));}
    requestAnimationFrame(()=>requestAnimationFrame(()=>{window.trace.afterMount=editor.textContent;window.trace.settled=true;}));
   },[]);
   globalThis.fixture={setValue,setPlaceholder,rerender:()=>setCounter(value=>value+1)};
   return <MagicInput value={value} placeholder={placeholder} onValueChange={({value})=>{window.trace.changes.push(value);if(echo)setValue(value);}} onEnter={({value})=>window.trace.entered.push(value)}/>;
  }
  createRoot(document.getElementById('root')).render(<ChakraProvider><Fixture/></ChakraProvider>);`
 } }).outputFiles[0].contents;
 server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/fixture.js' ? script : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>');
 });
 server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,chromiumSandbox:true});
 if(output)await mkdir(output,{recursive:true});
});
after(async () => {
 if(output && browser){
  const source=await readFile(new URL('./MagicInput.tsx',import.meta.url));
  await writeFile(path.join(output,'component-regression.json'),JSON.stringify({scope:'Actual component browser regression; synthetic DOM composition, not OS IME acceptance',sourceSha256:createHash('sha256').update(source).digest('hex'),browserVersion:browser.version(),observations},null,2)+'\n');
 }
 await browser?.close(); if(server)await new Promise(resolve=>server.close(resolve));
});
async function open(t, query=''){
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
 page.on('pageerror',error=>{throw error;});await page.goto(origin+'/'+query);await page.waitForFunction(()=>window.trace?.settled);return page;
}
const settled=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

test('input accepted during mount survives passive effects and Enter receives the same raw value', async t=>{
 const page=await open(t,'?early=1');
 assert.deepEqual(await page.evaluate(()=>({initial:window.trace.initialText,after:window.trace.afterMount,changes:window.trace.changes})),{initial:'',after:'Input before passive effects',changes:['Input before passive effects']});
 await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.trace.entered),['Input before passive effects']);
 observations.push({case:'mount-interleaving',textRetained:true,rawEnterValueRetained:true});
});

test('controlled echoes and unrelated renders preserve DOM identity, focus and caret; genuine resets apply',async t=>{
 const page=await open(t,'?echo=1&value=seed');await page.locator('[contenteditable="true"]').focus();
 await page.evaluate(()=>{const node=window.initialEditor.firstChild,range=document.createRange();range.setStart(node,2);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await page.keyboard.type('X');await settled(page);await page.evaluate(()=>window.fixture.rerender());await settled(page);
 assert.deepEqual(await page.evaluate(()=>({text:window.initialEditor.textContent,same:window.initialEditor===document.querySelector('[contenteditable="true"]'),focused:document.activeElement===window.initialEditor,offset:getSelection().anchorOffset})),{text:'seXed',same:true,focused:true,offset:3});
 await page.evaluate(()=>window.fixture.setValue('Remote reset'));await page.waitForFunction(()=>window.initialEditor.textContent==='Remote reset');
 await page.evaluate(()=>window.fixture.setValue(''));await page.waitForFunction(()=>window.initialEditor.textContent==='');
 observations.push({case:'controlled-echo',focusCaretAndIdentityRetained:true,externalResetApplied:true});
});

test('uncontrolled text survives placeholder updates and an explicit empty prop reset clears native DOM',async t=>{
 const page=await open(t);await page.locator('[contenteditable="true"]').focus();await page.keyboard.type('Unsubmitted draft');
 await page.evaluate(()=>window.fixture.setPlaceholder('New hint'));await settled(page);assert.equal(await page.locator('[contenteditable="true"]').textContent(),'Unsubmitted draft');
 await page.evaluate(()=>window.fixture.setValue(''));await page.waitForFunction(()=>window.initialEditor.textContent==='');
 observations.push({case:'uncontrolled-reset',placeholderDidNotErase:true,explicitEmptyResetApplied:true});
});

test('stale local edits cannot swallow a genuine A to B to A external reset',async t=>{
 const page=await open(t);await page.locator('[contenteditable="true"]').focus();await page.keyboard.type('A');
 assert.equal(await page.locator('[contenteditable="true"]').textContent(),'A');
 await page.evaluate(()=>window.fixture.setValue('B'));await page.waitForFunction(()=>window.initialEditor.textContent==='B');
 await page.evaluate(()=>window.fixture.setValue('A'));await settled(page);
 assert.equal(await page.locator('[contenteditable="true"]').textContent(),'A');
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.trace.entered.at(-1)),'A');
 observations.push({case:'stale-local-echo',externalAtoBtoARenderedAndSubmitted:true});
});

test('composition input and prop echoes retain text/caret, and markup values remain inert on initial and later renders',async t=>{
 const page=await open(t,'?echo=1');await page.locator('[contenteditable="true"]').focus();
 await page.evaluate(()=>{
  window.initialEditor.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.initialEditor.textContent='にほん';
  const range=document.createRange();range.setStart(window.initialEditor.firstChild,3);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);
  window.initialEditor.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText',data:'にほん'}));window.fixture.rerender();
 });await settled(page);
 assert.deepEqual(await page.evaluate(()=>({text:window.initialEditor.textContent,offset:getSelection().anchorOffset})),{text:'にほん',offset:3});
 await page.evaluate(()=>window.initialEditor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'にほん'})));await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>window.trace.entered.at(-1)),'にほん');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:844});await page.evaluate(()=>window.fixture.setValue('<b>plain text</b> & "quotes"'));await page.waitForFunction(()=>window.initialEditor.textContent==='<b>plain text</b> & "quotes"');
  assert.equal(await page.locator('[contenteditable="true"] b').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.evaluate(()=>scrollTo(0,0));
  if(output)await page.screenshot({path:path.join(output,`input-${width}.png`)});
 }
 await page.goto(origin+'/?value='+encodeURIComponent('<img src=x onerror="window.executed=true">'));await page.waitForFunction(()=>window.trace?.settled);
 assert.equal(await page.locator('[contenteditable="true"] img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.executed)),false);
 observations.push({case:'composition-and-markup',compositionEchoCaretRetained:true,rawEnterValueRetained:true,initialAndUpdatedMarkupInert:true,widths:[1440,390]});
});
