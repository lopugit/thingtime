/** Owner-only native inventory; no executable input, image, or process arguments. */
export type DeviceMenuBarItem = {
	id: string;
	label: string | null;
	processId: number;
	program: string;
	bundleId: string | null;
	appPath: string | null;
	executablePath: string | null;
	source: 'accessibility' | 'window';
	visible: boolean | null;
	x: number | null;
	y: number | null;
	width: number | null;
	height: number | null;
	residentBytes: number | null;
	cpuTimeSeconds: number | null;
};
export type DeviceMenuBar = {
	status: 'available' | 'partial' | 'locked' | 'collecting';
	collectedAt: string;
	accessibility: boolean;
	unreadableApplications: number;
	items: DeviceMenuBarItem[];
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((key) => allowed.includes(key));
const optionalText = (v: unknown) =>
	v == null || (typeof v === 'string' && Array.from(v).every((char) => char.charCodeAt(0) >= 32 || ['\t', '\n', '\r'].includes(char)));
const optionalNumber = (v: unknown, minimum = -Number.MAX_VALUE) => v == null || (typeof v === 'number' && Number.isFinite(v) && v >= minimum);
export function normalizeDeviceMenuBar(value: unknown): DeviceMenuBar | null {
	if (
		!record(value) ||
		!keys(value, ['status', 'collectedAt', 'accessibility', 'unreadableApplications', 'items']) ||
		typeof value.status !== 'string' ||
		!['available', 'partial', 'locked', 'collecting'].includes(value.status) ||
		typeof value.collectedAt !== 'string' ||
		!Number.isFinite(Date.parse(value.collectedAt)) ||
		typeof value.accessibility !== 'boolean' ||
		!Number.isSafeInteger(value.unreadableApplications) ||
		Number(value.unreadableApplications) < 0 ||
		!Array.isArray(value.items)
	)
		return null;
	const items: DeviceMenuBarItem[] = [],
		ids = new Set<string>();
	for (const row of value.items) {
		if (
			!record(row) ||
			!keys(row, [
				'id',
				'label',
				'processId',
				'program',
				'bundleId',
				'appPath',
				'executablePath',
				'source',
				'visible',
				'x',
				'y',
				'width',
				'height',
				'residentBytes',
				'cpuTimeSeconds'
			]) ||
			typeof row.id !== 'string' ||
			!row.id ||
			ids.has(row.id) ||
			typeof row.program !== 'string' ||
			!row.program ||
			!Number.isSafeInteger(row.processId) ||
			Number(row.processId) <= 0 ||
			Number(row.processId) > 2147483647 ||
			typeof row.source !== 'string' ||
			!['accessibility', 'window'].includes(row.source) ||
			(row.visible != null && typeof row.visible !== 'boolean') ||
			!['label', 'bundleId', 'appPath', 'executablePath'].every((key) => optionalText(row[key])) ||
			!['x', 'y'].every((key) => optionalNumber(row[key])) ||
			!['width', 'height', 'residentBytes', 'cpuTimeSeconds'].every((key) => optionalNumber(row[key], 0)) ||
			['appPath', 'executablePath'].some((key) => typeof row[key] === 'string' && !(row[key] as string).startsWith('/'))
		)
			return null;
		ids.add(row.id);
		items.push({
			id: row.id,
			program: row.program,
			processId: row.processId as number,
			source: row.source as DeviceMenuBarItem['source'],
			...Object.fromEntries(
				['label', 'bundleId', 'appPath', 'executablePath', 'visible', 'x', 'y', 'width', 'height', 'residentBytes', 'cpuTimeSeconds'].map((key) => [
					key,
					row[key] ?? null
				])
			)
		} as DeviceMenuBarItem);
	}
	if (value.status === 'locked' && items.length) return null;
	return {
		status: value.status as DeviceMenuBar['status'],
		collectedAt: value.collectedAt,
		accessibility: value.accessibility,
		unreadableApplications: value.unreadableApplications as number,
		items
	};
}
