import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { isVercelWebhookConfigured, parseVercelWebhookEvent, verifyVercelSignature } from './webhookStore';

// Both the configured-check and the verifier read process.env at CALL time, so
// tests can set the secret per case without module-mocking.
const SECRET = 'whsec_test_do_not_use';

const withSecret = <T>(secret: string | undefined, run: () => T): T => {
  const previous = process.env.VERCEL_WEBHOOK_SECRET;
  if (secret === undefined) delete process.env.VERCEL_WEBHOOK_SECRET;
  else process.env.VERCEL_WEBHOOK_SECRET = secret;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.VERCEL_WEBHOOK_SECRET;
    else process.env.VERCEL_WEBHOOK_SECRET = previous;
  }
};

const sign = (body: string, secret = SECRET) => createHmac('sha1', secret).update(body).digest('hex');

const envelope = (overrides: Record<string, any> = {}) => ({
  type: 'deployment.succeeded',
  createdAt: 1752986400000,
  payload: {
    target: 'production',
    deployment: {
      id: 'dpl_123',
      url: 'thingtime-abc123.vercel.app',
      inspectorUrl: 'https://vercel.com/lopu/thingtime/dpl_123',
      meta: { githubCommitRef: 'main', githubCommitSha: 'abc1234' }
    }
  },
  ...overrides
});

// ---------------------------------------------------------------- feature flag

test('the webhook feature is off until a non-blank secret is set', () => {
  assert.equal(
    withSecret(undefined, () => isVercelWebhookConfigured()),
    false
  );
  assert.equal(
    withSecret('', () => isVercelWebhookConfigured()),
    false
  );
  // a whitespace-only secret is a misconfiguration, not a secret
  assert.equal(
    withSecret('   ', () => isVercelWebhookConfigured()),
    false
  );
  assert.equal(
    withSecret(SECRET, () => isVercelWebhookConfigured()),
    true
  );
});

// ------------------------------------------------------------------- signature

test('a correctly signed body is accepted', () => {
  const body = JSON.stringify(envelope());
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(body, sign(body))),
    true
  );
});

test('a tampered body is rejected even with a previously valid signature', () => {
  const body = JSON.stringify(envelope());
  const signature = sign(body);
  const tampered = body.replace('deployment.succeeded', 'deployment.error');
  assert.notEqual(tampered, body);
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(tampered, signature)),
    false
  );
});

test('a signature made with the wrong secret is rejected', () => {
  const body = JSON.stringify(envelope());
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(body, sign(body, 'whsec_attacker'))),
    false
  );
});

test('a missing or empty signature header is rejected, never treated as absent-therefore-fine', () => {
  const body = JSON.stringify(envelope());
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(body, null)),
    false
  );
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(body, '')),
    false
  );
});

test('no configured secret rejects everything — the route must not verify open', () => {
  const body = JSON.stringify(envelope());
  assert.equal(
    withSecret(undefined, () => verifyVercelSignature(body, sign(body))),
    false
  );
});

test('a wrong-length signature is rejected without throwing (timingSafeEqual guard)', () => {
  const body = JSON.stringify(envelope());
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(body, 'abc123')),
    false
  );
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(body, sign(body) + 'ff')),
    false
  );
});

test('signature comparison tolerates surrounding whitespace and uppercase hex', () => {
  const body = JSON.stringify(envelope());
  const signature = sign(body);
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature(body, `  ${signature.toUpperCase()}  `)),
    true
  );
});

test('an empty body still requires a valid signature', () => {
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature('', sign(''))),
    true
  );
  assert.equal(
    withSecret(SECRET, () => verifyVercelSignature('', 'deadbeef'.repeat(5))),
    false
  );
});

// ----------------------------------------------------------------- event parse

test('each tracked event type maps to its deployment state', () => {
  const cases: [string, string][] = [
    ['deployment.created', 'building'],
    ['deployment.succeeded', 'ready'],
    ['deployment.promoted', 'ready'],
    ['deployment.ready', 'ready'],
    ['deployment.error', 'error'],
    ['deployment.canceled', 'canceled']
  ];
  for (const [type, state] of cases) {
    const parsed = parseVercelWebhookEvent(envelope({ type }));
    assert.equal(parsed?.next.state, state, `${type} should record ${state}`);
  }
});

