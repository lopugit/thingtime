import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, '../MCP/package.json'));
const scratch = await mkdtemp(join(tmpdir(), 'thingtime-two-way-progress-'));
const evidence = resolve(process.argv[2] || await mkdtemp(join(tmpdir(), 'thingtime-two-way-progress-evidence-')));
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ChakraProvider } from '@chakra-ui/react';
import { SyncProgressViewer } from '../app/components/Devices/SyncProgressViewer';
import { SyncFolderCard } from '../app/components/Devices/SyncFolderCard';
import { syncConnectionGlance } from '../app/fileSync/connectionGlance';
import { cloudFileSyncEntry } from '../app/fileSync/cloudFile';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { runPagedForegroundCloudSync } from '../app/fileSync/pagedForegroundSync';

const scope = { origin: location.origin, ownerId: 'fixture-owner', deviceId: 'fixture-device', rootId: 'fixture-connection', dataPlane: 'home' };
const saved = { id: scope.rootId, updatedAt: '2026-11-05T00:00:00.000Z', configuration: {
  ...newFileSyncConfiguration({ name: 'Progress fixture', deviceId: scope.deviceId, localRootId: 'local-root', remoteFolderId: 'cloud-root' }),
  mode: 'two-way', paused: false
} };
const folderPath = 'Documents';
const name = 'one-sided-edit-with-a-long-filename-for-narrow-progress.bin';
const path = folderPath + '/' + name;
const folder = { path: folderPath, id: 'cloud-parent', version: 'parent-revision', kind: 'folder', size: 0, sha256: null };
const localFolder = { ...folder, id: 'local-parent' };
const json = value => Response.json({ ok: true, ...value });
const originalFetch = window.fetch.bind(window);
window.fetch = (target, init) => {
  const url = new URL(typeof target === 'string' ? target : target instanceof URL ? target.href : target.url, location.origin);
  if (url.pathname.includes('thingtime-capabilities')) return Promise.resolve(Response.json({
    schemaVersion: 1, origin: location.origin, features: {
      'api.webpages-resolve': { version: '1.6.0' }, 'api.actions-run': { version: '1.7.0' },
      'api.mongodb-endpoint': { version: '1.1.0' }
    }
  }));
  if (url.pathname === '/api/v1/webpages/resolve') return Promise.resolve(Response.json({ ok: false }, { status: 404 }));
  if (url.pathname.startsWith('/api/')) return Promise.resolve(json({ things: [], items: [], components: [] }));
  return originalFetch(target, init);
};
const latch = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
const frame = (id, entries, after, done = false) => ({ id, generation: id,
  state: done ? 'complete' : 'running', revision: after + entries.length, nextSequence: after + entries.length,
  hasMore: false, changes: entries.map((entry, index) => ({ sequence: after + index + 1, entry, revision: entry.version }))
});
const scanFrame = latch(), allowDownload = latch(), allowStrict = latch();
const qa = { scanFrame: scanFrame.release, allowDownload: allowDownload.release, allowStrict: allowStrict.release, progress: [] };
Object.assign(window, { twoWayQA: qa });

