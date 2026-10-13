import assert from 'node:assert/strict';
import test from 'node:test';

import { NEVER_TOLERATED_CODES, reportTypecheckRatchet } from './typecheck-ratchet.mjs';

const captureReporter = () => {
  const messages = { log: [], warn: [] };
  return {
    messages,
    reporter: {
      log: (message) => messages.log.push(message),
      warn: (message) => messages.warn.push(message),
    },
  };
};

test('an increased typecheck count emits a GitHub warning and remains non-blocking', () => {
  const { messages, reporter } = captureReporter();
  const errors = [
    'app/first.ts(1,1): error TS2322: first diagnostic',
    'app/second.ts(2,2): error TS2345: second diagnostic',
  ];

  const exitCode = reportTypecheckRatchet({ errors, baseline: 1, githubActions: true, reporter });

  assert.equal(exitCode, 0);
  assert.match(messages.warn[0], /^Typecheck ratchet WARNING: 2 tsc errors vs baseline 1 \(\+1\)\./);
  assert.equal(
    messages.log[0],
    '::warning title=Typecheck ratchet increased::Typecheck ratchet WARNING: 2 tsc errors vs baseline 1 (+1). This check is non-blocking.',
  );
  assert.ok(messages.warn.includes(`  ${errors[0]}`));
  assert.ok(messages.warn.includes(`  ${errors[1]}`));
});

test('duplicate property and identifier diagnostics fail the run even under the baseline', () => {
  assert.deepEqual(NEVER_TOLERATED_CODES, ['TS1117', 'TS2300', 'TS2451']);
  const { messages, reporter } = captureReporter();
  const errors = ["nitro.config.ts(40,3): error TS1117: An object literal cannot have multiple properties with the same name."];

  const exitCode = reportTypecheckRatchet({ errors, baseline: 89, githubActions: true, reporter });

  assert.equal(exitCode, 1);
  assert.match(messages.warn[0], /^Typecheck ratchet FAILED: 1 duplicate-property\/identifier diagnostic /);
  assert.match(messages.log[0], /^::error title=Typecheck ratchet duplicate declarations::/);
  assert.ok(messages.warn.includes(`  ${errors[0]}`));
  // a tolerated code under the baseline still passes
  assert.equal(reportTypecheckRatchet({ errors: ['a.ts(1,1): error TS2339: x'], baseline: 89, githubActions: false, reporter: captureReporter().reporter }), 0);
});

test('an unchanged typecheck count passes without a warning', () => {
  const { messages, reporter } = captureReporter();

  const exitCode = reportTypecheckRatchet({ errors: ['error TS1234: known'], baseline: 1, githubActions: true, reporter });

  assert.equal(exitCode, 0);
  assert.deepEqual(messages.warn, []);
  assert.deepEqual(messages.log, ['Typecheck ratchet: 1 errors, at baseline.']);
});

test('a reduced typecheck count still prompts a baseline update', () => {
  const { messages, reporter } = captureReporter();

  const exitCode = reportTypecheckRatchet({ errors: [], baseline: 1, githubActions: true, reporter });

  assert.equal(exitCode, 0);
  assert.deepEqual(messages.warn, []);
  assert.match(messages.log[0], /DOWN from baseline 1/);
  assert.match(messages.log[1], /--update-baseline/);
});
