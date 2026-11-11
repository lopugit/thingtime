import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('eight real-file canonical native vault/security regressions run with disposable process-only crypto configuration',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'thingtime-native-vault-process-'));
 try{
  const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','--test',fileURLToPath(new URL('./nativeVault.crypto.fixture.mts',import.meta.url))],{
   cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:90000,maxBuffer:65536,
   env:{PATH:process.env.PATH,HOME:directory,TMPDIR:directory,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),JWT_ISSUER:'http://127.0.0.1:19761',THINGTIME_USER_VAULT_KEY:randomBytes(32).toString('base64url')}
  });
  assert.match(stdout,/tests 8/);assert.match(stdout,/pass 8/);assert.match(stdout,/fail 0/);
 }finally{await rm(directory,{recursive:true,force:true});}
});


test('hosted secure CAS and conditional session vault persistence retain exact Mongo contracts without native imports',async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks','--import','tsx',fileURLToPath(new URL('./nativeVault.mongo.fixture.mts',import.meta.url))],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:30000,maxBuffer:16384});
 assert.match(stdout,/hosted-vault-mongo-shapes-ok/);
});
