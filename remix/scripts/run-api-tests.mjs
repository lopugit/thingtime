#!/usr/bin/env node
// Headless CLI runner for the API test suite that previously only ran on the
// interactive /tests page. Reuses the exact same test definitions and
// runApiTest engine (app/tests/api/) so the page and CI can never drift.
//
// Usage:
//   node scripts/run-api-tests.mjs [--base http://127.0.0.1:9999] [--group auth,things] [--list]
//
// The base URL should be the WEB port (Vite proxies /api to Nitro) so tests
// that hit non-/api routes (redirect checks) also work. Defaults to
// TT_API_TEST_BASE_URL, then this worktree's web port from worktree-ports.
import { register } from 'node:module';
import { createRequire } from 'node:module';

register('./tilde-loader.mjs', import.meta.url);

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const readFlag = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
};

const resolveBaseUrl = () => {
  const explicit = readFlag('base') || process.env.TT_API_TEST_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const { resolveDevContext } = require('./worktree-ports.cjs');
  const { ports } = resolveDevContext(process.cwd());
  return `http://127.0.0.1:${ports.web}`;
};

const BASE_URL = resolveBaseUrl();

// --- browser shims -----------------------------------------------------------
// runApiTest uses window.setTimeout/clearTimeout; give Node the same surface.
globalThis.window = globalThis;

// Cookie jar + relative-URL resolution: the /tests page relies on the browser
// for both (credentials: 'include' + same-origin fetch). Auth flows chain
// (register → me → logout), so cookie continuity is required for parity.
const cookieJar = new Map();

const cookieHeader = () =>
  [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

const storeSetCookie = (setCookie) => {
  const [pair] = setCookie.split(';');
  const eq = pair.indexOf('=');
  if (eq === -1) return;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const attrs = setCookie.toLowerCase();
  const expired = attrs.includes('max-age=0') || attrs.includes('expires=thu, 01 jan 1970');
  if (expired) cookieJar.delete(name);
  else cookieJar.set(name, value);
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${BASE_URL}${input}` : input;
  const headers = new Headers(init.headers || {});
  const cookies = cookieHeader();
  if (cookies && !headers.has('cookie')) headers.set('cookie', cookies);
  const response = await realFetch(url, { ...init, headers });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) storeSetCookie(sc);
  return response;
};

// --- run ---------------------------------------------------------------------
const { apiTests } = await import('../app/tests/api/apiTests.ts');
const { runApiTest } = await import('../app/tests/api/apiTestRunner.ts');

const groupsFilter = (readFlag('group') || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const selected = apiTests.filter((test) => !groupsFilter.length || groupsFilter.includes(test.group));

if (args.includes('--list')) {
  for (const test of selected) console.log(`${test.group.padEnd(12)} ${test.id}  ${test.name}`);
  console.log(`\n${selected.length} tests`);
  process.exit(0);
}

// same sanitized email context the /tests page fetches, so SES-sandbox
// pacing and test-recipient targeting behave identically headless
const buildContext = async () => {
  const context = { origin: BASE_URL };
  try {
    const response = await globalThis.fetch('/api/v1/email/config');
    if (response.ok) {
      const body = await response.json();
      if (body && typeof body === 'object') context.email = body.config ?? body;
    }
  } catch {
    // no email config endpoint — email tests will use their defaults
  }
  return context;
};

const context = await buildContext();

console.log(`Running ${selected.length} API tests against ${BASE_URL}\n`);

let failures = 0;
const startedAt = Date.now();

// fresh session per group: auth chains within a group stay intact, but a
// login left over from one group must not leak authed state into another
// group's anonymous-guard expectations (matches a logged-out /tests page run)
const sharedSession = args.includes('--shared-session');
let currentGroup = null;

for (const test of selected) {
  if (!sharedSession && test.group !== currentGroup) {
    currentGroup = test.group;
    cookieJar.clear();
  }
  const result = await runApiTest(test, context);
  const passed = result.status === 'pass';
  if (!passed) failures += 1;
  const mark = passed ? '✓' : '✗';
  const status = result.httpStatus === null ? 'ERR' : result.httpStatus;
  console.log(`${mark} [${test.group}] ${test.name} (${status}, ${result.durationMs}ms)`);
  if (!passed) {
    console.log(`    ${result.details}`);
    if (result.preview) console.log(`    ${String(result.preview).split('\n').join('\n    ')}`);
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n${selected.length - failures}/${selected.length} passed in ${elapsed}s`);

if (failures) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
