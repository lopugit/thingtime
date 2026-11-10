import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountThingSync, type AccountThing, type AccountSyncRecord, type AccountSyncTransport } from './accountSync';
import { AccountSuiteSync, ACCOUNT_SUITE_INSTALLS, ACCOUNT_SUITE_PARTS, installedSuiteIds, type AccountSuiteIntent } from './accountSuites';
import { remapSuiteThing } from './accountSuiteReconcile';
import { AccountTimeline, accountTimelineScope } from './accountTimeline';
import { AccountTimelineVersions } from './accountTimelineVersions';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceLease } from './storage';
import type { InstallSuiteResult } from '../schemas/suiteInstallation';
import { AccountDraftSync } from './accountDrafts';
import { aclFromVisibility } from '../schemas/registry';

const scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
const key='web-standards';
async function fixture(suiteKey=key) {
	const factory=new IDBFactory(), db=new WorkspaceDatabase(factory,undefined,undefined,IDBKeyRange);
	let active=true,time=Date.now();
	const lease:WorkspaceLease={assertCurrent(){if(!active)throw new Error('Workspace changed');},onInvalidate:()=>()=>{}};
	const sync=new AccountThingSync(db,scope,lease,()=>time), suites=new AccountSuiteSync(db,scope,lease,sync,(tx,intent,remote)=>sync.reconcileSuiteIn(tx,intent,remote),()=>time);
	const local=await suites.install(suiteKey), history=new AccountTimeline(db,scope,lease);
	const read=<T>(collection:string,id:string)=>db.transaction(scope,'readonly',lease,tx=>tx.get<T>(collection,id));
	const intent=(await read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS,suiteKey))!;
	const ids=new Map(installedSuiteIds(local).map((id,index)=>[id,`canonical-${index}`]));
	const group=(map:Record<string,string>)=>Object.fromEntries(Object.entries(map).map(([key,id])=>[key,ids.get(id)!]));
	const remote:InstallSuiteResult={...local,schemaIds:group(local.schemaIds),componentIds:group(local.componentIds),actionIds:group(local.actionIds),pageIds:group(local.pageIds),dataIds:local.dataIds.map(id=>ids.get(id)!),entryPageId:ids.get(local.entryPageId)!,receipt:{requestId:intent.request.requestId,ownerId:scope.ownerId,origin:scope.origin,dataPlane:scope.dataPlane,bundleVersion:intent.request.bundleVersion,snapshots:intent.baseline.map(row=>{const {revision:_revision,...mapped}=remapSuiteThing(row,ids);return {...mapped,extended:mapped.extended??null,tags:mapped.tags||[],folderId:mapped.folderId||null,targetId:mapped.targetId||null,author:{id:scope.ownerId},acl:['tt:user'],visibility:'private',createdAt:new Date(time-1000).toISOString(),updatedAt:new Date(time-500).toISOString()} as any;})}};
	return {db,factory,lease,sync,suites,local,remote,intent,ids,history,read,tick(){time+=120_000;},retire(){active=false;}};
}

