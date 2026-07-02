#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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
