import assert from 'node:assert/strict';
import test from 'node:test';
import { loadVersionGraph, parseVersionRequest, versionMergeBase } from './versions.ts';
import type { TimelineGraphNode } from './repository.ts';

const node = (id: string, parentIds: string[] = []): TimelineGraphNode => ({ id, parentIds, thingId: 'thing-1', afterAdapter: 'thing-content' });
test('merge bases use the shared DAG, including two-parent versions and partial client caches', async () => {
 const nodes = [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c']), node('e', ['c'])];
 const graph = await loadVersionGraph(['d', 'e'], 'thing-1', async ids => nodes.filter(item => ids.includes(item.id)));
 assert.equal(versionMergeBase(graph, 'd', 'e').id, 'c');
 assert.equal(versionMergeBase(graph, 'b', 'd').id, 'b');
});
test('missing, foreign and ambiguous ancestors cannot be silently merged', async () => {
 await assert.rejects(loadVersionGraph(['a'], 'thing-1', async () => []), /unavailable/);
 await assert.rejects(loadVersionGraph(['a'], 'thing-1', async () => [{ ...node('a'), thingId: 'other' }]), /unavailable/);
 const nodes = [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c']), node('e', ['c', 'b']), node('unrelated')];
 const graph = new Map(nodes.map(item => [item.id, item]));
 assert.throws(() => versionMergeBase(graph, 'd', 'e'), /multiple merge bases/);
 assert.throws(() => versionMergeBase(graph, 'a', 'unrelated'), /no shared ancestor/);
});
test('version commands are strict, bounded, and require a replay identity plus preview head', () => {
 const request = { command: 'apply-version', mode: 'restore', eventId: 'source', expectedHeadId: 'current', operationId: '177abf25-b322-4ac0-9707-a59c36e7bcd5' };
 assert.deepEqual(parseVersionRequest(request), request);
 assert.throws(() => parseVersionRequest({ ...request, ownerId: 'other' }), /Invalid/);
 assert.throws(() => parseVersionRequest({ ...request, expectedHeadId: null }), /preview head/);
 assert.throws(() => parseVersionRequest({ ...request, operationId: 'random' }), /UUID/);
 assert.throws(() => parseVersionRequest({ ...request, choices: { field: 'delete' } }), /choices/);
});
