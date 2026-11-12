import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { deviceDashboardBlocks } from './deviceDashboardBlocks';
import { deviceThingsPageHref, deviceViewMode } from './deviceNavigation';
import { deviceResourceMetrics, readDeviceResources } from './deviceResourceMetrics';

test('the device dashboard keeps missing readings distinct from measured zero', () => {
	const unknown = deviceResourceMetrics(undefined);
	assert.equal(unknown.cpu.value, '—');
	assert.equal(unknown.ram.value, '—');
	assert.equal(unknown.disk.value, '—');
	assert.equal(unknown.network.value, '—');

	const input = readDeviceResources({
		cpuPercent: 0,
		memoryUsedBytes: 0,
		memoryTotalBytes: 1024,
		diskUsedBytes: 20,
		diskTotalBytes: 10,
		networkRxBytesPerSecond: 0,
		networkTxBytesPerSecond: 0,
		diskReadBytesPerSecond: 0,
		diskWriteBytesPerSecond: 1024,
		networkLinkBitsPerSecond: 0,
		interface: 'ignored'
	});
	assert(!('interface' in input!));
	const metrics = deviceResourceMetrics(input);
	assert.equal(metrics.cpu.value, '0');
	assert.equal(metrics.ram.value, '0');
	assert.equal(metrics.disk.value, '—');
	assert.equal(metrics.disk.read, 'Read 0 B/s');
	assert.equal(metrics.disk.write, 'Write 1 KiB/s');
	assert.equal(metrics.network.value, '0');
	assert.equal(metrics.network.detail, 'No traffic');
	assert.equal(metrics.network.hasTraffic, false);
});

test('the network arc shows the direction share of actual traffic without inventing a link capacity', () => {
	const metrics = deviceResourceMetrics(
		readDeviceResources({
			networkRxBytesPerSecond: 750_000,
			networkTxBytesPerSecond: 250_000
		})
	);
	assert.equal(metrics.network.fill, 75);
	assert.equal(metrics.network.value, '8');
	assert.equal(metrics.network.unit, 'Mbit/s');
	assert.equal(metrics.network.download, '↓ 6 Mbit/s');
	assert.equal(metrics.network.upload, '↑ 2 Mbit/s');
	const partial = deviceResourceMetrics(readDeviceResources({ networkRxBytesPerSecond: 750_000, networkTxBytesPerSecond: -1 }));
	assert.equal(partial.network.value, '—');
	assert.equal(partial.network.download, '↓ 6 Mbit/s');
	assert.equal(partial.network.hasTraffic, false);
});

test('the persisted layout retains independent gauge, number, and caption blocks', () => {
	const root = settingsDocumentBlocks(deviceDashboardBlocks)[0];
	const grid = root.children?.find((block) => block.id === 'device-dashboard-grid');
	assert.equal(grid?.children?.length, 4);
	const disk = grid.children?.find((block) => block.id === 'device-dashboard-disk');
	assert(disk?.children?.some((block) => block.id === 'device-dashboard-disk-detail'));
	const gauge = disk.children?.find((block) => block.id === 'device-dashboard-disk-gauge');
	const value = gauge?.children?.[0]?.children?.find((block) => block.id === 'device-dashboard-disk-value');
	assert.equal(value?.text, '{dashboard.disk.value}');
});

test('a device-only URL opens the dashboard and sync and quick views require explicit selectors', () => {
	const url = new URL(deviceThingsPageHref('device a&deviceView=sync'), 'https://example.test');
	assert.equal(url.searchParams.get('device'), 'device a&deviceView=sync');
	assert.equal(deviceViewMode(url.searchParams), 'page');
	assert.equal(deviceViewMode(new URLSearchParams('device=a')), 'page');
	assert.equal(deviceViewMode(new URLSearchParams('device=a&deviceView=quick')), 'quick');
	assert.equal(deviceViewMode(new URLSearchParams('device=a&deviceView=sync')), 'sync');
	assert.equal(deviceViewMode(new URLSearchParams('deviceFiles=a')), null);
});
