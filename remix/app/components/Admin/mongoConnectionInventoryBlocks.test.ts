import assert from 'node:assert/strict';
import test from 'node:test';
import { MONGO_CONNECTION_INVENTORY_BLOCKS, migrateMongoInventoryBlocks } from './mongoConnectionInventoryBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { safeDeploymentUrl, presentMongoSources, presentMongoDeployments, presentMongoCoverageNotes, mergeMongoInventory } from './mongoConnectionInventoryPresentation';
import type { MongoConnectionSource, MongoConnectionInventory } from '~/mongodb/connectionInventory';
const flatten = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
test('inventory fields remain independently editable in saved repeated templates', () => {
 const blocks = settingsDocumentBlocks(MONGO_CONNECTION_INVENTORY_BLOCKS); const all = flatten(blocks);
 assert.equal(new Set(all.map(block => block.id)).size, all.length);
 for (const id of ['source-title', 'reason-value', 'source-counts', 'deployment-observed', 'deployment-link', 'creator-label', 'creator-value', 'pool-host', 'pool-counts', 'pool-lifecycle', 'refresh', 'search', 'freshness', 'load-more']) assert.ok(all.some(block => block.id === `mongo-${id}`), id);
 assert.ok(all.every(block => !block.source && !block.native && !block.component));
 const reason = all.find(block => block.id === 'mongo-reason-value')!; reason.css = { color: '#663399' };
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

const deploymentSource = (id: string, overrides: Partial<MongoConnectionSource> = {}): MongoConnectionSource => ({ id, runtimeId: id, appName: 'API', reason: 'Shared home client', purpose: 'home', status: 'ready', freshness: 'recent', createdBy: 'Thingtime API runtime', startedAt: '2026-11-02', observedAt: '2026-11-03', deployment: { environment: 'preview', branch: 'same-branch', commit: null, url: null, region: 'syd1', deploymentId: 'dpl_one' }, pools: [], totals: { open: 3, checkedOut: 1, created: 3, closed: 0 }, monitoring: { mode: 'stream', servers: 3, socketsUpperBound: 6, basis: 'topology-model' }, ...overrides });
test('deployment grouping uses immutable IDs and keeps unknown identities separate', () => {
 const known = deploymentSource('one'); const same = deploymentSource('two');
 const unknown = deploymentSource('three', { deployment: { ...known.deployment, deploymentId: null } });
 const rows = presentMongoDeployments([known, same, unknown, { ...unknown, id: 'four' }]);
 assert.equal(rows.length, 3); assert.equal(rows[0].open, '6'); assert.equal(rows[0].inUse, '2'); assert.equal(rows[0].idle, '4'); assert.equal(rows[0].estimate, '6–18');
 assert.match(rows[0].estimateNote, /not a per-node Atlas/); assert.match(rows[1].deploymentId, /kept separate/);
});
test('historical and failed clients cannot inflate deployment headline counts', () => {
 const rows = presentMongoDeployments([deploymentSource('one'), deploymentSource('stale', { freshness: 'stale' }), deploymentSource('closed', { status: 'closed' }), deploymentSource('failed', { status: 'failed' })]);
 assert.equal(rows[0].open, '3'); assert.equal(rows[0].estimate, '3–9'); assert.match(rows[0].observation, /3 historical/);
 const historical = presentMongoDeployments([deploymentSource('stale', { freshness: 'stale' })])[0];
 assert.equal(historical.open, 'Unavailable'); assert.equal(historical.estimate, 'Unavailable');
});
test('missing monitoring is unavailable and invalid counters never render NaN', () => {
 assert.equal(presentMongoDeployments([deploymentSource('one', { monitoring: undefined })])[0].estimate, 'Unavailable');
 const invalid = deploymentSource('one', { totals: { open: NaN, checkedOut: Infinity, created: 0, closed: 0 } });
 const row = presentMongoDeployments([invalid])[0]; assert.equal(row.open, '0'); assert.equal(row.idle, '0'); assert(!JSON.stringify(row).includes('NaN'));
});
test('filters retain the whole matching deployment and shared feature access labels', () => {
 const one = deploymentSource('one', { featureUsage: [{ feature: 'builder', accesses: 2, lastUsedAt: '2026-11-03' }] });
 const rows = presentMongoDeployments([one, deploymentSource('two')], 'builder'); assert.equal(rows.length, 1); assert.equal(rows[0].open, '6'); assert.match(rows[0].featureRows[0].accesses, /shared-client/);
 const custom = structuredClone(MONGO_CONNECTION_INVENTORY_BLOCKS); custom[0].children![0].text = 'Custom heading'; assert.equal(migrateMongoInventoryBlocks(custom), custom);
});
test('estimated upper range includes pending handshakes without treating monitor model as observed', () => {
 const source = deploymentSource('one'); source.pools = [{ id: 'pool', address: 'db:27017', status: 'ready', open: 3, checkedOut: 1, pending: 2, created: 3, closed: 0, cleared: 0, maxPoolSize: 10 }];
 const row = presentMongoDeployments([source])[0]; assert.equal(row.estimate, '3–11'); assert.match(row.estimateNote, /3 observed app sockets.*0–6 modeled monitoring sockets.*0–2 pending handshakes/);
});
test('feature coverage distinguishes unknown, empty and mixed usage and shows last access', () => {
 const unknown = deploymentSource('unknown');
 assert.equal(presentMongoDeployments([unknown])[0].featureSummary, 'Feature usage unavailable');
 assert.match(presentMongoDeployments([deploymentSource('empty', { featureUsage: [] })])[0].featureSummary, /No feature usage recorded/);
 const used = deploymentSource('used', { featureUsage: [{ feature: 'builder', accesses: 2, lastUsedAt: '2026-11-03T00:00:00Z' }] });
 const mixed = presentMongoDeployments([unknown, used])[0]; assert.match(mixed.featureSummary, /usage unavailable for 1 client/); assert.match(mixed.featureRows[0].accesses, /last used/); assert(!mixed.featureRows[0].accesses.includes('Unknown time'));
});
test('zero pool limits describe unlimited capacity and no idle expiry', () => {
 const source = deploymentSource('one'); source.pools = [{ id: 'pool', address: 'db:27017', status: 'ready', open: 3, checkedOut: 1, pending: 0, created: 3, closed: 0, cleared: 0, maxPoolSize: 0, minPoolSize: 0, maxIdleTimeMS: 0 }];
 const pool = presentMongoDeployments([source])[0].rows[0].poolRows[0]; assert.match(pool.state, /maximum pool size unlimited/); assert.match(pool.settings, /No idle expiry/);
});


test('coverage explains deployment historical exclusions while preserving raw summaries and custom layouts', () => {
 const legacyScope = 'Counts below sum the sources on this page at their observation times, including stale snapshots; they are not a live database or deployment total.';
 const notes = [legacyScope, 'A storage-read warning must remain visible.'];
 const presented = presentMongoCoverageNotes(notes);
 assert.match(presented[0].text, /Deployment headline counts include only current or recent ready client observations/);
 assert.match(presented[0].text, /Stale, closed and failed sources are historical and excluded/);
 assert.match(presented[0].text, /raw loaded-snapshot totals retain historical observations/);
 assert.match(presented[0].text, /Neither is a live database total/);
 assert.equal(presented[1].text, notes[1]);
 assert.deepEqual(notes, [legacyScope, 'A storage-read warning must remain visible.'], 'API notes are not mutated');
 const ready = deploymentSource('ready');
 const stale = deploymentSource('stale', { freshness: 'stale' });
 const page = { sources: [ready, stale], totals: { observedOpen: 6, observedCheckedOut: 2 }, coverage: { complete: false, notes } } as MongoConnectionInventory;
 assert.equal(presentMongoDeployments(page.sources)[0].open, '3');
 assert.equal(mergeMongoInventory(null, page, false).totals.observedOpen, 6, 'legacy raw totals still include stale snapshots');
 const custom = structuredClone(MONGO_CONNECTION_INVENTORY_BLOCKS);
 const coverage = flatten(custom).find(block => block.id === 'mongo-coverage-note')!;
 coverage.text = 'Custom coverage explanation';
 assert.equal(migrateMongoInventoryBlocks(custom), custom, 'custom saved blocks are not migrated');
 assert.equal(coverage.text, 'Custom coverage explanation');
});
