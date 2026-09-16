import assert from 'node:assert/strict';
import test from 'node:test';
import { inviteToken, inviteTokenHash, inviteAmount, inviteProfile, inviteExpiry } from './inviteCore';
import { capabilitySatisfies, thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';
import { isProtectedThingtime } from '~/schemas/registry';
test('invite tokens have 256 bits of entropy and only fixed-shape tokens are accepted', () => {
	const token = inviteToken();
	assert.equal(token.length, 43);
	assert.notEqual(token, inviteToken());
	assert.equal(inviteTokenHash(token).length, 64);
	assert.notEqual(inviteTokenHash(token), token);
	for (const invalid of ['', null, {}, 'x'.repeat(10000), 'a/b'.repeat(14)]) assert.throws(() => inviteTokenHash(invalid));
});
test('gift amounts preserve micros and reject negative, non-finite and precision-losing values', () => {
	assert.equal(inviteAmount(0), 0);
	assert.equal(inviteAmount(0.000001), 1);
	assert.equal(inviteAmount(2.345678), 2345678);
	for (const amount of [-1, Infinity, NaN, '10', 10001, 0.0000001, null]) assert.throws(() => inviteAmount(amount));
});
test('profile suggestions cannot carry ACL separators or privileges', () => {
	assert.deepEqual(inviteProfile({ username: ' Friend.One ', displayName: ' Friend ', admin: true }), {
		username: 'friend.one',
		displayName: 'Friend'
	});
	for (const username of ['x/write', 'x', '', '<script>', 'a'.repeat(41)]) assert.throws(() => inviteProfile({ username, displayName: 'Friend' }));
	assert.throws(() => inviteProfile({ username: 'friend', displayName: 'a'.repeat(101) }));
	assert.ok(isProtectedThingtime(['account-invite']));
});
test('invites and invite-aware signup have explicit capability contracts', () => {
	const manifest = thingtimeCapabilityManifest('https://thingtime.example');
	assert.equal(manifest.features['api.auth-invites'].version, '2.1.0');
	assert.ok(capabilitySatisfies(manifest.features['api.auth-register'].version, '1.3.0'));
	assert.equal(capabilitySatisfies('1.1.0', '1.2.0'), false);
	assert.equal(capabilitySatisfies('2.0.0', '1.2.0'), false);
});

test('expiry defaults to never and only accepts supported durations', () => {
	assert.equal(inviteExpiry(undefined), null);
	assert.equal(inviteExpiry(null), null);
	for (const days of [1, 7, 30, 90]) assert.equal(inviteExpiry(days, 0)?.getTime(), days * 86400000);
	for (const invalid of [0, -1, '7', 1.5, 365, {}, Infinity]) assert.throws(() => inviteExpiry(invalid));
	assert.equal(capabilitySatisfies('1.0.1', '2.0.0'), false);
	assert.equal(capabilitySatisfies('2.1.0', '2.0.0'), true);
});

test('PNG invite clients require compatible thumbnail payload capabilities', () => {
 const manifest = thingtimeCapabilityManifest('https://thingtime.example');
 for (const [feature, minimum, old, breaking, newer] of [
  ['api.auth-invites', '2.1.0', '2.0.0', '3.0.0', '2.2.0'],
  ['api.auth-register', '1.3.0', '1.2.0', '2.0.0', '1.4.0']
 ]) {
  assert.equal(capabilitySatisfies(manifest.features[feature].version, minimum), true);
  assert.equal(capabilitySatisfies(newer, minimum), true);
  for (const unavailable of [undefined, old, breaking]) assert.equal(capabilitySatisfies(unavailable, minimum), false);
 }
});
