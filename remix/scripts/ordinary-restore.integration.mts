/** Disposable replica proof, launched by test-account-profile-backup.mjs.
 * Signup uses production Request handlers; all content goes through canonical
 * API utilities. No direct Mongo content reads, writes or injected identity. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:28143\/thingtime\?replicaSet=account-profile-backup$/.test(process.env.MONGODB_CONNECTION_STRING || ''));
const base = 'https://restore-fixture.test';
const register = await import('../app/routes/api/v1/auth/register/_register');
const logout = await import('../app/routes/api/v1/auth/logout/_logout');
const actionsRun = await import('../app/routes/api/v1/actions/run/_run');
const timeline = await import('../app/routes/api/v1/timeline/_timeline');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { createThing, deleteThing, getThing, updateThing } = await import('../app/api/utils/things/things');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');
const { retainBackupThingSnapshot, openBackupThingSnapshot } = await import('../app/api/utils/backups/thingSnapshots');
const { prepareBackup, sealBackup, copySealedBackup } = await import('../app/api/utils/backups/portableBackup');
const { BACKUP_FORMAT, backupJson } = await import('../app/backups/manifest');
const { rewriteComposition } = await import('../app/api/utils/actions/forkCompositionCore');
const { runAction } = await import('../app/api/utils/actions/execute');
const { browseComponents } = await import('../app/api/utils/components/browse');
const { resolveWebpage } = await import('../app/api/utils/webpages/webpages');
const { resolveSharedComposition } = await import('../app/api/utils/actions/sharedComposition');
const { executeOrdinaryRestoreTransaction, executeResumableOrdinaryRestore, ordinaryRestoreTargetId, ordinaryRestoreAdmissionId, ordinaryRestoreGraphHash } = await import('../app/api/utils/backups/ordinaryRestoreTransaction');
const request = (cookie: string, path = '/api/v1/things', body?: unknown) => new Request(base + path, {
	method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
	...(body === undefined ? {} : { body: JSON.stringify(body) })
});
async function signup() {
	const username = 'restore-' + randomUUID().slice(0, 8);
	const response = await register.action({ request: request('', '/api/v1/auth/register', {
		username, email: username + '@example.invalid', password: randomUUID() + '-NeverExport!', displayName: 'Restore fixture'
	}) } as any);
	assert.equal(response.status, 200);
	const data = await response.json(); assert.equal(data.ok, true);
	return { user: data.user, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
const source = await signup(), destination = await signup(), otherAccount = await signup();
const sourceScope = { ownerId: source.user.id, apiOrigin: base, dataPlane: 'home' };
const access = { scope: sourceScope, authorize: async () => {
	assert.equal((await getCurrentUser(request(source.cookie)))?.id, source.user.id);
} };
const rows: any[] = [
	{ shareId: 'source-folder', thingtime: ['folder'], crystal: { name: 'Captured folder' } },
	{ shareId: 'source-schema', thingtime: ['schema'], crystal: { name: 'captured-schema', fields: [] } },
	{ shareId: 'source-data', thingtime: ['data'], folderId: 'source-folder', geo: { lat: 55.68, lng: 12.57 }, crystal: { schemaId: 'source-schema', parentId: 'source-data', text: 'Independent ✨ content' } },
	{ shareId: 'source-action-a', thingtime: ['action'], crystal: { name: 'A', actionKey: 'captured-a', steps: [{ op: 'actions.invoke', action: 'source-action-b' }], capabilities: [{ capability: 'actions.invoke', actions: ['source-action-b'] }] } },
	{ shareId: 'source-action-b', thingtime: ['action'], crystal: { name: 'B', actionKey: 'captured-b', steps: [{ op: 'actions.invoke', action: 'source-action-a' }], capabilities: [{ capability: 'actions.invoke', actions: ['source-action-a'] }] } },
	{ shareId: 'source-browser', thingtime: ['action'], crystal: { name: 'Browser', actionKey: 'captured-browser', runtime: 'browser', steps: [{ op: 'return', value: 'ready' }] } },
	{ shareId: 'source-component', thingtime: ['component'], crystal: { name: 'Card', componentKey: 'captured-card', render: { tag: 'button', ttAction: 'source-action-a', children: 'Captured action' } } },
	{ shareId: 'source-page', thingtime: ['webpage'], crystal: { name: 'Captured page', blocks: [{ id: 'card', type: 'component', component: 'source-component' }] } }
];
const created: any[] = [];
const sourceGeo = new Map<string, unknown>();
for (const row of rows) {
	const result = await createThing(source.user.id, { ...row, acl: ['tt:user'] }, source.user);
	assert.equal(result.ok, true, JSON.stringify(result));
	if (result.ok) { created.push(result.doc); const projected = await getThing(source.user, result.doc.shareId); assert.equal(projected.ok, true); if (projected.ok) sourceGeo.set(row.shareId, projected.thing.geo); }
}
const first = await openLocalBackupStore(join(directory!, 'first'));
const independent = await openLocalBackupStore(join(directory!, 'independent'));
const snapshotId = randomUUID();
const capturedAt = new Date().toISOString();
await prepareBackup(first, { format: BACKUP_FORMAT, snapshotId, scope: sourceScope,
	boundary: { kind: 'point-in-time', token: 'explicit-selected-content-fixture', startedAt: capturedAt, completedAt: capturedAt },
	coverage: { selectionId: 'synthetic-selected-ordinary', description: 'Eight explicitly selected ordinary records; not complete account coverage' }
}, (async function* () {
	for (const [ordinal, doc] of [...created].sort((a, b) => a.shareId.localeCompare(b.shareId)).entries()) yield await retainBackupThingSnapshot(first, snapshotId, ordinal, doc, access);
})(), access);
const seal = await sealBackup(first, snapshotId, access);
await copySealedBackup(first, independent, snapshotId, access);
for (const doc of [...created].reverse()) {
	const result = await deleteThing(source.user, doc.shareId);
	assert.equal(result.ok, true);
}
await rm(join(directory!, 'first'), { recursive: true });
for (const row of rows) assert.equal((await getThing(source.user, row.shareId)).ok, false);
const vaultRoot = join(directory!, 'independent'), vaultIdentity = await stat(vaultRoot);
assert.equal((await logout.action({ request: request(source.cookie, '/api/v1/auth/logout', {}) } as any)).status, 200);
assert.equal(await getCurrentUser(request(source.cookie)), null);
source.cookie = '';
// The already-authorized independent LOCAL vault remains readable without
// the original account. Its pinned private directory is the access boundary;
// it never supplies destination authority or requests original live content.
access.authorize = async () => {
  const current = await stat(vaultRoot);
  assert.equal(current.ino, vaultIdentity.ino); assert.equal(current.dev, vaultIdentity.dev);
  assert.equal(current.mode & 0o077, 0); assert.equal(current.uid, process.getuid?.());
};

const root = await createThing(destination.user.id, { thingtime: ['folder'], crystal: { name: 'Explicit restore destination' }, acl: ['tt:user'] }, destination.user);
assert.equal(root.ok, true);
if (!root.ok) throw Error('Destination creation failed');
const review: any = { format: 'thingtime-selected-ordinary-restore-v1', referenceDomain: 'ordinary-composition-v1', operationId: randomUUID(),
	sourceSealHash: createHash('sha256').update(backupJson(seal)).digest('hex'), reviewHash: 'a'.repeat(64), graphHash: '', count: rows.length,
	destination: { scope: { ownerId: destination.user.id, apiOrigin: base, dataPlane: 'home' }, rootId: root.doc.shareId,
		rootRevision: root.doc.timelineHeadId, capabilities: { 'api.things': '1.52.0', 'api.actions-run': '1.43.0', 'api.timeline': '1.19.2' } } };
const map = (sourceId: string) => ordinaryRestoreTargetId(review, sourceId);
async function* records() {
	for (const row of rows) {
		const snapshot = await openBackupThingSnapshot(independent, snapshotId, row.shareId, access);
		const value = snapshot.value as any;
		const crystal = rewriteComposition(value.thingtime, value.crystal, (_kind, ref) => map(ref === 'captured-schema' ? 'source-schema' : ref));
		for (const field of ['componentKey', 'actionKey']) if (crystal[field]) crystal[field] = 'restore-key-' + createHash('sha256').update(review.operationId + row.shareId).digest('hex').slice(0, 40);
		if (value.thingtime.includes('schema')) crystal.name = map(row.shareId).slice(0, 60);
		if (value.thingtime.includes('data')) crystal.schema = map('source-schema').slice(0, 60);
		if (typeof crystal.parentId === 'string') crystal.parentId = map(crystal.parentId);
		yield { sourceId: row.shareId, input: { shareId: map(row.shareId), thingtime: value.thingtime, crystal,
			extended: value.extended, tags: value.tags, geo: value.geo, acl: ['tt:user'], folderId: value.folderId ? map(value.folderId) : root.doc.shareId } };
	}
}
Object.assign(review, await ordinaryRestoreGraphHash(records()));
const result = await executeOrdinaryRestoreTransaction(request(destination.cookie), review, records);
assert.equal(result.replayed, false); assert.equal(result.count, rows.length);
for await (const record of records()) {
	const read = await getThing(destination.user, record.input.shareId);
	assert.equal(read.ok, true);
	if (read.ok) {
		assert.deepEqual(read.thing.crystal, record.input.crystal);
		assert.deepEqual(read.thing.acl, ['tt:user']);
		assert.deepEqual(read.thing.geo, sourceGeo.get(record.sourceId));
	}
}
// Simulated acknowledgement loss: discard first result, replay identical
// immutable request, then prove a later owner edit cannot be overwritten.
assert.equal((await executeOrdinaryRestoreTransaction(request(destination.cookie), review, records)).replayed, true);
const missingSource = async function* (): AsyncGenerator<any> { throw Error('Completed replay must not read backup records'); };
assert.equal((await executeOrdinaryRestoreTransaction(request(destination.cookie), review, missingSource)).replayed, true);
const edited = await updateThing(destination.user, map('source-data'), { crystal: { schemaId: map('source-schema'), text: 'Later owner edit' } });
assert.equal(edited.ok, true);
assert.equal((await executeOrdinaryRestoreTransaction(request(destination.cookie), review, records)).replayed, true);
const after = await getThing(destination.user, map('source-data'));
assert.equal(after.ok && after.thing.crystal.text, 'Later owner edit');
await assert.rejects(executeOrdinaryRestoreTransaction(request(destination.cookie), { ...review, reviewHash: 'b'.repeat(64) }, records), /reused/);
const acceptedReview = { ...review };
review.operationId = randomUUID();
Object.assign(review, await ordinaryRestoreGraphHash(records()));
await assert.rejects(executeResumableOrdinaryRestore(request(destination.cookie), review, records, {
  afterCheckpoint: async (phase, ordinal) => { if (phase === 'intent' && ordinal === 3) throw Error('Interrupted after accepted intent'); }
}), /accepted intent/);
assert.equal((await getThing(destination.user, map('source-folder'))).ok, false);
const planning = await getThing(destination.user, root.doc.shareId);
assert.equal(planning.ok && planning.thing.creationProgress?.phase, 'planning');
const fixtureRecords = []; for await (const record of records()) fixtureRecords.push(record);
const crashTmp = join(directory!, 'crash-tmp'); await mkdir(crashTmp, { mode: 0o700 });
const crash = fork(fileURLToPath(new URL('./ordinary-restore-crash.worker.mts', import.meta.url)), [], {
  execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, TMPDIR: crashTmp }
});
const crashed = once(crash, 'exit');
crash.send({ cookie: destination.cookie, review, records: fixtureRecords, crashOrdinal: 2 });
const crashTimer = setTimeout(() => crash.kill('SIGTERM'), 30000);
try { assert.equal((await crashed)[0], 73, 'The child exits only after a committed canonical effect'); }
finally { clearTimeout(crashTimer); if (crash.exitCode === null) crash.kill('SIGTERM'); }
const afterCrash = await getThing(destination.user, root.doc.shareId);
assert.equal(afterCrash.ok && afterCrash.thing.creationProgress?.applied, 3);
const recoveredAdmissionResponse = await timeline.loader({ request: request(destination.cookie,
  '/api/v1/timeline?ownerId=' + encodeURIComponent(destination.user.id) + '&dataPlane=home&eventId=' + encodeURIComponent(ordinaryRestoreAdmissionId(destination.user.id, review.operationId))) });
assert.equal(recoveredAdmissionResponse.status, 200);
const recoveredAdmission = await recoveredAdmissionResponse.json();
assert.deepEqual(recoveredAdmission.entry.event.after.value.review, review);
Object.assign(review, recoveredAdmission.entry.event.after.value.review);

const interrupted = new AbortController();
await assert.rejects(executeResumableOrdinaryRestore(request(destination.cookie), review, records, {
  signal: interrupted.signal, afterCheckpoint: async (phase, ordinal) => { if (phase === 'effect' && ordinal === rows.length - 1) interrupted.abort(); }
}), /abort/i);
const restoring = await getThing(destination.user, root.doc.shareId);
assert.equal(restoring.ok && restoring.thing.creationProgress?.phase, 'restoring');
assert.equal(restoring.ok && restoring.thing.creationProgress?.applied, rows.length);
for (const action of [map('source-action-a'), map('source-browser')]) {
  const held = await getThing(destination.user, action); assert.equal(held.ok && held.thing.executionHeld, true);
  const direct = await runAction(destination.user, { action, execution: 'browser', executionVersion: '1.40.0' });
  assert.equal(direct.ok, false); assert.equal(!direct.ok && direct.status, 409);
  const byKey = await runAction(destination.user, { action: held.ok ? held.thing.crystal.actionKey : '' });
  assert.equal(byKey.ok, false); assert.equal(!byKey.ok && byKey.status, 409);
  const delegated = await runAction(destination.user, { action, source: 'component', execution: 'browser', executionVersion: '1.40.0' });
  assert.equal(delegated.ok, false); assert.equal(!delegated.ok && delegated.status, 409);
}
const parentAction = await createThing(destination.user.id, { thingtime: ['action'], crystal: {
  name: 'Invoke restoring child', capabilities: [{ capability: 'actions.invoke', actions: [map('source-action-a')] }],
  steps: [{ op: 'actions.invoke', action: map('source-action-a') }]
}, acl: ['tt:user'] }, destination.user);
assert.equal(parentAction.ok, true);
if (parentAction.ok) {
  const childResult = await runAction(destination.user, { action: parentAction.doc.shareId });
  assert.ok(JSON.stringify(childResult).includes('still restoring'));
}
const browseHeld = await browseComponents(destination.user, { mine: true });
assert.equal(browseHeld.ok && browseHeld.components.find(component => component.id === map('source-component'))?.executionHeld, true);
const pageHeld = await resolveWebpage(destination.user, { id: map('source-page') });
assert.equal(pageHeld.ok && pageHeld.page?.executionHeld, true);
assert.equal(pageHeld.ok && pageHeld.components.find(component => component.id === map('source-component'))?.executionHeld, true);
const shared = await resolveSharedComposition(destination.user, map('source-page'));
assert.equal('ok' in shared && shared.ok === false, false);
if (!('ok' in shared && shared.ok === false)) {
  const sharedResult = await runAction(destination.user, { action: map('source-action-a') }, shared as any);
  assert.equal(sharedResult.ok, false); assert.equal(!sharedResult.ok && sharedResult.status, 409);
}
assert.equal((await updateThing(destination.user, map('source-data'), { crystal: { schemaId: map('source-schema'), text: 'Owner edited interrupted restore' } })).ok, true);
await assert.rejects(executeResumableOrdinaryRestore(request(destination.cookie), review, records, {
  afterCheckpoint: async phase => { if (phase === 'verified') assert.equal((await updateThing(destination.user, map('source-data'), { crystal: { schemaId: map('source-schema'), text: 'Owner edit after verification' } })).ok, true); }
}), /changed during final verification/);
assert.equal((await executeResumableOrdinaryRestore(request(destination.cookie), review, records)).replayed, false);
assert.equal((await executeResumableOrdinaryRestore(request(destination.cookie), review, records)).replayed, true);
assert.equal((await executeResumableOrdinaryRestore(request(destination.cookie), review, missingSource)).replayed, true);
const resumedData = await getThing(destination.user, map('source-data'));
assert.equal(resumedData.ok && resumedData.thing.crystal.text, 'Owner edit after verification');
const activated = await getThing(destination.user, map('source-browser')); assert.equal(activated.ok && activated.thing.executionHeld, false);
const preparedResponse = await actionsRun.action({ request: request(destination.cookie, '/api/v1/actions/run', { action: map('source-browser'), execution: 'browser', executionVersion: '1.40.0' }) });
const prepared = await preparedResponse.json();
assert.equal(prepared.ok, true, JSON.stringify(prepared)); assert.equal(prepared.ok && prepared.status, 'prepared');
Object.assign(review, acceptedReview);
review.operationId = randomUUID();
Object.assign(review, await ordinaryRestoreGraphHash(records()));
const outside = await createThing(destination.user.id, { thingtime: ['folder'], crystal: { name: 'Outside selected destination' }, acl: ['tt:user'] }, destination.user);
assert.equal(outside.ok, true);
for (const parent of [undefined, null, outside.ok ? outside.doc.shareId : 'outside', map('source-data'), map('source-folder')]) {
  async function* escaped() { let first = true; for await (const record of records()) { const { folderId: _folderId, ...withoutParent } = record.input; yield first ? { ...record, input: parent === undefined ? withoutParent : { ...record.input, folderId: parent } } : record; first = false; } }
  const escapedReview = { ...review, ...await ordinaryRestoreGraphHash(escaped()) };
  await assert.rejects(executeOrdinaryRestoreTransaction(request(destination.cookie), escapedReview, escaped), /destination|parent/);
  assert.equal((await getThing(destination.user, map('source-folder'))).ok, false);
}
for (const deferredId of ['source-schema', 'source-component']) {
  async function* outOfOrder() {
    let deferred: any = null;
    for await (const record of records()) {
      if (record.sourceId === deferredId) deferred = record;
      else { yield record; if (record.sourceId === (deferredId === 'source-schema' ? 'source-data' : 'source-page')) { yield deferred; deferred = null; } }
    }
  }
  const invalidOrder = { ...review, ...await ordinaryRestoreGraphHash(outOfOrder()) };
  await assert.rejects(executeResumableOrdinaryRestore(request(destination.cookie), invalidOrder, outOfOrder), /must precede/);
  assert.equal((await getThing(destination.user, map('source-folder'))).ok, false);
}
const outsideAlias = 'restore-key-' + createHash('sha256').update(review.operationId + 'source-action-b').digest('hex').slice(0, 40);
const shadow = await createThing(destination.user.id, { thingtime: ['action'], crystal: { name: 'Existing outside program', actionKey: outsideAlias, version: 999,
  steps: [{ op: 'return', value: 'existing outside program' }]
}, acl: ['tt:user'] }, destination.user);
assert.equal(shadow.ok, true);
const shadowResult = await runAction(destination.user, { action: outsideAlias });
assert.equal(shadowResult.ok && 'result' in shadowResult && shadowResult.result, 'existing outside program');
for (const mode of ['media', 'unresolved-component', 'unmapped-action-alias', 'unmapped-parent', 'http-payload', 'managed-family']) {
  async function* unsupported() {
    for await (const record of records()) {
      if (mode === 'media' && record.sourceId === 'source-component') yield { ...record, input: { ...record.input, crystal: { ...(record.input.crystal as any), render: { tag: 'img', props: { src: '/api/v1/attachments/content?id=not-captured' } } } } };
      else if (mode === 'unresolved-component' && record.sourceId === 'source-page') yield { ...record, input: { ...record.input, crystal: { ...(record.input.crystal as any), blocks: [{ id: 'missing', type: 'component', component: 'not-captured' }] } } };
      else if (mode === 'unmapped-action-alias' && record.sourceId === 'source-action-a') yield { ...record, input: { ...record.input, crystal: { ...(record.input.crystal as any), steps: [{ op: 'actions.invoke', action: outsideAlias }], capabilities: [{ capability: 'actions.invoke', actions: [outsideAlias] }] } } };
      else if (mode === 'unmapped-parent' && record.sourceId === 'source-data') yield { ...record, input: { ...record.input, crystal: { ...(record.input.crystal as any), parentId: 'source-data' } } };
      else if (mode === 'http-payload' && record.sourceId === 'source-browser') yield { ...record, input: { ...record.input, crystal: { ...(record.input.crystal as any), steps: [{ op: 'http.request', method: 'GET', path: '/api/v1/things', query: { id: 'source-data' } }] } } };
      else if (mode === 'managed-family' && record.sourceId === 'source-data') yield { ...record, input: { ...record.input, thingtime: ['theme'] } };
      else yield record;
    }
  }
  const unsupportedReview = { ...review, ...await ordinaryRestoreGraphHash(unsupported()) };
  await assert.rejects(executeResumableOrdinaryRestore(request(destination.cookie), unsupportedReview, unsupported), /unsupported|unavailable dependencies|local relationship/);
  assert.equal((await getThing(destination.user, map('source-folder'))).ok, false);
}
await assert.rejects(executeOrdinaryRestoreTransaction(request(destination.cookie), { ...review, destination: { ...review.destination, capabilities: { ...review.destination.capabilities, 'api.things': '1.51.0' } } }, records), /capability contract/);
assert.equal((await updateThing(destination.user, root.doc.shareId, { crystal: { name: 'User changed root' } })).ok, true);
await assert.rejects(executeOrdinaryRestoreTransaction(request(destination.cookie), review, records), /revision changed/);
Object.assign(review, acceptedReview);
assert.equal((await getCurrentUser(request(otherAccount.cookie)))?.id, otherAccount.user.id);
await assert.rejects(executeOrdinaryRestoreTransaction(request(otherAccount.cookie), review, missingSource), /session changed/);
const logoutResponse = await logout.action({ request: request(destination.cookie, '/api/v1/auth/logout', {}) } as any);
assert.equal(logoutResponse.status, 200);
await assert.rejects(executeResumableOrdinaryRestore(request(destination.cookie), review, missingSource), /session changed/);
console.log(JSON.stringify({ ordinaryRestoreProof: { selectedRecords: rows.length, sourceRecordsRemoved: true, firstVaultRemoved: true, sourceSessionRevokedBeforeRestore: true,
	independentReadback: true, independentGeoProjectionReadback: true, executableCycleRemapped: true, folderAndSchemaTransactionVisibility: true,
	lostAcknowledgementReplayed: true, completedReplayWithoutSourceReads: true, laterEditPreserved: true, intentInterruptionResumed: true, processDeathAfterCommittedEffectResumed: true, durableReviewRecoveredThroughTimelineHandler: true, effectInterruptionResumed: true, heldServerAndBrowserRefused: true, heldAliasAndChildRefused: true, heldSharedRefused: true, heldBrowseAndWebpageProjected: true, completionRaceRefused: true, completedBrowserActivated: true, changedReviewRefused: true, unsupportedMediaFamilyAndMissingRefsRefused: true, existingDestinationAliasShadowRefused: true, httpPayloadRefsRefused: true, staleCapabilitiesRefused: true, outsideNullAndMissingParentsRefused: true, nonFolderAndCyclicParentsRefused: true, outOfOrderSchemaAndPageRefused: true, staleDestinationRefused: true,
	wrongAccountRefused: true, revokedSessionReplayRefused: true, wholeAccountReady: false, proof: 'atomic and per-record resumable canonical API-utils transactions; not whole account, installed UI or large-volume acceptance' } }));

process.exit(0);
