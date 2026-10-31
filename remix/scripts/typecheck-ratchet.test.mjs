import assert from 'node:assert/strict';
import test from 'node:test';

import { NEVER_TOLERATED_CODES, reportTypecheckRatchet, runTypecheckRatchet } from './typecheck-ratchet.mjs';

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

const diagnostic = (code = 'TS2322') => `app/file.ts(1,1): error ${code}: example diagnostic`;

const run = async ({ output = '', error = null, baseline = 1, args = [] } = {}) => {
  const { messages, reporter } = captureReporter();
  const writes = [];
  let compilerCalls = 0;
  const exitCode = await runTypecheckRatchet({
    args,
    baselineFile: 'baseline.json',
    readFileImpl: () => JSON.stringify({ errorCount: baseline }),
    writeFileImpl: (...values) => writes.push(values),
    execFileImpl: (_command, _args, _options, callback) => {
      compilerCalls += 1;
      callback(error, output, '');
    },
    reporter,
    githubActions: true,
  });
  return { exitCode, messages, writes, compilerCalls };
};

test('an increased typecheck count fails and emits a GitHub error', () => {
  const result = captureReporter();
  assert.equal(reportTypecheckRatchet({ errors: [diagnostic(), diagnostic('TS2345')], baseline: 1, githubActions: true, reporter: result.reporter }), 1);
  assert.match(result.messages.warn[0], /^Typecheck ratchet FAILED: 2 tsc errors vs baseline 1 \(\+1\)\./);
  assert.match(result.messages.log[0], /^::error title=Typecheck ratchet increased::/);
});

test('duplicate property and identifier diagnostics stay fatal', () => {
  assert.deepEqual(NEVER_TOLERATED_CODES, ['TS1117', 'TS2300', 'TS2451']);
  const { messages, reporter } = captureReporter();
  const errors = ['nitro.config.ts(40,3): error TS1117: duplicate property'];

  assert.equal(reportTypecheckRatchet({ errors, baseline: 89, githubActions: true, reporter }), 1);
  assert.match(messages.warn[0], /^Typecheck ratchet FAILED: 1 duplicate-property\/identifier diagnostic /);
  assert.match(messages.log[0], /^::error title=Typecheck ratchet duplicate declarations::/);
});

test('an unchanged count passes without a warning', () => {
  const { messages, reporter } = captureReporter();

  assert.equal(reportTypecheckRatchet({ errors: [diagnostic()], baseline: 1, githubActions: true, reporter }), 0);
  assert.deepEqual(messages.warn, []);
  assert.deepEqual(messages.log, ['Typecheck ratchet: 1 errors, at baseline.']);
});

test('a reduced count passes and can be locked in', async () => {
  const { messages, reporter } = captureReporter();
  assert.equal(reportTypecheckRatchet({ errors: [], baseline: 1, githubActions: true, reporter }), 0);
  assert.match(messages.log[0], /DOWN from baseline 1/);

  const result = await run({ output: `${diagnostic()}\n`, baseline: 2, args: ['--update-baseline'] });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.writes, [['baseline.json', '{\n  "errorCount": 1\n}\n']]);
});

test('a baseline update refuses increases and never writes them', async () => {
  const result = await run({ output: `${diagnostic()}\n${diagnostic('TS2345')}\n`, baseline: 1, args: ['--update-baseline'] });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.writes, []);
  assert.match(result.messages.warn[0], /refusing to increase baseline from 1 to 2/);
});

test('a baseline update refuses never-tolerated diagnostics', async () => {
  const result = await run({ output: `${diagnostic('TS2300')}\n`, baseline: 2, args: ['--update-baseline'] });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.writes, []);
  assert.match(result.messages.warn[0], /cannot be updated while never-tolerated diagnostics/);
});

test('invalid baselines fail before invoking the compiler or writing', async () => {
  for (const baseline of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, null]) {
    const { messages, reporter } = captureReporter();
    let compilerCalls = 0;
    let writes = 0;
    const exitCode = await runTypecheckRatchet({
      baselineFile: 'baseline.json',
      readFileImpl: () => JSON.stringify({ errorCount: baseline }),
      writeFileImpl: () => { writes += 1; },
      execFileImpl: () => { compilerCalls += 1; },
      args: ['--update-baseline'],
      reporter,
    });
    assert.equal(exitCode, 1, `baseline ${JSON.stringify(baseline)} must fail`);
    assert.equal(compilerCalls, 0);
    assert.equal(writes, 0);
    assert.match(messages.warn[0], /invalid error baseline/);
  }
});

test('a missing or malformed baseline fails closed', async () => {
  const { messages, reporter } = captureReporter();
  let compilerCalls = 0;
  const exitCode = await runTypecheckRatchet({
    baselineFile: 'baseline.json',
    readFileImpl: () => '{',
    execFileImpl: () => { compilerCalls += 1; },
    reporter,
  });
  assert.equal(exitCode, 1);
  assert.equal(compilerCalls, 0);
  assert.match(messages.warn[0], /could not read a valid baseline/);
});

test('compiler launch errors and synchronous throws fail without baseline writes', async () => {
  const launchErrors = [Object.assign(new Error('missing compiler'), { code: 'ENOENT' }), Object.assign(new Error('buffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })];
  for (const error of launchErrors) {
    const result = await run({ output: `${diagnostic()}\n`, error, baseline: 3, args: ['--update-baseline'] });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.writes, []);
    assert.match(result.messages.warn[0], /Typecheck compiler|TypeScript compiler/);
  }

  const { messages, reporter } = captureReporter();
  let writes = 0;
  const thrown = await runTypecheckRatchet({
    baselineFile: 'baseline.json',
    readFileImpl: () => '{"errorCount":1}',
    writeFileImpl: () => { writes += 1; },
    execFileImpl: () => { throw Object.assign(new Error('missing compiler'), { code: 'ENOENT' }); },
    args: ['--update-baseline'],
    reporter,
  });
  assert.equal(thrown, 1);
  assert.equal(writes, 0);
  assert.match(messages.warn[0], /Could not run TypeScript compiler/);
});

test('compiler signals fail even if partial diagnostics exist', async () => {
  const result = await run({
    output: `${diagnostic()}\n`,
    error: Object.assign(new Error('terminated'), { code: null, signal: 'SIGTERM' }),
    baseline: 2,
    args: ['--update-baseline'],
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.writes, []);
  assert.match(result.messages.warn[0], /terminated by signal SIGTERM/);
});

test('nonzero compiler exit without TypeScript diagnostics fails', async () => {
  const result = await run({ output: 'fatal compiler failure\n', error: Object.assign(new Error('compiler failed'), { code: 2 }) });
  assert.equal(result.exitCode, 1);
  assert.match(result.messages.warn[0], /exited with code 2 without TypeScript diagnostics/);
});

test('unexpected nonzero compiler exit fails despite partial diagnostics', async () => {
  const result = await run({
    output: `${diagnostic()}\n`,
    error: Object.assign(new Error('compiler was killed'), { code: 137 }),
    baseline: 2,
    args: ['--update-baseline'],
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.writes, []);
  assert.match(result.messages.warn[0], /exited unexpectedly with code 137/);
});

test('nonzero compiler exit with diagnostics is judged by the diagnostic count', async () => {
  const result = await run({ output: `${diagnostic()}\n`, error: Object.assign(new Error('tsc reported errors'), { code: 2 }), baseline: 1 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.compilerCalls, 1);
  assert.deepEqual(result.messages.warn, []);
});
