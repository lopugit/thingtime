import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeviceDiagnostic, DEVICE_DIAGNOSTIC_REQUIREMENTS } from './deviceDiagnostics';
import { canView, canViewInherited, sanitizeShareId, viewerOf } from '../api/utils/things/things';
import { debugFolderId } from '../api/utils/devices/deviceDiagnosticIdentity';
import { ownerLibraryRootMatch } from '../api/utils/things/ownerLibraryQuery';
import { isProtectedThingtime, validateThingtimeCrystal } from '../schemas/registry';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
const at = '2026-11-12T00:00:00.000Z', now = Date.parse(at);
const event = { eventId: '1b1b4d22-e220-4cd6-b7d4-912084e2e408', occurredAt: at, category: 'sync', level: 'error', code: 'sync.failed', state: 'failed' };
test('safe diagnostic contract retains exact native failure facts without free-form text', () => {
    const value = { ...event, configurationId: 'configuration', runKey: 'a'.repeat(64), phase: 'uploading', reason: 'transfer-state', failureOperation: 'parts', retrySource: 'transferBackoff', retryAt: at,
        counts: { uploadedBytes: 8388608, pendingOriginals: 3 }, runtime: { platform: 'ios', appVersion: '1.0', build: '69', osVersion: '27.0' },
        background: { request: 'declined', outcome: 'launch-timeout', cause: 'checkpointed-wait', measuredUnits: 12, lastProgressAt: at, applicationState: 'background' },
        systemError: { domain: 'NSURLErrorDomain', code: -1009 } };
    assert.deepEqual(normalizeDeviceDiagnostic(value, now), value);
    for (const invalid of [
        { ...value, message: 'secret' }, { ...value, stack: 'stack' }, { ...value, deviceId: 'spoof' }, { ...value, ownerId: 'spoof' },
        { ...value, code: 'arbitrary-message' }, { ...value, runKey: 'raw-run-handle' }, { ...value, occurredAt: null },
        { ...value, occurredAt: '2026-11-12T00:02:00.000Z' }, { ...value, eventId: 'unsafe' }, { ...value, configurationId: '../path' },
        { ...value, counts: { uploadedBytes: -1 } }, { ...value, counts: { filename: 'photo.jpg' } },
        { ...value, runtime: { platform: 'ios', osVersion: 'https://private.invalid' } },
        { ...value, background: { outcome: 'raw-error-description' } }, { ...value, background: { request: 'active', description: 'secret' } },
        { ...value, systemError: { domain: 'custom-secret-domain', code: 1 } },
        { ...value, systemError: { domain: 'PHPhotosErrorDomain', code: 1, userInfo: {} } }
    ]) assert.equal(normalizeDeviceDiagnostic(invalid, now), null);
});
test('diagnostic Things/default-folder identities stay private and unavailable to generic creation', () => {
    assert.equal(isProtectedThingtime(['device-diagnostic']), true);
    assert.equal(validateThingtimeCrystal(['device-diagnostic'], {}).ok, false);
    for (const id of ['device-debug-owner', 'device-diagnostic-event']) assert.equal((sanitizeShareId(id) as any).ok, false);
    for (const doc of [{ thingtime: ['device-diagnostic'], shareId: 'event' },
        { thingtime: ['folder'], libraryHidden: true, shareId: debugFolderId('owner', 'https://sync.test'), crystal: { debugOrigin: 'https://sync.test' } }]) {
        const row = { ...doc, ownerId: 'owner', acl: ['tt:all'] } as any;
        assert.equal(canView(row, null), false);
        assert.equal(canView(row, { id: 'other' }), false);
        assert.equal(canView(row, { id: 'owner' }), true);
        assert.equal(canView({ ...row, appId: 'app' }, { id: 'owner' }), false);
        assert.equal(canView(row, viewerOf({ id: 'owner', username: 'owner' } as any, { jti: 'token', visibility: 'public' })), false);
    }
    assert.deepEqual(ownerLibraryRootMatch().libraryHidden, { $ne: true });
});
test('libraryHidden and diagnostic mixed kinds cannot bypass protected read gates', () => {
    for (const kind of ['password-manager-entry', 'password-verification-device', 'thing-storage-policy', 'thing-metadata', 'error-log', 'backup-job', 'device-command', 'timeline-event']) {
        const doc = { ownerId: 'owner', shareId: 'protected', acl: ['tt:all'], thingtime: [kind], libraryHidden: true } as any;
        assert.equal(canView(doc, { id: 'owner' }), false, kind);
        assert.equal(canView({ ...doc, thingtime: [kind, 'device-diagnostic'] }, { id: 'owner' }), false, kind + '+diagnostic');
    }
    assert.equal(canView({ ownerId: 'owner', shareId: 'mixed', acl: ['tt:user'], thingtime: ['data', 'device-diagnostic'] } as any, { id: 'owner' }), false);
});
test('diagnostic children never borrow a changed parent audience', async () => {
    const doc = { ownerId: 'owner', shareId: 'event', acl: ['tt:inherit'], targetId: 'public-parent', thingtime: ['device-diagnostic'] } as any;
    const lookup = async () => { throw new Error('Private diagnostic must not borrow a parent grant'); };
    assert.equal(await canViewInherited(doc, { id: 'other' }, lookup), false);
    assert.equal(await canViewInherited(doc, null, lookup), false);
    assert.equal(await canViewInherited(doc, { id: 'owner' }, lookup), true);
    assert.equal(await canViewInherited({ ...doc, thingtime: ['password-manager-entry', 'device-diagnostic'] }, { id: 'owner' }, lookup), false);
});
test('diagnostic capability requirements reject missing and breaking origins', () => {
    for (const minimum of Object.values(DEVICE_DIAGNOSTIC_REQUIREMENTS)) {
        assert.equal(capabilitySatisfies(undefined, minimum), false);
        assert.equal(capabilitySatisfies('2.0.0', minimum), false);
        assert.equal(capabilitySatisfies('1.1.0', minimum), true);
    }
});
