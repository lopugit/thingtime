import { createHash } from 'node:crypto';
import { backupJson } from '../../../backups/manifest';
import { advanceInstructionTransfer, parseInstructionBackupRecord, exportInstructionRecord, instructionTransferThingId, instructionPartThingId } from '../settings/lopuInstructionStore';
import { parseInstructionReference, INSTRUCTION_CHAIN_SEED } from '../../../lopu/instructionTransfer';
import { openBackupItem, openSealedBackup, retainBackupPayload, verifyBackupItemBytes, type BackupAccess, type BackupObjectStore } from './portableBackup';

export const BACKUP_INSTRUCTION_RECORD_ADAPTER = 'backup-lopu-instruction-record';
// A bounded transport part, never a maximum checklist size. Each generation can
// contain any number of separately inventoried parts.
export const BACKUP_INSTRUCTION_RECORD_BYTES = 96 * 1024;
export const instructionBackupProjection = { _id: 0, shareId: 1, ownerId: 1, thingtime: 1, parentId: 1, targetId: 1, createdAt: 1, updatedAt: 1, secure: 1, instructionEnvelopeVersion: 1, acl: 1, crystal: 1, extended: 1, tags: 1, instructionStart: 1 };
export const isInstructionRecordKind = (kind: string) => kind === 'lopu-instruction-transfer' || kind === 'lopu-instruction-part';
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => backupJson(value, BACKUP_INSTRUCTION_RECORD_BYTES);

export async function retainBackupInstructionRecord(store: BackupObjectStore, snapshotId: string, ordinal: number, doc: any, access: BackupAccess) {
  const record = exportInstructionRecord(doc), text = json(record), sha256 = digest(text);
  if (record.ownerId !== access.scope.ownerId) throw Error('Instruction backup owner changed');
  return retainBackupPayload(store, snapshotId, { ordinal, thingId: record.id, revision: 'snapshot-' + sha256,
    snapshot: { adapter: BACKUP_INSTRUCTION_RECORD_ADAPTER, version: 1, value: { sha256 } } }, Buffer.from(text), access);
}

/** Private offline recovery only. Staging/aborted attempts remain nonactive;
 * these records never confer permission to activate or write account settings. */
export async function openBackupInstructionRecord(store: BackupObjectStore, snapshotId: string, thingId: string, access: BackupAccess) {
  const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access);
  return parseOpenedBackupInstructionRecord(item, ranges, thingId, access.scope.ownerId);
}

async function parseOpenedBackupInstructionRecord(item: any, ranges: AsyncIterable<Uint8Array>, thingId: string, ownerId: string) {
  const descriptor = item.snapshot.value as any;
  if (item.snapshot.adapter !== BACKUP_INSTRUCTION_RECORD_ADAPTER || item.snapshot.version !== 1 || !descriptor ||
    Object.keys(descriptor).length !== 1 || !/^[a-f0-9]{64}$/.test(descriptor.sha256) || !item.content || item.content.size > BACKUP_INSTRUCTION_RECORD_BYTES)
    throw Error('Invalid archived instruction descriptor');
  const bytes = Buffer.alloc(item.content.size); let size = 0;
  for await (const chunk of ranges) {
    size += chunk.length;
    if (size > BACKUP_INSTRUCTION_RECORD_BYTES || size > bytes.length) throw Error('Archived instruction record exceeds its bound');
    bytes.set(chunk, size - chunk.length);
  }
  if (size !== bytes.length) throw Error('Archived instruction record is incomplete');
  await verifyBackupItemBytes(item, (async function* () { yield bytes; })());
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (digest(bytes) !== descriptor.sha256 || item.revision !== 'snapshot-' + descriptor.sha256) throw Error('Archived instruction record digest changed');
  const record = parseInstructionBackupRecord(JSON.parse(text));
  if (json(record) !== text || record.id !== thingId || record.ownerId !== ownerId) throw Error('Archived instruction identity changed');
  return record;
}

/** Read a selected generation in one sealed-inventory pass. Metadata scales
 * with actual instruction inventory; decoded content scales only with the
 * selected generation. A declared part count never drives a large allocation. */
