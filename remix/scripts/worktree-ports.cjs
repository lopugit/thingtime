#!/usr/bin/env node
'use strict';

// Single source of truth for local dev ports and the PM2 dev app name.
// Main checkout keeps the canonical 9999 (vite) / 9998 (hmr) / 10000 (nitro).
// Linked git worktrees get a deterministic port trio derived from the
// worktree directory name, so several worktree stacks can run beside the
// main PM2-managed stack without colliding.
// Explicit TT_WEB_PORT / TT_HMR_PORT / TT_API_PORT env vars always win.

const { execSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_PORTS = { web: 9999, hmr: 9998, api: 10000 };
const DEFAULT_PM2_NAME = 'tt-nitro-react-router-9999';
// Worktree slots are 10 ports apart inside 11000-19890, clear of the
// canonical dev ports and common tooling ports.
const WORKTREE_PORT_BASE = 11000;
const WORKTREE_PORT_SLOTS = 890;

const git = (args, cwd) => {
  try {
    return execSync(`git ${args}`, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
};

const getWorktreeName = (dir = __dirname) => {
  const gitDir = git('rev-parse --git-dir', dir);
  const gitCommonDir = git('rev-parse --git-common-dir', dir);

  if (!gitDir || !gitCommonDir) {
    return undefined;
  }

  if (path.resolve(dir, gitDir) === path.resolve(dir, gitCommonDir)) {
    return undefined;
  }

  const toplevel = git('rev-parse --show-toplevel', dir);

  return toplevel ? path.basename(toplevel) : undefined;
};

// FNV-1a: deterministic, so a worktree keeps the same ports across restarts.
const hashSlot = (name) => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash % WORKTREE_PORT_SLOTS;
};

const worktreePorts = (worktreeName) => {
  const base = WORKTREE_PORT_BASE + hashSlot(worktreeName) * 10;

  return { web: base, hmr: base + 1, api: base + 2 };
};

const envPort = (name) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);

  return Number.isInteger(value) && value > 0 ? value : undefined;
};

const resolveDevContext = (dir = __dirname) => {
  const worktree = getWorktreeName(dir);
  const defaults = worktree ? worktreePorts(worktree) : DEFAULT_PORTS;
  const ports = {
    web: envPort('TT_WEB_PORT') ?? defaults.web,
    hmr: envPort('TT_HMR_PORT') ?? defaults.hmr,
    api: envPort('TT_API_PORT') ?? defaults.api
  };

  return {
    worktree,
    ports,
    pm2Name: worktree ? `tt-wt-${worktree}-${ports.web}` : DEFAULT_PM2_NAME
  };
};

module.exports = { DEFAULT_PORTS, getWorktreeName, resolveDevContext };

if (require.main === module) {
  const context = resolveDevContext(process.cwd());
  const flag = process.argv[2];
  const output =
    flag === '--pm2-name'
      ? context.pm2Name
      : flag === '--web-port'
        ? String(context.ports.web)
        : flag === '--api-port'
          ? String(context.ports.api)
          : JSON.stringify(context, null, 2);

  process.stdout.write(`${output}\n`);
}
