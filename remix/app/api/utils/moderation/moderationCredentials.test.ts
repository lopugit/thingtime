import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModerationEnvironment, MODERATION_CREDENTIAL_PLATFORM } from './moderationCredentials';
import { createOmniTextScreen } from './textModeration';
import { createOmniScreen } from './openaiProvider';

test('vault credential overrides legacy only for moderation, and reaches both Omni request paths', async () => {
  const original = { OPENAI_API_KEY: 'old-fixture', CLAUDE_CODE_OAUTH_TOKEN: 'unchanged' };
  const resolved = await resolveModerationEnvironment(original, async (platform) => {
    assert.equal(platform, MODERATION_CREDENTIAL_PLATFORM);
    return 'vault-fixture';
  });
  assert.equal(original.OPENAI_API_KEY, 'old-fixture');
  assert.equal(resolved.CLAUDE_CODE_OAUTH_TOKEN, 'unchanged');
  const payloads: any[] = [];
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer vault-fixture');
    payloads.push(JSON.parse(String(init.body)));
    return Response.json({ results: [{ flagged: false, categories: {}, category_scores: {} }] });
  }) as typeof fetch;
  await createOmniTextScreen(resolved, fetcher)({ text: 'A blue square.', imageUrls: [] });
  await createOmniScreen(resolved, fetcher)({ bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'test.png' });
  assert.equal(payloads.length, 2);
  assert.ok(payloads.every((body) => body.model === 'omni-moderation-latest'));
});

test('missing entry preserves migration fallback; unavailable vault fails closed', async () => {
  const env = { OPENAI_API_KEY: 'legacy-fixture' };
  assert.equal(await resolveModerationEnvironment(env, async () => null), env);
  await assert.rejects(resolveModerationEnvironment(env, async () => { throw new Error('vault unavailable'); }), /vault unavailable/);
});

test('each request uses its own environment vault and observes rotation immediately', async () => {
  let key = 'production-fixture';
  const read = async () => key;
  assert.equal((await resolveModerationEnvironment({}, read)).OPENAI_API_KEY, key);
  key = 'rotated-fixture';
  assert.equal((await resolveModerationEnvironment({}, read)).OPENAI_API_KEY, key);
  assert.equal((await resolveModerationEnvironment({}, async () => 'develop-fixture')).OPENAI_API_KEY, 'develop-fixture');
});

test('deterministic test provider never reads a live vault', async () => {
  const env = { THINGTIME_MODERATION_PROVIDER: 'test' };
  assert.equal(await resolveModerationEnvironment(env, async () => { throw new Error('must not read'); }), env);
});
