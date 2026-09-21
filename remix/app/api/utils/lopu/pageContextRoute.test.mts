import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let savedText = '', providerContext: any, writes = 0, savedContinuation = false, savedMeta: any, stopReason = 'fallback', events: any[] = [], allowContinuation = true;
const ok = async () => ({ ok: true });
mock.module('../rateLimit/enforce', { namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({status:429}) } });
mock.module('../ai/models', { namedExports: { listAiModels: async () => ({ models: [], defaults: {} }), resolveLopuModelChoice: ok } });
mock.module('./access', { namedExports: { assertLopuAccess: async () => ({ok:true}), billingForProvider: ()=>'free', lopuAccessResponse: ()=>new Response('',{status:403}), resolveLopuBilling: ()=>'free' } });
mock.module('./accounting', { namedExports: { debitLopuUsage: async () => ({ok:true,costMicros:0,priced:false,balanceMicros:0}) } });
mock.module('./chatMedia.server', { namedExports: { resolveLopuMedia: async () => ({text:'',media:[]}) } });
mock.module('./chatAttachments', { namedExports: { lopuReferenceIds: () => [], resolveLopuThingReferences: async () => [], lopuReferenceContext: () => '' } });
mock.module('./chat', { namedExports: {
 hasLopuChatProviderConfigured: ()=>false, lopuChatProviderMode: ()=>'fallback',
 streamLopuChatTurn: async function* (input: any) { providerContext = input.context; yield {type:'meta',chatId:input.chatId,userMessageId:input.userMessageId,requestId:input.requestId}; for (const event of events) yield event; yield {type:'delta',text:'Checked'}; return {text:'Checked',stopReason,provider:'fallback',toolCalls:[],usage:null}; }
} });
mock.module('../messenger/lopuChats', { namedExports: {
 readLopuContinuation: async () => allowContinuation ? {ok:true,meta:savedMeta ?? {}} : {ok:false,status:409,error:'Newer work'},
 createLopuNoteReader: () => async () => [],
 createLopuChat: async () => ({ok:true,chat:{id:'test-chat'}}), deleteLopuChat:ok,
 getLopuChat:async()=>({ok:true,settings:{}}), loadLopuHistory:async()=>({ok:true,history:[]}), updateLopuChat:ok,
 persistLopuUserTurn:async (_owner: string, input: any)=>{ writes++; savedText=input.text; savedContinuation=input.continuation; return {ok:true,message:{id:'user-message'}}; },
 persistLopuAssistantTurn:async(_owner: string, input: any)=>{ savedMeta=input.lopu; return {ok:true,messages:[{id:'assistant-message'}]}; }
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

const { continuationRequestId, LOPU_CONTINUE_PROMPT } = await import('./continuationCore');
test('actual reply route hides only explicit continuations and refuses replay inputs', async () => {
 const requestId = await continuationRequestId('test-chat', 'previous');
 const input = {chatId:'test-chat',requestId,continueFromRequestId:'previous',automaticContinuation:true,text:'ignored'};
 const send = (extra: any = {}) => replyAsUser(new Request('https://thingtime.test/api/v1/lopu/chats/reply', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,...extra})}), viewer);
 let response = await send(); assert.equal(response.status,200);
 const output = await response.text();
 assert.match(output, /"continuation":true/); assert.equal(savedContinuation,true); assert.equal(savedText,LOPU_CONTINUE_PROMPT);
 response = await send({requestId:'different'}); assert.equal(response.status,400);
 response = await send({context:{page:{id:'page',blocks:[]}}}); assert.equal(response.status,400);
 allowContinuation=false; response=await send(); assert.equal(response.status,409); allowContinuation=true;
});
test('route persists explicit safe errors but blocks unfinished tools, confirmations and unsaved pages', async () => {
 stopReason='error';
 for (const [toolEvents,context,safe] of [
  [[],undefined,true],
  [[{type:'tool_use_start',id:'write',name:'create_thing'}],undefined,false],
  [[{type:'tool_use',id:'write',name:'create_thing',input:{}},{type:'tool_result',id:'write',name:'create_thing',ok:false,summary:'Confirm',needsConfirmation:true}],undefined,false],
  [[],{page:{blocks:[]}},false],
  [[{type:'tool_use',id:'read',name:'search_things',input:{}},{type:'tool_result',id:'read',name:'search_things',ok:true,summary:'Saved'}],undefined,true]
 ] as any[]) {
  events=toolEvents; const response=await replyAsUser(request(context),viewer); await response.text(); assert.equal(savedMeta.continuationSafe,safe);
 }
 events=[]; stopReason='fallback';
});

test('automatic requests inherit persisted error streak while explicit Continue resets it', async () => {
 events = []; stopReason = 'error'; savedMeta = undefined;
 let response = await replyAsUser(request(undefined), viewer);
 await response.text();
 assert.equal(savedMeta.recoveryFailures, 1);
 let previousRequestId = 'page-context-test';
 const send = async (automaticContinuation: boolean) => {
  const requestId = await continuationRequestId('test-chat', previousRequestId);
  const response = await replyAsUser(new Request('https://thingtime.test/api/v1/lopu/chats/reply', {
   method: 'POST', headers: {'Content-Type':'application/json'},
   body: JSON.stringify({chatId:'test-chat', requestId, continueFromRequestId:previousRequestId, automaticContinuation, text:'continue'})
  }), viewer);
  previousRequestId = requestId;
  assert.equal(response.status, 200);
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'done');
 };
 for (let count = 2; count <= 5; count++) {
  const done = await send(true);
  assert.equal(done.recoveryFailures, count);
  assert.equal(savedMeta.recoveryFailures, count);
 }
 assert.equal((await send(false)).recoveryFailures, 1, 'manual Continue starts a fresh bounded streak');
 stopReason = 'checkpoint';
 assert.equal((await send(true)).recoveryFailures, 0, 'successful progress resets the error streak');
 stopReason = 'fallback';
});
