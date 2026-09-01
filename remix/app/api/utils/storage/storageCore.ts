// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import {
	COLLECTION_SCHEMA_VERSIONS,
	DEVICE_CONTROL_THINGTIME,
	MIGRATION_DIAGNOSTIC_THINGTIME,
	USER_STORAGE_ACCOUNTING_VERSION
} from '../../../schemas/registry.ts';
// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import { attachmentObjectSizeBytesForAccounting } from '../attachments/attachmentCore.ts';

export class InvalidAttachmentStorageEnvelopeError extends Error {
  constructor() {
    super('Attachment storage envelope is invalid');
    this.name = 'InvalidAttachmentStorageEnvelopeError';
  }
}

// One versioned logical byte definition for every billable Thing. Ordinary
// Things measure the exact UTF-8 JSON stored in the customer-controlled payload
// fields. Protected attachment Things additionally add their verified root
// objectSizeBytes allocation; no historical Thing changes size, and arbitrary
// user crystals cannot opt into object billing. MongoDB/WiredTiger compression,
// indexes, and replication remain excluded shared physical costs.
export const thingStorageSizeBytes = (doc: {
  thingtime?: unknown;
  crystal?: unknown;
  extended?: unknown;
  tags?: unknown;
  attachmentEnvelopeVersion?: unknown;
  attachmentState?: unknown;
  objectSizeBytes?: unknown;
  objectKey?: unknown;
}): number => {
  const payloadBytes = Buffer.byteLength(
    JSON.stringify({
      crystal: doc.crystal ?? null,
      extended: doc.extended ?? null,
      tags: doc.tags ?? []
    }),
    'utf8'
  );
  const objectBytes = attachmentObjectSizeBytesForAccounting(doc);
  if (objectBytes === null) throw new InvalidAttachmentStorageEnvelopeError();
  const total = payloadBytes + (objectBytes ?? 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('Thing storage size exceeds the exact counter range');
  return total;
};

// The one proof that a persisted row may participate in incremental ledger
// arithmetic. Writers and deletes recompute the payload instead of trusting a
// cached number; migration is the only path that can establish a missing or
// old baseline.
export const currentContentStorageSizeBytes = (doc: {
  schemaVersion?: unknown;
  thingtime?: unknown;
  storageClass?: unknown;
  storageAccountingVersion?: unknown;
  sizeBytes?: unknown;
  crystal?: unknown;
  extended?: unknown;
  tags?: unknown;
  attachmentEnvelopeVersion?: unknown;
  attachmentState?: unknown;
  objectSizeBytes?: unknown;
  objectKey?: unknown;
}): number | null => {
  let canonical: number;
  try {
    canonical = thingStorageSizeBytes(doc);
  } catch {
    return null;
  }
  return doc.schemaVersion === COLLECTION_SCHEMA_VERSIONS.things &&
    Array.isArray(doc.thingtime) &&
    doc.storageClass === 'content' &&
    doc.storageAccountingVersion === USER_STORAGE_ACCOUNTING_VERSION &&
    Number.isSafeInteger(doc.sizeBytes) &&
    Number(doc.sizeBytes) >= 0 &&
    Number(doc.sizeBytes) === canonical
    ? canonical
    : null;
};

export { USER_STORAGE_ACCOUNTING_VERSION };

export const USER_STORAGE_STATUS = {
  initializing: 'initializing',
  ready: 'ready',
  needsReconcile: 'needs-reconcile'
} as const;

export type UserStorageLedgerStatus = (typeof USER_STORAGE_STATUS)[keyof typeof USER_STORAGE_STATUS];

export type UserStorageUsage = {
  usedBytes: number | null;
  allowanceBytes: number | null;
  remainingBytes: number | null;
  overageBytes: number | null;
  status: 'ready' | 'reconciling' | 'unavailable';
  accountingVersion: number | null;
  reconciledAt: Date | null;
};

export const CONTROL_PLANE_STORAGE_THINGTIMES = [
  'account-link',
  'app',
  'app-storage',
	// Protected server-plumbing state is platform overhead. These Things are
	// minted by dedicated home-plane state machines, never generic user CRUD.
	'friend',
	'notification',
	// Poll votes are bounded engagement plumbing: one tiny fixed-shape doc per
	// (user, poll), minted only by POST /api/v1/things/vote (no generic
	// sanitizer). Direct-inserted without a storage stamp, so they must stay
	// out of billable arithmetic like the other dedicated-endpoint kinds.
	'vote',
	// Messenger communities, conversations, messages, comments, and custom
	// emoji are user-owned content and intentionally remain billable. Their
	// attachment object bytes are metered separately by attachment Things.
	...DEVICE_CONTROL_THINGTIME,
  'service-quota',
  'subscription',
  'subscription-tier',
  'user',
	'waitlist',
	MIGRATION_DIAGNOSTIC_THINGTIME
] as const;
const CONTROL_PLANE_THINGTIMES = new Set<string>(CONTROL_PLANE_STORAGE_THINGTIMES);

export type StorageSandboxState = 'real' | 'sandbox' | 'invalid';

// Root sandboxExpiresAt is server-owned. A real standing row has no field; a
// sandbox row has a valid Date. Explicit null/string/etc. is malformed legacy
// state and must enter reconciliation as invalid instead of silently escaping
// both the standing ledger and TTL cleanup.
export const storageSandboxState = (doc: { sandboxExpiresAt?: unknown }): StorageSandboxState => {
  if (!Object.prototype.hasOwnProperty.call(doc, 'sandboxExpiresAt')) return 'real';
	return doc.sandboxExpiresAt instanceof Date && Number.isFinite(doc.sandboxExpiresAt.getTime()) ? 'sandbox' : 'invalid';
};

// Shared Mongo expressions for the same three-way rule. Candidate scans retain
// malformed values so the valid facet can reject them; a valid source requires
// exact field absence.
export const nonSandboxStorageCandidateExpression = {
  $ne: [{ $type: '$sandboxExpiresAt' }, 'date']
};
export const realStorageSourceExpression = {
  $eq: [{ $type: '$sandboxExpiresAt' }, 'missing']
};

export const billableStorageCandidateExpression = {
  $and: [
    nonSandboxStorageCandidateExpression,
    { $ne: ['$storageClass', 'control'] },
    {
      $eq: [
        {
          $size: {
						$setIntersection: [{ $cond: [{ $isArray: '$thingtime' }, '$thingtime', []] }, [...CONTROL_PLANE_STORAGE_THINGTIMES]]
          }
        },
        0
      ]
    }
  ]
};

// Unknown user-created kinds default to billable, preventing a new schema from
// becoming a quota bypass merely because somebody forgot to add it here.
// Control-plane Things are platform overhead and stay writable when an account
// is full so users can authenticate, downgrade/delete content, and recover.
// Only server-owned root metadata may opt a record out. Crystal fields are
// always user-controlled and therefore must never influence this decision.
export const isBillableStorageThing = (doc: {
  ownerId?: unknown;
  thingtime?: unknown;
  storageClass?: unknown;
  sandboxExpiresAt?: unknown;
  crystal?: unknown;
}): boolean => {
  const ownerId = typeof doc.ownerId === 'string' ? doc.ownerId : '';
  if (!ownerId || ownerId.startsWith('sandbox:') || storageSandboxState(doc) === 'sandbox') return false;
  if (doc.storageClass === 'control') return false;
  const thingtime = Array.isArray(doc.thingtime) ? doc.thingtime.filter((entry): entry is string => typeof entry === 'string') : [];
  return !thingtime.some((entry) => CONTROL_PLANE_THINGTIMES.has(entry));
};

export const storageRemainingBytes = (usedBytes: number, allowanceBytes: number | null): number | null =>
  allowanceBytes === null ? null : Math.max(0, allowanceBytes - usedBytes);

export const storageOverageBytes = (usedBytes: number, allowanceBytes: number | null): number =>
  allowanceBytes === null ? 0 : Math.max(0, usedBytes - allowanceBytes);

export const normalizedStorageUsage = (input: {
  usedBytes: unknown;
  allowanceBytes: number | null;
  // Set false when a caller had to fall back from a malformed persisted
  // entitlement. A plausible fallback must never make a corrupt ledger look
  // authoritative or disagree with fail-closed admission.
  allowanceValid?: boolean;
  expectedAccountingVersion?: number;
  accountingVersion: unknown;
  ledgerStatus: unknown;
  reconciledAt?: unknown;
}): UserStorageUsage => {
  const validUsedBytes = Number.isSafeInteger(input.usedBytes) && Number(input.usedBytes) >= 0;
  const storedUsedBytes = validUsedBytes ? Number(input.usedBytes) : null;
  const validAllowance =
    input.allowanceValid !== false &&
		(input.allowanceBytes === null || (Number.isSafeInteger(input.allowanceBytes) && Number(input.allowanceBytes) >= 0));
  const expectedAccountingVersion = input.expectedAccountingVersion ?? USER_STORAGE_ACCOUNTING_VERSION;
	const structurallyCurrent = validUsedBytes && validAllowance && input.accountingVersion === expectedAccountingVersion;
	const ready = structurallyCurrent && input.ledgerStatus === USER_STORAGE_STATUS.ready;
  const reconciling =
		structurallyCurrent && (input.ledgerStatus === USER_STORAGE_STATUS.initializing || input.ledgerStatus === USER_STORAGE_STATUS.needsReconcile);
  const status = ready ? 'ready' : reconciling ? 'reconciling' : 'unavailable';
  const usedBytes = status === 'unavailable' ? null : storedUsedBytes!;
  return {
    usedBytes,
    allowanceBytes: input.allowanceBytes,
    remainingBytes: usedBytes === null ? null : storageRemainingBytes(usedBytes, input.allowanceBytes),
    overageBytes: usedBytes === null ? null : storageOverageBytes(usedBytes, input.allowanceBytes),
    status,
    accountingVersion: Number.isSafeInteger(input.accountingVersion) ? Number(input.accountingVersion) : null,
    reconciledAt: input.reconciledAt instanceof Date ? input.reconciledAt : null
  };
};

export class StorageMutationError extends Error {
  status: number;
  code: 'quota_exceeded' | 'accounting_unavailable' | 'storage_conflict' | 'storage_invariant';

  constructor(status: number, code: StorageMutationError['code'], message: string) {
    super(message);
    this.name = 'StorageMutationError';
    this.status = status;
    this.code = code;
  }
}
