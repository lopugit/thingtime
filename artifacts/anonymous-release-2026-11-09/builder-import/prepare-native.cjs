const fs = require('node:fs');
const { createRequire } = require('node:module');
const root = '/home/pwuser/qa', target = root + '/server/node_modules/bcrypt', saved = root + '/bcrypt-original';
const load = createRequire(root + '/server/index.mjs');
const native = '/opt/thingtime-qa-native/node_modules/bcrypt';
const bcrypt = load(native + '/package.json').version;
const hash = load(native);
if (bcrypt !== '6.0.0' || !hash.compareSync('task-native-check', hash.hashSync('task-native-check', 4))) throw Error('Bundled Linux bcrypt verification failed');
(async () => {
 fs.renameSync(target, saved);
 try {
  const prepared = await require('/opt/thingtime-browser/prepare-native.cjs').prepareNative(root, '/opt/thingtime-browser');
  console.log(JSON.stringify({ bcrypt: { version: bcrypt, source: 'current compiled trace with bundled Linux arm64 prebuild' }, otherLinuxPackages: prepared }));
 } finally { fs.renameSync(saved, target); }
 fs.rmSync(target, { recursive: true });
 fs.symlinkSync(native, target, 'dir');
 if (!load('bcrypt').compareSync('compiled-trace', hash.hashSync('compiled-trace', 4))) throw Error('Trace bcrypt resolution failed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
