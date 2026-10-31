import { syncRequestHasPacing, parseSyncResourceStatus, type SyncResourceStatus } from './resourceGovernor';
import { parseNativeFolderBatchResult } from './folderBatch';
import { parseNativeIndexChangesPage, type NativeIndexChangesPage } from './streamingIndex';
import { parseNativeUploadBatchResult } from './uploadBatch';
import { canonicalIgnoreRules, createSyncIgnorePolicy } from './syncIgnore';
import { nativeInventoryPageSize, parseNativeBackupStatus, parseNativeSkippedPage, parseNativeInventoryCapture, parseNativeInventoryPage, type NativeBackupStatus, type NativeBackupCapture, type NativeSkippedPage, type NativeInventoryCapture, type NativeInventoryPage } from './nativeInventory';
import { canonicalNativeScanExclusions, isNativeScanExcluded } from './nativeScanExclusions';
import { trackNativeUploadBackground } from './nativeUploadBackground';
import { parseFileSyncConfiguration } from './configuration';
import { validateSyncScope } from './reconcile';
import {
	parseNativeRecoveryPage,
	validNativeRestore,
	type NativeRestore,
	type NativeRecoveryPage,
	parseNativeVersionPage,
	type NativeVersionPage,
	type NativeVersionRestore
} from './nativeRecovery';
import { validateTrashExpected, type LocalTrashContext } from './localTrash';
import type { CloudFile } from './cloudFile';
import { mobileRangeFrame, receiveMobileReadFrame } from './mobileRangeFrames';
import { validateLocalStage, type LocalStagedCopy } from './localSyncTarget';
import type { SyncOperation, SyncReceiptLookup } from './execute';
import { sameSyncScope, sameSyncContent, type SyncScope } from './reconcile';
import type { SyncConditions } from './configuredPlan';
import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../utils/nativeBridge';
import { planFileSync, validSyncEntry, validSyncPath, type SyncEntry } from './reconcile';
import {
	contentPartPlan,
	type FingerprintSource,
	type NativePartUpload,
	type NativeFileUpload,
	type ContentFingerprint,
	validContentFingerprint,
	equalContentFingerprints
} from './contentFingerprint';

export type MobileFolder = {
	id: string;
	name: string;
	publicationVersion?: string;
	sourceKind?: 'photos';
	photoAccess?: 'full' | 'limited' | 'unavailable';
};
export type MobileStageRequest = { scope: SyncScope; rootId: string; operation: SyncOperation };
export type MobileTrashRequest = MobileStageRequest & LocalTrashContext;
export type MobileWriteApproval = { scope: SyncScope; configurationRevision: string; configurationHash: string; allowTrash?: boolean };
export type FolderRequest = { resourceLimits?: import('./configuration').FileSyncResourceLimits; resourceScope?: string } & (
	| { action: 'validate-folder-batch'; rootId: string; batch: Omit<import('./folderBatch').NativeFolderBatchInput, 'remainingMs'>; remainingMs: number }
	| { action: 'upload-batch'; rootId: string; batch: import('./uploadBatch').NativeUploadBatchInput }
	| { action: 'upload-file'; rootId: string; upload: NativeFileUpload & { source: SyncEntry } }
	| { action: 'upload-part'; rootId: string; upload: NativePartUpload & { source: SyncEntry } }
	| { action: 'list' | 'choose' | 'conditions' | 'prepare-upload' }
	| { action: 'remove'; rootId: string }
	| { action: 'scan'; rootId: string; excludedPaths?: string[]; ignoreRules?: string }
	| { action: 'scan-stream'; rootId: string; inventoryDeviceId: string; captureId: string; excludedPaths?: string[]; ignoreRules?: string; capturePolicy: 'one-way-supported' }
	| { action: 'scan-stream-finish'; rootId: string; inventoryDeviceId: string; captureId: string; afterSequence: number; excludedPaths?: string[]; ignoreRules?: string; capturePolicy: 'one-way-supported' }
	| { action: 'scan-changes'; rootId: string; inventoryDeviceId: string; captureId: string; afterSequence: number; pageSize?: number; waitMilliseconds?: number; excludedPaths?: string[]; ignoreRules?: string; capturePolicy: 'one-way-supported' }
	| { action: 'scan-capture'; rootId: string; inventoryDeviceId: string; captureId: string; excludedPaths?: string[]; ignoreRules?: string; capturePolicy?: 'backup-supported' }
	| { action: 'scan-status' | 'scan-cancel'; rootId: string; inventoryDeviceId: string; captureId: string; capturePolicy: 'backup-supported' | 'one-way-supported'; excludedPaths?: string[]; ignoreRules?: string }
	| { action: 'scan-skips'; rootId: string; inventoryDeviceId: string; capture: NativeBackupCapture; offset: number; pageSize?: number; ignoreRules?: string; capturePolicy: 'backup-supported' }
	| { action: 'scan-page'; rootId: string; inventoryDeviceId: string; capture: NativeInventoryCapture; offset: number; pageSize?: number; ignoreRules?: string; capturePolicy?: 'backup-supported' }
	| { action: 'scan-discard'; rootId: string; inventoryDeviceId: string; capture: NativeInventoryCapture; ignoreRules?: string; capturePolicy?: 'backup-supported' }
	| { action: 'inspect'; rootId: string; path: string }
	| { action: 'version-list'; rootId: string; cursor?: string }
	| { action: 'version-inspect'; rootId: string; versionId: string; expected: SyncEntry }
	| { action: 'version-restore-reviewed' | 'version-restore-status'; rootId: string; restore: NativeVersionRestore }
	| { action: 'trash-list'; rootId: string; cursor?: string }
	| { action: 'trash-restore-reviewed'; rootId: string; trash: MobileTrashRequest; restore: NativeRestore }
	| { action: 'read' | 'read-range'; rootId: string; path: string; version: string; offset: number; length: number; verifiedChunks?: true }
	| { action: 'stage-begin' | 'stage-finish'; rootId: string; transfer: MobileStageRequest }
	| { action: 'stage-download'; rootId: string; transfer: MobileStageRequest; offset: number; length: number; cloudFile: CloudFile; target?: import('./signedDownloadTarget').SignedDownloadTarget }
	| { action: 'stage-range'; rootId: string; transfer: MobileStageRequest; offset: number; bytes: Uint8Array<ArrayBuffer> }
	| { action: 'stage-append'; rootId: string; transfer: MobileStageRequest; offset: number; data: string }
	| { action: 'write-approve' | 'write-check'; rootId: string; approval: MobileWriteApproval }
	| { action: 'publication-lookup'; rootId: string; transfer: MobileStageRequest }
	| { action: 'publish'; rootId: string; transfer: MobileStageRequest; stage: LocalStagedCopy; approval: MobileWriteApproval }
	| { action: 'trash-lookup' | 'trash-expected' | 'trash-inspect'; rootId: string; trash: MobileTrashRequest }
	| { action: 'trash'; rootId: string; trash: MobileTrashRequest; approval: MobileWriteApproval }
	| {
			action: 'trash-restore';
			rootId: string;
			trash: MobileTrashRequest;
			restore: { path: string; expected: SyncEntry };
			approval: MobileWriteApproval;
	  }
);
export type FolderResult = {
	resources?: SyncResourceStatus;
	uploadedBatch?: import('./uploadBatch').NativeUploadBatchResult;
	validatedFolderBatch?: import('./folderBatch').NativeFolderBatchResult;
	uploadedFile?: { fingerprint: ContentFingerprint };
	uploadedPart?: { sha256: string; payloadBytes?: number };
	writeApproval?: MobileWriteApproval;
	publication?: SyncReceiptLookup;
	trash?: SyncReceiptLookup;
	retainedEntry?: SyncEntry | null;
	restoredEntry?: SyncEntry;
	expectedEntry?: SyncEntry;
	trashPage?: NativeRecoveryPage;
	versionPage?: NativeVersionPage;
	versionRestore?: { status: 'missing' } | { status: 'complete'; entry: SyncEntry };
	restoreIntent?: { request: NativeRestore; receipt?: SyncEntry | null } | null;
	staging?: { received: number; stage?: LocalStagedCopy };
	roots: MobileFolder[];
	conditions?: SyncConditions;
	entries?: SyncEntry[];
	inspectedEntry?: SyncEntry | null;
	backupCapture?: NativeBackupStatus;
	skippedPage?: NativeSkippedPage;
	cancelled?: true;
	capture?: NativeInventoryCapture;
	inventoryPage?: NativeInventoryPage;
	changesPage?: NativeIndexChangesPage;
	chunk?: { version: string; size: number; offset: number; data: string };
	range?: { version: string; size: number; offset: number; bytes: Uint8Array<ArrayBuffer> };
};
export type FolderCapabilities = Pick<
	ThingtimeNativeBridge,
	| 'platform'
	| 'fileResourceLimitsVersion'
	| 'fileDownloadVersion'
	| 'fileUploadVersion'
	| 'fileUploadBatchVersion'
	| 'fileFolderBatchVersion'
	| 'fileAccessVersion'
	| 'fileStagingVersion'
	| 'filePublicationVersion'
	| 'fileTrashVersion'
	| 'fileVersionsVersion'
