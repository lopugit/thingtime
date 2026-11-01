/** Missing and invalid measurements stay distinct from a measured zero. */
export const elapsedTimestamp = (value: unknown): number | null => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string' || !value.trim()) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
};

export const elapsedClockActive = (start: unknown, end: unknown): boolean =>
	elapsedTimestamp(start) !== null && (end === null || end === undefined || end === '');

export function formatElapsedTime(start: unknown, end: unknown, now: unknown = Date.now()): string {
	const from = elapsedTimestamp(start);
	const to = elapsedTimestamp(end === null || end === undefined || end === '' ? now : end);
	if (from === null || to === null || to < from) return 'Not reported';
	const seconds = Math.floor((to - from) / 1000);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