test('canonical suite graph adoption retains customized definitions and later disjoint device edits, aliases and immutable History',async()=>{
	const f=await fixture();
	try {
		const component=Object.values(f.local.componentIds)[0], canonical=f.ids.get(component)!;
		const remote=f.remote.receipt!.snapshots.find(row=>row.id===canonical)!;
		remote.crystal.description='Existing account customization';
		await f.sync.things.update({id:component,crystal:{version:2}});
		const before=JSON.stringify(await f.history.rows({thingId:component}));
		const consumer=await f.sync.things.create({thingtime:['data'],crystal:{name:'Linked child'},targetId:component});
		let sends=0;
		assert.equal((await f.sync.sync({get:async()=>{throw new Error('unexpected get');},write:async()=>{sends++;throw new Error('unexpected send');}})).completed,0);
		assert.equal(sends,0,'both parts and outside dependents stay held');
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const row=await f.sync.things.get(component);
		assert.equal(row.id,canonical);assert.equal(row.crystal.description,'Existing account customization');assert.equal(row.crystal.version,2);
		assert.equal((await f.sync.things.get(consumer.id)).targetId,canonical);
		const folder=await f.sync.things.create({thingtime:['folder'],crystal:{name:'After adoption'}});
		await f.sync.things.move([component],folder.id);assert.equal((await f.sync.things.get(component)).folderId,folder.id);
		for(const old of installedSuiteIds(f.local))assert.equal(await f.read(ACCOUNT_SUITE_PARTS,old),undefined);
		const oldEvents=JSON.parse(before),after=await f.history.rows({thingId:canonical});
		for(const original of oldEvents)assert.deepEqual(after.find(row=>row.event.id===original.event.id),original,'History events and hashes remain immutable');
		assert.ok(after.some(row=>row.event.thingId===canonical&&row.event.label==='Adopted account suite identity'));
		assert.ok((await f.sync.status()).some(row=>row.id===canonical&&row.state==='pending'));
		const writes:any[]=[];const stored=new Map(f.remote.receipt!.snapshots.map(row=>[row.id,row]));
		await f.sync.sync({get:async id=>stored.get(id) as unknown as AccountThing,write:async operation=>{writes.push(operation);assert.equal(operation.method,[consumer.id,folder.id].includes(operation.id)?'create':'update');const prior=stored.get(operation.id);if(prior)assert.equal(operation.body.expectedUpdatedAt,prior.updatedAt);return {...prior,...operation.body,id:operation.id,author:{id:'owner'},createdAt:prior?.createdAt||row.createdAt,updatedAt:new Date(Date.now()+1000).toISOString()} as AccountThing;}});
		assert.ok(writes.some(write=>write.id===canonical));assert.ok(writes.every(write=>!f.ids.has(write.id)));
		await f.db.close();const cold=new WorkspaceDatabase(f.factory,undefined,undefined,IDBKeyRange),sync=new AccountThingSync(cold,scope,f.lease);
		assert.equal((await sync.things.get(component)).id,canonical);assert.equal((await sync.view(component))?.id,canonical);await cold.close();
	}finally{await f.db.close();}
});

test('overlapping account customization and later local edit become a reviewable canonical conflict',async()=>{
	const f=await fixture();try{
		const id=Object.values(f.local.componentIds)[0],canonical=f.ids.get(id)!;
		f.remote.receipt!.snapshots.find(row=>row.id===canonical)!.crystal.description='Account edit';
		await f.sync.things.update({id,crystal:{description:'Device edit'}});
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		assert.equal((await f.sync.things.get(id)).crystal.description,'Device edit');
		assert.equal((await f.sync.status()).find(row=>row.id===canonical)?.state,'conflict');
		assert.equal((await f.read<any>('thing-sync',canonical)).base.crystal.description,'Account edit');
	}finally{await f.db.close();}
});

test('receipt scope mismatch and affected immutable writes roll back adoption with durable holds',async()=>{
	const f=await fixture();try{
		const original=await f.sync.things.snapshot(), id=Object.values(f.local.componentIds)[0];
		await f.db.transaction(scope,'readwrite',f.lease,async tx=>{const state=await tx.get<any>('thing-sync',id);await tx.put('thing-sync',id,{...state,pending:{id,operationId:'frozen',method:'create',version:1,body:{thingtime:['component'],crystal:original.find(row=>row.id===id)!.crystal}}});});
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,0);
		assert.deepEqual(await f.sync.things.snapshot(),original);
		assert.ok(await f.read(ACCOUNT_SUITE_PARTS,id));
		assert.deepEqual((await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS,key))?.remote,f.remote);
		await assert.rejects(f.db.transaction(scope,'readwrite',f.lease,tx=>f.sync.reconcileSuiteIn(tx,f.intent,{...f.remote,receipt:{...f.remote.receipt!,dataPlane:'other'}})),/different workspace/);
	}finally{await f.db.close();}
});

