import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
const { chromium } = require(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE || 'playwright');
const work = await mkdtemp(join(tmpdir(), 'thingtime-connections-oauth-tab-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-connections-oauth-tab-evidence'));
const providerOrigin = 'https://oauth-provider.example.test';
const callbackPath = '/api/v1/connections/oauth/callback';
let browser, server;

try {
  await mkdir(evidence, { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, 'scripts/connections-oauth-tab.browser.tsx')], bundle: true, format: 'esm',
    nodePaths: process.env.THINGTIME_TEST_NODE_MODULES ? [process.env.THINGTIME_TEST_NODE_MODULES] : [],
    platform: 'browser', target: 'esnext', outfile: join(work, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error'
  });
  const script = await readFile(join(work, 'fixture.js'));
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(script);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });

  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const endpoint = '/api/v1/connections';
    const selectedOrigin = 'https://selected-api.example.test';
    const observedOrigins = [];
    const json = (route, payload) => {
      const selected = route.request().headers()['x-thingtime-expected-api-origin'];
      return route.fulfill({ json: payload, ...(selected === selectedOrigin ? { headers: { 'x-thingtime-api-fallback': selectedOrigin } } : {}) });
    };
    const firstOwner = 'oauth-tab-fixture-owner';
    const nextOwner = 'oauth-tab-other-owner';
    let begins = 0, callbacks = 0, linked = false, holdList, listStarted, listFinished, pendingNamed;
    const savedLayouts = new Map();
    const namedRows = [];
    const namedBegins = [];
