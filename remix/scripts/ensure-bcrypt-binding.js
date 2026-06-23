#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const loadBcrypt = () => {
  try {
    require('bcrypt');
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
};

const initial = loadBcrypt();
if (initial.ok) {
  process.exit(0);
}

let packageDir;
try {
  packageDir = path.dirname(require.resolve('bcrypt/package.json'));
} catch (err) {
  console.warn('[bcrypt] bcrypt is not installed yet; skipping native binding check.');
  process.exit(0);
}

console.warn('[bcrypt] Native binding is missing or invalid; running bcrypt install script.');
console.warn(`[bcrypt] ${initial.err?.message || initial.err}`);

const install = spawnSync(npmBin, ['run', 'install'], {
  cwd: packageDir,
  stdio: 'inherit'
});

if (install.status !== 0) {
  process.exit(install.status || 1);
}

delete require.cache[require.resolve('bcrypt')];
const repaired = loadBcrypt();
if (!repaired.ok) {
  console.error('[bcrypt] Native binding repair completed, but bcrypt still cannot load.');
  console.error(repaired.err?.message || repaired.err);
  process.exit(1);
}

console.log('[bcrypt] Native binding is available.');
