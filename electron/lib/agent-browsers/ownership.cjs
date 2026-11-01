'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// One desktop controller owns a state directory. Only a demonstrably dead
// process's lock may be recovered; ambiguity fails closed.
async function acquireOwnership(root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('The browser manager requires a private device-owned directory.');
  const file = path.join(root, 'owner.json'), identity = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, identity })); } finally { await handle.close(); }
      return { release: async () => {
        const current = JSON.parse(await fs.readFile(file, 'utf8'));
        if (current.identity === identity) await fs.unlink(file);
      } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error('The browser manager ownership record needs repair.');
      try { process.kill(previous.pid, 0); }
      catch (check) { if (check.code === 'ESRCH') { await fs.unlink(file); continue; } }
      throw new Error('Another Thingtime controller owns these browser sessions.');
    }
  }
  throw new Error('The browser manager ownership changed during startup.');
}
module.exports = { acquireOwnership };
