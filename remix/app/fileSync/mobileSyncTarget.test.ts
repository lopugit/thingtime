import test from 'node:test';
import assert from 'node:assert/strict';
import { approveMobileSyncTarget } from './mobileSyncTarget.client';
import { parseMobileFolderResult, supportsMobilePublication, supportsMobileFolderPublication, supportsNativeWriteApprovalCheck, type FolderRequest, type FolderResult } from './mobileFolders.client';
import { newFileSyncConfiguration } from './configuration';
import type { SyncOperation } from './execute';
const bridge = {
	isNativeWebView: true,
	platform: 'android',
	fileAccessVersion: '1.3.0',
	fileStagingVersion: '1.0.0',
	filePublicationVersion: '1.1.0'
} as any;
const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'device' };
const rootId = '031bbbc2-365a-41c7-8f52-144c9ca053b0';
const saved = {
	id: scope.rootId,
	updatedAt: '2026-10-17T00:00:00Z',
	configuration: {
		...newFileSyncConfiguration({ name: 'Download', deviceId: scope.deviceId, localRootId: rootId, remoteFolderId: 'cloud' }),
		mode: 'download' as const,
		paused: false
	}
};
const operation = {
	id: '135326c5-70cf-42aa-9769-653b7067db8b',
	confirmed: false,
	mutation: {
		kind: 'copy',
		from: 'remote',
		path: 'folder',
		expectedTarget: null,
		source: { path: 'folder', id: 'remote-folder', version: 'r1', kind: 'folder', size: 0, sha256: null }
	}
} satisfies SyncOperation;
const expected = { requestId: 'request', ownerId: scope.ownerId, origin: scope.origin };
const stage = { scope, operationId: operation.id, token: 'stage', entry: { ...operation.mutation.source, id: 'native', version: 'v1' } };
function parse(request: FolderRequest, payload: any) {
	return parseMobileFolderResult(
		{
			type: 'mobile-files-result',
			payload: { ...expected, rootId, roots: [{ id: rootId, name: 'Selected', publicationVersion: '1.0.0' }], ...payload }
		},
		expected,
		request
	)!;
}
test('native download target binds consent to configuration, stages and uses the original immutable operation for receipt recovery', async () => {
	const calls: FolderRequest[] = [];
	const request = async (_owner: string, input: FolderRequest): Promise<FolderResult> => {
		calls.push(input);
		if (input.action === 'list') return parse(input, {});
		if (input.action === 'write-approve') return parse(input, { writeApproval: input.approval });
		if (input.action === 'publication-lookup') return parse(input, { publication: { status: 'missing' } });
		if (input.action === 'publish')
			return parse(input, { publication: { status: 'complete', receipt: { scope, operationId: operation.id, entry: stage.entry } } });
		return parse(input, { staging: { received: 0, stage } });
	};
	const target = await approveMobileSyncTarget(saved, scope, new AbortController().signal, request, bridge);
	assert.equal((await target.lookup({ ...operation, confirmed: true }, scope)).status, 'missing');
	assert.deepEqual(await target.stage(operation, scope), stage);
	assert.equal((await target.publish(operation, scope, stage)).entry?.id, 'native');
	const approval = calls[1];
	assert.equal(approval.action, 'write-approve');
	if (approval.action !== 'write-approve') throw Error('consent missing');
	assert.equal(approval.approval.configurationRevision, saved.updatedAt);
	assert.match(approval.approval.configurationHash, /^[a-f0-9]{64}$/);
	const lookup = calls[2];
	assert.equal(lookup.action, 'publication-lookup');
	if (lookup.action === 'publication-lookup') assert.equal(lookup.transfer.operation.confirmed, false);
	await assert.rejects(target.lookup(operation, { ...scope, ownerId: 'other' }), /scope changed/);
	await approveMobileSyncTarget(
		{ ...saved, configuration: { ...saved.configuration, excludedPaths: ['private'] } },
		scope,
		new AbortController().signal,
		request,
		bridge
	);
	const changed = calls.at(-1);
	if (changed?.action === 'write-approve') assert.notEqual(changed.approval.configurationHash, approval.approval.configurationHash);
});
test('publication negotiation and reply parsing reject missing consent, foreign identities, malformed receipts and pending publication', async () => {
	const bridge = { isNativeWebView: true, platform: 'ios', fileAccessVersion: '1.1.1', fileStagingVersion: '1.0.0' } as any;
	assert.equal(supportsMobilePublication(bridge), false);
	bridge.filePublicationVersion = '1.0.0';
	assert.equal(supportsMobilePublication(bridge), true);
	bridge.filePublicationVersion = '2.0.0';
	assert.equal(supportsMobilePublication(bridge), false);
	const request: FolderRequest = {
		action: 'publish',
		rootId,
		transfer: { scope, rootId, operation },
		stage,
		approval: { scope, configurationRevision: saved.updatedAt, configurationHash: 'a'.repeat(64) }
	};
	for (const publication of [
		{ status: 'pending' },
		{ status: 'complete', receipt: { scope: { ...scope, ownerId: 'other' }, operationId: operation.id, entry: stage.entry } },
		{ status: 'complete', receipt: { scope, operationId: operation.id, entry: { ...stage.entry, path: 'other' } } }
	])
		assert.throws(() => parse(request, { publication }));
	bridge.filePublicationVersion = '1.0.0';
	await assert.rejects(
		approveMobileSyncTarget(
			saved,
			scope,
			new AbortController().signal,
			async (_owner, input) => (input.action === 'list' ? parse(input, {}) : { roots: [] }),
			bridge
		),
		/approval is unavailable/
	);
});

