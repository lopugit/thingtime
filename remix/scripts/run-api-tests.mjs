#!/usr/bin/env node
// Headless runner for the API test suite that until now only ran from the
// interactive /tests page. Reuses the SAME canonical definitions
// (app/tests/api/apiTests.ts) and the SAME per-test executor
// (app/tests/api/apiTestRunner.ts) the browser uses, so there is one source of
// truth for what "the API tests" are.
//
// Usage:
//   node scripts/run-api-tests.mjs [--base <url>] [--group <g>] [--all] [--json]
//
//   --base <url>   Base origin to hit (default: $API_TEST_BASE_URL or
//                  http://127.0.0.1:9999).
//   --group <g>    Only run tests in this group (auth, health, docs, ...).
//                  Repeatable.
//   --all          Also run tests marked `mutates` or `emailSend`. Off by
//                  default so a bare run is read-only and CI-safe.
//   --json         Emit a machine-readable JSON summary instead of text.
//
// Requires a Node with TypeScript type-stripping (the repo already runs its
// unit suites via `node --test *.test.ts`, so this is an existing baseline).

import { register } from 'node:module';
import process from 'node:process';

// Install the resolve hook (~/ alias + extensionless .ts) before importing any
// of the TypeScript test modules below.
register('./ts-alias-loader.mjs', import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const groups = args.reduce((acc, arg, i) => {
  if (arg === '--group' && args[i + 1]) acc.push(args[i + 1]);
  return acc;
}, []);

const base = (value('--base', process.env.API_TEST_BASE_URL) || 'http://127.0.0.1:9999').replace(/\/+$/, '');
const runMutations = flag('--all');
const asJson = flag('--json');

// The browser runner references window.setTimeout/clearTimeout and issues fetch
// with app-relative paths (the page's own origin resolves them). Shim both so
// the identical code runs under Node against an explicit base origin.
const timeoutHandles = new Set();
globalThis.window = globalThis.window || {
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms);
    timeoutHandles.add(h);
    return h;
  },
  clearTimeout: (h) => {
    timeoutHandles.delete(h);
    clearTimeout(h);
  }
};

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input === 'string' && input.startsWith('/')) {
    return nativeFetch(`${base}${input}`, init);
  }
  return nativeFetch(input, init);
};

const { apiTests } = await import('../app/tests/api/apiTests.ts');
const { runApiTest } = await import('../app/tests/api/apiTestRunner.ts');

const selected = apiTests.filter((test) => {
  if (groups.length && !groups.includes(test.group)) return false;
  if (!runMutations && (test.mutates || test.emailSend)) return false;
  return true;
});

const context = { origin: base };

const results = [];
for (const test of selected) {
  const result = await runApiTest(test, context);
  results.push({ test, result });
  if (!asJson) {
    const mark = result.status === 'pass' ? '✓' : '✗';
    const http = result.httpStatus === null ? '---' : String(result.httpStatus);
    process.stdout.write(`${mark} [${http}] ${test.group}/${test.id} — ${result.details}\n`);
    if (result.status === 'fail' && result.preview) {
      process.stdout.write(`    ${result.preview.replace(/\n/g, '\n    ')}\n`);
    }
  }
}

for (const h of timeoutHandles) clearTimeout(h);

const passed = results.filter((r) => r.result.status === 'pass').length;
const failed = results.length - passed;
const skipped = apiTests.length - selected.length;

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        base,
        total: selected.length,
        passed,
        failed,
        skipped,
        results: results.map(({ test, result }) => ({
          id: test.id,
          group: test.group,
          status: result.status,
          httpStatus: result.httpStatus,
          details: result.details
        }))
      },
      null,
      2
    )}\n`
  );
} else {
  process.stdout.write(`\n${passed}/${selected.length} passed, ${failed} failed, ${skipped} skipped (base ${base})\n`);
}

process.exit(failed > 0 ? 1 : 0);
