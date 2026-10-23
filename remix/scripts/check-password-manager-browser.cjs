// Task-owned, network-none browser acceptance. Every vault value, API response,
// import and native bridge action is synthetic. This is not device acceptance.
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const puppeteer = require('/opt/thingtime-browser/node_modules/puppeteer-core');
const root = '/home/pwuser/credential-qa', results = `${root}/results`, origin = 'http://127.0.0.1:17643';
const report = { outcome: 'running', checks: [], errors: [], scope: 'Real PasswordManager, panels and Builder; synthetic in-memory vault, import, QR chooser and native bridge only.' };
const record = async check => { report.checks.push(check); await fs.writeFile(`${results}/report.json`, JSON.stringify(report, null, 2)); console.log(check); };
let browser, server;
(async () => {
  await fs.mkdir(results, { recursive: true });
  try {
    assert.equal(Object.values(os.networkInterfaces()).flat().filter(item => !item.internal).length, 0);
    assert.equal((await fs.readFile('/proc/net/route', 'utf8')).trim().split('\n').length, 1);
    await assert.rejects(fetch('http://1.1.1.1', { signal: AbortSignal.timeout(2000) }));
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, origin);
        if (url.pathname === '/redirect-test') { res.writeHead(302, { location: 'http://1.1.1.1' }); res.end(); return; }
        const file = root + '/dist' + (url.pathname === '/' ? '/scripts/password-manager.browser.html' : url.pathname);
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(await fs.readFile(file));
      } catch (error) { if (error.code !== 'ENOENT') report.errors.push(error.message); res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(); }
    });
    await new Promise(resolve => server.listen(17643, '127.0.0.1', resolve));
    const descriptor = JSON.parse(await fs.readFile('/opt/thingtime-browser/browser.json', 'utf8'));
    browser = await puppeteer.launch({ executablePath: descriptor.executable, headless: true, pipe: true, userDataDir: root + '/profile', args: ['--no-proxy-server', '--disable-background-networking'] });
    assert.ok(!browser.process().spawnargs.includes('--no-sandbox'));
    const page = await browser.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await assert.rejects(page.goto(origin + '/redirect-test', { timeout: 4000 }));
    await record('Kernel boundary blocks backend direct IP and browser redirect; Chromium sandbox retained');
    await page.tracing.start({ path: results + '/trace.json', screenshots: false });
    const block = id => `[data-block-id="${id}"]`;
    const main = '[data-settings-document="password-manager"]';
    const source = '[data-settings-document="password-source"]';
    const attachments = '[data-settings-document="password-attachments"]';
    const sourceFiles = '[data-settings-document="password-source-files"]';
    const delay = () => new Promise(resolve => setTimeout(resolve, 150));
    const clickText = async (scope, text) => {
      await page.waitForFunction((scope, text) => [...document.querySelectorAll(`${scope} button`)].some(button => button.textContent.trim() === text && !button.disabled), {}, scope, text);
      await page.evaluate((scope, text) => [...document.querySelectorAll(`${scope} button`)].find(button => button.textContent.trim() === text && !button.disabled).click(), scope, text);
      await delay();
    };
    const replace = async (selector, value) => { await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.type(selector, value); };
    const editText = async (selector, value) => { await page.click(selector); await page.waitForSelector('textarea[aria-label="Block text"]'); await replace('textarea[aria-label="Block text"]', value); await page.keyboard.press('Escape'); };
    const editTitle = async (selector, value) => { await page.click(selector); await page.waitForSelector('input[aria-label="Element title"]'); await replace('input[aria-label="Element title"]', value); await page.keyboard.press('Escape'); };
    const saveLayout = async scope => { await clickText(scope, 'Save layout'); await page.waitForFunction(scope => !document.querySelector(scope).textContent.includes('Unsaved layout'), {}, scope); await clickText(scope, 'Done editing layout'); };
    const openEntry = async () => { await page.waitForSelector(block('password-record')); await page.click(block('password-record')); await page.waitForSelector('input[name="field-password"]'); await page.waitForSelector(`${attachments} ${block('attachment-name')}`); };
    const assertWidth = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await openEntry();
      assert.equal(await page.$eval('input[name="field-password"]', input => input.type), 'password');
      assert.equal(await page.$eval('input[name="field-password"]', input => input.value), 'fixture-password-value');
      await page.click('button[aria-label="Show Password"]');
      assert.equal(await page.$eval('input[name="field-password"]', input => input.type), 'text');
      await page.click('button[aria-label="Hide Password"]');
      assert.equal(await page.$eval('input[name="field-password"]', input => input.type), 'password');
      await page.focus('input[name="field-password"]');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await page.$eval('input[name="field-password"]', input => input.value), '');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => document.querySelector('input[name="field-password"]')?.value === 'fixture-password-value');
      assert.equal(await page.$eval('input[name="field-password"]', input => input.type), 'password');
      await replace('input[name="field-username"]', 'fixture-updated@example.test');
      const savesBefore = await page.evaluate(() => window.passwordFixture.operations().filter(operation => operation === 'save').length);
      await page.evaluate(() => { window.passwordFixture.pauseNext('save'); const button = document.querySelector('[data-block-id="password-save"]'); button.click(); button.click(); document.querySelector('input[name="field-username"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      await page.waitForFunction(() => window.passwordFixture.pending());
      assert.equal(await page.evaluate(() => window.passwordFixture.operations().filter(operation => operation === 'save').length), savesBefore + 1);
      await page.evaluate(() => window.passwordFixture.releasePending());
      await page.waitForFunction(() => window.passwordFixture.savedEntry().fields.find(field => field.id === 'username').value === 'fixture-updated@example.test');
      await page.waitForFunction(() => /^\d{6} · \d+s$/.test(document.querySelector('[data-block-id="password-totp-code"]')?.value || ''));
      if (width === 1440) {
        await page.focus(block('password-totp-code'));
        const beforeCode = await page.$eval(block('password-totp-code'), input => input.value.slice(0, 6));
        await page.evaluate(() => { window.fixtureClock = Date.now; const shifted = Date.now() + 30000; Date.now = () => shifted; });
        await page.waitForFunction(before => document.querySelector('[data-block-id="password-totp-code"]')?.value.slice(0, 6) !== before, {}, beforeCode);
        assert.ok(await page.$eval(block('password-totp-code'), input => document.activeElement === input && /^\d{6} · \d+s$/.test(input.value)));
        await page.evaluate(() => { Date.now = window.fixtureClock; delete window.fixtureClock; });
      }
      await assertWidth();
      await page.screenshot({ path: `${results}/${width}-passwords.png`, fullPage: true });
      await record(`${width}px: real private inputs type/save once for rapid click/Enter, focused blur/focus restores masked value, synthetic TOTP updates; layout fits`);
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await page.click(block('password-native-connect'));
    await page.waitForFunction(() => window.passwordFixture.nativeOperations().includes('connect'));
    await page.waitForFunction(() => document.querySelector('[data-block-id="password-native-message"]')?.textContent.includes('Synthetic AutoFill connect completed'));
    await page.click(block('password-native-disconnect'));
    await page.waitForFunction(() => window.passwordFixture.nativeOperations().includes('disconnect'));
    await page.click(block('password-qr-screen'));
    await page.waitForFunction(() => document.querySelector('[data-block-id="password-error"]')?.textContent.length > 0);
    assert.equal(await page.$eval('input[name="field-password"]', input => input.type), 'password');
    await page.$eval(block('password-qr-upload'), async input => {
      const blob = await (await fetch(window.passwordFixture.qrFixtureUrl)).blob();
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'synthetic-totp.png', { type: 'image/png' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => [...document.querySelectorAll('input[name^="field-"]')].some(input => input.value === 'otpauth://totp/Fixture?secret=JBSWY3DPEHPK3PXP&issuer=ThingtimeQA'));
    await page.click(block('password-save'));
    await page.waitForFunction(() => window.passwordFixture.savedEntry().fields.filter(field => field.type === 'totp').length === 2);
    await record('Synthetic native connect/disconnect completes; cancelled synthetic screen chooser reports failure; real QR decoder imports and saves the public synthetic TOTP setup image');

    await page.click(`${source} ${block('source-history-summary')}`);
    await page.waitForSelector(`${source} ${block('source-history-value')}`, { visible: true });
    assert.equal(await page.$eval(`${source} ${block('source-history-value')}`, input => input.type), 'password');
    await page.click(`${source} ${block('source-history-reveal')}`);
    assert.equal(await page.$eval(`${source} ${block('source-history-value')}`, input => input.value), 'fixture-old-password');
    assert.equal(await page.$eval(`${source} ${block('source-history-value')}`, input => input.type), 'text');
    await page.click(`${source} ${block('source-original-summary')}`);
    await page.waitForSelector(`${source} ${block('source-item-reveal')}`, { visible: true });
    await page.$eval(`${source} ${block('source-item-reveal')}`, element => element.scrollIntoView({ block: 'center' }));
    await delay();
    assert.ok(await page.$eval(`${source} ${block('source-item-reveal')}`, element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), 'source reveal hit target');
    await page.click(`${source} ${block('source-item-reveal')}`);
    await page.waitForSelector(`${source} ${block('source-item-value')}`);
    assert.ok(await page.$eval(`${source} ${block('source-item-value')}`, input => input.value.includes('fixture-source-secret')));
    await page.evaluate(() => window.dispatchEvent(new Event('thingtime:hide-vault-values')));
    await page.waitForSelector(source, { hidden: true });
    assert.equal(await page.$(block('password-editor')), null);
    await openEntry();
    assert.equal(await page.$eval(`${source} ${block('source-history-value')}`, input => input.type), 'password');
    await record('Source history and original data reveal only through private controls; hide-vault event closes private panels and reopened history is masked');

    await clickText(main, 'Edit layout');
    assert.equal(await page.$eval('input[name="field-password"]', input => input.value), '');
    await editText(`${main} ${block('password-heading')}`, 'My passwords');
    await editText(`${main} ${block('password-record-title')}`, 'Saved {item.title}');
    await editText(`${main} ${block('password-field-caption')}`, 'Field {item.label}');
    await editTitle(`${main} ${block('password-title')}`, 'Choose a private entry title');
    await saveLayout(main);
    await clickText(source, 'Edit layout');
    await editText(`${source} ${block('source-history-heading')}`, 'Earlier passwords ({source.historyCount})');
    await editTitle(`${source} ${block('source-account')}`, 'Original account label');
    await saveLayout(source);
    await clickText(attachments, 'Edit layout');
    await editText(`${attachments} ${block('attachment-heading')}`, 'My {files.heading}');
    await editText(`${attachments} ${block('attachment-name')}`, 'File {item.name}');
    await saveLayout(attachments);
    await clickText(sourceFiles, 'Edit layout');
    await editText(`${sourceFiles} ${block('attachment-name')}`, 'Source {item.name}');
    await saveLayout(sourceFiles);
    assert.equal(await page.evaluate(() => window.passwordFixture.hasPrivateLayoutValues()), false);
    const layouts = await page.evaluate(() => window.passwordFixture.layouts());
    assert.equal(Object.keys(layouts).length, 4);
    const serialized = JSON.stringify(layouts);
    for (const value of ['Synthetic login', 'Synthetic attachment.txt', 'Synthetic source.txt', 'fixture-updated@example.test', '11111111-1111-4111-8111-111111111111']) assert.ok(!serialized.includes(value), 'live vault state entered layout');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-block-id="password-heading"]')?.textContent === 'My passwords');
    await openEntry();
    assert.equal(await page.$eval(block('password-record-title'), node => node.textContent), 'Saved Synthetic login');
    assert.equal(await page.$eval(block('password-field-caption'), node => node.textContent), 'Field Username');
    assert.equal(await page.$eval(block('password-title'), node => node.title), 'Choose a private entry title');
    assert.equal(await page.$eval(`${source} ${block('source-account')}`, node => node.title), 'Original account label');
    assert.equal(await page.$eval(`${source} ${block('source-history-heading')}`, node => node.textContent), 'Earlier passwords (1)');
    assert.ok(await page.$eval(`${attachments} ${block('attachment-name')}`, node => node.textContent.startsWith('File ')));
    assert.ok(await page.$eval(`${sourceFiles} ${block('attachment-name')}`, node => node.textContent.startsWith('Source ')));
    await replace('input[name="field-username"]', 'fixture-reloaded@example.test');
    await page.click(block('password-save'));
    await page.waitForFunction(() => window.passwordFixture.savedEntry().fields.find(field => field.id === 'username').value === 'fixture-reloaded@example.test');
    await page.screenshot({ path: `${results}/1440-builder-saved.png`, fullPage: true });
    await page.setViewport({ width: 390, height: 1000 });
    await assertWidth();
    await page.screenshot({ path: `${results}/390-builder-saved.png`, fullPage: true });
    await clickText(main, 'Edit layout');
    await page.click(block('password-field-caption'));
    await page.waitForSelector('textarea[aria-label="Block text"]');
    await assertWidth();
    await page.screenshot({ path: `${results}/390-builder.png` });
    await page.keyboard.press('Escape');
    await clickText(main, 'Done editing layout');
    await record('Builder independently edits main/repeated field/card controls and source/history/attachment panels; four layouts reload without live secrets, identities or file keys; saved input still works and mobile inspector fits');

    await page.click(`${attachments} ${block('attachment-remove')}`);
    await page.waitForSelector(`${attachments} ${block('attachment-name')}`, { hidden: true });
    assert.ok(await page.$(`${sourceFiles} ${block('attachment-name')}`));
    await record('Removing the synthetic writable attachment preserves the separate read-only source attachment');

    await page.setViewport({ width: 1440, height: 1000 });
    await page.click(block('password-hide'));
    await page.waitForSelector(block('password-editor'), { hidden: true });
    await page.evaluate(() => window.passwordFixture.pauseNext('read'));
    await page.click(block('password-record'));
    await page.waitForFunction(() => window.passwordFixture.pending());
    await clickText(main, 'Edit layout');
    await page.evaluate(() => window.passwordFixture.releasePending());
    await delay();
    await clickText(main, 'Done editing layout');
    await delay();
    assert.equal(await page.$(block('password-editor')), null);
    await record('Entering Builder cancels a pending synthetic vault read; late response cannot reopen the private editor');

    await page.click(block('password-import'));
    await page.waitForSelector(block('password-import-file'), { visible: true });
    await page.$eval(block('password-import-file'), input => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['name,url,username,password\nSynthetic imported,https://example.test,fixture-import-user,fixture-import-secret\n'], 'fixture.csv', { type: 'text/csv' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector(block('password-import-entry'));
    assert.equal(await page.evaluate(() => window.passwordFixture.hasSavedTitle('Synthetic imported')), false);
    await page.click(block('password-transfer-confirm'));
    await page.waitForFunction(() => window.passwordFixture.hasSavedTitle('Synthetic imported'));
    await page.waitForSelector(block('password-transfer'), { hidden: true });
    await page.click(block('password-export'));
    await page.waitForSelector(block('password-export-format'), { visible: true });
    await page.select(block('password-export-format'), 'chrome');
    assert.equal(await page.$eval(block('password-transfer-confirm'), button => button.disabled), true);
    await page.click(block('password-export-acknowledgement'));
    await page.click(block('password-transfer-confirm'));
    await page.waitForFunction(() => window.passwordFixture.operations().includes('export'));
    await page.waitForSelector(block('password-transfer'), { hidden: true });
    assert.equal(await page.evaluate(() => window.passwordFixture.hasPrivateLayoutValues()), false);
    await record('Real CSV parser previews synthetic import before explicit save; synthetic CSV export requires acknowledgement; authored layouts remain private-data-free');
    await page.goto(origin + '/?pauseCapability=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.passwordFixture?.pending());
    await page.click(block('password-add'));
    await page.waitForSelector(block('password-title'));
    await page.type(block('password-title'), 'Synthetic pending save');
    await page.click(block('password-save'));
    await clickText(main, 'Edit layout');
    await page.evaluate(() => window.passwordFixture.releasePending());
    await page.waitForFunction(() => !window.passwordFixture.pending());
    await delay();
    await clickText(main, 'Done editing layout');
    await delay();
    assert.ok(!(await page.evaluate(() => window.passwordFixture.operations())).includes('save'));
    assert.equal(await page.evaluate(() => window.passwordFixture.hasSavedTitle('Synthetic pending save')), false);
    await record('Entering Builder while capability checks wait cancels the pending secret save before any password POST');
    await page.tracing.stop();
    assert.deepEqual(report.errors, []);
    report.outcome = 'passed';
  } catch (error) {
    report.outcome = 'failed'; report.error = error.stack;
    if (browser) { const page = (await browser.pages()).at(-1); await page.screenshot({ path: `${results}/failure.png` }).catch(() => {}); await fs.writeFile(`${results}/failure.html`, await page.content()).catch(() => {}); await page.tracing.stop().catch(() => {}); }
  } finally {
    await browser?.close(); server?.close();
    await fs.writeFile(`${results}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); process.exitCode = report.outcome === 'passed' ? 0 : 1;
  }
})();
