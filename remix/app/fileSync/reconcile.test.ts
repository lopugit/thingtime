import assert from 'node:assert/strict';
import test from 'node:test';
import { planFileSync, validSyncPath, type SyncEntry, type SyncScan, type SyncScope, type SyncBaseline, type SyncPolicy } from './reconcile';

const scope: SyncScope = { origin: 'https://thingtime.test', ownerId: 'owner', dataPlane: 'home', rootId: 'photos', deviceId: 'phone' };
const file = (path = 'photo.jpg', version = '1', hash = 'a'): SyncEntry => ({ path, version, id: path, kind: 'file', size: 10, sha256: hash.repeat(64) });
const folder = (path: string, version = '1'): SyncEntry => ({ path, version, id: path, kind: 'folder', size: 0, sha256: null });
const scan = (entries: SyncEntry[], complete = true): SyncScan => ({ scope, complete, entries });
const baseline = (local: SyncEntry[] = [], remote = local): SyncBaseline => ({ scope, entries: local.map((entry, i) => ({ path: entry.path, local: entry, remote: remote[i] })) });
const twoWay: SyncPolicy = { mode: 'two-way', propagateDeletes: true };
const plan = (l: SyncEntry[], r: SyncEntry[], old: SyncEntry[] = [], policy = twoWay) => planFileSync(scan(l), scan(r), baseline(old), policy).decisions;

test('new files copy in either direction with an exclusive absent-target guard', () => {
	assert.deepEqual(plan([file()], []), [{ kind: 'copy', path: 'photo.jpg', from: 'local', source: file(), expectedTarget: null }]);
	assert.equal((plan([], [file()])[0] as any).from, 'remote');
});

test('equal bytes settle even with different replica identities and clocks', () => {
	const remote = { ...file(), id: 'cloud-attachment', version: 'server-94' };
	assert.equal(plan([file()], [remote])[0].kind, 'settled');
});

test('an edit carries the exact old destination precondition', () => {
	const local = file('photo.jpg', '2', 'b');
	assert.deepEqual(plan([local], [file()], [file()])[0], { kind: 'copy', path: 'photo.jpg', from: 'local', source: local, expectedTarget: file() });
});

test('concurrent unequal edits and independently created names require review', () => {
	for (const old of [[], [file()]]) {
		assert.equal((plan([file('photo.jpg', '2', 'b')], [file('photo.jpg', '3', 'c')], old)[0] as any).reason, 'both-changed');
	}
});

test('deletion propagates only from a recorded common baseline and explicit policy', () => {
	assert.deepEqual(plan([], [file()], [file()])[0], { kind: 'trash', path: 'photo.jpg', side: 'remote', expected: file() });
	assert.equal(plan([], [file()])[0].kind, 'copy');
	assert.equal((plan([], [file()], [file()], { ...twoWay, propagateDeletes: false })[0] as any).reason, 'deletion-disabled');
});

test('delete versus remote edit or replacement never trashes edited content', () => {
	for (const changed of [file('photo.jpg', '2', 'b'), { ...file(), id: 'replacement' }, file('photo.jpg', '2')]) {
		assert.equal((plan([], [changed], [file()])[0] as any).reason, 'delete-edit');
	}
});

test('folder deletion conflicts with a new descendant even if the parent revision did not change', () => {
	for (const [local, remote] of [[[], [folder('dir'), file('dir/new')]], [[folder('dir'), file('dir/new')], []]]) {
		const result = plan(local, remote, [folder('dir')]);
		assert.equal((result.find(decision => decision.path === 'dir') as any).reason, 'delete-edit');
	}
});

test('backup retains remote content after local deletion and refuses remote overwrite', () => {
	const backup: SyncPolicy = { mode: 'backup', propagateDeletes: true };
	assert.equal(plan([], [file()], [file()], backup)[0].kind, 'settled');
	assert.equal((plan([file('photo.jpg', '2', 'b')], [file('photo.jpg', '3', 'c')], [file()], backup)[0] as any).reason, 'destination-changed');
	assert.equal(plan([file()], [], [], backup)[0].kind, 'copy');
});

test('one-way modes never silently overwrite a diverged destination', () => {
	for (const mode of ['upload', 'download'] as const) {
		const policy = { mode, propagateDeletes: false };
		assert.equal(plan([file('photo.jpg', '2', 'b')], [file('photo.jpg', '3', 'c')], [file()], policy)[0].kind, 'conflict');
	}
	assert.equal((plan([], [file()], [], { mode: 'download', propagateDeletes: false })[0] as any).from, 'remote');
});

test('incomplete, offline, permission-limited or paginated scans cannot infer deletions', () => {
	for (const [left, right] of [[scan([], false), scan([file()])], [scan([file()]), scan([], false)]]) {
		assert.throws(() => planFileSync(left, right, baseline([file()]), twoWay), /finish/);
	}
});

test('reconciliation fences every identity boundary', () => {
	for (const field of ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId'] as const) {
		const foreign = { ...scope, [field]: 'other' };
		assert.throws(() => planFileSync(scan([]), { ...scan([]), scope: foreign }, baseline(), twoWay), /changed/);
		assert.throws(() => planFileSync(scan([]), scan([]), { ...baseline(), scope: foreign }, twoWay), /changed/);
	}
});

test('unsafe, duplicate, case-colliding and Unicode-colliding paths fail closed', () => {
	for (const path of ['', '/absolute', '../escape', 'a/../escape', 'a//b', 'a\\b', 'a\u0000b', './photo.jpg']) assert.equal(validSyncPath(path), false, path);
	for (const entries of [[file(), file()], [file('Photo.jpg'), file('photo.jpg')], [file('café.jpg'), file('cafe\u0301.jpg')]]) {
		assert.throws(() => plan(entries, []), /duplicate|collision/);
	}
	assert.throws(() => plan([file('Photo.jpg')], [file('photo.jpg')]), /collision/);
});

test('digest, size, type, identity and ancestor validation precede all work', () => {
	for (const entry of [{ ...file(), sha256: null }, { ...file(), size: -1 }, { ...file(), size: Infinity }, { ...file(), id: '' }, file('missing/photo.jpg')]) {
		assert.throws(() => plan([entry], []), /Invalid|ancestor/);
	}
	assert.throws(() => plan([file('dir'), file('dir/child')], []), /ancestor/);
	assert.equal(plan([folder('dir'), file('dir/child')], []).length, 2);
	assert.equal((plan([folder('photo.jpg')], [file()])[0] as any).reason, 'type-changed');
});

test('only verified matching content can become the common baseline', () => {
	assert.throws(() => planFileSync(scan([]), scan([]), baseline([file()], [file('photo.jpg', '2', 'b')]), twoWay), /confirmed/);
});

test('planning is deterministic and does not mutate observations', () => {
	const entries = [file('z'), file('a')];
	const before = JSON.stringify(entries);
	assert.deepEqual(plan(entries, []).map(entry => entry.path), ['a', 'z']);
	assert.equal(JSON.stringify(entries), before);
});
