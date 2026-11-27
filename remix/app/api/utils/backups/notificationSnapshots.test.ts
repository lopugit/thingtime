import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notificationDoc, SYSTEM_NOTIFICATION_ACTOR } from '../notifications/notifications';
import { notificationContentValue } from '../../../timeline/notificationContent';
import { backupNotificationSnapshotFromDoc, retainBackupNotification, openBackupNotification, readBackupNotification } from './notificationSnapshots';
import { openLocalBackupStore } from './localBackupStore';
import { BACKUP_FORMAT } from '../../../backups/manifest';
import { prepareBackup, sealBackup, copySealedBackup, openBackupItem } from './portableBackup';

test('notification historical content streams large detail independently without delivery/authority state', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-notification-backup-'));
	try {
		const first = await openLocalBackupStore(join(directory, 'first')), second = await openLocalBackupStore(join(directory, 'second'));
		const detail = 'Stored detail 🥰\n'.repeat(600_000), now = new Date('2026-11-06T00:00:00.000Z');
		const doc = { ...notificationDoc({ recipientId: 'owner', type: 'system-message', actor: SYSTEM_NOTIFICATION_ACTOR, title: 'Original history', detail, historyOnly: true }, now), secure: 'NEVER_EXPORT', systemNotificationKey: 'NEVER_EXPORT', providerToken: 'NEVER_EXPORT', deliveryAttempt: 'NEVER_EXPORT' };
		const expected = backupNotificationSnapshotFromDoc(doc), id = randomUUID(), scope = { ownerId: 'owner', apiOrigin: 'https://backup.test', dataPlane: 'home' }, access = { scope, authorize: async () => {} };
		await prepareBackup(first, { format: BACKUP_FORMAT, snapshotId: id, scope, boundary: { kind: 'point-in-time', token: 'notification-test', startedAt: now.toISOString(), completedAt: now.toISOString() }, coverage: { selectionId: 'notification-history', description: 'One explicitly selected notification history record; no delivery or account coverage claim.' } }, (async function* () { yield await retainBackupNotification(first, id, 0, doc, access); })(), access);
		await sealBackup(first, id, access); await copySealedBackup(first, second, id, access);
		doc.crystal.detail = 'Later';
		await rm(join(directory, 'first'), { recursive: true });
		const restored = await openBackupNotification(second, id, doc.shareId, access);
		assert.deepEqual(restored, expected);
		const value = notificationContentValue(restored);
		assert.equal(value.crystal.detail, detail); assert.equal(value.historyOnly, true); assert.equal(value.readAt, null);
		for (const key of ['secure', 'systemNotificationKey', 'providerToken', 'deliveryAttempt']) assert.equal(Object.prototype.hasOwnProperty.call(value, key), false);
		await assert.rejects(openBackupNotification(second, id, doc.shareId, { ...access, scope: { ...scope, ownerId: 'foreign' } }), /account|origin|owner/);
		for (const mode of ['abort', 'account', 'revoked']) {
			const opened = await openBackupItem(second, id, doc.shareId, access), abort = new AbortController();
			let changed = false;
			const check = () => { abort.signal.throwIfAborted(); if (mode === 'account' && changed) throw Error('Backup account or origin changed'); };
			const authorize = async () => { if (mode === 'revoked' && changed) throw Error('Revoked'); check(); };
			const bytes = (async function* () {
				for await (const chunk of opened.ranges) yield chunk;
				// This runs after the last verified range. The canonical rehash
				// must yield so lifecycle/identity changes still interrupt it.
				setImmediate(() => { changed = true; if (mode === 'abort') abort.abort(); });
			})();
			await assert.rejects(readBackupNotification(opened.item, bytes, 'owner', check, authorize), /abort|origin|Revoked/i);
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('notification projection rejects malformed family/timestamps and unknown canonical snapshot fields', () => {
	const doc = notificationDoc({ recipientId: 'owner', type: 'system-message', actor: SYSTEM_NOTIFICATION_ACTOR, title: 'History' }, new Date());
	assert.throws(() => backupNotificationSnapshotFromDoc({ ...doc, thingtime: ['user'] }), /family/);
	assert.throws(() => backupNotificationSnapshotFromDoc({ ...doc, createdAt: 'invalid' }), /timestamp/);
	const snapshot = backupNotificationSnapshotFromDoc(doc);
	assert.throws(() => notificationContentValue({ ...snapshot, value: { ...snapshot.value as any, deliveryAuthority: true } }), /content/);
});
