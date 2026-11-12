import { backupId } from '../../../backups/manifest';

/** One portable key grammar for every provider; archived names are never keys. */
export function assertBackupObjectKey(key: string): void {
	const inventory =
		/^snapshots\/([^/]+)\/(inventory-receipts\/[a-f0-9]{64}\.json|references\/nodes\/[a-f0-9]{64}|references\/bundles\/[a-f0-9]{64}\/(0|[1-9][0-9]{0,15})\.json|references\/blobs\/[a-f0-9]{64}\/(0|[1-9][0-9]{0,15}))$/.exec(
			key
		);
	if (inventory && backupId(inventory[1])) return;
	const restoreReference = /^restore-plans\/([^/]+)\/references\/(nodes\/[a-f0-9]{64}|bundles\/[a-f0-9]{64}\/(0|[1-9][0-9]{0,15})\.json|blobs\/[a-f0-9]{64}\/(0|[1-9][0-9]{0,15}))$/.exec(key);
	if (restoreReference && backupId(restoreReference[1])) return;
	const checkpoint = /^hash-checkpoints\/([^/]+)\/([^/]+)\.json$/.exec(key);
	if (checkpoint && backupId(checkpoint[1]) && backupId(checkpoint[2])) return;
	const restore = /^restore-plans\/([^/]+)\/(header\.json|sealed\.json|pages\/(0|[1-9][0-9]{0,15})\.json)$/.exec(key);
	if (restore && backupId(restore[1])) return;
	if (
		!/^(chunks\/[a-f0-9]{64}|snapshots\/[0-9a-f-]{36}\/(header|plan|complete)\.json|snapshots\/[0-9a-f-]{36}\/plan\/(0|[1-9][0-9]{0,15})\.json|snapshots\/[0-9a-f-]{36}\/ranges\/(0|[1-9][0-9]{0,15})\/(0|[1-9][0-9]{0,15})\.json)$/.test(
			key
		)
	)
		throw Error('Invalid backup storage key');
}
