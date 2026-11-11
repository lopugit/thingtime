import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

// Actual SecureVaultScope and encrypted LocalProviderVault in disposable Chrome.
// Unrelated account reveal, plan settings and toast surfaces are outside this
// fixture. No provider, account API or real credential is used.
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, '../MCP/package.json'));
const evidence = resolve(process.env.SECURE_VAULT_EVIDENCE_DIR || join(tmpdir(), 'thingtime-console-vault-ui'));
const dir = await mkdtemp(join(tmpdir(), 'tt-console-vault-ui-'));
const stubs = {
 'useLopu.tsx': 'export const useLopu=()=>()=>{};',
 'ChatGPTPlanSettings.tsx': 'export const ChatGPTPlanSettings=()=>null;',
 'VaultReveal.tsx': 'export const VaultReveal=()=>null;',
 'DeviceProviderVault.tsx': 'export const DeviceProviderVault=()=>null;export const DeviceProviderReveal=()=>null;',
 'AccountProviderWorkspace.tsx': 'export const AccountProviderWorkspace=()=>null;'
};
let browser, server;
let manifestVersion = '1.5.0', remoteWrites = 0;
const results = [];
try {
 await mkdir(evidence, { recursive: true });
 await require('esbuild').build({ entryPoints: [join(root, 'scripts/secure-vault-console.browser.tsx')], bundle: true,
  format: 'esm', platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error', plugins: [{ name: 'unrelated-settings-surfaces', setup(build) {
   build.onLoad({ filter: /(?:useLopu|ChatGPTPlanSettings|VaultReveal|DeviceProviderVault|AccountProviderWorkspace)\.tsx$/ }, args =>
    ({ contents: stubs[basename(args.path)], loader: 'js' }));
  } }] });
 const bundle = await readFile(join(dir, 'fixture.js'));
 server = createServer((request, response) => {
  if (request.url === '/.well-known/thingtime-capabilities.json') {
   response.writeHead(200, { 'Content-Type': 'application/json' });
   response.end(JSON.stringify({ schemaVersion: 1, origin: 'http://127.0.0.1:22743', features: { 'api.lopu-vault': { version: manifestVersion } } })); return;
  }
  if (request.url === '/api/v1/lopu/vault') {
   if (request.method === 'POST') { remoteWrites++; request.resume(); }
   response.writeHead(200, { 'Content-Type': 'application/json' });
   response.end(JSON.stringify({ ok: true, vaultConfigured: true, groups: [], entries: [], providerTemplates: [
    { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1', tokenLabel: 'API key', models: [{ id: 'synthetic-openai', label: 'Synthetic default' }] },
    { id: 'anthropic-api-key', label: 'Anthropic Console API key', endpoint: 'https://api.anthropic.com', tokenLabel: 'Anthropic Console API key', models: [{ id: 'synthetic-claude', label: 'Synthetic Claude' }] }
   ] })); return;
  }
  const asset = request.url === '/fixture.js';
  response.writeHead(200, { 'Content-Type': asset ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  response.end(asset ? bundle : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>[LC] Secure Vault Console fixture</title><div id="root"></div><script type="module" src="/fixture.js"></script>');
 });
 // A test-owned, fail-fast port; no existing app server is reused or restarted.
 server.listen(22743, '127.0.0.1'); await once(server, 'listening');
 const url = 'http://127.0.0.1:22743';
 browser = await require('playwright').chromium.launch({ headless: true, chromiumSandbox: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
 for (const [width, height] of [[1440,1000], [390,844], [320,844]]) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const requests = [], errors = [];
  context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') || new URL(request.url()).origin !== url) requests.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => errors.push(error.message));
  try {
   await page.goto(url);
   const template = page.getByRole('combobox', { name: 'AI provider template', exact: true });
   const token = page.getByLabel('Provider token', { exact: true });
   await template.selectOption('anthropic');
   await token.fill('sk-ant-oat-synthetic-old-mode');
   await template.selectOption('anthropic-api-key');
   assert.equal(await token.inputValue(), '', 'selecting Console clears the previous mode credential');
   assert.match(await page.locator('label[for="vault-provider-token"]').innerText(), /Console API key/i);
   assert.match(await page.locator('#vault-provider-token-help').innerText(), /separate Console billing/);
   assert.equal(await token.getAttribute('aria-describedby'), 'vault-provider-token-help');
   await context.setOffline(true);
   const name = `Synthetic Console ${width}`;
   await page.getByLabel('Provider connection name', { exact: true }).fill(name);
   await token.fill('sk-ant-api03-synthetic-console-ui-fixture');
   await page.getByRole('button', { name: 'Save provider', exact: true }).click();
   await page.getByText(name, { exact: true }).waitFor();
   assert.equal(await token.inputValue(), '', 'successful save clears the credential input');
   const proof = await page.evaluate(() => window.consoleVaultFixture.proof());
   assert.equal(proof.entries.length, 1); assert.equal(proof.entries[0].provider, 'anthropic-api-key');
   assert.equal(proof.plaintextFound, false); assert.equal(proof.commands, 0); assert.equal(proof.tokenMatches, true);
   await context.setOffline(false); await page.reload(); await page.getByText(name, { exact: true }).waitFor();
   assert.deepEqual(await page.evaluate(() => window.consoleVaultFixture.proof()), proof, 'cold unlock retains the same encrypted Console entry');
   await template.selectOption('anthropic-api-key');
   await token.fill('sk-ant-oat-synthetic-rejected-setup-token');
   await page.getByRole('button', { name: 'Save provider', exact: true }).click();
   await page.getByRole('alert').filter({ hasText: /Console API key/ }).waitFor();
   assert.equal((await page.evaluate(() => window.consoleVaultFixture.proof())).entries.length, 1);
   const bounds = await page.evaluate(async () => {
    scrollTo(0,0); const top = scrollY;
    for (let y = 0; y < document.documentElement.scrollHeight; y += 350) { scrollTo(0,y); await new Promise(resolve => requestAnimationFrame(resolve)); }
    scrollTo(0,document.documentElement.scrollHeight); await new Promise(resolve => requestAnimationFrame(resolve));
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, top, bottom: scrollY, max: document.documentElement.scrollHeight-innerHeight };
   });
   assert.equal(bounds.width, bounds.scrollWidth); assert.equal(bounds.top, 0); assert.ok(Math.abs(bounds.bottom-bounds.max) <= 2);
   await page.screenshot({ path: join(evidence, `console-vault-${width}.png`), fullPage: true });
   assert.deepEqual(requests, []); assert.deepEqual(errors, []);
   results.push({ width, encryptedOfflineSave: true, coldUnlock: true, setupTokenRejected: true, modeChangeClearsToken: true, bounds, requests, errors });
  } finally { await context.close(); }
 }
 const capabilityCases = [];
 for (const version of ['1.4.0', '1.5.0']) {
  manifestVersion = version; remoteWrites = 0;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  try {
   await page.goto(url + '/?remote=1');
   await page.getByRole('combobox', { name: 'AI provider template', exact: true }).selectOption('anthropic-api-key');
   await page.getByLabel('Provider token', { exact: true }).fill('sk-ant-api03-synthetic-console-ui-fixture');
   await page.getByRole('button', { name: 'Save provider', exact: true }).click();
   if (version === '1.4.0') {
    await page.getByRole('alert').filter({ hasText: 'api.lopu-vault is incompatible' }).waitFor();
    assert.equal(remoteWrites, 0, 'older local-vault deployments receive no Console credential');
   } else {
    await page.waitForFunction(() => document.getElementById('vault-provider-token').value === '');
    assert.equal(remoteWrites, 1, 'compatible deployment receives one explicit Console save');
   }
   capabilityCases.push({ version, remoteWrites, refused: version === '1.4.0' });
  } finally { await context.close(); }
 }
 await writeFile(join(evidence, 'verification.json'), JSON.stringify({ synthetic: true, actualSecureVaultScope: true, actualEncryptedLocalProviderVault: true, providerAuthenticationTested: false, results, capabilityCases }, null, 2));
 console.log(JSON.stringify({ passed: results.length, evidence }));
} finally {
 await browser?.close();
 if (server?.listening) await new Promise(resolve => server.close(resolve));
 await rm(dir, { recursive: true, force: true });
}
