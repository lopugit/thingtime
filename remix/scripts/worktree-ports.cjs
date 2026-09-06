#!/usr/bin/env node
'use strict';

// Single source of truth for local dev ports, the PM2 dev app name, and the
// full PM2 app definition.
// Main checkout keeps the canonical 9999 (vite) / 9998 (hmr) / 10000 (nitro).
// Linked git worktrees get a deterministic port trio derived from the
// worktree directory name, so several worktree stacks can run beside the
// main PM2-managed stack without colliding.
// Explicit TT_WEB_PORT / TT_HMR_PORT / TT_API_PORT env vars always win.
//
// Ports are deterministic (a pure hash of the worktree name) so a stack keeps
// the same ports across restarts. The PM2 *name* additionally carries a
// clock-time suffix (e.g. -1005am) so `pm2 list` shows when each app was last
// started; the stable base (pm2NameBase) is what start/stop match on for
// cleanup, so re-stamping the time never orphans the previous process.

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

const pad2 = (value) => String(value).padStart(2, '0');

// 12-hour clock, colon-free so it is safe in PM2 log filenames: 10:05 -> 1005am.
const formatClock = (now) => {
  const minutes = now.getMinutes();
  const meridiem = now.getHours() < 12 ? 'am' : 'pm';
  const hour12 = now.getHours() % 12 || 12;

  return `${pad2(hour12)}${pad2(minutes)}${meridiem}`;
};

// The clock-time suffix shape appended to every dev app name.
const CLOCK_SUFFIX = /-\d{3,4}(?:am|pm)$/;

// A thingtime dev app by name (for display/listing) — prefix match so it
// still matches once the clock suffix is appended (tt-nitro-react-router-9999
// or tt-nitro-react-router-9999-1005am, tt-wt-<worktree>-<port>-1005am, ...).
const isDevAppName = (name) => /^(?:tt-nitro-react-router-|tt-wt-)/.test(name);

// Whether a running app belongs to a specific stable base — the base itself,
// or the base plus exactly a clock suffix. Anchoring on the clock shape (not a
// bare `-` prefix) stops a worktree base from matching a sibling whose
// directory name merely starts with it (e.g. `foo` vs `foo-11500-bar`).
const isDevAppForBase = (name, base) =>
  name === base ||
  (name.startsWith(`${base}-`) && /^\d{3,4}(?:am|pm)$/.test(name.slice(base.length + 1)));

const resolveDevContext = (dir = __dirname, opts = {}) => {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const worktree = getWorktreeName(dir);
  const defaults = worktree ? worktreePorts(worktree) : DEFAULT_PORTS;
  const ports = {
    web: envPort('TT_WEB_PORT') ?? defaults.web,
    hmr: envPort('TT_HMR_PORT') ?? defaults.hmr,
    api: envPort('TT_API_PORT') ?? defaults.api
  };
  // The base is the stable identity used for start/stop cleanup, so it must be
  // a pure function of the worktree name — use the deterministic default port,
  // never the TT_WEB_PORT-overridable ports.web (which would let an override
  // orphan the previous app instead of replacing it).
  const pm2NameBase = worktree ? `tt-wt-${worktree}-${defaults.web}` : DEFAULT_PM2_NAME;

  return {
    worktree,
    ports,
    pm2NameBase,
    pm2Name: `${pm2NameBase}-${formatClock(now)}`
  };
};

// The full PM2 app definition, shared by ecosystem.config.js and dev-pm2.cjs
// so there is one source of truth for how a dev app is launched.
const pm2AppConfig = (remixDir = __dirname, opts = {}) => {
  const context = resolveDevContext(remixDir, opts);

  return {
    // Canonical PM2 form (script + args) rather than a single 'npm run dev'
    // string; the latter only works via PM2's non-Windows bash -c fallback.
    script: 'npm',
    args: 'run dev',
    cwd: remixDir,
    name: context.pm2Name,
    namespace: 'thingtime',
    autorestart: false,
    watch: ['ecosystem.config.js'],
    env: {
      TT_WEB_PORT: String(context.ports.web),
      TT_HMR_PORT: String(context.ports.hmr),
      TT_API_PORT: String(context.ports.api)
    }
  };
};

module.exports = {
  CLOCK_SUFFIX,
  DEFAULT_PORTS,
  formatClock,
  getWorktreeName,
  isDevAppForBase,
  isDevAppName,
  pm2AppConfig,
  resolveDevContext
};

if (require.main === module) {
  const context = resolveDevContext(process.cwd());
  const flag = process.argv[2];
  const output =
    flag === '--pm2-name'
      ? context.pm2Name
      : flag === '--pm2-name-base'
        ? context.pm2NameBase
        : flag === '--web-port'
          ? String(context.ports.web)
          : flag === '--api-port'
            ? String(context.ports.api)
            : JSON.stringify(context, null, 2);

  process.stdout.write(`${output}\n`);
}
