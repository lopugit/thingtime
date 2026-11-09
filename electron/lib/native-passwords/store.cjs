'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fail } = require('./contract.cjs');

async function requireWindowsAcl(file) {
  if (process.platform !== 'win32') return;
  const scripts = __dirname.split(path.sep).includes('app.asar') ? process.resourcesPath : path.resolve(__dirname, '../../scripts');
  const { requirePrivateWindowsPath } = require(path.join(scripts, 'password-agent-acl.cjs'));
  try { await requirePrivateWindowsPath(file); }
  catch (error) { fail('UNSAFE_STORAGE', error.message); }
}
async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) fail('UNSAFE_STORAGE', 'The password bridge needs a private device-user directory.');
  await requireWindowsAcl(directory);
}
async function privateRead(file) {
  if (process.platform === 'win32') {
    await fs.lstat(file); // Preserve ENOENT for the initial encrypted-state read.
    await requireWindowsAcl(file);
  }
  const handle = await fs.open(file, require('node:fs').constants.O_RDONLY | (require('node:fs').constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) fail('UNSAFE_STORAGE', 'The password bridge storage is not private.');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function privateWrite(file, value) {
  await privateDirectory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await requireWindowsAcl(temporary);
      await handle.writeFile(value);
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}
class PasswordBridgeStore {
  constructor({ directory, safeStorage, platform = process.platform }) { this.directory = directory; this.file = path.join(directory, 'state.enc'); this.safeStorage = safeStorage; this.platform = platform; }
  available() {
    try { return this.safeStorage.isEncryptionAvailable() && (this.platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(this.safeStorage.getSelectedStorageBackend())); }
    catch { return false; }
  }
  requireAvailable() { if (!this.available()) fail('KEYRING_UNAVAILABLE', 'Unlock or configure the operating-system keyring, then reconnect. Plaintext storage is not supported.'); }
  async read() {
    this.requireAvailable();
    try {
      const value = JSON.parse(this.safeStorage.decryptString(await privateRead(this.file)));
      if (value?.version !== 1 || !value.pending || typeof value.pending !== 'object' || Array.isArray(value.pending)) throw new Error();
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, connection: null, pending: {} };
      fail('STORAGE_UNAVAILABLE', 'The encrypted password bridge state could not be opened. Existing data was preserved.');
    }
  }
  async write(value) {
    this.requireAvailable();
    await privateWrite(this.file, this.safeStorage.encryptString(JSON.stringify(value)));
  }
}
module.exports = { PasswordBridgeStore, privateDirectory, privateRead, privateWrite };
