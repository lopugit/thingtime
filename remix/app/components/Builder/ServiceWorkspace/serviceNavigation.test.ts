import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_TRAIL, popTrail, pushTrail, serviceParentRecordId } from './serviceNavigation';

test('opening related records builds a back trail without duplicates or self-links', () => {
	let trail = pushTrail([], null, 'property');
	assert.deepEqual(trail, [], 'opening from a list has nothing to return to');
	trail = pushTrail(trail, 'property', 'job');
	trail = pushTrail(trail, 'job', 'visit');
	assert.deepEqual(trail, ['property', 'job']);
	assert.deepEqual(pushTrail(trail, 'visit', 'visit'), trail, 're-opening the current record is a no-op');
	assert.deepEqual(pushTrail(trail, 'visit', 'property'), ['job', 'visit'], 'jumping back to an earlier record drops the loop');
	let long: string[] = [];
	for (let index = 0; index < MAX_TRAIL + 5; index += 1) long = pushTrail(long, `r${index}`, `r${index + 1}`);
	assert.equal(long.length, MAX_TRAIL);
});

test('back skips records that no longer exist and ends on the list', () => {
	const exists = (id: string) => id !== 'deleted';
	assert.deepEqual(popTrail(['property', 'deleted'], exists), { trail: [], id: 'property' });
	assert.deepEqual(popTrail(['property', 'job'], exists), { trail: ['property'], id: 'job' });
	assert.deepEqual(popTrail([], exists), { trail: [], id: null });
	assert.deepEqual(popTrail(['deleted'], exists), { trail: [], id: null });
});

test('new child records return to the parent they were added from', () => {
	assert.equal(serviceParentRecordId('time', { visitId: 'visit-1' }, 'visit-1'), 'visit-1');
	assert.equal(serviceParentRecordId('usage', { visitId: 'visit-1' }, null), 'visit-1');
	assert.equal(serviceParentRecordId('subjob', { jobId: 'job-1' }, 'job-1'), 'job-1');
	assert.equal(serviceParentRecordId('link', { customerId: 'c1', addressId: 'a1' }, 'c1'), 'c1', 'linking from the customer page stays there');
	assert.equal(serviceParentRecordId('link', { customerId: 'c1', addressId: 'a1' }, 'a1'), 'a1', 'linking from the property page stays there');
	assert.equal(serviceParentRecordId('link', { customerId: 'c1', addressId: 'a1' }, null), 'a1');
	for (const kind of ['customer', 'address', 'job', 'visit', 'equipment', 'member'] as const) {
		assert.equal(serviceParentRecordId(kind, { visitId: 'visit-1', jobId: 'job-1' }, 'visit-1'), null, `${kind} opens its own page`);
	}
	assert.equal(serviceParentRecordId('time', { visitId: '' }, null), null);
});
