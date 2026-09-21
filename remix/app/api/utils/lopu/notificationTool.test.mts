import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ACL_OWNER } from '~/schemas/registry';
const saved: any[] = [];
let home = false;
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, { namedExports: {
  runWithMongoEndpoint: async (endpoint: unknown, work: any) => {
    assert.equal(endpoint, null); home = true;
    try { return await work(); } finally { home = false; }
  }
} });
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, { namedExports: {
  emitSystemNotificationOnce: async (input: any, id: string) => { assert.equal(home, true); saved.push({ input, id }); return true; }
} });
let createdThing: any;
mock.module('../things/things', { namedExports: {
 createThing: async (owner: string, input: any) => { assert.equal(owner, 'owner'); createdThing=input; return {ok:true,doc:input}; },
 toPublicThings: async (docs: any[]) => docs.map(doc => ({...doc,id:'folder-created'}))
} });
for (const path of ['../things/search','../components/browse','../webpages/webpages','../webpages/suites','../actions/execute']) mock.module(path, {namedExports:{}});
const { createLopuToolContext, runLopuTool } = await import('./chatTools');
test('notification tools use the home account and scope deduplication to each chat request', async () => {
  const viewer = { id: 'owner', username: 'owner' };
  const call = { id: 'provider-reused-id', name: 'send_notification', input: { title: 'Test', recipientId: 'other' } };
  const missing = createLopuToolContext(viewer, {}, () => {});
  assert.equal((await runLopuTool(call, missing)).ok, false); assert.equal(saved.length, 0);
  for (const requestScope of ['chat:one', 'chat:one', 'chat:two']) {
    const context = createLopuToolContext(viewer, {}, () => {}, { requestScope });
    assert.equal((await runLopuTool(call, context)).ok, true);
  }
  assert.equal(saved[0].input.recipientId, 'owner');
  assert.equal(saved[0].id, saved[1].id);
  assert.notEqual(saved[0].id, saved[2].id);
});

test('folder creation writes the canonical folder kind and parent instead of a disguised data thing', async () => {
 const context=createLopuToolContext({id:'owner',username:'owner'}, {}, () => {}, {requestScope:'folder-request'});
 const result=await runLopuTool({id:'create-folder',name:'create_thing',input:{title:'Garden',type:'folder',folderId:'parent-folder',ownerId:'other',acl:['public']}},context);
 assert.equal(result.ok,true); assert.deepEqual(createdThing,{thingtime:['folder'],crystal:{name:'Garden',icon:'📁'},folderId:'parent-folder',acl:[ACL_OWNER]});
});
