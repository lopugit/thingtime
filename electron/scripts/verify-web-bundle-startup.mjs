// Explicit opt-in acceptance against a dedicated prepared development app.
// Synthetic public trust is confined to that snapshot; private key stays in RAM.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { claimWorkspace, developmentEnvironment, retainedWorkspace, stopWorkspace } from './dev-workspace.mjs';
import { packageRelease } from '../../native-bundles/package-release.mjs';
import { createWebBundleStore } from '../lib/web-bundle-store.cjs';

if (process.env.THINGTIME_NATIVE_BUNDLE_QA !== '1') throw new Error('Set THINGTIME_NATIVE_BUNDLE_QA=1 for the isolated acceptance fixture.');
const name = process.argv.find(arg => arg.startsWith('--workspace='))?.slice(12);
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
const chromiumExecutable = process.argv.find(arg => arg.startsWith('--chromium='))?.slice(11) || process.env.CHROMIUM_EXECUTABLE;
if (!chromiumExecutable || !path.isAbsolute(chromiumExecutable)) throw new Error('Supply --chromium=<absolute isolated-test browser executable>.');
if (!name?.startsWith('native-bundle-qa-') || !output) throw new Error('Require a dedicated native-bundle-qa-* workspace and output directory.');
const workspace = retainedWorkspace(name);
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const { build } = createRequire(path.join(electronDir, '../MCP/package.json'))('esbuild');
const source = path.join(workspace.source, 'dist/web');
const preparation = JSON.parse(await readFile(path.join(workspace.root, 'development.json'), 'utf8'));
assert.equal(preparation.source, electronDir); assert.equal(preparation.bundleIdentifier, workspace.identity);
const checkedFiles = ['main.cjs', 'preload.cjs', 'lib/web-bundle-store.cjs', 'lib/web-bundle-launch.cjs',
  'lib/web-bundle-download.cjs', 'lib/web-bundle-updates.cjs', 'lib/web-bundle-activation.cjs', 'lib/renderer-server.cjs',
  '../native-bundles/host.cjs', '../native-bundles/release.cjs', '../native-bundles/inventory.cjs'];
const implementation = {};
for (const file of checkedFiles) {
  const current = await readFile(path.join(electronDir, file));
  assert.deepEqual(await readFile(path.join(workspace.source, file)), current, `Reprepare changed development source: ${file}`);
  implementation[file] = createHash('sha256').update(current).digest('hex');
}
const built = JSON.parse(await readFile(path.join(source, 'metadata.json'), 'utf8')).nativeBundle;
const host = { platform: built.target.platform, arch: built.target.arch, runtimeId: built.runtime.id,
  nativeAbi: built.runtime.nativeAbi, shellVersion: built.runtime.shellVersion, channel: 'qa', minimumSequence: 0 };
