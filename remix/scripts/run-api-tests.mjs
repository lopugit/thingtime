#!/usr/bin/env node
// Headless CLI runner for the /tests-page API suite (TODO 15). Runs the exact
// same test definitions (app/tests/api/apiTests.ts) through the exact same
// runApiTest execution path the browser uses — test == live cohesion — against
// a running Thingtime stack. No new dependencies: Node ≥ 23 strips the
// TypeScript types natively and scripts/tt-alias-loader.mjs resolves the `~/`
// alias.
//
// Usage:
//   npm test                                  # against TT_TEST_BASE_URL or http://127.0.0.1:9999
//   TT_TEST_BASE_URL=http://127.0.0.1:15510 npm test
//   npm test -- --group=auth,health           # only these groups
//   npm test -- --list                        # print the suite without running
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./tt-alias-loader.mjs', import.meta.url), pathToFileURL('./'));

const BASE_URL = (process.env.TT_TEST_BASE_URL || 'http://127.0.0.1:9999').replace(/\/+$/, '');

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const groupArg = args.find((a) => a.startsWith('--group='));
const groups = groupArg ? groupArg.slice('--group='.length).split(',').map((g) => g.trim()).filter(Boolean) : null;

// The browser runner calls fetch(test.path) relatively and relies on the
// browser's cookie jar for the auth chains (register → me → logout …). Give
// Node the same behavior: absolutize against BASE_URL and keep a single-origin
// cookie jar fed by every Set-Cookie response header.
const cookieJar = new Map();
const nativeFetch = globalThis.fetch;

const cookieHeader = () =>
  Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

const storeCookies = (response) => {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);

  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*0*(;|$)/i.test(`${a};`) || /expires=.*1970/i.test(a));
    if (expired || value === '') cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
};

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${BASE_URL}${input}` : input;
  const headers = new Headers(init.headers || {});
  const jar = cookieHeader();
  if (jar && !headers.has('Cookie')) headers.set('Cookie', jar);
  const response = await nativeFetch(url, { ...init, headers });
  storeCookies(response);
  return response;
};

// apiTestRunner reaches for window.setTimeout / clearTimeout.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

const { apiTests } = await import('../app/tests/api/apiTests.ts');
const { runApiTest } = await import('../app/tests/api/apiTestRunner.ts');

const selected = groups ? apiTests.filter((t) => groups.includes(t.group)) : apiTests;

if (listOnly) {
  for (const t of selected) console.log(`${t.group.padEnd(11)} ${t.id.padEnd(40)} ${t.method.padEnd(6)} ${t.path}`);
  console.log(`\n${selected.length} tests`);
  process.exit(0);
}

if (selected.length === 0) {
  console.error(`No tests matched groups: ${groups?.join(', ')}`);
  process.exit(1);
}

// Mirror the /tests page: probe the server, then hydrate the email context so
// SES-sandbox pacing and test recipients behave identically to browser runs.
try {
  await fetch('/api/v1/health/nitro');
} catch (err) {
  console.error(`Thingtime stack is not reachable at ${BASE_URL} — start it first (npm run web-pms) or set TT_TEST_BASE_URL.`);
  console.error(String(err?.cause || err));
  process.exit(1);
}

let email;
try {
  const configResponse = await fetch('/api/v1/email/config', { headers: { Accept: 'application/json' } });
  if (configResponse.ok) {
    const config = await configResponse.json();
    if (config && typeof config === 'object' && config.provider) email = config;
  }
} catch {
  // email context is optional — tests degrade the same way the browser does
}

const context = { origin: BASE_URL, email };

let passed = 0;
let failed = 0;
const failures = [];
const startedAt = Date.now();

for (const test of selected) {
  const result = await runApiTest(test, context);
  const ok = result.status === 'pass';
  if (ok) passed += 1;
  else {
    failed += 1;
    failures.push({ test, result });
  }
  const status = ok ? ' ok ' : 'FAIL';
  console.log(`${status}  [${test.group}] ${test.id} (${result.httpStatus ?? '—'}, ${result.durationMs}ms)${ok ? '' : ` — ${result.details}`}`);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n${passed}/${selected.length} passed, ${failed} failed in ${seconds}s against ${BASE_URL}`);

if (failures.length) {
  console.log('\nFailures:');
  for (const { test, result } of failures) {
    console.log(`- [${test.group}] ${test.id}: ${result.details}`);
    if (result.preview) console.log(`    ${result.preview.split('\n').join('\n    ').slice(0, 400)}`);
  }
}

process.exit(failed ? 1 : 0);
