import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTROL_PLANE_STORAGE_THINGTIMES,
  InvalidAttachmentStorageEnvelopeError,
  USER_STORAGE_ACCOUNTING_VERSION,
  USER_STORAGE_STATUS,
  currentContentStorageSizeBytes,
  isBillableStorageThing,
  normalizedStorageUsage,
  storageSandboxState,
  thingStorageSizeBytes
} from './storageCore.ts';
// @ts-ignore Node's direct TypeScript runner requires the extension.
import { COLLECTION_SCHEMA_VERSIONS, DEVICE_CONTROL_THINGTIME, DEVICE_THINGTIME, MESSENGER_THINGTIME } from '../../../schemas/registry.ts';

test('thingStorageSizeBytes is exact UTF-8 JSON bytes for the canonical payload', () => {
  const payload = {
    crystal: { title: 'Hello 🥰', nested: { enabled: true } },
    extended: { lines: ['one', '二'] },
    tags: ['hello', 'unicode']
  };
  const expected = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  assert.equal(thingStorageSizeBytes(payload), expected);
  assert.ok(expected > JSON.stringify(payload).length, 'multibyte content must be counted as bytes, not UTF-16 characters');
});

test('missing payload fields normalize identically everywhere', () => {
	assert.equal(thingStorageSizeBytes({}), Buffer.byteLength(JSON.stringify({ crystal: null, extended: null, tags: [] }), 'utf8'));
});

test('protected attachment envelopes add exact object bytes without changing ordinary Thing sizes', () => {
  const ordinary = {
    thingtime: ['post'],
    crystal: { name: 'photo.png', size: 42, contentType: 'image/png', mediaKind: 'image' },
    extended: null,
    tags: []
  };
	const payloadBytes = Buffer.byteLength(JSON.stringify({ crystal: ordinary.crystal, extended: ordinary.extended, tags: ordinary.tags }), 'utf8');
  assert.equal(thingStorageSizeBytes(ordinary), payloadBytes);
  assert.equal(
    thingStorageSizeBytes({
      ...ordinary,
      attachmentEnvelopeVersion: 1,
      attachmentState: 'ready',
      objectSizeBytes: 999,
      objectKey: 'objects/user/forged'
    }),
    payloadBytes,
    'non-attachment Things cannot forge object-byte accounting through root-like fields'
  );
  assert.equal(
    thingStorageSizeBytes({
      ...ordinary,
      thingtime: ['attachment'],
      attachmentEnvelopeVersion: 1,
      attachmentState: 'ready',
      objectSizeBytes: 42,
      objectKey: 'objects/user/attachment-id'
    }),
    payloadBytes + 42
  );
  assert.throws(
    () =>
      thingStorageSizeBytes({
        ...ordinary,
        thingtime: ['attachment'],
        attachmentEnvelopeVersion: 1,
        attachmentState: 'ready',
        objectSizeBytes: 41,
        objectKey: 'objects/user/attachment-id'
      }),
    InvalidAttachmentStorageEnvelopeError
  );
});

test('incremental ledger arithmetic accepts only an exact current canonical source stamp', () => {
  const doc = {
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['post'],
    crystal: { text: 'byte truth 🥰' },
    extended: null,
    tags: ['exact'],
    storageClass: 'content',
    storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
    sizeBytes: 0
  };
  doc.sizeBytes = thingStorageSizeBytes(doc);
  assert.equal(currentContentStorageSizeBytes(doc), doc.sizeBytes);
  assert.equal(currentContentStorageSizeBytes({ ...doc, sizeBytes: doc.sizeBytes + 1 }), null);
  assert.equal(currentContentStorageSizeBytes({ ...doc, storageAccountingVersion: 0 }), null);
  assert.equal(currentContentStorageSizeBytes({ ...doc, thingtime: 'post' }), null);
  assert.equal(currentContentStorageSizeBytes({ ...doc, storageClass: undefined }), null);
});

