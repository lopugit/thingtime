import type { DeviceResources } from './deviceTypes';

const finiteRange = (input: unknown, minimum: number, maximum: number) =>
	typeof input === 'number' && Number.isFinite(input) && input >= minimum && input <= maximum ? input : undefined;

/** Allow only numeric host observations into the view and account-scoped cache. */
export function readDeviceResources(input: unknown): DeviceResources | undefined {
	if (!input || typeof input !== 'object') return undefined;
	const source = input as Record<string, unknown>;
	const bytes = (key: keyof DeviceResources) => {
		const value = finiteRange(source[key], 0, Number.MAX_SAFE_INTEGER);
		return Number.isSafeInteger(value) ? value : undefined;
	};
	const rate = (key: keyof DeviceResources) => finiteRange(source[key], 0, Number.MAX_SAFE_INTEGER);
	const result: DeviceResources = {
		cpuPercent: finiteRange(source.cpuPercent, 0, 100),
		memoryUsedBytes: bytes('memoryUsedBytes'),
		memoryTotalBytes: bytes('memoryTotalBytes') || undefined,
		diskUsedBytes: bytes('diskUsedBytes'),
		diskTotalBytes: bytes('diskTotalBytes') || undefined,
		diskReadBytesPerSecond: rate('diskReadBytesPerSecond'),
		diskWriteBytesPerSecond: rate('diskWriteBytesPerSecond'),
		networkRxBytesPerSecond: rate('networkRxBytesPerSecond'),
		networkTxBytesPerSecond: rate('networkTxBytesPerSecond'),
		networkLinkBitsPerSecond: rate('networkLinkBitsPerSecond') || undefined
	};
	return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

const number = (value: number, maximumFractionDigits: number) => value.toLocaleString(undefined, { maximumFractionDigits });
const binaryBytes = (bytes: number) => {
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
	const index = Math.min(units.length - 1, Math.floor(Math.log2(Math.max(1, bytes)) / 10));
	return `${number(bytes / 1024 ** index, 1)} ${units[index]}`;
};
const networkRate = (bytes: number) => {
	const bits = bytes * 8;
	const units = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s', 'Pbit/s'];
	const index = Math.min(units.length - 1, Math.floor(Math.log10(Math.max(1, bits)) / 3));
	return { value: number(bits / 1000 ** index, 1), unit: units[index] };
};
const rateText = (bytes: number | undefined) => {
	if (bytes === undefined) return 'Unavailable';
	const { value, unit } = networkRate(bytes);
	return `${value} ${unit}`;
};
const ioRate = (bytes: number | undefined) => (bytes === undefined ? 'Unavailable' : `${binaryBytes(bytes)}/s`);
const noReport = 'Not reported';
const gauge = (ratio: number | undefined, detail: string) => ({
	fill: ratio ?? 0,
	value: ratio === undefined ? '—' : number(ratio, 0),
	unit: ratio === undefined ? '' : '%',
	detail
});
const usage = (used?: number, total?: number) => {
	const valid = used !== undefined && total !== undefined && total > 0 && used <= total;
	return gauge(valid ? (used / total) * 100 : undefined, valid ? `${binaryBytes(used)} of ${binaryBytes(total)}` : noReport);
};

export function deviceResourceMetrics(resources: DeviceResources | undefined) {
	const rx = resources?.networkRxBytesPerSecond;
	const tx = resources?.networkTxBytesPerSecond;
	const read = resources?.diskReadBytesPerSecond;
	const write = resources?.diskWriteBytesPerSecond;
	const total = rx === undefined || tx === undefined ? undefined : rx + tx;
	const throughput = total === undefined ? { value: '—', unit: '' } : networkRate(total);
	return {
		cpu: gauge(resources?.cpuPercent, resources?.cpuPercent === undefined ? noReport : 'Total CPU load'),
		ram: usage(resources?.memoryUsedBytes, resources?.memoryTotalBytes),
		disk: {
			...usage(resources?.diskUsedBytes, resources?.diskTotalBytes),
			read: `Read ${ioRate(read)}`,
			write: `Write ${ioRate(write)}`,
			hasRates: read !== undefined || write !== undefined
		},
		network: {
			...throughput,
			// The two colors encode shares of measured traffic. No link-speed
			// assumption turns traffic into a made-up utilization percentage.
			fill: rx !== undefined && total ? (rx / total) * 100 : 0,
			hasTraffic: total !== undefined && total > 0,
			detail: total === undefined ? noReport : total === 0 ? 'No traffic' : 'Download / upload split',
			download: `↓ ${rateText(rx)}`,
			upload: `↑ ${rateText(tx)}`,
			hasRates: rx !== undefined || tx !== undefined
		}
	};
}
