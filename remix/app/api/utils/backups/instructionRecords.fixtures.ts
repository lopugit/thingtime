import { createHash } from 'node:crypto';
import { INSTRUCTION_CHAIN_SEED, splitInstructionParts } from '../../../lopu/instructionTransfer';
import { instructionTransferThingId, instructionPartThingId } from '../settings/lopuInstructionStore';
import { toBin } from '../auth/binary';

export function instructionBackupFixture(ownerId = 'owner', count = 160, status: 'committed' | 'staging' | 'aborted' = 'committed') {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const attemptId = `backup_${status}`, revision = `revision_${status}`, createdAt = new Date('2026-10-01T00:00:00.000Z');
  const instructions = Array.from({ length: count }, (_, i) => ({ id: `row_${i}`, enabled: i % 3 !== 0, text: `Preference ${i}: ${'界🙂'.repeat(1500)}` }));
  const parts = [...splitInstructionParts(instructions)]; let chain = INSTRUCTION_CHAIN_SEED;
  const doc = (kind: string, shareId: string, payload: any, parentId: string | null, targetId: string | null) => ({ shareId, ownerId, thingtime: [kind], parentId, targetId,
    createdAt, updatedAt: createdAt, acl: ['tt:user'], crystal: {}, extended: null, tags: [], instructionEnvelopeVersion: 1, secure: toBin(JSON.stringify(payload)) });
  const manifestId = instructionTransferThingId(ownerId, attemptId);
  const docs = parts.map((part, ordinal) => {
    const chainBefore = chain; chain = hash(chain + '\n' + JSON.stringify(part));
    return { ...doc('lopu-instruction-part', instructionPartThingId(ownerId, attemptId, ordinal), { attemptId, ordinal, part, chainBefore, chainAfter: chain }, manifestId,
      'instruction-row-' + hash(JSON.stringify([ownerId, attemptId, part.id]))), instructionStart: part.start };
  });
  const reference = { formatVersion: 1 as const, attemptId, partCount: parts.length, digest: chain };
  const manifest = doc('lopu-instruction-transfer', manifestId, { ...reference, expectedRevision: null, nextOrdinal: parts.length, chain,
    status, revision, openId: null, openEnabled: null, rowCount: count, scope: 'https://backup.test:home' }, null, null);
  return { docs: [manifest, ...docs], instructions, reference, revision };
}
