'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { canonical, safePath, validateDescriptor } = require('./release.cjs');
async function inventoryDirectory(root) {
  const result = [];
  async function walk(relative) {
    const location = relative ? path.join(root, ...relative.split('/')) : root;
    if (relative) safePath(relative);
    const stat = await fs.lstat(location);
    if (stat.isSymbolicLink()) throw new Error('Native bundle contains a symbolic link');
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(location)).sort()) await walk(relative ? `${relative}/${entry}` : entry);
      return;
    }
    safePath(relative);
    if (!stat.isFile()) throw new Error('Native bundle contains a nonregular file');
    // A regular file can become a FIFO after lstat. Nonblocking open lets
    // fstat reject that substitution without waiting for a pipe writer.
    const handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('Native bundle changed during verification');
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += chunk.length; }
      const after = await handle.stat();
      if (bytes !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('Native bundle changed during verification');
      result.push({ path: relative, bytes, sha256: hash.digest('hex') });
    } finally { await handle.close(); }
  }
  await walk('');
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
async function verifyDirectory(root, descriptor) {
  validateDescriptor(descriptor);
  if (canonical(await inventoryDirectory(root)) !== canonical(descriptor.files)) throw new Error('Native bundle file inventory mismatch');
  return true;
}
module.exports = { inventoryDirectory, verifyDirectory };
