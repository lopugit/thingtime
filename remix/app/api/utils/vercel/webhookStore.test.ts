import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  isVercelWebhookConfigured,
  parseVercelWebhookEvent,
  persistedStatusIsForDeployment,
  shouldReplaceBranchStatus,
  verifyVercelSignature
} from './webhookStore';

// Both the configured-check and the verifier read process.env at CALL time, so
// tests can set the secret per case without module-mocking.
// The literal is an arbitrary HMAC key — deliberately NOT carrying Vercel's
// `whsec_` prefix, which secret scanners match on shape alone and then fail the
// PR over a fixture. Only "these two keys differ" is load-bearing below.
const SECRET = 'vercel-webhook-signing-fixture';

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
    withSecret(SECRET, () => verifyVercelSignature(body, sign(body, 'attacker-controlled-key'))),
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

test('the deployment host falls back to payload.url when the deployment object omits it', () => {
  // Losing this URL silently downgrades failure attribution to the commit SHA,
  // which cannot separate same-SHA sibling deployments.
  const parsed = parseVercelWebhookEvent(
    envelope({
      payload: {
        url: 'thingtime-fromtop.vercel.app',
        deployment: { id: 'dpl_1', meta: { githubCommitRef: 'main' } }
      }
    })
  );
  assert.equal(parsed?.next.deploymentUrl, 'https://thingtime-fromtop.vercel.app');
});

// regression: webhook deliveries carry the inspector page at
// payload.links.deployment. `deployment.inspectorUrl` is a REST API field that
// is absent from real deliveries, so reading only it left buildPageUrl empty
// and the footer's build link fell back to the project-wide dashboard.
test('the inspector URL is read from the real webhook envelope shape', () => {
  const parsed = parseVercelWebhookEvent(
    envelope({
      payload: {
        target: 'production',
        links: { deployment: 'https://vercel.com/lopu/thingtime/dpl_links', project: 'https://vercel.com/lopu/thingtime' },
        deployment: { id: 'dpl_1', url: 'thingtime-abc123.vercel.app', meta: { githubCommitRef: 'main' } }
      }
    })
  );
  assert.equal(parsed?.next.inspectorUrl, 'https://vercel.com/lopu/thingtime/dpl_links');
});