test('old provisional History restore and undo target canonical IDs and never alter saved source snapshots',async()=>{
	const f=await fixture();try{
		const id=Object.values(f.local.componentIds)[0],canonical=f.ids.get(id)!;
		await f.sync.things.update({id,crystal:{description:'One edit'}});
		const source=(await f.history.rows({thingId:id})).find(row=>row.event.operation==='update')!;
		const text=JSON.stringify(source);
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const store={scope:accountTimelineScope(scope),entries:(ids:string[])=>f.history.entries(ids),forThing:(id:string)=>f.history.rows({thingId:id})};
		const versions=new AccountTimelineVersions(f.db,scope,f.lease,f.sync.things,store as any);
		for(const mode of ['undo','restore'] as const){
			const request={command:'preview-version' as const,mode,eventId:source.event.id,componentMode:'current' as const,choices:{},componentChoices:{}};
			const result=await versions.request(request);assert.ok('preview' in result);
			const preview=(result as any).preview;
			await versions.request({...request,command:'apply-version',operationId:crypto.randomUUID(),expectedHeadId:preview.expectedHeadId,expectedComponents:preview.components?.fingerprint});
			assert.equal((await f.sync.things.get(id)).id,canonical);
			assert.equal((await f.read<any>('things',id)),undefined);
		}
		assert.equal(JSON.stringify((await f.history.entries([source.event.id]))[0]),text);
		assert.ok((await f.history.rows({thingId:canonical})).some(row=>row.event.thingId===canonical&&row.event.operation==='restore'));
	}finally{await f.db.close();}
});

test('concurrent canonical refresh and a newer verified baseline survive frozen receipt replay',async()=>{
	const f=await fixture();try{
		const id=Object.values(f.local.componentIds)[0],canonical=f.ids.get(id)!;
		const snapshot=f.remote.receipt!.snapshots.find(row=>row.id===canonical)!;
		const refreshed={...snapshot,crystal:{...snapshot.crystal,description:'Newer remote read'},updatedAt:new Date(Date.parse(snapshot.updatedAt)+3000).toISOString()} as unknown as AccountThing;
		await f.sync.remember(refreshed);
		await f.sync.things.update({id:canonical,crystal:{version:3}});
		await f.sync.things.update({id,crystal:{description:'Provisional later edit'}});
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const row=await f.sync.things.get(id),state=await f.read<any>('thing-sync',canonical);
		assert.equal(row.id,canonical);assert.equal(row.crystal.version,3);assert.equal(row.crystal.description,'Provisional later edit');
		assert.equal(state.base.updatedAt,refreshed.updatedAt);assert.equal(state.base.crystal.description,'Newer remote read');
		assert.equal(state.state,'conflict','the device edit overlaps a customization learned by the concurrent refresh');
		assert.equal((await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS,key))!.remote!.receipt!.snapshots.find(row=>row.id===canonical)!.updatedAt,snapshot.updatedAt,'frozen receipt remains the installation commit');
	}finally{await f.db.close();}
});

test('schema, data, Action, page and post consumers use canonical references after adoption',async()=>{
	const f=await fixture('guestbook');try{
		const schema=Object.values(f.local.schemaIds)[0],data=f.local.dataIds[0],action=Object.values(f.local.actionIds)[0],component=Object.values(f.local.componentIds)[0];
		const consumer=await f.sync.things.create({thingtime:['action'],crystal:{name:'Consumer',version:1,actionKey:'test-consumer',steps:[{op:'things.get',id:data},{op:'things.search',schema},{op:'actions.invoke',action}],capabilities:[{capability:'things.read'},{capability:'actions.invoke',actions:[action]}]}});
		const post=await f.sync.things.create({thingtime:['post'],crystal:{type:'thingtime',text:'Saved suite',thing:{kind:'thing-collection',items:[{id:component,mode:'interactive'}]}}});
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const program=await f.sync.things.get(consumer.id),savedPost=await f.sync.things.get(post.id);
		assert.equal((program.crystal.steps as any[])[0].id,f.ids.get(data));assert.equal((program.crystal.steps as any[])[1].schema,f.ids.get(schema));assert.equal((program.crystal.steps as any[])[2].action,f.ids.get(action));
		assert.equal((savedPost.crystal.thing as any).items[0].id,f.ids.get(component));
		assert.equal((await f.sync.things.get(data)).crystal.schemaId,f.ids.get(schema));
		const all=await f.sync.things.snapshot();
		for(const row of all)assert.ok(!installedSuiteIds(f.local).includes(row.id));
	}finally{await f.db.close();}
});

