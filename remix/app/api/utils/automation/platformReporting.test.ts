import { runWithHomeMongoEndpoint, runWithMongoEndpoint, getActiveMongoEndpoint } from '../mongodb/endpoint';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformReporting, PLATFORM_REPORTING_SETTINGS_KEY, platformReportingPostId } from './platformReporting';
import { SCHEDULED_HTTP_JOBS, type ScheduledRunEvent } from './scheduledRunReporting';
import { validateThingtimeCrystal } from '~/schemas/registry';
import { createPlatformReportingRoute } from '~/routes/api/v1/admin/platform-reporting/_platform-reporting';
const event:ScheduledRunEvent={runId:'12345678-1234-4234-9234-123456789012',jobName:SCHEDULED_HTTP_JOBS[0].name,path:SCHEDULED_HTTP_JOBS[0].path,status:'completed',httpCode:200,startedAt:'2026-11-15T00:00:00Z',observedAt:'2026-11-15T00:01:00Z'};
const input={enabled:true,ownerId:'owner',characterId:'character',groupId:'group',groupOwnerId:'admin',revision:null};
function fixture(realHome=false){
 let row:any=null,groups=[{id:'group'}],creates=0,beforeCreate:(()=>Promise<void>)|undefined;let denyFence=false;
 const posts=new Map<string,any>();
 const users:any={admin:{_id:'admin',meta:{admin:true}},owner:{_id:'owner'},character:{_id:'character',meta:{character:{ownerId:'owner',loginMode:'switch',disabled:false}}}};
 const homeCalls:any[]=[];
 const api=createPlatformReporting({
  settings:async()=>({findOne:async()=>row,updateOne:async(filter:any,update:any)=>{
   if(update.$inc?.platformReportFence)return {matchedCount:row?.revision===filter.revision&&row?.enabled===true?1:0};
   if(update.$set?.lastReport){if(row)row={...row,lastReport:update.$set.lastReport};return {matchedCount:1};}
   assert.equal(filter.key,PLATFORM_REPORTING_SETTINGS_KEY);
   if((row?.revision??null)!==filter.revision)return {matchedCount:0,upsertedCount:0};
   row={...row,...update.$set};return {matchedCount:1};
  }}),
  findUser:async(id)=>{assert.equal(getActiveMongoEndpoint(),null);return users[id]},ownsAccount:async(actor,owner)=>actor==='admin'&&owner==='owner',groups:async()=>({ok:true,groups}),
  home:(realHome?runWithHomeMongoEndpoint:((fn:any)=>{homeCalls.push(null);return fn();})) as any,
  fenceUser:async(id,predicate)=>!denyFence&&predicate(users[id]),fenceLink:async()=>!denyFence,fenceGroup:async()=>!denyFence,
  create:(async(ownerId:any,data:any,_viewer:any,_app:any,hooks:any)=>{
   creates++; assert.equal(ownerId,'character');
   if(beforeCreate)await beforeCreate();
   if(hooks?.afterInsert)await hooks.afterInsert({},{});
   const valid=validateThingtimeCrystal(data.thingtime,data.crystal); assert.equal(valid.ok,true,JSON.stringify(valid));
   posts.set(data.shareId,{...data,crystal:valid.ok?valid.crystal:data.crystal,acl:[...data.acl].reverse(),ownerId});return {ok:true,doc:posts.get(data.shareId)};
  }) as any,
  read:(async(id:any)=>posts.get(id)??null) as any
 });
 return {api,users,posts,homeCalls,get creates(){return creates},setGroups:(next:any)=>{groups=next;},beforeCreate:(fn:()=>Promise<void>)=>{beforeCreate=fn;},denyFence:()=>{denyFence=true;}};
}
test('configuration is revision-fenced, owner-authorized and read back safely',async()=>{
 const f=fixture(); assert.equal(await f.api.getConfig(),null);
 const saved=await f.api.setConfig('admin',input); assert.equal(saved.ok,true);
 if(!saved.ok)throw Error('failed');
 assert.equal(saved.config.updatedBy,'admin');assert.equal(saved.config.enabled,true);
 assert.equal((await f.api.setConfig('admin',input)).ok,false);
 assert.equal((await f.api.setConfig('stranger',{...input,revision:saved.config.revision})).ok,false);
 assert.ok(f.homeCalls.every(selection=>selection===null));
});
test('exact post identity provides idempotent retry with private ACL and explicit render definition',async()=>{
 const f=fixture();assert.equal((await f.api.setConfig('admin',input)).ok,true);
 const first=await f.api.report(event),second=await f.api.report({...event});
 assert.deepEqual(first,second);assert.equal(first.status,'recorded');assert.equal(f.creates,1);
 const post=f.posts.get(platformReportingPostId(event));
 assert.deepEqual([...post.acl].sort(),['tt:custom','tt:user','tt:group/group'].sort());
 assert.equal(post.ownerId,'character');assert.ok(post.crystal.renderComponent.render);
 assert.match(post.crystal.text,/Scope: scheduled-pass/);
 assert.equal((await f.api.report({...event,status:'started',httpCode:null})).status,'recorded');assert.equal(f.creates,2);
});
test('mismatched or disabled Character, ownership revocation and removed group fail closed',async()=>{
 for(const change of [(f:any)=>{f.users.character.meta.character.ownerId='other'},(f:any)=>{f.users.character.meta.character.disabled=true},(f:any)=>{f.setGroups([])},(f:any)=>{f.users.admin.meta.admin=false}]){
  const f=fixture();assert.equal((await f.api.setConfig('admin',input)).ok,true);change(f);
  assert.equal((await f.api.report(event)).status,'unavailable');assert.equal(f.creates,0);
 }
});
test('disabled/unconfigured reporting and invalid external event fields cannot create posts',async()=>{
 const f=fixture();assert.equal((await f.api.report(event)).status,'unconfigured');
 const saved=await f.api.setConfig('admin',{...input,enabled:false});assert.equal(saved.ok,true);
 assert.equal((await f.api.report(event)).status,'disabled');assert.equal(f.creates,0);
 const g=fixture();await g.api.setConfig('admin',input);
 assert.equal((await g.api.report({...event,jobName:'private raw provider message' as any})).status,'unavailable');
 assert.equal((await g.api.report({...event,runId:'secret'})).status,'unavailable');assert.equal(g.creates,0);
});
test('an existing colliding or audience-altered post is never accepted or overwritten',async()=>{
 const f=fixture();await f.api.setConfig('admin',input);await f.api.report(event);
 f.posts.get(platformReportingPostId(event)).acl=['tt:all'];
 assert.equal((await f.api.report(event)).status,'unavailable');assert.equal(f.creates,1);
});
test('admin route refuses scoped, service, Character, cross-origin and stale actor requests',async()=>{
 let principal:any={user:{_id:'admin',meta:{admin:true}},session:{purpose:'browser',meta:{}}};
 const f=fixture(); const route=createPlatformReportingRoute({principal:async()=>principal,reporting:f.api} as any);
 const req=(headers:any={},method='GET')=>new Request('https://thingtime.test/api/v1/admin/platform-reporting',{method,headers,...(method==='POST'?{body:JSON.stringify(input)}:{})});
 for(const value of [null,{user:{_id:'admin',meta:{admin:true}},session:{purpose:'service'}},{user:{_id:'admin',meta:{admin:true}},session:{purpose:'browser',meta:{activeCharacterId:'character'}}},{user:{_id:'character',meta:{admin:true,character:{ownerId:'admin'}}},session:{purpose:'browser'}}]){
  principal=value;assert.ok((await route.loader({request:req()})).status>=400);
 }
 principal={user:{_id:'admin',meta:{admin:true}},session:{purpose:'browser',meta:{}}};
 assert.equal((await route.loader({request:req({'X-Thingtime-Expected-Actor':'other'})})).status,409);
 assert.equal((await route.action({request:req({'Content-Type':'application/json','Origin':'https://foreign.test','X-Thingtime-Expected-Actor':'admin'},'POST')})).status,403);
 assert.equal((await route.loader({request:req({'x-tt-mongo-url':'mongodb://127.0.0.1:65530/custom'})})).status,409);
 assert.equal((await route.loader({request:req()})).status,200);
 assert.equal((await route.action({request:req({'Content-Type':'application/json'},'POST')})).status,409);
 assert.equal((await route.action({request:req({'Content-Type':'application/json','Origin':'https://thingtime.test','X-Thingtime-Expected-Actor':'admin'},'POST')})).status,200);
});


