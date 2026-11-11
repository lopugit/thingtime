import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { installNativeHome } from './native-home.mjs';
const symbol=Symbol.for('thingtime.native.home-profile.v1');
const fixture=()=>({format:1,provider:'sqlite',profileId:'4f145990-a5f8-469c-b0c8-9b43a11d875f',keyId:'6f145990-a5f8-469c-b0c8-9b43a11d875f',homePlaneId:'native-sqlite:4f145990-a5f8-469c-b0c8-9b43a11d875f',origin:'http://127.0.0.1:29741',sqliteFile:'/synthetic/accounts.sqlite',jwt:randomBytes(32).toString('base64url'),vault:randomBytes(32).toString('base64url'),outbox:randomBytes(32).toString('base64url')});
const options=()=>({origin:'http://127.0.0.1:29741',root:'/synthetic',env:{},target:{}});
test('actual bootstrap installs immutable private descriptor and retires protected copies',()=>{
 const p=fixture(), bytes=Buffer.from(JSON.stringify(p)),o=options(),close=installNativeHome(bytes,o);
 assert(bytes.every(x=>x===0));const host=o.target[symbol];assert(Object.isFrozen(host));
 assert.equal(Object.keys(o.target).length,0);assert.equal(Object.keys(host).includes('protectedKeys'),false);
 assert.equal(o.env.JWT_SECRET,p.jwt);assert.equal(o.env.THINGTIME_USER_VAULT_KEY,p.vault);
 const keys=host.protectedKeys();keys.vault.fill(0);assert.equal(host.protectedKeys().vault.toString('base64url'),p.vault);
 assert.throws(()=>installNativeHome(Buffer.from(JSON.stringify(p)),o));close();assert.throws(()=>host.protectedKeys());assert.deepEqual(o.env,{});
});
test('wrong origin/path, malformed keys and unknown fields refuse before installation',()=>{
 for(const mutation of [p=>p.origin='http://127.0.0.1:29742',p=>p.sqliteFile='/foreign/accounts.sqlite',p=>p.jwt='broken',p=>p.selector='remote']){
  const p=fixture(),o=options();mutation(p);assert.throws(()=>installNativeHome(Buffer.from(JSON.stringify(p)),o));assert.equal(o.target[symbol],undefined);assert.deepEqual(o.env,{});
 }
});
test('private inherited pipe consumes and closes the bootstrap descriptor',async()=>{
 const { spawn }=await import('node:child_process');
 const script=`import fs from 'node:fs';import assert from 'node:assert/strict';import {readNativeHome} from ${JSON.stringify(new URL('./native-home.mjs',import.meta.url).href)};const retire=readNativeHome(3,{origin:'http://127.0.0.1:29741',root:'/synthetic'});assert.throws(()=>fs.fstatSync(3),{code:'EBADF'});assert.equal(globalThis[Symbol.for('thingtime.native.home-profile.v1')].protectedKeys().jwt.length,32);retire();process.stdout.write('passed');`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe','pipe'],env:{}});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 child.stdio[3].end(JSON.stringify(fixture()));
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(result,0,stderr);assert.equal(stdout,'passed');
});
