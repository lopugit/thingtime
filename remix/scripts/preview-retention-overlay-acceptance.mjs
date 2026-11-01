// Focused real-page hit testing; use only this task's disposable local session.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const fixture = JSON.parse(await readFile(process.env.TT_RETENTION_SESSION_FILE, 'utf8'));
assert.equal(new URL(fixture.origin).hostname, '127.0.0.1');
const headers = { Cookie: fixture.cookie };
const health = await (await fetch(fixture.origin + '/api/v1/health/mongodb', { headers })).json();
assert.equal(health.host, process.env.TT_RETENTION_DATABASE_HOST); assert.equal(health.connected, true);
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
const context = await browser.newContext();
await context.addCookies(fixture.cookie.split('; ').map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }; }));
const page = await context.newPage();
const out = process.env.TT_RETENTION_EVIDENCE_DIR;
const results = [];
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(fixture.origin + '/admin/preview-retention', { waitUntil: 'domcontentloaded' });
    const host = page.locator('[data-settings-document="preview-retention-settings"]');
    await host.getByRole('button', { name: 'Edit layout', exact: true }).waitFor({ timeout: 90000 });
    await page.locator('.lopuLauncher').waitFor({ state: 'visible', timeout: 60000 });
    const launchersBefore = await page.locator('.lopuLauncher,[class~="tt.devKit"]').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).display !== 'none').length);
    await host.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await host.getByRole('button', { name: 'Open Builder inspector', exact: true }).click();
    const drawer = page.getByTestId('builder-drawer');
    await drawer.getByRole('combobox', { name: 'Select block', exact: true }).selectOption('preview-retention-orphan-grace-input');
    await drawer.getByRole('textbox', { name: 'Element title', exact: true }).fill('Inspector hit target check');
    // Reproduce the former launcher stacking without modifying app state or
    // preferences; compare actual intersections before removing this test style.
    const previous = await page.addStyleTag({ content: 'html:root:has(.ttBuilderDrawer) .lopuLauncher,html:root:has(.ttBuilderDrawer) [class~="tt.devKit"]{display:block!important;}' });
    const baseline = await page.evaluate(() => {
      const hits = [];
      const launchers = [...document.querySelectorAll('.lopuLauncher,[class~="tt.devKit"]')];
      for (const field of document.querySelectorAll('.ttBuilderDrawer input,.ttBuilderDrawer textarea,.ttBuilderDrawer select')) {
        const f = field.getBoundingClientRect(); if (f.width < 1 || f.bottom < 0 || f.top > innerHeight) continue;
        for (const launcher of launchers) {
          const l = launcher.getBoundingClientRect(), left = Math.max(f.left, l.left), right = Math.min(f.right, l.right), top = Math.max(f.top, l.top), bottom = Math.min(f.bottom, l.bottom);
          if (right <= left || bottom <= top) continue;
          const target = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          if (target && launcher.contains(target)) hits.push({ field: field.getAttribute('aria-label') || field.tagName, launcher: launcher.className });
        }
      }
      return hits;
    });
    await previous.evaluate(node => node.remove());
    const inspected = [];
    for (const name of ['Element title', 'Element type', 'Element placeholder']) {
      const field = drawer.getByRole('textbox', { name, exact: true });
      await field.scrollIntoViewIfNeeded();
      const points = await field.evaluate(node => {
        const r = node.getBoundingClientRect();
        return [0.5, 0.9].map(fraction => { const target = document.elementFromPoint(r.left + r.width * fraction, r.top + r.height / 2); return target === node || node.contains(target); });
      });
      assert.ok(points.every(Boolean), `${name} is obscured at ${width}px`); inspected.push(name);
    }
    assert.equal(await page.locator('.lopuLauncher,[class~="tt.devKit"]').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).display !== 'none')), false);
    await page.screenshot({ path: join(out, `retention-inspector-hit-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Close builder', exact: true }).click();
    await page.locator('.lopuLauncher').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.lopuLauncher,[class~="tt.devKit"]').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).display !== 'none').length), launchersBefore);
    await host.getByRole('button', { name: 'Done editing layout', exact: true }).click();
    results.push({ width, baselineBlockedFields: baseline, inspected, launcherRestored: true });
  }
  assert.ok(results.some(result => result.baselineBlockedFields.length > 0), 'The original stacking collision must be reproduced');
  await writeFile(join(out, 'inspector-hit-results.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log('PASS: reproduced original launcher interception; inspector field hit targets clear at1440/390 and launchers restore on close.');
} finally { await context.close(); await browser.close(); }
