#!/usr/bin/env node
// Typecheck ratchet (TODO 15): the codebase has a known baseline of tsc
// errors (tsconfig strictness is being enabled progressively), so a plain
// `tsc --noEmit` gate would fail every PR. Instead this fails ONLY when the
// error count grows past the recorded baseline, and nags (but passes) when it
// shrinks so the baseline gets ratcheted down.
//
//   npm run typecheck:ratchet          # compare against scripts/typecheck-baseline.json
//   npm run typecheck                  # raw tsc --noEmit (all errors)
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, 'typecheck-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');

const run = () =>
  new Promise((resolve) => {
    execFile('npx', ['tsc', '--noEmit'], { cwd: join(here, '..'), maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve(`${stdout || ''}${stderr || ''}`);
    });
  });

const output = await run();
const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
const count = errors.length;
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).errorCount;

if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify({ errorCount: count }, null, 2)}\n`);
  console.log(`Baseline updated: ${baseline} → ${count} tsc errors.`);
  process.exit(0);
}

if (count > baseline) {
  console.error(`Typecheck ratchet FAILED: ${count} tsc errors vs baseline ${baseline} (+${count - baseline}).`);
  console.error('New errors are among:');
  for (const line of errors.slice(0, 40)) console.error(`  ${line}`);
  console.error('\nFix the new errors, or (only if intentional) run: node scripts/typecheck-ratchet.mjs --update-baseline');
  process.exit(1);
}

if (count < baseline) {
  console.log(`Typecheck ratchet: ${count} errors, DOWN from baseline ${baseline} 🎉`);
  console.log('Lock in the progress: node scripts/typecheck-ratchet.mjs --update-baseline');
} else {
  console.log(`Typecheck ratchet: ${count} errors, at baseline.`);
}
process.exit(0);
