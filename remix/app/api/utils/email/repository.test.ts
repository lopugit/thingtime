import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomBytes,createCipheriv,createHmac} from 'node:crypto';
import {encryptOwnerValue,decryptOwnerValue,encryptOwnerValueWithKey,decryptOwnerValueWithKey} from '../auth/vaultCipher';
test('hosted email queries/outcomes stay compatible and verification links are redacted',async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks','--import','tsx',fileURLToPath(new URL('./repository.mongo.fixture.mts',import.meta.url))],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:15000,maxBuffer:16384,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
 assert.match(stdout,/hosted-email-query-contract-ok/);
});
test('explicit protected-key cipher interoperates with unchanged legacy key derivation and fences purpose/home/message',()=>{
 const key=randomBytes(32),prior=process.env.THINGTIME_USER_VAULT_KEY;process.env.THINGTIME_USER_VAULT_KEY=key.toString('base64url');
 try{
  const namespace='synthetic-native-mail:v1:',home='synthetic-home',id='synthetic-message',value='synthetic secret';
  // Construct legacy bytes independently using the original documented format.
  const derived=createHmac('sha256',key).update(namespace).digest(),iv=Buffer.alloc(12,3),cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(Buffer.from(`${namespace}${home}:${id}`));
  const old={cipherText:Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('base64url'),iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
  assert.equal(decryptOwnerValue(namespace,home,id,old),value);assert.equal(decryptOwnerValueWithKey(namespace,home,id,old,key),value);
  assert.equal(decryptOwnerValue(namespace,home,id,encryptOwnerValueWithKey(namespace,home,id,value,key)),value);
  assert.equal(decryptOwnerValueWithKey(namespace,home,id,encryptOwnerValue(namespace,home,id,value),key),value);
  for(const [purpose,owner,message,bytes] of [[namespace+'other',home,id,key],[namespace,home+'other',id,key],[namespace,home,id+'other',key],[namespace,home,id,randomBytes(32)]] as const)assert.throws(()=>decryptOwnerValueWithKey(purpose,owner,message,old,bytes));
  assert.throws(()=>encryptOwnerValueWithKey(namespace,home,id,value,new Uint8Array(31)));
 }finally{key.fill(0);if(prior===undefined)delete process.env.THINGTIME_USER_VAULT_KEY;else process.env.THINGTIME_USER_VAULT_KEY=prior;}
});
