const stages = ['ready', 'preparing', 'uploading', 'waiting', 'complete', 'paused', 'needs-review'] as const;
const waits = ['wifi', 'network', 'offline', 'charging', 'data-budget'] as const;
const counters = ['photos', 'videos', 'other', 'wifiBytes', 'mobileBytes', 'unknownBytes'] as const;
const activityPhases = ['verifying', 'indexing', 'checking-originals', 'downloading', 'checking-cloud', 'uploading', 'publishing', 'waiting', 'complete'] as const;
const activityReasons = ['interrupted', 'library-changed', 'photo-access', 'device-storage', 'photo-read', 'cloud-request', 'saved-settings', 'destination-review', 'transfer-permission', 'transfer-expired', 'transfer-missing', 'transfer-state', 'grant-changed', 'queue-changed', 'retry'] as const;
const backgroundStatuses = ['active', 'declined', 'waiting', 'complete'] as const;
const backgroundEndCauses = ['system-ended', 'execution-expired', 'worker-cancelled', 'worker-failed', 'completed', 'checkpointed-wait'] as const;
export type NativePhotoActivityPhase = (typeof activityPhases)[number];
export type NativePhotoContinuation = { requested: boolean; status: (typeof backgroundStatuses)[number] };
export type NativePhotoUnavailableReasons = { 'cloud-download': number; 'photo-read': number };
type DiscoveredPhoto = { kind: 'photo' | 'video'; capturedAt?: string };
const failureOperations = ['manifest', 'check-photo-run', 'reserve-photo-original', 'parts', 'complete', 'publish', 'revoke', 'revoke-photo-run', 'local-grant', 'queue'] as const;
export type NativePhotoRunActivity = {
    backgroundEnd?: { cause: (typeof backgroundEndCauses)[number]; at: string; measuredUnits: number; lastProgressAt?: string };
	failureOperation?: (typeof failureOperations)[number];
	phase: NativePhotoActivityPhase;
	indexed?: { photos: number; videos: number; files: number };
	indexing?: { unit: 'assets' | 'files'; completed: number; total: number };
	latestFound?: DiscoveredPhoto;
	prepared?: { completed: number; total: number };
	backlogOriginals?: number;
	downloadFraction?: number;
	cloudPreparationFraction?: number;
	reason?: (typeof activityReasons)[number];
	events?: { phase: NativePhotoActivityPhase; at: string; discovered?: number; item?: DiscoveredPhoto }[];
	backgroundRequest?: NativePhotoContinuation['status'];
};
export type NativePhotoRunProgress = {
	stage: (typeof stages)[number];
	syncWait?: (typeof waits)[number];
	retryAt?: string;
	minimumPartBytes?: number;
	pendingOriginals?: number;
	unavailableOriginals?: number;
	unavailableReasons?: NativePhotoUnavailableReasons;
	confirmed: Record<(typeof counters)[number], number>;
	currentFile?: { confirmedBytes: number; sentBytes: number; totalBytes: number };
	uploadBytesPerSecond?: number;
	continuation?: 'active' | 'held';
	activity?: NativePhotoRunActivity;
};
export type NativePhotoRunStatus = { configurationRevision: string | null; photoRunProgress: NativePhotoRunProgress | null; wake?: NativePhotoRunWake };
const wakeReasons = ['inactive', 'identity', 'missing', 'authorization-required', 'paused', 'needs-review', 'source-changed', 'source-unavailable', 'conditions', 'backoff', 'budget'] as const;
export type NativePhotoRunWake = { status: 'running' | 'queued' | 'waiting' | 'refused'; reason?: (typeof wakeReasons)[number]; continuation?: NativePhotoContinuation['status'] };
export function parseNativePhotoRunWake(value: unknown): NativePhotoRunWake {
    if (!record(value) || !['running', 'queued', 'waiting', 'refused'].includes(String(value.status)) ||
        (value.reason !== undefined && !wakeReasons.some(reason => reason === value.reason)) ||
        (['waiting', 'refused'].includes(String(value.status)) && value.reason === undefined) ||
        (['running', 'queued'].includes(String(value.status)) && value.reason !== undefined) ||
        (value.continuation !== undefined && !backgroundStatuses.some(status => status === value.continuation)) ||
        (value.continuation === 'active' && value.status !== 'running'))
        throw Error('Native Photos did not confirm the foreground wake.');
    return { status: value.status as NativePhotoRunWake['status'], ...(value.reason ? { reason: value.reason as NativePhotoRunWake['reason'] } : {}),
        ...(value.continuation ? { continuation: value.continuation as NativePhotoRunWake['continuation'] } : {}) };
}
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const discoveredPhoto = (value: unknown): DiscoveredPhoto | undefined =>
	record(value) && (value.kind === 'photo' || value.kind === 'video') ?
		{ kind: value.kind, ...(date(value.capturedAt) ? { capturedAt: value.capturedAt } : {}) } : undefined;

