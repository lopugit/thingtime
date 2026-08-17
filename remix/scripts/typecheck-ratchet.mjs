#!/usr/bin/env node
// Typecheck ratchet (TODO 15): tsconfig strictness is being enabled
// progressively, so the repo carries a known baseline of tsc errors and a
// plain `tsc --noEmit` gate would fail every PR. This warns (but passes) when
// the error count grows past scripts/typecheck-baseline.json, and celebrates
// when it shrinks so the baseline gets ratcheted down.
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

export const reportTypecheckRatchet = ({
  errors,
  baseline,
  githubActions = process.env.GITHUB_ACTIONS === 'true',
  reporter = console,
}) => {
  const count = errors.length;

  if (count > baseline) {
    const summary = `Typecheck ratchet WARNING: ${count} tsc errors vs baseline ${baseline} (+${count - baseline}). This check is non-blocking.`;
    reporter.warn(summary);
    if (githubActions) {
      reporter.log(`::warning title=Typecheck ratchet increased::${escapeWorkflowCommand(summary)}`);
    }
    reporter.warn('New errors are among:');
    for (const line of errors.slice(0, 40)) reporter.warn(`  ${line}`);
    reporter.warn('\nFix the new errors when practical, or update the baseline only when the increase is intentional.');
    return 0;
  }

  if (count < baseline) {
    reporter.log(`Typecheck ratchet: ${count} errors, DOWN from baseline ${baseline} 🎉`);
    reporter.log('Lock in the progress: node scripts/typecheck-ratchet.mjs --update-baseline');
  } else {
    reporter.log(`Typecheck ratchet: ${count} errors, at baseline.`);
  }
  return 0;
};

const main = async () => {
  const output = await new Promise((finish) => {
    execFile(tscBin, ['--noEmit'], { cwd: remixDir, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      finish(`${stdout || ''}${stderr || ''}`);
    });
  });

  const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
  const count = errors.length;
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).errorCount;

  if (process.argv.includes('--update-baseline')) {
    writeFileSync(baselinePath, `${JSON.stringify({ errorCount: count }, null, 2)}\n`);
    console.log(`Baseline updated: ${baseline} → ${count} tsc errors.`);
    return 0;
  }

  return reportTypecheckRatchet({ errors, baseline });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
