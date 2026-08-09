import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { exactByteLabel, storageProjectionTitle, storageStatusPresentation } from './adminStorageProjection.ts';

const storage = {
	usedBytes: 12_345,
	allowanceBytes: 20_000,
	remainingBytes: 7_655,
	overageBytes: 0,
	status: 'ready' as const,
	accountingVersion: 1,
	reconciledAt: '2026-08-07T00:00:00.000Z'
};

test('exact byte labels never round the canonical counter', () => {
	assert.equal(exactByteLabel(12_345), '12,345 bytes');
	assert.equal(exactByteLabel(1), '1 byte');
	assert.equal(exactByteLabel(null), '—');
});

test('ready storage is explicitly presented as exact and includes ledger details', () => {
	assert.deepEqual(storageStatusPresentation(storage), {
		label: 'exact',
		colorScheme: 'green',
		description: 'The displayed byte count is backed by the canonical reconciled ledger.'
	});
	assert.match(storageProjectionTitle(storage), /12,345 bytes used/);
	assert.match(storageProjectionTitle(storage), /accounting version 1/);
	assert.match(storageProjectionTitle(storage), /2026-08-07T00:00:00.000Z/);
});

test('reconciling and unavailable counters cannot masquerade as exact zero usage', () => {
	assert.equal(storageStatusPresentation({ ...storage, status: 'reconciling' }).label, 'reconciling');
	assert.equal(storageStatusPresentation(null).label, 'unavailable');
	assert.match(storageStatusPresentation(null).description, /not presented as zero/);
});

test('overage is visible even when a reconciled ledger is otherwise ready', () => {
	const over = { ...storage, usedBytes: 21_000, remainingBytes: 0, overageBytes: 1_000 };
	assert.equal(storageStatusPresentation(over).colorScheme, 'red');
	assert.match(storageProjectionTitle(over), /1,000 bytes overage/);
});
