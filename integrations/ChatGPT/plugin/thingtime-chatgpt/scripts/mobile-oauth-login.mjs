#!/usr/bin/env node
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.THINGTIME_ORIGIN || 'https://thingtime.com';
const relayUrl = new URL('/api/v1/integrations/chatgpt/oauth/relay', origin);

const reservePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startRelay = async () => {
  const response = await fetch(relayUrl, { method: 'POST', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Thingtime relay start failed (${response.status})`);
  const payload = await response.json();
  if (!payload || typeof payload.callbackUrl !== 'string' || typeof payload.pollToken !== 'string') throw new Error('Thingtime relay returned an invalid response');
  return payload;
};

const maybeWriteQr = async (authUrl) => {
  if (spawnSync('qrencode', ['--version'], { stdio: 'ignore' }).status !== 0) return null;
  const directory = await mkdtemp(join(tmpdir(), 'thingtime-mobile-login-'));
  const path = join(directory, 'thingtime-login.png');
  const result = spawnSync('qrencode', ['-o', path, '-s', '8', authUrl], { encoding: 'utf8' });
  return result.status === 0 ? path : null;
};

const relayToCodex = async ({ callbackUrl, port, response }) => {
  const callback = new URL(callbackUrl);
  callback.protocol = 'http:';
  callback.hostname = '127.0.0.1';
  callback.port = String(port);
  callback.searchParams.set('code', response.code);
  callback.searchParams.set('state', response.state);
  callback.searchParams.set('iss', response.iss);
  const delivered = await fetch(callback, { redirect: 'manual' });
  if (delivered.status >= 500) throw new Error(`Codex callback rejected the mobile handoff (${delivered.status})`);
};

const main = async () => {
  const relay = await startRelay();
  const port = await reservePort();
  const callbackConfig = `mcp_oauth_callback_url=${JSON.stringify(relay.callbackUrl)}`;
  const portConfig = `mcp_oauth_callback_port=${port}`;
  const child = spawn('codex', ['mcp', 'login', '-c', callbackConfig, '-c', portConfig, 'thingtime'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let printed = false;
  const observe = async (chunk) => {
    output += chunk.toString();
    const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = output.match(new RegExp(`${escapedOrigin}/api/v1/integrations/chatgpt/oauth/authorize\\?[^\\s]+`));
    if (!match || printed) return;
    printed = true;
    const authUrl = match[0];
    const qrPath = await maybeWriteQr(authUrl);
    console.log(`THINGTIME_MOBILE_LOGIN_URL=${authUrl}`);
    if (qrPath) console.log(`THINGTIME_MOBILE_LOGIN_QR=${qrPath}`);
    console.log('Open the one-time URL on mobile (or scan the QR), finish the Thingtime form, then keep this command running until it reports success.');
  };
  child.stdout.on('data', observe);
  child.stderr.on('data', observe);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (!printed && Date.now() < deadline && child.exitCode === null) await wait(100);
  if (!printed) throw new Error(`Codex did not provide an OAuth URL: ${output.slice(-200)}`);
  while (Date.now() < deadline && child.exitCode === null) {
    const poll = await fetch(`${relayUrl}?handoff=${encodeURIComponent(relay.handoffId)}`, { headers: { 'x-thingtime-oauth-relay-token': relay.pollToken, accept: 'application/json' } });
    if (!poll.ok) throw new Error(`Thingtime relay poll failed (${poll.status})`);
    const payload = await poll.json();
    if (payload.status === 'complete') {
      await relayToCodex({ callbackUrl: relay.callbackUrl, port, response: payload.response });
      break;
    }
    await wait(1200);
  }
  if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
  if (child.exitCode !== 0) throw new Error(`Codex MCP login exited with ${child.exitCode}`);
};

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
