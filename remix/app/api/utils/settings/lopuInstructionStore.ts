import { createHash, randomUUID } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { insertAccountedThing, updateAccountedThing, deleteAccountedThings, HOME_ACCOUNTED_STORAGE_OPTIONS } from '../storage/accountedThings';
import { getUserLopuInstructionRecord, setUserLopuInstructionRecord } from '../auth/users';
import { fromBin, toBin, binaryBytes } from '../auth/binary';
import { thingUniqueKey } from '../mongodb/uniqueKeys';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { validatePromptRevision, type LopuInstruction } from '../lopu/promptSettingsCore';
import { INSTRUCTION_CHAIN_SEED, INSTRUCTION_BATCH_PARTS, INSTRUCTION_TRANSFER_KIND, INSTRUCTION_PART_KIND, instructionAttemptId, instructionOrdinal, parseInstructionPart, parseInstructionReference, type InstructionPart, type InstructionReference, type InstructionTransferStatus } from '../../../lopu/instructionTransfer';

export class InstructionStoreError extends Error {
 constructor(readonly status: number, message: string, readonly code = 'INSTRUCTION_TRANSFER_REFUSED') { super(message); }
}
const refuse = (message: string): never => { throw new InstructionStoreError(409, message); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const instructionTransferThingId = (ownerId: string, attemptId: string) => 'instruction-transfer-' + hash(JSON.stringify([ownerId, instructionAttemptId(attemptId)]));
export const instructionPartThingId = (ownerId: string, attemptId: string, ordinal: number) => 'instruction-part-' + hash(JSON.stringify([ownerId, instructionAttemptId(attemptId), instructionOrdinal(ordinal)]));
const rowKey = (ownerId: string, attemptId: string, id: string) => 'instruction-row-' + hash(JSON.stringify([ownerId, attemptId, id]));
const chainDigest = (previous: string, part: InstructionPart) => hash(previous + '\n' + JSON.stringify(part));
export type InstructionTransferState = InstructionTransferStatus & { formatVersion: 1; expectedRevision: string | null; chain: string; openId: string | null; openEnabled: boolean | null; rowCount: number; scope: string };
const status = (value: InstructionTransferState): InstructionTransferStatus => ({ attemptId: value.attemptId, nextOrdinal: value.nextOrdinal, partCount: value.partCount, digest: value.digest, status: value.status, revision: value.revision });
const digestValid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function parseTransferState(value: any): InstructionTransferState {
 const reference = parseInstructionReference({ formatVersion: value?.formatVersion, attemptId: value?.attemptId, partCount: value?.partCount, digest: value?.digest });
 if (!['staging','committed','aborted'].includes(value.status) || !digestValid(value.chain) || typeof value.scope !== 'string' || !value.scope || value.scope.length > 2048 || typeof value.revision !== 'string' || validatePromptRevision(value.revision) === null || instructionOrdinal(value.nextOrdinal) > reference.partCount || (value.openId !== null && (typeof value.openId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.openId))) || (value.openId === null ? value.openEnabled !== null : typeof value.openEnabled !== 'boolean')) throw new TypeError('Invalid instruction transfer state.');
 const state = { ...reference, expectedRevision: validatePromptRevision(value.expectedRevision), nextOrdinal: value.nextOrdinal, chain: value.chain, status: value.status, revision: value.revision, openId: value.openId, openEnabled: value.openEnabled, rowCount: instructionOrdinal(value.rowCount), scope: value.scope };
 if (state.rowCount > state.nextOrdinal || (state.nextOrdinal === 0 && (state.chain !== INSTRUCTION_CHAIN_SEED || state.openId !== null || state.rowCount !== 0))) throw new TypeError('Invalid instruction transfer checkpoint.');
 if (state.status === 'committed' && (state.nextOrdinal !== state.partCount || state.chain !== state.digest || state.openId !== null)) throw new TypeError('Incomplete committed instruction transfer.');
 return state as InstructionTransferState;
}
export function advanceInstructionTransfer(state: InstructionTransferState, part: InstructionPart): InstructionTransferState {
 if (state.status !== 'staging' || state.nextOrdinal >= state.partCount) return refuse('The instruction transfer is closed.');
 if (part.start ? state.openId !== null : state.openId !== part.id || state.openEnabled !== part.enabled) return refuse('Instruction parts are not contiguous.');
 const nextOrdinal = state.nextOrdinal + 1;
 if (!Number.isSafeInteger(nextOrdinal)) throw new TypeError('Invalid instruction part position.');
 return { ...state, nextOrdinal, chain: chainDigest(state.chain, part), openId: part.end ? null : part.id, openEnabled: part.end ? null : part.enabled, rowCount: state.rowCount + (part.start ? 1 : 0) };
}
const document = (ownerId: string, kind: string, id: string, parentId: string | null, targetId: string | null, payload: unknown, now = new Date()) => ({ schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, shareId: id, ownerId, thingtime: [kind], acl: ['tt:user'], parentId, targetId, crystal: {}, extended: null, tags: [], instructionEnvelopeVersion: 1, secure: toBin(JSON.stringify(payload)), createdAt: now, updatedAt: now });
export type InstructionBackupRecord = { formatVersion: 1; kind: typeof INSTRUCTION_TRANSFER_KIND | typeof INSTRUCTION_PART_KIND; id: string; ownerId: string; parentId: string | null; targetId: string | null; createdAt: string; updatedAt: string; payload: any };
export function parseInstructionBackupRecord(raw: any): InstructionBackupRecord {
 if (!raw || raw.formatVersion !== 1 || ![INSTRUCTION_TRANSFER_KIND, INSTRUCTION_PART_KIND].includes(raw.kind) || typeof raw.ownerId !== 'string' || !raw.ownerId || typeof raw.createdAt !== 'string' || new Date(raw.createdAt).toISOString() !== raw.createdAt || typeof raw.updatedAt !== 'string' || new Date(raw.updatedAt).toISOString() !== raw.updatedAt) throw new TypeError('Invalid instruction backup record.');
 let payload: any;
 if (raw.kind === INSTRUCTION_TRANSFER_KIND) {
  payload = parseTransferState(raw.payload);
  if (raw.id !== instructionTransferThingId(raw.ownerId, payload.attemptId) || raw.parentId !== null || raw.targetId !== null) throw new TypeError('Invalid instruction transfer envelope.');
 } else {
  const value = raw.payload;
  payload = { attemptId: instructionAttemptId(value?.attemptId), ordinal: instructionOrdinal(value?.ordinal), part: parseInstructionPart(value?.part), chainBefore: value?.chainBefore, chainAfter: value?.chainAfter };
  if (!digestValid(payload.chainBefore) || payload.chainAfter !== chainDigest(payload.chainBefore, payload.part) || raw.id !== instructionPartThingId(raw.ownerId, payload.attemptId, payload.ordinal) || raw.parentId !== instructionTransferThingId(raw.ownerId, payload.attemptId) || raw.targetId !== rowKey(raw.ownerId, payload.attemptId, payload.part.id)) throw new TypeError('Invalid instruction part envelope.');
 }
 return { formatVersion: 1, kind: raw.kind, id: raw.id, ownerId: raw.ownerId, parentId: raw.parentId, targetId: raw.targetId, createdAt: raw.createdAt, updatedAt: raw.updatedAt, payload };
}
export function exportInstructionRecord(doc: any): InstructionBackupRecord {
 if (doc?.instructionEnvelopeVersion !== 1 || !Array.isArray(doc.thingtime) || doc.thingtime.length !== 1 || binaryBytes(doc.secure) === null || Object.keys(doc.crystal ?? {}).length || doc.extended !== null || doc.tags?.length || JSON.stringify(doc.acl) !== '["tt:user"]') throw new TypeError('Invalid private instruction envelope.');
 const result = parseInstructionBackupRecord({ formatVersion: 1, kind: doc.thingtime[0], id: doc.shareId, ownerId: doc.ownerId, parentId: doc.parentId, targetId: doc.targetId, createdAt: new Date(doc.createdAt).toISOString(), updatedAt: new Date(doc.updatedAt).toISOString(), payload: JSON.parse(fromBin(doc.secure)) });
 if (result.kind === INSTRUCTION_PART_KIND && doc.instructionStart !== result.payload.part.start) throw new TypeError('Invalid instruction row envelope.');
 return result;
}
const defaults = { getThings: getHomeThingsCollection, transaction: withHomeMongoTransaction, insert: insertAccountedThing, update: updateAccountedThing, remove: deleteAccountedThings, readRecord: getUserLopuInstructionRecord, setRecord: setUserLopuInstructionRecord };
export function createInstructionStore(overrides: Partial<typeof defaults> = {}) {
 const deps = { ...defaults, ...overrides };
 const options = (session: any) => ({ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
 const findTransfer = async (things: any, ownerId: string, attemptId: string, session?: any) => {
  const doc = await things.findOne({ shareId: instructionTransferThingId(ownerId, attemptId), ownerId, thingtime: INSTRUCTION_TRANSFER_KIND }, session ? { session } : {});
  return doc ? { doc, state: exportInstructionRecord(doc).payload as InstructionTransferState } : null;
 };
 const saveState = async (things: any, doc: any, state: InstructionTransferState, session: any) => {
  const result = await deps.update(things, { _id: doc._id, ownerId: doc.ownerId, secure: doc.secure }, { $set: { secure: toBin(JSON.stringify(state)), instructionTransferStatus: state.status, updatedAt: new Date() } }, options(session));
  if (result.matchedCount !== 1) return refuse('The instruction transfer changed. Retry the same operation.');
  doc.secure = toBin(JSON.stringify(state)); doc.instructionTransferStatus = state.status;
 };
 const cleanup = async (things: any, ownerId: string, transfer: any, session: any) => {
  // Only closed staging may be removed; committed manifests/parts are immutable
  // history dependencies even after their live pointer has been replaced.
  if (transfer.state.status !== 'aborted') return;
  const docs = await things.find({ ownerId, thingtime: INSTRUCTION_PART_KIND, parentId: transfer.doc.shareId }, { session, projection: { _id: 1 } }).limit(INSTRUCTION_BATCH_PARTS).toArray();
  if (docs.length) await deps.remove(things, { ownerId, thingtime: INSTRUCTION_PART_KIND, parentId: transfer.doc.shareId, _id: { $in: docs.map((doc: any) => doc._id) } }, options(session));
  if (docs.length < INSTRUCTION_BATCH_PARTS) await deps.update(things, { _id: transfer.doc._id, ownerId }, { $set: { instructionCleanupComplete: true } }, options(session));
 };
 const execute = async (ownerId: string, scope: string, command: any, admit: () => Promise<void> = async () => {}) => {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new TypeError('Invalid instruction command.');
  await admit();
  if (command.action === 'snapshot') return { personal: await deps.readRecord(ownerId) };
  const attemptId = instructionAttemptId(command.attemptId), things = await deps.getThings();
  if (command.action === 'read-part') {
   const found = await findTransfer(things, ownerId, attemptId);
   if (!found || found.state.status !== 'committed') throw new InstructionStoreError(404, 'The retained instructions are unavailable.');
   const ordinal = instructionOrdinal(command.ordinal);
   if (ordinal >= found.state.partCount) throw new InstructionStoreError(404, 'Instruction part not found.');
   const doc = await things.findOne({ ownerId, thingtime: INSTRUCTION_PART_KIND, shareId: instructionPartThingId(ownerId, attemptId, ordinal) });
   if (!doc) throw new InstructionStoreError(503, 'A retained instruction part is unavailable.');
   const record = exportInstructionRecord(doc);
   await admit(); return { part: record.payload.part };
  }
  return deps.transaction(async session => {
   await admit();
   if (command.action === 'begin') {
    const expired = await things.findOne({ ownerId, thingtime: INSTRUCTION_TRANSFER_KIND, instructionCleanupComplete: { $ne: true }, $or: [{ instructionTransferStatus: 'aborted' }, { instructionTransferStatus: 'staging', updatedAt: { $lt: new Date(Date.now() - 7 * 86400_000) } }] }, { session, sort: { updatedAt: 1 } });
    if (expired) {
     const oldState = exportInstructionRecord(expired).payload as InstructionTransferState;
     if (oldState.status === 'staging') { oldState.status = 'aborted'; await saveState(things, expired, oldState, session); }
     await cleanup(things, ownerId, { doc: expired, state: oldState }, session);
    }
   }
   let found = await findTransfer(things, ownerId, attemptId, session);
   if (command.action === 'begin') {
    const reference = parseInstructionReference({ formatVersion: 1, attemptId, partCount: command.partCount, digest: command.digest }), expectedRevision = validatePromptRevision(command.expectedRevision);
    if (found) {
     if (found.state.expectedRevision !== expectedRevision || found.state.partCount !== reference.partCount || found.state.digest !== reference.digest || found.state.scope !== scope) return refuse('The instruction attempt identity changed.');
    } else {
     if ((await deps.readRecord(ownerId, session)).revision !== expectedRevision) return refuse('The account instructions changed. Device changes have been kept.');
     const state: InstructionTransferState = { ...reference, expectedRevision, nextOrdinal: 0, chain: INSTRUCTION_CHAIN_SEED, openId: null, openEnabled: null, rowCount: 0, scope, status: 'staging', revision: randomUUID() };
     const doc: any = { ...document(ownerId, INSTRUCTION_TRANSFER_KIND, instructionTransferThingId(ownerId, attemptId), null, null, state), instructionTransferStatus: 'staging' };
     await deps.insert(things, doc, options(session)); found = { doc, state };
    }
   }
   if (!found) throw new InstructionStoreError(404, 'Instruction attempt not found.');
   if (found.state.scope !== scope) return refuse('The account or database confirmation changed.');
   let state = found.state;
   // Staging leases expire after inactivity; a durable tombstone prevents a
   // delayed upload/commit from reviving abandoned content after cleanup.
   if (state.status === 'staging' && new Date(found.doc.updatedAt).getTime() < Date.now() - 7 * 86400_000) {
    state = { ...state, status: 'aborted' }; await saveState(things, found.doc, state, session); found = { doc: found.doc, state };
   }
   if (state.status === 'aborted' && command.action !== 'abort') {
    await cleanup(things, ownerId, { doc: found.doc, state }, session);
    await admit();
    return { transfer: status(state), terminalCode: 'INSTRUCTION_TRANSFER_ABORTED' as const };
   }
   if (command.action === 'part' || command.action === 'parts') {
    if (state.status !== 'staging') return refuse('The instruction transfer is closed.');
    const offset = instructionOrdinal(command.action === 'part' ? command.ordinal : command.offset);
    const raw = command.action === 'part' ? [command.part] : command.parts;
    if (!Array.isArray(raw) || !raw.length || raw.length > INSTRUCTION_BATCH_PARTS) throw new TypeError('Use a bounded instruction part batch.');
    const parts = raw.map(parseInstructionPart);
    if (offset > state.nextOrdinal) return refuse('Resume at the acknowledged instruction position.');
    for (let i = 0; i < parts.length; i++) {
     const ordinal = offset + i, part = parts[i], id = instructionPartThingId(ownerId, attemptId, ordinal);
     if (ordinal < state.nextOrdinal) {
      const prior = await things.findOne({ shareId: id, ownerId, thingtime: INSTRUCTION_PART_KIND }, { session });
      if (!prior || JSON.stringify(exportInstructionRecord(prior).payload.part) !== JSON.stringify(part)) return refuse('An instruction part identity changed.');
      continue;
     }
     if (part.start && await things.findOne({ ownerId, thingtime: INSTRUCTION_PART_KIND, parentId: found.doc.shareId, uniqueKeys: thingUniqueKey('lopuInstructionRow', rowKey(ownerId, attemptId, part.id)) }, { session, projection: { _id: 1 } })) return refuse('Each instruction needs a unique id.');
     const next = advanceInstructionTransfer(state, part);
     const payload = { attemptId, ordinal, part, chainBefore: state.chain, chainAfter: next.chain };
     await deps.insert(things, { ...document(ownerId, INSTRUCTION_PART_KIND, id, found.doc.shareId, rowKey(ownerId, attemptId, part.id), payload), instructionStart: part.start, ...(part.start ? { uniqueKeys: [thingUniqueKey('lopuInstructionRow', rowKey(ownerId, attemptId, part.id))] } : {}) }, options(session));
     state = next;
    }
    await saveState(things, found.doc, state, session);
   } else if (command.action === 'commit') {
    if (state.status === 'aborted') return refuse('The instruction transfer was cancelled.');
    if (state.status !== 'committed') {
     if (state.nextOrdinal !== state.partCount || state.openId !== null || state.chain !== state.digest) return refuse('The instruction transfer is incomplete or corrupt.');
     await deps.setRecord(ownerId, { revision: state.revision, reference: parseInstructionReference({ formatVersion: 1, attemptId, partCount: state.partCount, digest: state.digest }) }, state.expectedRevision, session);
     state = { ...state, status: 'committed' }; await saveState(things, found.doc, state, session);
    }
   } else if (command.action === 'abort') {
    if (state.status === 'committed') return refuse('Committed instructions cannot be cancelled.');
    state = { ...state, status: 'aborted' }; await saveState(things, found.doc, state, session);
   } else if (!['begin','status'].includes(command.action)) throw new TypeError('Invalid instruction operation.');
   await cleanup(things, ownerId, { doc: found.doc, state }, session);
   await admit();
   return { transfer: status(state), ...(command.action === 'commit' ? { personal: { revision: state.revision } } : {}) };
  });
 };
 return { execute };
}
export const executeInstructionTransfer = createInstructionStore().execute;

export async function* readInstructionParts(ownerId: string, rawReference: InstructionReference, session?: any): AsyncGenerator<InstructionPart> {
 const reference = parseInstructionReference(rawReference), things = await getHomeThingsCollection();
 const manifest = await things.findOne({ ownerId, thingtime: INSTRUCTION_TRANSFER_KIND, shareId: instructionTransferThingId(ownerId, reference.attemptId) }, session ? { session } : {});
 const state = manifest ? exportInstructionRecord(manifest).payload as InstructionTransferState : null;
 if (!state || state.status !== 'committed' || state.partCount !== reference.partCount || state.digest !== reference.digest) throw new InstructionStoreError(503, 'The retained instruction manifest is unavailable.');
 let chain = INSTRUCTION_CHAIN_SEED, openId: string | null = null, openEnabled: boolean | null = null;
 const ids = new Set<string>();
 for (let offset = 0; offset < reference.partCount; offset += INSTRUCTION_BATCH_PARTS) {
  const partIds = Array.from({ length: Math.min(INSTRUCTION_BATCH_PARTS, reference.partCount - offset) }, (_, i) => instructionPartThingId(ownerId, reference.attemptId, offset + i));
  const docs = await things.find({ ownerId, thingtime: INSTRUCTION_PART_KIND, shareId: { $in: partIds } }, session ? { session } : {}).toArray();
  const byId = new Map(docs.map((doc: any) => [doc.shareId, exportInstructionRecord(doc)]));
  for (const id of partIds) {
   const record = byId.get(id) as InstructionBackupRecord | undefined;
   if (!record || record.payload.chainBefore !== chain) throw new InstructionStoreError(503, 'The retained instructions are incomplete.');
   const part = record.payload.part;
   if (part.start ? openId !== null || ids.has(part.id) : openId !== part.id || openEnabled !== part.enabled) throw new InstructionStoreError(503, 'The retained instruction sequence is invalid.');
   if (part.start) ids.add(part.id);
   openId = part.end ? null : part.id; openEnabled = part.end ? null : part.enabled; chain = record.payload.chainAfter;
   yield part;
  }
 }
 if (chain !== reference.digest || openId !== null) throw new InstructionStoreError(503, 'The retained instructions failed integrity verification.');
}
export async function materializeInstructions(ownerId: string, reference: InstructionReference, session?: any): Promise<LopuInstruction[]> {
 const rows: LopuInstruction[] = [];
 let pieces: string[] = [];
 for await (const part of readInstructionParts(ownerId, reference, session)) {
  if (part.start) { rows.push({ id: part.id, enabled: part.enabled, text: '' }); pieces = []; }
  pieces.push(part.text);
  if (part.end) rows[rows.length - 1].text = pieces.join('');
 }
 return rows;
}
export async function importInstructionRecord(ownerId: string, raw: unknown, session: any) {
 if (!session) throw new Error('Instruction restore requires the home transaction.');
 const record = parseInstructionBackupRecord(raw);
 if (record.ownerId !== ownerId) throw new TypeError('Instruction restore owner changed.');
 const things = await getHomeThingsCollection(), prior = await things.findOne({ shareId: record.id }, { session });
 if (prior) {
  if (JSON.stringify(exportInstructionRecord(prior)) !== JSON.stringify(record)) return refuse('Retained instruction identity changed during restore.');
  return;
 }
 const doc = { ...document(ownerId, record.kind, record.id, record.parentId, record.targetId, record.payload, new Date(record.createdAt)), updatedAt: new Date(record.updatedAt), ...(record.kind === INSTRUCTION_PART_KIND ? { instructionStart: record.payload.part.start, ...(record.payload.part.start ? { uniqueKeys: [thingUniqueKey('lopuInstructionRow', record.targetId!)] } : {}) } : { instructionTransferStatus: record.payload.status }) };
 await insertAccountedThing(things, doc, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
}