test('fresh folder capability is required before native consent or staging', async () => {
	for (const roots of [[], [{ id: rootId, name: 'External' }], [{ id: rootId, name: 'Breaking', publicationVersion: '2.0.0' }]]) {
		const calls: FolderRequest[] = [];
		await assert.rejects(
			approveMobileSyncTarget(
				saved,
				scope,
				new AbortController().signal,
				async (_owner, input) => {
					calls.push(input);
					return { roots };
				},
				bridge
			),
			/Downloads are unavailable/
		);
		assert.deepEqual(calls, [{ action: 'list' }]);
	}
});

test('native trash negotiates distinct consent, recovers immutable receipts and rejects consent downgrade', async () => {
	const configured = { ...saved, configuration: { ...saved.configuration, propagateDeletes: true } };
	const capable = { ...bridge, fileTrashVersion: '1.0.0' };
	const trash: SyncOperation = {
		...operation,
		mutation: {
			kind: 'trash',
			side: 'local',
			path: 'file',
			expected: { path: 'file', id: 'inode', version: '1', kind: 'file', size: 3, sha256: 'a'.repeat(64) }
		}
	};
	const calls: FolderRequest[] = [];
	const request = async (_owner: string, input: FolderRequest): Promise<FolderResult> => {
		calls.push(input);
		if (input.action === 'write-approve') return parse(input, { writeApproval: input.approval });
		if (input.action === 'trash-lookup') return parse(input, { trash: { status: 'missing' } });
		if (input.action === 'trash') return parse(input, { trash: { status: 'complete', receipt: { scope, operationId: trash.id, entry: null } } });
		return parse(input, {});
	};
	await assert.rejects(approveMobileSyncTarget(configured, scope, new AbortController().signal, request, bridge), /trash is unavailable/);
	assert.deepEqual(calls, [{ action: 'list' }]);
	calls.length = 0;
	const target = await approveMobileSyncTarget(configured, scope, new AbortController().signal, request, capable);
	assert.equal(calls[1].action, 'write-approve');
	if (calls[1].action !== 'write-approve') throw Error('missing consent');
	const consent = calls[1];
	assert.equal(consent.approval.allowTrash, true);
	for (const allowTrash of [undefined, false, 'true']) assert.throws(() => parse(consent, { writeApproval: { ...consent.approval, allowTrash } }));
	assert.equal((await target.lookup({ ...trash, confirmed: true }, scope)).status, 'missing');
	const lookup = calls.at(-1);
	assert.equal(lookup?.action, 'trash-lookup');
	if (lookup?.action === 'trash-lookup') assert.equal(lookup.trash.operation.confirmed, false);
	assert.equal((await target.trash!(trash, scope)).entry, null);
	const ordinary = await approveMobileSyncTarget(saved, scope, new AbortController().signal, request, capable);
	assert.equal(ordinary.trash, undefined);
});

