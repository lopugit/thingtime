import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { accountBackupSandbox, verifyAccountBackupIsolation } from '../../remix/scripts/account-backup-isolation.mjs';
// Source: node electron/scripts/test-resource-transfer-process.mjs
// Final bundle: pass --electron <bundle executable> --module-root <Resources/app.asar>
// and --run-as-node-verified ONLY after read-only Electron fuse inspection confirms
// RunAsNode is enabled. Without that confirmation custom binaries are never run:
// a fused-off binary could ignore ELECTRON_RUN_AS_NODE and launch the real app.
const args=process.argv.slice(2), value=key=>{const at=args.indexOf(key);return at<0?undefined:args[at+1];};
const root=resolve(import.meta.dirname,'..'),require=createRequire(resolve(root,'package.json'));
const custom=value('--electron');
assert.ok(!custom||args.includes('--run-as-node-verified'),'Refusing custom executable until its RunAsNode fuse has been verified enabled.');
const executable=custom?resolve(custom):require('electron'),moduleRoot=resolve(value('--module-root')||root),port=28731;
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR||'/tmp',ELECTRON_RUN_AS_NODE:'1',TT_RESOURCE_MODULE_ROOT:moduleRoot,TT_RESOURCE_FIXTURE_PORT:String(port)};
await verifyAccountBackupIsolation(port,env);
const child=spawn('/usr/bin/sandbox-exec',['-p',accountBackupSandbox(port,true),executable,resolve(root,'test/fixtures/resource-transfer-process.cjs')],{env,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const timer=setTimeout(()=>child.kill('SIGTERM'),20000);let code;
try{[code]=await once(child,'exit');}finally{clearTimeout(timer);}
assert.equal(code,0,'Isolated task-owned transfer process failed; no real app or source was used.');
assert.ok(output.includes('RESOURCE_TRANSFER_PROCESS_VERIFIED'),'Transfer process did not verify PUT, GET, hash, aggregate rates and cancellation.');
console.log('RESOURCE_TRANSFER_PROCESS_VERIFIED');