>;
export const supportsNativeResourceLimits = (bridge: FolderCapabilities | undefined) => /^1\.\d+\.\d+$/.test(bridge?.fileResourceLimitsVersion ?? '');
export const supportsNativePartUploads = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	(bridge?.platform === 'ios' || bridge?.platform === 'android' || bridge?.platform === 'macos') && /^1\.\d+\.\d+$/.test(bridge.fileUploadVersion ?? '');
/** Additive Mac 1.1 receipt telemetry; mobile whole-file versions are independent. */
export const supportsNativePartPayloadBytes = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	bridge?.platform === 'macos' && supportsNativePartUploads(bridge) && Number(bridge.fileUploadVersion!.split('.')[1]) >= 1;
export const supportsNativeUploadBatches = (bridge: FolderCapabilities | undefined) =>
	bridge?.platform === 'macos' && supportsNativeAuthorizationContext(bridge) && /^1\.\d+\.\d+$/.test(bridge.fileUploadBatchVersion ?? '');
export const supportsNativeFolderBatches = (bridge: FolderCapabilities | undefined) =>
	bridge?.platform === 'macos' && supportsNativeAuthorizationContext(bridge) && /^1\.\d+\.\d+$/.test(bridge.fileFolderBatchVersion ?? '');
/** These native access contracts independently add exact single-path inspection. */
export const supportsNativeInventoryPages = (bridge: FolderCapabilities | undefined = getNativeBridge()) => {
	const minimum = bridge?.platform === 'macos' ? 5 : bridge?.platform === 'ios' ? 3 : undefined;
	// The first patch fixes destination alias checks in wide directories. Older
	// native builds keep the bounded runner even though they can produce pages.
	const [major, minor, patch] = (bridge?.fileAccessVersion ?? '').split('.').map(Number);
	return minimum !== undefined && /^1\.\d+\.\d+$/.test(bridge?.fileAccessVersion ?? '') && major === 1 &&
		(minor > minimum || (minor === minimum && patch >= 1));
};
/** Exclusions are pruned before opening native files or descending directories. */
export const supportsNativeScanExclusions = (bridge: FolderCapabilities | undefined = getNativeBridge()) => {
	const minimum = bridge?.platform === 'macos' ? 6 : bridge?.platform === 'ios' ? 4 : undefined;
	return minimum !== undefined && /^1\.\d+\.\d+$/.test(bridge?.fileAccessVersion ?? '') &&
		Number(bridge!.fileAccessVersion!.split('.')[1]) >= minimum;
};
/** Mac 1.8 explicitly negotiates best-effort backup and its complete skip ledger. */
export const supportsNativeBackupCapture = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	bridge?.platform === 'macos' && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? '') && Number(bridge.fileAccessVersion!.split('.')[1]) >= 8;
export const supportsNativeIgnoreRules = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	bridge?.platform === 'macos' && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? '') && Number(bridge.fileAccessVersion!.split('.')[1]) >= 9;
/** Mac 1.10 adds opt-in byte-bounded inventory batches. */
export const supportsNativeInventoryBatches = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	bridge?.platform === 'macos' && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? '') && Number(bridge.fileAccessVersion!.split('.')[1]) >= 10;
/** Composite roots/conditions are sampled inside one freshly authorized native request. */
export const supportsNativeAuthorizationContext = (bridge: FolderCapabilities | undefined) =>
 bridge?.platform === 'macos' && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? '') && Number(bridge.fileAccessVersion!.split('.')[1]) >= 12;
