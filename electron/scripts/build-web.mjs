import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(electronDir, '..');
const remixDir = path.join(repoRoot, 'remix');
const stagedWebDir = path.join(electronDir, 'dist', 'web');
const stagedAiDir = path.join(electronDir, 'dist', 'ai');
const mcpDir = path.join(repoRoot, 'MCP');
const aiBundle = path.join(mcpDir, 'dist-desktop', 'desktop.mjs');
const nodeRuntimeBundle = path.join(mcpDir, 'dist-desktop', 'nodeRuntime.mjs');
const remixOutputDir = path.join(remixDir, '.output');
const desktopReleaseMetadata = {
  baseVersion: process.env.THINGTIME_ELECTRON_BASE_VERSION || null,
  buildNumber: process.env.THINGTIME_ELECTRON_BUILD_NUMBER || null,
  tag: process.env.THINGTIME_ELECTRON_RELEASE_TAG || null,
  version: process.env.THINGTIME_ELECTRON_RELEASE_VERSION || null
};

const corepackCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const pnpmExecPath = process.env.npm_execpath && process.env.npm_execpath.includes('pnpm') ? process.env.npm_execpath : null;
const pnpmRunner = pnpmExecPath
  ? /\.(?:cjs|mjs|js)$/i.test(pnpmExecPath)
    ? { command: process.execPath, args: [pnpmExecPath] }
    : { command: pnpmExecPath, args: [] }
  : { command: corepackCommand, args: ['pnpm'] };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      ...(options.env || {})
    },
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function readGitValue(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });

  return result.status === 0 ? result.stdout.trim() : null;
}

function runRemixScript(script, options = {}) {
  run(pnpmRunner.command, [...pnpmRunner.args, '--dir', remixDir, 'run', script], options);
}

await rm(stagedWebDir, { force: true, recursive: true });
await rm(stagedAiDir, { force: true, recursive: true });
await rm(remixOutputDir, { force: true, recursive: true });

runRemixScript('ensure-bcrypt');
runRemixScript('pre-dev');
runRemixScript('build:client');
runRemixScript('sync:nitro-template');
runRemixScript('build:server', {
  env: {
    NITRO_PRESET: 'node_server'
  }
});

run(pnpmRunner.command, [...pnpmRunner.args, '--dir', mcpDir, 'run', 'build:desktop']);

await mkdir(stagedWebDir, { recursive: true });
await cp(remixOutputDir, path.join(stagedWebDir, '.output'), {
  dereference: true,
  recursive: true
});
await mkdir(stagedAiDir, { recursive: true });
await cp(aiBundle, path.join(stagedAiDir, 'ai-connectors.mjs'));
await cp(nodeRuntimeBundle, path.join(stagedAiDir, 'thingtime-node-runtime.mjs'));

await writeFile(
  path.join(stagedWebDir, 'metadata.json'),
  `${JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      desktopRelease: desktopReleaseMetadata.version ? desktopReleaseMetadata : null,
      gitBranch: readGitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
      gitCommit: readGitValue(['rev-parse', '--short', 'HEAD']),
      nitroPreset: 'node_server'
    },
    null,
    2
  )}\n`
);

console.log(`Electron web bundle staged at ${path.relative(repoRoot, stagedWebDir)}`);
