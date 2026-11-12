import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { createNativeAccountCreationRepositories } from '../documentStore/nativeAccountCreation';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence, withBoundTimelineRead } from '../things/persistenceContext';
import { createUserAccount } from '../auth/registerUser';
import type { PublicUser } from '../auth/users';
import { createThing, deleteThing, updateThing, viewerOf, type Viewer } from '../things/things';
import { loadWorkspaceAccess, serviceWorkspaceCanRead, workspaceRootFor } from './access';
import { initializeWorkspace, saveWorkspaceRecord, archiveWorkspaceRecord, bindWorkspacePage, readWorkspace, moveWorkspaceVisit, workspaceAccess, workspaceWriteHooks } from './workspaces';
import type { ServiceKind } from '../../../schemas/serviceWorkspace';
import type { CollectionProvider } from '../documentStore/collectionContract';
import { resolveWebpage } from '../webpages/webpages';
import { readTimelineEntries, timelineEventThingId } from '../timeline/repository';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';

const rootId = 'native-service-workspace';
async function fixture(t: TestContext) {
	const priorMongo = process.env.MONGODB_CONNECTION_STRING;
	process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:1/forbidden-native-service-workspace-fallback';
	t.after(() => { if (priorMongo === undefined) delete process.env.MONGODB_CONNECTION_STRING; else process.env.MONGODB_CONNECTION_STRING = priorMongo; });
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-service-access-')), path = join(directory, 'home.sqlite');
 const providers: CollectionProvider[] = [], contexts: ReturnType<typeof createNativeThingsPersistenceContext>[] = [];
 const open = async () => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(path)); providers.push(provider);
  const auth = await createNativeAccountCreationRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home'); contexts.push(context);
  return { provider, run: <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work)) };
 };
 t.after(async () => { contexts.forEach(context => context.close()); await Promise.all(providers.map(provider => provider.close())); await rm(directory, { recursive: true, force: true }); });
 const first = await open();
 const account = async (username: string) => first.run(async () => {
  const result = await createUserAccount({ username, password: 'Disposable isolated fixture phrase', email: `${username}@example.invalid` });
  assert.equal(result.ok, true); return result.publicUser;
 });
 const owner = await account('workspace-owner');
 assert.equal((await first.run(() => initializeWorkspace(owner, { rootId, name: 'Local service', timeZone: 'UTC' }))).ok, true);
 const save = async (kind: ServiceKind, id: string, values: Record<string, unknown>) => first.run(() => saveWorkspaceRecord(owner, { rootId, kind, id, values }));
 const raw = (id: string) => first.run(() => getBoundThingsPersistence(null)!.readExact(id));
 return { ...first, account, owner, save, raw, open };
}

