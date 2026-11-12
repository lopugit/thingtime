import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = readFileSync(new URL('../../../.github/workflows/ios-testflight.yml', import.meta.url), 'utf8');
const setup = workflow.split('      - name: Set up shared Rust indexer toolchain\n')[1]
  .split('\n      - name:')[0].split('        run: |\n')[1]
  .split('\n').map(line => line.replace(/^          /, '')).join('\n');

function provision({ missingCargo = false, customHomes = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'thingtime-rust-release-'));
  try {
    const bin = join(root, 'bin');
    const home = join(root, 'home');
    const cargoHome = customHomes ? join(root, 'custom cargo home') : '';
    const rustupHome = customHomes ? join(root, 'custom rustup home') : '';
    const toolchain = join(rustupHome || join(root, 'homebrew rust'), 'stable', 'bin');
    mkdirSync(bin); mkdirSync(home); mkdirSync(toolchain, { recursive: true });
    const cargo = join(toolchain, 'cargo');
    if (!missingCargo) writeFileSync(cargo, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(bin, 'rustup'), `#!/bin/sh
set -eu
test "\${CARGO_HOME-}" = "$FIXTURE_EXPECTED_CARGO_HOME"
test "\${RUSTUP_HOME-}" = "$FIXTURE_EXPECTED_RUSTUP_HOME"
printf '%s\\n' "$*" >> "$FIXTURE_CALLS"
case "$1" in
  toolchain|target) ;;
  which) printf '%s\\n' "$FIXTURE_CARGO" ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
    const environment = join(root, 'github-environment');
    const calls = join(root, 'rustup-calls');
    writeFileSync(environment, ''); writeFileSync(calls, '');
    const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, GITHUB_ENV: environment, FIXTURE_CALLS: calls, FIXTURE_CARGO: cargo, FIXTURE_EXPECTED_CARGO_HOME: cargoHome, FIXTURE_EXPECTED_RUSTUP_HOME: rustupHome };
    delete env.CARGO_HOME; delete env.RUSTUP_HOME;
    if (customHomes) { env.CARGO_HOME = cargoHome; env.RUSTUP_HOME = rustupHome; }
    const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', setup], {
      encoding: 'utf8',
      env,
    });
    return { ...result, cargo, environment: readFileSync(environment, 'utf8'), calls: readFileSync(calls, 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('release resolves executable Cargo outside HOME and provisions device and simulator targets', () => {
  const result = provision();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.environment, `THINGTIME_RUST_CARGO=${result.cargo}\nRUSTUP_TOOLCHAIN=stable\n`);
  assert.match(result.calls, /^toolchain install stable --profile minimal$/m);
  const targets = result.calls.split('\n').find(line => line.startsWith('target add '));
  assert.ok(targets, 'Rust targets must be installed before native regression tests');
  for (const target of ['aarch64-apple-ios', 'aarch64-apple-ios-sim', 'x86_64-apple-ios']) {
    assert.ok(targets.split(' ').includes(target), `Missing native target ${target}`);
  }
});

test('release preserves custom Cargo and rustup homes while resolving the selected stable executable', () => {
  const result = provision({ customHomes: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.environment, `THINGTIME_RUST_CARGO=${result.cargo}\nRUSTUP_TOOLCHAIN=stable\n`);
});

test('release refuses a nonexistent resolved Cargo before exporting the toolchain', () => {
  const result = provision({ missingCargo: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.environment, '');
});
