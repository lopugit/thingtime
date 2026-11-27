import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareBrowserPasskeyRegistration} from './browserPasskey';
import {ensureBrowserProvider, runProviderCeremony, type ProviderRequest} from './browserProviderCeremony';

test('AppID client negotiates both current origin and active API before any vault access', async () => {
  const origin='https://appid-capability.test';
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'window',{value:{location:{origin}},configurable:true,writable:true});
  let activeVersion='1.9.0',vaultCalls=0;const urls:string[]=[];
  globalThis.fetch=async input=>{const url=String(input);urls.push(url);return Response.json(url.endsWith('/api/v1/capabilities')?{ok:true,schemaVersion:1,features:{'api.passwords':activeVersion}}:{schemaVersion:1,origin,features:{'api.passwords':{version:'1.9.1'}}});};
  const request:ProviderRequest={version:1,id:crypto.randomUUID(),type:'get',origin:'https://site.example.com',publicKey:{challenge:'AQID',rpId:'example.com',extensions:{appid:'https://example.com/legacy'}}};
  try {
    await assert.rejects(runProviderCeremony(request,'',null,async()=>{vaultCalls++;throw Error('vault boundary');},new AbortController().signal),/incompatible/);
    assert.equal(vaultCalls,0);
    activeVersion='1.9.1';await ensureBrowserProvider(new AbortController().signal,request);
    assert.deepEqual(urls,['/.well-known/thingtime-capabilities.json',origin+'/api/v1/capabilities',origin+'/api/v1/capabilities']);
    const registration=await prepareBrowserPasskeyRegistration({type:'create',origin:request.origin,publicKey:{challenge:'AQID',rp:{id:'example.com',name:'Fixture'},user:{id:'BAUG',name:'fixture',displayName:'Fixture'},pubKeyCredParams:[{type:'public-key',alg:-7}]}},true,[]);
    const selection={id:'selected',relyingParty:'example.com',credentialId:registration.response.id};
    const attempt={};let calls=0;
    const vault=async(body:Record<string,any>)=>{calls++;return body.operation==='verify-passkey'?{verified:true,requestId:request.id,sessionBinding:'A'.repeat(43)}:{id:'selected',revision:1,entry:registration.entry};};
    const response=await runProviderCeremony(request,'',selection,vault,new AbortController().signal,attempt);
    assert.deepEqual(response.clientExtensionResults,{appid:false});assert.equal(calls,3);
    request.publicKey.extensions={appid:'https://site.example.com/changed'};
    await assert.rejects(runProviderCeremony(request,'',selection,vault,new AbortController().signal,attempt),/request changed/);
    assert.equal(calls,3,'A changed AppID must not reuse request/session authority or read the vault again');

  }finally{globalThis.fetch=previousFetch;Object.defineProperty(globalThis,'window',{value:previousWindow,configurable:true,writable:true});}
});