test('recorded page restore maps old component bindings while preserving source events',async()=>{
	const f=await fixture();try{
		const id=Object.values(f.local.pageIds)[0],source=(await f.history.rows({thingId:id}))[0];
		assert.ok(source.event.dependencies.length);
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const store={scope:accountTimelineScope(scope),entries:(ids:string[])=>f.history.entries(ids),forThing:(id:string)=>f.history.rows({thingId:id})};
		const versions=new AccountTimelineVersions(f.db,scope,f.lease,f.sync.things,store as any);
		const request={command:'preview-version' as const,mode:'restore' as const,eventId:source.event.id,componentMode:'recorded' as const,choices:{},componentChoices:{}};
		const preview=(await versions.request(request) as any).preview;
		assert.equal(preview.components.missing.length,0);
		await versions.request({...request,command:'apply-version',operationId:crypto.randomUUID(),expectedHeadId:preview.expectedHeadId,expectedComponents:preview.components.fingerprint});
		assert.equal((await f.sync.things.get(id)).id,f.ids.get(id));
		assert.deepEqual((await f.history.entries([source.event.id]))[0],source);
	}finally{await f.db.close();}
});

test('divergent audiences preserve both device choices and block any automatic publication',async()=>{
	const f=await fixture();try{
		const id=Object.values(f.local.componentIds)[0],canonical=f.ids.get(id)!;
		await f.sync.remember(f.remote.receipt!.snapshots.find(row=>row.id===canonical) as unknown as AccountThing);
		await f.sync.things.update({id:canonical,visibility:'hidden'} as any);
		await f.sync.things.update({id,visibility:'public'} as any);
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const state=await f.read<any>('thing-sync',canonical),journal=await f.read<any>('account-suite-conflicts',canonical);
		assert.equal(state.state,'conflict');assert.equal(state.audience.visibility,'hidden');assert.deepEqual(state.audience.acl,aclFromVisibility('hidden'));
		assert.equal(journal.provisional.visibility,'public');assert.equal(journal.canonical.visibility,'hidden');assert.equal(journal.authoritative.visibility,'private');
		let sends=0;await f.sync.sync({get:async()=>{throw new Error('unexpected');},write:async()=>{sends++;throw new Error('unexpected');}});
		assert.equal(sends,0);
		const transport={get:async()=>f.remote.receipt!.snapshots.find(row=>row.id===canonical) as unknown as AccountThing,write:async()=>{throw new Error('review does not write network');}};
		await assert.rejects(f.sync.restoreSuiteAlternative(transport,{id,source:'provisional',requestId:'stale',localRevision:(await f.sync.things.get(id)).revision,remoteUpdatedAt:state.base.updatedAt}),/changed/);
		await f.sync.restoreSuiteAlternative(transport,{id,source:'provisional',requestId:journal.requestId,localRevision:(await f.sync.things.get(id)).revision,remoteUpdatedAt:state.base.updatedAt});
		assert.equal((await f.sync.view(id))?.visibility,'public','explicit user choice recovers the saved audience');
		assert.equal((await f.read<any>('thing-sync',canonical)).state,'pending');
		assert.equal((await f.read<any>('account-suite-conflicts',canonical)).canonical.visibility,'hidden','the alternative is preserved');
	}finally{await f.db.close();}
});

