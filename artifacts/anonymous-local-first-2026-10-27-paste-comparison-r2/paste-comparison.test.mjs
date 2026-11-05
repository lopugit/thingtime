import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const base = process.env.TT_LOCAL_INSTRUCTIONS_URL, artifacts = process.env.TT_LOCAL_INSTRUCTIONS_ARTIFACTS;
test('diagnostic: matched fresh Settings and native textarea replacement costs', { timeout: 240000 }, async t => {
 const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true }); t.after(() => browser.close());
 const control = await browser.newBrowserCDPSession(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
 const username = 'paste-diagnostic-' + randomUUID().slice(0,8);
 const registered = await context.request.post(base + '/api/v1/auth/register', { headers: { Origin: base }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } }); assert.equal(registered.status(), 200);
 const paragraph = 'Native capacity fixture — 日本語 🌟 "quoted" \\ exact wording.\n' + 'Keep this saved instruction editable, private, and available offline. '.repeat(1700) + 'End of the exact device preference.';
 const payload = ['Native capacity fixture', ...Array(12000).fill('🌟漢"' + String.fromCharCode(92)), 'End of exact preference.'].join('\n');
 const original = 'Keep my exact wording.\nMy offline work completes locally — 日本語. ' + 'Exact private preference. '.repeat(4200) + 'End of original.';
 const results = []; let reference;
 for (const mode of ['settings-fresh', 'native-matched', 'settings-history', 'native-matched-no-spellcheck']) {
  const diagnosticContext = mode.startsWith('native') ? await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read','clipboard-write'], serviceWorkers: 'block' }) : null;
  const page = await (diagnosticContext || context).newPage(); page.setDefaultTimeout(20000); const network = await context.newCDPSession(page);
  let input;
  if (mode.startsWith('settings')) {
   await page.goto(base + '/settings/lopu#lopu-instructions', { waitUntil: 'domcontentloaded' });
   const editor = page.locator('#lopu-instructions'), add = editor.getByRole('button', { name: 'Add instruction', exact: true });
   await add.waitFor(); await assert.doesNotReject(add.click()); input = editor.getByLabel('Instruction 1', { exact: true });
   // The first native case derives the actual product's typography, dimensions,
   // wrapping, spelling attributes, font resources and CSS from its live control.
   if (!reference) reference = await input.evaluate(element => {
    const computed = getComputedStyle(element), styles = {};
    for (const key of ['width','height','minHeight','maxHeight','padding','border','boxSizing','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','whiteSpace','overflowWrap','wordBreak','textTransform','textIndent','tabSize','direction','writingMode']) styles[key] = computed[key];
    return { styles, spellcheck: element.spellcheck, wrap: element.wrap, autocorrect: element.getAttribute('autocorrect'), autocapitalize: element.getAttribute('autocapitalize'), autocomplete: element.getAttribute('autocomplete'), css: [...document.querySelectorAll('link[rel=stylesheet]')].map(link => link.href), fontsReady: document.fonts.status };
   });
   if (mode === 'settings-history') for (const value of [original, original + '\nA newer device edit survives the lost reply.', 'Retain my saved device choice for device', 'Independent account change for account']) await input.fill(value);
  } else {
   const path = base + '/__instruction-paste-diagnostic';
   const html = '<!doctype html><html><head><meta charset="utf-8">' + reference.css.map(href => '<link rel="stylesheet" href="' + href + '">').join('') + '</head><body><textarea aria-label="Native matched instructions"></textarea></body></html>';
   await page.route(path, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })); await page.goto(path, { waitUntil: 'load' });
   input = page.getByLabel('Native matched instructions');
   await input.evaluate((element, reference) => { Object.assign(element.style, reference.styles); element.spellcheck = reference.spellcheck; element.wrap = reference.wrap; for (const key of ['autocorrect','autocapitalize','autocomplete']) if (reference[key] !== null) element.setAttribute(key, reference[key]); }, reference);
   if (mode.endsWith('no-spellcheck')) await input.evaluate(element => { element.spellcheck = false; element.setAttribute('autocorrect','off'); });
  }
  await page.evaluate(async () => { await document.fonts.ready; });
  await input.fill(paragraph); await input.scrollIntoViewIfNeeded(); await input.click(); await input.press('Control+A');
  await page.evaluate(text => navigator.clipboard.writeText(text), payload);
  await network.send('Performance.enable');
  const before = { metrics: await network.send('Performance.getMetrics'), processes: await control.send('SystemInfo.getProcessInfo'), control: await input.evaluate(element => ({ valueCharacters: element.value.length, hardLines: element.value.split('\n').length, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, font: getComputedStyle(element).font, lineHeight: getComputedStyle(element).lineHeight, wrap: element.wrap, whiteSpace: getComputedStyle(element).whiteSpace, overflowWrap: getComputedStyle(element).overflowWrap, spellcheck: element.spellcheck, autocorrect: element.getAttribute('autocorrect'), autocapitalize: element.getAttribute('autocapitalize'), autocomplete: element.getAttribute('autocomplete'), fontsReady: document.fonts.status })) };
  await input.evaluate(element => {
   window.__pasteEvents = []; window.__pasteLongTasks = []; window.__pasteStart = performance.now();
   for (const type of ['paste','beforeinput','input']) element.addEventListener(type, event => window.__pasteEvents.push({type, at:performance.now()-window.__pasteStart, inputType:event.inputType, valueLength:element.value.length}), {capture:true});
   new PerformanceObserver(list => window.__pasteLongTasks.push(...list.getEntries().map(entry => ({start:entry.startTime-window.__pasteStart,duration:entry.duration})))).observe({type:'longtask',buffered:false});
  });
  const started = Date.now(); let result;
  try {
   await input.press('Control+V', { timeout: 20000 });
   const exact = await input.evaluate((element, payload) => element.value === payload, payload); const pasteMs = Date.now() - started;
   await input.press('Control+Z'); const undoExact = await input.evaluate((element, paragraph) => element.value === paragraph, paragraph);
   await input.press('Control+Shift+Z'); const redoExact = await input.evaluate((element, payload) => element.value === payload, payload);
   result = { mode, pasteMs, strictFiveSecondPass: pasteMs < 5000, exact, undoExact, redoExact, before, after: { metrics: await network.send('Performance.getMetrics'), processes: await control.send('SystemInfo.getProcessInfo') } };
  } catch (error) { result = { mode, elapsedMs: Date.now() - started, error: String(error).split('\n')[0], before }; }
  result.timeline = await page.evaluate(() => ({ events:window.__pasteEvents, longTasks:window.__pasteLongTasks }));
  results.push(result); await writeFile(artifacts + '/paste-comparison.json', JSON.stringify({ diagnosticOnly: true, matchedReference: reference, results }, null, 2));
  await page.close(); if (diagnosticContext) await diagnosticContext.close();
 }
 await context.close();
 assert.ok(results.filter(value => value.mode.startsWith('settings')).every(value => value.strictFiveSecondPass && value.exact && value.undoExact && value.redoExact), 'Normal Settings must preserve exact native paste/undo/redo within the strict five-second paste threshold; see diagnostic artifact.');
});
