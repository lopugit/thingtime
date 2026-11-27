import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnrollmentDiagnostics, enrollmentDiagnosticsEnabled, classifyEnrollmentDeviceFailure } from './syncEnrollmentDiagnostics';
import { SyncJobConfigurationChanged } from './syncJobFailure';

test('debug snapshot distinguishes a live aborted wait from its real later release', () => {
 let time = 10;
 const diagnostics = createEnrollmentDiagnostics(() => time);
 const cancellation = new AbortController();
 const attempt = diagnostics.begin('private scoped key', cancellation.signal);
 attempt.phase('read-job');
 time = 50;
 cancellation.abort();
 assert.deepEqual(diagnostics.read('private scoped key'), [{ generation: 1, kind: 'background', phase: 'read-job', active: true, elapsedMs: 40, aborted: true }]);
 // Observation does not release or cancel anything. Only real settlement does.
 attempt.failed(new Error('secret error details must never be projected'));
 attempt.release();
 time = 200;
 assert.deepEqual(diagnostics.read('private scoped key'), [{ generation: 1, kind: 'background', phase: 'read-job', active: false, elapsedMs: 40, aborted: true, failure: 'aborted' }]);
});

test('snapshot isolates exact scopes and allowlists failure categories without raw data', () => {
 const diagnostics = createEnrollmentDiagnostics(() => 1);
 const prior = diagnostics.begin('owner/source/destination', undefined, 'config-one');
 prior.phase('enroll-local');
 prior.failed(new SyncJobConfigurationChanged());
 prior.release();
 diagnostics.begin('another owner');
 const result = diagnostics.read('owner/source/destination');
 assert.equal(result[0].failure, 'configuration-changed');
 assert.equal(result[0].active, false);
 assert.equal(diagnostics.read('missing').length, 0);
 assert.equal(diagnostics.read('owner/source/destination', 'config-one')[0].targetMatches, true);
 assert.equal(diagnostics.read('owner/source/destination', 'config-two')[0].targetMatches, false);
 assert.deepEqual(Object.keys(result[0]).sort(), ['aborted', 'active', 'elapsedMs', 'failure', 'generation', 'kind', 'phase']);
 assert.equal(JSON.stringify(result).includes('private'), false);
 assert.equal(enrollmentDiagnosticsEnabled, false, 'ordinary builds do not opt into the fixture hook');
});


test('host failure codes and facts stay closed even for unknown native error data', () => {
 assert.equal(classifyEnrollmentDeviceFailure(new Error('Another device request is still running. Try again shortly.')), 'native-busy');
 assert.equal(classifyEnrollmentDeviceFailure(new Error('Your account changed. Reopen Things and try again.')), 'native-identity');
 assert.equal(classifyEnrollmentDeviceFailure(new Error('private path/token')), 'native-refused');
 assert.equal(classifyEnrollmentDeviceFailure(new Error('__proto__')), 'native-refused');
 const diagnostics = createEnrollmentDiagnostics(() => 0), attempt = diagnostics.begin('private-key');
 attempt.phase('host-device-status', undefined, { code: 'native-busy', paired: false, deviceMatches: false, secret: 'private' } as any);
 const facts = diagnostics.read('private-key')[0].facts;
 assert.deepEqual(facts, { code: 'native-busy', paired: false, deviceMatches: false });
 assert.equal(JSON.stringify(diagnostics.read('private-key')).includes('private'), false);
 attempt.failed(new Error('This sync config has saved work. Wait for the device to finish its current transfer before enabling it again.'));
 assert.equal(diagnostics.read('private-key')[0].failure, 'saved-work-unfinished');
});