export const supportsNativeStreamingIndex = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	bridge?.platform === 'macos' && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? '') && Number(bridge.fileAccessVersion!.split('.')[1]) >= 11;
/** 1.11.1 bounds the complete change envelope, including repeated revisions. */
export const supportsNativeStreamingBatches = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsNativeStreamingIndex(bridge) && (Number(bridge!.fileAccessVersion!.split('.')[1]) > 11 || Number(bridge!.fileAccessVersion!.split('.')[2]) >= 1);
export function assertNativeScanExclusions(request: FolderRequest, bridge: FolderCapabilities | undefined) {
	if ((['scan-stream', 'scan-changes', 'scan-stream-finish'].includes(request.action) || ('capturePolicy' in request && request.capturePolicy === 'one-way-supported')) && !supportsNativeStreamingIndex(bridge)) throw Error('Update Thingtime Mac to transfer while indexing.');
	if ('pageSize' in request && request.pageSize !== undefined) {
		if (!['scan-page', 'scan-skips', 'scan-changes'].includes(request.action)) throw Error('Invalid native inventory page size action.');
		nativeInventoryPageSize(request.pageSize);
		if (!supportsNativeInventoryBatches(bridge)) throw Error('Update Thingtime Mac to import larger inventory batches.');
	}
	if ('ignoreRules' in request && canonicalIgnoreRules(request.ignoreRules) && !supportsNativeIgnoreRules(bridge))
		throw Error('Update Thingtime Mac to apply Gitignore rules before scanning this folder.');
	if ((('capturePolicy' in request && request.capturePolicy === 'backup-supported') ||
		('capture' in request && request.capture.coverage !== undefined)) && !supportsNativeBackupCapture(bridge))
		throw Error('Update Thingtime Mac to index supported backup items and review skipped items.');
	if (request.action !== 'scan' && request.action !== 'scan-capture' && request.action !== 'scan-status' && request.action !== 'scan-cancel' && request.action !== 'scan-stream' && request.action !== 'scan-changes' && request.action !== 'scan-stream-finish') return;
	const keys = canonicalNativeScanExclusions(request.excludedPaths === undefined ? [] : request.excludedPaths);
	if (keys.length && !supportsNativeScanExclusions(bridge)) throw Error('Update Thingtime to exclude paths before scanning this folder.');
}
function verifyScanExclusions(request: Extract<FolderRequest, { action: 'scan' | 'scan-capture' | 'scan-status' | 'scan-cancel' | 'scan-stream' | 'scan-changes' | 'scan-stream-finish' }>, echoed: unknown): string[] {
	const keys = canonicalNativeScanExclusions(request.excludedPaths === undefined ? [] : request.excludedPaths);
	if (keys.length && JSON.stringify(keys) !== JSON.stringify(canonicalNativeScanExclusions(echoed)))
		throw Error('Native scan exclusions changed.');
	return keys;
}
export const supportsNativePathInspection = (bridge: FolderCapabilities | undefined = getNativeBridge()) => {
	const minimum = bridge?.platform === 'macos' ? 4 : bridge?.platform === 'ios' ? 2 : undefined;
	return minimum !== undefined && /^1\.\d+\.\d+$/.test(bridge?.fileAccessVersion ?? '') && Number(bridge!.fileAccessVersion!.split('.')[1]) >= minimum;
};
export const supportsNativeFileUploads = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsNativePartUploads(bridge) && Number(bridge!.fileUploadVersion!.split('.')[1]) >= 2;
export const supportsNativeBackgroundUploads = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsNativeFileUploads(bridge) && Number(bridge!.fileUploadVersion!.split('.')[1]) >= 3;
function validFileUpload(upload: NativeFileUpload & { source: SyncEntry }) {
	try {
		const plan = contentPartPlan(upload.source.size);
		const approval = upload.authorization;
		validateSyncScope(approval.scope);
		const configuration = parseFileSyncConfiguration(approval.configuration);
		if (
			approval.id !== approval.scope.rootId ||
			configuration.deviceId !== approval.scope.deviceId ||
			configuration.paused ||
			configuration.mode === 'download' ||
			typeof approval.updatedAt !== 'string' ||
			!Number.isFinite(Date.parse(approval.updatedAt))
		)
			return false;
		return (
			validPartUpload({ ...upload, partNumber: 1, offset: 0, length: Math.min(plan.partSizeBytes, upload.source.size) }) &&
			validContentFingerprint(upload.source.fingerprint, upload.source.size)
		);
	} catch {
		return false;
	}
}
/** Only strictly increasing canonical part boundaries can renew the inactivity
 * deadline. Foreign, duplicate and malformed progress cannot keep a job alive. */
export function nativeFileUploadProgress(
	value: unknown,
	expected: { requestId: string; ownerId: string; origin: string },
	request: Extract<FolderRequest, { action: 'upload-file' }>,
	previous: number
): number | null {
	const message = value as any,
		p = message?.payload,
		upload = request.upload;
	if (message?.type !== 'mobile-files-progress' || !p || Object.entries(expected).some(([key, value]) => p[key] !== value)) return null;
	if (
		!validFileUpload(upload) ||
		p.rootId !== request.rootId ||
		p.uploadId !== upload.uploadId ||
		p.operationId !== upload.requestId ||
		p.version !== upload.source.version ||
		p.size !== upload.source.size ||
		!Number.isSafeInteger(p.received) ||
		p.received <= previous ||
		p.received > upload.source.size ||
		(p.received !== upload.source.size && p.received % contentPartPlan(upload.source.size).partSizeBytes !== 0)
	)
		return null;
	return p.received;
}
export function nativeFileUploadStarted(
	value: unknown,
	expected: { requestId: string; ownerId: string; origin: string },
	request: Extract<FolderRequest, { action: 'upload-file' }>
): boolean | undefined {
	const message = value as any,
		p = message?.payload,
		upload = request.upload;
	if (message?.type !== 'mobile-files-started' || !p || Object.entries(expected).some(([key, value]) => p[key] !== value)) return undefined;
	if (
		!validFileUpload(upload) ||
		p.rootId !== request.rootId ||
		p.uploadId !== upload.uploadId ||
		p.operationId !== upload.requestId ||
		p.version !== upload.source.version ||
		p.size !== upload.source.size ||
		typeof p.background !== 'boolean'
	)
		return undefined;
	return p.background;
}
function validPartUpload(upload: NativePartUpload & { source: SyncEntry }) {
	try {
		if (!validSyncEntry(upload.source) || upload.source.kind !== 'file' || upload.source.size <= 0) return false;
		const plan = contentPartPlan(upload.source.size);
		return (
			[upload.uploadId, upload.requestId].every((id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) &&
			Number.isSafeInteger(upload.partNumber) &&
			upload.partNumber >= 1 &&
			upload.partNumber <= plan.partCount &&
			upload.offset === (upload.partNumber - 1) * plan.partSizeBytes &&
			upload.length === Math.min(plan.partSizeBytes, upload.source.size - upload.offset)
		);
	} catch {
		return false;
	}
}
export const supportsFolderAccess = (bridge: FolderCapabilities | undefined) =>
	Boolean(bridge && ['ios', 'android', 'macos'].includes(bridge.platform) && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? ''));
export const supportsMobileFolders = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()) =>
	Boolean(
		bridge?.isNativeWebView && (bridge.platform === 'ios' || bridge.platform === 'android') && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? '')
	);
