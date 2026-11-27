import { hasRelationalAclEntries, rootAcl } from '../things/relationalAcl';
import { createHash } from 'node:crypto';
import { capabilitySatisfies, thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';
import { validSyncPath } from '../../../fileSync/reconcile';
import { accountRestoreDestination, type AccountRestoreDestination } from '../../../backups/accountRestore';
import { canonicalJsonBytes } from '../../../utils/canonicalJsonStream';
import { parseCloudFile, type CloudFile } from '../../../fileSync/cloudFile';
import { joinTimelineEvent, type TimelineLink } from '../../../timeline/records';
import { folderPlacementValue } from '../../../timeline/folderPlacement';
import { CREATION_COMPLETION_ADAPTER, attachContentExecutionHold, contentExecutionHeld } from '../things/contentExecutionGate';
import { parseTimelineNote, type TimelineNote } from '../../../timeline/notes';
import { parseTimelineVersionName, timelineVersionNameId, type TimelineVersionName } from '../../../timeline/versionNames';
import { createNoteService, readTimelineNotes } from '../timeline/notes';
import { createVersionNameService, timelineVersionNameThingId, versionNameFromDoc } from '../timeline/versionNames';
import { readAccountRestoreRecord } from './accountRestoreRecord';
import { parseTimelineEvent, type TimelineEvent, type TimelineSnapshot } from '../../../timeline/contract';
import { createCloudFileService } from '../files/files';
import { fenceAccountSession } from '../auth/fenceAccountSession';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { lockFolderDestination } from '../things/folderPlacement';
import { isFolderThing } from '../../../schemas/folderThing';
import { appendTimelineEvent, readTimelineEntries, timelineEventThingId } from '../timeline/repository';
import { createBranchService } from '../timeline/branches';
import { openBackupWorkspace } from './backupWorkspace';
import { openIndexedSealedBackup, type BackupAccess, type BackupObjectStore } from './portableBackup';
import { openAccountBackupFile, openAccountBackupFileVersion, openAccountBackupTimelineRecord, type AccountBackupReader } from './accountFileRecovery';


const hash = (value: unknown) => { const h = createHash('sha256'); for (const part of canonicalJsonBytes(value)) h.update(part); return h.digest('hex'); };
const uuid = (value: unknown) => { const h = hash(value); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const fail = (message: string): never => { throw Error(message); };
const equal = (a: unknown, b: unknown) => hash(a) === hash(b);

/** Trusted worker commands, never HTTP input or archived write authority.
 * Folders are created by the existing ordinary-graph writer, including its
 * metadata, composition remapping and execution holds. This phase reuses them. */
export type AccountFileRestoreName = { cleared: false; name: TimelineVersionName } | { cleared: true; ownerId: string; eventThingId: string; revision: number; createdAt: string; updatedAt: string };
export type AccountFileRestoreRecord =
 | { kind: 'folder'; sourceId: string; targetId: string; targetRevision: string; priorBinding: string; priorOperationId: string; priorCompletionEventId: string; parentSourceId: string | null; name: string }
 | { kind: 'current'; file: CloudFile }
 | { kind: 'version'; eventThingId: string; side: 'before' | 'after'; file: CloudFile }
 | { kind: 'history'; eventThingId: string; event: TimelineEvent }
 | { kind: 'note'; sourceThingId: string; note: TimelineNote }
 | { kind: 'version-name'; sourceThingId: string; eventId: string; thingId: string; value: AccountFileRestoreName; previousName: TimelineVersionName | null; clearEventId: string | null }
 | { kind: 'finalize-current'; sourceId: string }
 | { kind: 'branch'; branchThingId: string; headThingId: string; branch: any; head: any };
export type AccountFileRestoreReview = {
 format: 'thingtime-selected-file-restore-v1'; operationId: string;
 sourceSealHash: string; graphHash: string; count: number; destination: AccountRestoreDestination;
};
export const accountFileRestoreTargetId = (review: AccountFileRestoreReview, sourceId: string) => uuid([review.operationId, review.destination, 'file', sourceId]);
export const accountFileRestoreRecordKey = (r: AccountFileRestoreRecord) => r.kind === 'folder' ? `folder:${r.sourceId}` : r.kind === 'finalize-current' ? `finalize:${r.sourceId}` : r.kind === 'current' ? `current:${r.file.id}` : r.kind === 'version' ? `version:${accountFileRestoreContentKey(r.file)}` : r.kind === 'history' ? `history:${r.event.id}` : r.kind === 'note' ? `note:${r.note.id}` : r.kind === 'version-name' ? `version-name:${r.eventId}` : `branch:${hash([r.branch.id, r.head.thingId])}`;
export const accountFileRestoreContentKey = (file: CloudFile) => hash([file.id, file.content.attachmentId, file.content.version]);
export const accountFileRestoreNoteId = (review: AccountFileRestoreReview, note: TimelineNote) => `note-${accountFileRestoreCommandId(review, {kind:'note',sourceThingId:'unused',note})}`;
export const accountFileRestoreHistoryId = (review: AccountFileRestoreReview, sourceId: string) => `restore-files-${hash([review.destination.scope.ownerId, review.operationId, 'history', sourceId])}`;
export const accountFileRestoreBranchId = (review: AccountFileRestoreReview, sourceId: string) => `branch-${uuid([hash(review), 'branch', sourceId])}`;
export const accountFileRestoreCommandId = (review: AccountFileRestoreReview, record: AccountFileRestoreRecord) => uuid([hash(review), accountFileRestoreRecordKey(record)]);
export async function accountFileRestoreGraphHash(records: AsyncIterable<AccountFileRestoreRecord>) {
 const h = createHash('sha256'); let count = 0;
 for await (const record of records) { for (const part of canonicalJsonBytes(record)) h.update(part); h.update('\n'); if (!Number.isSafeInteger(++count)) fail('Restore count is not exact'); }
 return { graphHash: h.digest('hex'), count };
}
export const ACCOUNT_FILE_RESTORE_REQUIREMENTS = { 'api.files': '1.12.1', 'api.things-bulk': '1.7.1', 'api.things-delete': '1.1.1', 'api.things': '1.52.0', 'api.timeline': '1.19.3', 'api.attachment-content': '1.18.0' } as const;
const validateReview = (input: AccountFileRestoreReview) => {
 if (!input || Object.keys(input).sort().join(',') !== 'count,destination,format,graphHash,operationId,sourceSealHash' ||
 input.format !== 'thingtime-selected-file-restore-v1' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.operationId) ||
 ![input.graphHash, input.sourceSealHash].every(v => /^[a-f0-9]{64}$/.test(v)) || !Number.isSafeInteger(input.count) || input.count < 1) fail('Invalid file restore review');
 const destination = accountRestoreDestination(input.destination), available = thingtimeCapabilityManifest(destination.scope.apiOrigin).features;
 for (const [feature, minimum] of Object.entries(ACCOUNT_FILE_RESTORE_REQUIREMENTS)) if (!capabilitySatisfies(destination.capabilities[feature] ?? '', minimum) || !capabilitySatisfies(available[feature]?.version ?? '', destination.capabilities[feature])) fail('The reviewed file restore capability contract changed');
 return { ...input, destination };
};

export type AccountFileRestoreStage = (input: {
 record: Extract<AccountFileRestoreRecord, { kind: 'current' | 'version' }>;
 destinationScope: AccountRestoreDestination['scope']; signal?: AbortSignal; reader: AccountBackupReader; rootId: string; targetId: string; operationId: string; folderId: string; path: string; name: string;
}) => Promise<CloudFile['content']>;

export type AccountFileRestoreFolder = Extract<AccountFileRestoreRecord, { kind: 'folder' }>;
/** Trusted certified immutable-plan adapter. No request can supply lookups. */
export type AccountFileRestoreLookup = {
 folder(id: string): Promise<AccountFileRestoreFolder | null>;
 current(id: string): Promise<CloudFile>;
 bytes(file: CloudFile): Promise<{ commandKey: string } | null>;
 branchFirst(id: string): Promise<number>;
};
/** Shared canonical bounded file/history transaction writer. Review discovery,
 * byte verification and uploads are separate bounded preparation steps. Every
 * mutation, receipt and scalar progress advance is the existing Files/Timeline
 * transaction under the current original session and job lease fence. */
export async function openReviewedAccountFileRestoreWriter(request: Request, input: AccountFileRestoreReview, lookup: AccountFileRestoreLookup) {
 const review = validateReview(input), destination = review.destination, owner = destination.scope.ownerId, binding = hash(review);
 if (isCustomMongoEndpointActive() || new URL(request.url).origin !== destination.scope.apiOrigin) fail('File restore requires the reviewed home origin');
 const things = await getHomeThingsCollection(), files = createCloudFileService();
 const eid = (type: string, identity = '') => `restore-files-${hash([owner, review.operationId, type, identity])}`;
 const historyId = (id: string) => accountFileRestoreHistoryId(review, id);
 const branchId = (id: string) => accountFileRestoreBranchId(review, id);
 const operationId = (identity: string) => uuid([binding, identity]);
 const root = async (session: any, completed = false) => {
  request.signal.throwIfAborted();
  await fenceAccountSession(request, owner, session);
  const doc = await things.findOne({ shareId: destination.rootId }, { session });
  if (!doc || doc.ownerId !== owner || !isFolderThing(doc) || doc.appId != null || doc.sandbox != null || doc.sandboxSpace != null || doc.crystal?.trashed ||
   hasRelationalAclEntries(doc) || !Array.isArray(doc.acl) || rootAcl(doc).length !== 1 || rootAcl(doc)[0] !== 'tt:user') fail('Choose the reviewed owned private destination');
  if (!completed && doc.timelineHeadId !== destination.rootRevision) fail('The reviewed destination revision changed');
  return doc;
 };
 const readReceipt = async (id: string, session: any) => {
  const event = (await readTimelineEntries(things, owner, [id], session))[0]?.event;
  if (!event) return null;
  if (event.id !== id || event.operation !== 'effect' || event.clientId !== null || event.thingId !== destination.rootId || event.ownerId !== owner || event.actorId !== owner || event.operationId !== review.operationId || event.source !== 'api' ||
   event.mode !== 'effect' || event.branchId !== 'main' || event.parentIds.length || event.dependencies.length || event.before !== null ||
   event.after?.adapter !== (id === eid('complete') ? CREATION_COMPLETION_ADAPTER : 'reviewed-file-restore') || event.after.version !== 1 || (event.after.value as any)?.binding !== binding) fail('Restore receipt identity changed');
  return event.after.value as any;
 };
 const append = async (id: string, value: any, session: any) => appendTimelineEvent(things, parseTimelineEvent({
  formatVersion: 1, id, ownerId: owner, thingId: destination.rootId, branchId: 'main', parentIds: [], operationId: review.operationId,
  actorId: owner, source: 'api', clientId: null, occurredAt: new Date().toISOString(), mode: 'effect', operation: 'effect', label: 'Restoring saved files',
  before: null, after: { adapter: id === eid('complete') ? CREATION_COMPLETION_ADAPTER : 'reviewed-file-restore', version: 1, value: { binding, ...value } }, dependencies: []
 }), session, { plane: 'home' });

 const hold = { version: 1 as const, operationId: review.operationId, completionEventId: eid('complete'), rootId: destination.rootId, binding };
  const folder = async (id: string | null): Promise<string> => id === null ? destination.rootId : String((await lookup.folder(id))?.targetId ?? fail('A source parent folder is unavailable'));
  const folderPath = async (id: string | null): Promise<string> => {
   const names: string[] = [], seen = new Set<string>();
   while (id !== null) { if (seen.has(id)) fail('Folder cycle'); seen.add(id); const row = await lookup.folder(id); if (!row) fail('Missing source folder'); names.unshift(String(row.name)); id = row.parentSourceId as string | null; }
   const path = names.join('/'); if (path && !validSyncPath(path)) fail('The reviewed folder path is invalid'); return path;
  };
  const checkFolders = async (session: any, selected?: (string | null)[]) => {
   const wanted = selected ? new Set<string>() : null;
   for (let id of selected ?? []) while (id !== null) { if (wanted!.has(id)) break; wanted!.add(id); const row = await lookup.folder(id); if (!row) fail('Missing reviewed folder'); id = row.parentSourceId as string | null; }
   // Folder maps are private scratch, not authority. Every placement is verified
   // from live owned records in the same transaction as its dependent effect.
   const rows = []; for (const id of wanted ?? []) rows.push(await lookup.folder(id));
   for (const row of rows) {
    if (!row) fail('Missing reviewed folder');
    if (wanted && !wanted.has(String(row.sourceId))) continue;
    const doc = await things.findOne({ shareId: row.targetId }, { session });
    if (!doc || doc.ownerId !== owner || !isFolderThing(doc) || doc.appId != null || doc.sandbox != null || doc.sandboxSpace != null || doc.crystal?.trashed ||
     hasRelationalAclEntries(doc) || !Array.isArray(doc.acl) || rootAcl(doc).length !== 1 || rootAcl(doc)[0] !== 'tt:user' || doc.timelineHeadId !== row.targetRevision || (doc.executionHold && (doc.executionHold.rootId !== destination.rootId || ![binding, row.priorBinding].includes(doc.executionHold.binding))) || doc.crystal?.name !== row.name || (doc.folderId ?? null) !== await folder(row.parentSourceId as string | null)) fail('A restored folder changed before publication');
    const created = (await readTimelineEntries(things, owner, [String(row.targetRevision)], session))[0]?.event;
    if (!created || created.thingId !== row.targetId || created.actorId !== owner || created.source !== 'api' || created.operationId !== row.priorOperationId) fail('The reviewed folder has no matching restore provenance');
    const priorHold = { version: 1 as const, operationId: String(row.priorOperationId), completionEventId: String(row.priorCompletionEventId), rootId: destination.rootId, binding: String(row.priorBinding) };
    if (await contentExecutionHeld({ ownerId: owner, executionHold: priorHold }, things, session)) fail('The earlier folder restore is incomplete');
    await lockFolderDestination(things, owner, String(row.targetId), session);
   }
  };
  const checkpoint = async (session: any) => {
   const doc = await root(session), c = doc.creationCheckpoint;
   if (c && c.binding !== binding && c.phase !== 'complete') fail('Another restore owns this destination');
   if (c?.binding === binding && (c.version !== 1 || !['restoring','complete'].includes(c.phase) || c.planned !== review.count || !Number.isSafeInteger(c.contentEpoch ?? 0) || (c.contentEpoch ?? 0) < 0 || c.operationId !== review.operationId || c.count !== review.count || c.chain !== review.graphHash || !Number.isSafeInteger(c.applied) || c.applied < 0 || c.applied > review.count)) fail('Invalid file restore checkpoint');
   return c?.binding === binding ? c.applied : 0;
  };
  const advance = async (applied: number, session: any, complete = false) => {
   const prior = await things.findOne({ shareId: destination.rootId, ownerId: owner }, { session, projection: { creationCheckpoint: 1 } });
   const contentEpoch = prior?.creationCheckpoint?.binding === binding ? prior.creationCheckpoint.contentEpoch ?? 0 : 0;
   const result = await things.updateOne({ shareId: destination.rootId, ownerId: owner, timelineHeadId: destination.rootRevision }, { $set: {
    folderMutationToken: uuid([binding, applied]), creationCheckpoint: { version: 1, operationId: review.operationId, binding, phase: complete ? 'complete' : 'restoring', planned: review.count, applied, count: review.count, chain: review.graphHash, contentEpoch }
   } }, { session });
   if (result.matchedCount !== 1) fail('The destination changed before checkpoint publication');
  };
  const mappedContent = async (file: CloudFile, session: any) => {
   const row = await lookup.bytes(file);
   if (!row) return fail('History bytes have no reviewed publication');
   const receipt = await readReceipt(eid('step', String(row.commandKey)), session);
   if (!receipt?.file?.content) return fail('History bytes have no accepted publication');
   return parseCloudFile(receipt.file).content;
  };
  const checkCurrent = async (sourceId: string, session: any) => {
   const accepted = await readReceipt(eid('step', `finalize:${sourceId}`), session) ?? await readReceipt(eid('step', `current:${sourceId}`), session);
   const doc = await things.findOne({ shareId: accountFileRestoreTargetId(review, sourceId) }, { session });
   if (!doc || doc.ownerId !== owner || !accepted?.file || !equal(parseCloudFile({ id: doc.shareId, revision: doc.timelineHeadId, name: doc.crystal?.name, folderId: doc.folderId ?? null, trashed: doc.crystal?.trashed, content: doc.crystal?.content, ...(doc.crystal?.symbolicLink ? { symbolicLink: doc.crystal.symbolicLink } : {}) }), accepted.file)) fail('The restored file changed; preserve the owner edit');
  };

 return {
  review, binding, folder, folderPath,
  async completed() { const accepted = await withHomeMongoTransaction(async session => { await root(session, true); return readReceipt(eid('complete'), session); });
   return accepted ? { replayed: true, count: review.count, eventId: eid('complete') } : null; },
  async admit() { await withHomeMongoTransaction(async session => { await checkpoint(session); if (!await readReceipt(eid('admission'), session)) { await append(eid('admission'), { review }, session); await advance(0, session); } }); },
  async verifyFolder(id: string) { await withHomeMongoTransaction(async session => { await checkpoint(session); await checkFolders(session, [id]); }); },
  async verifyFile(id: string) { await withHomeMongoTransaction(async session => { await checkpoint(session); await checkCurrent(id, session); }); },
  async receipt(record: AccountFileRestoreRecord, ordinal: number) { return withHomeMongoTransaction(async session => {
   const count = await checkpoint(session), receipt = await readReceipt(eid('step', accountFileRestoreRecordKey(record)), session);
   if (ordinal < count && !receipt) fail('A committed restore receipt is missing'); return receipt;
  }); },
  async verifyAnnotation(r: Extract<AccountFileRestoreRecord,{kind:'note'|'version-name'}>) {
   await withHomeMongoTransaction(async session=>{
    await checkpoint(session);
    const accepted=await readReceipt(eid('step',accountFileRestoreRecordKey(r)),session);if(!accepted)fail('An imported annotation has no accepted receipt');
    if(r.kind==='note'){
     const notes=await readTimelineNotes(things,owner,[historyId(r.note.eventId)],session), actual=notes.find(n=>n.id===accountFileRestoreNoteId(review,r.note));
     if(!actual||!equal(actual,accepted.note))fail('The restored note was edited or removed; preserve the owner change');
    }else{
     const doc=await things.findOne({shareId:timelineVersionNameThingId(owner,historyId(r.eventId)),ownerId:owner,thingtime:'timeline-version-name'},{session});
     const actual=doc?(doc.timelineVersionNameCleared?{cleared:true,revision:doc.nameRevision}:{cleared:false,name:versionNameFromDoc(doc)}):null;
     if(!equal(actual,accepted.nameState))fail('The restored version label changed; preserve the owner edit');
    }
   });
  },
  async apply(r: AccountFileRestoreRecord, index: number, content?: CloudFile['content']) {
   const identity = accountFileRestoreRecordKey(r);
   if (!Number.isSafeInteger(index) || index < 0 || index >= review.count) fail('Invalid certified file ordinal');
   if ((r.kind === 'current' || r.kind === 'version') && (!content || content.size !== r.file.content.size || !equal(content.fingerprint, r.file.content.fingerprint))) fail('Uploaded restore bytes differ from the source');
   await withHomeMongoTransaction(async session => {
    const applied = await checkpoint(session);
    if (await readReceipt(eid('step', identity), session)) return;
    if (applied !== index) fail('Restore progress changed; retry the original operation');
    const selectedFolders: (string | null)[] = r.kind === 'folder' ? [r.sourceId] : r.kind === 'current' || r.kind === 'version' ? [r.file.folderId] : r.kind === 'history' ? [r.event.before, r.event.after].filter(s => s && s.adapter !== 'timeline-version-name').map(s => ['folder-placement', 'managed-folder-placement'].includes(s!.adapter) ? folderPlacementValue(s!).folderId : parseCloudFile(s!.value).folderId) : [];
    await checkFolders(session, selectedFolders);
    let result: any = {};
    if (r.kind === 'folder') {
     const doc = await things.findOne({ shareId: r.targetId, ownerId: owner }, { session });
     await attachContentExecutionHold(things, doc, hold, session);
    }
    if (r.kind === 'current' || r.kind === 'version') {
     const current = await lookup.current(r.file.id);
     const targetId = accountFileRestoreTargetId(review, current.id);
     const acceptedCurrent = r.kind === 'version' ? await readReceipt(eid('step', `current:${current.id}`), session) : null;
     const value = { id: targetId, operationId: operationId(identity), expectedRevision: acceptedCurrent?.file.revision ?? null, name: current.name, folderId: await folder(current.folderId),
      attachmentId: content!.attachmentId, contentVersion: content!.version, trashed: false, ...(r.file.symbolicLink ? { symbolicLink: r.file.symbolicLink } : {}), ...(r.kind === 'version' ? { kind: 'retained-version' } : { syncDestination: { rootId: destination.rootId, path: [await folderPath(current.folderId), current.name].filter(Boolean).join('/') } }) };
     result = await files.commit(owner, value, { session, executionHold: hold, consumeImportDraft: true, auditLabel: r.kind === 'version' ? 'Retained restored file bytes' : 'Restored file from backup' }); if (result.ok === false) fail(result.error);
    } else if (r.kind === 'finalize-current') {
     await checkCurrent(r.sourceId, session);
     const accepted = await readReceipt(eid('step', `current:${r.sourceId}`), session), file = parseCloudFile(accepted.file);
     const original = await lookup.current(r.sourceId);
     await checkFolders(session, [original.folderId]);
     result = await files.commit(owner, { id: file.id, operationId: operationId(identity), expectedRevision: file.revision, name: file.name, folderId: file.folderId, attachmentId: file.content.attachmentId, contentVersion: file.content.version, trashed: true, ...(file.symbolicLink ? { symbolicLink: file.symbolicLink } : {}) }, { session, auditLabel: 'Restored file Trash state' });
     if (result.ok === false) fail(result.error);
    } else if (r.kind === 'history') {
     await checkCurrent(r.event.thingId, session);
     const targetId = accountFileRestoreTargetId(review, r.event.thingId);
     const live = await things.findOne({ shareId: targetId, ownerId: owner }, { session });
     const currentReceipt = await readReceipt(eid('step', `current:${r.event.thingId}`), session);
     if (!live || live.timelineHeadId !== currentReceipt?.file.revision) fail('The restored file changed before history publication');
     const snapshot = async (s: TimelineSnapshot | null): Promise<TimelineSnapshot | null> => {
      if (!s) return null;
      if (['folder-placement', 'managed-folder-placement'].includes(s.adapter)) return { ...s, value: { folderId: await folder(folderPlacementValue(s).folderId) } };
      if (s.adapter === 'timeline-version-name' && s.version === 1) {
       const name = parseTimelineVersionName(s.value), eventId = historyId(name.eventId);
       return { adapter: s.adapter, version: 1, value: { ...name, id: timelineVersionNameId(eventId), ownerId: owner, eventId, thingId: targetId } };
      }
      const file = parseCloudFile(s.value);
      return { adapter: 'file-content', version: 1, value: { ...file, id: targetId, revision: historyId(file.revision), folderId: await folder(file.folderId), content: await mappedContent(file, session) } as any };
     };
     const event = parseTimelineEvent({ ...r.event, id: historyId(r.event.id), ownerId: owner, actorId: owner, source: 'system', clientId: null,
      operationId: operationId(identity), thingId: targetId, branchId: branchId(r.event.branchId), parentIds: r.event.parentIds.map(historyId), dependencies: r.event.dependencies.map(d => ({thingId:targetId,eventId:historyId(d.eventId)})), before: await snapshot(r.event.before), after: await snapshot(r.event.after) });
     await appendTimelineEvent(things, event, session, { plane: 'home' }); result = { eventId: event.id };
    } else if (r.kind === 'note') {
     const original = parseTimelineNote(r.note), eventId = historyId(original.eventId), thingId = accountFileRestoreTargetId(review, original.thingId);
     await checkCurrent(original.thingId, session);
     // These are approved archived words, not a request for a new model call.
     // Canonical note storage preserves the supported owner/Lopu authorship.
     const service = createNoteService({ collection: async () => things, transaction: async work => work(session), explain: async () => original.text });
     const command = { operationId: operationId(identity), eventId, thingId };
     const saved = original.author === 'lopu' ? await service(owner, { command:'explain-change', ...command }) : await service(owner, { command:'add-note', ...command, text:original.text });
     const note='note' in saved?saved.note:fail('The canonical note was not stored');
     if(note.text!==original.text||note.author!==original.author)fail('The restored note changed');
     result = { note, sourceNote:original };
    } else if (r.kind === 'version-name') {
     await checkCurrent(r.thingId, session);
     const eventId = historyId(r.eventId), thingId = accountFileRestoreTargetId(review, r.thingId);
     const prior = await things.findOne({shareId:timelineVersionNameThingId(owner,eventId),ownerId:owner,thingtime:'timeline-version-name'},{session});
     if (prior) fail('The restored version label was edited; preserve the owner change');
     const service = createVersionNameService({collection:async()=>things,transaction:async work=>work(session)});
     if (r.value.cleared === true) {
      if (!r.previousName || !r.clearEventId || r.previousName.eventId !== r.eventId || r.previousName.thingId !== r.thingId || r.previousName.revision + 1 !== r.value.revision) fail('The reviewed clear predecessor is missing');
      const historical = (await readTimelineEntries(things,owner,[historyId(r.clearEventId)],session))[0]?.event;
      if (!historical || historical.thingId !== thingId || historical.before?.adapter !== 'timeline-version-name' || historical.after !== null || !historical.dependencies.some(d=>d.thingId===thingId&&d.eventId===eventId) || parseTimelineVersionName(historical.before.value).name !== r.previousName.name) fail('The original label clear is outside the imported graph');
      const seeded = await service(owner,{command:'name-version',operationId:uuid([binding,identity,'prior']),eventId,thingId,name:r.previousName.name,expectedRevision:0});
      if (!seeded.name) fail('The canonical label predecessor was not stored');
      await service(owner,{command:'name-version',operationId:operationId(identity),eventId,thingId,name:null,expectedRevision:seeded.name.revision});
     } else {
      const name = parseTimelineVersionName(r.value.name);
      if (name.eventId !== r.eventId || name.thingId !== r.thingId) fail('The original version label target changed');
      await service(owner,{command:'name-version',operationId:operationId(identity),eventId,thingId,name:name.name,expectedRevision:0});
     }
     const saved = await things.findOne({shareId:timelineVersionNameThingId(owner,eventId),ownerId:owner,thingtime:'timeline-version-name'},{session});
     if (!saved || Boolean(saved.timelineVersionNameCleared) !== r.value.cleared) fail('The restored version label state changed');
     result = { nameState: saved.timelineVersionNameCleared ? {cleared:true,revision:saved.nameRevision} : {cleared:false,name:versionNameFromDoc(saved)}, sourceName:r.value };
    } else if (r.kind === 'branch') {
     await checkCurrent(r.head.thingId, session);
     const service = createBranchService({ transaction: async work => work(session) });
     const first = (await lookup.branchFirst(r.branch.id)) === index;
     result = await service(owner, { command: first ? 'create-branch' : 'advance-branch', operationId: operationId(identity), branchId: branchId(r.branch.id), thingId: accountFileRestoreTargetId(review, r.head.thingId), eventId: historyId(r.head.eventId), expectedRevision: 0, name: first ? r.branch.name : null });
    }
    await append(eid('step', identity), { identity, ...(result.file ? { file: result.file } : {}), ...(result.eventId ? { eventId: result.eventId } : {}), ...(result.note ? {note:result.note,sourceNote:result.sourceNote} : {}), ...(result.nameState ? {nameState:result.nameState,sourceName:result.sourceName} : {}) }, session);
    await advance(index + 1, session);
   });

  },
  async epoch() { return withHomeMongoTransaction(async session => { await checkpoint(session); return (await root(session)).creationCheckpoint.contentEpoch ?? 0; }); },
  async complete(epoch: number) { await withHomeMongoTransaction(async session => {
   if (await checkpoint(session) !== review.count) fail('The file graph is incomplete');
   const doc = await root(session); if ((doc.creationCheckpoint.contentEpoch ?? 0) !== epoch) fail('Restored content changed during final verification');
   await append(eid('complete'), { count: review.count }, session); await advance(review.count, session, true);
  }); return { replayed: false, count: review.count, eventId: eid('complete') }; }
 };
}

/** Each effect, receipt and scalar checkpoint commits together under the current
 * account session and reviewed root. Caller bytes use the normal upload route;
 * no archived receipt grants live write authority. Completed replay needs no
 * source vault. Current owner edits always win over an unfinished restore. */
export async function executeAccountFileRestore(
 request: Request, input: AccountFileRestoreReview,
 source: { store: BackupObjectStore; snapshotId: string; access: BackupAccess },
 records: () => AsyncIterable<AccountFileRestoreRecord>, stage: AccountFileRestoreStage,
 options: { afterCommit?(ordinal: number): Promise<void>; beforeCompletion?(): Promise<void> } = {}
) {
 const review = validateReview(input), destination = review.destination, owner = destination.scope.ownerId, binding = hash(review);
 if (isCustomMongoEndpointActive() || new URL(request.url).origin !== destination.scope.apiOrigin) fail('File restore requires the reviewed home origin');
 const things = await getHomeThingsCollection(), files = createCloudFileService();
 const eid = (type: string, identity = '') => `restore-files-${hash([owner, review.operationId, type, identity])}`;
 const historyId = (id: string) => accountFileRestoreHistoryId(review, id);
 const branchId = (id: string) => accountFileRestoreBranchId(review, id);
 const operationId = (identity: string) => uuid([binding, identity]);
 const root = async (session: any, completed = false) => {
  request.signal.throwIfAborted();
  await fenceAccountSession(request, owner, session);
  const doc = await things.findOne({ shareId: destination.rootId }, { session });
  if (!doc || doc.ownerId !== owner || !isFolderThing(doc) || doc.appId != null || doc.sandbox != null || doc.sandboxSpace != null || doc.crystal?.trashed ||
   hasRelationalAclEntries(doc) || !Array.isArray(doc.acl) || rootAcl(doc).length !== 1 || rootAcl(doc)[0] !== 'tt:user') fail('Choose the reviewed owned private destination');
  if (!completed && doc.timelineHeadId !== destination.rootRevision) fail('The reviewed destination revision changed');
  return doc;
 };
 const readReceipt = async (id: string, session: any) => {
  const event = (await readTimelineEntries(things, owner, [id], session))[0]?.event;
  if (!event) return null;
  if (event.id !== id || event.operation !== 'effect' || event.clientId !== null || event.thingId !== destination.rootId || event.ownerId !== owner || event.actorId !== owner || event.operationId !== review.operationId || event.source !== 'api' ||
   event.mode !== 'effect' || event.branchId !== 'main' || event.parentIds.length || event.dependencies.length || event.before !== null ||
   event.after?.adapter !== (id === eid('complete') ? CREATION_COMPLETION_ADAPTER : 'reviewed-file-restore') || event.after.version !== 1 || (event.after.value as any)?.binding !== binding) fail('Restore receipt identity changed');
  return event.after.value as any;
 };
 const append = async (id: string, value: any, session: any) => appendTimelineEvent(things, parseTimelineEvent({
  formatVersion: 1, id, ownerId: owner, thingId: destination.rootId, branchId: 'main', parentIds: [], operationId: review.operationId,
  actorId: owner, source: 'api', clientId: null, occurredAt: new Date().toISOString(), mode: 'effect', operation: 'effect', label: 'Restoring saved files',
  before: null, after: { adapter: id === eid('complete') ? CREATION_COMPLETION_ADAPTER : 'reviewed-file-restore', version: 1, value: { binding, ...value } }, dependencies: []
 }), session, { plane: 'home' });
 const accepted = await withHomeMongoTransaction(async session => { await root(session, true); return readReceipt(eid('complete'), session); });
 if (accepted) return { replayed: true, count: review.count, eventId: eid('complete') };
 let activeReader: (AccountBackupReader & { close(): Promise<void> }) | undefined;
 const hold = { version: 1 as const, operationId: review.operationId, completionEventId: eid('complete'), rootId: destination.rootId, binding };
 const workspace = await openBackupWorkspace({ diskBudget: 'available' }), db = workspace.db;
 try {
  const backup = await openIndexedSealedBackup(source.store, source.snapshotId, source.access);
  activeReader = backup;
  if (hash(backup.seal) !== review.sourceSealHash) fail('The reviewed source seal changed');
  db.exec(`CREATE TABLE commands(ordinal INTEGER PRIMARY KEY,identity TEXT UNIQUE NOT NULL,value TEXT NOT NULL);
   CREATE TABLE folders(sourceId TEXT PRIMARY KEY,targetId TEXT UNIQUE NOT NULL,parentSourceId TEXT,name TEXT NOT NULL,targetRevision TEXT NOT NULL,priorBinding TEXT NOT NULL,priorOperationId TEXT NOT NULL,priorCompletionEventId TEXT NOT NULL,ordinal INTEGER NOT NULL);
   CREATE TABLE currentFiles(sourceId TEXT PRIMARY KEY,value TEXT NOT NULL,ordinal INTEGER NOT NULL);
   CREATE TABLE bytes(identity TEXT PRIMARY KEY,commandKey TEXT NOT NULL,ordinal INTEGER NOT NULL);
   CREATE TABLE events(id TEXT PRIMARY KEY,thingId TEXT NOT NULL,ordinal INTEGER NOT NULL);
   CREATE TABLE branches(id TEXT PRIMARY KEY,firstOrdinal INTEGER NOT NULL);
   CREATE TABLE sourceEvents(id TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE sourceLinks(id TEXT PRIMARY KEY,eventId TEXT NOT NULL,value TEXT NOT NULL);
   CREATE INDEX sourceLinks_event ON sourceLinks(eventId);
   CREATE TABLE sourceHeads(branchId TEXT,thingId TEXT,value TEXT NOT NULL,PRIMARY KEY(branchId,thingId));
   CREATE TABLE selectedHeads(branchId TEXT,thingId TEXT,PRIMARY KEY(branchId,thingId));
   CREATE TABLE finalizedFiles(sourceId TEXT PRIMARY KEY,ordinal INTEGER NOT NULL);
   CREATE TABLE sourceEventThings(thingId TEXT PRIMARY KEY,eventId TEXT NOT NULL);
   CREATE TABLE sourceAnnotations(thingId TEXT PRIMARY KEY,kind TEXT NOT NULL,value TEXT NOT NULL);
   CREATE TABLE selectedAnnotations(thingId TEXT PRIMARY KEY);`);
  // Current archives normalize parent/dependency links. Reconstruct from the
  // verified sealed index, never from live source history or archived receipts.
  for await (const item of backup.items()) if (item.snapshot.adapter === 'backup-timeline-record') {
   const record = await openAccountBackupTimelineRecord(source.store, source.snapshotId, item.thingId, source.access, backup);
   if (record.kind === 'timeline-event') {db.prepare('INSERT INTO sourceEvents VALUES(?,?)').run((record.value as any).event.id, JSON.stringify((record.value as any).event));db.prepare('INSERT INTO sourceEventThings VALUES(?,?)').run(item.thingId,(record.value as any).event.id);}
   if(record.kind==='timeline-note'||record.kind==='timeline-version-name')db.prepare('INSERT INTO sourceAnnotations VALUES(?,?,?)').run(item.thingId,record.kind,JSON.stringify(record.value));
   if (record.kind === 'timeline-branch-head') db.prepare('INSERT INTO sourceHeads VALUES(?,?,?)').run((record.value as any).branchId, (record.value as any).thingId, JSON.stringify(record.value));
   if (record.kind === 'timeline-link') db.prepare('INSERT INTO sourceLinks VALUES(?,?,?)').run((record.value as any).id, (record.value as any).eventId, JSON.stringify(record.value));
  }
  const sourceEvent = (id: string): TimelineEvent => {
   const row = db.prepare('SELECT value FROM sourceEvents WHERE id=?').get(id); if (!row) return fail('An archived event is missing');
   const raw = JSON.parse(String(row.value));
   return 'parentCount' in raw ? joinTimelineEvent(raw, db.prepare('SELECT value FROM sourceLinks WHERE eventId=?').all(id).map(row => JSON.parse(String(row.value)) as TimelineLink)) : parseTimelineEvent(raw);
  };
  let ordinal = 0;
  const graph = await accountFileRestoreGraphHash((async function* () {
   for await (const r of records()) {
    request.signal.throwIfAborted(); await source.access.authorize();
    const identity = accountFileRestoreRecordKey(r);
    db.prepare('INSERT INTO commands VALUES(?,?,?)').run(ordinal, identity, JSON.stringify(r));
    if (r.kind === 'folder') {
     const found = await backup.get(r.sourceId);
     const decoded = await readAccountRestoreRecord(found.item, (async function* () { for await (const bytes of found.ranges) yield { read: async () => bytes }; })(), source.access.scope.ownerId);
     const value = decoded?.value as any;
     if (!validSyncPath(r.name) || r.name.includes('/') || !equal(value.thingtime, ['folder']) || value.crystal?.name !== r.name || (value.folderId ?? null) !== r.parentSourceId || r.targetId === destination.rootId) fail('The reviewed folder source changed');
     db.prepare('INSERT INTO folders VALUES(?,?,?,?,?,?,?,?,?)').run(r.sourceId, r.targetId, r.parentSourceId, r.name, r.targetRevision, r.priorBinding, r.priorOperationId, r.priorCompletionEventId, ordinal);
    } else if (r.kind === 'current' || r.kind === 'version') {
     const found = r.kind === 'current' ? await openAccountBackupFile(source.store, source.snapshotId, r.file.id, source.access, backup) :
      await openAccountBackupFileVersion(source.store, source.snapshotId, r.eventThingId, r.side, source.access, backup);
     if (!equal(found.file, r.file)) fail('The reviewed file source changed');
     parseCloudFile(r.file);
     if (db.prepare('SELECT 1 FROM finalizedFiles WHERE sourceId=?').get(r.file.id)) fail('File bytes must precede final Trash state');
     if (r.kind === 'current') { db.prepare('INSERT INTO currentFiles VALUES(?,?,?)').run(r.file.id, JSON.stringify(r.file), ordinal); }
     else if (!db.prepare('SELECT 1 FROM currentFiles WHERE sourceId=?').get(r.file.id)) fail('Current file must precede retained bytes');
     db.prepare('INSERT INTO bytes VALUES(?,?,?)').run(accountFileRestoreContentKey(r.file), identity, ordinal);
    } else if (r.kind === 'history') {
     const found = await openAccountBackupTimelineRecord(source.store, source.snapshotId, r.eventThingId, source.access, backup);
     if (found.kind !== 'timeline-event' || !equal(sourceEvent((found.value as any).event.id), r.event)) fail('The reviewed history source changed');
     const event = parseTimelineEvent(r.event);
     if (db.prepare('SELECT 1 FROM finalizedFiles WHERE sourceId=?').get(event.thingId)) fail('History must precede final Trash state');
     if (event.ownerId !== backup.header.scope.ownerId || !db.prepare('SELECT 1 FROM currentFiles WHERE sourceId=?').get(event.thingId)) fail('History is outside the selected files');
     for (const parent of event.parentIds) { const row = db.prepare('SELECT thingId FROM events WHERE id=?').get(parent); if (row?.thingId !== event.thingId) fail('History parents must precede their same-file child'); }
     for(const dependency of event.dependencies)if(dependency.thingId!==event.thingId||db.prepare('SELECT thingId FROM events WHERE id=?').get(dependency.eventId)?.thingId!==event.thingId)fail('History dependencies must precede their same-file dependent');
     for (const snapshot of [event.before, event.after]) if (snapshot) {
      if (['folder-placement', 'managed-folder-placement'].includes(snapshot.adapter)) { folderPlacementValue(snapshot); continue; }
      if(snapshot.adapter==='timeline-version-name'&&snapshot.version===1){const name=parseTimelineVersionName(snapshot.value);if(name.ownerId!==backup.header.scope.ownerId||name.thingId!==event.thingId||db.prepare('SELECT thingId FROM events WHERE id=?').get(name.eventId)?.thingId!==event.thingId)fail('A source label snapshot targets unavailable history');continue;}
      if (snapshot.adapter !== 'file-content' || snapshot.version !== 1) fail('Unsupported file history snapshot');
      const file = parseCloudFile(snapshot.value);
      const bytes = db.prepare('SELECT ordinal FROM bytes WHERE identity=?').get(accountFileRestoreContentKey(file));
      if (file.id !== event.thingId || !bytes || Number(bytes.ordinal) >= ordinal) fail('History bytes must precede the event');
     }
     db.prepare('INSERT INTO events VALUES(?,?,?)').run(event.id, event.thingId, ordinal);
    } else if(r.kind==='note'||r.kind==='version-name'){
     const found=await openAccountBackupTimelineRecord(source.store,source.snapshotId,r.sourceThingId,source.access,backup);
     const eventId=r.kind==='note'?parseTimelineNote(r.note).eventId:r.eventId,thingId=r.kind==='note'?r.note.thingId:r.thingId;
     if(found.kind!==(r.kind==='note'?'timeline-note':'timeline-version-name')||!equal(found.value,r.kind==='note'?r.note:r.value)||db.prepare('SELECT thingId FROM events WHERE id=?').get(eventId)?.thingId!==thingId||!db.prepare('SELECT 1 FROM currentFiles WHERE sourceId=?').get(thingId))fail('A reviewed annotation is outside the exact selected history');
     if(r.kind==='note'){if(r.note.ownerId!==backup.header.scope.ownerId)fail('A source note belongs to another account');}
     else if(r.value.cleared===true){
      if(r.value.ownerId!==backup.header.scope.ownerId||r.value.eventThingId!==timelineEventThingId(backup.header.scope.ownerId,eventId)||!r.previousName||!r.clearEventId||r.previousName.eventId!==eventId||r.previousName.thingId!==thingId||r.previousName.revision+1!==r.value.revision)fail('A cleared name has no exact predecessor');
      const clear=sourceEvent(r.clearEventId);if(clear.thingId!==thingId||clear.after!==null||clear.before?.adapter!=='timeline-version-name'||!equal(clear.before.value,r.previousName)||!db.prepare('SELECT 1 FROM events WHERE id=?').get(r.clearEventId))fail('The source clear is outside the reviewed graph');
     }else if(r.value.name.ownerId!==backup.header.scope.ownerId||r.value.name.eventId!==eventId||r.value.name.thingId!==thingId||r.previousName!==null||r.clearEventId!==null)fail('A source version name targets another version');
     db.prepare('INSERT INTO selectedAnnotations VALUES(?)').run(r.sourceThingId);
    } else if (r.kind === 'branch') {
     if (db.prepare('SELECT 1 FROM finalizedFiles WHERE sourceId=?').get(r.head.thingId)) fail('Branch heads must precede final Trash state');
     const branch = await openAccountBackupTimelineRecord(source.store, source.snapshotId, r.branchThingId, source.access, backup);
     const head = await openAccountBackupTimelineRecord(source.store, source.snapshotId, r.headThingId, source.access, backup);
     if (branch.kind !== 'timeline-branch' || head.kind !== 'timeline-branch-head' || !equal(branch.value, r.branch) || !equal(head.value, r.head) || r.head.branchId !== r.branch.id ||
      db.prepare('SELECT thingId FROM events WHERE id=?').get(r.head.eventId)?.thingId !== r.head.thingId) fail('The reviewed branch source changed');
     db.prepare('INSERT OR IGNORE INTO branches VALUES(?,?)').run(r.branch.id, ordinal);
     db.prepare('INSERT INTO selectedHeads VALUES(?,?)').run(r.branch.id, r.head.thingId);
    } else {
     const current = db.prepare('SELECT value FROM currentFiles WHERE sourceId=?').get(r.sourceId);
     if (!current || JSON.parse(String(current.value)).trashed !== true) fail('Only an archived trashed current file needs finalization');
     db.prepare('INSERT INTO finalizedFiles VALUES(?,?)').run(r.sourceId, ordinal);
    }
    ordinal++; yield r;
   }
  })());
  if (graph.count !== review.count || graph.graphHash !== review.graphHash) fail('The reviewed file graph changed');
  // Selecting a file selects every recoverable archived file/placement event
  // and its branch heads. A truncated command stream cannot advertise complete
  // history merely because the subset happens to be internally closed.
  for (const row of db.prepare('SELECT id,value FROM sourceEvents').iterate()) {
   const raw = JSON.parse(String(row.value));
   if (!db.prepare('SELECT 1 FROM currentFiles WHERE sourceId=?').get(raw.thingId)) continue;
   const snapshots = [raw.before, raw.after];
   if (raw.mode === 'revision' || snapshots.some(s => s && ['file-content','folder-placement','managed-folder-placement','timeline-version-name'].includes(s.adapter))) {
    sourceEvent(String(row.id));
    if (!db.prepare('SELECT 1 FROM events WHERE id=?').get(String(row.id))) fail('The selected file history is incomplete');
   }
  }
  for(const row of db.prepare('SELECT thingId,kind,value FROM sourceAnnotations').iterate()){
   const value=JSON.parse(String(row.value)),targetId=row.kind==='timeline-note'?value.eventId:value.cleared?db.prepare('SELECT eventId FROM sourceEventThings WHERE thingId=?').get(value.eventThingId)?.eventId:value.name.eventId;
   if(!targetId)fail('An archived annotation has no target event');
   const target=sourceEvent(targetId);if(db.prepare('SELECT 1 FROM currentFiles WHERE sourceId=?').get(target.thingId)&&!db.prepare('SELECT 1 FROM selectedAnnotations WHERE thingId=?').get(row.thingId))fail('The selected file annotations are incomplete');
  }
  if (db.prepare('SELECT 1 FROM sourceHeads h JOIN currentFiles f ON f.sourceId=h.thingId LEFT JOIN selectedHeads s ON s.branchId=h.branchId AND s.thingId=h.thingId WHERE s.thingId IS NULL LIMIT 1').get()) fail('A selected file branch head is missing');
  if (db.prepare("SELECT 1 FROM currentFiles f LEFT JOIN finalizedFiles t ON f.sourceId=t.sourceId WHERE json_extract(f.value,'$.trashed')=1 AND t.sourceId IS NULL LIMIT 1").get()) fail('A current Trash state finalization is missing');
  const folder = (id: string | null): string => id === null ? destination.rootId : String(db.prepare('SELECT targetId FROM folders WHERE sourceId=?').get(id)?.targetId ?? fail('A source parent folder is unavailable'));
  const folderPath = (id: string | null): string => {
   const names: string[] = [], seen = new Set<string>();
   while (id !== null) { if (seen.has(id)) fail('Folder cycle'); seen.add(id); const row = db.prepare('SELECT name,parentSourceId FROM folders WHERE sourceId=?').get(id); if (!row) fail('Missing source folder'); names.unshift(String(row.name)); id = row.parentSourceId as string | null; }
   const path = names.join('/'); if (path && !validSyncPath(path)) fail('The reviewed folder path is invalid'); return path;
  };
  // Validate complete hierarchy and history placements before any upload/write.
  for (const row of db.prepare('SELECT ordinal,value FROM commands ORDER BY ordinal').iterate()) {
   const r = JSON.parse(String(row.value)) as AccountFileRestoreRecord;
   if (r.kind === 'folder') { folder(r.parentSourceId); folderPath(r.sourceId); if (r.parentSourceId !== null && Number(db.prepare('SELECT ordinal FROM folders WHERE sourceId=?').get(r.parentSourceId)!.ordinal) >= Number(row.ordinal)) fail('Parent folders must precede their children'); }
   if (r.kind === 'current' || r.kind === 'version') { folder(r.file.folderId); if (r.file.folderId !== null && Number(db.prepare('SELECT ordinal FROM folders WHERE sourceId=?').get(r.file.folderId)!.ordinal) >= Number(row.ordinal)) fail('Reviewed folders must precede their files'); if (!validSyncPath([folderPath(r.file.folderId), r.file.name].filter(Boolean).join('/'))) fail('Invalid reviewed file path'); }
   if (r.kind === 'history') for (const s of [r.event.before, r.event.after]) if (s) { if(s.adapter==='timeline-version-name')continue; if (['folder-placement', 'managed-folder-placement'].includes(s.adapter)) { folder(folderPlacementValue(s).folderId); continue; } const file = parseCloudFile(s.value); folder(file.folderId); if (db.prepare('SELECT thingId FROM events WHERE id=?').get(file.revision)?.thingId !== file.id) fail('A historical snapshot revision is unavailable'); }
  }
  const writer = await openReviewedAccountFileRestoreWriter(request, review, {
   folder: async id => db.prepare('SELECT * FROM folders WHERE sourceId=?').get(id) as AccountFileRestoreFolder | null,
   current: async id => JSON.parse(String(db.prepare('SELECT value FROM currentFiles WHERE sourceId=?').get(id)?.value ?? fail('Missing reviewed current file'))) as CloudFile,
   bytes: async file => db.prepare('SELECT commandKey FROM bytes WHERE identity=?').get(accountFileRestoreContentKey(file)) as { commandKey: string } | null,
   branchFirst: async id => Number(db.prepare('SELECT firstOrdinal FROM branches WHERE id=?').get(id)?.firstOrdinal ?? fail('Missing reviewed branch'))
  });
  for (const row of db.prepare('SELECT sourceId FROM folders').iterate()) await writer.verifyFolder(String(row.sourceId));
  await writer.admit();
  for (const row of db.prepare('SELECT ordinal,value FROM commands ORDER BY ordinal').iterate()) {
   const ordinal = Number(row.ordinal), r = JSON.parse(String(row.value)) as AccountFileRestoreRecord;
   if (await writer.receipt(r, ordinal)) continue;
   let content: CloudFile['content'] | undefined;
   if (r.kind === 'current' || r.kind === 'version') {
    const current = JSON.parse(String(db.prepare('SELECT value FROM currentFiles WHERE sourceId=?').get(r.file.id)!.value)) as CloudFile;
    const prefix = folderPath(current.folderId), path = prefix ? `${prefix}/${current.name}` : current.name;
    content = await stage({ destinationScope: destination.scope, signal: request.signal, record: r, reader: backup, rootId: destination.rootId, targetId: accountFileRestoreTargetId(review, current.id), operationId: operationId(accountFileRestoreRecordKey(r)), folderId: folder(current.folderId), path, name: current.name });
   }
   await writer.apply(r, ordinal, content); await options.afterCommit?.(ordinal);
  }
  const epoch = await writer.epoch();
  for (const row of db.prepare('SELECT sourceId FROM folders').iterate()) await writer.verifyFolder(String(row.sourceId));
  for (const row of db.prepare('SELECT sourceId FROM currentFiles').iterate()) await writer.verifyFile(String(row.sourceId));
  for(const row of db.prepare('SELECT value FROM commands ORDER BY ordinal').iterate()){const record=JSON.parse(String(row.value)) as AccountFileRestoreRecord;if(record.kind==='note'||record.kind==='version-name')await writer.verifyAnnotation(record);}
  await options.beforeCompletion?.(); return await writer.complete(epoch);
 } finally { await activeReader?.close(); await workspace.close(); }
}
