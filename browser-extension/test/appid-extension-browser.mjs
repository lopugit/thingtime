// Packaged MV3 transport with a loopback synthetic provider and independent
// verifier. AWS-shaped page bytes are intercepted; no real account is used.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../remix/package.json', import.meta.url));
const {build} = require(require.resolve('esbuild', {paths:[path.dirname(require.resolve('tsx'))]}));
const {ZipReader, Uint8ArrayReader, Uint8ArrayWriter} = require('@zip.js/zip.js');
const {verifyRegistrationResponse, verifyAuthenticationResponse} = require('@simplewebauthn/server');
const {chromium} = require(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE || 'playwright');
const work = await mkdtemp(path.join(tmpdir(), 'thingtime-appid-mv3-')), extension = path.join(work, 'extension');
const evidence = process.argv[2] || path.join(tmpdir(), 'thingtime-appid-mv3-evidence');
const origin = 'https://signin.aws.amazon.com', rpId = 'aws.amazon.com', appid = 'https://aws.amazon.com/legacy/app-id.json';
let context, server;
try {
  await mkdir(extension); await mkdir(evidence, {recursive:true});
  const zip = new ZipReader(new Uint8ArrayReader(await readFile(new URL('../../remix/public/downloads/thingtime-passwords-extension.zip', import.meta.url))));
  try {
    for (const entry of await zip.getEntries()) {
      assert.ok(!entry.directory && !entry.filename.includes('/'));
      await writeFile(path.join(extension, entry.filename), await entry.getData(new Uint8ArrayWriter()));
    }
  } finally { await zip.close(); }
  const bundle = await build({entryPoints:[path.resolve('remix/app/passwords/browserPasskey.ts')], bundle:true, write:false, format:'iife', globalName:'AppidCore', platform:'browser', tsconfig:path.resolve('remix/tsconfig.json'), logLevel:'error'});
  const core = new Function(bundle.outputFiles[0].text + ';return AppidCore;')();
  const saved = await core.prepareBrowserPasskeyRegistration({type:'create', origin, publicKey:{challenge:'AQID', rp:{id:rpId,name:'Synthetic'}, user:{id:'BAUG',name:'fixture',displayName:'Fixture'},pubKeyCredParams:[{type:'public-key',alg:-7}]}}, true, []);
  const enrolled = await verifyRegistrationResponse({response:saved.response, expectedChallenge:'AQID', expectedOrigin:origin, expectedRPID:rpId, requireUserVerification:true});
  assert.ok(enrolled.registrationInfo);
  const providerScript = `const saved=${JSON.stringify(saved.entry)};
    document.addEventListener('thingtime:password-provider-request', async event => {
      const r=JSON.parse(event.detail);
      try {
        const response=await AppidCore.createBrowserPasskeyAssertion(saved,r,true);
        document.dispatchEvent(new CustomEvent('thingtime:password-provider-response',{detail:JSON.stringify({version:1,id:r.id,response})}));
      } catch(error) {
        document.dispatchEvent(new CustomEvent('thingtime:password-provider-response',{detail:JSON.stringify({version:1,id:r.id,error:{name:error.name}})}));
      }
    });
    const ready=()=>document.dispatchEvent(new CustomEvent('thingtime:password-provider-ready',{detail:JSON.stringify({version:1})}));
    document.addEventListener('thingtime:password-provider-init',ready);ready();`;
  server = createServer((req,res) => {
    const scripts = {'/core.js':bundle.outputFiles[0].text, '/provider.js':providerScript};
    res.writeHead(req.url==='/passwords/provider' || scripts[req.url] ? 200 : 404, {'Content-Type':scripts[req.url] ? 'application/javascript' : 'text/html'});
    res.end(scripts[req.url] || (req.url==='/passwords/provider' ? '<!doctype html><title>Synthetic AppID provider</title><p>Packaged extension fixture</p><script src="/core.js"></script><script src="/provider.js"></script>' : 'Synthetic fixture only'));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const providerOrigin = `http://127.0.0.1:${server.address().port}`;
  context = await chromium.launchPersistentContext(path.join(work,'profile'), {headless:true, channel:'chromium', ...(process.env.THINGTIME_TEST_CHROMIUM_EXECUTABLE ? {executablePath:process.env.THINGTIME_TEST_CHROMIUM_EXECUTABLE} : {}), chromiumSandbox:true, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route('https://**/*', route => new URL(route.request().url()).origin===origin ? route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic AWS-shaped assertion</title><p>Complete MV3 AppID fixture</p>'}) : route.fulfill({status:404,body:'Synthetic fixture only'}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(origin => chrome.storage.local.set({enabled:true,autofillEnabled:false,origin}), providerOrigin);
  const page = await context.newPage(); await page.goto(origin+'/fixture');
  const hook = await page.evaluate(() => new Promise(resolve => {
    document.addEventListener('thingtime:extension-diagnostics', event => resolve(JSON.parse(event.detail)), {once:true});
    document.dispatchEvent(new CustomEvent('thingtime:extension-diagnostics-query'));
  }));
  assert.equal(hook.installed.get,true); assert.equal(hook.current.get,true); assert.equal(hook.enabledSeen,true);
  const popupPromise=context.waitForEvent('page',{predicate:p=>p!==page,timeout:20000});
  const result = await page.evaluate(async ({id,rpId,appid}) => {
    const c=await navigator.credentials.get({publicKey:{timeout:20000,challenge:new Uint8Array([1,2,3]),rpId,allowCredentials:[{type:'public-key',id:Uint8Array.from(atob(id.replace(/-/g,'+').replace(/_/g,'/')),v=>v.charCodeAt(0))}],userVerification:'discouraged',extensions:{appid}}});
    return c.toJSON();
  }, {id:saved.response.id,rpId,appid});
  assert.deepEqual(result.clientExtensionResults,{appid:false});
  assert.equal((await verifyAuthenticationResponse({response:result,expectedChallenge:'AQID',expectedOrigin:origin,expectedRPID:rpId,requireUserVerification:true,credential:enrolled.registrationInfo.credential})).verified,true);
  const popup=await popupPromise;if(!popup.isClosed())await popup.waitForEvent('close',{timeout:5000});
  assert.equal(context.pages().filter(p=>p.url()===providerOrigin+'/passwords/provider').length,0);
  assert.equal(await worker.evaluate(async()=>((await chrome.storage.session.get('pending')).pending||[]).length),0);
  await page.screenshot({path:path.join(evidence,'appid-mv3.png')});
  await writeFile(path.join(evidence,'receipt.json'),JSON.stringify({passed:true,synthetic:true,packagedExtension:true,version:'0.5.1',actualMV3Messaging:true,parentDomainAppId:true,independentSignatureVerifier:true,appidFalse:true,ownedPopupCleanup:true},null,2));
  console.log('PASS packaged MV3 AppID transport, independent ES256 verification and popup cleanup; synthetic provider only.');
} finally {
  await context?.close(); if(server) await new Promise(resolve=>server.close(resolve));
  await rm(work,{recursive:true,force:true});
}
