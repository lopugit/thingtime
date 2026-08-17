import assert from 'node:assert/strict';
import test from 'node:test';

import { reportTypecheckRatchet } from './typecheck-ratchet.mjs';

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
