import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAiProviderProbeRequest, createAiProviderProbe, AI_PROVIDER_PROBE_OK_TTL_MS } from './providerProbe';

test('Claude never builds an API-key or raw OAuth HTTP probe', () => {
  assert.equal(buildAiProviderProbeRequest('anthropic', { ANTHROPIC_API_KEY:'old-key', ANTHROPIC_AUTH_TOKEN:'old-bearer', CLAUDE_CODE_OAUTH_TOKEN:'oauth' }), null);
});
test('Claude OAuth configuration is distinct from verified model allowance', async () => {
  let calls=0;
  const probe=createAiProviderProbe({claudeToken:async()=> 'sk-ant-oat-test',fetch:async()=>{calls++;throw new Error('Must not fetch');}});
  const result=await probe.probe('anthropic');
  assert.equal(result.verified,null); assert.equal(result.status,null); assert.match(result.error!,/allowance/); assert.equal(calls,0);
});
test('missing or unreadable OAuth fails closed without API-key fallback', async () => {
  const probe=createAiProviderProbe({env:()=>({ANTHROPIC_API_KEY:'old'}),claudeToken:async()=>{throw new Error('vault unavailable');}});
  const result=await probe.probe('anthropic');assert.equal(result.verified,false);assert.match(result.error!,/OAuth/);assert.doesNotMatch(result.error!,/old/);
});
test('OpenAI probe preserves bounded GET and expiry caching', async () => {
  let calls=0,now=0,cancelled=0;
  const probe=createAiProviderProbe({env:()=>({OPENAI_API_KEY:'test'}),now:()=>now,fetch:async(url,init)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/models');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer test');
    return {status:200,body:{cancel:async()=>{cancelled++;}}};
  }});
  assert.equal((await probe.probe('openai')).verified,true);await probe.probe('openai');assert.equal(calls,1);
  now=AI_PROVIDER_PROBE_OK_TTL_MS+1;await probe.probe('openai');assert.equal(calls,2);assert.equal(cancelled,2);
});
test('OpenAI rejects bad keys and leaves unreachable providers unverified', async()=>{
  for(const [status,verified] of [[401,false],[403,false],[429,null],[500,null],[302,null]] as const){
    const result=await createAiProviderProbe({env:()=>({OPENAI_API_KEY:'secret'}),fetch:async()=>({status})}).probe('openai');
    assert.equal(result.verified,verified);assert.doesNotMatch(result.error||'',/secret/);
  }
});
test('OpenAI timeout is aborted and reported without secret data',async()=>{
  const result=await createAiProviderProbe({env:()=>({OPENAI_API_KEY:'secret'}),timeoutMs:5,fetch:async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))))}).probe('openai');
  assert.equal(result.verified,null);assert.doesNotMatch(result.error||'',/secret/);
});


test('provider-wide checks include the shared Claude OAuth vault', async () => {
  let reads = 0;
  const probe = createAiProviderProbe({env:()=>({}),claudeToken:async()=>{reads++;return 'sk-ant-oat-test';},log:()=>{}});
  const result = await probe.probeAll();
  assert.equal(reads, 1); assert.equal(result.anthropic?.verified, null);
  assert.match(result.anthropic?.error || '', /OAuth configured/);
});