test('native trash replies require null receipts and restore the reviewed inode without changing content', () => {
	const entry = { path: 'file', id: 'inode', version: '1', kind: 'file' as const, size: 3, sha256: 'a'.repeat(64) };
	const trash = {
		scope,
		rootId,
		operation: { ...operation, mutation: { kind: 'trash' as const, side: 'local' as const, path: entry.path, expected: entry } }
	};
	const request: FolderRequest = { action: 'trash-lookup', rootId, trash };
	for (const receipt of [
		undefined,
		{ scope, operationId: operation.id },
		{ scope, operationId: 'other', entry: null },
		{ scope: { ...scope, ownerId: 'foreign' }, operationId: operation.id, entry: null },
		{ scope, operationId: operation.id, entry }
	])
		assert.throws(() => parse(request, { trash: { status: 'complete', receipt } }));
	assert.equal(parse({ ...request, action: 'trash-inspect' }, { retainedEntry: entry }).retainedEntry?.id, entry.id);
	const restore: FolderRequest = {
		...request,
		action: 'trash-restore',
		restore: { path: 'recovered', expected: entry },
		approval: { scope, configurationRevision: '1', configurationHash: 'a'.repeat(64) }
	};
	const restored = { ...entry, path: 'recovered', version: '2' };
	assert.deepEqual(parse(restore, { restoredEntry: restored }).restoredEntry, restored);
	for (const patch of [{ path: 'other' }, { id: 'other' }, { sha256: 'b'.repeat(64) }, { size: 4 }])
		assert.throws(() => parse(restore, { restoredEntry: { ...restored, ...patch } }));
});


for (const platform of ['macos', 'ios'] as const) test(`${platform}: resuming with existing consent requires negotiated non-interactive checks and never falls back to a prompt`, async () => {
 const capable = { ...bridge, platform, filePublicationVersion: '1.2.0' };
 for (const version of [undefined, '1.1.99', '2.0.0', '1.02.0', '1.2.bad']) {
  const legacy = { ...capable, filePublicationVersion: version };
  assert.equal(supportsNativeWriteApprovalCheck(legacy), false);
  let calls = 0;
  await assert.rejects(approveMobileSyncTarget(saved, scope, new AbortController().signal,
   async () => { calls++; throw Error('must not dispatch'); }, legacy, 'existing'), /without a dialog/);
  assert.equal(calls, 0);
 }
 for (const version of ['1.2.0', '1.2.1', '1.3.0'])
  assert.equal(supportsNativeWriteApprovalCheck({ ...capable, filePublicationVersion: version }), true);
 const calls: FolderRequest[] = [];
 const request = async (_owner: string, input: FolderRequest): Promise<FolderResult> => {
  calls.push(input);
  if (input.action === 'write-check') throw Error('Native approval was removed');
  return parse(input, {});
 };
 await assert.rejects(approveMobileSyncTarget(saved, scope, new AbortController().signal, request, capable, 'existing'), /approval was removed/);
 assert.deepEqual(calls.map(c => c.action), ['list', 'write-check']);
});

for (const platform of ['macos', 'ios'] as const) test(`${platform}: saved consent is checked before new staging, publication or Trash effects while receipt recovery stays read-only`, async () => {
 const capable = { ...bridge, platform, filePublicationVersion: '1.2.0', fileTrashVersion: '1.2.1' };
 const configured = { ...saved, configuration: { ...saved.configuration, propagateDeletes: true } };
 const calls: FolderRequest[] = [];
 let approved = true;
 const request = async (_owner: string, input: FolderRequest): Promise<FolderResult> => {
  calls.push(input);
  if (input.action === 'write-check') {
   if (!approved) throw Error('Native approval was removed');
   return parse(input, { writeApproval: input.approval });
  }
  if (input.action === 'publication-lookup') return parse(input, { publication: { status: 'missing' } });
  if (input.action === 'publish') return parse(input, { publication: { status: 'complete', receipt: { scope, operationId: operation.id, entry: stage.entry } } });
  if (input.action.startsWith('stage-')) return parse(input, { staging: { received: 0, stage } });
  return parse(input, {});
 };
 const target = await approveMobileSyncTarget(configured, scope, new AbortController().signal, request, capable, 'existing');
 assert.deepEqual(await target.stage(operation, scope), stage);
 assert.equal((await target.publish(operation, scope, stage)).entry?.id, 'native');
 assert.ok(!calls.some(c => c.action === 'write-approve'));
 for (const effect of ['stage-begin', 'publish']) {
  const index = calls.findIndex(c => c.action === effect);
  assert.ok(index > 0); assert.equal(calls[index - 1].action, 'write-check');
 }
 approved = false; calls.length = 0;
 await assert.rejects(target.stage(operation, scope), /approval was removed/);
 await assert.rejects(target.publish(operation, scope, stage), /approval was removed/);
 const trash: SyncOperation = { ...operation, mutation: { kind: 'trash', side: 'local', path: 'folder', expected: stage.entry } };
 await assert.rejects(target.trash!(trash, scope), /approval was removed/);
 assert.deepEqual(calls.map(c => c.action), ['write-check', 'write-check', 'write-check']);
 assert.equal((await target.lookup(operation, scope)).status, 'missing');
 assert.equal(calls.at(-1)?.action, 'publication-lookup');
 const before = calls.length;
 await assert.rejects(target.stage(operation, { ...scope, ownerId: 'foreign' }), /scope changed/);
 assert.equal(calls.length, before);
});

