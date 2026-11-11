import { passwordHelperOptions } from './password-helper-identity.mjs';
// Opt-in native acceptance. Uses the actual app/renderer and signed delivery;
// remote bootstrap and GitHub publication are isolated synthetic fixtures.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, open, access, readdir } from 'node:fs/promises';
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
const workspace = retainedWorkspace(name), require = createRequire(import.meta.url);
const passwordHelper = passwordHelperOptions(process.argv);
const reusePrepared = process.argv.includes('--reuse-prepared');
if (passwordHelper && reusePrepared) throw Error('A signed helper requires a fresh canonical snapshot.');
const previousReceiptPath = process.argv.find(arg => arg.startsWith('--previous-receipt='))?.slice(19);
const puppeteer = require('puppeteer-core'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'thingtime-native-auto-'));
await mkdir(output, { recursive: true });
const log = await open(path.join(temporary, 'development.log'), 'w', 0o600);
let phase = 'preflight', failure, cleanupFailure, receipt, launcher, api, browser, page, originalPolicy, createdWorkspace = false;
const startedAt = new Date().toISOString(), observations = [];
const activationDiagnostics = [];
let hostActivationDiagnostics = [], hostLifecycleDiagnostics = [], hostHttpDiagnostics = [];
const { projectHttpActivity } = require('../lib/renderer-server.cjs');
const diagnosticTemplate = require('../lib/web-bundle-activation.cjs').projectBundleActivationEligibility({});
const { BUNDLE_LIFECYCLE_STAGES, BUNDLE_CHECKPOINT_REASONS, BUNDLE_CANCELLATION_REASONS } = require('../lib/web-bundle-activation.cjs');
function publicActivationDiagnostics(value) {
 if (!value || value.format !== 1 || typeof value.eligible !== 'boolean' || !Array.isArray(value.blockers)) throw Error('Unsupported native activation diagnostics');
 const gates = {}, counts = {}, idle = {};
 for (const name of Object.keys(diagnosticTemplate.gates)) {
  if (typeof value.gates?.[name] !== 'boolean') throw Error('Malformed native activation gates'); gates[name] = value.gates[name];
 }
 for (const name of Object.keys(diagnosticTemplate.counts)) {
  const count = value.counts?.[name];
  if (count !== null && (!Number.isSafeInteger(count) || count < 0)) throw Error('Malformed native activation counts'); counts[name] = count;
 }
 if (typeof value.idle?.reserved !== 'boolean') throw Error('Malformed native shutdown observation');
 idle.reserved = value.idle.reserved;
 for (const name of ['http','chatgpt','runtime','reservation']) {
  const status = value.idle?.[name];
  if (!['idle','busy','unavailable','error',...(name === 'reservation' ? ['absent'] : [])].includes(status)) throw Error('Malformed native shutdown observation'); idle[name] = status;
 }
 const blockers = Object.keys(gates).filter(name => !gates[name]);
 if (value.eligible !== (blockers.length === 0) || JSON.stringify(value.blockers) !== JSON.stringify(blockers)) throw Error('Inconsistent native activation projection');
 let checkpoint = null;
 if (value.checkpoint !== null) {
  if (!value.checkpoint || ![true,false,null].includes(value.checkpoint.ready) ||
   (value.checkpoint.reason !== null && !BUNDLE_CHECKPOINT_REASONS.includes(value.checkpoint.reason))) throw Error('Malformed native checkpoint observation');
  checkpoint = { ready: value.checkpoint.ready, reason: value.checkpoint.reason };
 }
 if (value.cancellation !== null && !BUNDLE_CANCELLATION_REASONS.includes(value.cancellation)) throw Error('Malformed native cancellation observation');
 return { format: 1, eligible: value.eligible, blockers, gates, counts, idle, checkpoint, cancellation: value.cancellation };
}
async function captureHostActivationLog() {
 const lines = (await readFile(path.join(temporary, 'development.log'), 'utf8')).split('\n');
 lines.pop(); // A concurrent writer may not have finished its last JSON line.
 const prefix = '[thingtime:bundle-activation] ';
 const records = [], lifecycle = [], http = [];
 for (const line of lines) if (line.startsWith('[thingtime:bundle-http] ')) {
  const value = JSON.parse(line.slice('[thingtime:bundle-http] '.length));
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0) throw Error('Malformed HTTP observation timestamp');
  http.push({ observedAt: value.observedAt, ...projectHttpActivity(value) });
 }
 for (const line of lines) if (line.startsWith('[thingtime:bundle-lifecycle] ')) {
  const value = JSON.parse(line.slice('[thingtime:bundle-lifecycle] '.length));
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || !BUNDLE_LIFECYCLE_STAGES.includes(value.stage) ||
   Object.keys(value).some(key => !['observedAt', 'stage'].includes(key))) throw Error('Malformed native lifecycle observation');
  lifecycle.push({ observedAt: value.observedAt, stage: value.stage });
 }
 for (const line of lines) if (line.startsWith(prefix)) {
  const value = JSON.parse(line.slice(prefix.length));
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0) throw Error('Malformed native observation timestamp');
  records.push({ observedAt: value.observedAt, ...publicActivationDiagnostics(value) });
 }
 hostActivationDiagnostics = records; hostLifecycleDiagnostics = lifecycle; hostHttpDiagnostics = http;
 await writeFile(path.join(output, 'host-http-diagnostics.json'), JSON.stringify(http, null, 2));
 await writeFile(path.join(output, 'host-lifecycle-diagnostics.json'), JSON.stringify(lifecycle, null, 2));
 await writeFile(path.join(output, 'host-activation-diagnostics.json'), JSON.stringify(records, null, 2));
}
const verifierSourceHashes = Object.fromEntries(await Promise.all(['scripts/verify-web-bundle-auto-activation.mjs', 'test/fixtures/native-web-auto-api.mts', 'test/fixtures/configure-native-auto-qa.cjs'].map(async file => [file, hash(await readFile(path.join(electronDir, file)))])));
const persistenceReaderFiles = ['remix/app/local-workspace/editorTree.ts', 'remix/app/local-workspace/storage.ts', 'remix/app/Providers/thingtimeSerialization.ts'];
const persistenceReaderSourceHashes = Object.fromEntries(await Promise.all(persistenceReaderFiles.map(async file => [file, hash(await readFile(path.join(repo, file)))])));
// Read through the same integrity-checked storage adapter as the actual renderer.
// No legacy adapter is supplied, so this task-only anonymous witness cannot
// migrate data or write a tree. It never inspects a personal profile/account.
const { buildSync } = require(require.resolve('esbuild', { paths: [path.join(repo, 'MCP')] }));
const persistenceReader = buildSync({ bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent', stdin: {
 resolveDir: repo, loader: 'ts', sourcefile: 'native-auto-persistence-reader.ts', contents: `
 import { LocalEditorTree, decodeEditorTree } from './remix/app/local-workspace/editorTree';
 import { WorkspaceDatabase } from './remix/app/local-workspace/storage';
 globalThis.__nativeAutoReadPersisted = async (origin, fixturePath, expected) => {
  const assertCurrent = () => {
   if (location.origin !== origin || globalThis.getThingtime?.(fixturePath) !== expected) throw Error('Task persistence witness identity/value changed');
  };
  assertCurrent();
  const db = new WorkspaceDatabase(indexedDB);
  const tree = new LocalEditorTree(db, { kind: 'anonymous' }, { assertCurrent, onInvalidate: () => () => {} });
  try {
   const raw = await tree.getItem(tree.key); assertCurrent();
   if (raw === null || decodeEditorTree(raw).value[fixturePath] !== expected) return null;
   return { storageKey: tree.key, integrityChecked: true, valueMatched: true };
  } finally { await db.close(); }
 };`
} }).outputFiles[0].text;
let preparedSourceHashes = {};
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
async function desktop(action) {
 const beforePid = await processId();
 const executable = command('/bin/ps', ['-p', String(beforePid), '-o', 'comm=']).trim();
 assert.equal(executable, path.join(workspace.runtime, 'Contents/MacOS/Electron'), 'Control only the verified task runtime');
 if (action === 'minimize') {
  const observed = JSON.parse(command('agent-desktop', ['list-windows', '--app', workspace.identity], 15000)); assert.equal(observed.ok, true);
 }
 const raw = spawnSync('agent-desktop', [action, '--app', workspace.identity], { env: developmentEnvironment(), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
 let result;
 try { result = JSON.parse(raw.stdout); } catch { throw Error(`Native ${action} returned no inspectable result: ${raw.error?.message || raw.stderr || 'unknown'}`); }
 observations.push({ case: 'native-control', action, beforePid, executable, result, repeated: false });
 await writeFile(path.join(output, 'native-control.json'), JSON.stringify(observations.filter(item => item.case === 'native-control'), null, 2));
 if (!result.ok && result.error?.code !== 'TIMEOUT') throw Error(`Native ${action} refused: ${JSON.stringify(result.error)}`);
 // A semantic action may have landed even when AX post-read times out. Do not
 // repeat it or fake focus: independently observe the actual owned page.
 const post = await until(async () => {
  assert.equal(await processId(), beforePid, 'Native process changed during window control');
  const state = await page.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }));
  const satisfied = action === 'minimize' ? !state.focused && state.visibility === 'hidden' : action === 'restore' ? state.visibility === 'visible' : state.focused;
  return satisfied ? state : null;
 }, 5000, `Native ${action} postcondition was not independently confirmed`);
 observations.at(-1).postcondition = post;
 await writeFile(path.join(output, 'native-control.json'), JSON.stringify(observations.filter(item => item.case === 'native-control'), null, 2));
 return post;
}
async function processId() { return JSON.parse(await readFile(path.join(workspace.root, 'launcher.json'), 'utf8')).childPid; }
async function connect() {
 if (!browser?.connected) browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${workspace.inspectorPort}`, defaultViewport: null });
 page = (await browser.pages()).find(candidate => candidate.url().startsWith('http://127.0.0.1:28640/'));
 if (!page) return null;
 return page.evaluate(() => window.thingtimeDesktop?.getInfo());
}
async function captureActivationState() {
 let timer;
 try {
  const state = await Promise.race([page.evaluate(async () => {
   const info = await window.thingtimeDesktop.getInfo();
   const candidates = [...document.querySelectorAll('[contenteditable="true"], .monaco-editor, .codex-editor, [role="dialog"], [aria-busy="true"], textarea, input')];
   const blockers = candidates.filter(element => {
    if (element.matches('[contenteditable="true"], .monaco-editor, .codex-editor, [role="dialog"], [aria-busy="true"]')) return true;
    return !['button','submit','reset','hidden','checkbox','radio'].includes(element.type) && Boolean(element.value);
   }).map(element => ({ tag: element.tagName, label: element.getAttribute('aria-label'), visible: Boolean(element.getClientRects().length), nonempty: Boolean(element.value) }));
   return { pathname: location.pathname, focused: document.hasFocus(), visibility: document.visibilityState,
    featureVersions: { 'native.web-bundle-activation': info.nativeFeatures?.features?.['native.web-bundle-activation']?.version },
    featureOriginMatches: info.nativeFeatures?.origin === location.origin,
    activation: info.webBundle?.activation,
    updateStatus: info.webBundle?.update?.status, updateReleaseId: info.webBundle?.update?.releaseId || null,
    activeReleaseId: info.webBundle?.releaseId || null, buildIdentityPresent: Boolean(info.buildIdentity?.gitCommit),
    localRuntimeActive: info.localRuntime?.active === true, localRuntimeEnabled: info.localRuntime?.enabled === true,
    rendererReady: typeof window.getThingtime === 'function' && Boolean(document.querySelector('#root')?.childElementCount),
    closedDrawerEmojiFields: document.querySelectorAll('input[aria-label="Emoji"]').length,
    blockers, receivedMessages: window.__nativeAutoQa || [] };
  }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Task public state observation timed out')), 4000); })]);
  const nativeVersion = /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(state.featureVersions['native.web-bundle-activation'] || '');
  if (!state.featureOriginMatches || !nativeVersion || Number(nativeVersion[1]) < 3) throw Error('Current origin requires native activation diagnostics 1.3.0');
  state.activation = publicActivationDiagnostics(state.activation);
  activationDiagnostics.push({ at: new Date().toISOString(), ...state });
  await writeFile(path.join(output, 'activation-diagnostics.json'), JSON.stringify(activationDiagnostics, null, 2));
  return state;
 } finally { clearTimeout(timer); await captureHostActivationLog(); }
}
async function verifyDrawerEditor() {
 for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  await page.setViewport(viewport);
  const opener = await page.$('button[aria-label="Open menu"]'); if (opener) await opener.click();
  const add = await until(async () => {
   for (const button of await page.$$('button')) if (await button.evaluate(element => Boolean(element.getClientRects().length) && element.textContent.trim().endsWith('Add +'))) return button;
  }, 5000, 'Visible Add drawer item action missing');
  await add.click();
  await page.waitForSelector('input[aria-label="Emoji"]', { visible: true });
  const title = await page.$('dialog input[aria-label="Title"]'); assert.ok(title, 'Normal drawer editor Title field exists');
  await title.type('Synthetic cancelled drawer draft');
  assert.equal(await title.evaluate(element => element.value), 'Synthetic cancelled drawer draft');
  await page.screenshot({ path: path.join(output, `drawer-editor-${viewport.width}.png`) });
  const dialog = await page.$('dialog[aria-label="Custom drawer item"]'); assert.ok(dialog);
  let cancel;
  for (const button of await dialog.$$('button')) if (await button.evaluate(element => element.textContent.trim() === 'Cancel')) cancel = button;
  assert.ok(cancel, 'Normal Cancel drawer item action exists'); await cancel.click();
  await page.waitForFunction(() => document.querySelectorAll('input[aria-label="Emoji"]').length === 0);
  await page.screenshot({ path: path.join(output, `drawer-cancelled-${viewport.width}.png`) });
  observations.push({ case: 'drawer-editor-lifecycle', ...viewport, opened: true, titleInputUsable: true, cancelled: true, closedFieldsUnmounted: true, saved: false });
  const closer = await page.$('button[aria-label="Close menu"]'); if (closer) await closer.click();
 }
}
try {
 const { assertFreePort } = require('../lib/local-runtime.cjs');
 for (const port of [28640, workspace.apiPort, workspace.databasePort, workspace.inspectorPort]) await assertFreePort(port);
 if (reusePrepared) {
  enter('verify-owned-prepared-snapshot');
  assert.ok(previousReceiptPath, 'Reuse requires the previous task receipt');
  const prior = JSON.parse(await readFile(path.resolve(previousReceiptPath), 'utf8'));
  assert.equal(prior.cleanupVerified, true); assert.equal(prior.passed, false);
  const delivered = prior.observations?.find(item => item.case === 'signed-live-delivery'); assert.ok(delivered?.releaseId);
  const prepared = JSON.parse(await readFile(path.join(workspace.root, 'development.json'), 'utf8'));
  assert.equal(prepared.source, electronDir); assert.equal(prepared.bundleIdentifier, workspace.identity);
  await assert.rejects(access(path.join(workspace.root, 'launcher.json')), { code: 'ENOENT' });
  const files = ['main.cjs','preload.cjs','lib/web-bundle-activation.cjs','lib/web-bundle-download.cjs','lib/web-bundle-updates.cjs','lib/renderer-server.cjs'];
  for (const file of files) {
   const expected = spawnSync('git', ['-C', repo, 'show', `b5b70e0c8:electron/${file}`], { maxBuffer: 8 * 1024 * 1024 });
   assert.equal(expected.status, 0); const actual = await readFile(path.join(workspace.source, file)); assert.deepEqual(actual, expected.stdout);
   preparedSourceHashes[file] = hash(actual);
  }
  const releaseClaim = await claimWorkspace(workspace); createdWorkspace = true;
  try {
   const metadata = JSON.parse(await readFile(path.join(workspace.source, 'dist/web/metadata.json'), 'utf8'));
   const cache = path.join(workspace.profile, 'native-web-bundles', metadata.nativeBundle.runtime.nativeAbi, 'qa');
   const state = JSON.parse(await readFile(path.join(cache, 'state.json'), 'utf8'));
   assert.equal(state.active, null); assert.equal(state.previous, null); assert.equal(state.pending.releaseId, delivered.releaseId);
   await rm(cache, { recursive: true });
   const downloads = path.join(workspace.profile, 'native-web-downloads');
   try { assert.ok((await readdir(downloads)).every(id => id === delivered.releaseId)); await rm(downloads, { recursive: true }); }
   catch (error) { if (error.code !== 'ENOENT') throw error; }
  } finally { await releaseClaim(); }
 } else {
  await assert.rejects(access(workspace.root), { code: 'ENOENT' }); await assert.rejects(access(workspace.app), { code: 'ENOENT' });
  enter('prepare-isolated-snapshot');
  const releaseClaim = await claimWorkspace(workspace); createdWorkspace = true;
  try { await prepareWorkspace(workspace, electronDir, require('electron'), { passwordHelper }); } finally { await releaseClaim(); }
 }
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
 const diagnosticVersion = /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(initial.nativeFeatures?.features?.['native.web-bundle-activation']?.version || '');
 assert.equal(initial.nativeFeatures?.origin, initial.origin);
 assert.ok(diagnosticVersion && Number(diagnosticVersion[1]) >= 3, 'Negotiate native diagnostics 1.3.0 before depending on them');
 publicActivationDiagnostics(initial.webBundle?.activation);
 await page.evaluateOnNewDocument(() => {
  window.__nativeAutoQa = [];
  window.thingtimeDesktop?.onBundleActivation?.(message => window.__nativeAutoQa.push({ type: message.type, at: Date.now(), keepVeto: message.keepVeto === true }));
 });
 const baselinePid = await processId(), origin = initial.origin, fixturePath = 'nativeAutoActivationFixture', value = 'Synthetic draft survives automatic native bundle activation';
 await page.goto(`${origin}/edit/${fixturePath}`, { waitUntil: 'domcontentloaded' });
 // MagicInput initially reconciles its placeholder in a passive mount effect.
 // Existing DOM alone does not certify that its first render has settled.
 await page.waitForFunction(() => [...document.querySelectorAll('[contenteditable="true"]')].some(element => !element.closest('.thingPathDom-raw') && element.textContent === ''));
 const candidates = await page.$$('[contenteditable="true"]'); let editable;
 for (const candidate of candidates) if (!await candidate.evaluate(element => Boolean(element.closest('.thingPathDom-raw')))) {
  assert.equal(editable, undefined, 'Choose the unique value editor, never its property label'); editable = candidate;
 }
 assert.ok(editable); await editable.focus();
 // Focus activates Commander through queued canonical state. Wait for that
 // render and the same live editor before sending the single typing action.
 await page.waitForFunction(element => {
  const owner = element.closest('[class*="commander-uuid-"]');
  const token = [...(owner?.classList || [])].find(name => name.startsWith('commander-uuid-'));
  const id = token?.slice('commander-uuid-'.length);
  return element.isConnected && document.activeElement === element && element.textContent === '' && id &&
   window.getThingtime?.(['settings','commander',id,'commanderActive']) === true;
 }, {}, editable);
 observations.push({ case: 'editor-input-ready', initialReconciliationSettled: true, commanderFocusCommitted: true, sameConnectedEditor: true, typedOnce: true });
 await editable.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
 await page.keyboard.type(value);
 await page.waitForFunction(expected => [...document.querySelectorAll('[contenteditable="true"]')].some(element => !element.closest('.thingPathDom-raw') && element.textContent === expected), {}, value);
 await page.evaluate(() => { window.__nativeAutoQa ||= []; });
 await page.screenshot({ path: path.join(output, 'dirty-editor.png') });
 enter('publish-after-baseline-and-real-download'); await message(api, { type: 'publish' }, 'published');
 const staged = await until(async () => {
  const info = await page.evaluate(() => window.thingtimeDesktop.getInfo());
  if (info.webBundle.update?.status === 'unavailable') throw Object.assign(Error(info.webBundle.update.error), { fatal: true });
  return info.webBundle.update?.status === 'pending' && info.webBundle.update.releaseId === publication.releaseId ? info : null;
 }, 180000, 'The real native downloader did not stage its signed publication');
 assert.equal(await processId(), baselinePid); assert.equal(staged.webBundle.source, 'bundled');
 observations.push({ case: 'signed-live-delivery', processUnchanged: true, releaseId: publication.releaseId, pending: true });
 await desktop('minimize'); await until(() => page.evaluate(() => !document.hasFocus()), 5000, 'Task app did not lose focus');
 enter('dirty-input-remains-pending');
 const dirtyStart = Date.now();
 while (Date.now() - dirtyStart < 70000) {
  assert.equal(await processId(), baselinePid, 'Dirty editor must retain the original process');
  const info = await page.evaluate(() => window.thingtimeDesktop.getInfo());
  assert.equal(info.webBundle.update.status, 'pending'); assert.equal(info.webBundle.releaseId, null);
  assert.ok(await page.evaluate(expected => document.body.innerText.includes(expected), value), 'Dirty input remains present'); await wait(1000);
 }
 observations.push({ case: 'dirty-background', durationMs: Date.now() - dirtyStart, processUnchanged: true, pending: true,
  checkpointRequests: await page.evaluate(() => window.__nativeAutoQa.filter(event => event.type === 'prepare').length) });
 await desktop('restore'); await desktop('focus-window');
 enter('durable-save-and-readback');
 // An undefined Thing uses Commander: Tab/blur leaves its creation command
 // unsubmitted. Normal Enter commits it through the canonical editor action.
 const commandInput = await page.$$('[contenteditable="true"]');
 const valueInputs = [];
 for (const candidate of commandInput) if (!await candidate.evaluate(element => Boolean(element.closest('.thingPathDom-raw')))) valueInputs.push(candidate);
 assert.equal(valueInputs.length, 1, 'Submit only the unique task value editor');
 await valueInputs[0].focus(); await page.keyboard.press('Enter');
 await page.waitForFunction((fixturePath, expected) => window.getThingtime?.(fixturePath) === expected, {}, fixturePath, value);
 await page.keyboard.press('Tab');
 await page.evaluate(persistenceReader);
 const persisted = await until(async () => {
  try { return await page.evaluate((origin, fixturePath, expected) => window.__nativeAutoReadPersisted(origin, fixturePath, expected), origin, fixturePath, value); }
  catch (error) { throw Object.assign(error, { fatal: true }); }
 }, 30000, 'Canonical editor storage did not acknowledge the submitted value');
 await page.evaluate(() => { delete window.__nativeAutoReadPersisted; });
 observations.push({ case: 'submitted-and-persisted', normalEnter: true, canonicalValueMatched: true, ...persisted });
 await page.goto(`${origin}/${fixturePath}`, { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(expected => document.body.innerText.includes(expected), {}, value);
 assert.equal(await processId(), baselinePid, 'Readback is not a manual process restart');
 await page.screenshot({ path: path.join(output, 'durable-reload.png') });
 await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
 await page.waitForFunction(() => typeof window.getThingtime === 'function');
 const home = await captureActivationState();
 assert.equal(home.closedDrawerEmojiFields, 0, 'Closed default drawer editor inputs must be unmounted on Home');
 observations.push({ case: 'closed-drawer-home', defaultEmojiFieldsUnmounted: true, blockerCount: home.blockers.length });
 await desktop('minimize'); await until(() => page.evaluate(() => !document.hasFocus()), 5000, 'Task app did not become quiescent');
 enter('automatic-idle-process-replacement');
 const automaticStart = Date.now();
 let lastDiagnostic = 0;
 await until(async () => {
  const pid = await processId(); if (pid && pid !== baselinePid) return true;
  if (Date.now() - lastDiagnostic >= 5000) { lastDiagnostic = Date.now(); await captureActivationState().catch(error => { activationDiagnostics.push({ at: new Date().toISOString(), observationUnavailable: error.message }); }); }
  return false;
 }, 150000, 'Idle native process did not automatically replace itself');
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
 enter('drawer-editor-desktop-and-mobile'); await verifyDrawerEditor();
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
  await captureActivationState().catch(() => {});
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
 await captureHostActivationLog().catch(error => { cleanupFailure ||= error; });
 await log.close();
}
const result = { ...receipt, passed: Boolean(receipt && !failure && !cleanupFailure), startedAt, finishedAt: new Date().toISOString(), phase,
 cleanupVerified: !cleanupFailure, verifierSourceHashes, persistenceReaderSourceHashes, preparedSourceHashes, observations, activationDiagnostics, hostActivationDiagnostics, hostLifecycleDiagnostics, hostHttpDiagnostics, failure: failure ? { name: failure.name, message: failure.message } : undefined,
 cleanupFailure: cleanupFailure ? { name: cleanupFailure.name, message: cleanupFailure.message } : undefined,
 ...(failure || cleanupFailure ? { retainedDiagnostics: temporary } : {}) };
await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
if (result.passed) { await rm(temporary, { recursive: true, force: true }); console.log(JSON.stringify({ passed: true, output })); }
else { console.error(`Native automatic update QA failed in ${phase}; diagnostics ${temporary}`); throw failure || cleanupFailure || Error('Missing receipt'); }
