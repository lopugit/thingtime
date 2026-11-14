import test from 'node:test';
import assert from 'node:assert/strict';
import { listSourceIndexes, parseSourceIndexPage, readSourceIndex, sourceIndexId, type SourceIndexScope } from './sourceIndex';
import { StorageMutationError } from '../storage/storageCore';
const key = 'a'.repeat(64);
const entry = { path: key + '-0-original.jpg', name: 'original.jpg', resourceVersion: 'resource-v1', sourceVersion: 'v1', assetKey: key, resourceIndex: 0,
    capturedAt: '2026-11-01T00:00:00.000Z', modifiedAt: null, assetKind: 'photo', originalCount: 2, availability: 'pending', reason: null };
const page = () => ({ action: 'observe-photo-index', runId: 'run', epoch: 'epoch', passId: 'pass', sequence: 1,
    requestId: 'request', entries: [entry], progress: { inspectedAssets: 1, totalAssets: 10, indexedResources: 2, complete: false } });
test('source metadata explicitly preserves incomplete discovery and unavailable originals', () => {
    assert.equal(parseSourceIndexPage(page())?.progress.complete, false);
    assert.equal(parseSourceIndexPage({ ...page(), entries: [{ ...entry, sourceVersion: null, availability: 'legacy-unverified' }] })?.entries[0].availability, 'legacy-unverified');
    assert.equal(parseSourceIndexPage({ ...page(), entries: [{ ...entry, availability: 'unavailable', reason: 'photo-read' }] })?.entries[0].reason, 'photo-read');
    assert.equal(parseSourceIndexPage({ ...page(), entries: [], progress: { inspectedAssets: 0, totalAssets: 0, indexedResources: 0, complete: true } })?.progress.complete, true);
});
test('source observations cannot assert backup proof, substitute identity or seal a partial scan', () => {
    for (const invalid of [
        { ...page(), genericThing: {} }, { ...page(), sequence: 0 },
        { ...page(), entries: [entry, entry] }, { ...page(), entries: [{ ...entry, publication: { fileId: 'forged' } }] },
        { ...page(), entries: [{ ...entry, availability: 'backed-up' }] },
        { ...page(), entries: [{ ...entry, availability: 'legacy-unverified' }] },
        { ...page(), entries: [{ ...entry, path: key + '-1-other.jpg' }] },
        { ...page(), entries: [{ ...entry, path: '../escape' }] },
        { ...page(), entries: [{ ...entry, capturedAt: 'invalid' }] },
        { ...page(), entries: [{ ...entry, availability: 'unavailable', reason: null }] },
        { ...page(), progress: { ...page().progress, complete: true } }
    ]) assert.equal(parseSourceIndexPage(invalid), null);
});

const scope: SourceIndexScope = { origin: 'https://sync.test', ownerId: 'owner', configurationId: 'configuration',
    configurationRevision: 'revision', deviceId: 'device', localRootId: 'root', grantRevision: 'grant', folderId: 'folder' };
const encodeCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('source observation cursors reject null or malformed dates before querying observations', async () => {
    const indexId = sourceIndexId(scope, 'epoch');
    const header = { shareId: indexId, ownerId: scope.ownerId, thingtime: ['sync-source-index'], acl: ['tt:user'],
        crystal: { passId: 'pass', sequence: 2 } };
    let observationQueries = 0;
    const reachedPagination = new Error('validated observation pagination');
    const things = {
        findOne: async () => header,
        find: (query: any) => {
            observationQueries++;
            assert.equal(query.folderId, indexId);
            assert.equal(query['crystal.firstSequence'].$lte, 1);
            assert.equal(query.$or[0].createdAt.$lt.toISOString(), '2026-11-01T00:00:00.000Z');
            throw reachedPagination;
        }
    };
    const cursor = { indexId, passId: 'pass', sequence: 1, id: 'observation', createdAt: '2026-11-01T00:00:00.000Z' };
    for (const createdAt of [null, undefined, 'invalid', 0]) {
        await assert.rejects(readSourceIndex(things, undefined, scope, 'epoch', encodeCursor({ ...cursor, createdAt })),
            (error: unknown) => error instanceof StorageMutationError && error.status === 409 && error.code === 'storage_conflict');
        assert.equal(observationQueries, 0, 'Malformed dates must not query or advance observations');
    }
    await assert.rejects(readSourceIndex(things, undefined, scope, 'epoch', encodeCursor(cursor)),
        (error: unknown) => error === reachedPagination);
    assert.equal(observationQueries, 1);
});

test('source index catalog cursors reject null or malformed dates before querying indexes', async () => {
    let queries = 0;
    const things = { find: (query: any) => {
        queries++;
        assert.equal(query.ownerId, scope.ownerId);
        assert.equal(query.folderId, scope.configurationId);
        assert.equal(query['crystal.scope.origin'], scope.origin);
        assert.equal(query.$or[0].createdAt.$lt.toISOString(), '2026-11-01T00:00:00.000Z');
        return { sort: () => ({ limit: () => ({ toArray: async () => [] }) }) };
    } };
    const read = (createdAt: unknown) => listSourceIndexes(things, undefined, scope.ownerId, scope.origin,
        { action: 'list-source-indexes', configurationId: scope.configurationId,
            after: encodeCursor({ id: 'index', createdAt }) });
    for (const createdAt of [null, undefined, 'invalid', 0]) {
        await assert.rejects(read(createdAt),
            (error: unknown) => error instanceof StorageMutationError && error.status === 400 && error.code === 'storage_conflict');
        assert.equal(queries, 0, 'Malformed dates must not query or advance the catalog');
    }
    assert.deepEqual(await read('2026-11-01T00:00:00.000Z'), { indexes: [], after: null });
    assert.equal(queries, 1);
});
