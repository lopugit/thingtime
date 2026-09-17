import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let savedText = '', providerContext: any, writes = 0;
const ok = async () => ({ ok: true });
mock.module('../rateLimit/enforce', { namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({status:429}) } });
mock.module('../ai/models', { namedExports: { listAiModels: async () => ({ models: [], defaults: {} }), resolveLopuModelChoice: ok } });
mock.module('./access', { namedExports: { assertLopuAccess: async () => ({ok:true}), billingForProvider: ()=>'free', lopuAccessResponse: ()=>new Response('',{status:403}), resolveLopuBilling: ()=>'free' } });
mock.module('./accounting', { namedExports: { debitLopuUsage: async () => ({ok:true,costMicros:0,priced:false,balanceMicros:0}) } });
mock.module('./chatMedia.server', { namedExports: { resolveLopuMedia: async () => ({text:'',media:[]}) } });
mock.module('./chatAttachments', { namedExports: { lopuReferenceIds: () => [], resolveLopuThingReferences: async () => [], lopuReferenceContext: () => '' } });
mock.module('./chat', { namedExports: {
 hasLopuChatProviderConfigured: ()=>false, lopuChatProviderMode: ()=>'fallback',
 streamLopuChatTurn: async function* (input: any) { providerContext = input.context; yield {type:'text',delta:'Checked'}; return {text:'Checked',stopReason:'fallback',provider:'fallback',toolCalls:[],usage:null}; }
} });
mock.module('../messenger/lopuChats', { namedExports: {
 createLopuChat: async () => ({ok:true,chat:{id:'test-chat'}}), deleteLopuChat:ok,
 getLopuChat:async()=>({ok:true,settings:{}}), loadLopuHistory:async()=>({ok:true,history:[]}), updateLopuChat:ok,
 persistLopuUserTurn:async (_owner: string, input: any)=>{ writes++; savedText=input.text; return {ok:true,message:{id:'user-message'}}; },
 persistLopuAssistantTurn:async()=>({ok:true,messages:[{id:'assistant-message'}]})
} });
const { replyAsUser } = await import('../../../routes/api/v1/lopu/chats/reply/_reply.tsx');
const viewer = {id:'test-owner',username:'context-test',temporary:false} as any;
const request = (context: unknown) => new Request('https://thingtime.test/api/v1/lopu/chats/reply', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Review these pages',requestId:'page-context-test',context})});
test('actual reply route validates references before writes and forwards/persists sanitized pages', async () => {
 for (const pages of [[{url:'//evil.test'}], [{url:'/invite#secret'}], Array.from({length:11},()=>({url:'/feed'}))]) {
  const response = await replyAsUser(request({pages}),viewer);
  assert.equal(response.status,400); assert.equal(writes,0);
 }
 const response = await replyAsUser(request({pages:[{url:'/feed?token=secret',title:'Feed'}]}),viewer);
 assert.equal(response.status,200);
 const stream = await response.text();
 assert.match(stream,/"type":"done"/);
 assert.match(stream,/"assistantMessageId":"assistant-message"/);
 assert.equal(stream.includes('"type":"error"'),false);
 assert.deepEqual(providerContext, {pages:[{url:'/feed',title:'Feed'}]});
 assert.equal(savedText,'Review these pages\n\nAttached pages:\nFeed: /feed');
 assert.equal(savedText.includes('secret'),false);
 const noPage = await replyAsUser(request({viewport:'desktop'}),viewer);
 await noPage.text();
 assert.deepEqual(providerContext,{viewport:'desktop'});
 assert.equal(savedText,'Review these pages');
});
