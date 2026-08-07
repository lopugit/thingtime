#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const remixDir = path.resolve(__dirname, '..');
const manifestPath = path.join(remixDir, 'package.json');
const corepackBin = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

const directDependencyNames = () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  return [
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {}),
    ...Object.keys(manifest.optionalDependencies || {})
  ].sort();
};

const packageManifestPath = (dependencyName) =>
  path.join(remixDir, 'node_modules', ...dependencyName.split('/'), 'package.json');

const missingDirectDependencies = () =>
  directDependencyNames().filter((dependencyName) => !existsSync(packageManifestPath(dependencyName)));

const summarize = (dependencyNames) => {
  const shown = dependencyNames.slice(0, 8);
  const suffix =
    dependencyNames.length > shown.length
      ? `, and ${dependencyNames.length - shown.length} more`
      : '';

  return `${shown.join(', ')}${suffix}`;
};

const runInstall = ({ force = false } = {}) => {
  const args = [
    'pnpm',
    'install',
    '--frozen-lockfile',
    '--prefer-offline',
    ...(force ? ['--force'] : [])
  ];
  const result = spawnSync(corepackBin, args, {
    cwd: remixDir,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' }
  });

  if (result.error) {
    throw new Error(
      `[deps] Could not run ${corepackBin}: ${result.error.message}. ` +
        'Install or enable Corepack, then re-run the command.'
    );
  }

  if (result.status !== 0) {
    throw new Error(`[deps] pnpm install failed with exit code ${result.status || 1}.`);
  }
};

const ensureDependencies = ({ checkOnly = false, quiet = false } = {}) => {
  let missing = missingDirectDependencies();

  if (!missing.length) {
    if (!quiet && checkOnly) {
      console.log('[deps] All direct Remix dependencies are linked.');
    }
    return;
  }

  if (checkOnly) {
    throw new Error(`[deps] Missing or broken dependency links: ${summarize(missing)}`);
  }

  console.log(
    `[deps] Missing or broken dependency links (${summarize(missing)}); ` +
      'repairing with pnpm install --prefer-offline…'
  );
  runInstall();
  missing = missingDirectDependencies();

  if (missing.length) {
    console.warn(
      `[deps] Links are still incomplete (${summarize(missing)}); ` +
        'retrying once with pnpm install --force…'
    );
    runInstall({ force: true });
    missing = missingDirectDependencies();
  }

  if (missing.length) {
    throw new Error(
      `[deps] Dependency repair finished, but links are still missing: ${summarize(missing)}`
    );
  }

  console.log('[deps] Remix dependencies are ready.');
};

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  const quiet = process.argv.includes('--quiet');

  try {
    ensureDependencies({ checkOnly, quiet });
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  directDependencyNames,
  ensureDependencies,
  missingDirectDependencies
};