const cacheDirectory = path.join(workspace.profile, 'native-web-bundles', host.nativeAbi, host.channel);
try { await readFile(path.join(cacheDirectory, 'state.json')); throw new Error('Refuse an existing bundle test cache.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const policyFile = path.join(workspace.source, 'native-web-policy.json');
const originalPolicy = await readFile(policyFile);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const signer = privateKey.export({ format: 'pem', type: 'pkcs8' });
const keyId = 'disposable-startup-verification';
const trustedKeys = [{ keyId, publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
  channels: ['qa'], platforms: [host.platform], runtimes: [host.runtimeId] }];
const temporary = await mkdtemp(path.join(os.tmpdir(), 'thingtime-native-startup-'));
await mkdir(output, { recursive: true });
const log = await open(path.join(temporary, 'development.log'), 'w', 0o600);
let launcher, browser, policyChanged = false, cacheCreated = false, receipt, failure, cleanupFailure;
let phase = 'renderer-boundary', rendererBoundaryVersion;
const rendererBoundaryCases = [];
const startedAt = new Date().toISOString();
const ownedIds = new Set();
const testPolicy = JSON.stringify({ format: 1, channel: 'qa', minimumSequence: 0, trustedKeys });
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function ownsLauncher() {
  if (!launcher) return false;
  try { return JSON.parse(await readFile(path.join(workspace.root, 'launcher.json'), 'utf8')).pid === launcher.pid; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function stage(sequence, broken) {
  const releaseClaim = await claimWorkspace(workspace);
  try {
    const payload = path.join(temporary, `payload-${sequence}`);
    await cp(source, payload, { recursive: true });
    const metadata = JSON.parse(await readFile(path.join(payload, 'metadata.json'), 'utf8'));
    metadata.gitCommit = String(sequence).repeat(40);
    await writeFile(path.join(payload, 'metadata.json'), JSON.stringify(metadata));
    if (broken) await writeFile(path.join(payload, built.entrypoints.server), "throw new Error('Synthetic bundle startup failure');\n");
    const result = await packageRelease({ source: payload, output: path.join(temporary, 'published'), keyId, privateKey: signer, trustedKeys,
      metadata: { version: host.shellVersion, channel: 'qa', sequence, target: built.target, entrypoints: built.entrypoints,
        runtime: { id: host.runtimeId, nativeAbi: host.nativeAbi, minShellVersion: host.shellVersion, maxShellVersion: host.shellVersion } } });
    const envelope = JSON.parse(await readFile(path.join(result.directory, 'release.json'), 'utf8'));
    ownedIds.add(envelope.releaseId);
    const store = await createWebBundleStore({ cacheDirectory, bundledDirectory: source, trustedKeys, host });
    cacheCreated = true;
    await store.stage(path.join(result.directory, 'payload'), envelope);
    return result.releaseId;
  } finally { await releaseClaim(); }
}
async function start(expectedId, expectedSource) {
  launcher = spawn(process.execPath, [path.join(electronDir, 'scripts/dev-parallel.mjs'), `--workspace=${name}`, '--use-staged'],
    { env: developmentEnvironment(), stdio: ['ignore', 'ignore', log.fd] });
  const deadline = Date.now() + 120000;
  let page, info, settled = false;
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null || launcher.signalCode) throw new Error('Development launcher exited before startup acceptance.');
    if (!await ownsLauncher()) { await wait(100); continue; }
    try {
      if (!browser?.connected) browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${workspace.inspectorPort}`, defaultViewport: null });
      page = (await browser.pages()).find(page => new URL(page.url()).origin === `http://127.0.0.1:${workspace.apiPort}`);
      if (page) {
        info = await page.evaluate(() => window.thingtimeDesktop?.getInfo());
        const state = JSON.parse(await readFile(path.join(cacheDirectory, 'state.json'), 'utf8'));
        if (info?.webBundle?.releaseId === expectedId && info.webBundle.source === expectedSource && state.active === expectedId && !state.pending &&
            await page.evaluate(() => document.querySelector('#root')?.childElementCount > 0)) { settled = true; break; }
      }
    } catch { await browser?.disconnect().catch(() => {}); browser = null; }
    await wait(250);
  }
  assert.ok(settled && page && info?.webBundle?.releaseId === expectedId && info.webBundle.source === expectedSource, 'Real native startup did not settle');
  assert.equal(info.origin, `http://127.0.0.1:${workspace.apiPort}`);
  assert.equal(info.localRuntime?.active, true);
  assert.equal(info.localRuntime?.databaseMode, 'managed');
  return { page, info };
}
async function stop() {
  await browser?.disconnect(); browser = null;
  if (await ownsLauncher()) await stopWorkspace(workspace);
  else if (launcher && launcher.exitCode === null && !launcher.signalCode) launcher.kill('SIGTERM');
  if (launcher && launcher.exitCode === null && !launcher.signalCode) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && launcher.exitCode === null && !launcher.signalCode) await wait(50);
    assert.ok(launcher.exitCode !== null || launcher.signalCode, 'Development launcher did not stop');
  }
}
try {
  // Electron does not support Target.createBrowserContext. Exercise the real
  // React Router boundary in a separate clean Chromium process, then verify
  // real server/renderer startup and rollback through the development app.
  const fixtureBrowser = await puppeteer.launch({ executablePath: chromiumExecutable, headless: true });
  try {
  rendererBoundaryVersion = await fixtureBrowser.version();
  const compiled = await build({ entryPoints: [path.join(electronDir, 'test/fixtures/web-bundle-ready.client.tsx')],
    bundle: true, platform: 'browser', nodePaths: [path.join(electronDir, '../remix/node_modules')], write: false });
  for (const broken of [false, true]) {
    const context = await fixtureBrowser.createBrowserContext();
    try {
      const page = await context.newPage(); await page.setContent('<html><body><div id="root"></div></body></html>');
      await page.evaluate(value => { window.__fixtureThrow = value; }, broken);
      await page.addScriptTag({ content: compiled.outputFiles[0].text });
      await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0);
      if (!broken) await page.waitForFunction(() => window.__rendererReadyFixture?.acknowledged === 1);
      else await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const observed = await page.evaluate(() => window.__rendererReadyFixture);
      assert.equal(observed.acknowledged, broken ? 0 : 1); assert.equal(observed.renderErrors, broken ? 1 : 0);
      if (broken) assert.equal(observed.routerErrors, null);
      rendererBoundaryCases.push({ broken, ...observed });
    } finally { await context.close(); }
  }
  } finally { await fixtureBrowser.close(); }
  phase = 'stage-working-release';
  const initialClaim = await claimWorkspace(workspace);
  try {
    assert.deepEqual(await readFile(policyFile), originalPolicy, 'Preserve a policy changed before the workspace claim');
    await writeFile(policyFile, testPolicy); policyChanged = true;
  }
  finally { await initialClaim(); }
  const good = await stage(1, false);
  phase = 'confirm-working-release';
  const first = await start(good, 'trial');
  await first.page.screenshot({ path: path.join(output, 'confirmed-update.png') });
  phase = 'stop-working-release';
  await stop();
  phase = 'stage-failing-release';
  const bad = await stage(2, true);
  phase = 'recover-failing-release';
  const recovered = await start(good, 'retained');
  const state = JSON.parse(await readFile(path.join(cacheDirectory, 'state.json'), 'utf8'));
  assert.equal(state.failed, bad); assert.equal(state.highestSequence, 2); assert.equal(state.pending, null);
  await recovered.page.screenshot({ path: path.join(output, 'recovered-update.png') });
  receipt = { observedAt: new Date().toISOString(), implementation, syntheticSigner: true,
    realNitroAndRendererAcknowledgment: true, actualReactRouterErrorBoundaryRefusal: true, automaticFreshProcessRollback: true,
    goodReleaseId: good, failedReleaseId: bad, stableOrigin: recovered.info.origin, productionActivation: false,
    installedDevelopmentApp: workspace.app, profile: workspace.profile };
} catch (error) {
  failure = error;
} finally {
  try {
    await stop();
    const cleanupClaim = await claimWorkspace(workspace);
    try {
      if (policyChanged) {
        assert.equal(await readFile(policyFile, 'utf8'), testPolicy, 'Preserve a policy changed by another owner');
        await writeFile(policyFile, originalPolicy);
      }
      if (cacheCreated) {
        let state;
        try { state = JSON.parse(await readFile(path.join(cacheDirectory, 'state.json'), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        for (const id of [state?.active, state?.previous, state?.pending?.releaseId, state?.failed]) {
          assert.ok(!id || ownedIds.has(id), 'Preserve bundle state belonging to another owner');
        }
        await rm(cacheDirectory, { recursive: true, force: true });
      }
    } finally { await cleanupClaim(); }
  } catch (error) { cleanupFailure = error; }
  try { await log.close(); } catch (error) { cleanupFailure ||= error; }
}
const passed = Boolean(receipt && !failure && !cleanupFailure);
const diagnostic = error => error ? { name: error.name, code: error.code, message: String(error.message).slice(0, 1000) } : undefined;
await writeFile(path.join(output, 'verification.json'), JSON.stringify({
  ...receipt, passed, startedAt, finishedAt: new Date().toISOString(),
  phase: passed ? 'complete' : phase, implementation, cleanupVerified: !cleanupFailure,
  rendererBoundaryHost: 'isolated Chromium; native startup and rollback use the installed development app',
  rendererBoundaryVersion, rendererBoundaryCases,
  failure: diagnostic(failure), cleanupFailure: diagnostic(cleanupFailure)
}, null, 2) + '\n');
if (passed) {
  await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ passed, output }));
} else {
  console.error(`Startup diagnostics retained in ${temporary}`);
  throw failure || cleanupFailure || new Error('Startup acceptance did not produce a receipt');
}
