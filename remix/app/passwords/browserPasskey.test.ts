import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { createBrowserPasskeyAssertion, passkeyBase64url, passkeyBytes, prepareBrowserPasskeyRegistration, validateBrowserPasskeyRequest, type BrowserPasskeyRequest } from './browserPasskey';

const crypto = webcrypto as unknown as Crypto;
const challenge = passkeyBase64url(crypto.getRandomValues(new Uint8Array(32)));
const create = (): BrowserPasskeyRequest => ({ type: 'create', origin: 'https://login.example.com', publicKey: { challenge, rp: { id: 'example.com', name: 'Fixture' }, user: { id: 'AQID', name: 'fixture', displayName: 'Fixture account' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { userVerification: 'required', residentKey: 'required' }, attestation: 'none' } });
const get = (): BrowserPasskeyRequest => ({ type: 'get', origin: 'https://login.example.com', publicKey: { challenge, rpId: 'example.com', userVerification: 'required' } });
const errorName = (name: string) => (error: unknown) => error instanceof DOMException && error.name === name;

test('independent WebAuthn server accepts registration and actual assertion signatures', async () => {
  const registration = await prepareBrowserPasskeyRegistration(create(), true, [], crypto);
  const verified = await verifyRegistrationResponse({ response: registration.response as any, expectedChallenge: challenge, expectedOrigin: create().origin, expectedRPID: 'example.com', requireUserVerification: true });
  assert.equal(verified.verified, true);
  const info = verified.registrationInfo; if (!info) throw new Error('Independent verifier returned no registration information.');
  assert.equal(info.credentialDeviceType, 'multiDevice');
  assert.equal(info.credentialBackedUp, true);
  assert.equal(registration.entry.fields.find(field => field.id === 'privateKey')?.concealed, true);
  assert.equal(registration.entry.fields.find(field => field.id === 'privateKey')?.type, 'password');
  const assertion = await createBrowserPasskeyAssertion(registration.entry, get(), true, crypto);
  assert.equal(JSON.stringify(assertion).includes(registration.entry.fields.find(field => field.id === 'privateKey')!.value), false);
  const checked = await verifyAuthenticationResponse({ response: assertion as any, expectedChallenge: challenge, expectedOrigin: get().origin, expectedRPID: 'example.com', requireUserVerification: true, credential: info.credential });
  assert.equal(checked.verified, true);
  assert.equal(checked.authenticationInfo.newCounter, 0);
  assert.equal(passkeyBytes(assertion.response.authenticatorData!)[32], 0x1d);
  assert.equal(passkeyBytes(registration.response.response.authenticatorData!)[32], 0x5d);
  assert.equal(passkeyBytes(registration.response.response.publicKey!)[0], 0x30);
  assert.equal(registration.response.response.publicKeyAlgorithm, -7);
  await assert.rejects(verifyAuthenticationResponse({ response: assertion as any, expectedChallenge: 'another-challenge', expectedOrigin: get().origin, expectedRPID: 'example.com', credential: info.credential }));
  await assert.rejects(verifyAuthenticationResponse({ response: assertion as any, expectedChallenge: challenge, expectedOrigin: 'https://attacker.example.com', expectedRPID: 'example.com', credential: info.credential }));
});

test('RP validation rejects phishing, public and private suffixes, insecure or malformed origins and frames', () => {
  for (const [origin, rp] of [['https://attacker.test', 'example.com'], ['https://example.com.attacker.test', 'example.com'], ['https://login.example.com', 'com'], ['https://user.github.io', 'github.io'], ['http://example.com', 'example.com'], ['https://example.com/path', 'example.com'], ['https://example.com', '.example.com'], ['https://example.com', 'EXAMPLE.com'], ['https://example.com', 'example.com.']]) {
    const request = get(); request.origin = origin; request.publicKey.rpId = rp;
    assert.throws(() => validateBrowserPasskeyRequest(request), errorName('SecurityError'), `${origin} / ${rp}`);
  }
  assert.throws(() => validateBrowserPasskeyRequest({ ...get(), crossOrigin: true }), errorName('SecurityError'));
  for (const origin of ['http://localhost:49123', 'http://127.0.0.1:49123', 'http://[::1]:49123']) {
    const request = get(); request.origin = origin; delete request.publicKey.rpId;
    assert.equal(validateBrowserPasskeyRequest(request).origin, origin);
  }
});

test('unverified consent, unsupported algorithms and requested extensions fail closed', async () => {
  await assert.rejects(prepareBrowserPasskeyRegistration(create(), false, [], crypto), errorName('NotAllowedError'));
  const algorithm = create(); algorithm.publicKey.pubKeyCredParams = [{ type: 'public-key', alg: -257 }];
  assert.throws(() => validateBrowserPasskeyRequest(algorithm), errorName('NotSupportedError'));
  const extension = create(); extension.publicKey.extensions = { prf: {} };
  assert.throws(() => validateBrowserPasskeyRequest(extension), errorName('NotSupportedError'));
  const attachment = create(); attachment.publicKey.authenticatorSelection = { authenticatorAttachment: 'cross-platform' };
  assert.throws(() => validateBrowserPasskeyRequest(attachment), errorName('NotSupportedError'));
  const attestation = create(); attestation.publicKey.attestation = 'direct';
  assert.throws(() => validateBrowserPasskeyRequest(attestation), errorName('NotSupportedError'));
});

test('credProps reports an actually discoverable saved credential only when requested on creation', async () => {
  const request = create(); request.publicKey.extensions = { credProps: true };
  const registration = await prepareBrowserPasskeyRegistration(request, true, [], crypto);
  assert.deepEqual(registration.response.clientExtensionResults, { credProps: { rk: true } });
  const verified = await verifyRegistrationResponse({ response: registration.response as any, expectedChallenge: challenge, expectedOrigin: request.origin, expectedRPID: 'example.com' });
  assert.equal(verified.verified, true);
  assert.deepEqual((await prepareBrowserPasskeyRegistration(create(), true, [], crypto)).response.clientExtensionResults, {});
  const authentication = get(); authentication.publicKey.extensions = { credProps: true };
  assert.throws(() => validateBrowserPasskeyRequest(authentication), errorName('NotSupportedError'));
  for (const value of [false, {}, 'true', null]) {
    const unsupported = create(); unsupported.publicKey.extensions = { credProps: value };
    assert.throws(() => validateBrowserPasskeyRequest(unsupported), errorName('NotSupportedError'));
  }
  const mixed = create(); mixed.publicKey.extensions = { credProps: true, prf: {} };
  assert.throws(() => validateBrowserPasskeyRequest(mixed), errorName('NotSupportedError'));
});

test('excluded, disallowed and wrong-RP credentials are refused; original browser options stay unchanged', async () => {
  const request = create(), frozen = JSON.stringify(request);
  const registration = await prepareBrowserPasskeyRegistration(request, true, [], crypto);
  assert.equal(JSON.stringify(request), frozen);
  request.publicKey.excludeCredentials = [{ type: 'public-key', id: registration.response.id }];
  await assert.rejects(prepareBrowserPasskeyRegistration(request, true, [registration.entry], crypto), errorName('InvalidStateError'));
  const disallowed = get(); disallowed.publicKey.allowCredentials = [{ type: 'public-key', id: 'AQID' }];
  await assert.rejects(createBrowserPasskeyAssertion(registration.entry, disallowed, true, crypto), errorName('NotAllowedError'));
  const foreign = get(); foreign.origin = 'https://other.example.test'; foreign.publicKey.rpId = 'example.test';
  await assert.rejects(createBrowserPasskeyAssertion(registration.entry, foreign, true, crypto), errorName('NotAllowedError'));
  await assert.rejects(createBrowserPasskeyAssertion(registration.entry, get(), false, crypto), errorName('NotAllowedError'));
});

test('canonical binary fields, protocol user-handle constraint and malformed options are validated', () => {
  for (const invalid of ['', 'AQ==', 'A', 'AB', '+/8', 'AQ ID']) assert.throws(() => passkeyBytes(invalid));
  const tooLarge = create(); tooLarge.publicKey.user!.id = passkeyBase64url(new Uint8Array(65));
  assert.throws(() => validateBrowserPasskeyRequest(tooLarge), errorName('TypeError'));
  const badDescriptors = get(); (badDescriptors.publicKey as any).allowCredentials = {};
  assert.throws(() => validateBrowserPasskeyRequest(badDescriptors), errorName('TypeError'));
  const snapshot = create(), normalized = validateBrowserPasskeyRequest(snapshot);
  snapshot.publicKey.user!.name = 'changed'; assert.equal(normalized.publicKey.user!.name, 'fixture');
});
