import { planBackupTree, treeRestoreReview } from '../app/api/utils/backups/treeRestorePlan';
import { restoreBackupTree, canonicalRestoreDestination } from '../app/api/utils/backups/localTreeRestore';
// Offline maintenance of an explicitly selected private portable backup. This
// does not enumerate an account/device, bypass API permissions, or create a new
// source inventory. Possession of the private vault supplies offline access.
import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupId, parseBackupHeader, BACKUP_METADATA_BYTES } from '../app/backups/manifest';
import { openLocalBackupStore } from '../app/api/utils/backups/localBackupStore';
import { verifySealedBackup, copySealedBackup, openBackupItem } from '../app/api/utils/backups/portableBackup';

const [command, sourceDirectory, snapshotId, destination, thingId, ...extra] = process.argv.slice(2);
if (
	!['verify', 'copy', 'restore-file', 'plan-tree', 'restore-tree', 'resume-tree'].includes(command) ||
	!sourceDirectory ||
	!backupId(snapshotId) ||
	extra.length ||
	(command === 'verify' ? destination !== undefined : !destination) ||
	(['restore-file', 'restore-tree', 'resume-tree'].includes(command) ? !thingId : thingId !== undefined)
) {
	throw Error(
		'Usage: backup-vault.mts verify SOURCE SNAPSHOT_ID | copy SOURCE SNAPSHOT_ID DESTINATION | restore-file SOURCE SNAPSHOT_ID DESTINATION_FILE THING_ID | plan-tree SOURCE SNAPSHOT_ID DESTINATION | restore-tree SOURCE SNAPSHOT_ID DESTINATION REVIEW_HASH | resume-tree SOURCE SNAPSHOT_ID DESTINATION REVIEW_HASH'
	);
}
const source = await openLocalBackupStore(sourceDirectory, { create: false });
const data = await source.read(`snapshots/${snapshotId}/header.json`, BACKUP_METADATA_BYTES);
if (!data) throw Error('Backup header not found');
const header = parseBackupHeader(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)));
const abort = new AbortController();
process.once('SIGINT', () => abort.abort(Error('Backup operation cancelled')));
process.once('SIGTERM', () => abort.abort(Error('Backup operation cancelled')));
// No live-session claim: this offline tool uses OS access to the explicitly
// chosen private vault. Web/native product adapters must supply real authority.
const access = { scope: header.scope, signal: abort.signal, authorize: async () => {} };
if (command === 'plan-tree') {
	const plan = await planBackupTree(source, snapshotId, access),
		directory = await canonicalRestoreDestination(destination!);
	console.log(
		JSON.stringify({
			review: treeRestoreReview(plan, directory),
			destination: directory,
			filesDirectory: join(directory, 'files'),
			snapshotId,
			coverage: plan.header.coverage,
			bytes: plan.seal.bytes,
			entries: plan.entries.map((entry) => ({ path: entry.path, kind: entry.kind, bytes: entry.item.content?.size ?? 0 }))
		})
	);
} else if (command === 'restore-tree' || command === 'resume-tree') {
	const result = await restoreBackupTree(source, snapshotId, destination!, thingId!, access, { resume: command === 'resume-tree' });
	console.log(JSON.stringify({ restored: true, snapshotId, ...result }));
} else if (command === 'verify') {
	const seal = await verifySealedBackup(source, snapshotId, access);
	console.log(JSON.stringify({ verified: true, snapshotId, items: seal.items, bytes: seal.bytes, manifestHash: seal.manifestHash }));
} else if (command === 'copy') {
	const target = await openLocalBackupStore(destination!);
	const result = await copySealedBackup(source, target, snapshotId, access);
	console.log(JSON.stringify({ verified: true, snapshotId, copiedBytes: result.copiedBytes, reusedBytes: result.reusedBytes }));
} else {
	const entry = await openBackupItem(source, snapshotId, thingId!, access);
	if (!entry.item.content) throw Error('The selected item has no file bytes');
	const finalPath = resolve(destination!),
		temporary = join(dirname(finalPath), '.thingtime-restore-' + randomUUID());
	const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
	try {
		try {
			for await (const range of entry.ranges) await handle.writeFile(range);
			await handle.sync();
		} finally {
			await handle.close();
		}
		abort.signal.throwIfAborted();
		// An explicit destination is required; archived placement never becomes a
		// filesystem path. Exclusive publication preserves any newer/existing file.
		await link(temporary, finalPath);
		const directory = await open(dirname(finalPath), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
		console.log(JSON.stringify({ restored: true, snapshotId, thingId: entry.item.thingId, bytes: entry.item.content.size }));
	} finally {
		await unlink(temporary);
	}
}
