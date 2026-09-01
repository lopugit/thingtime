import { expectJson, expectNdjson, expectRedirectedTo, expectStatus, type ApiTestContext, type ApiTestDefinition } from './apiTestRunner';
import { apiEndpointDocs } from '~/docs/apiDocs';

// crypto-sourced randomness: these suffixes end up in registered usernames /
// email aliases, and Web Crypto is available everywhere this runs (browser
// tests page + Node ≥ 18), so there's no reason to trip CodeQL over
// Math.random here
const uniqueSuffix = () => `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

// Documentation-only IPv6 range (RFC 3849), randomized per runner load so the
// inherited auth.register IP bucket cannot mask the body-cap assertion on
// repeated local/CI runs.
const uniqueTestIp = () => {
  const hex = crypto.randomUUID().replace(/-/g, '');
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}:${hex.slice(12, 16)}:${hex.slice(16, 20)}:${hex.slice(20, 24)}`;
};

// Email tests deliver to the configured test inbox via plus aliases so real
// sends stay contained: support@x.com → support+signup-<suffix>@x.com.
const DEFAULT_EMAIL_TEST_RECIPIENT = 'support@thingtime.com';
const plusAlias = (recipient: string, tag: string) => {
  const [local, domain] = String(recipient || DEFAULT_EMAIL_TEST_RECIPIENT).split('@');
  return `${local}+${tag}-${uniqueSuffix()}@${domain || 'thingtime.com'}`;
};

const uniqueServiceAccountBody = () => {
  const suffix = uniqueSuffix();

  return {
    serviceName: `Thingtime API Test ${suffix}`,
    username: `tt-api-test-${suffix}`,
    email: `tt-api-test-${suffix}@example.invalid`,
    displayName: `Thingtime API Test ${suffix}`,
    meta: {
      source: 'thingtime-tests-page'
    }
  };
};

const uniqueEmailRegisterBody = (context: ApiTestContext) => {
  const suffix = uniqueSuffix();

  return {
    username: `ses-signup-${suffix}`,
    password: 'testpass123',
    email: plusAlias(context.email?.testRecipient || DEFAULT_EMAIL_TEST_RECIPIENT, 'signup'),
    displayName: 'SES Signup Test',
    meta: {
      source: 'thingtime-tests-page',
      flow: 'email-signup-verification'
    }
  };
};

const uniqueEmailServiceAccountBody = (context: ApiTestContext) => {
  const suffix = uniqueSuffix();

  return {
    serviceName: `SES Service Test ${suffix}`,
    username: `ses-service-${suffix}`,
    email: plusAlias(context.email?.testRecipient || DEFAULT_EMAIL_TEST_RECIPIENT, 'service'),
    displayName: 'SES Service Test',
    meta: {
      source: 'thingtime-tests-page',
      flow: 'email-service-account-verification'
    }
  };
};

// an unbiased 6-digit test OTP from a CSPRNG. Rejection sampling + a
// division-based reduction (no modulo on the CSPRNG output) is the canonical
// unbiased pattern — uniformity is irrelevant for a test code, but this keeps
// CodeQL's insecure-randomness AND biased-random rules clear.
const SIX_DIGIT_SPAN = 900000; // 100000–999999 inclusive
const sixDigitCode = () => {
  const bucket = Math.floor(0x1_0000_0000 / SIX_DIGIT_SPAN); // 2^32 / span, floored
  const limit = bucket * SIX_DIGIT_SPAN; // largest multiple of span ≤ 2^32
  const buf = new Uint32Array(1);
  let rand: number;
  do {
    crypto.getRandomValues(buf);
    rand = buf[0];
  } while (rand >= limit); // reject the biased tail
  return String(100000 + Math.floor(rand / bucket));
};

const uniqueEmailOtpBody = (context: ApiTestContext) => ({
  email: plusAlias(context.email?.testRecipient || DEFAULT_EMAIL_TEST_RECIPIENT, 'otp'),
  code: sixDigitCode(),
  expiresMinutes: 10
});

const isObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value);

// Shared by the two app-shaped data-thing tests below: BOTH requests send this
// exact crystal so the second create collides with the first on (ownerId,
// crystal.appId, crystal.key). The things_app_data_unique index is partial-
// filtered to thingtime: 'app-data' docs (see api/utils/mongodb/collections.ts),
// so free-form data things carrying these keys must both persist — before the
// kind scoping the second create 409'd on the app-data unique index. Computed
// once per page load; duplicates across runs are fine (data things are not
// unique on these keys, by design).
const appShapedDataCrystal = (() => {
  const suffix = uniqueSuffix();
  return { name: `tt-api-test-app-shaped-${suffix}`, appId: `tt-api-test-appid-${suffix}`, key: 'tt-api-test-shared-key' };
})();