test('untracked and malformed envelopes parse to null rather than throwing', () => {
  assert.equal(parseVercelWebhookEvent(envelope({ type: 'project.created' })), null);
  assert.equal(parseVercelWebhookEvent(envelope({ type: undefined })), null);
  assert.equal(parseVercelWebhookEvent(null), null);
  assert.equal(parseVercelWebhookEvent(undefined), null);
  assert.equal(parseVercelWebhookEvent({}), null);
  assert.equal(parseVercelWebhookEvent('not an object'), null);
});

test('an event with no resolvable git branch is not recorded', () => {
  // Branch is the storage key; without it the event cannot be filed.
  assert.equal(parseVercelWebhookEvent(envelope({ payload: { deployment: { id: 'dpl_1' } } })), null);
  assert.equal(
    parseVercelWebhookEvent(envelope({ payload: { deployment: { id: 'dpl_1', meta: { githubCommitRef: '' } } } })),
    null
  );
});

test('branches resolve from GitLab and Bitbucket metadata too', () => {
  const gitlab = parseVercelWebhookEvent(
    envelope({ payload: { deployment: { id: 'dpl_1', meta: { gitlabCommitRef: 'develop' } } } })
  );
  assert.equal(gitlab?.branch, 'develop');
  const bitbucket = parseVercelWebhookEvent(
    envelope({ payload: { deployment: { id: 'dpl_1', meta: { bitbucketCommitRef: 'feature/x' } } } })
  );
  assert.equal(bitbucket?.branch, 'feature/x');
});

test('a bare deployment host is normalised to an https URL', () => {
  const parsed = parseVercelWebhookEvent(envelope());
  assert.equal(parsed?.next.deploymentUrl, 'https://thingtime-abc123.vercel.app');
});

test('an already-absolute deployment URL is left alone', () => {
  const parsed = parseVercelWebhookEvent(
    envelope({
      payload: {
        deployment: { id: 'dpl_1', url: 'https://already.example.com', meta: { githubCommitRef: 'main' } }
      }
    })
  );
  assert.equal(parsed?.next.deploymentUrl, 'https://already.example.com');
});

test('error events always carry a message, defaulting when Vercel sends none', () => {
  const withMessage = parseVercelWebhookEvent(
    envelope({ type: 'deployment.error', payload: { ...envelope().payload, errorMessage: 'Build exceeded memory' } })
  );
  assert.equal(withMessage?.next.error, 'Build exceeded memory');

  const withoutMessage = parseVercelWebhookEvent(envelope({ type: 'deployment.error' }));
  assert.equal(withoutMessage?.next.error, 'Deployment failed');
});

test('non-error states carry no error field', () => {
  assert.equal(parseVercelWebhookEvent(envelope())?.next.error, undefined);
});

test('createdAt becomes an ISO timestamp, with a sane fallback for junk values', () => {
  assert.equal(parseVercelWebhookEvent(envelope())?.next.eventAt, new Date(1752986400000).toISOString());
  for (const createdAt of [undefined, 0, -1, 'nonsense', NaN]) {
    const parsed = parseVercelWebhookEvent(envelope({ createdAt }));
    assert.ok(parsed, 'the event should still parse');
    assert.ok(
      Number.isFinite(Date.parse(parsed!.next.eventAt)),
      `createdAt=${String(createdAt)} should fall back to a parseable timestamp`
    );
  }
});

test('deployment id falls back to uid, and identity fields are carried through', () => {
  const parsed = parseVercelWebhookEvent(envelope());
  assert.equal(parsed?.next.deploymentId, 'dpl_123');
  assert.equal(parsed?.next.commitSha, 'abc1234');
  assert.equal(parsed?.next.environment, 'production');
  assert.equal(parsed?.next.inspectorUrl, 'https://vercel.com/lopu/thingtime/dpl_123');
  assert.equal(parsed?.next.eventType, 'deployment.succeeded');

  const byUid = parseVercelWebhookEvent(
    envelope({ payload: { deployment: { uid: 'dpl_uid', meta: { githubCommitRef: 'main' } } } })
  );
  assert.equal(byUid?.next.deploymentId, 'dpl_uid');
});
