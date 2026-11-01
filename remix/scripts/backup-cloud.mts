// Explicit private session configuration supplied by the caller. Never discover
// browser cookies, read native credentials, or print tokens/API response bodies.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
import { openLocalBackupStore } from '../app/api/utils/backups/localBackupStore';
import { prepareCloudFolderBackup, resumeCloudFolderBackup } from '../app/api/utils/backups/cloudFolderBackup';
import { backupId } from '../app/backups/manifest';
import { timelineScopeKey } from '../app/timeline/contract';

const [command, configuration, directory, snapshotId, folderId, ...extra] = process.argv.slice(2);
if (
	!['create', 'resume'].includes(command) ||
	!configuration ||
	!directory ||
	!backupId(snapshotId) ||
	extra.length ||
	(command === 'create' ? !folderId : folderId !== undefined)
)
	throw Error('Usage: backup-cloud.mts create SESSION_CONFIG VAULT SNAPSHOT_UUID FOLDER_ID | resume SESSION_CONFIG VAULT SNAPSHOT_UUID');
const handle = await open(configuration, constants.O_RDONLY | constants.O_NOFOLLOW);
let config: any;
try {
	const stat = await handle.stat();
	if (!stat.isFile() || stat.size > 16 * 1024 || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid()))
		throw Error('Use a private owned session configuration file');
	const bytes = Buffer.alloc(16 * 1024 + 1);
	let total = 0;
	while (total < bytes.length) {
		const read = await handle.read(bytes, total, bytes.length - total, total);
		if (!read.bytesRead) break;
		total += read.bytesRead;
	}
	if (total > 16 * 1024) throw Error('Session configuration is too large');
	try {
		config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)));
	} catch {
		throw Error('Session configuration is not valid JSON');
	}
} finally {
	await handle.close();
}
if (
	!config ||
	Object.keys(config).sort().join(',') !== 'origin,ownerId,token' ||
	typeof config.token !== 'string' ||
	!config.token ||
	/[\s\r\n]/.test(config.token)
)
	throw Error('Invalid session configuration');
const origin = new URL(config.origin);
if (
	origin.origin !== config.origin ||
	!(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
)
	throw Error('Use HTTPS or local loopback for cloud backup');
const scope = { apiOrigin: origin.origin, ownerId: config.ownerId, dataPlane: 'home' };
timelineScopeKey(scope);
const abort = new AbortController();
process.once('SIGINT', () => abort.abort(Error('Backup cancelled')));
process.once('SIGTERM', () => abort.abort(Error('Backup cancelled')));
const sessionFetch: typeof fetch = async (url, init: any = {}) => {
	if (new URL(String(url)).origin !== scope.apiOrigin) throw Error('Backup origin changed');
	const headers = new Headers(init.headers);
	headers.set('Authorization', 'Bearer ' + config.token);
	return fetch(url, { ...init, headers, redirect: 'error' });
};
// The manifest is public and bounded; do not attach the session to discovery.
const response = await fetch(new URL('/.well-known/thingtime-capabilities.json', origin), {
	redirect: 'error',
	signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)])
});
if (!response.ok || !response.body) throw Error('Capability discovery failed');
const reader = response.body.getReader();
let manifestText = '',
	manifestBytes = 0;
const decoder = new TextDecoder('utf-8', { fatal: true });
try {
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		manifestBytes += chunk.value.length;
		if (manifestBytes > 1024 * 1024) throw Error('Capability discovery exceeds its bound');
		manifestText += decoder.decode(chunk.value, { stream: true });
	}
	manifestText += decoder.decode();
} finally {
	await reader.cancel().catch(() => {});
	reader.releaseLock();
}
const manifest = JSON.parse(manifestText);
const runtime = {
	scope,
	currentScope: () => scope,
	signal: abort.signal,
	fetch: sessionFetch,
	requireCapability: async (feature: string, minimum: string) => {
		if (!capabilitySatisfies(manifest.features?.[feature]?.version, minimum)) throw Error('Required backup capability is unavailable');
	}
};
const store = await openLocalBackupStore(directory, { create: command === 'create' });
console.log(JSON.stringify({ snapshotId, status: command === 'create' ? 'preparing' : 'resuming' }));
if (command === 'create') await prepareCloudFolderBackup(store, snapshotId, folderId!, runtime);
const result = await resumeCloudFolderBackup(store, snapshotId, runtime);
console.log(
	JSON.stringify({
		snapshotId,
		verified: true,
		items: result.seal.items,
		bytes: result.seal.bytes,
		copiedBytes: result.copiedBytes,
		reusedBytes: result.reusedBytes
	})
);
