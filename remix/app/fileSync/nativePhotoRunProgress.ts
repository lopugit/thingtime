const stages = ['ready', 'preparing', 'uploading', 'waiting', 'complete', 'paused', 'needs-review'] as const;
const waits = ['wifi', 'network', 'offline', 'charging', 'data-budget'] as const;
const counters = ['photos', 'videos', 'other', 'wifiBytes', 'mobileBytes', 'unknownBytes'] as const;
export type NativePhotoRunProgress = {
	stage: (typeof stages)[number];
	syncWait?: (typeof waits)[number];
	retryAt?: string;
	minimumPartBytes?: number;
	pendingOriginals?: number;
	unavailableOriginals?: number;
	confirmed: Record<(typeof counters)[number], number>;
	currentFile?: { confirmedBytes: number; sentBytes: number; totalBytes: number };
	uploadBytesPerSecond?: number;
	continuation?: 'active' | 'held';
};
export type NativePhotoContinuation = { requested: boolean; status: 'active' | 'declined' | 'complete' | 'waiting' };
export type NativePhotoRunStatus = { configurationRevision: string | null; photoRunProgress: NativePhotoRunProgress | null };
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

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
	const progress = {
		stage, syncWait, retryAt, minimumPartBytes, pendingOriginals, unavailableOriginals, uploadBytesPerSecond, continuation,
		confirmed: Object.fromEntries(counters.map(key => [key, confirmed[key]])),
		...(file ? { currentFile: file } : {})
	} as NativePhotoRunProgress;
	return { configurationRevision, photoRunProgress: progress };
}
