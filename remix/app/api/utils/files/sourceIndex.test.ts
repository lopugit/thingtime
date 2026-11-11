import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceIndexPage } from './sourceIndex';
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
