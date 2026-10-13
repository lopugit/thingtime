import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { verifyChatGPTIdentity, chatgptIdentityProvider } from './chatgptIdentity';

test('ChatGPT identity verifies signatures, issuer, audience, nonce and expiry before trusting a subject', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'fixture' }] });
  const mint = (claims = {}) =>
    new SignJWT({ nonce: 'attempt', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer('https://auth.openai.com')
      .setAudience('oaiapp_test')
      .setSubject('account-one')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  const token = await mint();
  assert.equal((await verifyChatGPTIdentity(token, 'oaiapp_test', 'attempt', keys)).sub, 'account-one');
  await assert.rejects(verifyChatGPTIdentity(token, 'oaiapp_other', 'attempt', keys));
  await assert.rejects(verifyChatGPTIdentity(token, 'oaiapp_test', 'other-attempt', keys));
  await assert.rejects(verifyChatGPTIdentity(token.slice(0, -8) + 'AAAAAAAA', 'oaiapp_test', 'attempt', keys));
  const expired = await new SignJWT({ nonce: 'attempt' })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer('https://auth.openai.com')
    .setAudience('oaiapp_test')
    .setSubject('account-one')
    .setIssuedAt(1)
    .setExpirationTime(2)
    .sign(privateKey);
  await assert.rejects(verifyChatGPTIdentity(expired, 'oaiapp_test', 'attempt', keys));
  const wrongIssuer = await new SignJWT({ nonce: 'attempt' })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer('https://example.test')
    .setAudience('oaiapp_test')
    .setSubject('account-one')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  await assert.rejects(verifyChatGPTIdentity(wrongIssuer, 'oaiapp_test', 'attempt', keys));
});

test('ChatGPT hosted authorization requests only identity scopes with PKCE and a nonce', () => {
  const url = new URL(
    chatgptIdentityProvider.oauth!.buildAuthorizeUrl({
      clientId: 'oaiapp_test',
      redirectUri: 'https://example.test/callback',
      state: 'state',
      nonce: 'nonce',
      codeChallenge: 'challenge'
    })
  );
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('nonce'), 'nonce');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false);
});
