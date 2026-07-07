#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveDevContext } = require('./worktree-ports.cjs');

const parseEnvValue = (value) => {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);

    if (quote === '"') {
      return unquoted
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
    }

    return unquoted;
  }

  return trimmed;
};

const loadLocalEnv = () => {
  const parsed = {};

  for (const file of ['.env', '.env.local', '.env.auto']) {
    if (!existsSync(file)) {
      continue;
    }

    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

      if (match) {
        parsed[match[1]] = parseEnvValue(match[2]);
      }
    }
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

loadLocalEnv();

const devContext = resolveDevContext(process.cwd());

process.env.TT_WEB_PORT = String(devContext.ports.web);
process.env.TT_HMR_PORT = String(devContext.ports.hmr);
process.env.TT_API_PORT = String(devContext.ports.api);

console.log(
  `[dev] ${devContext.worktree ? `worktree ${devContext.worktree}` : 'main checkout'}: ` +
    `vite :${devContext.ports.web} (hmr :${devContext.ports.hmr}), nitro :${devContext.ports.api}`
);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'dev:nitro'], { stdio: 'inherit' }),
  spawn(npmCommand, ['run', 'dev:vite'], { stdio: 'inherit' })
];

let shuttingDown = false;

const stopChildren = (signal = 'SIGTERM') => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopChildren(signal));
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    stopChildren(signal || 'SIGTERM');
    process.exit(code || 0);
  });
}
