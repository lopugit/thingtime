import assert from 'node:assert/strict';
import test from 'node:test';
import { retainSearchResults, searchResultQuery, searchResultSnapshotNotice } from './searchResultSnapshot';
const query = (changes: Partial<Parameters<typeof searchResultQuery>[0]> = {}) => searchResultQuery({ q: 'rainbow', mode: 'all', conditions: null, kind: '', sort: 'auto', ...changes });

test('failed text or filter searches keep the result-producing query and never present old results as the current query', () => {
 const initial = { query: query(), retained: false };
 const failed = retainSearchResults(initial)!;
 assert.equal(failed.query, initial.query);
 assert.match(searchResultSnapshotNotice(failed, query({ q: 'mountains' }), true)!, /previous search.*may not match the current search/);
 assert.match(searchResultSnapshotNotice(failed, query({ conditions: [{ field: 'price', op: 'gt', value: 10 }] }), true)!, /previous search/);
 assert.match(searchResultSnapshotNotice(failed, query({ kind: 'data' }), true)!, /previous search/);
 assert.match(searchResultSnapshotNotice(failed, query({ mode: 'any' }), true)!, /previous search/);
 assert.match(searchResultSnapshotNotice(failed, query({ sort: 'oldest' }), true)!, /previous search/);
 assert.equal(searchResultSnapshotNotice(initial, query(), true), null);
 assert.match(searchResultSnapshotNotice(failed, query(), true)!, /cached.*partial snapshot/);
});

test('cold cached snapshots are labeled even before refresh, but empty and fresh successful results are not stale', () => {
 const cached = { query: query(), retained: true };
 assert.match(searchResultSnapshotNotice(cached, query({ q: ' rainbow ' }), true)!, /cached search results/);
 assert.equal(searchResultSnapshotNotice(cached, query(), false), null);
 assert.equal(searchResultSnapshotNotice(null, query(), true), null);
 assert.equal(retainSearchResults(null), null);
 const completed = { query: query({ q: 'mountains' }), retained: false };
 assert.equal(searchResultSnapshotNotice(completed, query({ q: 'mountains' }), true), null);
 assert.equal(searchResultQuery({ q: '', mode: 'all', conditions: null, kind: '', sort: 'relevance' }).key, query({ q: '' }).key);
});
