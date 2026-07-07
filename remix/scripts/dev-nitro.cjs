#!/usr/bin/env node
'use strict';

// Starts nitro dev on the port resolved by worktree-ports.cjs, so direct
// `npm run dev:nitro` runs stay worktree-aware without hardcoded ports.

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const { resolveDevContext } = require('./worktree-ports.cjs');

const { ports } = resolveDevContext(process.cwd());
const localBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'nitro.cmd' : 'nitro'
);
const nitroCommand = existsSync(localBin) ? localBin : 'nitro';

const child = spawn(nitroCommand, ['dev', '--host', '127.0.0.1', '--port', String(ports.api)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    TT_WEB_PORT: String(ports.web),
    TT_HMR_PORT: String(ports.hmr),
    TT_API_PORT: String(ports.api)
  }
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
