'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
async function saveAcceptanceFailure(stateRoot, phase, error) {
  try {
    if (!path.isAbsolute(stateRoot || '')) return null;
    const stat = await fs.lstat(stateRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) return null;
    const artifact = path.join(stateRoot, `failure-${randomUUID()}.json`);
    const message = value => String(value?.message || 'No diagnostic supplied').slice(-16000);
    await fs.writeFile(artifact, JSON.stringify({ time: new Date().toISOString(), phase, message: message(error),
      ...(error?.cause ? { cause: message(error.cause) } : {}) }, null, 2), { flag: 'wx', mode: 0o600 });
    return artifact;
  } catch { return null; }
}
async function reportAcceptanceFailure(stateRoot, phase, error) {
  const artifact = error?.diagnosticPath || await saveAcceptanceFailure(stateRoot, phase, error);
  console.error(`${phase} failed.${artifact ? ` Private diagnostic: ${artifact}` : ' Private diagnostic could not be saved.'}`);
  process.exitCode = 1;
}
module.exports = { saveAcceptanceFailure, reportAcceptanceFailure };
