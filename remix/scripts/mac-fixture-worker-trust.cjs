'use strict';
// Preload only in the disposable fixture process. The shipping launcher remains
// unchanged; only its exact canonical transfer-worker fork gains this test CA.
const childProcess = require('node:child_process');
const { resolve, relative, isAbsolute } = require('node:path');
const { lstatSync, realpathSync } = require('node:fs');
const ca = process.env.THINGTIME_FIXTURE_CA_FILE, root = process.env.THINGTIME_FIXTURE_TLS_ROOT;
if (!ca && !root) return; // An unrelated child may inherit the preload, never trust.
if (!ca || !root || !isAbsolute(ca) || !isAbsolute(root)) throw Error('Fixture worker trust requires explicit task-owned TLS paths');
const actualRoot = realpathSync(root), actualCA = realpathSync(ca), rel = relative(actualRoot, actualCA);
if (!rel || rel.startsWith('..') || isAbsolute(rel) || lstatSync(ca).isSymbolicLink() || !lstatSync(ca).isFile() ||
    (lstatSync(actualRoot).mode & 0o077) || (lstatSync(actualCA).mode & 0o077)) throw Error('Fixture TLS material must remain inside its private task directory');
// Remove only fixture loaders (and eval, as Node's ordinary fork already does).
// Preserve any other runtime/security arguments rather than weakening them.
const workerExecArgv = [];
for (let i = 0; i < process.execArgv.length; i++) {
  const arg = process.execArgv[i], next = process.execArgv[i + 1];
  if ((['--require', '-r'].includes(arg) && next && resolve(next) === __filename) ||
      (arg === '--import' && next === 'tsx') || ['-e', '--eval'].includes(arg)) { i++; continue; }
  workerExecArgv.push(arg);
}
const worker = resolve(__dirname, '../../electron/lib/folder-transfer-worker.cjs'), fork = childProcess.fork;
childProcess.fork = function(modulePath, args, options) {
  if (typeof modulePath === 'string' && resolve(modulePath) === worker && Array.isArray(args) && options?.env?.ELECTRON_RUN_AS_NODE === '1' &&
      options.serialization === 'advanced' && Object.keys(options.env).every(key => ['PATH', 'ELECTRON_RUN_AS_NODE'].includes(key))) {
    return fork.call(this, modulePath, args, { ...options, execArgv: workerExecArgv, env: { ...options.env, NODE_EXTRA_CA_CERTS: actualCA } });
  }
  return fork.apply(this, arguments);
};