test('canonical native workspace setup preserves every read role, scoped page, linked customer and fresh revocation', async t => {
 const f = await fixture(t);
 const customer = await f.account('workspace-customer'), b2b = await f.account('workspace-b2b'), employee = await f.account('workspace-employee'), lopu = await f.account('workspace-lopu'), admin = await f.account('workspace-admin'), outsider = await f.account('workspace-outsider');
 await f.save('customer', 'customer-one', { firstName: 'One' }); await f.save('customer', 'customer-two', { firstName: 'Two' });
 await f.save('address', 'address-one', { title: 'One', address: '1 Local Street' }); await f.save('address', 'address-two', { title: 'Two', address: '2 Local Street' });
 await f.save('link', 'link-one', { customerId: 'customer-one', addressId: 'address-one' }); await f.save('link', 'link-two', { customerId: 'customer-two', addressId: 'address-two' });
 await f.save('job', 'job-one', { title: 'One', addressId: 'address-one' }); await f.save('job', 'job-two', { title: 'Two', addressId: 'address-two' });
 await f.save('visit', 'visit-one', { title: 'One', jobId: 'job-one', date: '2026-11-12' }); await f.save('visit', 'visit-two', { title: 'Two', jobId: 'job-two', date: '2026-11-12' });
 await f.save('equipment', 'equipment-one', { title: 'Private equipment' });
 const members = new Map<string, string>();
 for (const [user, role, customerId] of [[customer, 'Customer', 'customer-one'], [b2b, 'B2B', 'customer-two'], [employee, 'Employee', ''], [lopu, 'Lopu', ''], [admin, 'Admin', '']] as const) {
  const member = await f.save('member', `requested-${user.id}`, { username: user.username, role, customerId }); members.set(user.id, member.id);
 }
 await f.run(async () => {
  const result = await createThing(f.owner.id, { shareId: 'workspace-page', thingtime: ['webpage'], crystal: { name: 'Workspace', blocks: [] }, acl: ['tt:user'] }); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await bindWorkspacePage(f.owner, { rootId, pageId: 'workspace-page' })).ok, true);
  const publicLookalike = await createThing(f.owner.id, { shareId: 'public-lookalike', thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'address', values: { title: 'Public lookalike' } }, acl: ['tt:all'] }); assert.equal(publicLookalike.ok, true);
 });
 await f.run(async () => {
  const result = await createThing(outsider.id, { shareId: 'foreign-lookalike', thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'address', values: { title: 'Foreign owner' } }, acl: ['tt:user', 'tt:custom', 'tt:service-workspace'] }); assert.equal(result.ok, true);
 });
 const customerViewer = viewerOf(customer);
 const verify = async (run: typeof f.run) => run(async () => {
  const owner = await loadWorkspaceAccess(rootId, viewerOf(f.owner)); assert.equal(owner?.role, 'Admin'); assert.equal(owner?.visibleIds.has(members.get(employee.id)!), true);
  for (const user of [employee, lopu, admin]) {
   const access = await loadWorkspaceAccess(rootId, viewerOf(user)); assert.ok(access); assert.equal(access.visibleIds.has('equipment-one'), true);
   assert.equal(access.visibleIds.has(members.get(customer.id)!), user.id === admin.id);
  }
  for (const [user, mine, denied] of [[customer, 'one', 'two'], [b2b, 'two', 'one']] as const) {
   const access = await loadWorkspaceAccess(rootId, viewerOf(user)); assert.ok(access);
   for (const kind of ['customer', 'address', 'job', 'visit', 'link']) assert.equal(access.visibleIds.has(`${kind}-${mine}`), true);
   assert.equal(access.visibleIds.has(`address-${denied}`), false); assert.equal(access.visibleIds.has('equipment-one'), false); assert.equal(access.visibleIds.has('public-lookalike'), false); assert.equal(access.visibleIds.has('foreign-lookalike'), false);
  }
  const page = await getBoundThingsPersistence(null)!.readExact('workspace-page'); assert.ok(page); assert.equal(workspaceRootFor(page), rootId);
  assert.equal(await serviceWorkspaceCanRead(page as any, customerViewer), true); assert.equal(await serviceWorkspaceCanRead(page as any, viewerOf(outsider)), false);
  assert.equal((await resolveWebpage(customerViewer, { id: 'workspace-page' })).ok, true);
  assert.equal((await resolveWebpage(viewerOf(outsider), { id: 'workspace-page' })).ok, false);
  for (const id of ['public-lookalike', 'foreign-lookalike']) assert.equal(await serviceWorkspaceCanRead((await getBoundThingsPersistence(null)!.readExact(id)) as any, customerViewer), false);
  assert.equal(await loadWorkspaceAccess(rootId, { ...customerViewer, pat: {} as NonNullable<NonNullable<Viewer>['pat']> }), null);
  assert.equal(await loadWorkspaceAccess(rootId, null), null);
  await assert.rejects(saveWorkspaceRecord(customer, { rootId, kind: 'customer', id: 'denied', values: { firstName: 'Denied' } }), (error: any) => error.status === 403);
  assert.equal((await saveWorkspaceRecord(employee, { rootId, kind: 'customer', id: 'employee-created', values: { firstName: 'Delegated' } })).ok, true);
  await assert.rejects(readWorkspace(f.owner, rootId), (error: any) => error.status === 503);
 });
 await verify(f.run);
 const memberId = members.get(customer.id)!;
 await f.run(async () => {
  const first = await loadWorkspaceAccess(rootId, customerViewer);
  assert.equal(await loadWorkspaceAccess(rootId, { ...customerViewer }), first);
  const concurrent = await Promise.all([loadWorkspaceAccess(rootId, customerViewer), loadWorkspaceAccess(rootId, { ...customerViewer })]);
  assert.equal(concurrent[0], first); assert.equal(concurrent[1], first);
 });
 await f.run(async () => {
  const duplicate = await createThing(f.owner.id, { shareId: 'ambiguous-member', thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'member', values: { userId: customer.id, role: 'Admin' } }, acl: ['tt:user'] }); assert.equal(duplicate.ok, true);
  assert.equal(await loadWorkspaceAccess(rootId, customerViewer), null);
  assert.equal((await deleteThing(f.owner.id, 'ambiguous-member')).ok, true);
  assert.ok(await loadWorkspaceAccess(rootId, customerViewer));
 });
 for (const [target, status] of [[rootId, 'blocked'], [rootId, 'pending'], [memberId, 'blocked'], [memberId, 'pending'], ['address-one', 'blocked'], ['address-one', 'pending']] as const) {
  await f.run(async () => {
   assert.ok(await loadWorkspaceAccess(rootId, customerViewer));
   await assert.rejects(getBoundThingsPersistence(f.owner.id)!.transaction('write', async tx => {
    // Actual semantic control-state mutation inside a rollback-only test.
    const before = (await tx.readExact(target))!;
    assert.equal(await tx.compareAndSwap({ id: target, identity: before._id, updatedAt: before.updatedAt }, { ...before, moderation: { status } }), true);
    const customerAccess = await loadWorkspaceAccess(rootId, customerViewer);
    if (target === rootId || target === memberId) assert.equal(customerAccess, null);
    else { assert.ok(customerAccess); assert.equal(customerAccess.visibleIds.has('address-one'), false); }
    const ownerAccess = await loadWorkspaceAccess(rootId, viewerOf(f.owner));
    if (target === rootId && status === 'blocked') assert.equal(ownerAccess, null);
    else assert.ok(ownerAccess);
    throw Error('rollback moderation check');
   }), /rollback moderation check/);
   assert.ok(await loadWorkspaceAccess(rootId, customerViewer));
  });
 }
 await f.run(async () => {
  assert.equal((await loadWorkspaceAccess(rootId, customerViewer))?.visibleIds.has('address-one'), true);
  await assert.rejects(getBoundThingsPersistence(f.owner.id)!.transaction('write', async tx => {
   const before = (await tx.readExact('link-one'))!;
   assert.equal(await tx.compareAndSwap({ id: before.shareId, identity: before._id, updatedAt: before.updatedAt }, { ...before, crystal: { ...before.crystal, values: { ...before.crystal.values, archived: true } } }), true);
   assert.equal((await loadWorkspaceAccess(rootId, customerViewer))?.visibleIds.has('address-one'), false);
   throw Error('rollback link check');
  }), /rollback link check/);
  assert.equal((await loadWorkspaceAccess(rootId, customerViewer))?.visibleIds.has('address-one'), true);
  const link = (await getBoundThingsPersistence(null)!.readExact('link-one'))!;
  await archiveWorkspaceRecord(f.owner, { rootId, id: 'link-one', expectedUpdatedAt: link.updatedAt.toISOString() });
  assert.equal((await loadWorkspaceAccess(rootId, customerViewer))?.visibleIds.has('address-one'), false);
  const archived = (await getBoundThingsPersistence(null)!.readExact('link-one'))!;
  await archiveWorkspaceRecord(f.owner, { rootId, id: 'link-one', expectedUpdatedAt: archived.updatedAt.toISOString(), archived: false });
  assert.equal((await loadWorkspaceAccess(rootId, customerViewer))?.visibleIds.has('address-one'), true);
 });
 await f.run(async () => {
  assert.ok(await loadWorkspaceAccess(rootId, customerViewer));
  const before = (await getBoundThingsPersistence(null)!.readExact(memberId))!;
  await assert.rejects(getBoundThingsPersistence(f.owner.id)!.transaction('write', async tx => {
   // Controlled semantic transaction change, not account/workspace setup.
   const after = { ...before, crystal: { ...before.crystal, values: { ...before.crystal.values, archived: true } } };
   assert.equal(await tx.compareAndSwap({ id: memberId, identity: before._id, updatedAt: before.updatedAt }, after), true);
   assert.equal(await loadWorkspaceAccess(rootId, customerViewer), null);
   throw Error('rollback membership check');
  }), /rollback membership check/);
  assert.ok(await loadWorkspaceAccess(rootId, customerViewer));
 });
 const member = (await f.raw(memberId))!;
 await f.run(() => archiveWorkspaceRecord(f.owner, { rootId, id: memberId, expectedUpdatedAt: member.updatedAt.toISOString() }));
 await f.run(async () => { assert.equal(await loadWorkspaceAccess(rootId, customerViewer), null); assert.equal(await serviceWorkspaceCanRead((await getBoundThingsPersistence(null)!.readExact('workspace-page')) as any, customerViewer), false); assert.equal((await resolveWebpage(customerViewer, { id: 'workspace-page' })).ok, false); });
 await f.provider.close(); const reopened = await f.open();
 await reopened.run(async () => { assert.equal(await loadWorkspaceAccess(rootId, customerViewer), null); assert.equal((await loadWorkspaceAccess(rootId, viewerOf(employee)))?.role, 'Employee'); });
});