export function parseMobileFolderResult(
	value: unknown,
	expected: { requestId: string; ownerId: string; origin: string },
	request: FolderRequest
): FolderResult | null {
	const message = value as any,
		payload = message?.payload;
	if (message?.type !== 'mobile-files-result' || !payload || Object.entries(expected).some(([key, value]) => payload[key] !== value)) return null;
	if (typeof payload.error === 'string') throw Error(payload.error.slice(0, 240));
	if (
		!Array.isArray(payload.roots) ||
		payload.roots.length > 32 ||
		new Set(payload.roots.map((r: any) => r?.id)).size !== payload.roots.length ||
		payload.roots.some(
			(r: any) =>
				typeof r?.id !== 'string' ||
				!/^[a-f0-9-]{36}$/i.test(r.id) ||
				typeof r.name !== 'string' ||
				!r.name ||
				r.name.length > 1024 ||
				(r.sourceKind !== undefined && r.sourceKind !== 'photos') ||
				(r.sourceKind === 'photos'
					? !['full', 'limited', 'unavailable'].includes(r.photoAccess) || r.publicationVersion !== undefined
					: r.photoAccess !== undefined) ||
				(r.publicationVersion !== undefined &&
					(typeof r.publicationVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.publicationVersion) || r.publicationVersion.length > 32))
		)
	)
		throw Error('Invalid native folder response.');
	const result: FolderResult = {
		roots: payload.roots.map((r: any) => ({
			id: r.id,
			name: r.name,
			...(r.publicationVersion !== undefined ? { publicationVersion: r.publicationVersion } : {}),
			...(r.sourceKind === 'photos' ? { sourceKind: r.sourceKind, photoAccess: r.photoAccess } : {})
		}))
	};
	if (payload.resources !== undefined) result.resources = parseSyncResourceStatus(payload.resources);
	if (request.action === 'validate-folder-batch') {
		if (payload.rootId !== request.rootId || request.rootId !== request.batch.descriptor.configuration.configuration.localRootId) throw Error('Folder batch source root changed.');
		result.validatedFolderBatch = parseNativeFolderBatchResult(payload.validatedFolderBatch, { ...request.batch, remainingMs: request.remainingMs });
	}
	if (request.action === 'upload-batch') {
		if (payload.rootId !== request.rootId || request.rootId !== request.batch.descriptor.configuration.configuration.localRootId)
			throw Error('Native upload batch changed its source root.');
		result.uploadedBatch = parseNativeUploadBatchResult(payload.uploadedBatch, request.batch);
	}
	if (payload.scanFailure !== undefined) {
		const reasons: Record<string, string> = {
			symlink: 'symbolic links are not supported',
			special: 'this is not a regular file or folder',
			unreadable: 'this item could not be read',
			changed: 'this item changed during indexing',
			'invalid-path': 'a path cannot be represented safely',
			'duplicate-identity': 'multiple paths refer to the same file',
			'path-collision': 'multiple paths have the same normalized name'
		};
		const failure = payload.scanFailure;
		if ((request.action !== 'scan' && request.action !== 'scan-capture') || payload.rootId !== request.rootId ||
			payload.complete !== false || payload.entries !== undefined || payload.capture !== undefined || payload.inventoryPage !== undefined ||
			!failure || typeof failure !== 'object' || Array.isArray(failure) ||
			Object.keys(failure).some(key => !['reason', 'path'].includes(key)) ||
			typeof failure.reason !== 'string' || !Object.prototype.hasOwnProperty.call(reasons, failure.reason) ||
			(failure.path === null ? failure.reason !== 'invalid-path' : !validSyncPath(failure.path)))
			throw Error('Invalid native scan diagnostic.');
		const location = failure.path === null ? '' : ` at “${failure.path}”`;
		throw Error(`Indexing stopped${location}: ${reasons[failure.reason]}. Review this item and your exclusions before retrying.`);
	}
	if (['scan', 'scan-capture', 'scan-status', 'scan-cancel', 'scan-page', 'scan-skips', 'scan-discard', 'scan-stream', 'scan-changes', 'scan-stream-finish'].includes(request.action)) {
		const rules = canonicalIgnoreRules('ignoreRules' in request ? request.ignoreRules : undefined);
		if (rules !== (payload.ignoreRules === undefined ? '' : payload.ignoreRules)) throw Error('Native scan ignore rules changed.');
	}
	if (request.action === 'upload-file') {
		const file = payload.uploadedFile,
			upload = request.upload;
		if (
			!validFileUpload(upload) ||
			payload.rootId !== request.rootId ||
			!file ||
			file.uploadId !== upload.uploadId ||
			file.requestId !== upload.requestId ||
			file.version !== upload.source.version ||
			file.size !== upload.source.size ||
			!validContentFingerprint(file.fingerprint, upload.source.size) ||
			!equalContentFingerprints(file.fingerprint, upload.source.fingerprint!)
		)
			throw Error('Invalid native file upload receipt.');
		result.uploadedFile = { fingerprint: structuredClone(file.fingerprint) };
	}
	if (request.action === 'upload-part') {
		const part = payload.uploadedPart,
			upload = request.upload;
		if (
			!validPartUpload(upload) ||
			payload.rootId !== request.rootId ||
			!part ||
			part.uploadId !== upload.uploadId ||
			part.requestId !== upload.requestId ||
			part.partNumber !== upload.partNumber ||
			part.offset !== upload.offset ||
			part.length !== upload.length ||
			part.version !== upload.source.version ||
			part.size !== upload.source.size ||
			typeof part.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/.test(part.sha256)
		)
			throw Error('Invalid native upload receipt.');
		// Optional telemetry cannot invalidate an otherwise exact authenticated receipt.
		result.uploadedPart = {
			sha256: part.sha256,
			...(Number.isSafeInteger(part.payloadBytes) && part.payloadBytes === upload.length ? { payloadBytes: part.payloadBytes } : {})
		};
	}
	if (request.action.startsWith('version-')) {
		if (payload.rootId !== ('rootId' in request && request.rootId)) throw Error('Native version folder changed.');
		if (request.action === 'version-list') result.versionPage = parseNativeVersionPage(payload.versionPage);
		else if (request.action === 'version-inspect') {
			const entry = payload.retainedEntry;
			if (
				!validSyncEntry(entry) ||
				entry.kind !== 'file' ||
				entry.id !== request.expected.id ||
				entry.version !== request.expected.version ||
				entry.path !== request.expected.path ||
				!sameSyncContent(entry, request.expected)
			)
				throw Error('Retained version changed.');
			result.retainedEntry = structuredClone(entry);
		} else if (request.action === 'version-restore-reviewed' || request.action === 'version-restore-status') {
			const status = request.action === 'version-restore-status' ? payload.versionRestore?.status : 'complete';
			if (status === 'missing') {
				result.versionRestore = { status: 'missing' };
				return result;
			}
			if (status !== 'complete') throw Error('Invalid version restore status.');
			const entry = request.action === 'version-restore-status' ? payload.versionRestore.entry : payload.restoredEntry;
			if (
				!validSyncEntry(entry) ||
				entry.kind !== 'file' ||
				entry.path !== request.restore.path ||
				entry.id === request.restore.expected.id ||
				!sameSyncContent(entry, request.restore.expected) ||
				(request.action === 'version-restore-reviewed' && payload.operationId !== request.restore.operationId)
			)
				throw Error('Native version restore is not confirmed.');
			if (request.action === 'version-restore-status') result.versionRestore = { status: 'complete', entry: structuredClone(entry) };
			else result.restoredEntry = structuredClone(entry);
		}
	} else if (request.action === 'trash-list') {
		if (payload.rootId !== request.rootId) throw Error('Native recovery folder changed.');
		result.trashPage = parseNativeRecoveryPage(payload.trashPage, expected, request.rootId);
	} else if (request.action === 'write-approve' || request.action === 'write-check') {
		const approved = payload.writeApproval;
		if (
			payload.rootId !== request.rootId ||
			!approved ||
			!sameSyncScope(approved.scope, request.approval.scope) ||
			approved.configurationRevision !== request.approval.configurationRevision ||
			approved.configurationHash !== request.approval.configurationHash ||
			approved.allowTrash !== request.approval.allowTrash
		)
			throw Error('Native folder write approval changed.');
		result.writeApproval = structuredClone(request.approval);
	} else if (
		request.action === 'trash' ||
		request.action === 'trash-lookup' ||
		request.action === 'trash-expected' ||
		request.action === 'trash-inspect' ||
		request.action === 'trash-restore' ||
		request.action === 'trash-restore-reviewed'
	) {
		const m = request.trash.operation.mutation;
		if (payload.rootId !== request.rootId || m.kind !== 'trash' || m.side !== 'local') throw Error('Native trash scope changed.');
		if (request.action === 'trash-expected') {
			validateTrashExpected(request.trash.operation, payload.expectedEntry);
			result.expectedEntry = structuredClone(payload.expectedEntry);
		} else if (request.action === 'trash-inspect') {
			const entry = payload.retainedEntry;
			if (entry !== null && (!validSyncEntry(entry) || entry.path !== m.path)) throw Error('Invalid retained native item.');
			result.retainedEntry = entry === null ? null : structuredClone(entry);
			const intent = payload.restoreIntent;
			if (
				intent != null &&
				(!validNativeRestore(intent.request, m.path) ||
					(intent.receipt != null &&
						(!validSyncEntry(intent.receipt) ||
							intent.receipt.path !== intent.request.path ||
							intent.receipt.id !== intent.request.expected.id ||
							!sameSyncContent(intent.receipt, intent.request.expected))))
			)
				throw Error('Invalid native restoration intent.');
			if (payload.restoreIntent !== undefined) result.restoreIntent = intent == null ? null : structuredClone(intent);
		} else if (request.action === 'trash-restore' || request.action === 'trash-restore-reviewed') {
			const entry = payload.restoredEntry;
			if (
				!validSyncEntry(entry) ||
				entry.path !== request.restore.path ||
				entry.id !== request.restore.expected.id ||
				!sameSyncContent(entry, request.restore.expected)
			)
				throw Error('Native restore is not confirmed.');
			result.restoredEntry = structuredClone(entry);
		} else {
			const lookup = payload.trash,
				receipt = lookup?.receipt;
			if (!['missing', 'pending', 'complete'].includes(lookup?.status) || (request.action === 'trash' && lookup.status !== 'complete'))
				throw Error('Native trash is not confirmed.');
			if (lookup.status === 'complete') {
				if (receipt?.operationId !== request.trash.operation.id || !sameSyncScope(receipt?.scope, request.trash.scope) || receipt.entry !== null)
					throw Error('Invalid native trash receipt.');
				result.trash = { status: 'complete', receipt: structuredClone(receipt) };
			} else result.trash = { status: lookup.status };
		}
	} else if (request.action === 'publication-lookup' || request.action === 'publish') {
		const publication = payload.publication,
			receipt = publication?.receipt,
			m = request.transfer.operation.mutation;
		if (
			payload.rootId !== request.rootId ||
			!['missing', 'pending', 'complete'].includes(publication?.status) ||
			(request.action === 'publish' && publication.status !== 'complete')
		)
			throw Error('Native publication is not confirmed.');
		if (publication.status === 'complete') {
			if (
				m.kind !== 'copy' ||
				m.from !== 'remote' ||
				receipt?.operationId !== request.transfer.operation.id ||
				!sameSyncScope(receipt?.scope, request.transfer.scope) ||
				!validSyncEntry(receipt?.entry) ||
				receipt.entry.path !== m.path ||
				!sameSyncContent(receipt.entry, m.source)
			)
				throw Error('Invalid native publication receipt.');
			result.publication = { status: 'complete', receipt: structuredClone(receipt) };
		} else result.publication = { status: publication.status };
	} else if (
		request.action === 'stage-begin' ||
		request.action === 'stage-append' ||
		request.action === 'stage-range' ||
		request.action === 'stage-download' ||
		request.action === 'stage-finish'
	) {
		const state = payload.staging,
			m = request.transfer.operation.mutation;
		if (
			payload.rootId !== request.rootId ||
			m.kind !== 'copy' ||
			m.from !== 'remote' ||
			!Number.isSafeInteger(state?.received) ||
			state.received < 0 ||
			state.received > m.source.size ||
			(request.action === 'stage-append' && state.received < request.offset + atob(request.data).length) ||
			(request.action === 'stage-download' &&
				(!Number.isSafeInteger(request.offset) ||
					request.offset < 0 ||
					!Number.isSafeInteger(request.length) ||
					request.length <= 0 ||
					request.length > 2 * 1024 * 1024 ||
					state.received !== request.offset + request.length)) ||
			(request.action === 'stage-range' &&
				(!(request.bytes instanceof Uint8Array) ||
					request.bytes.length <= 0 ||
					request.bytes.length > 32 * 1024 * 1024 ||
					state.received !== request.offset + request.bytes.length))
		)
			throw Error('Invalid native staging progress.');
		if (state.stage !== undefined && state.stage !== null) {
			validateLocalStage(state.stage, request.transfer.operation, request.transfer.scope);
			if (state.received !== m.source.size) throw Error('Incomplete native stage.');
		} else if (request.action === 'stage-finish') throw Error('Native bytes have not been verified.');
		result.staging = { received: state.received, ...(state.stage ? { stage: structuredClone(state.stage) } : {}) };
	} else if (request.action === 'conditions') {
		const c = payload.conditions;
		if (!c || !['wifi', 'cellular', 'ethernet', 'offline', 'unknown'].includes(c.network) || (c.charging !== null && typeof c.charging !== 'boolean'))
			throw Error('Native transfer conditions are unavailable.');
		result.conditions = { network: c.network, charging: c.charging };
	} else if (request.action === 'scan-stream' || request.action === 'scan-changes' || request.action === 'scan-stream-finish' || (request.action === 'scan-cancel' && request.capturePolicy === 'one-way-supported')) {
		if (payload.rootId !== request.rootId || payload.capturePolicy !== 'one-way-supported') throw Error('Native streaming scope or policy changed.');
		verifyScanExclusions(request, payload.excludedPaths);
		result.changesPage = parseNativeIndexChangesPage(payload.changesPage, request.captureId, 'afterSequence' in request ? request.afterSequence : 0, request.action === 'scan-changes' ? request.pageSize : undefined);
		if (request.action === 'scan-cancel') { if (!['interrupted', 'complete'].includes(result.changesPage.state)) throw Error('Native streaming cancellation was not confirmed.'); result.cancelled = true; }
	} else if (request.action === 'scan-status') {
		if (payload.rootId !== request.rootId || payload.capturePolicy !== 'backup-supported' || payload.capture !== undefined || payload.entries !== undefined)
			throw Error('Native backup capture scope or policy changed.');
		verifyScanExclusions(request, payload.excludedPaths);
		result.backupCapture = parseNativeBackupStatus(payload.backupCapture);
		if (result.backupCapture.id !== request.captureId || payload.complete !== (result.backupCapture.state === 'complete')) throw Error('Native backup capture identity or completion changed.');
	} else if (request.action === 'scan-cancel') {
		if (payload.rootId !== request.rootId || payload.cancelled !== true || payload.complete !== false || payload.captureId !== request.captureId)
			throw Error('Native backup cancellation was not confirmed.');
		verifyScanExclusions(request, payload.excludedPaths); result.cancelled = true;
	} else if (request.action === 'scan-skips') {
		if (payload.rootId !== request.rootId || payload.complete !== true) throw Error('Native skipped inventory is incomplete or belongs to another root.');
		if (payload.capturePolicy !== 'backup-supported') throw Error('Native backup policy changed.');
		result.skippedPage = parseNativeSkippedPage(payload.skippedPage, request.capture, request.offset, request.pageSize);
	} else if (request.action === 'scan-capture' || request.action === 'scan-page' || request.action === 'scan-discard') {
		if ('capture' in request && request.capture.coverage !== undefined && (request.capturePolicy !== 'backup-supported' || payload.capturePolicy !== 'backup-supported')) throw Error('Native backup policy changed.');
		if (payload.rootId !== request.rootId || (payload.complete !== true && !(request.action === 'scan-capture' && request.capturePolicy === 'backup-supported'))) throw Error('Native inventory is incomplete or belongs to another root.');
		if (request.action === 'scan-capture') {
			if (((value: FolderRequest) => 'capturePolicy' in value && value.capturePolicy === 'backup-supported')(request)) {
				if (payload.capturePolicy !== 'backup-supported' || payload.capture !== undefined || payload.entries !== undefined) throw Error('Native backup capture scope or policy changed.');
				verifyScanExclusions(request, payload.excludedPaths); result.backupCapture = parseNativeBackupStatus(payload.backupCapture);
				if (result.backupCapture.id !== request.captureId || payload.complete !== (result.backupCapture.state === 'complete')) throw Error('Native backup capture identity or completion changed.');
				return result;
			}
			verifyScanExclusions(request, payload.excludedPaths);
			result.capture = parseNativeInventoryCapture(payload.capture);
			if (result.capture.coverage !== undefined) throw Error('Partial inventory requires the negotiated backup policy.');
			if (result.capture.id !== request.captureId) throw Error('Native capture identity changed.');
		} else if (request.action === 'scan-page') result.inventoryPage = parseNativeInventoryPage(payload.inventoryPage, request.capture, request.offset, request.pageSize);
		else if (payload.discarded !== true) throw Error('Native inventory cleanup was not confirmed.');
	} else if (request.action === 'inspect') {
		if (!validSyncPath(request.path) || payload.rootId !== request.rootId || payload.path !== request.path || payload.complete !== true ||
			(payload.entry !== null && (!validSyncEntry(payload.entry) || payload.entry.path !== request.path)))
			throw Error('Invalid native path observation.');
		result.inspectedEntry = payload.entry === null ? null : structuredClone(payload.entry);
	} else if (request.action === 'scan') {
		const exclusions = verifyScanExclusions(request, payload.excludedPaths), ignored = createSyncIgnorePolicy(request.ignoreRules);
		if (
			payload.rootId !== request.rootId ||
			payload.complete !== true ||
			!Array.isArray(payload.entries) ||
			payload.entries.length > 10_000 ||
			payload.entries.some((e: any) => !validSyncEntry(e) || isNativeScanExcluded(e.path, exclusions) || ignored.ignored(e.path, e.kind))
		)
			throw Error('Folder scan is incomplete. Keep the existing sync state.');
		const scope = { ...expected, dataPlane: 'home', rootId: request.rootId, deviceId: 'native-scan' };
		// Reuse the planner's bounds, path/identity collision and ancestry checks.
		planFileSync(
			{ scope, complete: true, entries: payload.entries },
			{ scope, complete: true, entries: [] },
			{ scope, entries: [] },
			{ mode: 'backup', propagateDeletes: false }
		);
		result.entries = structuredClone(payload.entries);
	} else if (request.action === 'read-range') {
		const c = payload.chunk;
		if (
			payload.rootId !== request.rootId ||
			payload.path !== request.path ||
			c?.version !== request.version ||
			c.offset !== request.offset ||
			!Number.isSafeInteger(c.size) ||
			c.size < request.offset ||
			!Number.isSafeInteger(request.length) ||
			request.length <= 0 ||
			request.length > 32 * 1024 * 1024 ||
			c.size - request.offset < request.length ||
			c.length !== request.length ||
			!(c.bytes instanceof Uint8Array) ||
			c.bytes.byteLength !== request.length
		)
			throw Error('Native file stream changed or returned incomplete bytes.');
		result.range = { version: c.version, size: c.size, offset: c.offset, bytes: new Uint8Array(c.bytes) };
	} else if (request.action === 'read') {
		const c = payload.chunk;
		if (
			payload.rootId !== request.rootId ||
			payload.path !== request.path ||
			c?.version !== request.version ||
			c.offset !== request.offset ||
			!Number.isSafeInteger(c.size) ||
			c.size < request.offset ||
			typeof c.data !== 'string' ||
			c.data.length > 87384 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(c.data) ||
			atob(c.data).length !== Math.min(request.length, c.size - request.offset)
		)
			throw Error('Native file changed or returned incomplete bytes.');
		result.chunk = { version: c.version, size: c.size, offset: c.offset, data: c.data };
	}
	return result;
}
export const supportsMobileSyncConditions = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsFolderAccess(bridge) && Number(bridge!.fileAccessVersion!.split('.')[1]) >= 1;
export const supportsMobileStaging = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsFolderAccess(bridge) && /^1\.\d+\.\d+$/.test(bridge?.fileStagingVersion ?? '');
export const supportsNativeCloudStaging = (bridge: FolderCapabilities | undefined) =>
	(bridge?.platform === 'ios' && supportsMobileStaging(bridge) && Number(bridge.fileStagingVersion!.split('.')[1]) >= 2) ||
	(bridge?.platform === 'macos' && supportsMobileStaging(bridge) && supportsNativeResourceLimits(bridge) && /^1\.\d+\.\d+$/.test(bridge.fileDownloadVersion ?? ''));
