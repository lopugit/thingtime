// Real Chromium content-script and runtime messaging with a disposable,
// synthetic vault. No website or Thingtime credentials are read.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass /absolute/path/to/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath));
const sandbox = await mkdtemp(join(tmpdir(), 'thingtime-vault-target-'));
const evidence = process.env.THINGTIME_VAULT_TARGET_EVIDENCE || join(tmpdir(), 'thingtime-vault-target-evidence');
const extension = join(sandbox, 'extension');
// Every AWS URL in this disposable browser is fulfilled by the local fixture.
// The production sign-in page and account are never contacted.
const origin = 'https://signin.aws.amazon.com';
let context;
try {
  await mkdir(extension);
  await mkdir(evidence, { recursive: true });
  for (const file of ['content-vault.js', 'thingtime-icon-32.png'])
    await copyFile(new URL(`../${file}`, import.meta.url), join(extension, file));
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Thingtime vault target fixture', version: '1.0.0',
    background: { service_worker: 'worker.js' },
    permissions: ['storage'],
    content_scripts: [{ matches: [`${origin}/*`], js: ['content-vault.js'] }],
    web_accessible_resources: [{ resources: ['thingtime-icon-32.png'], matches: [`${origin}/*`] }]
  }));
  await writeFile(join(extension, 'worker.js'), `
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message.action === 'state') { reply({ autofillEnabled: true }); return; }
      if (message.action === 'vault-cached' || message.action === 'vault-catalog') {
        globalThis.requesterId=sender.tab.id;
        const initial=[{ id: 'fixture', title: 'Fixture account', domains: ['signin.aws.amazon.com'], hasPassword: true }];
        const cached={ok:true,connected:true,ownerId:'fixture',sessionId:'fixture-session',catalog:initial};
        if(message.action==='vault-cached'&&globalThis.holdCache){
          globalThis.releaseCache=()=>reply(cached);
          return true;
        }
        if(message.action==='vault-catalog'&&globalThis.holdCatalog){
          globalThis.releaseCatalog=kind=>reply(kind==='transient'?{ok:false,retryable:true,ownerId:'fixture'}:kind==='superseded'?{ok:false,superseded:true}:{ok:true,ownerId:'fixture',sessionId:'fixture-session',catalog:[...initial,...globalThis.moreAccounts]});
          return true;
        }
        reply(cached);
        return;
      }
      if (message.action !== 'vault-fill') return;
      if(message.expectedOwnerId!=='fixture'){reply({ok:false,connectionEnded:true});return;}
      if(globalThis.releaseCatalog&&globalThis.holdCatalog){globalThis.releaseCatalog('superseded');delete globalThis.releaseCatalog;globalThis.holdCatalog=false;}
      const send = data => chrome.tabs.sendMessage(sender.tab.id, data, { documentId: sender.documentId });
      void (async () => {
        const capture = await send({ action: 'vault-prepare', targetId: message.targetId });
        if (!capture.ok) { reply(capture); return; }
        await new Promise(resolve => { globalThis.releaseFill = resolve; });
        delete globalThis.releaseFill;
        globalThis.lastResult = await send({
          ...capture, action: 'vault-fill-values', username: 'fixture@example.test', password: 'fixture-value'
        });
        reply(globalThis.lastResult);
      })();
      return true;
    });
  `);

  context = await chromium.launchPersistentContext(join(sandbox, 'profile'), {
    channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = context.pages()[0];
  page.setDefaultTimeout(7_500);
  await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body { margin: 18px } input { box-sizing: border-box; width: 100%; height: 40px; margin: 3px 0 }
    dialog { width: min(80vw, 360px); transform: translateY(8px); overflow: hidden }</style>
    <main></main>` }));
  await page.goto(origin);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const chips = page.getByRole('button', { name: 'Choose a saved Thingtime account', exact: true });
  const chooser = page.getByRole('dialog', { name: 'Choose a Thingtime account' });
  const show = html => page.locator('main').evaluate((main, markup) => { main.innerHTML = markup; }, html);
  const choose = async () => {
    await worker.evaluate(() => { delete globalThis.lastResult; });
    await chips.last().click();
    await chooser.getByRole('button', { name: 'Fixture account' }).click();
    await worker.evaluate(() => new Promise((resolve, reject) => {
      let tries = 0;
      const timer = setInterval(() => {
        if (globalThis.releaseFill || ++tries === 100) {
          clearInterval(timer);
          if (globalThis.releaseFill) resolve();
          else reject(new Error('No pending fill'));
        }
      }, 25);
    }));
  };
  const release = async expected => {
    const result = await worker.evaluate(async () => {
      globalThis.releaseFill();
      for (let retry = 0; retry < 100 && !globalThis.lastResult; retry++)
        await new Promise(resolve => setTimeout(resolve, 25));
      return globalThis.lastResult?.ok;
    });
    assert.equal(result, expected);
  };

  await show('<form id="identify" action="/identify"><input id="field" autocomplete="section-login username"></form>');
  await worker.evaluate(()=>{
    globalThis.holdCatalog=true;
    globalThis.moreAccounts=Array.from({length:64},(_,i)=>({id:'page-two-'+i,title:'Amazon account '+i,username:'synthetic-'+i+'@example.test',domains:['signin.aws.amazon.com'],origins:['https://signin.aws.amazon.com'],hasPassword:true}));
    globalThis.moreAccounts.push(
      {id:'late-root',title:'Amazon root',username:'root-fixture@example.test',domains:['aws.amazon.com'],origins:['https://aws.amazon.com','https://signin.aws.amazon.com'],hasPassword:true},
      {id:'console',title:'Amazon console',domains:['console.aws.amazon.com'],origins:['https://console.aws.amazon.com','https://signin.aws.amazon.com'],hasPassword:true},
      {id:'portal',title:'Amazon portal',domains:['portal.aws.amazon.com'],origins:['https://portal.aws.amazon.com','https://signin.aws.amazon.com'],hasPassword:true},
      {id:'foreign-port',title:'Wrong port',domains:['signin.aws.amazon.com'],origins:['https://signin.aws.amazon.com:8443'],hasPassword:true},
      {id:'foreign-suffix',title:'Wrong host suffix',domains:['signin.aws.amazon.com.evil.test'],origins:['https://signin.aws.amazon.com.evil.test'],hasPassword:true},
      {id:'foreign-prefix',title:'Wrong host prefix',domains:['evilaws.amazon.com'],origins:['https://evilaws.amazon.com'],hasPassword:true},
      {id:'foreign-sibling',title:'Wrong host sibling',domains:['billing.aws.amazon.com'],origins:['https://billing.aws.amazon.com'],hasPassword:true},
      {id:'legacy-unapproved',title:'Wrong legacy hint',domains:['aws.amazon.com'],hasPassword:true}
    );
  });
  await chips.last().click();
  const search=chooser.getByRole('searchbox',{name:'Search saved accounts for this website'});
  await search.fill('fixture');
  assert.equal(await chooser.getByRole('button',{name:'Fixture account'}).count(),1);
  assert.equal(await chooser.locator('.spinner:visible').count(),1);
  const finishCatalog=kind=>worker.evaluate(kind=>new Promise((resolve,reject)=>{
    let tries=0;
    const t=setInterval(()=>{
      if(globalThis.releaseCatalog){clearInterval(t);globalThis.releaseCatalog(kind);delete globalThis.releaseCatalog;resolve();}
      else if(++tries>200){clearInterval(t);reject(new Error('No pending catalog'));}
    },25);
  }),kind);
  await finishCatalog('transient');
  const retry=chooser.getByRole('button',{name:'Retry',exact:true});
  await retry.waitFor();
  assert.equal(await chooser.getByRole('button',{name:'Fixture account'}).count(),1);
  assert.equal(await search.inputValue(),'fixture');
  await retry.click();
  await finishCatalog('success');
  await worker.evaluate(()=>globalThis.holdCatalog=false);
  await chooser.getByRole('button',{name:/Amazon root/}).waitFor();
  assert.equal(await search.inputValue(),'fixture');
  await search.fill('');
  assert.equal(await chooser.locator('button.account').count(),68);
  assert.equal(await chooser.getByRole('button',{name:/Amazon console/}).count(),1);
  assert.equal(await chooser.getByRole('button',{name:/Amazon portal/}).count(),1);
  assert.equal(await chooser.getByRole('button',{name:/Wrong/}).count(),0);
  for(const width of [960,375]){
    await page.setViewportSize({width,height:740});
    await chooser.evaluate(element=>element.scrollTop=element.scrollHeight);
    assert.ok(await chooser.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    await search.fill('root-fixture');
    assert.equal(await chooser.getByRole('button',{name:/Amazon root/}).count(),1);
    await page.screenshot({path:join(evidence,`complete-chooser-${width}.png`)});
    await search.fill('');
  }
  await worker.evaluate(()=>chrome.tabs.sendMessage(globalThis.requesterId,{action:'vault-source-invalidate',sessionId:'obsolete-session'}));
  assert.equal(await chooser.locator('button.account').count(),68);
  await worker.evaluate(()=>chrome.tabs.sendMessage(globalThis.requesterId,{action:'vault-source-invalidate',sessionId:'fixture-session'}));
  await retry.waitFor();
  assert.equal(await chooser.locator('button.account').count(),0);
  await chooser.getByRole('button',{name:'Close account chooser'}).click();
  await worker.evaluate(()=>globalThis.holdCache=true);
  await chips.last().click();
  await worker.evaluate(async()=>{
    for(let n=0;n<200&&!globalThis.releaseCache;n++)await new Promise(resolve=>setTimeout(resolve,25));
    await chrome.tabs.sendMessage(globalThis.requesterId,{action:'vault-source-invalidate',sessionId:'fixture-session'});
    globalThis.releaseCache();delete globalThis.releaseCache;globalThis.holdCache=false;
  });
  await retry.waitFor();
  assert.equal(await chooser.locator('button.account').count(),0,'Invalidation before cached reply must not resurrect rows');
  await chooser.getByRole('button',{name:'Close account chooser'}).click();
  await worker.evaluate(()=>globalThis.holdCatalog=true);
  await choose();
  await release(true);
  assert.equal(await page.locator('#field').inputValue(), 'fixture@example.test');
  await chooser.waitFor({ state: 'hidden' });

  // The next sign-in step replaces the form in the same document.
  for (const tokens of ['current-password webauthn', 'section-login current-password', '']) {
    await show(`<div><input id="field" type="password" autocomplete="${tokens}"><button id="next">Next</button></div>`);
    assert.equal(await page.locator('form').count(), 0);
    await page.locator('#next').evaluate(button => { button.onclick = () => { document.body.dataset.submitted = 'true'; }; });
    await choose();
    await release(true);
    assert.equal(await page.locator('#field').inputValue(), 'fixture-value');
    assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
    await chooser.waitFor({ state: 'hidden' });
  }

  await show('<input id="field" type="password" autocomplete="current-password webauthn">');
  await choose();
  await page.locator('#field').evaluate(field => field.replaceWith(field.cloneNode()));
  await release(false);
  assert.equal(await page.locator('#field').inputValue(), '');
  await chooser.waitFor({ state: 'hidden' });

  await show('<form id="login" action="/login"><input type="hidden" name="elements"><input type="hidden" name="action"></form><input id="field" type="password" form="login">');
  await choose();
  await page.locator('#login').evaluate(form => form.setAttribute('action', 'https://attacker.test/steal'));
  await release(false);
  assert.equal(await page.locator('#field').inputValue(), '');
  await chooser.waitFor({ state: 'hidden' });

  await show(`<input type="password" autocomplete="section-login new-password webauthn">
    <input type="password" autocomplete="section-login one-time-code">
    <input type="password" autocomplete="current-password one-time-code">
    <input type="password" disabled autocomplete="current-password">
    <fieldset disabled><input type="password" autocomplete="current-password"></fieldset>
    <input type="password" readonly autocomplete="current-password">`);
  await chips.first().waitFor({ state: 'hidden' });
  assert.equal(await chips.count(), 0);

  for (const width of [960, 375, 320]) {
    await page.setViewportSize({ width, height: 540 });
    await show('<dialog><input type="password" autocomplete="current-password webauthn"></dialog>');
    await page.locator('dialog').evaluate(dialog => dialog.showModal());
    await chips.last().click();
    await chooser.getByRole('button', { name: 'Fixture account' }).waitFor();
    assert.ok(await chooser.evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
        panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= innerWidth;
    }));
    await page.screenshot({ path: join(evidence, `chooser-${width}.png`) });
    await page.keyboard.press('Escape');
    await chooser.waitFor({ state: 'hidden' });
    assert.equal(await chips.last().evaluate(button => button.getRootNode().activeElement === button), true);
  }
  assert.deepEqual(errors, []);
  console.log(`Chrome autofill target acceptance passed. Evidence: ${evidence}`);
} finally {
  await context?.close();
  await rm(sandbox, { recursive: true, force: true });
}