test('all attachment lifecycle states stay billable while malformed envelopes fail current-stamp validation', () => {
  const base = {
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['attachment'],
    crystal: { name: 'movie.mp4', size: 100, contentType: 'video/mp4', mediaKind: 'video' },
    extended: null,
    tags: [],
    storageClass: 'content',
    storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
    attachmentEnvelopeVersion: 1,
    objectSizeBytes: 100,
    objectKey: 'pending/user/attachment-id',
    attachmentState: 'pending',
    sizeBytes: 0
  };
  for (const attachmentState of ['pending', 'finalizing', 'ready', 'deleting']) {
    const doc = { ...base, attachmentState };
    doc.sizeBytes = thingStorageSizeBytes(doc);
    assert.equal(currentContentStorageSizeBytes(doc), doc.sizeBytes, attachmentState);
  }
  const current = { ...base };
  current.sizeBytes = thingStorageSizeBytes(current);
  assert.equal(currentContentStorageSizeBytes({ ...current, objectSizeBytes: 99 }), null);
  assert.equal(currentContentStorageSizeBytes({ ...current, objectKey: '' }), null);
  assert.equal(currentContentStorageSizeBytes({ ...current, attachmentEnvelopeVersion: 0 }), null);
});

test('billable policy defaults user content on and excludes control-plane and sandbox Things', () => {
  assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['post'], crystal: {} }), true);
  assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['future-user-kind'], crystal: {} }), true);
  assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['schema'], crystal: {} }), true);
  assert.equal(isBillableStorageThing({ ownerId: 'system', thingtime: ['schema'], storageClass: 'control', crystal: {} }), false);
  assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['subscription'], crystal: {} }), false);
  assert.equal(
    isBillableStorageThing({ ownerId: 'u1', thingtime: ['data'], crystal: { quotaKind: 'service-quota' } }),
    true,
    'user-authored crystal metadata cannot exempt content from billing'
  );
  assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['service-quota'], crystal: {} }), false);
	assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['attachment'], crystal: {} }), true);
	assert.equal((CONTROL_PLANE_STORAGE_THINGTIMES as readonly string[]).includes('attachment'), false);
	for (const thingtime of ['friend', 'notification'] as const) {
		assert.equal(
			(CONTROL_PLANE_STORAGE_THINGTIMES as readonly string[]).includes(thingtime),
			true,
			`${thingtime} must be excluded by the Mongo reconciliation candidate list`
		);
		assert.equal(
			isBillableStorageThing({ ownerId: 'u1', thingtime: [thingtime], crystal: {} }),
			false,
			`${thingtime} is protected server plumbing, not user-billable content`
		);
	}
	for (const thingtime of MESSENGER_THINGTIME) {
		assert.equal(
			(CONTROL_PLANE_STORAGE_THINGTIMES as readonly string[]).includes(thingtime),
			false,
			`${thingtime} must participate in user-content reconciliation`
		);
		assert.equal(
			isBillableStorageThing({ ownerId: 'u1', thingtime: [thingtime], crystal: {} }),
			true,
			`${thingtime} is user-owned Messenger storage; attachment object bytes are metered separately`
		);
	}
	for (const thingtime of DEVICE_THINGTIME) {
		const control = (DEVICE_CONTROL_THINGTIME as readonly string[]).includes(thingtime);
		assert.equal(
			(CONTROL_PLANE_STORAGE_THINGTIMES as readonly string[]).includes(thingtime),
			control,
			`${thingtime} control/content classification must match reconciliation`
		);
		assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: [thingtime], crystal: {} }), !control, `${thingtime} billing policy`);
	}
	assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['migration-diagnostic'], crystal: {} }), false);
  assert.equal(
    isBillableStorageThing({ ownerId: 'u1', thingtime: 'service-quota', crystal: {} }),
    true,
    'a malformed scalar kind cannot impersonate a protected control-plane array'
  );
  assert.equal(isBillableStorageThing({ ownerId: 'u1', thingtime: ['data'], storageClass: 'control', crystal: {} }), false);
	assert.equal(isBillableStorageThing({ ownerId: 'sandbox:123', thingtime: ['data'], crystal: {}, sandboxExpiresAt: new Date() }), false);
  assert.equal(storageSandboxState({}), 'real');
  assert.equal(storageSandboxState({ sandboxExpiresAt: new Date() }), 'sandbox');
  assert.equal(storageSandboxState({ sandboxExpiresAt: null }), 'invalid');
  assert.equal(
    isBillableStorageThing({ ownerId: 'u1', thingtime: ['data'], crystal: {}, sandboxExpiresAt: null }),
    true,
    'a malformed sandbox marker remains a billable candidate until migration normalizes it'
  );
});

