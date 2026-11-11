// Opt-in native acceptance. Uses the actual app/renderer and signed delivery;
// remote bootstrap and GitHub publication are isolated synthetic fixtures.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, open, access } from 'node:fs/promises';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { claimWorkspace, developmentEnvironment, prepareWorkspace, retainedWorkspace, stopWorkspace } from './dev-workspace.mjs';
import { packageRelease } from '../../native-bundles/package-release.mjs';
if (process.env.THINGTIME_NATIVE_BUNDLE_QA !== '1') throw Error('Set THINGTIME_NATIVE_BUNDLE_QA=1');
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), repo = path.dirname(electronDir);
const name = process.argv.find(arg => arg.startsWith('--workspace='))?.slice(12);
const output = path.resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || '');
if (!name?.startsWith('native-bundle-qa-auto-') || !process.argv.some(arg => arg.startsWith('--output='))) throw Error('Require a dedicated native-bundle-qa-auto-* workspace and --output');
const workspace = retainedWorkspace(name), appName = `Thingtime Dev ${name}`, require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'thingtime-native-auto-'));
await mkdir(output, { recursive: true });
const log = await open(path.join(temporary, 'development.log'), 'w', 0o600);
let phase = 'preflight', failure, cleanupFailure, receipt, launcher, api, browser, page, originalPolicy, createdWorkspace = false;
const startedAt = new Date().toISOString(), observations = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const enter = value => { phase = value; console.log(`Native auto QA: ${value}`); };
async function until(check, ms, label) {
 const deadline = Date.now() + ms; let last;
 while (Date.now() < deadline) { try { const result = await check(); if (result) return result; } catch (error) { if (error.fatal) throw error; last = error; } await wait(250); }
 throw Error(`${label}${last ? ': ' + last.message.slice(0, 150) : ''}`);
}
function message(child, value, type, timeout = 30000) {
 return new Promise((resolve, reject) => {
  const timer = setTimeout(() => { cleanup(); reject(Error(`Fixture ${type} timed out`)); }, timeout);
  const receive = result => { if (result?.type === type) { cleanup(); resolve(result); } };
  const cleanup = () => { clearTimeout(timer); child.off('message', receive); };
  child.on('message', receive); if (value) child.send(value);
 });
}
function command(executable, args, timeout = 30000) {
 const result = spawnSync(executable, args, { env: developmentEnvironment(), encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
 if (result.status !== 0 || result.error) throw Error(`${path.basename(executable)} failed: ${(result.stderr || result.stdout || result.error?.message || '').slice(0, 400)}`);
 return result.stdout;
}
function desktop(action) {
 const observed = JSON.parse(command('agent-desktop', ['list-windows', '--app', workspace.identity], 15000)); assert.equal(observed.ok, true);
 const result = JSON.parse(command('agent-desktop', [action, '--app', workspace.identity], 15000));
 assert.equal(result.ok, true, JSON.stringify(result.error)); return result.data;
}
async function processId() { return JSON.parse(await readFile(path.join(workspace.root, 'launcher.json'), 'utf8')).childPid; }
async function connect() {
 if (!browser?.connected) browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${workspace.inspectorPort}`, defaultViewport: null });
 page = (await browser.pages()).find(candidate => candidate.url().startsWith('http://127.0.0.1:28640/'));
 if (!page) return null;
 return page.evaluate(() => window.thingtimeDesktop?.getInfo());
}
try {
 await assert.rejects(access(workspace.root), { code: 'ENOENT' });
 await assert.rejects(access(workspace.app), { code: 'ENOENT' });
 const { assertFreePort } = require('../lib/local-runtime.cjs');
 for (const port of [28640, workspace.apiPort, workspace.databasePort, workspace.inspectorPort]) await assertFreePort(port);
 enter('prepare-isolated-snapshot');
 const releaseClaim = await claimWorkspace(workspace); createdWorkspace = true;
 try { await prepareWorkspace(workspace, electronDir, require('electron')); } finally { await releaseClaim(); }
 const web = path.join(workspace.source, 'dist/web'), metadata = JSON.parse(await readFile(path.join(web, 'metadata.json'), 'utf8'));
 const built = metadata.nativeBundle;
 const { publicKey, privateKey } = generateKeyPairSync('ed25519');
 const policy = { format: 1, channel: 'qa', minimumSequence: 0, trustedKeys: [{ keyId: 'synthetic-native-auto', publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }), channels: ['qa'], platforms: [built.target.platform], runtimes: [built.runtime.id] }] };
 originalPolicy = await readFile(path.join(workspace.source, 'native-web-policy.json'));
 await writeFile(path.join(workspace.source, 'native-web-policy.json'), JSON.stringify(policy));
 enter('package-signed-synthetic-update');
 const payload = path.join(temporary, 'payload'); await cp(web, payload, { recursive: true });
 await writeFile(path.join(payload, 'metadata.json'), JSON.stringify({ ...metadata, gitCommit: 'a'.repeat(40) }));
 const publication = await packageRelease({ source: payload, output: path.join(temporary, 'published'), keyId: 'synthetic-native-auto',
  privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }), trustedKeys: policy.trustedKeys,
  metadata: { version: built.runtime.shellVersion, channel: 'qa', sequence: 1, target: built.target, entrypoints: built.entrypoints,
   runtime: { id: built.runtime.id, nativeAbi: built.runtime.nativeAbi, minShellVersion: built.runtime.shellVersion, maxShellVersion: built.runtime.shellVersion } } });
 const config = path.join(temporary, 'api-public-config.json'); await writeFile(config, JSON.stringify({ directory: publication.directory, assets: publication.assets, policy }));
 api = spawn(process.execPath, ['--import', require.resolve('tsx', { paths: [path.join(repo, 'remix')] }), path.join(electronDir, 'test/fixtures/native-web-auto-api.mts'), config],
  { cwd: path.join(repo, 'remix'), env: developmentEnvironment(), stdio: ['ignore', 'ignore', log.fd, 'ipc'] });
 const { origin: apiOrigin } = await message(api, null, 'ready');
 const bootstrapConfig = path.join(temporary, 'bootstrap.json'), bootstrapReceipt = path.join(temporary, 'bootstrap-receipt.json');
 await writeFile(bootstrapConfig, JSON.stringify({ ...workspace, origin: apiOrigin, receipt: bootstrapReceipt }));
 command(path.join(workspace.runtime, 'Contents/MacOS/Electron'), [path.join(electronDir, 'test/fixtures/configure-native-auto-qa.cjs'), bootstrapConfig]);
 const configured = JSON.parse(await readFile(bootstrapReceipt, 'utf8')); assert.equal(configured.enabled, false); assert.equal(configured.origin, apiOrigin + '/');
 enter('baseline-startup');
 launcher = spawn(process.execPath, [path.join(electronDir, 'scripts/dev-parallel.mjs'), `--workspace=${name}`, '--use-staged'], { env: developmentEnvironment(), stdio: ['ignore', 'ignore', log.fd] });
 const initial = await until(async () => {
  const info = await connect();
  if (!info || !await page.evaluate(() => typeof window.setThingtime === 'function' && document.querySelector('#root')?.childElementCount > 0)) return;
  return info;
 }, 120000, 'Real baseline renderer did not initialize');
 assert.equal(initial.webBundle.source, 'bundled'); assert.equal(initial.localRuntime.active, false); assert.equal(initial.localRuntime.enabled, false);
 assert.equal(new URL(initial.apiOrigin).origin, apiOrigin);
 const baselinePid = await processId(), origin = initial.origin, fixturePath = 'nativeAutoActivationFixture', value = 'Synthetic draft survives automatic native bundle activation';
 await page.goto(`${origin}/edit/${fixturePath}`, { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(() => [...document.querySelectorAll('[contenteditable="true"]')].some(element => !element.closest('.thingPathDom-raw')));
 const candidates = await page.$$('[contenteditable="true"]'); let editable;
 for (const candidate of candidates) if (!await candidate.evaluate(element => Boolean(element.closest('.thingPathDom-raw')))) {
  assert.equal(editable, undefined, 'Choose the unique value editor, never its property label'); editable = candidate;
 }
 assert.ok(editable); await editable.focus();
 await editable.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
 await page.keyboard.type(value);
 await page.waitForFunction(expected => [...document.querySelectorAll('[contenteditable="true"]')].some(element => !element.closest('.thingPathDom-raw') && element.textContent === expected), {}, value);
 await page.evaluate(() => { window.__nativeAutoQa = []; window.thingtimeDesktop.onBundleActivation(message => window.__nativeAutoQa.push({ type: message.type, at: Date.now() })); });
 await page.screenshot({ path: path.join(output, 'dirty-editor.png') });
 enter('publish-after-baseline-and-real-download'); await message(api, { type: 'publish' }, 'published');
 const staged = await until(async () => {
  const info = await page.evaluate(() => window.thingtimeDesktop.getInfo());
  if (info.webBundle.update?.status === 'unavailable') throw Object.assign(Error(info.webBundle.update.error), { fatal: true });
  return info.webBundle.update?.status === 'pending' && info.webBundle.update.releaseId === publication.releaseId ? info : null;
 }, 180000, 'The real native downloader did not stage its signed publication');
 assert.equal(await processId(), baselinePid); assert.equal(staged.webBundle.source, 'bundled');
 observations.push({ case: 'signed-live-delivery', processUnchanged: true, releaseId: publication.releaseId, pending: true });
 desktop('minimize'); await until(() => page.evaluate(() => !document.hasFocus()), 5000, 'Task app did not lose focus');
 enter('dirty-input-remains-pending');
 const dirtyStart = Date.now();
 while (Date.now() - dirtyStart < 70000) {
  assert.equal(await processId(), baselinePid, 'Dirty editor must retain the original process');
  const info = await page.evaluate(() => window.thingtimeDesktop.getInfo());
  assert.equal(info.webBundle.update.status, 'pending'); assert.equal(info.webBundle.releaseId, null); await wait(1000);
 }
 observations.push({ case: 'dirty-background', durationMs: Date.now() - dirtyStart, processUnchanged: true, pending: true,
  checkpointRequests: await page.evaluate(() => window.__nativeAutoQa.filter(event => event.type === 'prepare').length) });
 desktop('restore'); desktop('focus-window'); await editable.press('Tab');
 enter('durable-save-and-readback');
 await page.goto(`${origin}/${fixturePath}`, { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(expected => document.body.innerText.includes(expected), {}, value);
 assert.equal(await processId(), baselinePid, 'Readback is not a manual process restart');
 await page.screenshot({ path: path.join(output, 'durable-reload.png') });
 await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(() => typeof window.getThingtime === 'function');
 desktop('minimize'); await until(() => page.evaluate(() => !document.hasFocus()), 5000, 'Task app did not become quiescent');
 enter('automatic-idle-process-replacement');
 const automaticStart = Date.now();
 await until(async () => { const pid = await processId(); return pid && pid !== baselinePid; }, 150000, 'Idle native process did not automatically replace itself');
 await browser?.disconnect().catch(() => {}); browser = null;
 const updated = await until(async () => {
  const info = await connect(); if (!info) return;
  return info.webBundle.releaseId === publication.releaseId && info.buildIdentity.gitCommit === 'a'.repeat(40) ? info : null;
 }, 120000, 'Updated native renderer did not initialize');
 const cacheDirectory = path.join(workspace.profile, 'native-web-bundles', built.runtime.nativeAbi, 'qa');
 const state = await until(async () => {
  const current = JSON.parse(await readFile(path.join(cacheDirectory, 'state.json'), 'utf8'));
  return current.active === publication.releaseId && !current.pending ? current : null;
 }, 60000, 'Automatic trial did not durably confirm');
 assert.equal(updated.origin, origin); assert.equal(updated.localRuntime.active, false); assert.equal(new URL(updated.apiOrigin).origin, apiOrigin);
 await page.goto(`${origin}/${fixturePath}`, { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(expected => document.body.innerText.includes(expected), {}, value);
 await page.screenshot({ path: path.join(output, 'automatically-confirmed.png') });
 const stats = await message(api, { type: 'stats' }, 'stats');
 assert.deepEqual(stats.failures, []); assert.ok(stats.contentRequests > 0); assert.ok(stats.requests.every(request => !request.cookie && !request.authorization));
 assert.ok(stats.upstream.every(host => ['api.github.com', 'github.com', 'release-assets.githubusercontent.com'].includes(host)));
 receipt = { passed: true, sourceRevision: command('git', ['-C', repo, 'rev-parse', 'HEAD']).trim(), baselinePid, replacementPid: await processId(),
  installedDevelopmentApp: workspace.app, profile: workspace.profile, stableOrigin: origin, selectedSyntheticApi: apiOrigin,
  releaseId: publication.releaseId, activeReleaseId: state.active, pendingCleared: true, durableDataReadback: true,
  manualRestartCalled: false, automaticCheck: true, automaticActivation: true, idleReplacementMs: Date.now() - automaticStart,
  syntheticSigner: true, realRenderer: true, canonicalReleaseServiceAndHandlers: true, productionProviderOrPublication: false,
  localAccountApiActivationSupported: false, observations, delivery: { fileRequests: stats.contentRequests, bytes: stats.contentBytes, credentialFree: true },
  implementation: Object.fromEntries(await Promise.all(['main.cjs','preload.cjs','lib/web-bundle-activation.cjs','lib/web-bundle-updates.cjs','lib/renderer-server.cjs'].map(async file => [file, hash(await readFile(path.join(workspace.source, file)))]))),
  rendererMetadataSha256: hash(await readFile(path.join(web, 'metadata.json'))) };
 enter('cleanup');
} catch (error) {
 failure = error;
 if (page && !page.isClosed()) {
  await page.screenshot({ path: path.join(output, 'failure-renderer.png') }).catch(() => {});
  const diagnostic = await page.evaluate(() => ({ pathname: location.pathname,
   fields: [...document.querySelectorAll('[contenteditable],textarea,input')].map(element => ({ tag: element.tagName,
    editable: element.getAttribute('contenteditable'), label: element.getAttribute('aria-label'),
    visible: Boolean(element.getClientRects().length), text: element.textContent?.slice(0, 160),
    value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value.slice(0, 160) : undefined })) })).catch(() => null);
  await writeFile(path.join(output, 'failure-renderer.json'), JSON.stringify(diagnostic, null, 2));
 }
}
finally {
 try {
  await browser?.disconnect().catch(() => {});
  if (launcher) {
   const owner = JSON.parse(await readFile(path.join(workspace.root, 'launcher.json'), 'utf8')).pid;
   assert.equal(owner, launcher.pid, 'Preserve another launcher owner'); await stopWorkspace(workspace);
   await until(() => launcher.exitCode !== null || launcher.signalCode, 20000, 'Task launcher did not finish cleanup');
  }
  if (api?.connected) await message(api, { type: 'stop' }, 'stopped');
  if (originalPolicy) await writeFile(path.join(workspace.source, 'native-web-policy.json'), originalPolicy);
  if (receipt && createdWorkspace) { await rm(workspace.app, { recursive: true }); await rm(workspace.root, { recursive: true }); }
 } catch (error) { cleanupFailure = error; }
 await log.close();
}
const result = { ...receipt, passed: Boolean(receipt && !failure && !cleanupFailure), startedAt, finishedAt: new Date().toISOString(), phase,
 cleanupVerified: !cleanupFailure, observations, failure: failure ? { name: failure.name, message: failure.message } : undefined,
 cleanupFailure: cleanupFailure ? { name: cleanupFailure.name, message: cleanupFailure.message } : undefined,
 ...(failure || cleanupFailure ? { retainedDiagnostics: temporary } : {}) };
await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
if (result.passed) { await rm(temporary, { recursive: true, force: true }); console.log(JSON.stringify({ passed: true, output })); }
else { console.error(`Native automatic update QA failed in ${phase}; diagnostics ${temporary}`); throw failure || cleanupFailure || Error('Missing receipt'); }