test('real DefinitionEditor, page and post draft serializers remap only typed references and prefixed contexts',async()=>{
	const f=await fixture();try{
		const drafts=new AccountDraftSync(f.db,scope,f.lease),component=Object.values(f.local.componentIds)[0],page=Object.values(f.local.pageIds)[0];
		const literal=`Keep the literal ${component} unchanged`;
		const saves=[
			{id:'definition-draft',surface:'definition',context:`definition:${component}`,snapshot:JSON.stringify({source:JSON.stringify({...((await f.sync.things.get(component)).crystal),description:literal}),baseUpdatedAt:'old',mode:'source',fields:{}})},
			{id:'page-draft',surface:'definition',context:`site-editor:${page}:ready`,snapshot:JSON.stringify({name:literal,blocks:[{id:'component-block',type:'component',component}],baseUpdatedAt:'old',acl:['tt:user']})},
			{id:'post-draft',surface:'post',context:'post:new:',snapshot:JSON.stringify({pickedThings:[{id:component,mode:'interactive'}],postTitle:literal})}
		];
		for(const {id,...content} of saves)await drafts.drafts.request({operation:'save',id,writeId:id,revision:0,content:{...content,name:id,attachmentIds:[]}});
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const definition=(await f.read<any>('drafts','definition-draft')).draft,pageDraft=(await f.read<any>('drafts','page-draft')).draft,post=(await f.read<any>('drafts','post-draft')).draft;
		assert.equal(definition.context,`definition:${f.ids.get(component)}`);assert.equal(JSON.parse(JSON.parse(definition.snapshot).source).description,literal);
		assert.equal(pageDraft.context,`site-editor:${f.ids.get(page)}:ready`);assert.equal(JSON.parse(pageDraft.snapshot).blocks[0].component,f.ids.get(component));assert.equal(JSON.parse(pageDraft.snapshot).name,literal);
		assert.equal(JSON.parse(post.snapshot).pickedThings[0].id,f.ids.get(component));assert.equal(JSON.parse(post.snapshot).postTitle,literal);
	}finally{await f.db.close();}
});

test('mutable deletion recovery consumers and suite deletions adopt canonical identities without resurrecting content',async()=>{
	const f=await fixture('guestbook');try{
		const schema=Object.values(f.local.schemaIds)[0],component=Object.values(f.local.componentIds)[0];
		const stamp=new Date(Date.now()-10000).toISOString();
		await f.sync.remember({id:'existing-data',thingtime:['data'],crystal:{name:'Existing'},createdAt:stamp,updatedAt:stamp,revision:1,author:{id:'owner'},acl:['tt:user'],visibility:'private'});
		await f.sync.things.update({id:'existing-data',crystal:{schemaId:schema}});
		await f.sync.remove(['existing-data']);await f.sync.remove([component]);
		assert.ok((await f.read<any>('thing-sync',component)).deleted,'held unsent deletion remains durable');
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		assert.equal((await f.read<any>('thing-deletions','existing-data')).crystal.schemaId,f.ids.get(schema));
		assert.equal(await f.sync.view(component),null);assert.equal(await f.read('things',f.ids.get(component)!),undefined);
		assert.ok((await f.read<any>('thing-sync',f.ids.get(component)!)).deleted);
		assert.equal(await f.read('thing-deletions',component),undefined);
	}finally{await f.db.close();}
});

test('failed adoption History write rolls back refs, aliases, queue and content together and retries the pinned receipt',async()=>{
	const f=await fixture();try{
		const before=await f.sync.things.snapshot(),transaction=f.db.transaction.bind(f.db);let fail=true,calls=0;
		f.db.transaction=((scope:any,mode:any,lease:any,run:any)=>transaction(scope,mode,lease,tx=>run({...tx,put:async(collection:string,id:string,value:any)=>{if(fail&&collection==='timeline-events'&&value.event?.label==='Adopted account suite identity')throw new Error('injected quota');await tx.put(collection,id,value);}}))) as any;
		assert.equal((await f.suites.sync({install:async()=>{calls++;return f.remote;}})).completed,0);
		assert.deepEqual(await f.sync.things.snapshot(),before);assert.equal(await f.read('account-suite-aliases',before[0].id),undefined);
		fail=false;f.tick();assert.equal((await f.suites.sync({install:async()=>{calls++;return f.remote;}})).completed,1);assert.equal(calls,1);
	}finally{await f.db.close();}
});

