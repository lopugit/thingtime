#!/usr/bin/env node
'use strict';

// One-step bootstrap for a fresh (or stale) checkout, especially a linked git
// worktree created by Claude Code, Codex or `git worktree add`:
//
//   1. relink remix dependencies from the shared pnpm store (ensure-dependencies)
//   2. copy ignored local env files the main checkout has and this one lacks
//   3. write .claude/launch.json with this checkout's derived dev ports
//   4. point core.hooksPath at the tracked .githooks for THIS worktree only
//   5. print the derived ports, PM2 name and local URLs
//
// Idempotent: rerunning changes nothing except refreshing launch.json. Nothing
// here is ever overwritten — an existing env file or foreign launch entry wins.
//
//   npm run worktree-bootstrap             # everything
//   npm run worktree-bootstrap -- --no-env # skip env copying
//   node remix/scripts/worktree-bootstrap.cjs --quiet --no-deps
//
// The tracked .githooks/post-checkout runs this automatically (in the
// background) the first time a linked worktree is checked out without deps.
// ensure-dependencies holds an install lock, so that background run and a
// developer's own `npm run worktree-setup` never write node_modules at once.

const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { resolveDevContext } = require('./worktree-ports.cjs');

// The list of ignored local setup worth carrying into a worktree is the root
// `.worktreeinclude` (what Codex-managed worktrees copy). Only its env-file
// entries apply here — never node_modules or generated build state, which the
// bootstrap rebuilds instead. This fallback covers checkouts without the file.
const DEFAULT_ENV_FILES = ['.env', '.env.local', 'remix/.env', 'remix/.env.local', 'remix/.env.development', 'api/.env', 'api/.env.local'];

const LAUNCH_VERSION = '0.0.1';

const readEnvFileList = (root) => {
  const file = path.join(root, '.worktreeinclude');
  if (!existsSync(file)) return DEFAULT_ENV_FILES;
  const entries = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.endsWith('/'))
    .filter((line) => /^\.env(\.|$)/.test(path.posix.basename(line)));
  return entries.length ? entries : DEFAULT_ENV_FILES;
};

const parseArgs = (argv) => {
  const options = { deps: true, env: true, launch: true, hooks: true, quiet: false, cwd: process.cwd() };
  for (const arg of argv) {
    if (arg === '--no-deps') options.deps = false;
    else if (arg === '--no-env') options.env = false;
    else if (arg === '--no-launch') options.launch = false;
    else if (arg === '--no-hooks') options.hooks = false;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg.startsWith('--cwd=')) options.cwd = path.resolve(arg.slice('--cwd='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: worktree-bootstrap.cjs [--no-deps] [--no-env] [--no-launch] [--no-hooks] [--quiet] [--cwd=<checkout>]');
      process.exit(0);
    }
  }
  return options;
};

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return undefined;
  }
};

// Resolve the checkout root and, for linked worktrees, the main checkout that
// owns the shared .git directory (the source of ignored env files).
const describeCheckout = (cwd) => {
  const root = git(['rev-parse', '--show-toplevel'], cwd);
  if (!root) throw new Error(`Not inside a git checkout: ${cwd}`);
  const gitDir = path.resolve(root, git(['rev-parse', '--git-dir'], root) || '.git');
  const commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir'], root) || '.git');
  const linked = gitDir !== commonDir;
  return { root, linked, mainCheckout: linked ? path.dirname(commonDir) : null };
};

