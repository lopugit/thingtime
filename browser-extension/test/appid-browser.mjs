// Synthetic isolated Chromium transport + real ES256 verifier. No live account,
// website, credentials or native authentication. Native fallback is a sentinel.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../remix/package.json',import.meta.url));
const {build}=require(require.resolve('esbuild',{paths:[path.dirname(require.resolve('tsx'))]}));
const {verifyRegistrationResponse,verifyAuthenticationResponse}=require('@simplewebauthn/server');
const {chromium}=require(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE||'playwright');
const work=await mkdtemp(path.join(tmpdir(),'thingtime-appid-browser-'));let browser;
const evidence=process.argv[2]||path.join(tmpdir(),'thingtime-appid-browser-evidence');await mkdir(evidence,{recursive:true});
try{
 const bundle=await build({entryPoints:[path.resolve('remix/app/passwords/browserPasskey.ts')],bundle:true,write:false,format:'iife',globalName:'AppidCore',platform:'browser',tsconfig:path.resolve('remix/tsconfig.json'),logLevel:'error'});
 const hook=await readFile(new URL('../page-hook.js',import.meta.url),'utf8');
 browser=await chromium.launch({headless:true});const context=await browser.newContext();
 await context.route('https://login.example.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>AppID synthetic fixture</title><p>Independent AppID compatibility fixture</p>'}));
 const page=await context.newPage();
 await page.addInitScript({content:bundle.outputFiles[0].text+`\n(()=>{let saved; window.fixtureRequests=[];window.fixtureNative=0;Object.defineProperty(navigator.credentials,'get',{configurable:true,writable:true,value:async()=>{window.fixtureNative++;return 'native';}});document.addEventListener('thingtime:extension-state-request',()=>document.dispatchEvent(new CustomEvent('thingtime:extension-state',{detail:JSON.stringify({version:1,enabled:true})})));document.addEventListener('thingtime:extension-request',async event=>{const r=JSON.parse(event.detail);window.fixtureRequests.push(r.publicKey.extensions);const response=await AppidCore.createBrowserPasskeyAssertion(saved.entry,{type:r.type,origin:location.origin,publicKey:r.publicKey},true);document.dispatchEvent(new CustomEvent('thingtime:extension-response',{detail:JSON.stringify({version:1,id:r.id,response})}));});window.fixtureEnroll=async()=>{saved=await AppidCore.prepareBrowserPasskeyRegistration({type:'create',origin:location.origin,publicKey:{challenge:'AQID',rp:{id:'example.com',name:'Synthetic'},user:{id:'BAUG',name:'fixture',displayName:'Fixture'},pubKeyCredParams:[{type:'public-key',alg:-7}]}},true,[]);return saved.response;};})();\n`+hook});
 await page.goto('https://login.example.com/fixture');const registration=await page.evaluate(()=>window.fixtureEnroll());
 const enrolled=await verifyRegistrationResponse({response:registration,expectedChallenge:'AQID',expectedOrigin:'https://login.example.com',expectedRPID:'example.com',requireUserVerification:true});assert.ok(enrolled.registrationInfo);
 const assertion=await page.evaluate(async id=>{const c=await navigator.credentials.get({publicKey:{challenge:new Uint8Array([1,2,3]),rpId:'example.com',allowCredentials:[{type:'public-key',id:Uint8Array.from(atob(id.replace(/-/g,'+').replace(/_/g,'/')),v=>v.charCodeAt(0))}],userVerification:'required',extensions:{appid:'https://login.example.com/legacy-app.json'}}});return c.toJSON();},registration.id);
 assert.deepEqual(assertion.clientExtensionResults,{appid:false});const verified=await verifyAuthenticationResponse({response:assertion,expectedChallenge:'AQID',expectedOrigin:'https://login.example.com',expectedRPID:'example.com',requireUserVerification:true,credential:enrolled.registrationInfo.credential});assert.equal(verified.verified,true);
 assert.deepEqual(await page.evaluate(()=>window.fixtureRequests),[{appid:'https://login.example.com/legacy-app.json'}]);assert.equal(await page.evaluate(()=>window.fixtureNative),0);
 assert.equal(await page.evaluate(()=>navigator.credentials.get({publicKey:{challenge:new Uint8Array([1]),rpId:'example.com',extensions:{appid:'https://foreign.example.com/app'}}})),'native');assert.equal(await page.evaluate(()=>window.fixtureNative),1);
 await page.screenshot({path:path.join(evidence,'appid-browser.png')});await writeFile(path.join(evidence,'receipt.json'),JSON.stringify({passed:true,synthetic:true,actualChromium:true,independentSignatureVerifier:true,appidFalse:true,crossOriginNativeFallback:true},null,2));console.log('PASS AppID browser serialization, actual ES256 verifier and native fallback; synthetic credentials only.');await context.close();
}finally{await browser?.close();await rm(work,{recursive:true,force:true});}