export const supportsMobilePublication = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsMobileStaging(bridge) && /^1\.\d+\.\d+$/.test(bridge?.filePublicationVersion ?? '');
/** Publication 1.2 can verify saved consent without displaying a native dialog. */
export const supportsNativeWriteApprovalCheck = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsMobilePublication(bridge) && /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(bridge!.filePublicationVersion!) &&
	Number(bridge!.filePublicationVersion!.split('.')[1]) >= 2;
export const supportsMobileTrash = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsMobilePublication(bridge) && /^1\.\d+\.\d+$/.test(bridge?.fileTrashVersion ?? '');
export const supportsMobileTrashTransitions = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsMobileTrash(bridge) && Number(bridge!.fileTrashVersion!.split('.')[1]) >= 1;
/** Publication 1.1 adds explicit per-folder capability. Earlier iOS 1.0
 * adapters support their selected roots; Android never falls back to that rule. */
export function supportsMobileFolderPublication(folder: MobileFolder | undefined, bridge: FolderCapabilities | undefined = getNativeBridge()) {
	if (!folder || folder.sourceKind === 'photos' || !supportsMobilePublication(bridge)) return false;
	if (Number(bridge!.filePublicationVersion!.split('.')[1]) >= 1) return /^1\.\d+\.\d+$/.test(folder.publicationVersion ?? '');
	return bridge!.platform === 'ios';
}
export const supportsMobileTrashRecovery = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsMobileTrash(bridge) && Number(bridge!.fileTrashVersion!.split('.')[1]) >= 2;

