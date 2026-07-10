import {
  expectJson,
  expectNdjson,
  expectRedirectedTo,
  expectStatus,
  type ApiTestDefinition
} from './apiTestRunner';
import { apiEndpointDocs } from '~/docs/apiDocs';

const uniqueServiceAccountBody = () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

const isObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value);

const decodeJwtPayload = (token: unknown) => {
  const encodedPayload = String(token || '').split('.')[1] || '';
  const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');

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
    id: 'auth-login-invalid',
    name: 'Login invalid credentials',
    description: 'Login rejects invalid credentials, or surfaces environment failure if MongoDB is unavailable.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/login',
    body: { username: 'thingtime-test-missing-user', password: 'not-a-real-password' },
    expect: expectStatus([401, 500], 'Login route responded with expected invalid/env-dependent status.')
  },
  {
    id: 'auth-resend-verification-empty',
    name: 'Resend verification empty body',
    description: 'The resend route returns ok for empty input so account existence cannot be probed.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/resend-verification',
    body: {},
    expect: expectJson([200], (body) => body?.ok === true, 'Resend verification returned ok.')
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
    description: 'The service account endpoint is public but requires a valid email.',
    group: 'auth',
    method: 'POST',
    path: '/api/v1/auth/service-account',
    body: { serviceName: 'Thingtime API Test Missing Email' },
    expect: expectJson(
      [400],
      (body) => body?.ok === false && String(body?.error || '').toLowerCase().includes('email'),
      'Service account route requires a valid email.'
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
    expect: expectJson([200], (body) => {
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
    }, 'Service account response has non-expiring token, seven-day verification window, and 5 GiB allowance.')
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
    id: 'mongodb-raw-results',
    name: 'MongoDB raw results',
    description: 'Raw results are admin-only: 401 for non-admins, data or an environment-dependent error for admins.',
    group: 'mongodb',
    method: 'POST',
    path: '/api/v1/mongodb/raw-results',
    body: {},
    timeoutMs: 15000,
    expect: expectStatus([200, 401, 500], 'MongoDB raw-results route responded.')
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
    expect: expectStatus([200, 500], 'MongoDB populate route responded.')
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
    expect: expectJson([200, 401], (body) => body?.ok === true || (body?.ok === false && typeof body?.error === 'string'), 'Themes list returned themes for a session or a 401 error shape anonymously.')
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
    expect: expectJson(
      [200, 201, 401],
      (body) => (body?.ok === true && typeof body?.created === 'boolean') || (body?.ok === false && typeof body?.error === 'string'),
      'Unified PUT either upserted (session) or was rejected (anonymous).'
    )
  },
  {
    id: 'things-delete-unified-guarded',
    name: 'Unified DELETE is guarded',
    description: 'DELETE /things?id= without a session (or an unknown/unowned thing) is rejected with an error shape.',
    group: 'things',
    method: 'DELETE',
    path: '/api/v1/things?id=not-a-real-post-id',
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Unified DELETE was rejected with an error shape.')
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
    id: 'admin-migrations-guarded',
    name: 'Migration status is admin-only',
    description: 'Non-admin callers get the same 401 as anonymous callers; admins see the version census.',
    group: 'admin',
    method: 'GET',
    path: '/api/v1/admin/migrations',
    expect: expectJson(
      [200, 401],
      (body) => (body?.ok === true && Array.isArray(body?.collections)) || (body?.ok === false && typeof body?.error === 'string'),
      'Migration status either returned the census (admin) or was rejected (non-admin).'
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
      [200, 401],
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
      (body) =>
        (body?.ok === true && Array.isArray(body?.algorithms)) ||
        (body?.ok === false && typeof body?.error === 'string'),
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
    expect: expectJson([400, 401], (body) => body?.ok === false && typeof body?.error === 'string', 'Nameless algorithm rejected with an error shape.')
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
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Algorithm update was rejected with an error shape.')
  },
  {
    id: 'algorithms-delete-guarded',
    name: 'Algorithm delete is guarded',
    description: 'Deleting without a session (or an unknown id) is rejected with an error shape.',
    group: 'algorithms',
    method: 'POST',
    path: '/api/v1/algorithms/delete',
    body: { id: 'not-a-real-algorithm-id' },
    expect: expectJson([401, 404], (body) => body?.ok === false && typeof body?.error === 'string', 'Algorithm delete was rejected with an error shape.')
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
    expect: expectJson([200, 429], (body) => body?.ok === true || typeof body?.error === 'string', 'Waitlist join succeeded (or was rate-limited with an error shape).')
  },
  ...apiDocsSmokeTests
];

export const apiTestGroups = Array.from(new Set(apiTests.map((test) => test.group))).sort();