test('non-interactive approval replies are bound to the exact settings, Trash consent and scope', () => {
 const approval = { scope, configurationRevision: saved.updatedAt, configurationHash: 'a'.repeat(64), allowTrash: true as const };
 const request: FolderRequest = { action: 'write-check', rootId, approval };
 assert.deepEqual(parse(request, { writeApproval: approval }).writeApproval, approval);
 for (const patch of [
  { scope: { ...scope, deviceId: 'other' } }, { scope: { ...scope, origin: 'https://other.test' } },
  { configurationRevision: 'changed' }, { configurationHash: 'b'.repeat(64) }, { allowTrash: undefined }
 ]) assert.throws(() => parse(request, { writeApproval: { ...approval, ...patch } }), /approval changed/);
 for (const writeApproval of [null, undefined, false]) assert.throws(() => parse(request, { writeApproval }));
});

test('iOS publication 1.2 negotiates each folder while photo sources remain read-only', () => {
 const capable = { ...bridge, platform: 'ios', filePublicationVersion: '1.2.0' };
 const folder = { id: rootId, name: 'Selected', publicationVersion: '1.2.0' };
 assert.equal(supportsMobileFolderPublication(folder, capable), true);
 assert.equal(supportsMobileFolderPublication({ ...folder, publicationVersion: undefined }, capable), false);
 assert.equal(supportsMobileFolderPublication({ ...folder, sourceKind: 'photos' }, capable), false);
 // Previously installed iOS builds retain their existing explicit foreground flow.
 const legacy = { ...capable, filePublicationVersion: '1.0.1' };
 assert.equal(supportsNativeWriteApprovalCheck(legacy), false);
 assert.equal(supportsMobileFolderPublication({ ...folder, publicationVersion: undefined }, legacy), true);
});

test('ignore policy changes approval hash while empty rules preserve legacy approval and unsupported native fails closed', async () => {
 const capable = { ...bridge, platform: 'macos' as const, fileAccessVersion: '1.9.0', filePublicationVersion: '1.2.0' }, hashes: string[] = [];
 const request = async (_owner: string, input: FolderRequest): Promise<FolderResult> => {
  if (input.action === 'list') return parse(input, {});
  assert.equal(input.action, 'write-approve'); if (input.action !== 'write-approve') throw Error('unexpected');
  hashes.push(input.approval.configurationHash); return parse(input, { writeApproval: input.approval });
 };
 await approveMobileSyncTarget(saved, scope, new AbortController().signal, request, capable);
 await approveMobileSyncTarget({ ...saved, configuration: { ...saved.configuration, configurationVersion: 2, ignoreRules: '' } }, scope, new AbortController().signal, request, capable);
 await approveMobileSyncTarget({ ...saved, configuration: { ...saved.configuration, configurationVersion: 2, ignoreRules: 'node_modules/' } }, scope, new AbortController().signal, request, capable);
 assert.equal(hashes[0], hashes[1]); assert.notEqual(hashes[0], hashes[2]);
 await assert.rejects(approveMobileSyncTarget({ ...saved, configuration: { ...saved.configuration, configurationVersion: 2, ignoreRules: 'node_modules/' } }, scope, new AbortController().signal, request,
  { ...capable, fileAccessVersion: '1.8.0' }), /Gitignore/);
});