test('a REST-shaped inspectorUrl still works, but the envelope link wins', () => {
  assert.equal(parseVercelWebhookEvent(envelope())?.next.inspectorUrl, 'https://vercel.com/lopu/thingtime/dpl_123');
  const both = parseVercelWebhookEvent(
    envelope({
      payload: {
        links: { deployment: 'https://vercel.com/lopu/thingtime/dpl_links' },
        deployment: {
          id: 'dpl_1',
          inspectorUrl: 'https://vercel.com/lopu/thingtime/dpl_rest',
          meta: { githubCommitRef: 'main' }
        }
      }
    })
  );
  assert.equal(both?.next.inspectorUrl, 'https://vercel.com/lopu/thingtime/dpl_links');
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

// ------------------------------------------------------------ ordering guard

// The out-of-order guard is the subtlest logic here and was previously
// unreachable from tests (it sat inline in the Mongo-backed writer). It is now
// a pure decision, so these run in the existing harness with no module mocks.

const at = (ms: number) => new Date(ms).toISOString();
const T = 1752986400000;

test('a newer event for the same deployment replaces the older one', () => {
  assert.equal(
    shouldReplaceBranchStatus(
      { deploymentId: 'dpl_1', eventAt: at(T), state: 'building' },
      { deploymentId: 'dpl_1', eventAt: at(T + 1000), state: 'ready' }
    ),
    true
  );
});

test('a late event for a superseded deployment is ignored', () => {
  assert.equal(
    shouldReplaceBranchStatus(
      { deploymentId: 'dpl_2', eventAt: at(T + 1000), state: 'ready' },
      { deploymentId: 'dpl_1', eventAt: at(T), state: 'ready' }
    ),
    false
  );
  // ...but a NEWER event for a different deployment is the new current build
  assert.equal(
    shouldReplaceBranchStatus(
      { deploymentId: 'dpl_1', eventAt: at(T), state: 'ready' },
      { deploymentId: 'dpl_2', eventAt: at(T + 1000), state: 'building' }
    ),
    true
  );
});

test('a terminal state beats building for the same deployment, whatever the clocks say', () => {
  // regression: an undated deployment.created falls back to `now`, so it dates
  // itself NEWER than the ready event it follows — it must still not win
  for (const state of ['ready', 'error', 'canceled'] as const) {
    assert.equal(
      shouldReplaceBranchStatus(
        { deploymentId: 'dpl_1', eventAt: at(T), state },
        { deploymentId: 'dpl_1', eventAt: at(T + 60_000), state: 'building' }
      ),
      false,
      `${state} must survive a later-dated building event`
    );
  }
  // and a terminal state still lands on a building row even when back-dated
  assert.equal(
    shouldReplaceBranchStatus(
      { deploymentId: 'dpl_1', eventAt: at(T + 60_000), state: 'building' },
      { deploymentId: 'dpl_1', eventAt: at(T), state: 'ready' }
    ),
    true
  );
});

test('an older terminal event never overwrites a newer terminal one', () => {
  assert.equal(
    shouldReplaceBranchStatus(
      { deploymentId: 'dpl_1', eventAt: at(T + 1000), state: 'ready' },
      { deploymentId: 'dpl_1', eventAt: at(T), state: 'error' }
    ),
    false
  );
});

test('the first event for a branch is always recorded', () => {
  assert.equal(shouldReplaceBranchStatus(undefined, { deploymentId: 'dpl_1', eventAt: at(T), state: 'building' }), true);
});

// --------------------------------------------------------- deployment identity

// One branch can have concurrent sibling deployments sharing the single stored
// slot (generic Preview + the `develop` Custom Environment build the same head
// SHA). The status fast path uses this to refuse to report a sibling's failure
// as its own — see status.ts.

test('the running deployment URL identifies the entry, so same-SHA siblings are told apart', () => {
  const running = { commitSha: 'abc1234', deploymentUrl: 'https://thingtime-mine.vercel.app' };
  assert.equal(
    persistedStatusIsForDeployment({ commitSha: 'abc1234', deploymentUrl: 'https://thingtime-mine.vercel.app' }, running),
    true
  );
  // the sibling built from the SAME commit is a different deployment
  assert.equal(
    persistedStatusIsForDeployment(
      { commitSha: 'abc1234', deploymentUrl: 'https://thingtime-sibling.vercel.app' },
      running
    ),
    false
  );
});

test('the commit SHA identifies the entry only when a URL is missing on either side', () => {
  assert.equal(persistedStatusIsForDeployment({ commitSha: 'abc1234' }, { commitSha: 'abc1234' }), true);
  assert.equal(persistedStatusIsForDeployment({ commitSha: 'abc1234' }, { commitSha: 'def5678' }), false);
  // a stored URL cannot decide anything when the running deployment has none
  assert.equal(
    persistedStatusIsForDeployment(
      { commitSha: 'abc1234', deploymentUrl: 'https://thingtime-other.vercel.app' },
      { commitSha: 'abc1234' }
    ),
    true
  );
});

test('an unidentifiable entry is never claimed as this deployment', () => {
  assert.equal(persistedStatusIsForDeployment(null, { commitSha: 'abc1234' }), false);
  assert.equal(persistedStatusIsForDeployment(undefined, { commitSha: 'abc1234' }), false);
  // nothing known on either side is not a match — it must not default to true
  assert.equal(persistedStatusIsForDeployment({}, {}), false);
  assert.equal(persistedStatusIsForDeployment({ commitSha: 'abc1234' }, {}), false);
  assert.equal(persistedStatusIsForDeployment({}, { commitSha: 'abc1234' }), false);
});
