// Real local API + isolated Chrome acceptance. The session must be synthetic and
// belong to the explicitly selected disposable replica, never a production cookie.
// TT_RETENTION_SESSION_FILE=/private/task/session.json TT_RETENTION_DATABASE_HOST=127.0.0.1:17343
// TT_PLAYWRIGHT_MODULE=/private/tools/node_modules/playwright/index.mjs node scripts/preview-retention-acceptance.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const fixture = JSON.parse(await readFile(process.env.TT_RETENTION_SESSION_FILE, 'utf8'));
const origin = fixture.origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Local disposable origin required');
assert.ok(process.env.TT_RETENTION_DATABASE_HOST, 'Explicit disposable database host required');
const out = resolve(process.env.TT_RETENTION_EVIDENCE_DIR || '/tmp/thingtime-preview-retention-acceptance');
await mkdir(out, { recursive: true });
const headers = { Cookie: fixture.cookie, Origin: origin, 'Content-Type': 'application/json' };
const read = async path => { const response = await fetch(origin + path, { headers }); return { response, body: await response.json() }; };
let ready;
for (let attempt = 0; attempt < 18; attempt++) {
  try { ready = await read('/api/v1/health/mongodb'); if (ready.body.connected) break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 2500));
}
assert.equal(ready?.body.connected, true, 'Local API startup');
assert.equal(ready.body.host, process.env.TT_RETENTION_DATABASE_HOST, 'Wrong database selection');
const me = await read('/api/v1/auth/me');
assert.equal(me.body.user?.id, fixture.userId); assert.equal(me.body.user?.isAdmin, true);
const manifest = await read('/.well-known/thingtime-capabilities.json');
assert.equal(manifest.body.origin, origin);
for (const key of ['api.admin-ci-preview-retention', 'api.integration-ci-preview-retention']) assert.equal(manifest.body.features[key]?.version, '1.0.0');
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_CHROMIUM_EXECUTABLE || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies(fixture.cookie.split('; ').map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: origin, httpOnly: true, sameSite: 'Lax' }; }));
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const toggle = async (name, checked) => {
  const control = page.getByRole('checkbox', { name, exact: true });
  if (await control.isChecked() !== checked) { await control.focus(); await control.press('Space'); }
  assert.equal(await control.isChecked(), checked);
};
const endpoint = '/api/v1/admin/ci/preview-retention';
try {
  await page.goto(origin + '/admin/preview-retention', { waitUntil: 'domcontentloaded' });
  const save = page.getByRole('button', { name: 'Save retention rules', exact: true });
  await save.waitFor({ timeout: 90000 });
  await toggle('Automatic preview cleanup', false);
  await page.getByLabel('Closed or missing PR grace period (hours)', { exact: true }).fill('12');
  await toggle('Remove superseded previews on active PRs', true);
  await page.getByLabel('Superseded preview grace period (hours)', { exact: true }).fill('48');
  await toggle('Expire previews for inactive open PRs', true);
  await page.getByLabel('Days without PR activity', { exact: true }).fill('45');
  const [written] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST'), save.click()]);
  assert.equal(written.status(), 200); const receipt = await written.json();
  const expected = { version: 1, enabled: false, noOpenPrGraceHours: 12, pruneSupersededOpenPr: true, supersededGraceHours: 48, inactivePullRequestDays: 45 };
  assert.deepEqual(receipt.policy, expected);
  const independent = await read(endpoint); assert.deepEqual(independent.body.policy, expected); assert.equal(independent.body.revision, receipt.revision);
  const stale = await fetch(origin + endpoint, { method: 'POST', headers, body: JSON.stringify({ policy: { ...expected, enabled: true }, expectedRevision: null }) });
  assert.equal(stale.status, 409);
  assert.deepEqual((await read(endpoint)).body.policy, expected);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await save.waitFor({ timeout: 60000 });
  assert.equal(await page.getByLabel('Closed or missing PR grace period (hours)', { exact: true }).inputValue(), '12');
  assert.equal(await page.getByLabel('Days without PR activity', { exact: true }).inputValue(), '45');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 20)); } });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Horizontal overflow');
    await page.screenshot({ path: join(out, `retention-${viewport.width}.png`), fullPage: true });
    await page.locator('summary').filter({ hasText: 'Pull request liveliness' }).click();
    await page.locator('summary').filter({ hasText: 'Pull request liveliness' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await toggle('Expire previews for inactive open PRs', false);
  const [disabled] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST'), save.click()]);
  assert.equal(disabled.status(), 200); assert.equal((await read(endpoint)).body.policy.inactivePullRequestDays, null);
  // Hold a real prior-scope read, switch the native selected API origin, then
  // release its stale response. The new editor must never paint those fields.
  let releaseRead, sawRead;
  const intercepted = new Promise(resolve => { sawRead = resolve; });
  const released = new Promise(resolve => { releaseRead = resolve; });
  const holdOldRead = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    sawRead(); await released;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, policy: { ...expected, noOpenPrGraceHours: 666 }, revision: 'old-origin-revision' }) });
  };
  await page.route('**' + endpoint, holdOldRead, { times: 1 });
  await page.getByRole('button', { name: 'Reload saved policy', exact: true }).click();
  await intercepted;
  await page.evaluate(async () => {
    window.thingtimeDesktop = { getInfo: async () => ({ apiOrigin: 'http://localhost:18210' }) };
    const { rootIdentity } = await import('/app/utils/rootIdentity.ts');
    rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation);
  });
  await page.getByRole('alert').filter({ hasText: 'incompatible' }).waitFor();
  releaseRead();
  await page.waitForTimeout(100);
  assert.equal(await page.getByLabel('Closed or missing PR grace period (hours)', { exact: true }).count(), 0, 'Prior-origin read leaked into new scope');
  await page.evaluate(async () => {
    delete window.thingtimeDesktop;
    const { rootIdentity } = await import('/app/utils/rootIdentity.ts');
    rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation);
  });
  await save.waitFor({ timeout: 60000 });
  assert.equal(await page.getByLabel('Closed or missing PR grace period (hours)', { exact: true }).inputValue(), '12');
  // The write reaches the original API, but its delayed acknowledgement must
  // not repopulate a subsequent scope's editor.
  let releaseSave, sawSave;
  const postSeen = new Promise(resolve => { sawSave = resolve; });
  const postReleased = new Promise(resolve => { releaseSave = resolve; });
  await page.route('**' + endpoint, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); sawSave(); await postReleased;
    await route.fulfill({ response });
  }, { times: 1 });
  await page.getByLabel('Closed or missing PR grace period (hours)', { exact: true }).fill('13');
  await save.click(); await postSeen;
  await page.evaluate(async () => {
    window.thingtimeDesktop = { getInfo: async () => ({ apiOrigin: 'http://localhost:18210' }) };
    const { rootIdentity } = await import('/app/utils/rootIdentity.ts');
    rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation);
  });
  await page.getByRole('alert').filter({ hasText: 'incompatible' }).waitFor();
  releaseSave(); await page.waitForTimeout(100);
  assert.equal(await page.getByLabel('Closed or missing PR grace period (hours)', { exact: true }).count(), 0, 'Prior-origin save leaked into new scope');
  await page.evaluate(async () => {
    delete window.thingtimeDesktop;
    const { rootIdentity } = await import('/app/utils/rootIdentity.ts');
    rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation);
  });
  await save.waitFor({ timeout: 60000 });
  assert.equal(await page.getByLabel('Closed or missing PR grace period (hours)', { exact: true }).inputValue(), '13');
  await page.goto(origin + '/settings/admin', { waitUntil: 'domcontentloaded' });
  const outer = page.locator('summary').filter({ hasText: 'Global controls' });
  await outer.waitFor({ timeout: 60000 }); await outer.click();
  await page.getByRole('button', { name: 'Save retention rules', exact: true }).waitFor({ timeout: 60000 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Settings Admin overflow');
    await page.screenshot({ path: join(out, `settings-admin-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed: true, databaseHost: ready.body.host, origin, uiSaveReadback: true, staleSaveRefused: true, desktopMobile: true, inactiveDisabledReadback: true, sharedSettingsAdmin: true, delayedOriginReadsAndSavesFenced: true, revision: receipt.revision, pageErrors: errors }, null, 2));
  console.log('PASS: actual admin save, independent API readback, stale revision refusal, reload, conditional states and desktop/mobile layouts on both admin surfaces.');
} catch (error) {
  await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await context.close(); await browser.close(); }
