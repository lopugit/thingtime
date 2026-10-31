import { cloudFileSyncEntry, parseCloudFile } from './cloudFile';
import {
	requestMobileFolders,
	supportsMobileStaging,
	supportsNativeCloudStaging,
	type FolderRequest,
	type FolderResult,
	type MobileStageRequest,
	type FolderCapabilities
} from './mobileFolders.client';
import { validateSyncRun, type SyncOperation } from './execute';
import { sameSyncScope, sameSyncStamp, type SyncScope } from './reconcile';
import type { FingerprintSource } from './contentFingerprint';
import { validateLocalStage, type LocalStagedCopy } from './localSyncTarget';

/** Receive into native private storage. This is only LocalSyncTarget.stage;
 * native write approval and publication/receipt recovery are separate methods.
 * Caller retains the immutable cloud run and rechecks source before publication. */
export async function stageMobileCopy(
	scope: SyncScope,
	rootId: string,
	operation: SyncOperation,
	source: FingerprintSource | undefined,
	signal: AbortSignal,
	request: (ownerId: string, input: FolderRequest, signal: AbortSignal) => Promise<FolderResult> = requestMobileFolders,
	bridge?: FolderCapabilities,
	transferred?: (bytes: number, received: number) => void
): Promise<LocalStagedCopy> {
	const transfer: MobileStageRequest = structuredClone({ scope, rootId, operation: { ...operation, confirmed: false } });
	validateSyncRun({ version: 1, id: 'stage-' + operation.id, scope: transfer.scope, operations: [transfer.operation] });
	const m = transfer.operation.mutation;
	if (m.kind !== 'copy' || m.from !== 'remote' || !/^[a-f0-9-]{36}$/i.test(rootId)) throw Error('Invalid mobile download.');
	if (m.source.kind === 'file' ? !source || source.size !== m.source.size : source !== undefined) throw Error('Native stage source changed.');
	const check = async () => {
		signal.throwIfAborted();
		await source?.check();
		signal.throwIfAborted();
	};
	const send = async (input: FolderRequest) => {
		signal.throwIfAborted();
		const result = await request(transfer.scope.ownerId, input, signal);
		signal.throwIfAborted();
		if (!result.staging) throw Error('Missing native staging progress.');
		return result.staging;
	};
	const streaming =
		(bridge?.platform === 'macos' || bridge?.platform === 'android') &&
		supportsMobileStaging(bridge) &&
		Number(bridge.fileStagingVersion!.split('.')[1]) >= 1;
	const nativeCloud = supportsNativeCloudStaging(bridge) && source?.nativeCloud ? structuredClone(source.nativeCloud) : undefined;
	if (nativeCloud) {
		nativeCloud.file = parseCloudFile(nativeCloud.file);
		if (!sameSyncScope(nativeCloud.scope, scope) || !sameSyncStamp(cloudFileSyncEntry(nativeCloud.file, m.path), m.source))
			throw Error('Native cloud source changed.');
	}
	await check();
	let progress = await send({ action: 'stage-begin', rootId, transfer });
	if (!Number.isSafeInteger(progress.received) || progress.received < 0 || progress.received > m.source.size) throw Error('Invalid staged offset.');
	transferred?.(0, progress.received);
	while (!progress.stage && progress.received < m.source.size) {
		const start = progress.received;
		if (nativeCloud) {
			const length = Math.min(2 * 1024 * 1024, m.source.size - start);
			const target = bridge?.platform === 'macos' ? await source!.downloadTarget?.(start, length, signal) : undefined;
			if (bridge?.platform === 'macos' && !target) throw Error('Native downloads require fresh signed range authority. Update the selected server.');
			progress = await send({ action: 'stage-download', rootId, transfer, offset: start, length, cloudFile: nativeCloud.file, ...(target ? { target } : {}) });
			if (progress.received !== start + length || progress.stage) throw Error('Native staging progress changed during transfer.');
			transferred?.(length, progress.received);
			await check();
			continue;
		}
		// Buffer cloud ranges once. Mac and Android staging 1.1 pull bounded
		// binary frames within one request; older hosts retain small messages.
		const bytes = await source!.read(start, Math.min(2 * 1024 * 1024, m.source.size - start), signal);
		signal.throwIfAborted();
		if (bytes.length !== Math.min(2 * 1024 * 1024, m.source.size - start)) throw Error('Incomplete cloud stage bytes.');
		transferred?.(bytes.length, start + bytes.length);
		if (streaming) {
			progress = await send({ action: 'stage-range', rootId, transfer, offset: start, bytes });
			if (progress.received !== start + bytes.length || progress.stage) throw Error('Native staging progress changed during transfer.');
		} else
			for (let offset = 0; offset < bytes.length; offset += 65_536) {
				const part = bytes.subarray(offset, Math.min(bytes.length, offset + 65_536));
				let binary = '';
				for (const byte of part) binary += String.fromCharCode(byte);
				progress = await send({ action: 'stage-append', rootId, transfer, offset: start + offset, data: btoa(binary) });
				if (progress.received !== start + offset + part.length || progress.stage) throw Error('Native staging progress changed during transfer.');
			}
		await check();
	}
	await check();
	if (!progress.stage) progress = await send({ action: 'stage-finish', rootId, transfer });
	if (!progress.stage || progress.received !== m.source.size) throw Error('Native download was not verified.');
	validateLocalStage(progress.stage, transfer.operation, transfer.scope);
	await check();
	return progress.stage;
}
