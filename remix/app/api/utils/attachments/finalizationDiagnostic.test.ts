import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizationDiagnostic, logFinalizationFailure, type AttachmentFinalizationStage } from './finalizationDiagnostic';

test('diagnostics never invoke throwable getters, stringify hooks, or prototype fields', () => {
    let reads = 0;
    const error = Object.create({ name: 'AccessDenied', code: 'InvalidPart' });
    const readSecret = () => { reads++; throw Error('private-getter-secret'); };
    for (const field of ['name', 'code', 'Code', '$metadata', '$fault', 'toJSON', 'toString']) {
        Object.defineProperty(error, field, { get: readSecret });
    }
    assert.deepEqual(finalizationDiagnostic('verify-object', error), {
        stage: 'verify-object', thrownKind: 'object', errorClass: 'Unknown'
    });
    assert.equal(reads, 0);
    const metadata = Object.defineProperty({}, 'httpStatusCode', { get() { reads++; throw Error('private-metadata'); } });
    assert.deepEqual(finalizationDiagnostic('persist-ready', { $metadata: metadata }), {
        stage: 'persist-ready', thrownKind: 'object', errorClass: 'Unknown'
    });
    assert.equal(reads, 0);
});

test('diagnostics tolerate revoked proxies and throwing proxy reflection', () => {
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const value of [revoked.proxy, new Proxy({}, {
        getPrototypeOf() { throw Error('private-prototype'); },
        getOwnPropertyDescriptor() { throw Error('private-descriptor'); }
    })]) {
        assert.deepEqual(finalizationDiagnostic('complete-multipart', value), {
            stage: 'complete-multipart', thrownKind: 'unknown', errorClass: 'Unknown'
        });
    }
});

test('diagnostics expose only closed scalar values and bounded SDK metadata', () => {
    const secret = '/private/user/path?token=do-not-log';
    for (const value of [secret, 123, null, undefined, true, [secret], () => secret,
        { name: secret, code: secret, Code: secret, message: secret, stack: secret, requestId: secret,
            $fault: secret, $metadata: { httpStatusCode: 600, attempts: 21, requestId: secret } },
        { $metadata: { httpStatusCode: '503', attempts: Number.POSITIVE_INFINITY } },
        { $metadata: { httpStatusCode: 99, attempts: -1 } }]) {
        const result = finalizationDiagnostic(secret as AttachmentFinalizationStage, value);
        assert.equal(result.stage, 'unknown');
        assert.doesNotMatch(JSON.stringify(result), /private|token|do-not-log|requestId|upstreamStatus|attempts|message|stack/);
    }
    assert.deepEqual(finalizationDiagnostic('store-empty', { name: 'AccessDenied', code: 'InvalidPart', $fault: 'client',
        $metadata: { httpStatusCode: 403, attempts: 3, requestId: secret } }), {
        stage: 'store-empty', thrownKind: 'object', errorClass: 'AccessDenied', errorCode: 'InvalidPart',
        upstreamStatus: 403, attempts: 3, fault: 'client'
    });
    assert.deepEqual(finalizationDiagnostic('renew-lease', Error(secret)), {
        stage: 'renew-lease', thrownKind: 'error', errorClass: 'Error'
    });
});

test('diagnostic logging cannot replace the original result when its sink throws', (t) => {
    t.mock.method(console, 'error', () => { throw Error('sink unavailable'); });
    assert.doesNotThrow(() => logFinalizationFailure('tag-ready', { name: 'Unknown' }));
});
