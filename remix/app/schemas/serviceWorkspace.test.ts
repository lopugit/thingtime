import assert from 'node:assert/strict';
import test from 'node:test';
import { validateServiceValues, serviceVisibleIds, serviceWeekStart, serviceDateOffset, type ServiceRecord } from './serviceWorkspace';
const record = (id: string, kind: ServiceRecord['kind'], values = {}): ServiceRecord => ({ id, kind, values, updatedAt: 'now' });
test('calendar math survives month, leap-year and year boundaries', () => {
	assert.equal(serviceWeekStart('2026-01-04'), '2025-12-29');
	assert.equal(serviceDateOffset('2024-02-28', 1), '2024-02-29');
	assert.equal(serviceDateOffset('2025-02-28', 1), '2025-03-01');
	assert.throws(() => validateServiceValues('visit', { title: 'Mow', jobId: 'job', date: '2025-02-29' }), /valid date/);
});
test('time and resource fields reject invalid intervals, unsafe numbers and spoofed account fields', () => {
	assert.equal(validateServiceValues('time', { title: 'Mow', visitId: 'visit', from: '2026-01-01T23:30', to: '2026-01-02T00:30' }).minutes, 60);
	assert.throws(() => validateServiceValues('time', { title: 'Mow', visitId: 'visit', from: '2026-01-01T23:30' }), /both/);
	assert.throws(() => validateServiceValues('usage', { visitId: 'visit', equipmentId: 'tool', batteryPercent: 101 }), /range/);
	assert.throws(() => validateServiceValues('usage', { visitId: 'visit', equipmentId: 'tool', fuelLitres: Infinity }), /range/);
	assert.throws(() => validateServiceValues('member', { username: 'alice', role: 'Customer' }), /linked customer/);
	assert.equal(validateServiceValues('member', { username: 'alice', role: 'Employee', userId: 'spoof' }).userId, undefined);
});
test('customer projections follow only active customer-address links, and exclude staff records', () => {
	const records = [
		record('alice', 'customer'),
		record('bob', 'customer'),
		record('property', 'address'),
		record('private', 'address'),
		record('link', 'link', { customerId: 'alice', addressId: 'property' }),
		record('job', 'job', { addressId: 'property' }),
		record('visit', 'visit', { jobId: 'job' }),
		record('hidden', 'job', { addressId: 'private' }),
		record('staff', 'member'),
		record('time', 'time', { visitId: 'visit' })
	];
	for (const role of ['Customer', 'B2B'] as const)
		assert.deepEqual([...serviceVisibleIds(records, role, 'alice')].sort(), ['alice', 'property', 'link', 'job', 'visit'].sort());
	assert.ok(!serviceVisibleIds(records, 'Employee').has('staff'));
	assert.ok(serviceVisibleIds(records, 'Admin').has('staff'));
	records.find((r) => r.id === 'link')!.values.archived = true;
	assert.deepEqual([...serviceVisibleIds(records, 'Customer', 'alice')].sort(), ['alice', 'link']);
	assert.equal(serviceVisibleIds(records, null, 'alice').size, 0);
});

test('time logging uses the workspace zone across daylight-saving boundaries', () => {
	const fields = { title: 'Mow', visitId: 'visit', from: '2026-10-04T01:30', to: '2026-10-04T03:30' };
	assert.equal(validateServiceValues('time', fields, 'Australia/Melbourne').minutes, 60);
	assert.throws(() => validateServiceValues('time', { ...fields, from: '2026-10-04T02:30' }, 'Australia/Melbourne'), /clock change/);
	assert.throws(
		() => validateServiceValues('time', { ...fields, from: '2026-04-05T02:30', to: '2026-04-05T04:30' }, 'Australia/Melbourne'),
		/clock change/
	);
});
