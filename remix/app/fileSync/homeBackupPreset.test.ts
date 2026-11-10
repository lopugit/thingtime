import test from 'node:test';
import assert from 'node:assert/strict';
import { homeBackupDraft } from './homeBackupPreset';
import { canonicalDraftConfiguration, type ConfigurationDraft } from './configurationEditor';
import { newFileSyncConfiguration } from './configuration';

const draft = (): ConfigurationDraft => ({ version: 1, id: 'connection', baseUpdatedAt: null, pending: false,
	exclusions: 'Documents/private\nlibrary', configuration: { ...newFileSyncConfiguration({ name: 'My home', deviceId: 'device', localRootId: 'home', remoteFolderId: 'cloud' }), paused: false, propagateDeletes: true } });

test('home preset retains extra exclusions and roots, prevents deletion, and requires explicit start', () => {
	const before = draft(), result = homeBackupDraft(before), configuration = canonicalDraftConfiguration(result);
	assert.deepEqual(configuration.excludedPaths, ['Documents/private', 'library', 'Applications', '.Trash']);
	assert.equal(configuration.mode, 'backup'); assert.equal(configuration.propagateDeletes, false); assert.equal(configuration.paused, true);
	assert.equal(configuration.localRootId, 'home'); assert.equal(configuration.remoteFolderId, 'cloud');
	assert.equal(before.configuration.mode, 'two-way'); assert.equal(before.exclusions, 'Documents/private\nlibrary');
	assert.deepEqual(homeBackupDraft(result), result);
});
test('home preset cannot alter an uncertain save or a Photos source', () => {
	assert.throws(() => homeBackupDraft({ ...draft(), pending: true }), /pending save/);
	assert.throws(() => homeBackupDraft({ ...draft(), configuration: { ...draft().configuration, sourceKind: 'photos' } }), /home folder/);
});