test('usage projection distinguishes unlimited, overage, reconciling, and unavailable', () => {
  const ready = normalizedStorageUsage({
    usedBytes: 12,
    allowanceBytes: null,
    accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
    ledgerStatus: USER_STORAGE_STATUS.ready
  });
  assert.deepEqual(
    { remainingBytes: ready.remainingBytes, overageBytes: ready.overageBytes, status: ready.status },
    { remainingBytes: null, overageBytes: 0, status: 'ready' }
  );

  const over = normalizedStorageUsage({
    usedBytes: 12,
    allowanceBytes: 10,
    accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
    ledgerStatus: USER_STORAGE_STATUS.ready
  });
  assert.equal(over.remainingBytes, 0);
  assert.equal(over.overageBytes, 2);

  assert.equal(
    normalizedStorageUsage({
      usedBytes: 0,
      allowanceBytes: 10,
      accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      ledgerStatus: USER_STORAGE_STATUS.needsReconcile
    }).status,
    'reconciling'
  );
  assert.equal(
    normalizedStorageUsage({ usedBytes: 0, allowanceBytes: 10, accountingVersion: null, ledgerStatus: null }).usedBytes,
    null,
    'an unavailable ledger must not carry a fabricated display zero'
  );
  assert.equal(
    normalizedStorageUsage({
      usedBytes: undefined,
      allowanceBytes: 10,
      accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      ledgerStatus: USER_STORAGE_STATUS.ready
    }).usedBytes,
    null,
    'a ready marker cannot turn a missing counter into an exact zero'
  );
  assert.deepEqual(
    normalizedStorageUsage({
      usedBytes: undefined,
      allowanceBytes: 10,
      accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      ledgerStatus: USER_STORAGE_STATUS.needsReconcile
    }),
    {
      usedBytes: null,
      allowanceBytes: 10,
      remainingBytes: null,
      overageBytes: null,
      status: 'unavailable',
      accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      reconciledAt: null
    },
    'a malformed counter cannot masquerade as a provisional zero either'
  );
  assert.equal(
    normalizedStorageUsage({
      usedBytes: 0,
      allowanceBytes: 10,
      accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      ledgerStatus: null
    }).status,
    'unavailable',
    'display readiness must match the literal admission predicate'
  );
  assert.equal(
    normalizedStorageUsage({
      usedBytes: 0,
      allowanceBytes: 0,
      allowanceValid: false,
      accountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      ledgerStatus: USER_STORAGE_STATUS.ready
    }).status,
    'unavailable',
    'a fallback entitlement cannot make malformed persisted quota data look authoritative'
  );
  assert.equal(
    normalizedStorageUsage({
      usedBytes: 0,
      allowanceBytes: 10,
      expectedAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION + 1,
      accountingVersion: USER_STORAGE_ACCOUNTING_VERSION + 1,
      ledgerStatus: USER_STORAGE_STATUS.ready
    }).status,
    'ready',
    'independently versioned ledgers compare against their own expected accounting version'
  );
});
