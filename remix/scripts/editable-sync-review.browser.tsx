// Production Builder/review UI over a real IndexedDB draft; synthetic metadata
// and private layout API only. Run under the OS-isolated browser harness.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { PagedSyncConflictReview } from '../app/components/Devices/PagedSyncConflictReview';
import { createConflictReviewController } from '../app/fileSync/conflictReviewController';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import { thingtimeCapabilityManifest } from '../app/api/utils/capabilities/thingtimeCapabilities';
import type { ReviewDraftSpec } from '../app/fileSync/pagedReviewDraft';
import type { SyncEntry } from '../app/fileSync/reconcile';
const scope = { origin: location.origin, ownerId: 'editable-review-fixture', dataPlane: 'home', deviceId: 'test-device', rootId: 'test-root' };
const access = { scope, currentScope: () => scope, cleanup: 'foreground' as const };
const config = newFileSyncConfiguration({ name: 'Fixture', deviceId: scope.deviceId, localRootId: 'local', remoteFolderId: 'remote' });
const spec: ReviewDraftSpec = { id: 'editable-review', configuration: config, plan: { id: 'editable-plan',
 local: { id: 'local', generation: 'one', source: 'local' }, remote: { id: 'remote', generation: 'one', source: 'remote' },
 baseline: { local: { id: 'before-local', generation: 'one', source: 'local' }, remote: { id: 'before-remote', generation: 'one', source: 'remote' } },
 policy: { mode: 'two-way', propagateDeletes: false }, excludedPaths: [] } };
const journal = await openSyncJournal(), drafts = journal.reviewDrafts(access);
const inventory = journal.inventory(access);
for (const [i, capture] of [spec.plan.local, spec.plan.remote, spec.plan.baseline.local, spec.plan.baseline.remote].entries()) {
 const total = i < 2 ? 22 : 0;
 const entries: SyncEntry[] = Array.from({length:total}, (_,n)=>({path:`file-${String(n).padStart(2,'0')}-a-long-name-that-must-wrap-on-a-small-phone.txt`,id:`${i}-${n}`,version:'one',kind:'file',size:2,sha256:(i?'b':'a').repeat(64)}));
 await inventory.begin(capture); await inventory.append(capture,{ordinal:0,entries,totalEntries:total}); await inventory.seal(capture);
}
await journal.plans(access).build(spec.plan);
await drafts.build(spec);
let failRead = false;
const layoutKey = 'fixture-layout';
const originalFetch = window.fetch.bind(window);
window.fetch = async function(input,init) {
 const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
 init?.signal?.throwIfAborted();
 if(url.pathname.includes('thingtime-capabilities')) return Response.json(thingtimeCapabilityManifest(location.origin));
 if(url.pathname === '/api/v1/webpages/resolve') {
  const page = JSON.parse(localStorage.getItem(layoutKey) || 'null');
  return Response.json(page ? {ok:true,page,source:'user'} : {ok:false},{status:page?200:404});
 }
 if(url.pathname === '/api/v1/things' && ['POST','PATCH'].includes(init?.method || '')) {
  const input = JSON.parse(String(init?.body)); const old = JSON.parse(localStorage.getItem(layoutKey) || 'null');
  if(old && input.expectedUpdatedAt !== old.updatedAt) return Response.json({ok:false},{status:409});
  const page = {id:old?.id || input.shareId,crystal:input.crystal,acl:input.acl || old.acl,author:{id:scope.ownerId},updatedAt:new Date().toISOString()};
  localStorage.setItem(layoutKey,JSON.stringify(page));return Response.json({ok:true,thing:page});
 }
 if(url.pathname.startsWith('/api/')) return Response.json({ok:true,things:[],items:[],components:[]});
 return originalFetch(input,init);
};
function Fixture() {
 const [result,setResult] = useState('Open');
 const [controller] = useState(()=>createConflictReviewController({read:cursor=>{
  if(failRead){failRead=false;return Promise.reject(Error('Synthetic interrupted page read. Reload to recover.'));}
  return drafts.read(spec,cursor);
 }, choose:(path,from,revision)=>drafts.choose(spec,path,from,revision)},result=>{
  void (result.action === 'cancel' ? drafts.release(spec) : drafts.seal(spec,result.action,result.revision)).then(()=>setResult(result.action));
 }));
 React.useEffect(()=>{void controller.reload().catch(()=>{});},[controller]);
 return <ChakraProvider><Box maxW="760px" mx="auto" p={4}>
  <Text as="h1">Editable conflict review acceptance</Text><Text>Generated metadata; no real account or files.</Text>
  <Button onClick={()=>{failRead=true;}}>Fail next page read</Button><Text role="status">Review result: {result}</Text>
  {result === 'Open' && <PagedSyncConflictReview controller={controller} mode="two-way" scopeKey="fixture" />}
 </Box></ChakraProvider>;
}
const router = createMemoryRouter([{id:'root',path:'*',element:<Fixture/>}],{hydrationData:{loaderData:{root:{user:{id:scope.ownerId,username:'synthetic-review'},dataPlane:'home'}}}});
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>);
Object.assign(window,{reviewUIFixture:{saved:()=>drafts.read(spec),layout:()=>JSON.parse(localStorage.getItem(layoutKey)||'null')}});
