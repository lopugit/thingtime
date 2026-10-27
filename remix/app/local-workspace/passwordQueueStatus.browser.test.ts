import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const fixture = process.env.TT_QUEUE_STATUS_FIXTURE, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, executablePath = process.env.TT_SHARED_CHROME_PATH;
const artifacts = process.env.TT_QUEUE_STATUS_ARTIFACTS || '/tmp/native-artifacts/queue-status';

test('real vault queue component renders unknown/failure/retry and fences identities', {
 skip: !fixture || !playwrightPath || !executablePath, timeout: 90_000
}, async () => {
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, args: ['--no-proxy-server', '--disable-background-networking'] });
 const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(10_000);
 const errors: string[] = [], requests: string[] = [], checks: string[] = [];
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => requests.push(request.url()));
 await mkdir(artifacts, { recursive: true });
 const call = (method: string, ...args: unknown[]) => page.evaluate(({ method, args }: any) => (window as any).queueStatusFixture[method](...args), { method, args });
 const latest = async (vaultId: string, after = -1) => {
  await page.waitForFunction(({ vaultId, after }: any) => (window as any).queueStatusFixture.pending(vaultId).some((id: number) => id > after), { vaultId, after });
  return (await call('pending', vaultId)).at(-1) as number;
 };
 const text = () => page.locator('#root').innerText();
 const waitText = (value: string) => page.waitForFunction(value => document.getElementById('root')!.textContent!.includes(value), value);
 const absent = async (value: string) => assert.ok(!(await text()).includes(value), `Must not render ${value}`);
 const refused = (id: string) => ({ id, recordId: id, revision: 1, state: 'refused', canCopy: true, retryAt: 0 });
 try {
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main></body></html>');
  await page.addScriptTag({ path: fixture });
  await call('render', 'vault-a', 'owner-a'); const first = await latest('vault-a');
  await waitText('checking pending changes'); await absent('no pending account changes'); checks.push('Delayed initial read stays unknown');
  await call('fail', first); await waitText('Could not read pending device changes'); await absent('no pending account changes');
  assert.match(await page.getByRole('status').innerText(), /pending changes unavailable/); checks.push('Initial failure is explicit');
  await page.getByRole('button', { name: 'Refresh account sync', exact: true }).click(); const retry = await latest('vault-a', first);
  await call('complete', retry, [refused('entry-a')], [{ id: 'file-a', state: 'pending' }], { 'entry-a': 'Prior account title' });
  await waitText('Prior account title needs review'); await absent('Could not read pending device changes'); checks.push('Refresh button retries failed read');
  await page.getByLabel('Fixture draft', { exact: true }).fill('Unsaved equivalent scope draft');
  const mount = await page.getByLabel('Fixture draft', { exact: true }).getAttribute('data-mount');
  await call('render', 'vault-a', 'owner-a');
  assert.equal(await page.getByLabel('Fixture draft', { exact: true }).inputValue(), 'Unsaved equivalent scope draft');
  assert.equal(await page.getByLabel('Fixture draft', { exact: true }).getAttribute('data-mount'), mount);
  await waitText('Prior account title needs review'); checks.push('Equivalent scope retains child form state and known rows');
  await page.getByRole('button', { name: 'Refresh account sync', exact: true }).click(); const failedRefresh = await latest('vault-a', retry);
  await waitText('Prior account title needs review'); await call('fail', failedRefresh); await waitText('Showing the last known queue');
  await waitText('Prior account title needs review'); assert.match(await page.getByRole('status').innerText(), /pending changes unavailable/);
  checks.push('Refresh failure retains known rows with an honest failure headline');
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await page.evaluate(async () => {
    if (document.documentElement.scrollHeight > 20_000) throw Error('Unexpected repeated content');
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(100, innerHeight / 2)) {
     scrollTo(0, y); await new Promise(requestAnimationFrame);
     if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('Scroll overflow');
    }
    scrollTo(0, 0);
   });
   const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
   assert.ok(bounds.scroll <= bounds.width + 1, `No horizontal overflow at ${width}`);
   await page.screenshot({ path: resolve(artifacts, `known-failure-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Refresh account sync', exact: true }).click(); const staleSuccess = await latest('vault-a', failedRefresh);
  const switchFrame = await call('render', 'vault-b', 'owner-b');
  assert.ok(!switchFrame.includes('Prior account title'), 'First committed next-vault frame has no prior title');
  await waitText('checking pending changes'); const next = await latest('vault-b');
  await call('complete', staleSuccess, [refused('entry-a')], [], { 'entry-a': 'Late prior account title' });
  await call('complete', next, [refused('entry-b')], [], { 'entry-b': 'Owner B private title' }); await waitText('Owner B private title needs review'); await absent('Prior account title'); await absent('Late prior account title');
  checks.push('Vault change resets prior rows before commit and ignores late successful read');
  await page.getByRole('button', { name: 'Refresh account sync', exact: true }).click(); const staleError = await latest('vault-b', next);
  const scopeFrame = await call('render', 'vault-b', 'owner-c');
  assert.ok(!scopeFrame.includes('Owner B private title'), 'First committed next-scope frame has no prior title'); const scopeNext = await latest('vault-b', staleError);
  await call('fail', staleError); await call('complete', scopeNext); await waitText('no pending account changes'); await absent('Could not read pending device changes'); await absent('Owner B private title');
  checks.push('Scope change clears prior titles and ignores late read error');
  await page.getByRole('button', { name: 'Refresh account sync', exact: true }).click(); const retired = await latest('vault-b', scopeNext);
  await call('dispose'); await call('fail', retired);
  assert.equal(await text(), ''); checks.push('Unmounted reader cannot resurrect status');
  assert.deepEqual(errors, []); assert.deepEqual(requests, [], 'Synthetic component regression makes no network requests');
  await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ scope: 'actual ReactDOM/Chakra AccountPasswordWorkspace with synthetic local promises; canonical API acceptance is separate', checks, pageErrors: errors, requests }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ error: String(error), checks, pageErrors: errors, requests }, null, 2));
  throw error;
 } finally { await context.close(); await browser.close(); }
});
