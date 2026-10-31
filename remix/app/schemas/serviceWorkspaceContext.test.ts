import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceWorkspaceContexts, serviceContextText } from './serviceWorkspaceContext';
import { serviceVisibleIds, type ServiceRecord } from './serviceWorkspace';
const record = (id: string, kind: ServiceRecord['kind'], values: Record<string, unknown> = {}): ServiceRecord => ({
	id,
	kind,
	values,
	updatedAt: 'now'
});

test('visit summaries follow the job property, active customer links, and assigned visit crew', () => {
	const records = [
		record('property', 'address', { title: 'Back garden', address: '1 Example Street' }),
		record('other-property', 'address', { title: 'Other property', address: '2 Example Street' }),
		record('alice', 'customer', { firstName: 'Alice', lastName: 'Green' }),
		record('bob', 'customer', { firstName: 'Bob', lastName: 'Green' }),
		record('link-a', 'link', { customerId: 'alice', addressId: 'property' }),
		record('link-b', 'link', { customerId: 'bob', addressId: 'property' }),
		record('duplicate-link', 'link', { customerId: 'alice', addressId: 'property' }),
		record('old-link', 'link', { customerId: 'alice', addressId: 'other-property', archived: true }),
		record('job', 'job', { addressId: 'property' }),
		record('other-job', 'job', { addressId: 'other-property' }),
		record('visit', 'visit', { jobId: 'job', employeeId: 'sam' }),
		record('later-visit', 'visit', { jobId: 'job', employeeId: 'lee' }),
		record('cancelled', 'visit', { jobId: 'job', employeeId: 'other', status: 'Cancelled' }),
		record('deleted', 'visit', { jobId: 'job', employeeId: 'other', archived: true })
	];
	const contexts = serviceWorkspaceContexts(records, [
		{ id: 'sam', name: 'Sam' },
		{ id: 'lee', name: 'Lee' },
		{ id: 'other', name: 'Other' }
	]);
	assert.deepEqual(contexts.get('visit'), {
		property: 'Back garden · 1 Example Street',
		customers: ['Alice Green', 'Bob Green'],
		crew: ['Sam'],
		assigned: true
	});
	assert.deepEqual(contexts.get('job')?.crew, ['Sam', 'Lee']);
	assert.deepEqual(contexts.get('other-job')?.customers, []);
	assert.match(serviceContextText(contexts.get('visit')), /Alice Green Bob Green Sam/);
	records.find((r) => r.id === 'visit')!.values.jobId = 'other-job';
	assert.deepEqual(serviceWorkspaceContexts(records).get('visit')?.customers, []);
});

test('restricted snapshots do not expose hidden customers, staff names or raw IDs', () => {
	const records = [
		record('alice', 'customer', { firstName: 'Alice' }),
		record('private-customer', 'customer', { firstName: 'Hidden customer' }),
		record('property', 'address', { title: '1 Example Street', address: '1 Example Street' }),
		record('link', 'link', { customerId: 'alice', addressId: 'property' }),
		record('private-link', 'link', { customerId: 'private-customer', addressId: 'property' }),
		record('job', 'job', { addressId: 'property' }),
		record('visit', 'visit', { jobId: 'job', employeeId: 'private-employee-id' }),
		record('unassigned', 'visit', { jobId: 'job' })
	];
	const visible = serviceVisibleIds(records, 'Customer', 'alice');
	const contexts = serviceWorkspaceContexts(records.filter((r) => visible.has(r.id)));
	assert.deepEqual(contexts.get('visit'), { property: '1 Example Street', customers: ['Alice'], crew: [], assigned: true });
	assert.equal(contexts.get('unassigned')?.assigned, false);
	assert.doesNotMatch(serviceContextText(contexts.get('visit')), /Hidden|private-/);
	assert.equal(serviceWorkspaceContexts([record('missing', 'visit', { jobId: 'removed' })]).get('missing')?.property, 'Property unavailable');
});
