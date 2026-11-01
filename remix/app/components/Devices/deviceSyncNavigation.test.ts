import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceSyncFolders, deviceSyncedFilesHref } from './deviceSyncNavigation';
import { deviceSyncOverviewBlocks } from './deviceSyncBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { deviceSyncPageHref } from './deviceNavigation';
const row = (id: string, deviceId = 'device-a', remoteFolderId = 'folder-a', owner = 'owner') => ({
	id,
	updatedAt: '2026-10-22T00:00:00Z',
	author: { id: owner },
	thingtime: ['file-sync'],
	acl: ['tt:user'],
	crystal: {
		configurationVersion: 1,
		name: id,
		deviceId,
		localRootId: 'local-root',
		remoteFolderId,
		mode: 'backup',
		paused: true,
		propagateDeletes: false,
		network: 'wifi',
		chargingOnly: false,
		excludedPaths: []
	}
});
test('device folder navigation stays scoped to the private owner and exact device', () => {
	const shared = { ...row('shared'), acl: ['public'] };
	const roots = deviceSyncFolders(
		[row('home'), row('other-device', 'device-b'), row('other-owner', 'device-a', 'secret', 'other'), shared, null],
		'owner',
		'device-a'
	);
	assert.equal(roots.length, 1);
	assert.equal(roots[0].id, 'folder-a');
	assert.equal(roots[0].mode, 'Backup');
	assert.equal(roots[0].paused, true);
	assert.equal(roots[0].href, '/things?folder=folder-a&deviceFiles=device-a');
});
test('multiple connections to one cloud folder produce one folder entry, without fabricating completion', () => {
	const roots = deviceSyncFolders([row('first'), row('second'), row('third', 'device-a', 'folder-b')], 'owner', 'device-a');
	assert.deepEqual(
		roots.map((x) => x.id),
		['folder-a', 'folder-b']
	);
	assert.equal('complete' in roots[0], false);
});
test('device virtual-folder links encode the entire identifier', () => {
	const href = deviceSyncedFilesHref('device a&folder=foreign');
	const q = new URL(href, 'https://example.test').searchParams;
	assert.equal(q.get('deviceFiles'), 'device a&folder=foreign');
	assert.equal(q.has('folder'), false);
});

test('saved device overview retains separately editable nested fields under the settings validator', () => {
	const blocks = settingsDocumentBlocks(deviceSyncOverviewBlocks);
	const nodes: any[] = [];
	const visit = (items: any[]) =>
		items.forEach((item) => {
			nodes.push(item);
			visit(item.children ?? []);
		});
	visit(blocks);
	for (const id of [
		'device-sync-heading',
		'device-sync-all-things',
		'device-sync-folder-name',
		'device-sync-folder-direction',
		'device-sync-folder-state'
	])
		assert.ok(
			nodes.some((node) => node.id === id),
			id
		);
	assert.ok(nodes.some((node) => node.type === 'collection' && node.props.itemsPath === 'deviceSync.folders'));
});

test('dedicated sync route preserves device identity and activity navigation', () => {
  const url = new URL(deviceSyncPageHref('device a&folder=foreign'), 'https://example.test');
  assert.equal(url.searchParams.get('device'), 'device a&folder=foreign');
  assert.equal(url.searchParams.get('deviceView'), 'sync');
  assert.equal(url.searchParams.has('folder'), false);
  assert.ok(JSON.stringify(deviceSyncOverviewBlocks).includes('/things?activity=1'));
});
