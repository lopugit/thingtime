import { BACKUP_ATTACHMENT_ADAPTER, backupAttachmentItemContent, parseBackupAttachment } from './attachmentRecords';
import { createHash } from 'node:crypto';
import { timelineScopeKey, type TimelineScope } from '../../../timeline/contract';
import { parseCloudFolder } from '../../../fileSync/cloudFolder';
import { parseCloudInventory, MAX_CLOUD_INVENTORY_BYTES } from '../../../fileSync/cloudInventory';
import { CLOUD_FILE_ADAPTER, parseCloudFile } from '../../../fileSync/cloudFile';
import { equalContentFingerprints } from '../../../fileSync/contentFingerprint';
import { MAX_ATTACHMENT_RANGE_BYTES, readExactRange } from '../attachments/attachmentRanges';
import { EXPECTED_ACTOR_HEADER } from '../auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../../../utils/dataPlane';
import { BACKUP_FORMAT, BACKUP_METADATA_BYTES, parseBackupHeader, type BackupItem } from '../../../backups/manifest';
import { prepareBackup, captureBackup, sealBackup, type BackupObjectStore } from './portableBackup';

export const CLOUD_BACKUP_FOLDER_ADAPTER = 'backup-file-folder';
export const CLOUD_FOLDER_BACKUP_REQUIREMENTS = {
	'api.files': '1.2.0',
	'api.attachment-content': '1.14.0',
	'api.actions-run': '1.7.0',
	'api.mongodb-endpoint': '1.1.0'
} as const;
export type CloudBackupRuntime = {
	scope: TimelineScope;
	currentScope(): TimelineScope;
	fetch: typeof fetch;
	requireCapability(feature: string, minimum: string): Promise<void>;
	signal?: AbortSignal;
};

/** Uses existing authenticated APIs only. No signed URLs, session credentials or
 * filesystem destinations enter the persisted plan. A selected filesystem tree
 * is explicit coverage, not an account-wide or ordinary-Thing export. */