export const supportsNativeFileVersions = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsMobilePublication(bridge) && /^1\.\d+\.\d+$/.test(bridge?.fileVersionsVersion ?? '');

export function requestMobileFolders(
	ownerId: string,
	request: FolderRequest,
	signal: AbortSignal,
	onProgress?: (bytes: number, total: number) => void,
	onBackground?: (allowed: boolean) => void
): Promise<FolderResult> {
	const bridge = getNativeBridge();
	if (!supportsMobileFolders(bridge)) return Promise.reject(Error('Folder access requires an updated mobile app.'));
	try { assertNativeScanExclusions(request, bridge); } catch (error) { return Promise.reject(error); }
	if (['scan-capture', 'scan-page', 'scan-discard'].includes(request.action) && !supportsNativeInventoryPages(bridge))
		return Promise.reject(Error('Inventory pages require a supported Mac or iOS app.'));
	if (request.action === 'inspect' && (!supportsNativePathInspection(bridge) || !validSyncPath(request.path)))
		return Promise.reject(Error('Path inspection requires a supported app and a relative path.'));
	if (request.action === 'upload-file' && (!supportsNativeFileUploads(bridge) || !validFileUpload(request.upload)))
		return Promise.reject(Error('Native file upload requires a supported app and a canonical source.'));
	if (request.action === 'upload-part' && (!supportsNativePartUploads(bridge) || !validPartUpload(request.upload)))
		return Promise.reject(Error('Native upload requires a supported app and a canonical source part.'));
	if (request.action === 'stage-download' && !supportsNativeCloudStaging(bridge))
		return Promise.reject(Error('Update the iOS app to download cloud ranges natively.'));
	if (
		request.action === 'read-range' &&
		(bridge?.platform !== 'android' || Number(bridge.fileAccessVersion!.split('.')[1]) < 4 || typeof bridge.postFileFrame !== 'function')
	)
		return Promise.reject(Error('Update the Android app to stream uploads.'));
	if (
		request.action === 'read-range' &&
		(!Number.isSafeInteger(request.offset) ||
			request.offset < 0 ||
			!Number.isSafeInteger(request.length) ||
			request.length < 1 ||
			request.length > 32 * 1024 * 1024 ||
			!Number.isSafeInteger(request.offset + request.length))
	)
		return Promise.reject(Error('Invalid native upload range.'));
	if (
		request.action === 'stage-range' &&
		(bridge?.platform !== 'android' ||
			!supportsMobileStaging(bridge) ||
			Number(bridge.fileStagingVersion!.split('.')[1]) < 1 ||
			typeof bridge.postFileFrame !== 'function')
	)
		return Promise.reject(Error('Update the Android app to stream downloads.'));
	if (
		request.action === 'stage-range' &&
		(!(request.bytes instanceof Uint8Array) ||
			request.bytes.byteLength < 1 ||
			request.bytes.byteLength > 32 * 1024 * 1024 ||
			!Number.isSafeInteger(request.offset) ||
			request.offset < 0)
	)
		return Promise.reject(Error('Invalid native download range.'));
	if (request.action === 'prepare-upload' && (bridge?.platform !== 'android' || !supportsNativeBackgroundUploads(bridge)))
		return Promise.reject(Error('Update the Android app to prepare background uploads.'));
	if (request.action === 'conditions' && !supportsMobileSyncConditions(bridge))
		return Promise.reject(Error('Update the mobile app to run folder transfers.'));
	if (request.action.startsWith('stage-') && !supportsMobileStaging(bridge))
		return Promise.reject(Error('Update the mobile app to receive staged files.'));
	if (['write-approve', 'publication-lookup', 'publish'].includes(request.action) && !supportsMobilePublication(bridge))
		return Promise.reject(Error('Update the mobile app to download into selected folders.'));
	if (request.action === 'write-check' && !supportsNativeWriteApprovalCheck(bridge))
		return Promise.reject(Error('Update the app to check saved folder approval without a dialog.'));
	if (
		(request.action === 'trash' ||
			request.action.startsWith('trash-') ||
			((request.action === 'write-approve' || request.action === 'write-check') && request.approval.allowTrash === true)) &&
		!supportsMobileTrash(bridge)
	)
		return Promise.reject(Error('Update the app to use recoverable native trash.'));
	if (
		(request.action === 'trash-expected' || ('trash' in request && (request.trash.parent || request.trash.childrenOperationId))) &&
		!supportsMobileTrashTransitions(bridge)
	)
		return Promise.reject(Error('Update the app to safely remove folders after their children.'));
	if (['trash-list', 'trash-restore-reviewed'].includes(request.action) && !supportsMobileTrashRecovery(bridge))
		return Promise.reject(Error('Update the app to browse and restore retained files.'));
	if (request.action.startsWith('version-') && !supportsNativeFileVersions(bridge))
		return Promise.reject(Error('Update this app to restore retained file versions.'));
	const input = structuredClone(request),
		expected = { requestId: crypto.randomUUID(), ownerId, origin: window.location.origin };
	return new Promise((resolve, reject) => {
		let nextOffset = 0,
			uploadedBytes = 0;
		let background: boolean | undefined;
		const received = input.action === 'read-range' ? new Uint8Array(input.length) : null;
		const cleanup = () => {
			clearTimeout(timer);
			if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
			onBackground?.(false);
			window.removeEventListener(nativeBridgeMessageEvent, listener);
			signal.removeEventListener('abort', abort);
		};
		const stop = () => {
			try {
				bridge!.postMessage({ type: 'mobile-files', payload: { ...expected, action: 'suspend' } });
			} catch {
				/* The caller still stops waiting. */
			}
		};
		const abort = () => {
			cleanup();
			stop();
			reject(new DOMException('Folder request cancelled', 'AbortError'));
		};
		const listener = (event: Event) => {
			try {
				const message = (event as CustomEvent).detail;
				if (input.action === 'upload-file') {
					const started = supportsNativeBackgroundUploads(bridge) ? nativeFileUploadStarted(message, expected, input) : undefined;
					if (started !== undefined) {
						if (background === undefined) {
							background = started;
							onBackground?.(started);
							visibility();
						}
						return;
					}
					const next = nativeFileUploadProgress(message, expected, input, uploadedBytes);
					if (next !== null) {
						uploadedBytes = next;
						renewUploadDeadline();
						onProgress?.(next, input.upload.source.size);
						return;
					}
				}

				if (received) {
					const frame = receiveMobileReadFrame(message, expected.requestId, received, nextOffset);
					if (frame) {
						nextOffset = frame.nextOffset;
						bridge!.postFileFrame!(frame.acknowledgement);
						return;
					}
				}
				if (input.action === 'stage-range') {
					const pulled = mobileRangeFrame((event as CustomEvent).detail, expected, input.bytes, nextOffset);
					if (pulled) {
						nextOffset = pulled.nextOffset;
						bridge!.postFileFrame!(pulled.frame);
						return;
					}
				}
				const complete =
					received && message?.type === 'mobile-files-result' && Object.entries(expected).every(([key, value]) => message?.payload?.[key] === value);
				if (complete && !message.payload.error && nextOffset !== received.byteLength) throw Error('Native upload range is incomplete.');
				const result = parseMobileFolderResult(
					complete && !message.payload.error
						? { ...message, payload: { ...message.payload, chunk: { ...message.payload.chunk, bytes: received } } }
						: message,
					expected,
					input
				);
				if (result) {
					if (input.action === 'stage-range' && nextOffset !== input.bytes.byteLength) throw Error('Native download range is incomplete.');
					cleanup();
					resolve(result);
				}
			} catch (error) {
				cleanup();
				stop();
				reject(error);
			}
		};
		const expire = () => {
			cleanup();
			stop();
			reject(Error('Folder access timed out. Your saved selections are preserved.'));
		};
		const pacedPayload = syncRequestHasPacing(input.action, input.resourceLimits ?? (input.action === 'upload-batch' ? input.batch.descriptor.configuration.configuration.resourceLimits : undefined));
		let timer = pacedPayload ? undefined : setTimeout(
			expire,
			input.action === 'upload-part' || input.action === 'upload-file'
				? 900_000
				: [
						'choose',
						'prepare-upload',
						'scan',
						'scan-capture',
						'scan-page',
						'scan-discard',
						'inspect',
						'read-range',
						'stage-begin',
						'stage-range',
						'stage-download',
						'stage-finish',
						'write-approve',
						'publish',
						'publication-lookup',
						'trash',
						'trash-lookup',
						'trash-expected',
						'trash-inspect',
						'trash-restore-reviewed',
						'trash-list',
						'version-list',
						'version-inspect',
						'version-restore-reviewed',
						'version-restore-status',
						'trash-restore'
				  ].includes(input.action)
				? 300_000
				: 30_000
		);
		const renewUploadDeadline = () => {
			clearTimeout(timer);
			if (!pacedPayload && !(background === true && typeof document !== 'undefined' && document.visibilityState === 'hidden')) timer = setTimeout(expire, 900_000);
		};
		const visibility = () => {
			if (background === true) renewUploadDeadline();
		};
		if (input.action === 'upload-file' && typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
		window.addEventListener(nativeBridgeMessageEvent, listener);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
			return;
		}
		try {
			const payload =
				input.action === 'stage-range'
					? {
							...expected,
							action: input.action,
							rootId: input.rootId,
							transfer: input.transfer,
							offset: input.offset,
							length: input.bytes.byteLength
					  }
					: { ...expected, ...input };
			bridge!.postMessage({ type: 'mobile-files', payload });
		} catch (error) {
			cleanup();
			stop();
			reject(error);
		}
	});
}
/** Bounded native reads can feed the shared fingerprint/upload source contract.
 * Mac access 1.2 streams one bounded range across XPC, then returns binary bytes
 * through Electron; Android 1.4 sends acknowledged binary WebView frames.
 * Older hosts retain their bounded chunk path. Every chunk remains tied to the scanned source version. */