test('GET descriptors and receipt contain only safe references and delivery metadata',async()=>{
 const f=fixture();f.users.owner.username='platformowner';f.users.character.username='platform-character';
 await f.api.setConfig('admin',input);await f.api.report(event);
 const description=await f.api.describeConfig();
 assert.deepEqual(description.owner,{id:'owner',username:'platformowner'});
 assert.deepEqual(description.character,{id:'character',username:'platform-character'});
 assert.equal(description.group?.id,'group');assert.equal(description.lastReport?.deliveryStatus,'recorded');
 assert.equal(description.lastReport?.postId,platformReportingPostId(event));
});


test('commit-time config and authority fences refuse concurrent revocation',async()=>{
 for(const scenario of ['config','character']){
  const f=fixture();const saved=await f.api.setConfig('admin',input);assert.equal(saved.ok,true);if(!saved.ok)throw Error('setup');
  f.beforeCreate(async()=>{if(scenario==='config')await f.api.setConfig('admin',{...input,enabled:false,revision:saved.config.revision});else f.denyFence();});
  assert.equal((await f.api.report(event)).status,'unavailable');assert.equal(f.posts.size,0);
 }
});


test('inherited custom database context is exited and restored around all reporting operations',async()=>{
 const f=fixture(true);const custom={url:'mongodb://127.0.0.1:65530/unrelated',savedId:'synthetic'};
 await runWithMongoEndpoint(custom,async()=>{
  assert.equal(getActiveMongoEndpoint(),custom);
  assert.equal((await f.api.setConfig('admin',input)).ok,true);
  assert.equal((await f.api.report(event)).status,'recorded');
  assert.equal(getActiveMongoEndpoint(),custom);
 });
 assert.equal(getActiveMongoEndpoint(),null);
});
