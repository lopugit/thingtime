#!/usr/bin/env node

import { spawn } from 'node:child_process';

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