export function mobileFolderSource(
	ownerId: string,
	rootId: string,
	scanned: SyncEntry,
	signal: AbortSignal,
	request = requestMobileFolders,
	bridge: FolderCapabilities | undefined = getNativeBridge()
): FingerprintSource {
	const entry = structuredClone(scanned);
	if (!validSyncEntry(entry) || entry.kind !== 'file') throw Error('Select a scanned file.');
	const streaming =
		supportsFolderAccess(bridge) &&
		((bridge?.platform === 'macos' && Number(bridge.fileAccessVersion!.split('.')[1]) >= 2) ||
			(bridge?.platform === 'android' && Number(bridge.fileAccessVersion!.split('.')[1]) >= 4));
	const chunkProofs = bridge?.platform === 'android' && supportsFolderAccess(bridge) && Number(bridge!.fileAccessVersion!.split('.')[1]) >= 2;
	const verify = async (full = false) => {
		signal.throwIfAborted();
		const result = await request(
			ownerId,
			{
				action: 'read',
				rootId,
				path: entry.path,
				version: entry.version,
				offset: 0,
				length: 1,
				...(!full && chunkProofs ? { verifiedChunks: true as const } : {})
			},
			signal
		);
		if (result.chunk!.size !== entry.size) throw Error('Native source changed.');
	};
	return {
		...(entry.size > 0 && supportsNativeFileUploads(bridge)
			? {
					uploadFile: async (upload: NativeFileUpload, callerSignal?: AbortSignal, progress?: (bytes: number, total: number) => void) => {
						const active = callerSignal ? AbortSignal.any([signal, callerSignal]) : signal;
						active.throwIfAborted();
						const background = trackNativeUploadBackground(signal);
						try {
							const result = await request(
								ownerId,
								{ action: 'upload-file', rootId, upload: { ...upload, source: entry } },
								active,
								progress,
								background.set
							);
							active.throwIfAborted();
							if (!result.uploadedFile) throw Error('Native file upload receipt is missing.');
							return result.uploadedFile;
						} finally {
							background.dispose();
						}
					}
			  }
			: {}),
		...(entry.size > 0 && supportsNativePartUploads(bridge)
			? {
					...(supportsNativeAuthorizationContext(bridge) ? { nativePartSourceChecks: true as const } : {}),
					...(supportsNativePartPayloadBytes(bridge) ? { nativePartPayloadBytes: true as const } : {}),
					uploadPart: async (upload: NativePartUpload, callerSignal?: AbortSignal) => {
						const active = callerSignal ? AbortSignal.any([signal, callerSignal]) : signal;
						active.throwIfAborted();
						const result = await request(ownerId, { action: 'upload-part', rootId, upload: { ...upload, source: entry } }, active);
						active.throwIfAborted();
						if (!result.uploadedPart) throw Error('Native upload receipt is missing.');
						return {
							sha256: result.uploadedPart.sha256,
							...(supportsNativePartPayloadBytes(bridge) && result.uploadedPart.payloadBytes === upload.length
								? { payloadBytes: upload.length } : {})
						};
					}
			  }
			: {}),
		size: entry.size,
		check: () => verify(),
		verify: () => verify(true),
		read: async (offset, length, callerSignal) => {
			const readSignal = callerSignal ? AbortSignal.any([signal, callerSignal]) : signal;
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				!Number.isSafeInteger(length) ||
				length < 0 ||
				length > 32 * 1024 * 1024 ||
				offset + length > entry.size
			)
				throw Error('Invalid native read range.');
			readSignal.throwIfAborted();
			if (streaming && length > 0) {
				const response = await request(
					ownerId,
					{ action: 'read-range', rootId, path: entry.path, version: entry.version, offset, length },
					readSignal
				);
				readSignal.throwIfAborted();
				if (response.range?.size !== entry.size || response.range.bytes.byteLength !== length) throw Error('Native source changed.');
				return response.range.bytes;
			}
			const bytes = new Uint8Array(length);
			for (let at = 0; at < length; at += 65536) {
				readSignal.throwIfAborted();
				const response = await request(
					ownerId,
					{
						action: 'read',
						rootId,
						path: entry.path,
						version: entry.version,
						offset: offset + at,
						length: Math.min(65536, length - at),
						...(chunkProofs ? { verifiedChunks: true as const } : {})
					},
					readSignal
				);
				if (response.chunk!.size !== entry.size) throw Error('Native source changed.');
				const binary = atob(response.chunk!.data);
				bytes.set(
					Uint8Array.from(binary, (c) => c.charCodeAt(0)),
					at
				);
			}
			readSignal.throwIfAborted();
			return bytes;
		}
	};
}