export async function openBackupInstructionGeneration(
  store: BackupObjectStore,
  snapshotId: string,
  ownerId: string,
  rawReference: unknown,
  access: BackupAccess
): Promise<Map<string, any>> {
  if (ownerId !== access.scope.ownerId) throw Error('Archived instruction owner identity changed');
  const reference = parseInstructionReference(rawReference),
    manifestId = instructionTransferThingId(ownerId, reference.attemptId),
    backup = await openSealedBackup(store, snapshotId, access),
    // The declared partCount is untrusted. Keep descriptors for instruction
    // records actually present in this inventory; this index is proportional
    // to actual inventory metadata, never to the reference's claimed count.
    descriptors = new Map<string, { item: any; ranges: AsyncIterable<any> }>(),
    records = new Map<string, any>();
  for await (const entry of backup.entries) {
    const id = entry.item.thingId;
    if (entry.item.snapshot.adapter !== BACKUP_INSTRUCTION_RECORD_ADAPTER || entry.item.snapshot.version !== 1) continue;
    if (descriptors.has(id)) throw Error('Instruction generation identity is duplicated');
    // Each unconsumed ranges iterator closes over this entry's immutable item
    // and backup scope; it can be consumed after entries() advances. Its range
    // pages are revalidated on iteration, each chunk read checks its hash, and
    // parseOpenedBackupInstructionRecord verifies the whole item fingerprint.
    descriptors.set(id, { item: entry.item, ranges: entry.ranges });
  }
  const read = async (id: string) => {
    const descriptor = descriptors.get(id);
    if (!descriptor) throw Error('Instruction generation parts are incomplete');
    return parseOpenedBackupInstructionRecord(descriptor.item, (async function* () {
      for await (const range of descriptor.ranges) yield await range.read();
    })(), id, ownerId);
  };
  const manifest = await read(manifestId);
  if (manifest.kind !== 'lopu-instruction-transfer' || manifest.ownerId !== ownerId ||
    manifest.payload.attemptId !== reference.attemptId || manifest.payload.status !== 'committed')
    throw Error('Instruction generation is not committed');
  records.set(manifestId, manifest);
  // Resolve only bounded batches against actual descriptors. A corruptly huge
  // partCount with missing records fails at the first absent ordinal without
  // allocating a count-sized ID array or starting reads for that batch.
  for (let offset = 0; offset < reference.partCount; offset += 64) {
    const selected: { id: string; descriptor: { item: any; ranges: AsyncIterable<any> } }[] = [];
    for (let i = 0; i < Math.min(64, reference.partCount - offset); i++) {
      const id = instructionPartThingId(ownerId, reference.attemptId, offset + i), descriptor = descriptors.get(id);
      if (!descriptor) throw Error('Instruction generation parts are incomplete');
      selected.push({ id, descriptor });
    }
    for (const { id, descriptor } of selected) records.set(id, await parseOpenedBackupInstructionRecord(descriptor.item, (async function* () {
      for await (const range of descriptor.ranges) yield await range.read();
    })(), id, ownerId));
  }
  return records;
}

/** Resolve immutable dependencies from the same snapshot before publishing an
 * account pointer. Bounded ID batches prevent a checklist-sized query/array. */
export async function verifyInstructionBackupReference(ownerId: string, raw: unknown, read: (ids: string[]) => Promise<any[]>, check: () => Promise<void>, expectedRevision?: string) {
  const normalize = (record: any) => record?.formatVersion === 1 ? parseInstructionBackupRecord(record) : exportInstructionRecord(record);
  const reference = parseInstructionReference(raw);
  const manifestId = instructionTransferThingId(ownerId, reference.attemptId);
  const manifests = await read([manifestId]);
  await check();
  if (manifests.length !== 1) throw Error('Instruction generation is missing');
  const manifest = normalize(manifests[0]);
  if (manifest.id !== manifestId || manifest.ownerId !== ownerId || manifest.kind !== 'lopu-instruction-transfer' ||
    manifest.payload.status !== 'committed' || (expectedRevision !== undefined && manifest.payload.revision !== expectedRevision) || manifest.payload.partCount !== reference.partCount || manifest.payload.digest !== reference.digest)
    throw Error('Instruction generation is not committed');
  let chain = INSTRUCTION_CHAIN_SEED;
  const seenRows = new Set<string>();
  let state = { ...manifest.payload, status: 'staging', nextOrdinal: 0, chain, openId: null, openEnabled: null, rowCount: 0 };
  for (let offset = 0; offset < reference.partCount; offset += 64) {
    const ids = Array.from({ length: Math.min(64, reference.partCount - offset) }, (_, i) => instructionPartThingId(ownerId, reference.attemptId, offset + i));
    const records = await read(ids); await check();
    if (records.length !== ids.length) throw Error('Instruction generation parts are incomplete');
    const byId = new Map(records.map(doc => { const record = normalize(doc); return [record.id, record]; }));
    if (byId.size !== ids.length) throw Error('Instruction generation part identity is ambiguous');
    for (let i = 0; i < ids.length; i++) {
      const part = byId.get(ids[i]);
      if (!part || part.ownerId !== ownerId || part.kind !== 'lopu-instruction-part' || part.payload.attemptId !== reference.attemptId ||
        part.payload.ordinal !== offset + i || part.payload.chainBefore !== chain) throw Error('Instruction generation part changed');
      if (part.payload.part.start) {
        if (seenRows.has(part.payload.part.id)) throw Error('Instruction row identity is duplicated');
        seenRows.add(part.payload.part.id);
      }
      state = advanceInstructionTransfer(state, part.payload.part);
      chain = part.payload.chainAfter;
    }
  }
  if (chain !== reference.digest || state.openId !== null || state.rowCount !== manifest.payload.rowCount) throw Error('Instruction generation digest changed');
}
