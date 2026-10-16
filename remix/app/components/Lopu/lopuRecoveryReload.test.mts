import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let task: any;
let replies: any[] = [];
let stops: string[] = [];
let replayEvents: any[] | null = null;
const ndjson = (events: any[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';
mock.module('./aiTasks.client', { namedExports: {
 bindAiTaskOwner: () => {}, getAiTasks: () => [task], refreshAiTasks: async () => {}, stopAiTaskRequest: async (id: string) => { stops.push(id); },
 readAiTaskOutput: async () => ({task, output:ndjson(replayEvents ?? [
  {type:'meta',chatId:'chat',requestId:task.requestId,userMessageId:'user'},
  {type:'done',assistantMessageId:'saved',stopReason:'error',continuationSafe:true,recoveryFailures:task.failures}
 ])})
}});
const {getLopuStoreSnapshot, bindLopuApi, hydrateLopuStore, loadLopuChats, recoverLopuBackgroundTasks, resetLopuStoreForTests, resumeLopuChat, sendLopuMessage, selectLopuChat, abortLopuTurn} = await import('./lopuChatStore');
const load = async (owner = 'owner') => {
 hydrateLopuStore(owner);
 bindLopuApi({
  models: async () => ({ok:true,models:[],defaults:{}}),
  chats:{list:async()=>({ok:true,chats:[{id:'chat',lopu:{management:'client'}}]}), create:async()=>({ok:true}),update:async()=>({ok:true}),delete:async()=>({ok:true})},
  messages:async()=>({ok:true,messages:[]}),
  reply:async(body:any)=>{replies.push(body);return new Response(ndjson([
   {type:'meta',chatId:'chat',requestId:body.requestId,userMessageId:'new-user'},
   {type:'done',assistantMessageId:'new-saved',stopReason:'end_turn',continuationSafe:false,recoveryFailures:0}
  ]),{headers:{'Content-Type':'application/x-ndjson'}});}
 } as any);
 await loadLopuChats();
};
const flush = () => new Promise(resolve => setImmediate(resolve));
beforeEach(() => {
 resetLopuStoreForTests(); replies = []; stops = []; replayEvents = null;
 task = {id:'task',requestId:'previous',chatId:'chat',path:'/api/v1/lopu/chats/reply',management:'client',status:'needs-attention',contentType:'application/x-ndjson',updatedAt:'1',failures:5};
});
test('saved retry limit survives independent polls, reload and account switches; manual Continue intentionally retries', async () => {
 await load(); await recoverLopuBackgroundTasks(); await flush();
 task.updatedAt = '2'; await recoverLopuBackgroundTasks(); await flush();
 resetLopuStoreForTests(); await load(); await recoverLopuBackgroundTasks(); await flush();
 await load('other'); await load('owner'); await recoverLopuBackgroundTasks(); await flush();
 assert.equal(replies.length, 0, 'no background path resets the persisted failure streak');
 assert.equal((await resumeLopuChat('chat', 'previous')).ok, true);
 assert.equal(replies.length, 1);
 assert.equal(replies[0].automaticContinuation, false);
});
test('a checkpoint below the retry limit can recover once after reload', async () => {
 task.failures=4; task.id='below-limit';
 await load(); await recoverLopuBackgroundTasks();
 for (let i=0;i<100 && (!replies[0] || getLopuStoreSnapshot().turns[replies[0].requestId]?.status !== 'done');i++) await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(replies.length,1);
 assert.equal(getLopuStoreSnapshot().turns[replies[0].requestId]?.status,'done');
 assert.equal(replies[0].automaticContinuation,true);
});
test('browser recovery never starts a server-managed checkpoint', async () => {
 task.failures=1; task.management='server'; task.id='server';
 await load(); await recoverLopuBackgroundTasks(); await flush();
 assert.equal(replies.length,0);
});

test('account switch while the continuation id is hashing prevents stale dispatch', async () => {
 await load();
 let release!: (value:ArrayBuffer)=>void;
 const gate = new Promise<ArrayBuffer>(resolve=>{release=resolve;});
 const digest = mock.method(crypto.subtle,'digest',()=>gate);
 try {
  const pending = resumeLopuChat('chat','previous');
  await load('other');
  release(new ArrayBuffer(32));
  assert.equal((await pending).ok,false);
  assert.equal(replies.length,0);
  assert.deepEqual(getLopuStoreSnapshot().turns,{});
 } finally {digest.mock.restore();}
});


for (const management of ['client', 'server']) {
 for (const hasMeta of [true, false]) {
  test(`stopped ${management} recovery with ${hasMeta ? 'persisted' : 'missing'} message identity stays idle after polling and reload without an empty user bubble`, async () => {
   const { buildLopuTimeline } = await import('./lopuTurnCore');
   const { canContinueLopuReply, shouldAutoContinueLopuReply } = await import('./lopuRecovery');
   task = { ...task, id: `stopped-${management}-${hasMeta}`, status: 'stopped', workflowStatus: management === 'server' ? 'stopped' : null, management };
   replayEvents = [
    ...(hasMeta ? [{ type: 'meta', chatId: 'chat', requestId: task.requestId, userMessageId: 'outside-loaded-history' }] : []),
    { type: 'done', assistantMessageId: 'saved-stop', stopReason: 'aborted', continuationSafe: false, recoveryFailures: 0 }
   ];
   for (let reload = 0; reload < 2; reload++) {
    if (reload) resetLopuStoreForTests();
    await load();
    for (let poll = 0; poll < 2; poll++) {
     task.updatedAt = `${reload}-${poll}`;
     await recoverLopuBackgroundTasks(); await flush();
     const state = getLopuStoreSnapshot();
     const turn = state.turns[task.requestId];
     assert.ok(turn);
     assert.equal(shouldAutoContinueLopuReply(turn), false);
     assert.equal(canContinueLopuReply(turn.status, turn.stopReason), true, 'manual Retry remains available');
     const items = buildLopuTimeline(state.messages.chat || [], [turn], 'owner');
     assert.deepEqual(items.map(item => item.kind), ['turn'], 'recovery retains its terminal assistant control without fabricating user content');
     assert.equal(replies.length, 0, 'polling and reload never resume a manually stopped task');
    }
   }
  });
 }
}

for (const path of ['/api/v1/lopu/musing', '/api/v1/ai/complete', '/api/v1/lopu/chats/reply']) {
 test(`a task without a chat ID (${path}) cannot block a fresh chat's first message`, async () => {
  await load(); selectLopuChat(null);
  task = { ...task, chatId: null, path, status: 'running' };
  assert.equal((await sendLopuMessage('Hello from a new chat')).ok, true);
  assert.equal(replies.length, 1, 'the first message reaches the reply client');
 });
 test(`Stop in a fresh chat does not cancel a task without a chat ID (${path})`, async () => {
  await load(); selectLopuChat(null);
  task = { ...task, chatId: null, path, status: 'running' };
  abortLopuTurn(); await flush();
  assert.deepEqual(stops, [], 'Stop in a fresh chat must not stop unrelated work');
 });
}
for (const state of [{status: 'running'}, {status: 'completed', workflowStatus: 'running'}]) {
 test(`a real chat task still prevents duplicate sends (${JSON.stringify(state)})`, async () => {
  await load(); selectLopuChat('chat');
  task = { ...task, ...state };
  assert.equal((await sendLopuMessage('Do not duplicate')).ok, false);
  assert.equal(replies.length, 0);
  abortLopuTurn(); await flush();
  assert.deepEqual(stops, [task.requestId]);
 });
}