const relinkDependencies = (root, log) => {
  const script = path.join(root, 'remix', 'scripts', 'ensure-dependencies.js');
  if (!existsSync(script)) {
    log('[bootstrap] remix/scripts/ensure-dependencies.js is missing; skipping dependency relink');
    return false;
  }
  const result = spawnSync(process.execPath, [script, '--tool=eslint', '--tool=prettier'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('[bootstrap] dependency relink failed');
  return true;
};

const copyEnvFiles = (root, mainCheckout, log, envFiles = readEnvFileList(root)) => {
  if (!mainCheckout || mainCheckout === root) return [];
  const copied = [];
  // one `git ls-files` for the whole list: tracked paths are never copied
  const tracked = new Set((git(['ls-files', '--', ...envFiles], mainCheckout) || '').split('\n').filter(Boolean));
  for (const relative of envFiles) {
    const source = path.join(mainCheckout, relative);
    const destination = path.join(root, relative);
    if (tracked.has(relative) || !existsSync(source) || existsSync(destination)) continue;
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    copied.push(relative);
    log(`[bootstrap] copied ${relative} from ${mainCheckout}`);
  }
  return copied;
};

// .claude/launch.json is per-checkout tooling state (ignored): the preview
// tools read the dev server from it, so it must carry THIS checkout's derived
// port rather than the main checkout's 9999. Two entries:
//   thingtime-web-<port>            attaches to the PM2-managed stack (url only)
//   thingtime-web-<port>-foreground owns a fresh `npm --prefix remix run dev`
// The PM2 stack binds the derived ports, so the foreground entry only starts
// cleanly while that stack is stopped (Vite is strictPort); attach otherwise.
const launchEntries = (context) => [
  { name: `thingtime-web-${context.ports.web}`, url: `http://127.0.0.1:${context.ports.web}` },
  {
    name: `thingtime-web-${context.ports.web}-foreground`,
    runtimeExecutable: 'npm',
    runtimeArgs: ['--prefix', 'remix', 'run', 'dev'],
    port: context.ports.web
  }
];

const writeLaunchConfig = (root, context, log) => {
  const file = path.join(root, '.claude', 'launch.json');
  let existing = { version: LAUNCH_VERSION, configurations: [] };
  let current = null;
  if (existsSync(file)) {
    current = readFileSync(file, 'utf8');
    try {
      const parsed = JSON.parse(current);
      if (parsed && Array.isArray(parsed.configurations)) existing = { version: LAUNCH_VERSION, ...parsed };
    } catch {
      /* unreadable: rewrite */
    }
  }
  // Replace every stale thingtime-web entry (other worktrees' ports copied in),
  // keep anything else the developer added.
  const kept = existing.configurations.filter((config) => !(config && typeof config.name === 'string' && /^thingtime-web-\d+(-foreground)?$/.test(config.name)));
  const serialized = `${JSON.stringify({ ...existing, configurations: [...launchEntries(context), ...kept] }, null, 2)}\n`;
  if (current === serialized) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serialized);
  log(`[bootstrap] wrote .claude/launch.json (thingtime-web-${context.ports.web} attach + -foreground)`);
  return true;
};

// Hooks are opt-in per checkout (see .githooks/README.md). An absolute
// hooksPath copied from another checkout makes every worktree run THAT
// checkout's hook files; the relative form resolves per worktree. Git already
// resolves a relative shared value per worktree, so the per-worktree override
// is only written when the effective value is not the relative one.
const configureHooks = (root, linked, log) => {
  const current = git(['config', '--get', 'core.hooksPath'], root);
  if (current === '.githooks') return false;
  const scope = linked ? ['--worktree'] : [];
  const result = spawnSync('git', ['config', ...scope, 'core.hooksPath', '.githooks'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    log(`[bootstrap] could not set core.hooksPath${linked ? ' (enable extensions.worktreeConfig or run npm run install-git-hooks)' : ''}`);
    return false;
  }
  log(`[bootstrap] core.hooksPath -> .githooks${current ? ` (was ${current})` : ''}`);
  return true;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const log = options.quiet ? () => {} : (message) => console.log(message);
  const checkout = describeCheckout(options.cwd);
  const context = resolveDevContext(path.join(checkout.root, 'remix'));
  if (options.deps) relinkDependencies(checkout.root, log);
  if (options.env) copyEnvFiles(checkout.root, checkout.mainCheckout, log);
  if (options.launch) writeLaunchConfig(checkout.root, context, log);
  if (options.hooks) configureHooks(checkout.root, checkout.linked, log);
  log(`[bootstrap] ${checkout.linked ? 'linked worktree' : 'main checkout'} ${path.basename(checkout.root)} ready`);
  log(`[bootstrap] vite http://127.0.0.1:${context.ports.web} · nitro http://127.0.0.1:${context.ports.api} · hmr ${context.ports.hmr} · pm2 ${context.pm2NameBase}`);
  log('[bootstrap] start it with: npm run web-pms   (or: npm --prefix remix run dev)');
};

module.exports = { DEFAULT_ENV_FILES, copyEnvFiles, configureHooks, describeCheckout, launchEntries, readEnvFileList, relinkDependencies, writeLaunchConfig };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
