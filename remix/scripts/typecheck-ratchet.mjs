#!/usr/bin/env node
// Keep the TypeScript error count from increasing beyond the recorded baseline.
//
//   npm run typecheck:ratchet                            # compare against the baseline
//   node scripts/typecheck-ratchet.mjs --update-baseline # lock in a lower count
//   npm run typecheck                                    # raw tsc --noEmit (all errors)
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const remixDir = join(here, '..');
const baselinePath = join(here, 'typecheck-baseline.json');

const tscBin = join(remixDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

const escapeWorkflowCommand = (value) => value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

// Diagnostics no baseline may absorb: a duplicate object-literal property
// (TS1117) or duplicate identifier (TS2300/TS2451) compiles to "the last one
// wins" and silently drops configuration — the way a second `serverAssets`
// key in nitro.config.ts once dropped the shell mount. These fail the run even
// while the count sits under the baseline.
export const NEVER_TOLERATED_CODES = ['TS1117', 'TS2300', 'TS2451'];

export const neverToleratedErrors = (errors) => errors.filter((line) => NEVER_TOLERATED_CODES.some((code) => line.includes(`error ${code}:`)));

export const validateBaseline = (baseline) => Number.isSafeInteger(baseline) && baseline >= 0;

const diagnosticsFrom = (output) => output.split('\n').filter((line) => /error TS\d+:/.test(line));

const compilerFailure = (error, errors) => {
  if (!error) return null;
  if (error.signal) return `TypeScript compiler was terminated by signal ${error.signal}.`;
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'TypeScript compiler output exceeded the configured buffer.';
  if (typeof error.code !== 'number') return `Could not run TypeScript compiler (${error.code || error.message || 'unknown process error'}).`;
  if (error.code !== 0 && ![1, 2].includes(error.code)) return `TypeScript compiler exited unexpectedly with code ${error.code}.`;
  if (error.code !== 0 && errors.length === 0) return `TypeScript compiler exited with code ${error.code} without TypeScript diagnostics.`;
  return null;
};

export const reportTypecheckRatchet = ({
  errors,
  baseline,
  githubActions = process.env.GITHUB_ACTIONS === 'true',
  reporter = console,
}) => {
  const count = errors.length;

  if (!validateBaseline(baseline)) {
    const summary = `Typecheck ratchet FAILED: invalid error baseline ${JSON.stringify(baseline)}; expected a non-negative safe integer.`;
    reporter.warn(summary);
    if (githubActions) reporter.log(`::error title=Typecheck ratchet invalid baseline::${escapeWorkflowCommand(summary)}`);
    return 1;
  }

  const fatal = neverToleratedErrors(errors);
  if (fatal.length) {
    const summary = `Typecheck ratchet FAILED: ${fatal.length} duplicate-property/identifier diagnostic${fatal.length === 1 ? '' : 's'} (${NEVER_TOLERATED_CODES.join(', ')}) are never tolerated — the last duplicate silently wins.`;
    reporter.warn(summary);
    if (githubActions) {
      reporter.log(`::error title=Typecheck ratchet duplicate declarations::${escapeWorkflowCommand(summary)}`);
    }
    for (const line of fatal.slice(0, 40)) reporter.warn(`  ${line}`);
    return 1;
  }

  if (count > baseline) {
    const summary = `Typecheck ratchet FAILED: ${count} tsc errors vs baseline ${baseline} (+${count - baseline}).`;
    reporter.warn(summary);
    if (githubActions) {
      reporter.log(`::error title=Typecheck ratchet increased::${escapeWorkflowCommand(summary)}`);
    }
    reporter.warn('New errors are among:');
    for (const line of errors.slice(0, 40)) reporter.warn(`  ${line}`);
    reporter.warn('\nFix the errors before updating the baseline.');
    return 1;
  }

  if (count < baseline) {
    reporter.log(`Typecheck ratchet: ${count} errors, DOWN from baseline ${baseline} 🎉`);
    reporter.log('Lock in the progress: node scripts/typecheck-ratchet.mjs --update-baseline');
  } else {
    reporter.log(`Typecheck ratchet: ${count} errors, at baseline.`);
  }
  return 0;
};

export const runTypecheckRatchet = async ({
  execFileImpl = execFile,
  readFileImpl = readFileSync,
  writeFileImpl = writeFileSync,
  command = tscBin,
  cwd = remixDir,
  baselineFile = baselinePath,
  args = process.argv.slice(2),
  githubActions = process.env.GITHUB_ACTIONS === 'true',
  reporter = console,
} = {}) => {
  let baseline;
  try {
    baseline = JSON.parse(readFileImpl(baselineFile, 'utf8')).errorCount;
  } catch (error) {
    reporter.warn(`Typecheck ratchet FAILED: could not read a valid baseline (${error.message}).`);
    return 1;
  }
  if (!validateBaseline(baseline)) {
    reporter.warn(`Typecheck ratchet FAILED: invalid error baseline ${JSON.stringify(baseline)}; expected a non-negative safe integer.`);
    return 1;
  }

  const output = await new Promise((finish) => {
    try {
      execFileImpl(command, ['--noEmit'], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
        finish({ error, output: `${stdout || error?.stdout || ''}${stderr || error?.stderr || ''}` });
      });
    } catch (error) {
      finish({ error, output: `${error?.stdout || ''}${error?.stderr || ''}` });
    }
  });

  const errors = diagnosticsFrom(output.output);
  const failure = compilerFailure(output.error, errors);
  if (failure) {
    reporter.warn(`Typecheck ratchet FAILED: ${failure}`);
    return 1;
  }
  const count = errors.length;

  if (args.includes('--update-baseline')) {
    if (neverToleratedErrors(errors).length) {
      reporter.warn('Typecheck ratchet FAILED: baseline cannot be updated while never-tolerated diagnostics are present.');
      return 1;
    }
    if (count > baseline) {
      reporter.warn(`Typecheck ratchet FAILED: refusing to increase baseline from ${baseline} to ${count}.`);
      return 1;
    }
    writeFileImpl(baselineFile, `${JSON.stringify({ errorCount: count }, null, 2)}\n`);
    reporter.log(`Baseline updated: ${baseline} → ${count} tsc errors.`);
    return 0;
  }

  return reportTypecheckRatchet({ errors, baseline, githubActions, reporter });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await runTypecheckRatchet());
}
