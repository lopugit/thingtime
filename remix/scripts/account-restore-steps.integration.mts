/** Isolated real Request handlers/canonical writers + replica. No raw DB
 * fixtures, personal folders/accounts, injected writer or production network. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:28174\/thingtime\?replicaSet=account-profile-backup$/.test(process.env.MONGODB_CONNECTION_STRING ?? ''));
const base = 'http://127.0.0.1:28174';
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = join(directory!, 'objects'); process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = base;
process.env.APP_URL = base; process.env.JWT_SECRET = randomBytes(48).toString('base64url');
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url'); process.env.ADMIN_USERNAMES = '';
const register = await import('../app/routes/api/v1/auth/register/_register');
const filesRoute = await import('../app/routes/api/v1/files/_files');
const uploads = await import('../app/routes/api/v1/attachments/uploads/_uploads');
const parts = await import('../app/routes/api/v1/attachments/uploads/parts/_parts');
const complete = await import('../app/routes/api/v1/attachments/uploads/complete/_complete');
const contentRoute = await import('../app/routes/api/v1/attachments/content/_content');
const me = await import('../app/routes/api/v1/auth/me/_me');
const timelineRoute = await import('../app/routes/api/v1/timeline/_timeline');
const migration = await import('../app/routes/api/v1/admin/migrations/run/_run');
const { ensureIndexes } = await import('../app/api/utils/mongodb/collections');
const uploadApproval = await import('../app/routes/api/v1/admin/users/public-uploads/_public-uploads');
const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
const { stageCloudFileBytes } = await import('../app/fileSync/cloudTransport');
const { fingerprintSource } = await import('../app/fileSync/contentFingerprint');
const { createNoteService } = await import('../app/api/utils/timeline/notes');
const { createVersionNameService } = await import('../app/api/utils/timeline/versionNames');
const { createAccountInventoryProducer } = await import('../app/api/utils/backups/accountInventory');
const { resumeAccountBackup } = await import('../app/api/utils/backups/cloudFolderBackup');
const { createBackupEngineTransport } = await import('../app/api/utils/backups/backupTransport.server');
const { thingtimeCapabilityManifest, capabilitySatisfies } = await import('../app/api/utils/capabilities/thingtimeCapabilities');
const { accountFileRestoreTargetId, accountFileRestoreHistoryId, accountFileRestoreNoteId } = await import('../app/api/utils/backups/accountFileRestore');
const logout = await import('../app/routes/api/v1/auth/logout/_logout');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { createThing, getThing, deleteThing, updateThing } = await import('../app/api/utils/things/things');
const { createBackupJobCoordinator } = await import('../app/api/utils/backups/backupJobs');
const { runAccountRestoreStep, readAccountRestoreReview } = await import('../app/api/utils/backups/accountRestoreSteps');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');
const { immutableReferenceIndex } = await import('../app/api/utils/backups/immutableReferenceIndex');
const { ordinaryRestoreTargetId } = await import('../app/api/utils/backups/ordinaryRestoreTransaction');
const { backupJson } = await import('../app/backups/manifest');
const hash = (v: unknown) => createHash('sha256').update(backupJson(v)).digest('hex');
const request = (cookie: string, path = '/api/v1/things', body?: unknown) => new Request(base + path, {
 method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
 ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const registered = await register.action({ request: request('', '/api/v1/auth/register', { username: 'restore-steps-' + randomUUID().slice(0, 8),
 email: randomUUID() + '@example.invalid', password: randomUUID() + '-Disposable!' }) } as any);
assert.equal(registered.status, 200); const body = await registered.json(); assert.equal(body.ok, true);
const cookie = registered.headers.getSetCookie().map(v => v.split(';')[0]).join('; '), user = await getCurrentUser(request(cookie)); assert.ok(user);
const sourceRows: any[] = [];
async function create(input: any) { const result = await createThing(user!.id, input, user!); assert.equal(result.ok, true, !result.ok && result.error); if (!result.ok) throw Error(result.error); sourceRows.push(result.doc); return result.doc; }
const folder = await create({ shareId: 'source-root', thingtime: ['folder'], crystal: { name: 'Source selection', description: 'Preserved root content' }, tags: ['restore-proof'] });
const child = await create({ shareId: 'source-child', thingtime: ['folder'], folderId: folder.shareId, crystal: { name: 'Nested' } });
const schema = await create({ shareId: 'source-schema', thingtime: ['schema'], crystal: { name: 'proof-schema', fields: [] } });
const actionA = await create({ shareId: 'source-action-a', thingtime: ['action'], crystal: { actionKey: 'proof-a', name: 'A', steps: [{ op: 'actions.invoke', action: 'source-action-b' }], capabilities: [{ capability: 'actions.invoke', actions: ['source-action-b'] }] } });
await create({ shareId: 'source-action-b', thingtime: ['action'], crystal: { actionKey: 'proof-b', name: 'B', steps: [{ op: 'actions.invoke', action: actionA.shareId }], capabilities: [{ capability: 'actions.invoke', actions: [actionA.shareId] }] } });
const component = await create({ shareId: 'source-component', thingtime: ['component'], crystal: { componentKey: 'proof-component', name: 'Card', render: { tag: 'button', ttAction: actionA.shareId, children: 'Recovered' } } });
await create({ shareId: 'source-page', thingtime: ['webpage'], folderId: child.shareId, crystal: { name: 'Page', blocks: [{ id: 'card', type: 'component', component: component.shareId }] } });
const datum = await create({ shareId: 'source-data', thingtime: ['data'], folderId: child.shareId, crystal: { schemaId: schema.shareId, text: 'Independent content 🥰', parentId: 'source-data' } });
const outside = await create({ shareId: 'unselected-data', thingtime: ['data'], crystal: { text: 'Must remain unselected' } });
const scope = { apiOrigin: base, ownerId: user!.id, dataPlane: 'home' }, access = { scope, authorize: async () => { assert.equal((await getCurrentUser(request(cookie)))?.id, user!.id); } };
const store = await openLocalBackupStore(join(directory!, 'independent')), snapshotId = randomUUID(), binding = 'a'.repeat(64);
process.env.ADMIN_USERNAMES = user!.username!;
for (let pass=0;pass<2;pass++) { const response=await migration.action({request:request(cookie,'/api/v1/admin/migrations/run',{migration:'retire-legacy-thing-indexes',confirm:true})} as any); assert.equal(response.status,200); if(pass===0) await new Promise(resolve=>setTimeout(resolve,60100)); }
await ensureIndexes({force:true});
const approval = await uploadApproval.action({ request: request(cookie, '/api/v1/admin/users/public-uploads', { userId: user!.id, enabled: true, scope: 'private' }) } as any); assert.equal(approval.status, 200);
process.env.ADMIN_USERNAMES = '';
const manifest = thingtimeCapabilityManifest(base), syncScope = { origin: base, ownerId: user!.id, dataPlane: 'home', rootId: folder.shareId, deviceId: 'bounded-restore-fixture' };
const fixtureFetch: typeof fetch = async (input, init) => {
 const raw = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), base), init), url = new URL(raw.url);
 assert.equal(url.origin, base); const headers = new Headers(raw.headers);
 if (url.pathname !== '/api/v1/attachments/local-object') { headers.set('Cookie', cookie); headers.set('Origin', base); }
 const req = new Request(raw, { headers });
 if (url.pathname === '/api/v1/attachments/local-object') return handleLocalAttachmentStorageRequest(req);
 const handler = url.pathname === '/api/v1/auth/me' ? me.loader : url.pathname === '/api/v1/attachments/uploads' ? uploads.action : url.pathname.endsWith('/uploads/parts') ? parts.action : url.pathname.endsWith('/uploads/complete') ? complete.action : url.pathname === '/api/v1/attachments/content' ? req.method === 'POST' ? contentRoute.action : contentRoute.loader : url.pathname === '/api/v1/files' ? req.method === 'POST' ? filesRoute.action : filesRoute.loader : null;
 assert.ok(handler); return handler!({ request: req } as any);
};
const runtime = { currentScope: () => syncScope, origin: () => base, fetch: fixtureFetch, requireCapability: async (feature: string, minimum: string) => assert.ok(capabilitySatisfies(manifest.features[feature]?.version ?? '', minimum)) };
const fileId = randomUUID(), oldBytes = new Uint8Array(Buffer.from('Historical independent content 🥰')), currentBytes = new Uint8Array(Buffer.from('Current independent content 🥰'));
async function publish(bytes: Uint8Array, before?: any) {
 const operationId = randomUUID(), fingerprint = await fingerprintSource({ size: bytes.length, read: async (o, n) => bytes.slice(o, o + n), check: () => {} });
 const staged = await stageCloudFileBytes(runtime, { scope: syncScope, folderId: child.shareId, before: null, cloudRootId: folder.shareId,
  operation: { id: operationId, confirmed: true, mutation: { kind: 'copy', from: 'local', path: 'Nested/fixture.txt', expectedTarget: null, source: { kind: 'file', path: 'Nested/fixture.txt', id: fileId, version: 'fixture', size: bytes.length, sha256: null, fingerprint } } } }, fileId,
  { size: bytes.length, read: async (o, n) => bytes.slice(o, o + n), check: () => {} }, undefined, { purpose: 'file' });
 const response = await filesRoute.action({ request: request(cookie, '/api/v1/files', { id: fileId, operationId, expectedRevision: before?.revision ?? null, name: 'fixture.txt', folderId: child.shareId, attachmentId: staged.attachmentId, contentVersion: staged.version, trashed: false }) } as any);
 const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result.file;
}
const oldFile = await publish(oldBytes), currentFile = await publish(currentBytes, oldFile);
const { handleBranchRequest } = await import('../app/api/utils/timeline/branches');
await handleBranchRequest(user!.id, { command: 'create-branch', operationId: randomUUID(), branchId: 'branch-' + randomUUID(), thingId: fileId, eventId: oldFile.revision, expectedRevision: 0, name: 'Original alternative' });
const callTimeline=async(command:any)=>{const response=await timelineRoute.action({request:request(cookie,'/api/v1/timeline?'+new URLSearchParams({ownerId:user!.id,dataPlane:'home'}),command)}as any);const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
const sourceNoteText='Historical note 🥰\nLine two; preserve formatting.';
const sourceNote=(await callTimeline({command:'add-note',operationId:randomUUID(),thingId:fileId,eventId:oldFile.revision,text:sourceNoteText})).note;
const sourceLopuText='Original Lopu explanation with exact words 🥰';
const sourceLopuResult=await createNoteService({explain:async()=>sourceLopuText})(user!.id,{command:'explain-change',operationId:randomUUID(),thingId:fileId,eventId:currentFile.revision});assert.ok('note'in sourceLopuResult);const sourceLopuNote=sourceLopuResult.note;
const firstLabel=await callTimeline({command:'name-version',operationId:randomUUID(),thingId:fileId,eventId:oldFile.revision,name:'Original earlier label 🥰',expectedRevision:0});
const sourceClearedLabelText='Exact renamed 版本 label 🥰';
const renamedLabel=await callTimeline({command:'name-version',operationId:randomUUID(),thingId:fileId,eventId:oldFile.revision,name:sourceClearedLabelText,expectedRevision:firstLabel.name.revision});
const sourceClear=await callTimeline({command:'name-version',operationId:randomUUID(),thingId:fileId,eventId:oldFile.revision,name:null,expectedRevision:renamedLabel.name.revision});
const sourceCurrentLabel='Current selected version 🥰';
await callTimeline({command:'name-version',operationId:randomUUID(),thingId:fileId,eventId:currentFile.revision,name:sourceCurrentLabel,expectedRevision:0});
const clearNote=(await callTimeline({command:'add-note',operationId:randomUUID(),thingId:fileId,eventId:sourceClear.entry.event.id,text:'Note on the original label clear 🥰'})).note;
await createAccountInventoryProducer()(store, snapshotId, access);
const captured = await resumeAccountBackup(store, snapshotId, { scope, currentScope: () => scope, fetch: fixtureFetch, requireCapability: runtime.requireCapability });
const storedPlan = JSON.parse(Buffer.from((await store.read(`snapshots/${snapshotId}/plan.json`, 128 * 1024))!).toString());
const pins = { store, snapshotId, planHash: hash(storedPlan), sealHash: hash(captured.seal) };
// Real job coordinator authority; the source seal itself was built above using
// canonical backup primitives from real API-created documents.
let now = Date.now(); const jobs = createBackupJobCoordinator({ now: () => now });
const snapshotJob = await jobs.admit(request(cookie, '/api/v1/backups'), { requestId: randomUUID(), operation: { kind: 'snapshot', snapshotId, destinationId: 'fixture-independent' }, destinationBinding: binding });
const sourceLease = (await jobs.claim(snapshotJob.id)).lease!;
await jobs.withLease(sourceLease, ctx => ctx.checkpoint({ ...ctx.cursor, phase: 'complete', planHash: pins.planHash, sealHash: pins.sealHash }));
await jobs.finish(sourceLease, { kind: 'complete' });
for (const row of sourceRows) assert.equal((await deleteThing(user!, row.shareId)).ok, true);
await rm(join(directory!, 'objects'), { recursive: true, force: true });
const dest = await createThing(user!.id, { thingtime: ['folder'], crystal: { name: 'Destination' } }, user!); assert.ok(dest.ok); if (!dest.ok) throw Error(dest.error);
const reviewJob = await jobs.admit(request(cookie, '/api/v1/backups'), { requestId: randomUUID(), operation: { kind: 'review', sourceJobId: snapshotJob.id, sourceRootId: folder.shareId, destinationId: dest.doc.shareId, destinationRevision: dest.doc.timelineHeadId! }, destinationBinding: binding });
const deps = async (ctx: any) => ({ runtime: (await createBackupEngineTransport(ctx, async () => manifest)).runtime, access: { scope, authorize: ctx.guard }, openSnapshot: async (completed: any) => { assert.equal(completed.jobId, snapshotJob.id); assert.equal(completed.cursor.planHash, pins.planHash); assert.equal(completed.cursor.sealHash, pins.sealHash); return pins; } });
let steps = 0, lostCursorReply = false, lostEffectReply = false, lostFileEffectReply = false, lostNoteEffectReply = false, lostLabelEffectReply = false, paused = false, maxMs = 0;
let beforeFileCompletion:((state:any)=>Promise<void>)|null=null;
const run = async (job: any, loseReplies = false) => {
 for (;;) {
  assert.ok(++steps < 1500, 'Bounded synthetic fixture exceeded expected finite units'); now += 100_000;
  const claim = await jobs.claim(job.id); assert.ok(claim.lease); const started = performance.now();
  let abandoned = false;
  try {
   const outcome = await jobs.withLease(claim.lease!, async ctx => {
    if(beforeFileCompletion&&ctx.operation.kind==='restore'&&ctx.cursor.restoreStateHash){const idx=immutableReferenceIndex(store,`restore-plans/${ctx.operation.reviewJobId}/references`,ctx.guard),state=await idx.readState(ctx.cursor.restoreStateHash);if(state.mode==='file-restore-complete'){const hook=beforeFileCompletion;beforeFileCompletion=null;await hook(state);}}

    if (loseReplies && ctx.cursor.restoreStateHash && !paused) {
     const index = immutableReferenceIndex(store, `restore-plans/${reviewJob.id}/references`, ctx.guard), state = await index.readState(ctx.cursor.restoreStateHash);
     if (state.mode === 'restore-apply' && state.intent === 0) { await jobs.control(request(cookie), job.id, 'pause'); await assert.rejects(async () => runAccountRestoreStep(ctx, await deps(ctx))); paused = true; abandoned = true; return null; }
    }
    const wrapped = { ...ctx, get cursor() { return ctx.cursor; }, checkpoint: async (next: any, options: any) => {
     if (loseReplies && (!lostEffectReply || !lostFileEffectReply || !lostNoteEffectReply || !lostLabelEffectReply) && next.restoreStateHash) {
      const index = immutableReferenceIndex(store, `restore-plans/${reviewJob.id}/references`, ctx.guard), state = await index.readState(next.restoreStateHash);
      if(state.mode==='file-restore-apply'&&state.intent>0){const priorBlob=await index.get(state.root,index.key(['file-intent',state.intent-1]));const prior=await index.openBlob(priorBlob);if(prior.kind==='note'&&!lostNoteEffectReply){lostNoteEffectReply=true;throw Error('Dropped after accepted note before job checkpoint');}if(prior.kind==='version-name'&&!lostLabelEffectReply){lostLabelEffectReply=true;throw Error('Dropped after accepted label before job checkpoint');}}
      if (!lostFileEffectReply && state.mode === 'file-restore-apply' && state.intent === 3) { lostFileEffectReply = true; throw Error('Dropped after canonical file effect before job checkpoint'); }
      if (!lostEffectReply && state.mode === 'restore-apply' && state.intent === 1) { lostEffectReply = true; throw Error('Dropped after canonical effect before job checkpoint'); }
     }
     await ctx.checkpoint(next, options);
     if (!lostCursorReply && ctx.operation.kind === 'review' && next.itemsProcessed === 2) { lostCursorReply = true; throw Error('Dropped accepted review cursor acknowledgement'); }
    } };
    return runAccountRestoreStep(wrapped, await deps(ctx));
   });
   if (abandoned) { await jobs.control(request(cookie), job.id, 'resume'); continue; }
   await jobs.finish(claim.lease!, outcome!); maxMs = Math.max(maxMs, performance.now() - started);
   if (outcome!.kind === 'complete') return;
   assert.equal(outcome!.kind, 'continue');
  } catch (error) { if (!/Dropped/.test(String(error))) throw error; }
 }
};
await run(reviewJob);
const readJob = await jobs.admit(request(cookie), { requestId: randomUUID(), operation: { kind: 'review', sourceJobId: snapshotJob.id, sourceRootId: outside.shareId, destinationId: dest.doc.shareId, destinationRevision: dest.doc.timelineHeadId! }, destinationBinding: binding });
const metadataLease = (await jobs.claim(readJob.id)).lease!;
let review: any, completedReview: any;
await jobs.withLease(metadataLease, async ctx => { completedReview = await ctx.completedSource(reviewJob.id, 'review'); review = await readAccountRestoreReview(ctx, await deps(ctx), completedReview); });
assert.equal(review.executable, true, review.coverage); assert.equal(review.snapshotId, snapshotJob.id); assert.match(review.history, /not imported/);
const restoreJob = await jobs.admit(request(cookie), { requestId: randomUUID(), operation: { kind: 'restore', reviewJobId: reviewJob.id, reviewHash: review.hash }, destinationBinding: binding });
await run(restoreJob, true);
assert.ok(paused && lostCursorReply && lostEffectReply && lostFileEffectReply && lostNoteEffectReply && lostLabelEffectReply);
const rootState = await immutableReferenceIndex(store, `restore-plans/${reviewJob.id}/references`, access.authorize).readState(completedReview.cursor.restoreStateHash!);
const map = (id: string) => ordinaryRestoreTargetId({ operationId: reviewJob.id, destination: rootState.destination }, id);
const restored = await getThing(user!, map(datum.shareId)); assert.ok(restored.ok); if (!restored.ok) throw Error(restored.error);
assert.equal(restored.thing.crystal.text, 'Independent content 🥰'); assert.equal(restored.thing.folderId, map(child.shareId)); assert.equal(restored.thing.crystal.parentId, map(datum.shareId)); assert.equal(restored.thing.crystal.schemaId, map(schema.shareId));
assert.equal(restored.thing.executionHeld, false); assert.equal((await getThing(user!, map(outside.shareId))).ok, false);
const action = await getThing(user!, map(actionA.shareId)); assert.ok(action.ok); if (action.ok) assert.equal(action.thing.crystal.steps[0].action, map('source-action-b'));
const fileReview = { format: 'thingtime-selected-file-restore-v1' as const, operationId: reviewJob.id, sourceSealHash: rootState.sourceSealHash, graphHash: rootState.fileGraphHash, count: rootState.fileCommands, destination: rootState.destination };
const targetFileId = accountFileRestoreTargetId(fileReview, fileId);
const fileResponse = await filesRoute.loader({ request: request(cookie, '/api/v1/files?id=' + targetFileId) } as any), restoredFile = (await fileResponse.json()).file; assert.equal(fileResponse.status, 200);
assert.equal(restoredFile.folderId, map(child.shareId));
const binary = await contentRoute.loader({ request: request(cookie, '/api/v1/attachments/content?id=' + restoredFile.content.attachmentId) } as any);
assert.equal(binary.status, 302); const storedBytes = await handleLocalAttachmentStorageRequest(new Request(binary.headers.get('location')!)); assert.equal(storedBytes.status, 200); assert.deepEqual(new Uint8Array(await storedBytes.arrayBuffer()), currentBytes);
const historyResponse = await timelineRoute.loader({ request: request(cookie, '/api/v1/timeline?' + new URLSearchParams({ownerId:user!.id,dataPlane:'home',thingId:targetFileId})) } as any), history = await historyResponse.json(); assert.equal(historyResponse.status, 200);
const historyRows = history.entries ?? history.page?.entries ?? [];
const original = historyRows.find((row:any) => row.event.id === accountFileRestoreHistoryId(fileReview, oldFile.revision))?.event; assert.ok(original); assert.equal(original.source,'system');
const retained = original.after.value.content;
const retainedApproval = await contentRoute.action({request:request(cookie,'/api/v1/attachments/content',{versions:[{id:retained.attachmentId,version:retained.version}]})} as any); assert.equal(retainedApproval.status,200);
const retainedResponse = await contentRoute.loader({request:request(cookie,'/api/v1/attachments/content?'+new URLSearchParams({id:retained.attachmentId,version:retained.version,range:'1',retained:'1',offset:'0',length:String(retained.size)}))} as any); assert.equal(retainedResponse.status,206); assert.deepEqual(new Uint8Array(await retainedResponse.arrayBuffer()),oldBytes);
const branchesResponse = await timelineRoute.loader({request:request(cookie,'/api/v1/timeline?'+new URLSearchParams({ownerId:user!.id,dataPlane:'home',thingId:targetFileId,branches:'1'}))} as any); assert.equal(branchesResponse.status,200); const branches=await branchesResponse.json(); assert.ok(branches.branches.some((branch:any)=>branch.branch?.name==='Original alternative'||branch.name==='Original alternative'));
async function historyEntry(eventId:string){const response=await timelineRoute.loader({request:request(cookie,'/api/v1/timeline?'+new URLSearchParams({ownerId:user!.id,dataPlane:'home',thingId:targetFileId,eventId}))}as any);assert.equal(response.status,200);return response.json();}
const oldAnnotated=await historyEntry(accountFileRestoreHistoryId(fileReview,oldFile.revision));
const currentAnnotated=await historyEntry(accountFileRestoreHistoryId(fileReview,currentFile.revision));
assert.ok(oldAnnotated.notes.some((note:any)=>note.id===accountFileRestoreNoteId(fileReview,sourceNote)&&note.text===sourceNoteText&&note.author==='owner'));
assert.ok(currentAnnotated.notes.some((note:any)=>note.id===accountFileRestoreNoteId(fileReview,sourceLopuNote)&&note.text===sourceLopuText&&note.author==='lopu'));
assert.equal(oldAnnotated.names.length,0,'Original clear remains cleared');assert.equal(currentAnnotated.names[0].name,sourceCurrentLabel);
const clearAnnotated=await historyEntry(accountFileRestoreHistoryId(fileReview,sourceClear.entry.event.id));assert.ok(clearAnnotated.notes.some((note:any)=>note.text===clearNote.text));assert.equal(clearAnnotated.entry.event.before.value.name,sourceClearedLabelText);
// A real cleared destination tombstone advances a later naming lifecycle; it
// must not be indistinguishable from never having had a label.
const renamedAfterClear=await callTimeline({command:'name-version',operationId:randomUUID(),thingId:targetFileId,eventId:accountFileRestoreHistoryId(fileReview,oldFile.revision),name:'Owner label after restore',expectedRevision:0});assert.ok(renamedAfterClear.name.revision>2);
await callTimeline({command:'remove-note',operationId:randomUUID(),noteId:accountFileRestoreNoteId(fileReview,sourceNote)});
await callTimeline({command:'name-version',operationId:randomUUID(),thingId:targetFileId,eventId:accountFileRestoreHistoryId(fileReview,currentFile.revision),name:'Owner renamed after restore',expectedRevision:currentAnnotated.names[0].revision});
const replayJob=await jobs.admit(request(cookie),{requestId:randomUUID(),operation:{kind:'restore',reviewJobId:reviewJob.id,reviewHash:review.hash},destinationBinding:binding});await run(replayJob);
const laterOld=await historyEntry(accountFileRestoreHistoryId(fileReview,oldFile.revision)),laterCurrent=await historyEntry(accountFileRestoreHistoryId(fileReview,currentFile.revision));assert.equal(laterOld.notes.some((note:any)=>note.id===accountFileRestoreNoteId(fileReview,sourceNote)),false);assert.equal(laterOld.names[0].name,'Owner label after restore');assert.equal(laterCurrent.names[0].name,'Owner renamed after restore');
const singleDest = await createThing(user!.id,{thingtime:['folder'],crystal:{name:'Single file destination'}},user!);assert.ok(singleDest.ok);if(!singleDest.ok)throw Error(singleDest.error);
const singleReview = await jobs.admit(request(cookie),{requestId:randomUUID(),operation:{kind:'review',sourceJobId:snapshotJob.id,sourceRootId:fileId,destinationId:singleDest.doc.shareId,destinationRevision:singleDest.doc.timelineHeadId!},destinationBinding:binding});
await run(singleReview);
const singleMetadataLease=(await jobs.claim(readJob.id)).lease!;
let singleProjection:any,singleState:any;
await jobs.withLease(singleMetadataLease,async ctx=>{const completed=await ctx.completedSource(singleReview.id,'review');singleProjection=await readAccountRestoreReview(ctx,await deps(ctx),completed);singleState=await immutableReferenceIndex(store,`restore-plans/${singleReview.id}/references`,ctx.guard).readState(completed.cursor.restoreStateHash!);});
assert.equal(singleProjection.executable,true,singleProjection.coverage);assert.equal(singleState.files,1);assert.equal(singleState.ordered,2,'Only the selected file and its folder/history closure');
const singleRestore=await jobs.admit(request(cookie),{requestId:randomUUID(),operation:{kind:'restore',reviewJobId:singleReview.id,reviewHash:singleProjection.hash},destinationBinding:binding});await run(singleRestore);
const singleFileReview={format:'thingtime-selected-file-restore-v1' as const,operationId:singleReview.id,sourceSealHash:singleState.sourceSealHash,graphHash:singleState.fileGraphHash,count:singleState.fileCommands,destination:singleState.destination};
const singleFileResponse=await filesRoute.loader({request:request(cookie,'/api/v1/files?id='+accountFileRestoreTargetId(singleFileReview,fileId))}as any);assert.equal(singleFileResponse.status,200);const singleFile=(await singleFileResponse.json()).file;assert.deepEqual(singleFile.content.fingerprint,currentFile.content.fingerprint);assert.notEqual(singleFile.content.attachmentId,restoredFile.content.attachmentId);
const raceDest=await createThing(user!.id,{thingtime:['folder'],crystal:{name:'Annotation epoch race destination'}},user!);assert.ok(raceDest.ok);if(!raceDest.ok)throw Error(raceDest.error);
const raceReview=await jobs.admit(request(cookie),{requestId:randomUUID(),operation:{kind:'review',sourceJobId:snapshotJob.id,sourceRootId:fileId,destinationId:raceDest.doc.shareId,destinationRevision:raceDest.doc.timelineHeadId!},destinationBinding:binding});await run(raceReview);
const raceMetadataLease=(await jobs.claim(readJob.id)).lease!;let raceProjection:any;
await jobs.withLease(raceMetadataLease,async ctx=>{raceProjection=await readAccountRestoreReview(ctx,await deps(ctx),await ctx.completedSource(raceReview.id,'review'));});assert.equal(raceProjection.executable,true,raceProjection.coverage);
const raceRestore=await jobs.admit(request(cookie),{requestId:randomUUID(),operation:{kind:'restore',reviewJobId:raceReview.id,reviewHash:raceProjection.hash},destinationBinding:binding});
let racedNoteId:string|null=null;
beforeFileCompletion=async state=>{const reviewed={format:'thingtime-selected-file-restore-v1' as const,operationId:state.reviewId,sourceSealHash:state.sourceSealHash,graphHash:state.fileGraphHash,count:state.fileCommands,destination:state.destination};racedNoteId=accountFileRestoreNoteId(reviewed,sourceNote);await callTimeline({command:'remove-note',operationId:randomUUID(),noteId:racedNoteId});};
await assert.rejects(run(raceRestore),/changed during final verification/);assert.equal(beforeFileCompletion,null,'actual owner note removal occurred after bounded verification');
now+=100000;const racePauseLease=(await jobs.claim(raceRestore.id)).lease!;await jobs.finish(racePauseLease,{kind:'pause',issue:'destination-changed'});assert.equal((await jobs.current(request(cookie),raceRestore.id)).status,'needs-attention');
const edit = await updateThing(user!, map(datum.shareId), { crystal: { ...restored.thing.crystal, text: 'Later owner edit' } }); assert.equal(edit.ok, true);
assert.equal((await jobs.current(request(cookie), restoreJob.id)).status, 'completed');
now+=100000;const revokedLease=(await jobs.claim(readJob.id)).lease!;
assert.equal((await logout.action({ request: request(cookie, '/api/v1/auth/logout', {}) } as any)).status, 200);
assert.equal(await getCurrentUser(request(cookie)), null);
await assert.rejects(jobs.withLease(revokedLease, async ctx => runAccountRestoreStep(ctx, await deps(ctx))));
await rm(join(directory!, 'independent'), { recursive: true, force: true });
console.log(JSON.stringify({ restoreStepsProof: { steps, maxStepMs: Math.round(maxMs), selected: rootState.ordered, paused, lostCursorReply, lostEffectReply, lostFileEffectReply, lostNoteEffectReply, lostLabelEffectReply, independentReadback: true, actionCycle: true, fileHistory: true, fileBytes: true, selectedFileRoot: true, exactNotesAndLabels:true,lopuAuthorship:true,clearTombstone:true,ownerAnnotationEditsPreserved:true,annotationEpochRaceRefused:true, originalHistoryImported: false, wholeAccountReady: false } }));

process.exit(0);
