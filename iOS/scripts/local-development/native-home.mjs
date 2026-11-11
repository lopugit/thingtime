// Private native bootstrap: no renderer, URL, configuration-file or env key selector.
import fs from 'node:fs';
import path from 'node:path';
const HOST=Symbol.for('thingtime.native.home-profile.v1');
const refused=()=>{throw new Error('Protected native account profile unavailable');};
export function installNativeHome(bytes,{origin,root,env=process.env,target=globalThis}){
 let payload;
 try{payload=JSON.parse(bytes.toString('utf8'));}catch{refused();}finally{bytes.fill(0);}
 const fields=['format','provider','profileId','homePlaneId','origin','sqliteFile','keyId','jwt','vault','outbox'];
 if(!payload||Object.keys(payload).length!==fields.length||fields.some(key=>!Object.hasOwn(payload,key)))refused();
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
 if(payload.format!==1||payload.provider!=='sqlite'||!uuid(payload.profileId)||!uuid(payload.keyId)||payload.homePlaneId!=='native-sqlite:'+payload.profileId||payload.origin!==origin||payload.sqliteFile!==path.join(root,'accounts.sqlite')||!path.isAbsolute(root)||path.resolve(root)!==root||Object.getOwnPropertyDescriptor(target,HOST))refused();
 const keys={};
 try{
  for(const name of ['jwt','vault','outbox']){if(typeof payload[name]!=='string')refused();const key=Buffer.from(payload[name],'base64url');keys[name]=key;if(key.length!==32||key.toString('base64url')!==payload[name])refused();}
  const host=Object.fromEntries(fields.slice(0,7).map(key=>[key,payload[key]]));
  let closed=false;
  Object.defineProperty(host,'protectedKeys',{enumerable:false,value:()=>{if(closed)refused();return Object.fromEntries(Object.entries(keys).map(([name,key])=>[name,Buffer.from(key)]));}});
  Object.freeze(host);
  env.JWT_SECRET=keys.jwt.toString('base64url');env.THINGTIME_USER_VAULT_KEY=keys.vault.toString('base64url');
  Object.defineProperty(target,HOST,{value:host,enumerable:false,configurable:false,writable:false});
  return ()=>{closed=true;for(const key of Object.values(keys))key.fill(0);delete env.JWT_SECRET;delete env.THINGTIME_USER_VAULT_KEY;};
 }catch(error){for(const key of Object.values(keys))key.fill(0);throw error;}
 finally{for(const name of ['jwt','vault','outbox'])delete payload[name];}
}
export function readNativeHome(fd,options){
 if(!Number.isSafeInteger(fd)||fd<3)refused();
 let bytes;
 try{bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
 return installNativeHome(bytes,options);
}
