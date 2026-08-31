#!/usr/bin/env node
import { PROTOCOL_VERSION } from '@commander/protocol';
import { createCommanderServer } from './server.js';
import { parseRuntimeOptions } from './services/config.js';

const options = parseRuntimeOptions(process.argv.slice(2));
if (options.parentPid !== undefined && process.ppid !== options.parentPid)
  throw new Error('Commander daemon parent does not match --parent-pid');
const server = await createCommanderServer(options);
process.stdout.write(
  `${JSON.stringify({ type: 'ready', protocolVersion: PROTOCOL_VERSION, port: server.port, url: server.url, sessionToken: server.token, nativeToken: server.nativeToken, pid: process.pid })}\n`,
);

let shutdownPromise: Promise<void> | undefined;
const shutdown = () => {
  shutdownPromise ??= server.close().finally(() => process.exit(0));
  return shutdownPromise;
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void shutdown());

if (options.parentPid !== undefined) {
  const parentPid = options.parentPid;
  const parentWatchdog = setInterval(() => {
    if (process.ppid === parentPid) return;
    clearInterval(parentWatchdog);
    void shutdown();
  }, 250);
  parentWatchdog.unref();
}
