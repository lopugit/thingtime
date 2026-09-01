#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageFiles = [
  'package.json',
  'apps/daemon/package.json',
  'apps/desktop-ui/package.json',
  'packages/filesystem-indexer/package.json',
  'packages/protocol/package.json',
  'packages/raycast-compat/package.json',
];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function usage() {
  console.error('usage: release-version.mjs <check|bump> [patch|minor|major|X.Y.Z]');
  process.exitCode = 2;
}

function nextVersion(version, requested) {
  if (versionPattern.test(requested)) return requested;

  const [major, minor, patch] = version.split('.').map(Number);
  switch (requested) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`expected patch, minor, major, or X.Y.Z; received ${requested}`);
  }
}

async function readPackages() {
  return Promise.all(
    packageFiles.map(async (relativePath) => {
      const absolutePath = resolve(root, relativePath);
      const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
      if (typeof parsed.version !== 'string' || !versionPattern.test(parsed.version)) {
        throw new Error(`${relativePath} must use a plain X.Y.Z version`);
      }
      return { absolutePath, relativePath, parsed };
    }),
  );
}

const [command, requested] = process.argv.slice(2);
if (command !== 'check' && command !== 'bump') {
  usage();
} else {
  try {
    const packages = await readPackages();
    const versions = [...new Set(packages.map(({ parsed }) => parsed.version))];
    if (versions.length !== 1) {
      throw new Error(
        `Commander package versions must match; found ${packages
          .map(({ relativePath, parsed }) => `${relativePath}=${parsed.version}`)
          .join(', ')}`,
      );
    }

    if (command === 'check') {
      if (requested) usage();
      else console.log(versions[0]);
    } else if (!requested) {
      usage();
    } else {
      const version = nextVersion(versions[0], requested);
      await Promise.all(
        packages.map(async ({ absolutePath, parsed }) => {
          parsed.version = version;
          await writeFile(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`);
        }),
      );
      console.log(version);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