async function run(setProgress, setDescriptor) {
  const journal = await openSyncJournal();
  try {
    let bytes, cloudFile, localFile, receipt, strictScans = 0;
    const cloudEntry = () => cloudFileSyncEntry(cloudFile, path);
    async function setCloud(revision, data) {
      bytes = new Uint8Array(data);
      cloudFile = { id: 'remote-file', name, folderId: folder.id, revision, trashed: false,
        content: { attachmentId: 'attachment-' + revision, version: 'a'.repeat(64), size: bytes.length,
          fingerprint: await fingerprintSource({ size: bytes.length, check() {}, read: async (offset, length) => bytes.slice(offset, offset + length) }) } };
    }
    await setCloud('old', [1, 2, 3]);
    localFile = { ...cloudEntry(), id: 'local-file', version: 'local-old' };
    const runtime = { currentScope: () => scope, origin: () => scope.origin, requireCapability: async () => {},
      async fetch(target) {
        const url = new URL(String(target));
        if (url.pathname === '/api/v1/files') {
          if (url.searchParams.has('rootId')) {
            const key = url.searchParams.get('path');
            return json({ observation: { version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root-revision',
              path: key, entry: key === folderPath ? folder : key === path ? cloudEntry() : null } });
          }
          if (url.searchParams.get('id') === cloudFile.id) return json({ file: cloudFile });
        }
        if (url.pathname === '/api/v1/attachments/content' && url.searchParams.has('range')) {
          const offset = Number(url.searchParams.get('offset')), length = Number(url.searchParams.get('length'));
          return new Response(bytes.slice(offset, offset + length), { status: 206, headers: {
            ETag: '"' + cloudFile.content.version + '"', 'Content-Range': 'bytes ' + offset + '-' + (offset + length - 1) + '/' + bytes.length,
            'Content-Length': String(length)
          } });
        }
        throw Error('Unexpected fixture transport: ' + url.pathname);
      }
    };
    const input = { journal, runtime, currentScope: () => scope,
      readConfiguration: async () => ({ id: saved.id, updatedAt: saved.updatedAt, crystal: saved.configuration,
        author: { id: scope.ownerId }, thingtime: ['file-sync'], acl: ['tt:user'] }),
      authorizeDevice: async () => {},
      conditions: async () => ({ network: 'wifi', charging: true }),
      inventory: async () => ({ version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root-revision',
        nodes: [{ kind: 'folder', path: folderPath, id: folder.id, revision: folder.version, folderId: 'cloud-root' }, { kind: 'file', path, file: cloudFile }] }),
      scanLocal: async () => [localFolder, localFile],
      inspectLocal: async key => key === folderPath ? localFolder : key === path ? localFile : null,
      source: async () => { throw Error('The download-only fixture attempted to upload.'); },
      progress: () => {}
    };
    const signal = new AbortController().signal;
    input.localTarget = {
      lookup: async () => receipt ? { status: 'complete', receipt } : { status: 'missing' },
      stage: async (op, binding, source, progress) => {
        const first = await source.read(0, 4);
        if (first.join() !== '4,5,6,7') throw Error('Unexpected staged cloud bytes.');
        progress(4, 4);
        await allowDownload.promise;
        const last = await source.read(4, 5);
        if (last.join() !== '8,9,10,11,12') throw Error('Unexpected remaining cloud bytes.');
        progress(5, 9);
        return { operationId: op.id, scope: binding, token: op.id, entry: { ...op.mutation.source, id: localFile.id, version: 'local-edited' } };
      },
      publish: async (op, binding, stage) => {
        if (receipt) throw Error('The fixture published its early download twice.');
        localFile = stage.entry;
        receipt = { operationId: op.id, scope: binding, entry: localFile };
        return receipt;
      }
    };
    const baseline = await runPagedForegroundCloudSync(saved, scope, input, signal);
    if (baseline.progress.operations !== 0) throw Error('Baseline did not settle the unchanged parent and file.');
    await setCloud('edited', [4, 5, 6, 7, 8, 9, 10, 11, 12]);
    input.scanLocal = async () => {
      if (++strictScans === 1) { qa.strictStarted = true; await allowStrict.promise; }
      return [localFolder, localFile];
    };
    input.streamLocalChanges = async function* (id) {
      yield frame(id, [localFolder, localFile], 0);
      await scanFrame.promise;
      yield frame(id, [localFolder], 2);
      await allowDownload.promise;
      yield frame(id, [], 3, true);
    };
    input.streamRemoteChanges = async function* (id) {
      yield frame(id, [folder, cloudEntry()], 0);
      await allowDownload.promise;
      yield frame(id, [], 2, true);
    };
    input.progress = value => { qa.progress.push(value); setProgress(value); };
    input.progressSession = setDescriptor;
    const result = await runPagedForegroundCloudSync(saved, scope, input, signal);
    qa.strictOperations = result.progress.operations;
    qa.published = Boolean(receipt);
  } finally { journal.close(); }
}