const decodeJwtPayload = (token: unknown) => {
  const encodedPayload = String(token || '').split('.')[1] || '';
  const base64 = encodedPayload
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');

  try {
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
};

const apiDocsSmokeTests: ApiTestDefinition[] = apiEndpointDocs.flatMap((doc) =>
  (['GET', 'POST'] as const).map((method) => ({
    id: `docs-${doc.id}-${method.toLowerCase()}`,
    name: `${doc.title} docs ${method}`,
    description: `${method} ${doc.docsEndpoint} returns the JSON docs object for ${doc.endpoint}.`,
    group: 'docs',
    method,
    path: doc.docsEndpoint,
    body: method === 'POST' ? {} : undefined,
    expect: expectJson(
      [200],
      (body) =>
        body?.ok === true &&
        body?.docs?.endpoint === doc.endpoint &&
        body?.docs?.docsEndpoint === doc.docsEndpoint &&
        Array.isArray(body?.docs?.steps) &&
        body.docs.steps.length > 0 &&
        body?.docs?.platformExamples?.curl &&
        body?.docs?.platformExamples?.node &&
        body?.docs?.platformExamples?.python &&
        body?.docs?.platformExamples?.ruby &&
        body?.docs?.platformExamples?.wget,
      `${method} docs route returned endpoint docs and platform examples.`
    )
  }))
);

export const apiTests: ApiTestDefinition[] = [
  {
    id: 'root-data',
    name: 'Root data',
    description: 'Root loader data route returns app shell configuration and current user shape.',
    group: 'root',
    method: 'GET',
    path: '/api/root-data',
    expect: expectJson(
      [200],
      (body) =>
        isObject(body) &&
        Object.prototype.hasOwnProperty.call(body, 'envFromCookie') &&
        Object.prototype.hasOwnProperty.call(body, 'devKitEnv') &&
        typeof body?.titlePrefix === 'string' &&
        Object.prototype.hasOwnProperty.call(body, 'user'),
      'Root data returned app configuration and user state.'
    )
  },
  {
    id: 'auth-jwks',
    name: 'JWKS discovery',
    description: 'Public signing keys route responds with a JWKS shape or configured-missing 503.',
    group: 'auth',
    method: 'GET',
    path: '/api/v1/auth/jwks',
    expect: expectJson([200, 503], (body) => Array.isArray(body?.keys), 'JWKS body contains a keys array.')
  },
  {
    id: 'auth-me-anonymous',
    name: 'Current user anonymous',
    description: 'Anonymous requests resolve to a null current user.',
    group: 'auth',
    method: 'GET',
    path: '/api/v1/auth/me',
    expect: expectJson([200], (body) => body?.user === null, 'Anonymous user resolved as null.')
  },
  {
    id: 'auth-logout-anonymous',
    name: 'Logout without token',
    description: 'Logout is idempotent and succeeds without an existing session.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/logout',
    body: {},
    expect: expectJson([200], (body) => body?.ok === true, 'Logout returned ok.')
  },
  {
    id: 'auth-accounts-list',
    name: 'Account switcher roster',
    description: 'The accounts route lists signed-in accounts (empty for anonymous browsers) without exposing raw JWTs.',
    group: 'auth',
    method: 'GET',
    path: '/api/v1/auth/accounts',
    expect: expectJson(
      [200],
      (body) =>
        body?.ok === true &&
        Array.isArray(body?.accounts) &&
        body.accounts.every(
          (account: any) =>
            isObject(account?.user) &&
            typeof account?.active === 'boolean' &&
            !Object.prototype.hasOwnProperty.call(account, 'token') &&
            !Object.prototype.hasOwnProperty.call(account, 'jti')
        ),
      'Accounts roster returned public users only.'
    )
  },
  {
    id: 'auth-accounts-switch-validation',
    name: 'Switch account validation',
    description: 'Switching requires a userId.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/accounts/switch',
    body: {},
    expect: expectJson([400], (body) => body?.ok === false && Boolean(body?.error), 'Switch returned validation error.')
  },
  {
    id: 'auth-accounts-switch-unknown',
    name: 'Switch to unknown account',
    description: 'Switching to an account that is not signed in to this browser returns 404.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/accounts/switch',
    body: { userId: '000000000000000000000000' },
    expect: expectJson(
      [404],
      (body) => body?.ok === false && Boolean(body?.error) && Array.isArray(body?.accounts),
      'Switch rejected an account that is not in the roster.'
    )
  },
  {
    id: 'auth-accounts-remove-validation',
    name: 'Remove account validation',
    description: 'Removing a switcher account requires a userId.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/accounts/remove',
    body: {},
    expect: expectJson([400], (body) => body?.ok === false && Boolean(body?.error), 'Remove returned validation error.')
  },
  {
    id: 'auth-register-validation',
    name: 'Register validation',
    description: 'Register fails before database writes when required fields are missing.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {},
    expect: expectJson([400], (body) => body?.ok === false && Boolean(body?.error), 'Register returned validation error.')
  },
  {
    id: 'auth-register-body-cap',
    name: 'Register caps body size',
    description: 'An oversized register body is rejected (413) before it is buffered/validated, rather than parsed in full.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/register',
    headers: { 'X-Forwarded-For': uniqueTestIp() },
    // ~64 KB payload, well over the 16 KB route cap.
    body: { username: 'tt-api-test-oversized', password: 'valid-length-password', pad: 'x'.repeat(64 * 1024) },
    expect: expectJson(
      [413],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Oversized register body was rejected with a 413 error shape.'
    )
  },
  {
    id: 'auth-login-invalid',
    name: 'Login invalid credentials',
    description: 'Login rejects invalid credentials, is rate-limited, or surfaces environment failure if MongoDB is unavailable.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/login',
    body: { username: 'thingtime-test-missing-user', password: 'not-a-real-password' },
    // Assert the body shape per status, not just the code — a bare status list
    // would go green if the login route returned 429 for EVERY request (a
    // fail-closed/misconfigured limiter locking out real users), the exact
    // failure this test exists to catch. A 429 must at least carry the rate-limit
    // error shape; a 401/500 must be a real rejection (ok:false + error).
    expect: expectJson(
      [401, 429, 500],
      (body, response) => (response.status === 429 ? typeof body?.error === 'string' : body?.ok === false && typeof body?.error === 'string'),
      'Login rejects invalid credentials (ok:false + error), or is rate-limited/env-limited with an error shape.'
    )
  },
  {
    id: 'auth-password-reset-neutral',
    name: 'Password reset is probe-proof',
    description: 'Reset requests return ok whether or not the email matches an account (or 429 when the per-IP window is exhausted).',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/password-reset',
    body: { email: 'tt-api-test-definitely-unregistered@example.invalid' },
    expect: expectJson(
      [200, 429],
      (body, response) => (response.status === 429 ? typeof body?.error === 'string' : body?.ok === true),
      'Reset request returned a neutral ok response (or was rate-limited with an error shape).'
    )
  },
  {
    id: 'auth-password-reset-confirm-invalid',
    name: 'Password reset confirm rejects bad tokens',
		description: 'Unknown/expired reset tokens are rejected with a 400 error shape (or 429 when the per-IP window is exhausted).',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/password-reset/confirm',
    body: { token: 'not-a-real-reset-token', password: 'valid-length-password' },
    expect: expectJson(
      [400, 429],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Invalid reset token rejected with an error shape.'
    )
  },
  {
    id: 'auth-two-factor-state-guarded',
    name: 'Email 2FA state requires auth',
    description: 'Reading the 2FA state anonymously is rejected with a 401 error shape.',
    group: 'auth',
    method: 'GET',
    path: '/api/v1/auth/two-factor',
    expect: expectJson(
      [200, 401],
      (body) => typeof body?.enabled === 'boolean' || (body?.ok === false && typeof body?.error === 'string'),
      'Two-factor state returned for a session or was rejected anonymously.'
    )
  },
  {
    id: 'auth-two-factor-toggle-validates',
    name: 'Email 2FA toggle validates input',
    description: 'Toggling 2FA without a boolean enabled flag is rejected before any write.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/two-factor',
    body: {},
    expect: expectJson(
      [400, 401],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Invalid 2FA toggle rejected with an error shape.'
    )
  },
  {
    id: 'auth-login-otp-invalid-challenge',
    name: 'Login OTP rejects unknown challenges',
    description: 'Completing a 2FA login with an unknown challenge id fails with a generic 401 (429 when the login window is exhausted).',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/login',
    body: { challenge: 'not-a-real-challenge-id', code: '000000' },
    expect: expectJson(
      [401, 429],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Unknown OTP challenge rejected with an error shape.'
    )
  },
  {
    id: 'auth-resend-verification-empty',
    name: 'Resend verification empty body',
		description: 'The resend route returns ok for empty input so account existence cannot be probed (or 429 when the per-IP window is exhausted).',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/resend-verification',
    body: {},
    expect: expectJson(
      [200, 429],
      (body, response) => (response.status === 429 ? body?.ok === false : body?.ok === true),
      'Resend verification returned ok (or the per-IP window was exhausted).'
    )
  },
  {
    id: 'auth-verify-email-missing',
    name: 'Verify email missing token',
    description: 'Missing verification tokens redirect to the login verification state.',
    group: 'auth',
    method: 'GET',
    path: '/api/v1/auth/verify-email',
    expect: expectRedirectedTo('/login?verify=missing')
  },
  {
    id: 'auth-service-account-validation',
    name: 'Service account email validation',
    description: 'The service account endpoint is public but requires a valid email (429/503 when the per-IP provisioning window or limiter is exhausted).',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/service-account',
    body: { serviceName: 'Thingtime API Test Missing Email' },
    expect: expectJson(
      [400, 429, 503],
      (body, response) =>
        response.status === 400
          ? body?.ok === false && String(body?.error || '').toLowerCase().includes('email')
          : body?.ok === false && typeof body?.error === 'string',
      'Service account route requires a valid email (or was rate-limited with an error shape).'
    )
  },
  {
    id: 'auth-service-account-body-cap',
    name: 'Service account body size cap',
    description: 'Oversized provisioning bodies are rejected with 413 before any account work (the route caps bodies at 16 KiB).',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/service-account',
    body: {
      serviceName: 'Thingtime API Test Oversized Body',
      email: 'oversized-body@example.invalid',
      meta: { padding: 'x'.repeat(20 * 1024) }
    },
    expect: expectJson(
      [413, 429, 503],
      (body, response) => (response.status === 413 ? body?.ok === false : typeof body?.error === 'string'),
      'Oversized service-account body rejected with 413 (or rate-limited with an error shape).'
    )
  },
  {
    id: 'auth-service-account-create',
    name: 'Service account creation',
    description: 'Creates a service account, returns a non-expiring bearer token, and grants 5 GiB storage.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/service-account',
    mutates: true,
    body: uniqueServiceAccountBody,
    expect: expectJson(
      [200, 429, 503],
      (body, response) => {
        if (response.status !== 200) return body?.ok === false && typeof body?.error === 'string';
        const payload = decodeJwtPayload(body?.accessToken);
        const deadlineMs = Date.parse(body?.verificationRequiredBy || '');
        const sevenDaysMs = 1000 * 60 * 60 * 24 * 7;
        const deadlineLooksRight = Number.isFinite(deadlineMs) && deadlineMs - Date.now() <= sevenDaysMs + 60_000;

        return (
          body?.ok === true &&
          body?.tokenType === 'Bearer' &&
          body?.expiresAt === null &&
          body?.storageAllowanceBytes === 5368709120 &&
          body?.user?.accountKind === 'service' &&
          body?.user?.emailVerified === false &&
          !Object.prototype.hasOwnProperty.call(payload || {}, 'exp') &&
          deadlineLooksRight
        );
      },
      'Service account response has non-expiring token, seven-day verification window, and 5 GiB allowance (or the per-IP provisioning limit answered with an error shape).'
    )
  },
  {
    id: 'email-config',
    name: 'Email test config',
    description: 'Returns safe email provider/test metadata without exposing SES credentials.',
    group: 'email',
    method: 'GET',
    path: '/api/v1/email/config',
    expect: expectJson(
      [200],
      (body) =>
        body?.ok === true &&
        isObject(body?.email) &&
        ['console', 'ses'].includes(body.email.provider) &&
        typeof body.email.sesSandbox === 'boolean' &&
        typeof body.email.testRecipient === 'string',
      'Email config returned provider, sandbox, and test-recipient metadata.'
    )
  },
  {
    id: 'email-signup-verification',
    name: 'Signup verification email',
    description: 'Creates a throwaway user and sends the normal signup verification email to the configured plus-alias test recipient.',
    group: 'email',
    method: 'POST',
    path: '/api/v1/auth/register',
    mutates: true,
    emailSend: true,
    timeoutMs: 30000,
    body: uniqueEmailRegisterBody,
    expect: expectJson(
      [200],
      (body) => {
        return body?.ok === true && body?.user?.emailVerified === false && typeof body?.user?.email === 'string' && body.user.email.includes('@');
      },
      'Signup created an unverified user and triggered verification email delivery.'
    )
  },
  {
    id: 'email-service-account-verification',
    name: 'Service account verification email',
    description: 'Creates a throwaway service account and sends the service-account verification email to the configured plus-alias test recipient.',
    group: 'email',
    method: 'POST',
    path: '/api/v1/auth/service-account',
    mutates: true,
    emailSend: true,
    timeoutMs: 30000,
    body: uniqueEmailServiceAccountBody,
    expect: expectJson(
      [200, 429, 503],
      (body, response) => {
        if (response.status !== 200) return body?.ok === false && typeof body?.error === 'string';
        const payload = decodeJwtPayload(body?.accessToken);
        return (
          body?.ok === true &&
          body?.user?.accountKind === 'service' &&
          body?.user?.emailVerified === false &&
          body?.tokenType === 'Bearer' &&
          !Object.prototype.hasOwnProperty.call(payload || {}, 'exp')
        );
      },
      'Service account was created and triggered verification email delivery (or the per-IP provisioning limit answered with an error shape).'
    )
  },
  {
    id: 'email-otp-helper',
    name: 'Email OTP helper',
    description: 'Dev/preview-only check for the OTP email renderer and delivery helper.',
    group: 'email',
    method: 'POST',
    path: '/api/v1/email/test-otp',
    mutates: true,
    emailSend: true,
    timeoutMs: 30000,
    body: uniqueEmailOtpBody,
    expect: expectJson(
      // 403 outside dev/preview; 400 if the env's test recipient differs from
      // the fallback used before /email/config resolves; otherwise the helper
      // ran — any terminal delivery status with a real outbox id is a pass (a
      // sandbox can legitimately report 'failed'/'skipped' for an unverified
      // recipient while still exercising the renderer + outbox path)
      [200, 400, 403],
      (body, response) =>
        response.status === 403 ||
        response.status === 400 ||
        (body?.ok === true &&
          ['sent', 'logged', 'failed', 'skipped'].includes(body?.result?.status) &&
          typeof body?.result?.emailMessageId === 'string'),
      'OTP helper exercised the delivery path (any terminal status), was recipient-rejected (400), or blocked outside local/preview (403).'
    )
  },
  {
    id: 'crypto-standards',
    name: 'Crypto standards',
    description: 'Crypto helper exposes supported standards.',
    group: 'crypto',
    method: 'GET',
    path: '/api/v1/crypto',
    expect: expectJson([200], (body) => body?.ok === true && Array.isArray(body?.standards), 'Crypto standards returned.')
  },
  {
    id: 'crypto-unknown-action',
    name: 'Crypto unknown action',
    description: 'Crypto helper rejects unsupported action intents.',
    group: 'crypto',
    method: 'POST',
    path: '/api/v1/crypto',
    body: { intent: 'thingtime-test-unknown-action' },
    expect: expectJson([400], (body) => body?.ok === false && Boolean(body?.error), 'Unknown crypto action rejected.')
  },
  {
    id: 'teapot-418',
    name: 'Teapot declines to brew',
    description: 'The hidden RFC 2324 endpoint answers 418 with a brew-time haiku, and its -docs twin is real.',
    group: 'health',
    method: 'GET',
    path: '/api/v1/teapot',
    expect: expectJson(
      [418],
      (body) => body?.ok === false && typeof body?.haiku === 'string' && /🫖/.test(body.haiku),
      'The teapot returned 418 with a haiku.'
    )
  },
  {
    id: 'unknown-endpoint-lopu-404',
    name: 'Unknown endpoints speak Lopu',
    description: 'A missing API path returns the standard {ok:false, error} envelope in Lopu voice, not a bare text 404.',
    group: 'health',
    method: 'GET',
    path: '/api/v1/definitely-not-a-real-endpoint',
    expect: expectJson(
      [404],
      (body) => body?.ok === false && typeof body?.error === 'string' && body.error.includes('Lopu'),
      'The 404 envelope is JSON and Lopu-voiced.'
    )
  },
  {
    id: 'health-frontend',
    name: 'Frontend health',
    description: 'Frontend health checks the app shell.',
    group: 'health',
    method: 'GET',
    path: '/api/v1/health/frontend',
    timeoutMs: 15000,
    expect: expectJson([200], (body) => body?.service === 'frontend' && typeof body?.ok === 'boolean', 'Frontend health returned.')
  },
  {
    id: 'health-mongodb',
    name: 'MongoDB health',
    description: 'MongoDB health returns connection status without throwing.',
    group: 'health',
    method: 'GET',
    path: '/api/v1/health/mongodb',
    timeoutMs: 15000,
    expect: expectJson([200], (body) => typeof body?.connected === 'boolean', 'MongoDB health returned.')
  },
  {
    id: 'health-nitro',
    name: 'Nitro health',
    description: 'Nitro health returns local API readiness.',
    group: 'health',
    method: 'GET',
    path: '/api/v1/health/nitro',
    expect: expectJson([200], (body) => body?.service === 'nitro' && body?.state === 'ready', 'Nitro health returned ready.')
  },
  {
    id: 'health-vercel',
    name: 'Vercel health',
    description: 'Vercel health returns deployment status or a configured fallback shape.',
    group: 'health',
    method: 'GET',
    path: '/api/v1/health/vercel',
    timeoutMs: 15000,
    expect: expectJson([200], (body) => isObject(body) && typeof body?.state === 'string', 'Vercel health returned a status shape.')
  },
  {
    id: 'lopu-musing-stream',
    name: 'Lopu musing stream',
    description: 'Lopu musing streams NDJSON fallback or provider events.',
    group: 'lopu',
    method: 'GET',
    path: '/api/v1/lopu/musing',
    timeoutMs: 20000,
    expect: expectNdjson()
  },
  {
    id: 'mongodb-status',
    name: 'MongoDB status',
    description: 'MongoDB status route returns connection status.',
    group: 'mongodb',
    method: 'GET',
    path: '/api/v1/mongodb/status',
    timeoutMs: 15000,
    expect: expectJson([200], (body) => typeof body?.connected === 'boolean', 'MongoDB status returned.')
  },
  {
    id: 'mongodb-status-data',
    name: 'MongoDB status-data',
    description: 'Resource-only MongoDB status endpoint returns JSON.',
    group: 'mongodb',
    method: 'GET',
    path: '/api/v1/mongodb/status-data',
    timeoutMs: 15000,
    expect: expectJson([200], (body) => typeof body?.connected === 'boolean', 'MongoDB status-data returned.')
  },
  {
    id: 'mongodb-get-connection',
    name: 'MongoDB connection config',
    description: 'Connection helper returns sanitized host information or a config error.',
    group: 'mongodb',
    method: 'POST',
    path: '/api/v1/mongodb/get-connection',
    body: {},
    expect: expectStatus([200, 500], 'MongoDB get-connection route responded.')
  },
  {
    id: 'mongodb-query-capabilities',
    name: 'MongoDB query capabilities',
    description: 'The no-code query capability catalogue is admin-only and never exposes connection details.',
    group: 'mongodb',
    method: 'GET',
    path: '/api/v1/mongodb/raw-results',
    expect: expectJson(
      [200, 401, 403],
      (body, response) =>
        response.status === 200
          ? body?.ok === true && Array.isArray(body?.collections) && Array.isArray(body?.operations) && !('connectionString' in body)
          : body?.ok === false && typeof body?.error === 'string',
      'MongoDB query capabilities were returned or correctly admin-gated.'
    )
  },
  {
    id: 'mongodb-raw-results',
    name: 'MongoDB bounded query',
    description: 'Runs a bounded find for admins and rejects non-admin callers.',
    group: 'mongodb',
    method: 'POST',
    path: '/api/v1/mongodb/raw-results',
    body: { collection: 'things', operation: 'find', filter: {}, limit: 1, maxTimeMS: 5000 },
    timeoutMs: 15000,
    expect: expectJson(
      [200, 401, 403, 429, 503],
      (body, response) =>
        response.status === 200
          ? body?.ok === true && Array.isArray(body?.results) && body.results.length <= 1
          : body?.ok === false && typeof body?.error === 'string',
      'MongoDB query ran within its limit or returned the expected guard/environment response.'
    )
  },
  {
    id: 'mongodb-populate',
    name: 'MongoDB populate',
    description: 'Runs the MongoDB seed path through the real API utilities.',
    group: 'mongodb',
    method: 'POST',
    path: '/api/v1/mongodb/populate',
    mutates: true,
    body: {},
    timeoutMs: 30000,
    // 200/500 as admin; 401 anonymous; 403 when the suite's earlier auth tests
    // left an ordinary (non-admin) session cookie — all are correct behavior
    expect: expectStatus([200, 401, 403, 500], 'MongoDB populate ran (admin) or was rejected (non-admin).')
  },
  {
    id: 'template-action',
    name: 'Template action',
    description: 'Template route action returns the expected test response.',
    group: 'template',
    method: 'POST',
    path: '/api/v1/template',
    body: {},
    expect: expectStatus([200], 'Template action responded.')
  },
  {
    id: 'vercel-status',
    name: 'Vercel status',
    description: 'Vercel status returns deployment status where enabled.',
    group: 'vercel',
    method: 'GET',
    path: '/api/v1/vercel/status',
    timeoutMs: 15000,
    expect: expectStatus([200, 404], 'Vercel status route responded with enabled or intentionally hidden status.')
  },
  {
    id: 'vercel-status-data',
    name: 'Vercel status-data',
    description: 'Resource-only Vercel status route returns deployment status where enabled.',
    group: 'vercel',
    method: 'GET',
    path: '/api/v1/vercel/status-data',
    timeoutMs: 15000,
    expect: expectStatus([200, 404], 'Vercel status-data route responded with enabled or intentionally hidden status.')
  },
  {
    id: 'vercel-deployments',
    name: 'Vercel deployments',
    description: 'Deployment overview route returns branch deployment data where enabled.',
    group: 'vercel',
    method: 'GET',
    path: '/api/v1/vercel/deployments?limit=5',
    timeoutMs: 20000,
    expect: expectStatus([200, 404], 'Vercel deployments route responded with enabled or intentionally hidden status.')
  },
  {
    id: 'themes-list-guarded',
    name: 'Themes list requires auth',
    description: 'Listing saved themes without a session is rejected with a 401 error shape.',
    group: 'themes',
    method: 'GET',
    path: '/api/v1/themes',
    expect: expectJson(
      [200, 401],
      (body) => body?.ok === true || (body?.ok === false && typeof body?.error === 'string'),
      'Themes list returned themes for a session or a 401 error shape anonymously.'
    )
  },
  {
    id: 'themes-save-guarded',
    name: 'Theme save requires auth',
    description: 'Saving a theme without a session is rejected (401) or accepted for a logged-in tester (ok shape).',
    group: 'themes',
    method: 'POST',
    path: '/api/v1/themes',
    mutates: true,
    body: { name: 'API test theme', visibility: 'private', theme: { colors: { accent: '#ff7e00' } } },
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && body?.theme?.id) || (body?.ok === false && typeof body?.error === 'string'),
      'Theme save either persisted (session) or was rejected with an error shape (anonymous).'
    )
  },
  {
    id: 'themes-shared-not-found',
    name: 'Shared theme unknown id',
    description: 'Unknown share ids resolve to a 404 error shape without leaking private themes.',
    group: 'themes',
    method: 'GET',
    path: '/api/v1/themes/shared?id=not-a-real-theme-id',
    expect: expectJson([404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unknown shared theme id returned a 404 error shape.')
  },
  {
    id: 'themes-active-guarded',
    name: 'Active theme requires auth',
    description: 'Setting the active theme without a session is rejected with a 401 error shape.',
    group: 'themes',
    method: 'POST',
    path: '/api/v1/themes/active',
    mutates: true,
    body: { themeId: null },
    expect: expectJson(
      [200, 401],
      (body) => body?.ok === true || (body?.ok === false && typeof body?.error === 'string'),
      'Active theme endpoint enforced auth (or cleared for a session).'
    )
  },
  {
    id: 'themes-delete-guarded',
    name: 'Theme delete requires auth',
    description: 'Deleting a theme without a session (or an unknown id) is rejected with an error shape.',
    group: 'themes',
    method: 'POST',
    path: '/api/v1/themes/delete',
    mutates: true,
    body: { id: 'not-a-real-theme-id' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Theme delete was rejected with an error shape.')
  },
  {
    id: 'embed-things-public-missing',
    name: 'Embedded thing public reads are bounded',
    description: 'An unknown embedded thing returns the public CORS error shape without exposing private data.',
    group: 'embed',
    method: 'GET',
    path: '/api/v1/embed/things?id=definitely-not-a-real-embedded-thing',
    expect: expectJson(
      [404],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Unknown embedded thing returned a 404 error shape.'
    )
  },
  {
    id: 'embed-things-create-guarded',
    name: 'Embedded thing writes require auth',
    description: 'Creating embedded data without a session is rejected before anything is written.',
    group: 'embed',
    method: 'POST',
    path: '/api/v1/embed/things',
    mutates: true,
    body: { name: 'API test embed', value: { hello: 'world' }, visibility: 'private' },
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && body?.thing?.id) || (body?.ok === false && typeof body?.error === 'string'),
      'Embedded thing creation either persisted for a session or returned an auth error.'
    )
  },
  {
    id: 'embed-things-json-only',
    name: 'Embedded thing writes require JSON',
    description: 'Safelisted text/plain requests are rejected before cookie authentication, closing the simple-request CSRF path.',
    group: 'embed',
    method: 'POST',
    path: '/api/v1/embed/things',
    body: { name: 'Must not save', value: { hello: 'world' } },
    headers: { 'Content-Type': 'text/plain' },
    expect: expectJson(
      [415],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Embedded thing writes rejected a non-JSON content type.'
    )
  },
  {
    id: 'things-feed-public',
    name: 'Feed lists public posts',
    description: 'The feed route responds anonymously with a posts page shape.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things/feed?limit=5',
    expect: expectJson(
      [200],
      (body) =>
        body?.ok === true &&
        Array.isArray(body?.posts) &&
        Object.prototype.hasOwnProperty.call(body, 'nextCursor') &&
        typeof body?.ranked === 'boolean',
      'Feed returned a posts page with cursor + ranked flag.'
    )
  },
  {
    id: 'things-quota-read-service-guarded',
    name: 'Service quota read requires service credentials',
    description: 'Anonymous callers cannot inspect an owner-scoped service quota.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things/quota?key=api-test',
    // 401 anonymous, 403 when an ordinary session cookie from earlier auth
    // tests is present — either way, no service credentials → no quota access
    expect: expectJson(
      [401, 403],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Quota read without service credentials was rejected.'
    )
  },
  {
    id: 'things-quota-write-service-guarded',
    name: 'Service quota write requires service credentials',
    description: 'Anonymous callers cannot reserve quota or initialize a quota Thing.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/quota',
    body: {
      key: 'api-test',
      operation: 'reserve',
      reservationId: 'api-test-reservation',
      count: 1,
      policy: { dailyLimit: 1, rollingLimit: 1, rollingWindowMs: 1_000 }
    },
    expect: expectJson(
      [401, 403],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Quota write without service credentials was rejected before initialization.'
    )
  },
  {
    id: 'things-feed-filtered',
    name: 'Feed honours type filter',
    description: 'Filtering by marketplace type returns only marketplace posts.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things/feed?types=marketplace&circles=public&limit=5',
    expect: expectJson(
      [200],
      (body) => body?.ok === true && Array.isArray(body?.posts) && body.posts.every((post: any) => post?.type === 'marketplace'),
      'Filtered feed only contained marketplace posts.'
    )
  },
  {
    id: 'things-feed-tag-filtered',
    name: 'Feed honours tag filter',
    description: 'Filtering by a tag returns only posts carrying that tag (normalized), and an unused tag returns an empty page.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things/feed?tag=Tt-Api-Test-Definitely-Unused-Tag&circles=public&limit=5',
    expect: expectJson(
      [200],
      (body) => body?.ok === true && Array.isArray(body?.posts) && body.posts.length === 0,
      'Feed filtered by an unused tag (mixed case in the query) returned ok with zero posts.'
    )
  },
  {
    id: 'things-create-guarded',
    name: 'Post create requires auth',
    description: 'Creating a post without a session is rejected (401) or accepted for a logged-in tester.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things',
    mutates: true,
    body: { type: 'text', text: 'API test post from the tests page 🧪', visibility: 'private' },
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && body?.post?.id) || (body?.ok === false && typeof body?.error === 'string'),
      'Post create either persisted (session) or was rejected with an error shape (anonymous).'
    )
  },
  {
    id: 'things-data-relationship-names-open',
    name: 'Data crystals may carry relationship key names',
    description:
      'Relationship dedupe rides the server-only root uniqueKeys namespace, so a data thing carrying followKey (or memberKey, dmKey, …) at its crystal root is ordinary user data: it enters no unique index, squats nothing, and saves normally (401 anonymous).',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things',
    mutates: true,
    body: { thingtime: ['data'], crystal: { followKey: 'just:data', memberKey: 'mine', note: 'relationship names are not reserved' }, visibility: 'private' },
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && (body?.thing?.id || body?.post?.id)) || (body?.ok === false && typeof body?.error === 'string'),
      'Relationship names saved as ordinary data (or 401 anonymous).'
    )
  },
  {
    id: 'things-user-missing-username',
    name: 'User posts require a username',
    description: 'The user-posts route validates the username parameter.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things/user',
    expect: expectJson([400], (body) => body?.ok === false && typeof body?.error === 'string', 'Missing username rejected with a 400 error shape.')
  },
  {
    id: 'things-user-unknown',
    name: 'User posts unknown user',
    description: 'Unknown usernames resolve to a 404 error shape.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things/user?username=definitely-not-a-real-user-xyz',
    expect: expectJson([404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unknown user returned a 404 error shape.')
  },
  {
    id: 'things-react-guarded',
    name: 'Reactions are guarded',
    description: 'Reacting without a session (or to an unknown post) is rejected with an error shape.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/react',
    body: { id: 'not-a-real-post-id', emoji: '👍' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Reaction was rejected with an error shape.')
  },
  {
    id: 'things-react-invalid-emoji',
    name: 'Reaction tokens must be emoji',
    description: 'A non-emoji reaction token is rejected (400) before touching the post; anonymous callers get 401.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/react',
    body: { id: 'not-a-real-post-id', emoji: 'not-an-emoji' },
    expect: expectJson(
      [400, 401],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Non-emoji reaction token was rejected with an error shape.'
    )
  },
  {
    id: 'things-reactions-recent',
    name: 'Recent reactions list',
    description: 'The recent-reactions route returns an array (empty for anonymous callers).',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things/reactions-recent',
    expect: expectJson([200], (body) => body?.ok === true && Array.isArray(body?.recentReactions), 'Recent reactions returned an array.')
  },
  {
    id: 'tiers-public-live-catalog',
    name: 'Public live tier catalog',
    description: 'The tier-card catalog returns only selectable live revisions with immutable version identities and rich inclusions.',
    group: 'apps',
    method: 'GET',
    path: '/api/v1/tiers',
    expect: expectJson(
      [200],
      (body) =>
        body?.ok === true &&
        Array.isArray(body?.tiers) &&
        body.tiers.length > 0 &&
        new Set(body.tiers.map((tier: any) => tier?.versionId)).size === body.tiers.length &&
        body.tiers.every(
          (tier: any) =>
            typeof tier?.id === 'string' &&
            typeof tier?.versionId === 'string' &&
            Number.isSafeInteger(tier?.version) &&
            tier.version > 0 &&
            tier.status === 'live' &&
            isObject(tier?.prices) &&
            isObject(tier?.discounts) &&
            tier?.inclusions?.kind === 'rich-text' &&
            Array.isArray(tier.inclusions.blocks) &&
            isObject(tier?.quotas)
        ),
      'Public catalog returned unique, live, versioned tier cards.'
    )
  },
  {
    id: 'users-follow-auth-required',
    name: 'Follow requires auth',
    description: 'POST /users/follow rejects anonymous callers (401) or unknown targets (404) with an error shape.',
    group: 'social',
    method: 'POST',
    path: '/api/v1/users/follow',
    body: { username: 'not-a-real-user-xyz' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Follow was rejected with an error shape.')
  },
  {
    id: 'users-friend-auth-required',
    name: 'Friend intents require auth',
    description: 'POST /users/friend rejects anonymous callers (401) or unknown targets (404) with an error shape.',
    group: 'social',
    method: 'POST',
    path: '/api/v1/users/friend',
    body: { username: 'not-a-real-user-xyz', intent: 'request' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Friend intent was rejected with an error shape.')
  },
  {
    id: 'users-relationships-unknown-404',
    name: 'Relationships 404s unknown users',
    description: 'GET /users/relationships works logged out and 404s an unknown username.',
    group: 'social',
    method: 'GET',
    path: '/api/v1/users/relationships?username=not-a-real-user-xyz',
    expect: expectJson([404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unknown user 404ed with an error shape.')
  },
  {
    id: 'users-connections-bad-type',
    name: 'Connections validates type',
    description: 'GET /users/connections rejects an unsupported type with 400 (or 404 for unknown user first).',
    group: 'social',
    method: 'GET',
    path: '/api/v1/users/connections?username=not-a-real-user-xyz&type=nonsense',
    expect: expectJson([400, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Bad connections request was rejected.')
  },
  {
    id: 'notifications-auth-required',
    name: 'Notifications list requires auth',
    description: 'GET /notifications is per-user — anonymous callers get 401; authed callers get their list + unreadCount.',
    group: 'notifications',
    method: 'GET',
    path: '/api/v1/notifications',
    expect: expectJson(
      [200, 401],
      (body) =>
        body?.ok === false
          ? typeof body?.error === 'string'
          : Array.isArray(body?.notifications) && typeof body?.unreadCount === 'number',
      'Notifications returned a list + unreadCount (or 401 anonymous).'
    )
  },
  {
    id: 'notifications-settings-shape',
    name: 'Notification settings shape',
    description:
      'GET /notifications/settings returns the per-channel matrix — push + email per type plus channel masters (or 401 anonymous).',
    group: 'notifications',
    method: 'GET',
    path: '/api/v1/notifications/settings',
    expect: expectJson(
      [200, 401],
      (body) =>
        body?.ok === false
          ? typeof body?.error === 'string'
          : body?.prefs &&
            typeof body.prefs.push?.['new-follower'] === 'boolean' &&
            typeof body.prefs.push?.['friend-request'] === 'boolean' &&
            typeof body.prefs.email?.['weekly-summary'] === 'boolean' &&
            body.prefs.email?.['post-from-followed'] !== undefined &&
            typeof body.prefs.masters?.push === 'boolean' &&
            typeof body.prefs.masters?.email === 'boolean',
      'Notification settings returned the full channel matrix (or 401 anonymous).'
    )
  },
  {
    id: 'notifications-email-unsubscribe-bad-token',
    name: 'Email unsubscribe rejects bad links',
    description:
      'GET /notifications/email/unsubscribe with a bogus uid+token pair is refused (400 page) instead of flipping anything.',
    group: 'notifications',
    method: 'GET',
    path: '/api/v1/notifications/email/unsubscribe?uid=nobody&token=bogus',
    expect: expectStatus([400, 429], 'Unsubscribe refused the invalid token (or was rate limited).')
  },
  {
    id: 'notifications-weekly-summary-auth-required',
    name: 'Weekly summary run is gated',
    description:
      'GET /notifications/email/weekly-summary?dryRun=1 — anonymous/non-admin callers are refused; an admin gets a dry-run preview (dryRun keeps a /tests run from sending real digests).',
    group: 'notifications',
    method: 'GET',
    path: '/api/v1/notifications/email/weekly-summary?dryRun=1',
    expect: expectJson(
      [200, 401, 403],
      (body) =>
        body?.ok === false
          ? typeof body?.error === 'string'
          : typeof body?.sent === 'number' && body?.dryRun === true,
      'Weekly summary run was gated (or dry-ran for an admin without sending).'
    )
  },
  {
    id: 'things-views-anonymous-ok',
    name: 'View telemetry accepts anonymous batches',
    description:
      'POST /things/views works logged out (identity = salted ip+UA hash); unknown post ids are silently dropped, so counted is 0 here.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/views',
    body: { events: [{ id: 'not-a-real-post-id', dwellMs: 1200, ratio: 1, pos: 0.4 }] },
    expect: expectJson(
      [200, 429],
      (body) => body?.ok === true ? typeof body?.counted === 'number' : typeof body?.error === 'string',
      'View batch was accepted (unknown ids dropped) or rate-limited.'
    )
  },
  {
    id: 'things-search-null-condition',
    name: 'Search rejects null conditions',
    description: 'A conditions list carrying null is rejected with a 400 error shape instead of a 500.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/search',
    body: { conditions: [null] },
    expect: expectJson([400], (body) => body?.ok === false && typeof body?.error === 'string', 'Null condition entry was rejected with a 400 error shape.')
  },
  {
    id: 'admin-rate-limits-guarded',
    name: 'Rate-limit config is admin-only',
    description: 'Reading the global rate-limit config requires an admin session.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/rate-limits',
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin rate-limit read was rejected.')
  },
  {
    id: 'admin-users-guarded',
    name: 'Admin user lookup is admin-only',
    description: 'The admin user lookup requires an admin session.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/users',
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin user lookup was rejected.')
  },
  {
    id: 'admin-set-admin-guarded',
    name: 'Promote/demote is admin-only',
    description: 'Setting a user admin flag requires an admin session.',
    group: 'admin',
    method: 'POST',
    path: '/api/v1/admin/set-admin',
    body: { userId: '000000000000000000000000', admin: true },
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin promote attempt was rejected.')
  },
  {
    id: 'admin-moderation-guarded',
    name: 'Moderation queue is admin-only',
    description: 'Reading the NSFW/TOS moderation review queue requires an admin session.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/moderation',
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin moderation read was rejected.')
  },
  {
    id: 'admin-moderation-review-guarded',
    name: 'Moderation review is admin-only',
    description: 'Overriding a moderation verdict requires an admin session.',
    group: 'admin',
    method: 'POST',
    path: '/api/v1/admin/moderation',
    body: { action: 'review', attachmentId: '000000000000000000000000', verdict: 'block' },
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin review attempt was rejected.')
  },
  {
    id: 'admin-integrations-guarded',
    name: 'Integration vault is admin-only',
    description: 'Listing external secret metadata and endpoint policies requires an admin session.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/integrations',
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin integration vault read was rejected.')
  },
  {
    id: 'admin-users-overview-guarded',
    name: 'Users overview is admin-only',
    description: 'The /admin Users tab data requires an admin session.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/users/overview',
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin users overview was rejected.')
  },
  {
    id: 'admin-apps-guarded',
    name: 'Apps overview is admin-only',
    description: 'The cross-user apps overview requires an admin session.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/apps',
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin apps overview was rejected.')
  },
  {
    id: 'admin-apps-revoke-guarded',
    name: 'App suspension is admin-only',
    description: 'Suspending an app requires an admin session.',
    group: 'admin',
    method: 'POST',
    path: '/api/v1/admin/apps/revoke',
    body: { clientId: 'ttapp_00000000-0000-0000-0000-000000000000', revoked: true },
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin suspension attempt was rejected.')
  },
  {
    id: 'admin-tiers-read-guarded',
    name: 'Tier version history is admin-only',
    description: 'Reading live, draft, and archived tier revisions requires an admin session.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/tiers',
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin tier-history read was rejected.')
  },
  {
    id: 'admin-tiers-write-guarded',
    name: 'Tier lifecycle is admin-only',
    description: 'Tier lifecycle actions require an admin session; the fixture uses an unknown revision so it cannot archive a real tier.',
    group: 'admin',
    method: 'POST',
    path: '/api/v1/admin/tiers',
    body: { action: 'archive', versionId: 'not-a-real-tier-version' },
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin tier lifecycle attempt was rejected.')
  },
  {
    id: 'admin-subscriptions-guarded',
    name: 'Subscriptions are admin-only',
    description: 'Assigning tiers/overrides requires an admin session.',
    group: 'admin',
    method: 'POST',
    path: '/api/v1/admin/subscriptions',
    body: {
      subjectType: 'user',
      subjectId: '000000000000000000000000',
      tier: 'not-a-real-tier',
      tierVersionId: 'not-a-real-tier-version'
    },
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin tier assignment was rejected.')
  },
  {
    id: 'admin-links-guarded',
    name: 'Ownership links are admin-only',
    description: 'Assigning account/app ownership links requires an admin session.',
    group: 'admin',
    method: 'POST',
    path: '/api/v1/admin/links',
    body: { action: 'add', linkKind: 'account', userId: '000000000000000000000000', targetId: '000000000000000000000001' },
    expect: expectJson([401, 403], (body) => body?.ok === false && typeof body?.error === 'string', 'Non-admin link assignment was rejected.')
  },
  {
    id: 'auth-accounts-owned-guarded',
    name: 'Owned accounts need a session',
    description: 'Listing owned accounts anonymously is rejected.',
    group: 'auth',
    method: 'GET',
    path: '/api/v1/auth/accounts/owned',
    // strict [401] needs a truly session-less request — with the suite's
    // shared cookie state an earlier registration would make this a 200
    anonymous: true,
    expect: expectJson([401], (body) => body?.ok === false && typeof body?.error === 'string', 'Anonymous owned-accounts read was rejected.')
  },
  {
    id: 'auth-accounts-assume-guarded',
    name: 'Assume needs a session + link',
    description: 'Assuming an account anonymously is rejected.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/accounts/assume',
    body: { accountId: '000000000000000000000000' },
    // strict [401] needs a truly session-less request — with the suite's
    // shared cookie state an earlier registration would make this a 403
    anonymous: true,
    expect: expectJson([401], (body) => body?.ok === false && typeof body?.error === 'string', 'Anonymous assume attempt was rejected.')
  },
  {
    id: 'things-comment-guarded',
    name: 'Comments are guarded',
    description: 'Commenting without a session (or on an unknown post) is rejected with an error shape.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/comment',
    body: { id: 'not-a-real-post-id', text: 'API test comment' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Comment was rejected with an error shape.')
  },
  {
    id: 'things-comment-rich-guarded',
    name: 'Rich comments are guarded',
    description: 'Post-shaped comments (images/listing payloads) go through the same auth + visibility gate.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/comment',
    body: { id: 'not-a-real-post-id', type: 'image', text: 'API test rich comment', images: ['https://example.com/x.jpg'] },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Rich comment was rejected with an error shape.')
  },
  {
    id: 'things-get-missing',
    name: 'Single thing lookup 404s cleanly',
    description: 'The /post/:id backing read rejects unknown ids with an error shape.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things?id=not-a-real-post-id',
    expect: expectJson([404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unknown thing returned a 404 error shape.')
  },
  {
    id: 'things-share-guarded',
    name: 'Shares are guarded',
    description: 'Sharing without a session (or an unknown post) is rejected with an error shape.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/share',
    body: { id: 'not-a-real-post-id' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Share was rejected with an error shape.')
  },
  {
    id: 'things-delete-guarded',
    name: 'Thing delete is guarded',
    description: 'Deleting without a session (or an unknown/unowned thing) is rejected with an error shape.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/delete',
    body: { id: 'not-a-real-post-id' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Thing delete was rejected with an error shape.')
  },
  {
    id: 'things-read-unknown',
    name: 'Thing read unknown id',
    description: 'Reading an unknown thing id resolves to a 404 error shape.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things?id=not-a-real-thing-id',
    expect: expectJson([404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unknown thing returned a 404 error shape.')
  },
  {
    id: 'things-list-own-guarded',
    name: 'Own-things list requires auth',
    description: 'Listing your own things without a session is rejected; with a session it returns a things array.',
    group: 'things',
    method: 'GET',
    path: '/api/v1/things?limit=5',
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && Array.isArray(body?.things)) || (body?.ok === false && typeof body?.error === 'string'),
      'Own-things list either returned things (session) or was rejected (anonymous).'
    )
  },
  {
    id: 'things-update-guarded',
    name: 'Thing update is guarded',
    description: 'Updating without a session (or an unknown/unowned thing) is rejected with an error shape.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/update',
    body: { id: 'not-a-real-post-id', crystal: { text: 'edited' } },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Thing update was rejected with an error shape.')
  },
  {
    id: 'things-patch-guarded',
    name: 'Unified PATCH is guarded',
    description: 'PATCH /things without a session (or an unknown/unowned thing) is rejected with an error shape.',
    group: 'things',
    method: 'PATCH',
    path: '/api/v1/things',
    body: { id: 'not-a-real-post-id', crystal: { text: 'edited' } },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unified PATCH was rejected with an error shape.')
  },
  {
    id: 'things-put-guarded',
    name: 'Unified PUT upsert is guarded',
    description: 'PUT /things without a session is rejected; with one it needs an id and valid payload.',
    group: 'things',
    method: 'PUT',
    path: '/api/v1/things',
    mutates: true,
    body: { id: 'api-test-upsert-001', thingtime: ['post'], crystal: { type: 'text', text: 'API test upsert 🧪' }, acl: ['tt:user'] },
    // 404: a session cookie from earlier auth tests is present but this id
    // doesn't exist / isn't owned by that throwaway user — still a guarded no
    expect: expectJson(
      [200, 201, 401, 404],
      (body) => (body?.ok === true && typeof body?.created === 'boolean') || (body?.ok === false && typeof body?.error === 'string'),
      'Unified PUT either upserted (session) or was rejected with an error shape.'
    )
  },
  {
    id: 'things-delete-unified-guarded',
    name: 'Unified DELETE is guarded',
    description: 'DELETE /things?id= without a session (or an unknown/unowned thing) is rejected with an error shape.',
    group: 'things',
    method: 'DELETE',
    path: '/api/v1/things?id=not-a-real-post-id',
    expect: expectJson(
      [401, 404],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Unified DELETE was rejected with an error shape.'
    )
  },
  {
    id: 'things-acl-validated',
    name: 'ACL entries are validated',
    description: 'Malformed acl entries are rejected with a 400 error shape (401 anonymous).',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things',
    body: { thingtime: ['post'], crystal: { type: 'text', text: 'acl test' }, acl: ['not-a-permission'] },
    expect: expectJson([400, 401], (body) => body?.ok === false && typeof body?.error === 'string', 'Malformed acl was rejected with an error shape.')
  },
  {
    id: 'things-schemaless-extended-roundtrip',
    name: 'Schema-less crystal + extended round-trip',
    description:
      'POST without thingtime defaults to ["data"], and the schema-free extended sidecar is stored and returned exactly as given (session) — or rejected anonymously.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things',
    mutates: true,
    body: {
      crystal: { name: 'tt-api-test-desk', legs: 4, material: 'wood' },
      extended: { anyShape: true, nested: [1, 'two', { three: 3 }], 'weird key 🔑': 'kept verbatim' },
      acl: ['tt:user'],
      tags: ['tt-api-test']
    },
    expect: expectJson(
      [200, 401, 429],
      (body, response) =>
        response.status !== 200
          ? body?.ok === false && typeof body?.error === 'string'
          : body?.ok === true &&
            Array.isArray(body?.thing?.thingtime) &&
            body.thing.thingtime.includes('data') &&
            body?.thing?.extended?.anyShape === true &&
            body?.thing?.extended?.['weird key 🔑'] === 'kept verbatim' &&
            Array.isArray(body?.thing?.extended?.nested) &&
            body?.thing?.crystal?.legs === 4,
      'Schema-less create resolved to a data crystal and round-tripped extended verbatim (or was auth/rate limited).'
    )
  },
  {
    id: 'things-data-app-shaped-create',
    name: 'Data crystal may carry appId + key',
    description:
      'A free-form data thing whose crystal contains appId and key entries is stored (session) — these are ordinary user keys, not reserved app-data fields — or rejected anonymously.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things',
    mutates: true,
    body: { crystal: appShapedDataCrystal, acl: ['tt:user'], tags: ['tt-api-test'] },
    expect: expectJson(
      [200, 401, 429],
      (body, response) =>
        response.status !== 200
          ? body?.ok === false && typeof body?.error === 'string'
          : body?.ok === true &&
            Array.isArray(body?.thing?.thingtime) &&
            body.thing.thingtime.includes('data') &&
            body?.thing?.crystal?.appId === appShapedDataCrystal.appId &&
            body?.thing?.crystal?.key === appShapedDataCrystal.key,
      'Data thing with appId + key crystal entries persisted (or was auth/rate limited).'
    )
  },
  {
    id: 'things-data-app-shaped-duplicate',
    name: 'Duplicate app-shaped data crystals do not collide',
    description:
      'A second data thing with the SAME appId + key crystal values as the previous test also persists: the app-data unique index is scoped to thingtime app-data docs, so free-form data things never 409 against it (pre-scoping this returned a duplicate-key conflict).',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things',
    mutates: true,
    body: { crystal: appShapedDataCrystal, acl: ['tt:user'], tags: ['tt-api-test'] },
    expect: expectJson(
      [200, 401, 429],
      (body, response) =>
        response.status !== 200
          ? body?.ok === false && typeof body?.error === 'string'
          : body?.ok === true &&
            body?.thing?.crystal?.appId === appShapedDataCrystal.appId &&
            body?.thing?.crystal?.key === appShapedDataCrystal.key,
      'Second data thing with identical appId + key crystal values persisted alongside the first.'
    )
  },
  {
    id: 'things-extended-reserved-key-rejected',
    name: 'Extended rejects the reserved text-index key',
    description:
      'An extended payload carrying the tt:textLanguage key is rejected 400 (401 anonymous) — storing it would hijack or break the wildcard text index.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things',
    body: { crystal: { name: 'tt-api-test' }, extended: { 'tt:textLanguage': 'klingon' } },
    expect: expectJson(
      [400, 401, 429],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Reserved-key extended payload was rejected with an error shape.'
    )
  },
  {
    id: 'schemas-list',
    name: 'Schemas registry',
    description: 'The public schema registry returns every Thingtime Schema plus collection versions.',
    group: 'schemas',
    method: 'GET',
    path: '/api/v1/schemas',
    expect: expectJson(
      [200],
      (body) =>
        body?.ok === true &&
        Array.isArray(body?.schemas) &&
        body.schemas.some((schema: any) => schema?.id === 'thing' && schema?.kind === 'root') &&
        body.schemas.some((schema: any) => schema?.id === 'post' && schema?.kind === 'crystal') &&
        typeof body?.collectionVersions?.things === 'number',
      'Schema registry returned the root thing schema, crystal schemas, and collection versions.'
    )
  },
  {
    id: 'schemas-single',
    name: 'Single schema lookup',
    description: 'A schema id resolves to its full definition; unknown ids 404.',
    group: 'schemas',
    method: 'GET',
    path: '/api/v1/schemas?id=comment',
    expect: expectJson(
      [200],
      (body) => body?.ok === true && body?.schema?.id === 'comment' && Array.isArray(body?.schema?.fields),
      'Comment schema returned with its fields.'
    )
  },
  {
    id: 'schemas-unknown',
    name: 'Unknown schema id',
    description: 'Unknown schema ids resolve to a 404 error shape.',
    group: 'schemas',
    method: 'GET',
    path: '/api/v1/schemas?id=not-a-real-schema',
    expect: expectJson([404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unknown schema returned a 404 error shape.')
  },
  {
    id: 'schemas-browse-newest',
    name: 'Browse published schemas',
    description: 'The paginated UGC schema browser returns decorated entries (reactions, saved, usage).',
    group: 'schemas',
    method: 'GET',
    path: '/api/v1/schemas/browse?sort=newest&limit=5',
    expect: expectJson(
      [200],
      (body) =>
        body?.ok === true &&
        Array.isArray(body?.schemas) &&
        'nextCursor' in body &&
        body.schemas.every(
          (entry: any) =>
            typeof entry?.id === 'string' &&
            entry?.reactionCounts !== undefined &&
            Array.isArray(entry?.viewerReactions) &&
            typeof entry?.saved === 'boolean' &&
            typeof entry?.usageCount === 'number'
        ),
      'Browse returned decorated schema entries with a cursor field.'
    )
  },
  {
    id: 'schemas-browse-popular',
    name: 'Browse schemas by popularity',
    description: 'sort=popular ranks schema things by reaction count over a bounded window.',
    group: 'schemas',
    method: 'GET',
    path: '/api/v1/schemas/browse?sort=popular&limit=5',
    expect: expectJson([200], (body) => body?.ok === true && Array.isArray(body?.schemas), 'Popular browse returned a schema page.')
  },
  {
    id: 'schemas-browse-library-guarded',
    name: 'Library filter needs auth',
    description: 'library=1 returns the caller’s saved schemas when signed in and 401 anonymously.',
    group: 'schemas',
    method: 'GET',
    path: '/api/v1/schemas/browse?library=1',
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && Array.isArray(body?.schemas)) || (body?.ok === false && typeof body?.error === 'string'),
      'Library browse returned saved schemas (signed in) or the 401 error shape (anonymous).'
    )
  },
  {
    id: 'things-save-guarded',
    name: 'Library save needs auth + a real thing',
    description: 'POST /api/v1/things/save is 401 anonymous; signed in, a bogus id is 404.',
    group: 'things',
    method: 'POST',
    path: '/api/v1/things/save',
    body: { id: 'not-a-real-thing-id' },
    expect: expectJson(
      [401, 404],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Save toggle rejected the call with the expected error shape.'
    )
  },
  {
    id: 'admin-migrations-guarded',
    name: 'Migration status is admin-only',
    description: 'Non-admin callers get the same 401 as anonymous callers; admins see the version census.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/migrations',
    expect: expectJson(
      [200, 401, 403],
      (body) => (body?.ok === true && Array.isArray(body?.collections)) || (body?.ok === false && typeof body?.error === 'string'),
      'Migration status either returned the census (admin) or was rejected (non-admin).'
    )
  },
	{
		id: 'admin-migrations-diagnostic-guarded',
		name: 'Migration diagnostics are admin-only',
		description: 'Anonymous/non-admin callers are rejected; inaccessible ids are non-enumerating 404s for admins.',
		group: 'admin',
		method: 'GET',
		path: '/api/v1/admin/migrations/diagnostic?id=migration-diagnostic-00000000-0000-4000-8000-000000000000',
		anonymous: true,
		expect: expectJson(
			[401],
			(body) => body?.ok === false && body?.error === 'Unauthorized',
			'The registered diagnostic route rejected an anonymous caller with its admin guard.'
		)
	},
	{
		id: 'things-sensitive-reveal-guarded',
		name: 'Sensitive Thing reveal requires a full session',
		description: 'The password-confirmed reveal route rejects anonymous callers before reading the submitted password.',
		group: 'things',
		method: 'POST',
		path: '/api/v1/things/reveal',
		anonymous: true,
		body: {
			thingId: 'migration-diagnostic-00000000-0000-4000-8000-000000000000',
			reference: 'mongodb-object-id-1',
			password: 'not-read-without-a-session'
		},
		expect: expectJson(
			[401],
			(body) => body?.ok === false && body?.error === 'Unauthorized',
			'The registered sensitive reveal route rejected an anonymous caller before password confirmation.'
		)
	},
  {
    id: 'admin-migrations-run-guarded',
    name: 'Migration run is admin-only',
    description: 'Running a migration without admin access is rejected; admins get a dry-run report.',
    group: 'admin',
    method: 'POST',
    path: '/api/v1/admin/migrations/run',
    mutates: true,
    body: { migration: 'things-v1-to-v2', dryRun: true },
    expect: expectJson(
      [200, 401, 403],
      (body) => (body?.ok === true && body?.report?.dryRun === true) || (body?.ok === false && typeof body?.error === 'string'),
      'Dry-run either reported (admin) or was rejected (non-admin).'
    )
  },
  {
    id: 'algorithms-list-guarded',
    name: 'Algorithms list requires auth',
    description: 'Listing feed algorithms without a session is rejected with a 401 error shape.',
    group: 'algorithms',
    method: 'GET',
    path: '/api/v1/algorithms',
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && Array.isArray(body?.algorithms)) || (body?.ok === false && typeof body?.error === 'string'),
      'Algorithms list returned algorithms for a session or a 401 error shape anonymously.'
    )
  },
  {
    id: 'algorithms-create-validates',
    name: 'Algorithm create validates name',
    description: 'Creating an algorithm without a name is rejected before anything is written.',
    group: 'algorithms',
    method: 'POST',
    path: '/api/v1/algorithms',
    body: { name: '' },
    expect: expectJson(
      [400, 401],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Nameless algorithm rejected with an error shape.'
    )
  },
  {
    id: 'algorithms-active-guarded',
    name: 'Active algorithm requires auth',
    description: 'Switching the active algorithm without a session is rejected with a 401 error shape.',
    group: 'algorithms',
    method: 'POST',
    path: '/api/v1/algorithms/active',
    mutates: true,
    body: { algorithmId: null },
    expect: expectJson(
      [200, 401],
      (body) => body?.ok === true || (body?.ok === false && typeof body?.error === 'string'),
      'Active algorithm endpoint enforced auth (or cleared for a session).'
    )
  },
  {
    id: 'algorithms-track-validates',
    name: 'Tracking validates events',
    description: 'Tracking without events is rejected before any training happens.',
    group: 'algorithms',
    method: 'POST',
    path: '/api/v1/algorithms/track',
    body: { events: [] },
    expect: expectJson([400, 401], (body) => body?.ok === false && typeof body?.error === 'string', 'Empty event batch rejected with an error shape.')
  },
  {
    id: 'algorithms-update-guarded',
    name: 'Algorithm update is guarded',
    description: 'Updating without a session (or an unknown id) is rejected with an error shape.',
    group: 'algorithms',
    method: 'POST',
    path: '/api/v1/algorithms/update',
    body: { id: 'not-a-real-algorithm-id', name: 'renamed' },
    expect: expectJson(
      [401, 404],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Algorithm update was rejected with an error shape.'
    )
  },
  {
    id: 'algorithms-delete-guarded',
    name: 'Algorithm delete is guarded',
    description: 'Deleting without a session (or an unknown id) is rejected with an error shape.',
    group: 'algorithms',
    method: 'POST',
    path: '/api/v1/algorithms/delete',
    body: { id: 'not-a-real-algorithm-id' },
    expect: expectJson(
      [401, 404],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Algorithm delete was rejected with an error shape.'
    )
  },
  {
    id: 'profile-get-missing-username',
    name: 'Public profile requires a username',
    description: 'The public profile route validates the username parameter.',
    group: 'profile',
    method: 'GET',
    path: '/api/v1/users/profile',
    expect: expectJson([400], (body) => body?.ok === false && typeof body?.error === 'string', 'Missing username rejected with a 400 error shape.')
  },
  {
    id: 'profile-get-unknown',
    name: 'Public profile unknown user',
    description: 'Unknown usernames resolve to a 404 error shape.',
    group: 'profile',
    method: 'GET',
    path: '/api/v1/users/profile?username=definitely-not-a-real-user-xyz',
    expect: expectJson([404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unknown profile returned a 404 error shape.')
  },
  {
    id: 'profile-get-never-leaks-email',
    name: 'Public profile never leaks email',
    description: 'A seeded public profile responds without email/verification/storage fields.',
    group: 'profile',
    method: 'GET',
    path: '/api/v1/users/profile?username=rick.deckard',
    expect: expectJson(
      [200, 404],
      (body) =>
        (body?.ok === true &&
          body?.profile?.username === 'rick.deckard' &&
          !Object.prototype.hasOwnProperty.call(body.profile, 'email') &&
          !Object.prototype.hasOwnProperty.call(body.profile, 'emailVerified')) ||
        (body?.ok === false && typeof body?.error === 'string'),
      'Seeded profile exposed only public fields (or 404 when unseeded).'
    )
  },
  {
    id: 'profile-update-guarded',
    name: 'Profile update requires auth',
    description: 'Updating profile fields without a session is rejected with a 401 error shape.',
    group: 'profile',
    method: 'POST',
    path: '/api/v1/users/profile',
    mutates: true,
    body: { bio: 'API test bio 🧪' },
    expect: expectJson(
      [200, 401],
      (body) => body?.ok === true || (body?.ok === false && typeof body?.error === 'string'),
      'Profile update either persisted (session) or was rejected with an error shape (anonymous).'
    )
  },
  {
    id: 'waitlist-invalid-email',
    name: 'Waitlist rejects invalid email',
    description: 'The waitlist validates email addresses before writing anything.',
    group: 'waitlist',
    method: 'POST',
    path: '/api/v1/waitlist',
    body: { email: 'not-an-email' },
    expect: expectJson([400], (body) => body?.ok === false && typeof body?.error === 'string', 'Invalid email rejected with a 400 error shape.')
  },
  {
    id: 'waitlist-join',
    name: 'Waitlist join',
    description: 'Joining the waitlist through the real endpoint succeeds (idempotent fixed test email, no collection growth on re-runs).',
    group: 'waitlist',
    method: 'POST',
    path: '/api/v1/waitlist',
    mutates: true,
    body: { email: 'tt-api-test-waitlist@example.invalid' },
    expect: expectJson(
      [200, 429],
      (body) => body?.ok === true || typeof body?.error === 'string',
      'Waitlist join succeeded (or was rate-limited with an error shape).'
    )
  },
  {
    id: 'apps-desktop-authorize-guarded',
    name: 'Desktop authorization requires a session and complete PKCE request',
    description:
      'POST /api/v1/oauth/desktop/authorize is registered and rejects anonymous or incomplete installed-app consent requests before issuing a code.',
    group: 'apps',
    method: 'POST',
    path: '/api/v1/oauth/desktop/authorize',
    body: {},
    expect: expectJson(
      [400, 401, 429],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Desktop authorize rejected an unauthenticated/incomplete request with the bounded error envelope.'
    )
  },
  {
    id: 'apps-desktop-token-grant-type',
    name: 'Desktop token exchange rejects unsupported grants',
    description: 'POST /api/v1/oauth/token is registered and accepts only the authorization_code grant.',
    group: 'apps',
    method: 'POST',
    path: '/api/v1/oauth/token',
    body: { grantType: 'client_credentials' },
    expect: expectJson(
      [400, 429],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'Desktop token endpoint rejected an unsupported grant with the bounded error envelope.'
    )
  },
  {
    id: 'apps-sandbox-mint',
    name: 'Sandbox token mint',
    description:
      'POST /api/v1/oauth/sandbox mints a real revocable token for any clientId — the credential that exercises the full app-namespace surface pre-registration.',
    group: 'apps',
    method: 'POST',
    path: '/api/v1/oauth/sandbox',
    mutates: true,
    body: { clientId: 'ttapp_api_tests', scope: 'profile app-data' },
    expect: expectJson(
      [200, 429],
      (body) =>
        (body?.ok === true && body?.sandbox === true && typeof body?.token === 'string' && Array.isArray(body?.scopes)) ||
        typeof body?.error === 'string',
      'Sandbox mint returned a Bearer token + scopes (or was rate-limited with an error shape).'
    )
  },
  {
    id: 'apps-app-data-needs-token',
    name: 'App storage requires an app token',
    description: 'GET /api/v1/app-data rejects sessions and anonymous callers — the embed surface is app-Bearer-only.',
    group: 'apps',
    method: 'GET',
    path: '/api/v1/app-data',
    expect: expectJson([401], (body) => body?.ok === false, 'App-data without an app token is 401.')
  },
  {
    id: 'apps-usage-needs-token',
    name: 'Storage usage requires an app token',
    description: 'GET /api/v1/app-data/usage (the byte-budget ledger) is app-Bearer-only like the rest of the embed surface.',
    group: 'apps',
    method: 'GET',
    path: '/api/v1/app-data/usage',
    expect: expectJson([401], (body) => body?.ok === false, 'Usage without an app token is 401.')
  },
  {
    id: 'apps-data-summary-guarded',
    name: 'App data summary requires a session',
    description: 'GET /api/v1/apps/data-summary is the first-party browse surface — anonymous callers get 401, sessions get the per-app roster.',
    group: 'apps',
    method: 'GET',
    path: '/api/v1/apps/data-summary',
    expect: expectJson(
      [200, 401, 429],
      (body) => (body?.ok === true && Array.isArray(body?.apps)) || (body?.ok === false && typeof body?.error === 'string'),
      'Summary returned the apps roster (session) or a guarded error shape (anonymous).'
    )
  },
  {
    id: 'apps-data-shared-needs-app-id',
    name: 'App-view lens validates appId',
    description: 'GET /api/v1/apps/data/shared without appId is a 400 for sessions (401 anonymous) — never an unfiltered read.',
    group: 'apps',
    method: 'GET',
    path: '/api/v1/apps/data/shared',
    expect: expectJson(
      [400, 401, 429],
      (body) => body?.ok === false && typeof body?.error === 'string',
      'The lens refused to read without an appId (or without a session).'
    )
  },
  {
    id: 'docs-markdown-bundle',
    name: 'API docs Markdown bundle',
    description: 'GET /api/docs returns one text/markdown document covering the whole endpoint catalog.',
    group: 'docs',
    method: 'GET',
    path: '/api/docs',
    expect: ({ response, textBody }) => {
      const markdown = (response.headers.get('Content-Type') || '').includes('text/markdown');
      const hasTitle = textBody.includes('# Thingtime API reference');
      // spot-check that catalog entries actually rendered
      const hasEndpoints = textBody.includes('/api/v1/app-data/shared') && textBody.includes('/api/v1/things');
      return {
        pass: response.status === 200 && markdown && hasTitle && hasEndpoints,
        details: `status ${response.status}, markdown content-type ${markdown}, title ${hasTitle}, endpoints ${hasEndpoints}`
      };
    }
  },
  ...apiDocsSmokeTests
];

export const apiTestGroups = Array.from(new Set(apiTests.map((test) => test.group))).sort();
