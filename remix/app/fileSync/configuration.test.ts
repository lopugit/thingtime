import assert from 'node:assert/strict';
import test from 'node:test';
import { FILE_SYNC_REQUIREMENTS, fileSyncSchema, newFileSyncConfiguration, parseFileSyncConfiguration } from './configuration';
import { planConfiguredFileSync, readOwnedFileSyncConfiguration, type FileSyncApproval } from './configuredPlan';
import { validateThingtimeCrystal, getThingtimeSchema, isProtectedThingtime } from '../schemas/registry';
import { builtinSchemaCopySource, extendSchemaCopy } from '../schemas/schemaCopies';
import { createApiCapabilitiesManifest } from '../docs/apiDocs';
import { thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import type { SyncEntry, SyncScope } from './reconcile';

const config = () => newFileSyncConfiguration({ name: 'Documents', deviceId: 'device-1', localRootId: 'native-root-1', remoteFolderId: 'folder-1' });
const scope: SyncScope = { origin: 'https://thingtime.test', ownerId: 'owner-1', dataPlane: 'home', rootId: 'sync-1', deviceId: 'device-1' };
const row = () => ({ id: 'sync-1', author: { id: scope.ownerId }, updatedAt: '2026-10-17T00:00:00.000Z', thingtime: ['file-sync'], acl: ['tt:user'], crystal: config() });
const file = (path: string): SyncEntry => ({ path, id: path, version: 'v1', kind: 'file', size: 1, sha256: 'a'.repeat(64) });
const folder = (path: string): SyncEntry => ({ path, id: path, version: 'v1', kind: 'folder', size: 0, sha256: null });
const input = () => {
 const saved = readOwnedFileSyncConfiguration({ ...row(), crystal: { ...config(), paused: false } }, scope.ownerId);
 const approval: FileSyncApproval = structuredClone({ ...saved, scope });
 return { saved, approval, local: { scope, complete: true, entries: [file('report.txt')] }, remote: { scope, complete: true, entries: [] as SyncEntry[] },
  baseline: { scope, entries: [] as { path: string; local: SyncEntry; remote: SyncEntry }[] }, localRootId: config().localRootId,
  remoteFolderId: config().remoteFolderId, conditions: { network: 'wifi' as const, charging: true } };
};

test('file sync is discoverable, independently copyable ordinary data with paused private-create defaults', () => {
 assert.deepEqual(getThingtimeSchema('file-sync'), fileSyncSchema);
 assert.equal(isProtectedThingtime(['file-sync']), false);
 assert.deepEqual(config(), { configurationVersion: 1, name: 'Documents', deviceId: 'device-1', localRootId: 'native-root-1', remoteFolderId: 'folder-1', mode: 'two-way', paused: true, propagateDeletes: false, network: 'wifi', chargingOnly: false, excludedPaths: [] });
 const source = builtinSchemaCopySource('file-sync')!;
 const copy = extendSchemaCopy(source, { name: 'My sync template', fields: [{ name: 'notes', type: 'string' }] });
 assert.equal(copy.ok, true);
 if (copy.ok) { assert.equal(copy.crystal.forkOf, 'schema-file-sync'); assert.equal(validateThingtimeCrystal(['schema'], copy.crystal).ok, true); }
 assert.equal(createApiCapabilitiesManifest(scope.origin).features['api.things'], '1.38.0');
 assert.equal(thingtimeCapabilityManifest(scope.origin).features['api.things'].version, '1.38.0');
 const valid = validateThingtimeCrystal(['file-sync'], { ...config(), treeUri: 'content://private', secret: 'never-store' });
 assert.equal(valid.ok, true); if (valid.ok) assert.deepEqual(valid.crystal, config());
 assert.equal(validateThingtimeCrystal(['file-sync', 'post'], config()).ok, false);
});

test('closed configuration bounds refuse invalid paths, URIs, unsupported policy and ambiguous exclusions', () => {
 for (const patch of [ { configurationVersion: 3 }, { paused: 'false' }, { propagateDeletes: undefined }, { chargingOnly: null },
  { name: 'x\nsecret' }, { deviceId: '' }, { localRootId: 'content://grant' }, { remoteFolderId: '../folder' }, { mode: 'mirror' },
  { mode: 'backup', propagateDeletes: true }, { network: 'sometimes' }, { excludedPaths: ['../outside'] },
  { excludedPaths: ['a\\b'] }, { excludedPaths: ['/absolute'] }, { excludedPaths: ['a', 'A'] },
  { excludedPaths: ['é', 'e\u0301'] }, { excludedPaths: Array(101).fill('a') },
  { excludedPaths: Array.from({ length: 100 }, (_, i) => `${i}`.padEnd(200, 'x')) } ]) {
  assert.throws(() => parseFileSyncConfiguration({ ...config(), ...patch }));
  assert.equal(validateThingtimeCrystal(['file-sync'], { ...config(), ...patch }).ok, false);
 }
 const raw = { ...config(), excludedPaths: ['private'] }; const parsed = parseFileSyncConfiguration(raw); raw.excludedPaths.push('later');
 assert.deepEqual(parsed.excludedPaths, ['private']);
});

test('runtime rejects public, shared, foreign, attached, app-scoped, malformed and copied-schema records', () => {
 for (const patch of [{ author: { id: 'other' } }, { author: null }, { acl: ['tt:all'] }, { acl: ['tt:user', 'tt:user/friend/write'] }, { acl: null },
  { appId: 'app' }, { targetId: 'parent' }, { id: '' }, { updatedAt: null }, { updatedAt: 'bad' }, { thingtime: ['data'] }, { thingtime: ['file-sync', 'data'] }]) {
  assert.throws(() => readOwnedFileSyncConfiguration({ ...row(), ...patch }, scope.ownerId));
 }
 assert.deepEqual(readOwnedFileSyncConfiguration(row(), scope.ownerId).configuration, config());
});

test('new work needs exact device-local policy approval and matching connection scope', () => {
 assert.equal(planConfiguredFileSync(input()).status, 'ready');
 for (const key of ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId'] as const) {
  const i = input(); i.approval.scope[key] = key === 'origin' ? 'https://other.test' : 'other'; assert.throws(() => planConfiguredFileSync(i), /approval changed/);
 }
 for (const change of [(i: ReturnType<typeof input>) => { i.saved.configuration.mode = 'upload'; },
  (i: ReturnType<typeof input>) => { i.saved.updatedAt = '2026-10-18T00:00:00.000Z'; },
  (i: ReturnType<typeof input>) => { i.localRootId = 'other'; }, (i: ReturnType<typeof input>) => { i.remoteFolderId = 'other'; },
  (i: ReturnType<typeof input>) => { i.saved.id = 'copy'; }]) { const i = input(); change(i); assert.throws(() => planConfiguredFileSync(i), /approval changed/); }
});

test('paused, offline, unknown network and unconfirmed charging wait without generating mutations', () => {
 const paused = input(); paused.saved.configuration.paused = paused.approval.configuration.paused = true;
 assert.deepEqual(planConfiguredFileSync(paused), { status: 'waiting', reason: 'paused' });
 for (const network of ['offline', 'unknown', 'cellular', 'ethernet'] as const) {
  const i = input(); assert.deepEqual(planConfiguredFileSync({ ...i, conditions: { network, charging: true } }), { status: 'waiting', reason: network === 'offline' ? 'offline' : 'network' });
 }
 for (const charging of [false, null]) {
  const i = input(); i.saved.configuration.chargingOnly = i.approval.configuration.chargingOnly = true;
  assert.deepEqual(planConfiguredFileSync({ ...i, conditions: { network: 'wifi', charging } }), { status: 'waiting', reason: 'charging' });
 }
 const i = input(); i.saved.configuration.network = i.approval.configuration.network = 'any';
 assert.equal(planConfiguredFileSync({ ...i, conditions: { network: 'cellular', charging: null } }).status, 'ready');
});

test('exclusions apply equally to local, remote and baseline and preserve protected ancestor folders', () => {
 const i = input(); const tree = [folder('docs'), file('docs/private.txt'), file('docs/public.txt')];
 i.local.entries = []; i.remote.entries = tree;
 i.baseline.entries = tree.map(e => ({ path: e.path, local: e, remote: e }));
 for (const c of [i.saved.configuration, i.approval.configuration]) { c.propagateDeletes = true; c.excludedPaths = ['DOCS/private.txt']; }
 const result = planConfiguredFileSync(i); assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
 assert.deepEqual(result.plan.decisions.map(d => [d.path, d.kind, d.kind === 'conflict' ? d.reason : null]), [
  ['docs', 'conflict', 'excluded-descendants'], ['docs/public.txt', 'trash', null] ]);
 for (const c of [i.saved.configuration, i.approval.configuration]) c.excludedPaths = ['docs'];
 const excluded = planConfiguredFileSync(i); assert.equal(excluded.status, 'ready'); if (excluded.status === 'ready') assert.deepEqual(excluded.plan.decisions, []);
});

test('exclusions cannot conceal incomplete scans, case aliases or missing ancestors', () => {
 const i = input(); for (const c of [i.saved.configuration, i.approval.configuration]) c.excludedPaths = ['bad'];
 assert.throws(() => planConfiguredFileSync({ ...i, local: { ...i.local, complete: false } }), /finish/);
 assert.throws(() => planConfiguredFileSync({ ...i, local: { ...i.local, entries: [file('bad'), file('BAD')] } }), /collision/);
 assert.throws(() => planConfiguredFileSync({ ...i, local: { ...i.local, entries: [file('bad/child')] } }), /ancestor/);
});

test('backup, upload and download decisions use the saved direction and safe delete policy', () => {
 for (const mode of ['backup', 'upload', 'download', 'two-way'] as const) {
  const i = input(); for (const c of [i.saved.configuration, i.approval.configuration]) c.mode = mode;
  if (mode === 'download') { i.remote.entries = i.local.entries; i.local.entries = []; }
  const result = planConfiguredFileSync(i); assert.equal(result.status, 'ready'); if (result.status !== 'ready') continue;
  const copy = result.plan.decisions[0]; assert.equal(copy.kind, 'copy'); if (copy.kind === 'copy') assert.equal(copy.from, mode === 'download' ? 'remote' : 'local');
 }
});

test('sync configurations require the combined contract rather than the older Builder-only minor', () => {
 assert.equal(capabilitySatisfies('1.35.0', FILE_SYNC_REQUIREMENTS['api.things']), false);
 assert.equal(capabilitySatisfies('1.36.0', FILE_SYNC_REQUIREMENTS['api.things']), true);
 assert.equal(capabilitySatisfies('2.0.0', FILE_SYNC_REQUIREMENTS['api.things']), false);
});

test('nonempty Gitignore policy uses version2 so legacy clients cannot erase it; empty retains exact version1 hash input', () => {
 const legacy = config(), text = 'node_modules/\n!keep.log';
 assert.throws(() => parseFileSyncConfiguration({ ...legacy, ignoreRules: text }), /version 2/);
 const next = parseFileSyncConfiguration({ ...legacy, configurationVersion: 2, ignoreRules: text });
 assert.equal(next.configurationVersion, 2); assert.equal(next.ignoreRules, text); assert.notEqual(JSON.stringify(next), JSON.stringify(legacy));
 assert.deepEqual(parseFileSyncConfiguration({ ...legacy, configurationVersion: 2, ignoreRules: '' }), legacy);
 assert.deepEqual(parseFileSyncConfiguration({ ...legacy, ignoreRules: '' }), legacy);
 // The deployed legacy parser's existing version gate refuses this contract.
 const oldClient = (value: { configurationVersion: number }) => { if (value.configurationVersion !== 1) throw Error('Unsupported file sync configuration version.'); };
 assert.throws(() => oldClient(next), /Unsupported/); assert.doesNotThrow(() => oldClient(legacy));
 assert.equal(validateThingtimeCrystal(['file-sync'], next).ok, true);
});

test('Gitignore applies symmetrically and ignored descendants protect parent removal', () => {
 const i = input(); for (const c of [i.saved.configuration, i.approval.configuration]) { c.configurationVersion = 2; c.ignoreRules = 'docs/*.txt\n!docs/keep.txt'; c.propagateDeletes = true; }
 i.local.entries = [folder('docs')]; i.remote.entries = [folder('docs'), file('docs/secret.txt')];
 i.baseline.entries = [{ path: 'docs', local: folder('docs'), remote: folder('docs') }, { path: 'docs/secret.txt', local: file('docs/secret.txt'), remote: file('docs/secret.txt') }];
 const planned = planConfiguredFileSync(i); assert.equal(planned.status, 'ready');
 if (planned.status === 'ready') assert.equal(planned.plan.decisions.some(d => d.path === 'docs/secret.txt'), false);
});
