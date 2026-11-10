import { createHmac, timingSafeEqual } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract';
import { parseUserVaultWrite, parseUserVaultWriteAcknowledgment, USER_VAULT_WRITE_MAX_BYTES, type UserVaultWrite, type UserVaultWriteAcknowledgment } from './userVaultWriteContract';

export const USER_VAULT_WRITE_RECEIPT_ADAPTER = 'vault-write-receipt';
const digestPrefix = 'vault-write-mac-v1:';
const eventPrefix = 'vault-write-';
const invalid = (): never => { throw new Error('Vault save receipt does not match this operation.'); };

/** Domain-separated keyed digest, never an unkeyed hash of a credential.
 * The caller supplies the existing server Vault key; no fallback key exists.
 * Call only after full-account/origin/data-plane admission and normalization. */
export function userVaultWriteDigest(key: Uint8Array, ownerId: string, dataPlane: string, raw: UserVaultWrite): string {
 if (key.byteLength !== 32 || !ownerId || !dataPlane) return invalid();
 const command = parseUserVaultWrite(raw);
 const canonical = copyBoundedJson({ ownerId, dataPlane, command }, { maxBytes: USER_VAULT_WRITE_MAX_BYTES + 1024, maxDepth: 4, maxNodes: 40, sortKeys: true });
 return digestPrefix + createHmac('sha256', key).update('thingtime:vault-write-receipt:v1\0').update(JSON.stringify(canonical)).digest('hex');
}
export const userVaultWriteEventId = (writeId: string) => {
 // Reuse the command's identity validator without allowing target collisions.
 parseUserVaultWrite({ id: 'receipt-validator', writeId, expectedVersion: null, action: 'create-group', name: 'Receipt' });
 return eventPrefix + writeId;
};
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^vault-write-mac-v1:[a-f0-9]{64}$/.test(value);
const sameDigest = (a: string, b: string) => validDigest(a) && validDigest(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Prepare once and append in the SAME accounted content transaction. The
 * event is an effect, so it cannot replace the target's editable content head.
 * Only read from protected server Timeline entries; client copies grant nothing. */
export function createUserVaultWriteReceipt(ownerId: string, acknowledgment: UserVaultWriteAcknowledgment, requestDigest: string, occurredAt: string): TimelineEvent {
 const receipt = parseUserVaultWriteAcknowledgment(acknowledgment);
 if (!validDigest(requestDigest)) return invalid();
 return parseTimelineEvent({ formatVersion: 1, id: userVaultWriteEventId(receipt.writeId), ownerId, thingId: receipt.id,
  branchId: 'main', parentIds: [], operationId: receipt.writeId, actorId: ownerId, source: 'api', clientId: null,
  occurredAt, mode: 'effect', operation: 'effect', label: 'Synchronized Vault entry', before: null,
  after: { adapter: USER_VAULT_WRITE_RECEIPT_ADAPTER, version: 1, value: { ...receipt, requestDigest } }, dependencies: [] });
}

/** An existing event at this id is either the exact admitted write or a hard
 * conflict. Never fall back to creating the target when this validation fails. */
export function readUserVaultWriteReceipt(input: unknown, ownerId: string, raw: UserVaultWrite, requestDigest: string): UserVaultWriteAcknowledgment {
 const command = parseUserVaultWrite(raw), event = parseTimelineEvent(input);
 if (event.id !== userVaultWriteEventId(command.writeId) || event.ownerId !== ownerId || event.actorId !== ownerId ||
  event.thingId !== command.id || event.operationId !== command.writeId || event.source !== 'api' || event.clientId !== null ||
  event.mode !== 'effect' || event.operation !== 'effect' || event.branchId !== 'main' || event.parentIds.length || event.dependencies.length ||
  event.before !== null || event.after?.adapter !== USER_VAULT_WRITE_RECEIPT_ADAPTER || event.after.version !== 1) return invalid();
 const value = event.after.value;
 if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
 const { requestDigest: storedDigest, ...fields } = value;
 if (typeof storedDigest !== 'string' || !sameDigest(storedDigest, requestDigest)) return invalid();
 const acknowledgment = parseUserVaultWriteAcknowledgment(fields);
 if (acknowledgment.id !== command.id || acknowledgment.writeId !== command.writeId || acknowledgment.action !== command.action || acknowledgment.expectedVersion !== command.expectedVersion) return invalid();
 return acknowledgment;
}
