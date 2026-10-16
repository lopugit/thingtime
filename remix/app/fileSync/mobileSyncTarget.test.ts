import test from 'node:test';
import assert from 'node:assert/strict';
import { approveMobileSyncTarget } from './mobileSyncTarget.client';
import { parseMobileFolderResult, supportsMobilePublication, type FolderRequest, type FolderResult } from './mobileFolders.client';
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
