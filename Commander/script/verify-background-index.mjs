#!/usr/bin/env node
// Real bundled-daemon acceptance with an isolated synthetic profile. The UI
// session credential stays in memory; no readiness output is persisted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.argv[2];
assert(app, 'Usage: node script/verify-background-index.mjs <isolated development .app>');
const resources = path.join(path.resolve(app), 'Contents/Resources');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-background-acceptance-'));
const fixtures = path.join(temporary, 'fixtures');
const data = path.join(temporary, 'data');
await fs.mkdir(fixtures);
await fs.mkdir(data);
const { DEFAULT_SETTINGS } = await import(pathToFileURL(path.join(root, 'packages/protocol/dist/index.js')));
const settings = structuredClone(DEFAULT_SETTINGS);
settings.indexing.roots = [fixtures];
settings.indexing.customIgnores = [];
settings.searchCache.enabled = false;
await fs.writeFile(path.join(data, 'state.json'), JSON.stringify({ version: 1, settings, accounts: [], extensions: [], extensionPreferences: [], recentSearches: [], searchPreferences: [] }), {mode: 0o600});
await fs.writeFile(path.join(fixtures, 'acceptance-baseline.txt'), 'synthetic fixture\n');
const child = spawn(path.join(resources, 'node/bin/node'), [path.join(resources, 'commander-daemon.mjs'), '--ui', path.join(resources, 'ui'), '--port', '0', '--parent-pid', String(process.pid), '--rust-core', path.join(resources, 'commander-core'), '--filesystem-indexer', path.join(resources, 'commander-indexer')], {
  env: {...process.env, COMMANDER_DATA_DIR: data, COMMANDER_CACHE_DIR: path.join(temporary, 'cache'), COMMANDER_APPLICATION_ROOTS: JSON.stringify([fixtures])},
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.resume();
const latencies = [];
let api;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 20_000;
  do {
    if (await check()) return;
    await wait(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
try {
  const lines = createInterface({input: child.stdout});
  const ready = await Promise.race([
    once(lines, 'line').then(([line]) => JSON.parse(line)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Daemon readiness timeout')), 30_000).unref()),
    once(child, 'exit').then(() => { throw new Error('Daemon exited before readiness'); }),
  ]);
  assert.equal(ready.type, 'ready');
  lines.close();
  api = async (route, body) => {
    const start = performance.now();
    const response = await fetch(new URL(route, ready.url), {method: body ? 'POST' : 'GET', headers: {'x-commander-session': ready.sessionToken, 'content-type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(5000)});
    assert(response.ok, `${route}: ${response.status}`);
    const result = await response.json();
    if (route.startsWith('/api/search')) latencies.push(performance.now() - start);
    return result;
  };
  const manifest = await (await fetch(new URL('/.well-known/commander-capabilities.json', ready.url))).json();
  assert.equal(manifest.origin, ready.url);
  const [statusMajor, statusMinor] = manifest.features['commander.index-status'].version.split('.').map(Number);
  assert(statusMajor === 1 && statusMinor >= 1, 'requires commander.index-status >=1.1.0 <2.0.0');
  const hits = async query => (await api(`/api/search?q=${encodeURIComponent(query)}`)).hits;
  const titles = async query => (await hits(query)).map(hit => (hit.item ?? hit).title);
  await until(async () => (await titles('acceptance-baseline')).includes('acceptance-baseline.txt'), 'initial fixture index');
  await until(async () => !(await api('/api/index/status')).running.length, 'initial idle');
  const baseline = await api('/api/index/status');
  for (const [kind, suffix] of [['file', '.txt'], ['directory', ''], ['application', '.app']]) {
    const original = `acceptance-live-${kind}${suffix}`;
    const renamed = `acceptance-renamed-${kind}${suffix}`;
    const originalPath = path.join(fixtures, original);
    const renamedPath = path.join(fixtures, renamed);
    const started = performance.now();
    if (kind === 'file') await fs.writeFile(originalPath, 'synthetic fixture\n');
    else {
      await fs.mkdir(originalPath);
      if (kind === 'application') {
        await fs.mkdir(path.join(originalPath, 'Contents'));
        await fs.writeFile(path.join(originalPath, 'Contents/Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.thingtime.commander.acceptance</string><key>CFBundleName</key><string>acceptance-live-application</string></dict></plist>');
      }
    }
    await until(async () => (await titles(`acceptance-live-${kind}`)).some(title => title.includes(`acceptance-live-${kind}`)), `automatic ${kind} addition`);
    console.log(`${kind} addition visible after ${Math.round(performance.now() - started)}ms`);
    await fs.rename(originalPath, renamedPath);
    await until(async () => {
      const current = await titles(`acceptance-renamed-${kind}`);
      const previous = await titles(`acceptance-live-${kind}`);
      return current.some(title => title.includes(`acceptance-renamed-${kind}`)) && !previous.some(title => title.includes(`acceptance-live-${kind}`));
    }, `automatic ${kind} rename`);
    await fs.rm(renamedPath, {recursive: true});
    await until(async () => !(await titles(`acceptance-renamed-${kind}`)).some(title => title.includes(`acceptance-renamed-${kind}`)), `automatic ${kind} deletion`);
    console.log(`${kind} rename and deletion verified during repeated live searches`);
  }
  await until(async () => !(await api('/api/index/status')).running.length, 'final idle');
  const final = await api('/api/index/status');
  assert.equal(final.totalRecords, baseline.totalRecords, 'removed fixtures leave original database count');
  assert.equal(final.searchableRecords, baseline.searchableRecords, 'searchable total returns to baseline');
  assert(final.lastIndexedAtMs > 0, 'current full index timestamp available');
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({fixtureRows: baseline.totalRecords, searchableRecords: final.searchableRecords, lastIndexedAtMs: final.lastIndexedAtMs, searches: latencies.length, p95SearchMs: Math.round(latencies[Math.floor(latencies.length * 0.95)]), maximumSearchMs: Math.round(latencies.at(-1))}));
} catch (error) {
  // Daemon stderr is intentionally not printed: external dependencies may add
  // sensitive diagnostics. Keep the acceptance failure to known test labels.
  console.error(error.message);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), wait(3000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  await fs.rm(temporary, {recursive: true, force: true});
}