test('deleted provisional adoption removes an already-cached canonical row and History can recover it',async()=>{
	const f=await fixture();try{
		const id=Object.values(f.local.componentIds)[0],canonical=f.ids.get(id)!;
		await f.sync.remember(f.remote.receipt!.snapshots.find(row=>row.id===canonical) as unknown as AccountThing);
		await f.sync.remove([id]);
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		assert.equal(await f.read('things',canonical),undefined);
		assert.ok(await f.read('thing-deletions',canonical));
		assert.ok((await f.read<any>('thing-sync',canonical)).deleted);
		const deleted=(await f.history.rows({thingId:canonical})).find(row=>row.event.thingId===canonical&&row.event.operation==='delete')!;
		assert.ok(deleted);
		const store={scope:accountTimelineScope(scope),entries:(ids:string[])=>f.history.entries(ids),forThing:(id:string)=>f.history.rows({thingId:id})};
		const versions=new AccountTimelineVersions(f.db,scope,f.lease,f.sync.things,store as any);
		const request={command:'preview-version' as const,mode:'restore' as const,eventId:deleted.event.id,recover:true as const,componentMode:'current' as const,choices:{},componentChoices:{}};
		const preview=(await versions.request(request) as any).preview;
		await versions.request({...request,command:'apply-version',operationId:crypto.randomUUID(),expectedHeadId:preview.expectedHeadId,expectedComponents:preview.components?.fingerprint,expectedRecovery:preview.recoveryFingerprint});
		assert.equal((await f.sync.things.get(id)).id,canonical);
		assert.equal((await f.read<any>('thing-sync',canonical)).deleted,undefined);
		assert.equal(await f.read('thing-deletions',canonical),undefined);
	}finally{await f.db.close();}
});

test('undoing adoption preserves earlier canonical device content, audience and History ancestry',async()=>{
	const f=await fixture();try{
		const id=Object.values(f.local.componentIds)[0],canonical=f.ids.get(id)!;
		await f.sync.remember(f.remote.receipt!.snapshots.find(row=>row.id===canonical) as unknown as AccountThing);
		await f.sync.things.update({id:canonical,crystal:{description:'Earlier canonical edit A'},visibility:'hidden'} as any);
		const previousHead=(await f.history.rows({thingId:canonical}))[0];
		await f.sync.things.update({id,crystal:{version:2}});
		assert.equal((await f.suites.sync({install:async()=>f.remote})).completed,1);
		const merged=await f.sync.view(id);
		assert.equal(merged?.crystal.description,'Earlier canonical edit A');assert.equal(merged?.crystal.version,2);assert.equal(merged?.visibility,'hidden');
		const adoption=(await f.history.rows({thingId:canonical})).find(row=>row.event.thingId===canonical&&row.event.label==='Adopted account suite identity')!;
		assert.deepEqual(adoption.event.parentIds,[previousHead.event.id]);
		assert.equal((adoption.event.before!.value as any).crystal.description,'Earlier canonical edit A');
		assert.deepEqual((adoption.event.before!.value as any).acl,aclFromVisibility('hidden'));
		const store={scope:accountTimelineScope(scope),entries:(ids:string[])=>f.history.entries(ids),forThing:(id:string)=>f.history.rows({thingId:id})};
		const versions=new AccountTimelineVersions(f.db,scope,f.lease,f.sync.things,store as any);
		const request={command:'preview-version' as const,mode:'undo' as const,eventId:adoption.event.id,componentMode:'current' as const,choices:{},componentChoices:{}};
		const preview=(await versions.request(request) as any).preview;
		await versions.request({...request,command:'apply-version',operationId:crypto.randomUUID(),expectedHeadId:preview.expectedHeadId,expectedComponents:preview.components?.fingerprint});
		const undone=await f.sync.view(id);
		assert.equal(undone?.crystal.description,'Earlier canonical edit A');assert.equal(undone?.crystal.version,1);assert.equal(undone?.visibility,'hidden');
		assert.deepEqual((await f.history.entries([previousHead.event.id]))[0],previousHead);
	}finally{await f.db.close();}
});