test('canonical native workspace reads traverse membership and linked-property batches without truncation', async t => {
 const f = await fixture(t), customer = await f.account('many-links-customer');
 await f.save('customer', 'many-customer', { firstName: 'Many' });
 for (let index = 0; index < 130; index++) {
  await f.save('address', `address-${index}`, { title: `Address ${index}`, address: `${index} Local Street` });
  await f.save('link', `link-${index}`, { customerId: 'many-customer', addressId: `address-${index}` });
 }
 // These are owner-authored generic Data through the canonical content writer,
 // not raw database seeds or a claim of verified accounts for filler identities.
 for (let index = 0; index < 130; index++) await f.run(async () => {
  const result = await createThing(f.owner.id, { shareId: `filler-member-${index}`, thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'member', values: { userId: `not-an-account-${index}`, role: 'Employee' } }, acl: ['tt:user'] }); assert.equal(result.ok, true);
 });
 await f.save('member', 'requested-customer-member', { username: customer.username, role: 'Customer', customerId: 'many-customer' });
 await f.run(async () => {
  const access = await loadWorkspaceAccess(rootId, viewerOf(customer)); assert.ok(access); assert.equal(access.records.filter(row => row.kind === 'member').length, 132);
  assert.equal([...access.visibleIds].filter(id => id.startsWith('address-')).length, 130);
  assert.equal([...access.visibleIds].filter(id => id.startsWith('link-')).length, 130);
  assert.equal(access.visibleIds.has('address-129'), true);
 });
});

