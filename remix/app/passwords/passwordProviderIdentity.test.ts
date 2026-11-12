import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { createBrowserPasskeyAssertion, passkeyBase64url, passkeyBytes, prepareBrowserPasskeyRegistration, type BrowserPasskeyRequest } from './browserPasskey';
import { PASSWORD_PROVIDER_AAGUID, passwordProviderAAGUIDBytes } from './passwordProviderIdentity';
import { providerNameForAaguid } from '../api/utils/auth/passkeyAaguids';

const crypto = webcrypto as unknown as Crypto;
const challenge = passkeyBase64url(new Uint8Array(32).fill(7));
const request = (): BrowserPasskeyRequest => ({ type: 'create', origin: 'https://passkeys.example.test', publicKey: { challenge, rp: { id: 'passkeys.example.test', name: 'Synthetic fixture' }, user: { id: 'AQID', name: 'fixture', displayName: 'Fixture' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none' } });
const verify = (response: any) => verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: request().origin, expectedRPID: 'passkeys.example.test', requireUserVerification: true });

test('canonical provider model identity and official registry artifacts do not drift', () => {
  const root = new URL('../../../', import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(new URL('scripts/generate-password-provider-identity.mjs', root)), '--check']);
  const identity = JSON.parse(readFileSync(new URL('docs/password-provider-identity/identity.json', root), 'utf8'));
  assert.equal(PASSWORD_PROVIDER_AAGUID, identity.aaguid);
  assert.equal(Buffer.from(passwordProviderAAGUIDBytes()).toString('hex'), identity.aaguid.replaceAll('-', ''));
  const changed = passwordProviderAAGUIDBytes(); changed.fill(0); assert.notDeepEqual(passwordProviderAAGUIDBytes(), changed);
  const entry = JSON.parse(readFileSync(new URL('docs/password-provider-identity/registry-entry.json', root), 'utf8'))[identity.aaguid];
  assert.equal(entry.name, 'Thingtime');
  for (const key of ['icon_light', 'icon_dark']) {
    assert.match(entry[key], /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(entry[key].split(',')[1], 'base64').toString();
    assert.match(svg, /viewBox="0 0 3 3"/); assert.doesNotMatch(svg, /<(?:image|script|foreignObject)\b/i);
    assert.equal(svg, readFileSync(new URL(identity.iconSource, root), 'utf8'));
  }
});

test('independent WebAuthn verifier reads Thingtime identity for different new accounts and keys', async () => {
  const ids: string[] = [];
  for (const user of ['AQID', 'BAUG']) {
    const r = request(); r.publicKey.user!.id = user;
    const registration = await prepareBrowserPasskeyRegistration(r, true, [], crypto);
    const checked = await verify(registration.response);
    assert.equal(checked.verified, true); assert.equal(checked.registrationInfo?.aaguid, PASSWORD_PROVIDER_AAGUID);
    assert.equal(providerNameForAaguid(checked.registrationInfo?.aaguid), 'Thingtime');
    assert.deepEqual(passkeyBytes(registration.response.response.authenticatorData!).slice(37, 53), passwordProviderAAGUIDBytes());
    assert.equal(registration.entry.fields.some(field => field.id === 'aaguid'), false);
    assert.ok(registration.entry.title.startsWith('Thingtime Passkey · '));
    ids.push(registration.response.id);
  }
  assert.notEqual(ids[0], ids[1]);
});

test('legacy zero-AAGUID registration and saved entry still authenticate without rewriting keys', async () => {
  const registration = await prepareBrowserPasskeyRegistration(request(), true, [], crypto);
  const auth = passkeyBytes(registration.response.response.authenticatorData!);
  const attestation = passkeyBytes(registration.response.response.attestationObject!);
  const offset = Buffer.from(attestation).indexOf(Buffer.from(auth)); assert.ok(offset >= 0);
  // Recreate the historical public registration envelope only; stored material is unchanged.
  attestation.fill(0, offset + 37, offset + 53); auth.fill(0, 37, 53);
  const legacy = structuredClone(registration.response);
  legacy.response.attestationObject = passkeyBase64url(attestation); legacy.response.authenticatorData = passkeyBase64url(auth);
  const checked = await verify(legacy); assert.equal(checked.registrationInfo?.aaguid, '00000000-0000-0000-0000-000000000000');
  assert.equal(providerNameForAaguid(checked.registrationInfo?.aaguid), null);
  registration.entry.title = 'My custom working key';
  const snapshot = JSON.stringify(registration.entry);
  const get: BrowserPasskeyRequest = { ...request(), type: 'get', publicKey: { challenge, rpId: 'passkeys.example.test' } };
  const response = await createBrowserPasskeyAssertion(registration.entry, get, true, crypto);
  assert.equal(passkeyBytes(response.response.authenticatorData!).length, 37);
  assert.equal(JSON.stringify(registration.entry), snapshot);
  assert.equal((await verifyAuthenticationResponse({ response: response as any, expectedChallenge: challenge, expectedOrigin: get.origin, expectedRPID: 'passkeys.example.test', credential: checked.registrationInfo!.credential, requireUserVerification: true })).verified, true);
});

test('public native ceremony fixture independently verifies identity and assertion', { skip: !process.env.THINGTIME_NATIVE_PASSKEY_FIXTURE }, async () => {
  const fixture = JSON.parse(readFileSync(process.env.THINGTIME_NATIVE_PASSKEY_FIXTURE!, 'utf8'));
  const checked = await verifyRegistrationResponse({ response: fixture.registration, expectedChallenge: fixture.challenge, expectedOrigin: fixture.origin, expectedRPID: fixture.rp, requireUserVerification: true });
  assert.equal(checked.verified, true); assert.equal(checked.registrationInfo?.aaguid, PASSWORD_PROVIDER_AAGUID);
  assert.equal((await verifyAuthenticationResponse({ response: fixture.authentication, expectedChallenge: fixture.challenge, expectedOrigin: fixture.origin, expectedRPID: fixture.rp, credential: checked.registrationInfo!.credential, requireUserVerification: true })).verified, true);
});