test('explicit saved suite recovery replaces a settled frozen conflict but never an uncertain retry', async () => {
	const f = await fixture();
	try {
		const id = Object.values(f.local.componentIds)[0], canonical = f.ids.get(id)!;
		f.remote.receipt!.snapshots.find(row => row.id === canonical)!.crystal.name = 'Original account version';
		await f.sync.things.update({ id, crystal: { name: 'Original device version' } });
		await f.suites.sync({ install: async () => f.remote });
		let current = (await f.read<AccountSyncRecord>('thing-sync', canonical))!.base!;
		const writes: Parameters<AccountSyncTransport['write']>[0][] = [];
		let unavailable = false;
		const transport: AccountSyncTransport = {
			get: async () => current,
			write: async operation => {
				writes.push(structuredClone(operation));
				if (unavailable) { unavailable = false; throw new WorkspaceError('NETWORK_UNAVAILABLE', 'Unavailable', 503); }
				if (operation.body.expectedUpdatedAt !== current.updatedAt) throw new WorkspaceError('VERSION_CONFLICT', 'Changed', 409);
				current = { ...current, crystal: operation.body.crystal as AccountThing['crystal'], acl: operation.body.acl as string[],
					visibility: operation.body.visibility as string, revision: current.revision + 1, updatedAt: new Date(Date.parse(current.updatedAt) + 10).toISOString() };
				return current;
			}
		};
		const first = await f.sync.inspectConflict(transport, id);
		await f.sync.resolveConflict(transport, { id, keep: 'local', localRevision: first.localRevision, remoteUpdatedAt: first.remote.updatedAt });
		assert.equal((await f.sync.sync(transport)).completed, 1);
		await f.sync.things.update({ id, crystal: { name: 'New device edit' } });
		current = { ...current, crystal: { ...current.crystal, name: 'Other connected client' }, updatedAt: new Date(Date.parse(current.updatedAt) + 10).toISOString() };
		unavailable = true;
		await f.sync.sync(transport);
		const uncertain = (await f.read<AccountSyncRecord>('thing-sync', canonical))!;
		assert.equal(uncertain.state, 'pending');
		assert.ok(uncertain.pending);
		const requestId = first.suiteAlternatives!.requestId;
		await assert.rejects(f.sync.restoreSuiteAlternative(transport, { id, source: 'provisional', requestId,
			localRevision: (await f.sync.things.get(id)).revision, remoteUpdatedAt: current.updatedAt }), /changed/);
		assert.deepEqual((await f.read<AccountSyncRecord>('thing-sync', canonical))!.pending, uncertain.pending);
		await f.sync.things.update({ id, crystal: { name: 'Even newer local edit' } });
		f.tick(); await f.sync.sync(transport);
		assert.deepEqual(writes.at(-1), uncertain.pending, 'Automatic retry keeps the exact frozen operation despite newer local edits.');
		const conflict = (await f.read<AccountSyncRecord>('thing-sync', canonical))!;
		assert.equal(conflict.state, 'conflict'); assert.ok(conflict.pending); assert.equal(conflict.claim, undefined);
		const review = await f.sync.inspectConflict(transport, id);
		const choice = { id, source: 'provisional' as const, requestId, localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt };
		await assert.rejects(f.sync.restoreSuiteAlternative(transport, { ...choice, localRevision: choice.localRevision - 1 }), /changed/);
		await assert.rejects(f.sync.restoreSuiteAlternative(transport, { ...choice, remoteUpdatedAt: first.remote.updatedAt }), /changed/);
		await f.db.transaction(scope, 'readwrite', f.lease, tx => tx.put('thing-sync', canonical, { ...conflict, claim: { token: 'active-write', expiresAt: Date.now() + 60000 } }));
		await assert.rejects(f.sync.restoreSuiteAlternative(transport, choice), /changed/);
		await f.db.transaction(scope, 'readwrite', f.lease, tx => tx.put('thing-sync', canonical, conflict));
		const attempts = writes.length; await f.sync.sync(transport);
		assert.equal(writes.length, attempts, 'A settled conflict never retries without explicit review.');
		await f.sync.restoreSuiteAlternative(transport, choice);
		const restored = (await f.read<AccountSyncRecord>('thing-sync', canonical))!;
		assert.equal(restored.state, 'pending'); assert.equal(restored.pending, undefined);
		assert.equal(restored.base!.updatedAt, current.updatedAt);
		assert.equal((await f.sync.view(id))!.crystal.name, 'Original device version');
		assert.deepEqual(restored.audience, { acl: ['tt:user'], visibility: 'private' });
		assert.equal((await f.sync.sync(transport)).completed, 1);
		assert.notEqual(writes.at(-1)!.operationId, conflict.pending!.operationId);
		assert.equal(writes.at(-1)!.body.expectedUpdatedAt, choice.remoteUpdatedAt);
		assert.equal((await f.read<AccountSyncRecord>('thing-sync', canonical))!.state, 'synced');
		assert.equal(current.crystal.name, 'Original device version');
	} finally { await f.db.close(); }
});
