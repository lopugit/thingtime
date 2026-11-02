import assert from 'node:assert/strict';
import test from 'node:test';
import { MONGO_CONNECTION_INVENTORY_BLOCKS } from './mongoConnectionInventoryBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { safeDeploymentUrl, presentMongoSources, mergeMongoInventory } from './mongoConnectionInventoryPresentation';
import type { MongoConnectionSource, MongoConnectionInventory } from '~/mongodb/connectionInventory';
const flatten = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
test('inventory fields remain independently editable in saved repeated templates', () => {
 const blocks = settingsDocumentBlocks(MONGO_CONNECTION_INVENTORY_BLOCKS); const all = flatten(blocks);
 assert.equal(new Set(all.map(block => block.id)).size, all.length);
 for (const id of ['source-title', 'source-reason', 'source-counts', 'source-observed', 'source-url', 'creator-label', 'creator-value', 'pool-host', 'pool-counts', 'pool-lifecycle', 'refresh', 'search', 'freshness', 'load-more']) assert.ok(all.some(block => block.id === `mongo-${id}`), id);
 assert.ok(all.every(block => !block.source && !block.native && !block.component));
 const reason = all.find(block => block.id === 'mongo-source-reason')!; reason.css = { color: '#663399' };
 const saved = flatten(settingsDocumentBlocks(JSON.parse(JSON.stringify(blocks))));
 assert.equal(saved.find(block => block.id === reason.id)?.css?.color, '#663399');
 assert.equal(saved.find(block => block.id === 'mongo-source-counts')?.text, '{item.counts}');
});
test('deployment links reject executable URLs and credentials', () => {
 for (const value of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com', 'http://example.com', 'https://example.com/?token=private', 'https://example.com/path', 'http://127.0.0.1:1234/#private', null]) assert.equal(safeDeploymentUrl(value), '');
 assert.equal(safeDeploymentUrl('https://branch.example.com'), 'https://branch.example.com/');
 assert.equal(safeDeploymentUrl('http://127.0.0.1:1234'), 'http://127.0.0.1:1234/');
});
test('filters preserve snapshot freshness distinctions and explain missing fields', () => {
 const source: MongoConnectionSource = { id: 'source', runtimeId: 'runtime', appName: 'Thingtime preview', reason: 'Home database', purpose: 'home', status: 'ready', freshness: 'stale', createdBy: 'Thingtime API runtime', startedAt: '2026-11-02T00:00:00Z', observedAt: '2026-11-02T00:00:00Z', deployment: { environment: 'preview', branch: 'feature-search', commit: null, url: 'https://preview.example.com', region: null }, pools: [], totals: { open: 2, checkedOut: 0, created: 2, closed: 0 } };
 assert.equal(presentMongoSources([source], 'feature-search', 'all').length, 1);
 assert.equal(presentMongoSources([source], '', 'recent').length, 0);
 const row = presentMongoSources([source], '', 'stale')[0];
 assert.match(row.state, /stale snapshot/); assert.equal(row.commit, 'Unavailable'); assert.match(row.counts, /observed pool sockets/);
});

test('pagination totals cover all deduplicated loaded snapshots while server aggregates use the latest page', () => {
 const source = (id: string, open: number, freshness: MongoConnectionSource['freshness']): MongoConnectionSource => ({ id, totals: { open, checkedOut: 1, created: open, closed: 0 }, freshness } as MongoConnectionSource);
 const page = (sources: MongoConnectionSource[], serverCurrent: number): MongoConnectionInventory => ({ checkedAt: '2026-11-02T00:00:00Z', sources, nextCursor: null, totals: { observedOpen: 999, observedCheckedOut: 999, freshSources: 999, staleSources: 999, serverCurrent, serverAvailable: 50, serverTotalCreated: 100 }, server: { status: 'available', checkedAt: '2026-11-02T00:00:00Z', note: '' }, coverage: { complete: false, notes: [] } });
 const previous = page([source('one', 2, 'recent'), source('two', 4, 'stale')], 10);
 const merged = mergeMongoInventory(previous, page([source('two', 3, 'stale'), source('three', 5, 'current')], 12), true);
 assert.equal(merged.sources.length, 3); assert.equal(merged.totals.observedOpen, 10); assert.equal(merged.totals.observedCheckedOut, 3); assert.equal(merged.totals.freshSources, 2); assert.equal(merged.totals.staleSources, 1); assert.equal(merged.totals.serverCurrent, 12);
 const refreshed = mergeMongoInventory(merged, page([source('three', 1, 'current')], 8), false);
 assert.equal(refreshed.sources.length, 1); assert.equal(refreshed.totals.observedOpen, 1);
});
