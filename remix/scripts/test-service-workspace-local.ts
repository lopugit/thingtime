// Opt-in integration smoke against an isolated, loopback-only Mongo replica.
// Never point this at a shared development or production database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createUserAccount } from '../app/api/utils/auth/registerUser';
import {
	initializeWorkspace,
	saveWorkspaceRecord,
	readWorkspace,
	archiveWorkspaceRecord,
	moveWorkspaceVisit,
	bindWorkspacePage
} from '../app/api/utils/serviceWorkspaces/workspaces';
import { createThing, getThing, updateThing, addComment } from '../app/api/utils/things/things';
import { createUserVaultGroup, saveUserVaultSecret, moveUserVaultEntry, revealUserVaultValue } from '../app/api/utils/lopu/userVault';
async function main() {
	assert.equal(process.env.TT_SERVICE_TEST_LOCAL, '1', 'Set TT_SERVICE_TEST_LOCAL=1 for this opt-in test');
	assert.match(
		process.env.MONGODB_CONNECTION_STRING || '',
		/^mongodb:\/\/127\.0\.0\.1:18943\/\?replicaSet=jimsLocal$/,
		'Use the dedicated local test replica only'
	);
	const suffix = randomUUID().slice(0, 8);
	const users: any = {};
	for (const role of ['owner', 'employee', 'customer', 'b2b', 'lopu', 'stranger']) {
		const response = await createUserAccount({
			username: `jims-${role}-${suffix}`,
			password: 'Local-franchise-QA-2026!',
			email: `${role}-${suffix}@example.invalid`,
			emailVerified: true,
			publicUploads: true,
			privateUploads: true
		});
		assert.equal(response.ok, true, JSON.stringify(response));
		if (response.ok) users[role] = response.publicUser;
	}
	const rootId = randomUUID();
	await initializeWorkspace(users.owner, { rootId, name: 'Jim’s Mowing', timeZone: 'Australia/Melbourne' });
	const save = async (kind: string, values: any, actor = users.owner, extras = {}) =>
		saveWorkspaceRecord(actor, { rootId, id: randomUUID(), kind, values, ...extras });
	const snapshot = () => readWorkspace(users.owner, rootId);
	const ownerMember = (await snapshot()).records.find((r: any) => r.kind === 'member' && r.values.userId === users.owner.id)!;
	assert.ok(ownerMember, 'owner is assignable as an Admin');
	await assert.rejects(
		archiveWorkspaceRecord(users.owner, { rootId, id: ownerMember.id, expectedUpdatedAt: ownerMember.updatedAt }),
		/owner is always/
	);
	const a = await save('customer', { firstName: 'Alex', lastName: 'Green', email: 'alex@example.invalid', phone: '0400 000 000' });
	const b = await save('customer', { firstName: 'Sam', lastName: 'River' });
	const address = await save('address', {
		title: 'Library gardens',
		address: '328 Swanston Street, Melbourne VIC 3000',
		description: 'Local QA sample property.'
	});
	const hidden = await save('address', { title: 'Other account property', address: 'Test street' });
	await save('link', { customerId: a.id, addressId: address.id });
	const job = await save('job', { title: 'Lawn & edges', addressId: address.id, estimatedMinutes: 60 });
	const visit = await save('visit', { title: 'Lawn & edges', jobId: job.id, date: '2026-09-21', time: '09:00', status: 'Scheduled' });
	const subjob = await save('subjob', { title: 'Edging', jobId: job.id, estimatedMinutes: 15 });
	const tool = await save('equipment', { title: 'Battery mower', category: 'Tool' });
	const battery = await save('equipment', { title: '56V battery', category: 'Battery' });
	const vehicle = await save('equipment', { title: 'Work ute', category: 'Vehicle' });
	const members: any = {};
	for (const [kind, role] of [
		['employee', 'Employee'],
		['customer', 'Customer'],
		['b2b', 'B2B'],
		['lopu', 'Lopu']
	])
		members[kind] = await save('member', {
			username: users[kind].username,
			role,
			...(['Customer', 'B2B'].includes(role) ? { customerId: a.id } : {})
		});
	await save('time', { title: 'Edging', visitId: visit.id, subjobId: subjob.id, employeeId: members.employee.id, minutes: 15 }, users.employee);
	await save(
		'usage',
		{
			visitId: visit.id,
			equipmentId: tool.id,
			batteryId: battery.id,
			batteryPercent: 30,
			vehicleId: vehicle.id,
			fuelLitres: 1.2,
			employeeId: members.employee.id
		},
		users.lopu
	);
	const customerData = await readWorkspace(users.customer, rootId);
	assert.ok(customerData.records.some((r: any) => r.id === visit.id));
	for (const id of [b.id, hidden.id, tool.id, members.employee.id]) assert.ok(!customerData.records.some((r: any) => r.id === id));
	assert.equal((await getThing(users.customer, address.id)).ok, true, 'linked property supports generic read');
	assert.equal((await getThing(users.customer, hidden.id)).ok, false, 'unlinked property denied');
	assert.equal((await getThing(users.stranger, address.id)).ok, false, 'stranger denied');
	assert.equal((await updateThing(users.owner.id, address.id, { acl: ['tt:user'] })).ok, true);
	const privatelyScoped = await readWorkspace(users.customer, rootId);
	for (const id of [address.id, job.id, visit.id])
		assert.ok(!privatelyScoped.records.some((r: any) => r.id === id), 'explicit private ACL fences dependent customer records');
	assert.equal((await getThing(users.customer, address.id)).ok, false);
	assert.equal((await updateThing(users.owner.id, address.id, { acl: ['tt:user', 'tt:custom', 'tt:service-workspace'] })).ok, true);
	assert.equal(
		(await updateThing(users.employee, job.id, { crystal: { values: { title: 'bypass' } } })).ok,
		false,
		'generic edit cannot bypass workspace validation'
	);
	await assert.rejects(save('member', { username: users.stranger.username, role: 'Admin' }, users.employee), /role cannot/);
	await assert.rejects(save('job', { title: 'Nope', addressId: address.id }, users.customer), /role cannot/);
	await assert.rejects(save('job', { title: 'Cross workspace', addressId: randomUUID() }), /Choose a address/);
	await assert.rejects(save('usage', { visitId: visit.id, equipmentId: tool.id, batteryId: vehicle.id }), /Choose a battery/);
	const comment = await addComment(users.customer, address.id, { text: 'Test access note', shareId: randomUUID() });
	assert.equal(comment.ok, true, 'customer can comment on linked property');
	const beforeMove = (await snapshot()).records.find((r: any) => r.id === visit.id)!;
	await moveWorkspaceVisit(users.employee, {
		rootId,
		id: visit.id,
		date: '2026-09-22',
		time: '10:00',
		order: 1024,
		expectedUpdatedAt: beforeMove.updatedAt
	});
	await assert.rejects(
		moveWorkspaceVisit(users.employee, { rootId, id: visit.id, date: '2026-09-23', order: 1024, expectedUpdatedAt: beforeMove.updatedAt }),
		/changed/
	);
	const pageId = randomUUID();
	const page = await createThing(users.owner.id, {
		shareId: pageId,
		thingtime: ['webpage'],
		acl: ['tt:user'],
		crystal: {
			title: 'Jim’s Mowing',
			name: 'Jim’s Mowing',
			pageKey: `jims-test-${suffix}`,
			version: 4,
			blocks: [{ id: 'franchise', type: 'html', html: `<tt-service-workspace rootId="${rootId}" name="Jim’s Mowing"></tt-service-workspace>` }]
		}
	});
	assert.equal(page.ok, true, JSON.stringify(page));
	await bindWorkspacePage(users.owner, { rootId, pageId });
	assert.equal((await getThing(users.customer, pageId)).ok, true, 'bound page visible to member');
	const membership = (await snapshot()).records.find((r: any) => r.id === members.customer.id)!;
	await archiveWorkspaceRecord(users.owner, { rootId, id: membership.id, expectedUpdatedAt: membership.updatedAt });
	assert.equal((await getThing(users.customer, address.id)).ok, false, 'revocation applies to generic things');
	assert.equal((await getThing(users.customer, pageId)).ok, false, 'revocation applies to page');
	await assert.rejects(readWorkspace(users.customer, rootId), /revoked/);
	const group = await createUserVaultGroup(users.owner.id, { name: 'Production' });
	const secret = await saveUserVaultSecret(users.owner.id, { name: 'Test token', key: 'QA_TOKEN', value: 'synthetic-local-value' });
	assert.equal((await moveUserVaultEntry(users.owner.id, { id: secret.id, groupId: group.id })).groupId, group.id);
	assert.equal(await revealUserVaultValue(users.owner.id, secret.id), 'synthetic-local-value');
	await assert.rejects(moveUserVaultEntry(users.stranger.id, { id: secret.id, groupId: null }), /not found/);
	await moveUserVaultEntry(users.owner.id, { id: secret.id, groupId: null });
	assert.equal(await revealUserVaultValue(users.owner.id, secret.id), 'synthetic-local-value');
	await writeFile(
		'/tmp/thingtime-jims-local-fixture.json',
		JSON.stringify({ rootId, pageId, pageKey: `jims-test-${suffix}`, username: users.owner.username }, null, 2),
		{ mode: 0o600 }
	);
	console.log(
		'PASS: relational records, role isolation, generic ACLs, revocation, comments, CAS scheduling, resource validation, Vault environment moves'
	);
	console.log(`Local browser fixture: /p/${pageId}`);
}
main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
