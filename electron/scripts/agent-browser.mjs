#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const [method, ...options] = process.argv.slice(2);
const usage = 'Usage: node agent-browser.mjs <manifest|status|claim|renew|launch|browser|release> --socket <absolute path> [--lease-file <absolute path>]. Send JSON parameters on stdin.';
if (method === '--help' || method === '-h') { process.stdout.write(usage + '\n'); process.exit(0); }
const option = name => { const index = options.indexOf(name); return index < 0 ? undefined : options[index + 1]; };
const socketPath = option('--socket'), leaseFile = option('--lease-file');
if (!method || !socketPath || !path.isAbsolute(socketPath) || (leaseFile && !path.isAbsolute(leaseFile))) {
  throw new Error(usage);
}
let input = '';
for await (const chunk of process.stdin) input += chunk;
const params = input.trim() ? JSON.parse(input) : {};
if (method === 'claim' && !leaseFile) throw new Error('Claims require --lease-file so the private handle is never printed.');
if (['renew', 'launch', 'browser', 'release'].includes(method)) {
  if (!leaseFile) throw new Error('Supply the claim’s private --lease-file.');
  const stat = await fs.lstat(leaseFile);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('The lease file must be private and owned by this device user.');
  const lease = JSON.parse(await fs.readFile(leaseFile, 'utf8'));
  if (lease.socketPath !== socketPath) throw new Error('This claim belongs to a different browser manager.');
  params.leaseId = lease.id; params.token = lease.token;
}
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = randomUUID();
  const socket = net.createConnection(socketPath);
  const timer = setTimeout(() => { socket.destroy(); reject(new Error('The browser request timed out. Inspect status before retrying a mutation.')); }, method === 'launch' ? 390000 : 150000);
  const done = (error, value) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
  socket.once('error', error => done(error));
  socket.once('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
  readline.createInterface({ input: socket, crlfDelay: Infinity }).on('line', line => {
    try {
      const response = JSON.parse(line);
      if (response.id === id) done(response.error ? new Error(response.error) : null, response.result);
    } catch { done(new Error('The browser manager returned an invalid response.')); }
  });
});
if (method === 'claim') {
  const exists = await fs.lstat(leaseFile).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (exists) throw new Error('That lease file already exists. Inspect its claim before choosing a different path.');
}
const result = await rpc(method, params);
if (method === 'claim') {
  // Exclusive creation prevents replacing another agent’s lease handle.
  try { await fs.writeFile(leaseFile, JSON.stringify({ ...result, socketPath }), { mode: 0o600, flag: 'wx' }); }
  catch {
    const released = await rpc('release', { leaseId: result.id, token: result.token }).then(() => true, () => false);
    throw new Error(released ? 'The lease file could not be saved. The unused claim was released.' : 'The lease file could not be saved and cleanup failed. Inspect this task in the desktop manager before retrying.');
  }
  const { token, ...publicResult } = result;
  process.stdout.write(JSON.stringify(publicResult) + '\n');
} else {
  if (method === 'release') await fs.rm(leaseFile);
  process.stdout.write(JSON.stringify(result) + '\n');
}