function Fixture() {
  const [progress, setProgress] = useState(undefined), [descriptor, setDescriptor] = useState(undefined);
  const [started, setStarted] = useState(false);
  const start = () => {
    setStarted(true);
    run(setProgress, setDescriptor).catch(error => { qa.error = error.stack; console.error(error); });
  };
  const complete = progress?.stage === 'complete';
  const glance = syncConnectionGlance({ progress, online: true, active: started && !complete, paused: false });
  return <ChakraProvider><main style={{ maxWidth: 760, margin: 'auto', padding: 16 }}>
    <SyncFolderCard title="Fixture folder" path="/Synthetic/Documents" description="Two-way sync" stats="Synthetic connection"
      scopeKey="two-way-progress-glance" expanded={false} glance={glance}><span /></SyncFolderCard>
    {!started && <button onClick={start}>Start fixture</button>}
    {started && <SyncProgressViewer scopeKey="two-way-progress" descriptor={descriptor} currentScope={() => scope}
      progress={progress} status={complete ? 'complete' : 'running'} />}
  </main></ChakraProvider>;
}
const router = createMemoryRouter([{ id: 'root', path: '*', element: <Fixture /> }], { hydrationData: {
  loaderData: { root: { user: { id: scope.ownerId, username: 'fixture-owner' }, dataPlane: 'home' } }
} });
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
`;

let context, server;
try {
  await mkdir(evidence, { recursive: true });
  await require('esbuild').build({
    stdin: { contents: fixture, loader: 'tsx', resolveDir: join(root, 'scripts') },
    tsconfig: join(root, 'tsconfig.json'), outfile: join(scratch, 'fixture.js'), bundle: true,
    platform: 'browser', format: 'esm', target: 'esnext', logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file', '.png': 'dataurl', '.svg': 'dataurl' }
  });
  const bundle = await readFile(join(scratch, 'fixture.js'));
  server = createServer((request, response) => {
    const script = request.url === '/fixture.js';
    response.writeHead(200, { 'Content-Type': script ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
    response.end(script ? bundle : '<!doctype html><meta charset="utf-8"><title>[QA] Two-way progress</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const { chromium } = require(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    headless: true, downloadsPath: join(scratch, 'downloads'), acceptDownloads: false, serviceWorkers: 'block'
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const viewports = [['desktop', 1440, 1000], ['mobile', 390, 844]];
  const results = [];
  for (const [label, width, height] of viewports) {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    page.setDefaultTimeout(12000);
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.evaluate(() => new Promise((done, fail) => {
      const request = indexedDB.deleteDatabase('thingtime-file-sync-v1');
      request.onsuccess = () => done();
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(Error('Previous fixture journal is still open.'));
    }));
    await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
    const viewer = page.locator('[data-settings-document="file-sync-progress"]');
    const assertFixture = async predicate => {
      await page.waitForFunction(predicate, undefined, { timeout: 15000 }).catch(async error => {
        throw new Error(await page.evaluate(() => window.twoWayQA.error) || error.message);
      });
    };
    const screenshot = async state => {
      await page.evaluate(() => scrollTo(0, 0));
      for (let step = 0; ; step++) {
        const bounds = await page.evaluate(() => ({ y: scrollY, height: innerHeight, total: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
        if (bounds.y + bounds.height >= bounds.total - 1) break;
        assert.ok(step < 20, 'Could not reach the bottom of the fixture.');
        await page.evaluate(() => scrollBy(0, innerHeight * .8));
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(evidence, label + '-' + state + '.png'), fullPage: true });
    };
    try {
      await assertFixture(() => window.twoWayQA.progress.some(p => p.direction === 'download' && p.bytes === 4));
      await viewer.getByText(/Current file: Documents\/one-sided-edit.*4 B \/ 9 B/).waitFor();
      await viewer.getByRole('button', { name: 'Refresh progress', exact: true }).click();
      await viewer.getByRole('button', { name: 'Open Documents', exact: true }).click();
      await viewer.getByText('one-sided-edit-with-a-long-filename-for-narrow-progress.bin', { exact: true }).waitFor();
      await viewer.getByText('Downloading', { exact: true }).waitFor();
      const beforeFrame = await page.evaluate(() => window.twoWayQA.progress.at(-1).indexed);
      await page.evaluate(() => window.twoWayQA.scanFrame());
      await page.waitForFunction(before => window.twoWayQA.progress.at(-1).indexed > before, beforeFrame);
      const active = await page.evaluate(() => window.twoWayQA.progress.at(-1));
      assert.equal(active.direction, 'download');
      assert.equal(active.bytes, 4);
      assert.ok(active.path.startsWith('Documents/'));
      await viewer.getByText(/Current file: Documents\/one-sided-edit.*4 B \/ 9 B/).waitFor();
      await screenshot('active-download');

      await page.evaluate(() => window.twoWayQA.allowDownload());
      await assertFixture(() => window.twoWayQA.strictStarted);
      const earlyProgress = await page.evaluate(() => window.twoWayQA.progress.filter(p => p.indexState === 'complete'));
      assert.ok(earlyProgress.length > 0 && earlyProgress.every(p => p.totalFinal === false));
      await page.getByText('0 B confirmed / 0 B planned · known so far, still growing', { exact: true }).waitFor();
      assert.equal(await page.getByText('No work in this direction', { exact: true }).count(), 0);
      await screenshot('strict-discovery');

      await page.evaluate(() => window.twoWayQA.allowStrict());
      await assertFixture(() => window.twoWayQA.strictOperations === 0 && window.twoWayQA.published === true);
      await viewer.getByRole('heading', { name: '2. Download files and folders', exact: true }).waitFor();
      await viewer.getByText(/^Complete · 1 \/ 1 operations confirmed/).waitFor();
      await viewer.getByRole('button', { name: 'Open Documents', exact: true }).click();
      await viewer.getByText('one-sided-edit-with-a-long-filename-for-narrow-progress.bin', { exact: true }).waitFor();
      await viewer.getByText(/9 B \/ 9 B to copy · 1 \/ 1 files confirmed/).last().waitFor();
      await page.getByText('9 B confirmed / 9 B planned', { exact: true }).waitFor();
      const final = await page.evaluate(() => window.twoWayQA.progress.at(-1));
      assert.equal(final.total, 1);
      assert.equal(final.confirmed, 1);
      assert.equal(final.directions.download.bytesConfirmed, '9');
      assert.equal(final.totalFinal, true);
      assert.deepEqual(errors, []);
      await screenshot('complete-download');
      results.push({ label, width, height, beforeSeal: active, strictOperations: 0, final });
    } catch (error) {
      await page.screenshot({ path: join(evidence, label + '-failure.png'), fullPage: true }).catch(() => {});
      await writeFile(join(evidence, label + '-failure.txt'), await page.locator('body').innerText()).catch(() => {});
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, results }, null, 2));
  console.log('TWO_WAY_PROGRESS_UI_OK ' + evidence);
} finally {
  await context?.close();
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(scratch, { recursive: true, force: true });
}