function cloud(runtime: CloudBackupRuntime) {
	const scope = { ...runtime.scope },
		key = timelineScopeKey(scope);
	if (scope.dataPlane !== 'home') throw Error('Cloud backups require home storage');
	const guard = () => {
		runtime.signal?.throwIfAborted();
		if (timelineScopeKey(runtime.currentScope()) !== key) throw Error('Backup account or origin changed');
	};
	const request = async (path: string, signal?: AbortSignal) => {
		guard();
		const response = await runtime.fetch(new URL(path, scope.apiOrigin), {
			method: 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal: AbortSignal.any([AbortSignal.timeout(30_000), ...[runtime.signal, signal].filter((s): s is AbortSignal => !!s)]),
			headers: { Accept: 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane }
		});
		try {
			guard();
			if (!response.ok) throw Error(`Cloud backup request failed (${response.status})`);
		} catch (error) {
			await response.body?.cancel().catch(() => {});
			throw error;
		}
		return response;
	};
	const json = async (path: string, max = BACKUP_METADATA_BYTES) => {
		const response = await request(path);
		if (!response.body) throw Error('Cloud backup response is missing');
		const reader = response.body.getReader(),
			decoder = new TextDecoder('utf-8', { fatal: true });
		let size = 0,
			text = '';
		try {
			for (;;) {
				const next = await reader.read();
				guard();
				if (next.done) break;
				size += next.value.length;
				if (size > max) throw Error('Cloud backup response exceeds its bound');
				text += decoder.decode(next.value, { stream: true });
			}
			text += decoder.decode();
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		const result = JSON.parse(text);
		if (path !== '/api/v1/auth/me' && result?.ok !== true) throw Error('Cloud backup response is invalid');
		return result;
	};
	const authenticate = async () => {
		guard();
		for (const [feature, version] of Object.entries(CLOUD_FOLDER_BACKUP_REQUIREMENTS)) {
			await runtime.requireCapability(feature, version);
			guard();
		}
		if ((await json('/api/v1/auth/me')).user?.id !== scope.ownerId) throw Error('Backup account changed');
		guard();
	};
	return { scope, guard, request, json, authenticate, access: { scope, signal: runtime.signal, authorize: async () => guard() } };
}

/** Freeze one complete server inventory before downloading. The existing API's
 * 10,000-node/8 MiB bound fails explicitly; it never becomes a partial backup. */
export async function prepareCloudFolderBackup(store: BackupObjectStore, snapshotId: string, folderId: string, runtime: CloudBackupRuntime) {
	const c = cloud(runtime);
	// Validate the ID before deriving storage keys or making network requests.
	parseBackupHeader({
		format: BACKUP_FORMAT,
		snapshotId,
		scope: c.scope,
		boundary: { kind: 'capture-interval', token: 'pending', startedAt: new Date(0).toISOString(), completedAt: new Date(0).toISOString() },
		coverage: { selectionId: folderId, description: 'Selected cloud filesystem tree' }
	});
	if (await store.read(`snapshots/${snapshotId}/header.json`, BACKUP_METADATA_BYTES))
		throw Error('Snapshot already started; resume its frozen inventory');
	await c.authenticate();
	const startedAt = new Date().toISOString();
	const root = parseCloudFolder((await c.json('/api/v1/files?' + new URLSearchParams({ folderId }))).folder);
	const inventory = parseCloudInventory(
		(await c.json('/api/v1/files?' + new URLSearchParams({ rootId: folderId }), MAX_CLOUD_INVENTORY_BYTES + 1024)).inventory,
		folderId
	);
	if (root.id !== folderId || root.revision !== inventory.rootRevision) throw Error('Cloud folder changed during inventory; try a new capture');
	const completedAt = new Date().toISOString();
	const folderItem = (value: typeof root) => ({
		thingId: value.id,
		revision: value.revision,
		snapshot: { adapter: CLOUD_BACKUP_FOLDER_ADAPTER, version: 1, value },
		content: null
	});
	const rows = [
		folderItem(root),
		...inventory.nodes.map((node) =>
			node.kind === 'folder'
				? folderItem({ id: node.id, revision: node.revision, folderId: node.folderId, name: node.path.split('/').at(-1)! })
				: {
						thingId: node.file.id,
						revision: node.file.revision,
						snapshot: { adapter: CLOUD_FILE_ADAPTER, version: 1, value: node.file },
						content: { size: node.file.content.size, fingerprint: node.file.content.fingerprint }
				  }
		)
	].sort((a, b) => (a.thingId < b.thingId ? -1 : a.thingId > b.thingId ? 1 : 0));
	async function* items() {
		for (let ordinal = 0; ordinal < rows.length; ordinal++) yield { ...rows[ordinal], ordinal } as BackupItem;
	}
	await c.authenticate();
	return prepareBackup(
		store,
		{
			format: BACKUP_FORMAT,
			snapshotId,
			scope: c.scope,
			boundary: {
				kind: 'capture-interval',
				token: 'inventory-' + createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
				startedAt,
				completedAt
			},
			coverage: {
				selectionId: folderId,
				description: 'Selected cloud folder file tree including empty folders; ordinary Things and other folders are not included'
			}
		},
		items(),
		c.access
	);
}

/** Resume the original plan, not a new live inventory. Attachment range requests
 * reauthorize the owner and pin immutable object versions; edits/Trash do not
 * substitute current content. Every retained byte is verified before sealing. */
async function resumeCloudBackup(store: BackupObjectStore, snapshotId: string, runtime: CloudBackupRuntime, attachments: boolean) {
	const c = cloud(runtime);
	await c.authenticate();
	const result = await captureBackup(
		store,
		snapshotId,
		{
			read: async (item, offset, length, signal) => {
				let content;
				if (attachments && item.snapshot.adapter === BACKUP_ATTACHMENT_ADAPTER) {
					const record = parseBackupAttachment(item.snapshot.value);
					if (record.ownerId !== c.scope.ownerId) throw Error('Backup attachment owner changed');
					content = backupAttachmentItemContent(item);
					if (!content) throw Error('Linked attachment has no stored bytes');
				} else {
					if (item.snapshot.adapter !== CLOUD_FILE_ADAPTER || item.snapshot.version !== 1 || !item.content)
						throw Error('Unsupported cloud backup item');
					const file = parseCloudFile(item.snapshot.value);
					if (
						file.id !== item.thingId ||
						file.revision !== item.revision ||
						file.content.size !== item.content.size ||
						!equalContentFingerprints(file.content.fingerprint, item.content.fingerprint)
					)
						throw Error('Cloud backup item changed');
					content = file.content;
				}
				const bytes = new Uint8Array(length);
				for (let at = 0; at < length; at += MAX_ATTACHMENT_RANGE_BYTES) {
					const range = { version: content.version, offset: offset + at, length: Math.min(MAX_ATTACHMENT_RANGE_BYTES, length - at) };
					const response = await c.request(
						'/api/v1/attachments/content?' +
							new URLSearchParams({
								id: content.attachmentId,
								range: '1',
								version: range.version,
								offset: String(range.offset),
								length: String(range.length)
							}),
						signal
					);
					if (response.headers.get('ETag') !== `"${range.version}"`) {
						await response.body?.cancel();
						throw Error('Cloud backup version changed');
					}
					bytes.set(
						await readExactRange(response, range, content.size, () => {
							c.guard();
							signal?.throwIfAborted();
						}),
						at
					);
				}
				c.guard();
				return bytes;
			}
		},
		c.access
	);
	await c.authenticate();
	const seal = await sealBackup(
		{
			...store,
			put: async (key, bytes) => {
				if (key.endsWith('/complete.json')) await c.authenticate();
				await store.put(key, bytes);
			}
		},
		snapshotId,
		c.access
	);
	return { ...result, seal };
}

/** Selected-folder compatibility entry point. */
export const resumeCloudFolderBackup = (store: BackupObjectStore, snapshotId: string, runtime: CloudBackupRuntime) =>
	resumeCloudBackup(store, snapshotId, runtime, false);

/** Captures only the already-frozen account plan. Attachment byte reads use the
 * existing authenticated exact-version content endpoint. Timeline payloads were
 * retained during enumeration; a missing history chunk cannot be reconstructed
 * from newer database state. No complete account API or restore is implied. */
export const resumeAccountBackup = (store: BackupObjectStore, snapshotId: string, runtime: CloudBackupRuntime) =>
	resumeCloudBackup(store, snapshotId, runtime, true);
