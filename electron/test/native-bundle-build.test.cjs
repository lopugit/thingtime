'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../macos/ThingtimeNode/scripts/build-bundle.sh');

function fixture(t, failure, missing) {
 const parent = path.join(os.homedir(), 'Library/Caches/com.thingtime.desktop.node');
 fs.mkdirSync(parent, { recursive: true });
 const root = fs.mkdtempSync(path.join(parent, 'release-contract-'));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const commands = path.join(root, 'commands'), bins = path.join(root, 'products'), log = path.join(root, 'calls.jsonl');
 fs.mkdirSync(commands); fs.mkdirSync(bins);
 fs.mkdirSync(path.join(bins, "ThingtimeNode_ThingtimeNodeCore.bundle"));
 const source = `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2), command=path.basename(process.argv[1]);
if(command==='cargo')process.exit(0);
if(args.includes('--show-bin-path')){console.log(process.env.THINGTIME_BUILD_TEST_PRODUCTS);process.exit(0);}
const product=args[args.indexOf('--product')+1];
fs.appendFileSync(process.env.THINGTIME_BUILD_TEST_LOG,JSON.stringify({product,args})+'\\n');
if(!args.includes('--product'))process.exit(99);
if(product===process.env.THINGTIME_BUILD_TEST_FAILURE)process.exit(42);
if(product!==process.env.THINGTIME_BUILD_TEST_MISSING)fs.writeFileSync(path.join(process.env.THINGTIME_BUILD_TEST_PRODUCTS,product),'fixture',{mode:0o700});\n`;
 for (const command of ['cargo', 'swift']) fs.writeFileSync(path.join(commands, command), source, { mode: 0o700 });
 const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env,
  PATH: commands + path.delimiter + process.env.PATH, THINGTIME_NODE_CACHE_ROOT: root,
  THINGTIME_BUILD_TEST_LOG: log, THINGTIME_BUILD_TEST_PRODUCTS: bins,
  THINGTIME_BUILD_TEST_FAILURE: failure ?? '', THINGTIME_BUILD_TEST_MISSING: missing ?? '' } });
 const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
 return { result, calls, root };
}
test('a failed required shipping product stops the canonical release before any bundle replacement', t => {
 const f = fixture(t, 'ThingtimeNodeBridge');
 assert.equal(f.result.status, 42, f.result.stderr);
 assert.deepEqual(f.calls.map(c => c.product), ['ThingtimeNode', 'ThingtimeNodeBridge']);
 assert.equal(fs.existsSync(path.join(f.root, 'bundle-stage')), false);
});
test('all three shipping products are explicit and a missing executable refuses staging', t => {
 const f = fixture(t, undefined, 'ThingtimeSpeech');
 assert.equal(f.result.status, 1, f.result.stderr);
 assert.deepEqual(f.calls.map(c => c.product), ['ThingtimeNode', 'ThingtimeNodeBridge', 'ThingtimeSpeech']);
 assert.ok(f.calls.every(c => c.args.includes('release')));
 assert.equal(fs.existsSync(path.join(f.root, 'bundle-stage')), false);
});
