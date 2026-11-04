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
const origin = 'https://login-fixture.test';
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
      if (message.action === 'vault-cached') {
        reply({ ok: true, catalog: [{ id: 'fixture', title: 'Fixture account', domains: ['login-fixture.test'], hasPassword: true }] });
        return;
      }
      if (message.action !== 'vault-fill') return;
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
