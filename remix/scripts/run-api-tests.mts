#!/usr/bin/env tsx
// Headless CLI runner for the API test suite that previously ran only on the
// interactive /tests page. Same source of truth: it imports the exact test
// definitions (app/tests/api/apiTests.ts) and the same runApiTest executor, so
// the page and CI can never drift.
//
// Usage:
//   npm test                                   # full suite against the local dev stack
//   npm test -- --base http://127.0.0.1:9999   # explicit target
//   npm test -- --group auth --group things    # only these groups
//   npm test -- --skip-mutating                # read-only subset (safe on shared DBs)
//   npm test -- --bail                         # stop at first failure
//   npm test -- --json                         # machine-readable summary on stdout
//
// Exit code: 0 when every selected test passes, 1 otherwise.

import { apiTestGroups, apiTests } from '../app/tests/api/apiTests';
import { runApiTest } from '../app/tests/api/apiTestRunner';
import type { ApiTestContext, ApiTestResult } from '../app/tests/api/apiTestRunner';

type CliOptions = {
  base: string;
  groups: string[];
  skipMutating: boolean;
  bail: boolean;
  json: boolean;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    base: process.env.API_TESTS_BASE_URL || `http://127.0.0.1:${process.env.TT_WEB_PORT || 9999}`,
    groups: [],
    skipMutating: false,
    bail: false,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue; // npm/pnpm forward the script-arg separator
    if (arg === '--base') options.base = argv[++i] || options.base;
    else if (arg === '--group') options.groups.push(...(argv[++i] || '').split(',').filter(Boolean));
    else if (arg === '--skip-mutating') options.skipMutating = true;
    else if (arg === '--bail') options.bail = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`run-api-tests: headless runner for the /tests API suite

  --base <url>       target origin (default: $API_TESTS_BASE_URL or http://127.0.0.1:$TT_WEB_PORT|9999)
  --group <name>     run only this group (repeatable / comma-separated). Known: ${apiTestGroups.join(', ')}
  --skip-mutating    skip tests marked mutates (safe against a shared DB)
  --bail             stop at the first failure
  --json             print a JSON summary instead of the text report`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg} (try --help)`);
      process.exit(2);
    }
  }

  return options;
};

// Minimal same-origin cookie jar so authed tests (register → session cookie →
// later requests) work like they do in the browser. Name→value only; the suite
// runs against one origin, so domain/path/expiry handling isn't needed.
const createCookieJarFetch = (): typeof globalThis.fetch => {
  const jar = new Map<string, string>();

  return async (input: any, init?: any) => {
    const headers = new Headers(init?.headers);
    if (jar.size > 0 && !headers.has('Cookie')) {
      headers.set('Cookie', [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
    }

    const response = await fetch(input, { ...init, headers });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        // an explicit empty value or Max-Age=0 is a deletion
        if (!value || /max-age=0/i.test(raw)) jar.delete(name);
        else jar.set(name, value);
      }
    }

    return response;
  };
};

const fetchEmailContext = async (base: string, fetchImpl: typeof globalThis.fetch) => {
  try {
    const response = await fetchImpl(new URL('/api/v1/email/config', base).toString(), {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return undefined;
    const body: any = await response.json().catch(() => null);
    return body?.ok ? body.config ?? body.email ?? undefined : undefined;
  } catch {
    return undefined;
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  const unknownGroups = options.groups.filter((group) => !(apiTestGroups as string[]).includes(group));
  if (unknownGroups.length > 0) {
    console.error(`Unknown group(s): ${unknownGroups.join(', ')}. Known: ${apiTestGroups.join(', ')}`);
    process.exit(2);
  }

  const selected = apiTests.filter(
    (test) =>
      (options.groups.length === 0 || options.groups.includes(test.group)) &&
      (!options.skipMutating || !test.mutates)
  );

  const fetchImpl = createCookieJarFetch();
  const context: ApiTestContext = {
    origin: options.base.replace(/\/+$/, ''),
    fetchImpl,
    email: await fetchEmailContext(options.base, fetchImpl)
  };

  if (!options.json) {
    console.log(`Running ${selected.length}/${apiTests.length} API tests against ${context.origin}\n`);
  }

  const results: ApiTestResult[] = [];
  const startedAt = Date.now();

  // sequential on purpose — tests share cookie/session state in definition order,
  // exactly like the /tests page
  for (const test of selected) {
    const result = await runApiTest(test, context);
    results.push(result);

    if (!options.json) {
      const mark = result.status === 'pass' ? '✓' : '✗';
      const line = `${mark} [${test.group}] ${test.name} (${result.durationMs}ms)`;
      console.log(result.status === 'pass' ? line : `${line}\n    ${result.details}`);
    }

    if (options.bail && result.status === 'fail') break;
  }

  const failed = results.filter((result) => result.status === 'fail');
  const summary = {
    base: context.origin,
    total: selected.length,
    ran: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    durationMs: Date.now() - startedAt,
    failures: failed.map((result) => ({ id: result.id, details: result.details }))
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `\n${summary.passed}/${summary.ran} passed` +
        (summary.failed ? `, ${summary.failed} FAILED` : '') +
        ` in ${(summary.durationMs / 1000).toFixed(1)}s`
    );
  }

  process.exit(failed.length > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