/** Additive telemetry cannot invalidate an otherwise valid, scoped run. */
function parseActivity(value: unknown): NativePhotoRunActivity | undefined {
	if (!record(value)) return undefined;
	const { indexed, indexing, prepared, backlogOriginals, downloadFraction, events } = value;
	const phase = activityPhases.find(candidate => candidate === value.phase);
	if (!phase) return undefined;
	const activity: NativePhotoRunActivity = { phase };
	if (record(indexed) && whole(indexed.photos) && whole(indexed.videos) && whole(indexed.files))
		activity.indexed = { photos: indexed.photos, videos: indexed.videos, files: indexed.files };
	if (record(indexing) && (indexing.unit === 'assets' || indexing.unit === 'files') &&
		whole(indexing.completed) && whole(indexing.total) && indexing.completed <= indexing.total)
		activity.indexing = { unit: indexing.unit, completed: indexing.completed, total: indexing.total };
	const latestFound = discoveredPhoto(value.latestFound);
	if (latestFound) activity.latestFound = latestFound;
	if (record(prepared) && whole(prepared.completed) && whole(prepared.total) && prepared.completed <= prepared.total)
		activity.prepared = { completed: prepared.completed, total: prepared.total };
	if (whole(backlogOriginals)) activity.backlogOriginals = backlogOriginals;
	if (phase === 'downloading' && typeof downloadFraction === 'number' && downloadFraction >= 0 && downloadFraction <= 1)
		activity.downloadFraction = downloadFraction;
	const cloudFraction = value.cloudPreparationFraction;
	if (typeof cloudFraction === 'number' && Number.isFinite(cloudFraction) && cloudFraction >= 0 && cloudFraction <= 1)
		activity.cloudPreparationFraction = cloudFraction;
	const reason = activityReasons.find(candidate => candidate === value.reason);
	if (reason) activity.reason = reason;
	const operation = failureOperations.find(candidate => candidate === value.failureOperation);
	if (operation) activity.failureOperation = operation;
	const backgroundRequest = backgroundStatuses.find(candidate => candidate === value.backgroundRequest);
	if (backgroundRequest) activity.backgroundRequest = backgroundRequest;
    const end = value.backgroundEnd;
    if (record(end) && backgroundEndCauses.some(cause => cause === end.cause) && date(end.at) && whole(end.measuredUnits)) {
        activity.backgroundEnd = { cause: end.cause as (typeof backgroundEndCauses)[number], at: end.at, measuredUnits: end.measuredUnits,
            ...(date(end.lastProgressAt) ? { lastProgressAt: end.lastProgressAt } : {}) };
    }
	if (Array.isArray(events)) {
		// Native sends at most twelve events, already newest first.
		activity.events = events.slice(0, 12).flatMap(event => {
			if (!record(event) || !date(event.at)) return [];
			const eventPhase = activityPhases.find(candidate => candidate === event.phase);
			const item = eventPhase === 'indexing' ? discoveredPhoto(event.item) : undefined;
			return eventPhase ? [{ phase: eventPhase, at: new Date(event.at).toISOString(),
				...(item && whole(event.discovered) && event.discovered > 0 ? { item, discovered: event.discovered } : {}) }] : [];
		}).sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
	}
	return activity;
}

export function parseNativePhotoRunStatus(configurationRevision: unknown, photoRunProgress: unknown): NativePhotoRunStatus {
	if (photoRunProgress === null && (configurationRevision === null || configurationRevision === undefined))
		return { configurationRevision: null, photoRunProgress: null };
	if (!date(configurationRevision) || !record(photoRunProgress) ||
		(photoRunProgress.configurationRevision !== undefined && photoRunProgress.configurationRevision !== configurationRevision)) throw Error('Invalid native Photos run status.');
	const { stage, syncWait, retryAt, minimumPartBytes, pendingOriginals, unavailableOriginals, confirmed, currentFile, uploadBytesPerSecond, continuation } = photoRunProgress;
	if (!stages.some(value => value === stage) || (syncWait !== undefined && !waits.some(value => value === syncWait)) ||
		(retryAt !== undefined && !date(retryAt)) || (minimumPartBytes !== undefined && (!whole(minimumPartBytes) || minimumPartBytes === 0 || syncWait !== 'data-budget')) ||
		[pendingOriginals, unavailableOriginals].some(value => value !== undefined && !whole(value)) ||
		(continuation !== undefined && continuation !== 'active' && continuation !== 'held') ||
		!record(confirmed) || counters.some(key => !whole(confirmed[key])) ||
		(uploadBytesPerSecond !== undefined && (typeof uploadBytesPerSecond !== 'number' || !Number.isFinite(uploadBytesPerSecond) || uploadBytesPerSecond < 0)))
		throw Error('Invalid native Photos run progress.');
	let file: NativePhotoRunProgress['currentFile'];
	if (currentFile !== undefined) {
		if (!record(currentFile) || !whole(currentFile.confirmedBytes) || !whole(currentFile.sentBytes) ||
			!whole(currentFile.totalBytes) || currentFile.confirmedBytes > currentFile.totalBytes || currentFile.sentBytes > currentFile.totalBytes)
			throw Error('Invalid native Photos file progress.');
		file = { confirmedBytes: currentFile.confirmedBytes, sentBytes: currentFile.sentBytes, totalBytes: currentFile.totalBytes };
	}
	const activity = parseActivity(photoRunProgress.activity);
	const reasons = photoRunProgress.unavailableReasons;
	// Optional reason telemetry may lag an older client; never discard a valid run for it.
	const unavailableReasons = record(reasons) && whole(reasons['cloud-download']) && whole(reasons['photo-read']) &&
		Object.keys(reasons).every(key => key === 'cloud-download' || key === 'photo-read') &&
		whole(unavailableOriginals) && reasons['cloud-download'] + reasons['photo-read'] === unavailableOriginals
		? { 'cloud-download': reasons['cloud-download'], 'photo-read': reasons['photo-read'] } : undefined;
	const progress = {
		stage, syncWait, retryAt, minimumPartBytes, pendingOriginals, unavailableOriginals, uploadBytesPerSecond, continuation,
		confirmed: Object.fromEntries(counters.map(key => [key, confirmed[key]])),
		...(file ? { currentFile: file } : {}),
		...(activity ? { activity } : {}),
		...(unavailableReasons ? { unavailableReasons } : {})
	} as NativePhotoRunProgress;
	return { configurationRevision, photoRunProgress: progress };
}