test('canonical native delegated writes fence live roles and scopes with owner accounting and actual actor History', async t => {
 const f = await fixture(t), employee = await f.account('write-employee'), admin = await f.account('write-admin'), customer = await f.account('write-customer'), outsider = await f.account('write-outsider');
 await f.save('customer', 'write-customer-record', { firstName: 'Account' });
 await f.save('address', 'write-address', { title: 'Property', address: '1 Local Street' });
 await f.save('job', 'write-job', { title: 'Job', addressId: 'write-address' });
 await f.save('visit', 'write-visit', { title: 'Visit', jobId: 'write-job', date: '2026-11-12' });
 const employeeMember = await f.save('member', 'employee', { username: employee.username, role: 'Employee' });
 await f.save('member', 'admin', { username: admin.username, role: 'Admin' });
 await f.save('member', 'customer', { username: customer.username, role: 'Customer', customerId: 'write-customer-record' });
 const saveAs = (user: PublicUser, kind: ServiceKind, id: string, values: Record<string, unknown>, expectedUpdatedAt?: string) => f.run(() => saveWorkspaceRecord(user, { rootId, kind, id, values, expectedUpdatedAt }));
 const headActor = async (id: string, actorId: string) => f.run(async () => {
  const row = (await getBoundThingsPersistence(null)!.readExact(id))!;
  assert.equal(row.ownerId, f.owner.id);
  await withBoundTimelineRead(f.owner.id, async port => assert.equal((await readTimelineEntries(port, f.owner.id, [row.timelineHeadId]))[0].event.actorId, actorId));
 });
 assert.equal((await saveAs(employee, 'customer', 'delegated-record', { firstName: 'Created' })).ok, true);
 await headActor('delegated-record', employee.id);
 let record = (await f.raw('delegated-record'))!;
 assert.equal(record.crystal.values.createdBy, employee.id);
 assert.equal((await saveAs(employee, 'customer', 'delegated-record', { firstName: 'Edited' }, record.updatedAt.toISOString())).ok, true);
 await headActor('delegated-record', employee.id);
 record = (await f.raw('delegated-record'))!;
 assert.equal((await f.run(() => archiveWorkspaceRecord(employee, { rootId, id: record.shareId, expectedUpdatedAt: record.updatedAt.toISOString() }))).ok, true);
 await headActor('delegated-record', employee.id);
 const visit = (await f.raw('write-visit'))!;
 assert.equal((await f.run(() => moveWorkspaceVisit(employee, { rootId, id: visit.shareId, expectedUpdatedAt: visit.updatedAt.toISOString(), date: '2026-11-13', time: '10:30', order: 17 }))).ok, true);
 await headActor('write-visit', employee.id);
 assert.equal((await saveAs(employee, 'job', 'employee-job', { title: 'Employee job', addressId: 'write-address' })).ok, true);
 assert.equal((await saveAs(employee, 'visit', 'employee-visit', { title: 'Employee visit', jobId: 'employee-job', date: '2026-11-14' })).ok, true);
 const employeeVisit = (await f.raw('employee-visit'))!;
 await headActor(employeeVisit.folderId, employee.id);
 assert.equal((await saveAs(employee, 'time', 'employee-time', { visitId: 'employee-visit', title: 'Work', minutes: 10 })).ok, true);
 const employeeTime = (await f.raw('employee-time'))!;
 await headActor(employeeTime.folderId, employee.id);
 assert.equal((await saveAs(employee, 'visit', 'employee-visit', { title: 'Moved visit', jobId: 'write-job', date: '2026-11-14' }, (await f.raw('employee-visit'))!.updatedAt.toISOString())).ok, true);
 assert.equal((await f.raw(employeeTime.folderId))!.folderId, (await f.raw('employee-visit'))!.folderId);
 assert.equal((await saveAs(admin, 'member', 'employee', { username: employee.username, role: 'Lopu' }, (await f.raw(employeeMember.id))!.updatedAt.toISOString())).ok, true);
 await headActor(employeeMember.id, admin.id);
 await assert.rejects(saveAs(employee, 'member', 'not-allowed', { username: customer.username, role: 'Admin' }), (error: any) => error.status === 403);
 await assert.rejects(saveAs(customer, 'customer', 'customer-denied', { firstName: 'Denied' }), (error: any) => error.status === 403);
 await assert.rejects(saveAs(outsider, 'customer', 'outsider-denied', { firstName: 'Denied' }), (error: any) => error.status === 404);

 await f.run(async () => {
  const planned = await workspaceAccess(employee, rootId), values = { title: 'Stale reference', addressId: 'write-address' };
  const hooks = workspaceWriteHooks(employee, planned, 'job', 'stale-reference-job', values);
  const address = (await getBoundThingsPersistence(null)!.readExact('write-address'))!;
  await archiveWorkspaceRecord(f.owner, { rootId, id: address.shareId, expectedUpdatedAt: address.updatedAt.toISOString() });
  const ledger = (await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', f.owner.id)))!;
  await assert.rejects(createThing(f.owner.id, { shareId: 'stale-reference-job', thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'job', values }, acl: ['tt:user', 'tt:custom', 'tt:service-workspace'], folderId: planned.config.folders.job }, null, null, hooks.create), (error: any) => error.status === 400);
  assert.equal(await getBoundThingsPersistence(null)!.readExact('stale-reference-job'), null);
  assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', f.owner.id)), ledger);
  const archived = (await getBoundThingsPersistence(null)!.readExact('write-address'))!;
  await archiveWorkspaceRecord(f.owner, { rootId, id: archived.shareId, expectedUpdatedAt: archived.updatedAt.toISOString(), archived: false });
 });

 await f.run(async () => {
  const planned = await workspaceAccess(employee, rootId);
  const hooks = workspaceWriteHooks(employee, planned, 'customer', 'revoked-create', { firstName: 'Must roll back' });
  const member = (await getBoundThingsPersistence(null)!.readExact(employeeMember.id))!;
  await archiveWorkspaceRecord(f.owner, { rootId, id: member.shareId, expectedUpdatedAt: member.updatedAt.toISOString() });
  const ledger = (await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', f.owner.id)))!;
  const root = (await getBoundThingsPersistence(null)!.readExact(rootId))!;
  await assert.rejects(createThing(f.owner.id, { shareId: 'revoked-create', thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'customer', values: { firstName: 'Must roll back' } }, acl: ['tt:user', 'tt:custom', 'tt:service-workspace'], folderId: planned.config.folders.customer }, null, null, hooks.create), (error: any) => error.status === 404);
  assert.equal(await getBoundThingsPersistence(null)!.readExact('revoked-create'), null);
  assert.equal(await getBoundThingsPersistence(null)!.readExact(timelineEventThingId(f.owner.id, hooks.create.timelineCapture!.id)), null);
  assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', f.owner.id)), ledger);
  assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(rootId), root);
 });
 let member = (await f.raw(employeeMember.id))!;
 await f.run(() => archiveWorkspaceRecord(f.owner, { rootId, id: member.shareId, expectedUpdatedAt: member.updatedAt.toISOString(), archived: false }));
 await f.run(async () => {
  const planned = await workspaceAccess(employee, rootId), before = (await getBoundThingsPersistence(null)!.readExact('delegated-record'))!;
  const hooks = workspaceWriteHooks(employee, planned, 'customer', before.shareId, { firstName: 'Rollback update' });
  const ledger = (await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', f.owner.id)))!;
  await assert.rejects(updateThing(f.owner.id, before.shareId, { crystal: { values: { ...before.crystal.values, firstName: 'Rollback update' } } }, { expectedUpdatedAt: before.updatedAt.toISOString(), mutation: { ...hooks.update, afterWrite: async () => { throw Error('rollback delegated update'); } } }), /rollback delegated update/);
  assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(before.shareId), before);
  assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', f.owner.id)), ledger);
  assert.equal(await getBoundThingsPersistence(null)!.readExact(timelineEventThingId(f.owner.id, hooks.update.capture!.id)), null);
 });

 await f.run(async () => {
  const made = await createThing(outsider.id, { shareId: 'foreign-write-target', thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'customer', values: { firstName: 'Foreign' } }, acl: ['tt:user'] }); assert.equal(made.ok, true);
 });
 await f.run(async () => {
  const planned = await workspaceAccess(employee, rootId), before = (await getBoundThingsPersistence(null)!.readExact('foreign-write-target'))!;
  const hooks = workspaceWriteHooks(employee, planned, 'customer', before.shareId, { firstName: 'Forbidden' });
  await assert.rejects(updateThing(outsider.id, before.shareId, { crystal: { values: { firstName: 'Forbidden' } } }, { expectedUpdatedAt: before.updatedAt.toISOString(), mutation: hooks.update }), (error: any) => error.status === 404);
  assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(before.shareId), before);
 });
 const expired = await f.run(async () => workspaceWriteHooks(employee, await workspaceAccess(employee, rootId), 'customer', 'escaped-write', { firstName: 'Forbidden' }));
 const otherHandle = await f.open();
 await assert.rejects(otherHandle.run(() => createThing(f.owner.id, { shareId: 'escaped-write', thingtime: ['data'], crystal: { workspaceId: rootId, recordType: 'customer', values: { firstName: 'Forbidden' } }, acl: ['tt:user', 'tt:custom', 'tt:service-workspace'] }, null, null, expired.create)), (error: any) => error.status === 409);
 assert.equal(await f.raw('escaped-write'), null);
 member = (await f.raw(employeeMember.id))!;
 await f.run(() => archiveWorkspaceRecord(admin, { rootId, id: member.shareId, expectedUpdatedAt: member.updatedAt.toISOString() }));
 await assert.rejects(saveAs(employee, 'customer', 'fresh-revoked', { firstName: 'Forbidden' }), (error: any) => error.status === 404);
 await f.provider.close(); const reopened = await f.open();
 await reopened.run(async () => {
  const stored = (await getBoundThingsPersistence(null)!.readExact('delegated-record'))!; assert.equal(stored.crystal.values.firstName, 'Edited');
  assert.equal(await loadWorkspaceAccess(rootId, viewerOf(employee)), null);
  assert.equal(await getBoundThingsPersistence(null)!.readExact('revoked-create'), null);
 });
});
