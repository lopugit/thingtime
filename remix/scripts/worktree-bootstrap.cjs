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

const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { resolveDevContext } = require('./worktree-ports.cjs');

const remixDir = path.resolve(__dirname, '..');

// Ignored local setup worth carrying into a worktree. Tracked files never
// appear here; node_modules is rebuilt from the store instead of copied.
const ENV_FILES = ['.env', '.env.local', 'remix/.env', 'remix/.env.local', 'remix/.env.development', 'api/.env', 'api/.env.local'];

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

const copyEnvFiles = (root, mainCheckout, log) => {
  if (!mainCheckout || mainCheckout === root) return [];
  const copied = [];
  for (const relative of ENV_FILES) {
    const source = path.join(mainCheckout, relative);
    const destination = path.join(root, relative);
    if (!existsSync(source) || existsSync(destination)) continue;
    if (git(['ls-files', '--error-unmatch', '--', relative], mainCheckout) !== undefined) continue; // tracked: never copy
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    copied.push(relative);
    log(`[bootstrap] copied ${relative} from ${mainCheckout}`);
  }
  return copied;
};

// .claude/launch.json is per-checkout tooling state (ignored): the preview
// tools read the dev server port from it, so it must carry THIS checkout's
// derived port rather than the main checkout's 9999.
const writeLaunchConfig = (root, context, log) => {
  const file = path.join(root, '.claude', 'launch.json');
  const entry = {
    name: `thingtime-web-${context.ports.web}`,
    runtimeExecutable: 'npm',
    runtimeArgs: ['--prefix', 'remix', 'run', 'dev'],
    port: context.ports.web
  };
  let existing = { version: '0.0.1', configurations: [] };
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && Array.isArray(parsed.configurations)) existing = { version: parsed.version || '0.0.1', ...parsed };
    } catch {
      /* unreadable: rewrite */
    }
  }
  // Replace every stale thingtime-web entry (other worktrees' ports copied in),
  // keep anything else the developer added.
  const kept = existing.configurations.filter((config) => !(config && typeof config.name === 'string' && /^thingtime-web-\d+$/.test(config.name)));
  const next = { ...existing, version: existing.version || '0.0.1', configurations: [entry, ...kept] };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (existsSync(file) && readFileSync(file, 'utf8') === serialized) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serialized);
  log(`[bootstrap] wrote .claude/launch.json (${entry.name})`);
  return true;
};

// Hooks are opt-in per checkout (see .githooks/README.md). An absolute
// hooksPath copied from another checkout makes every worktree run THAT
// checkout's hook files; the relative form resolves per worktree.
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
  const summary = { root: checkout.root, linked: checkout.linked, deps: false, env: [], launch: false, hooks: false };
  if (options.deps) summary.deps = relinkDependencies(checkout.root, log);
  if (options.env) summary.env = copyEnvFiles(checkout.root, checkout.mainCheckout, log);
  if (options.launch) summary.launch = writeLaunchConfig(checkout.root, context, log);
  if (options.hooks) summary.hooks = configureHooks(checkout.root, checkout.linked, log);
  log(`[bootstrap] ${checkout.linked ? 'linked worktree' : 'main checkout'} ${path.basename(checkout.root)} ready`);
  log(`[bootstrap] vite http://127.0.0.1:${context.ports.web} · nitro http://127.0.0.1:${context.ports.api} · hmr ${context.ports.hmr} · pm2 ${context.pm2NameBase}`);
  log('[bootstrap] start it with: npm run web-pms   (or: npm --prefix remix run dev)');
  return summary;
};

module.exports = { ENV_FILES, copyEnvFiles, configureHooks, describeCheckout, relinkDependencies, writeLaunchConfig };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
