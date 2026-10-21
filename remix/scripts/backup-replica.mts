// A native/worker handoff for an explicitly selected sealed portable snapshot.
// stdin is a private pipe from the owning app/vault, never an SDK credential
// search, secret command-line argument, browser session, or credential file.
import { fstatSync } from 'node:fs';
import { once } from 'node:events';
import { backupId, BACKUP_METADATA_BYTES, parseBackupHeader } from '../app/backups/manifest';
import { timelineScopeKey } from '../app/timeline/contract';
import { openLocalBackupStore } from '../app/api/utils/backups/localBackupStore';
import { openS3BackupStore } from '../app/api/utils/backups/s3BackupStore';
import { copySealedBackup } from '../app/api/utils/backups/portableBackup';

async function main() {
	const [command, directory, snapshotId, fixture, ...extra] = process.argv.slice(2);
	if (
		!['upload', 'download'].includes(command) ||
		!directory ||
		!backupId(snapshotId) ||
		extra.length ||
		(fixture !== undefined && fixture !== '--local-http-fixture')
	)
		throw Error('Usage: backup-replica.mts upload|download VAULT SNAPSHOT_UUID [--local-http-fixture]');
	if (!fstatSync(0).isFIFO() && !fstatSync(0).isSocket()) throw Error('Supply the vault handoff through a private stdin pipe');
	const abort = new AbortController();
	const cancel = () => {
		abort.abort(Error('Backup cancelled'));
		process.stdin.destroy();
	};
	process.once('SIGINT', cancel);
	process.once('SIGTERM', cancel);
	let remote: ReturnType<typeof openS3BackupStore> | undefined;
	try {
		const buffer = Buffer.alloc(16 * 1024);
		let length = 0;
		const timeout = setTimeout(cancel, 30_000);
		let handoff: any;
		try {
			for await (const chunk of process.stdin) {
				if (length + chunk.length > buffer.length) throw Error('Backup handoff exceeds its bound');
				buffer.set(chunk, length);
				length += chunk.length;
			}
			abort.signal.throwIfAborted();
			try {
				handoff = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
			} catch {
				throw Error('Invalid backup handoff');
			}
		} finally {
			clearTimeout(timeout);
			buffer.fill(0);
		}
		if (!handoff || Object.keys(handoff).sort().join(',') !== 'credentials,destination,scope') throw Error('Invalid backup handoff');
		const scopeKey = timelineScopeKey(handoff.scope);
		const credential = handoff.credentials;
		if (
			!credential ||
			!['accessKeyId,secretAccessKey', 'accessKeyId,expiration,secretAccessKey,sessionToken'].includes(Object.keys(credential).sort().join(',')) ||
			typeof credential.accessKeyId !== 'string' ||
			!/^[A-Za-z0-9_-]{1,256}$/.test(credential.accessKeyId) ||
			typeof credential.secretAccessKey !== 'string' ||
			!/^[\x21-\x7e]{1,2048}$/.test(credential.secretAccessKey)
		)
			throw Error('Invalid backup credentials');
		let expiration: number | undefined;
		if ('sessionToken' in credential) {
			if (
				typeof credential.sessionToken !== 'string' ||
				!/^[\x21-\x7e]{1,8192}$/.test(credential.sessionToken) ||
				typeof credential.expiration !== 'string' ||
				!Number.isFinite((expiration = Date.parse(credential.expiration)))
			)
				throw Error('Invalid backup credentials');
		}
		const authorize = async () => {
			abort.signal.throwIfAborted();
			if (expiration !== undefined && Date.now() >= expiration) throw Error('Backup credentials expired');
		};
		await authorize();
		const access = { scope: handoff.scope, signal: abort.signal, authorize };
		remote = openS3BackupStore(handoff.destination, {
			...access,
			allowLoopbackHttp: fixture === '--local-http-fixture',
			credentials: {
				accessKeyId: credential.accessKeyId,
				secretAccessKey: credential.secretAccessKey,
				...(credential.sessionToken ? { sessionToken: credential.sessionToken, expiration: new Date(expiration!) } : {})
			}
		});
		const local = await openLocalBackupStore(directory, { create: command === 'download' });
		const source = command === 'upload' ? local : remote;
		const destination = command === 'upload' ? remote : local;
		const bytes = await source.read(`snapshots/${snapshotId}/header.json`, BACKUP_METADATA_BYTES);
		if (!bytes) throw Error('Backup header not found');
		const header = parseBackupHeader(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
		if (header.snapshotId !== snapshotId || timelineScopeKey(header.scope) !== scopeKey) throw Error('Backup account or origin changed');
		let lastReport = 0;
		const result = await copySealedBackup(source, destination, snapshotId, access, {
			onProgress: async (progress) => {
				if (progress.phase === 'copying' && Date.now() - lastReport < 1000) return;
				lastReport = Date.now();
				if (!process.stdout.write(JSON.stringify(progress) + '\n')) await once(process.stdout, 'drain', { signal: abort.signal });
			}
		});
		console.log(JSON.stringify({ snapshotId, verified: true, ...result }));
	} finally {
		remote?.close();
		process.removeListener('SIGINT', cancel);
		process.removeListener('SIGTERM', cancel);
	}
}
await main().catch(() => {
	// Provider/JSON errors can contain private endpoints, object keys or values.
	console.error('Backup replica transfer failed. Check the selected destination, scope and vault credentials, then retry the same snapshot.');
	process.exitCode = 1;
});
