import test from 'node:test';
import assert from 'node:assert/strict';
import { publicMailAddress, resolveMailHost } from './network';
test('mail transport rejects local, mapped private, metadata, multicast and reserved addresses', () => {
	for (const address of [
		'127.0.0.1',
		'10.0.0.1',
		'192.168.1.2',
		'172.16.0.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'224.0.0.1',
		'::1',
		'::',
		'fc00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
		'2001:db8::1'
	])
		assert.equal(publicMailAddress(address), false, address);
	assert.equal(publicMailAddress('1.1.1.1'), true);
	assert.equal(publicMailAddress('2606:4700:4700::1111'), true);
});
test('resolution rejects mixed DNS answers and returns the exact validated IP for pinning', async () => {
	const signal = new AbortController().signal;
	const resolver = async () => [
		{ address: '1.1.1.1', family: 4 },
		{ address: '127.0.0.1', family: 4 }
	];
	await assert.rejects(resolveMailHost('mail.example.com', signal, resolver as any), /public internet/);
	assert.deepEqual(await resolveMailHost('mail.example.com', signal, (async () => [{ address: '1.1.1.1', family: 4 }]) as any), {
		address: '1.1.1.1',
		family: 4
	});
});
test('DNS lookup honors cancellation', async () => {
	const abort = new AbortController();
	const pending = resolveMailHost('mail.example.com', abort.signal, (() => new Promise(() => {})) as any);
	abort.abort();
	await assert.rejects(pending, /timed out/);
});
