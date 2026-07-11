export type ApiHttpMethod = 'GET' | 'POST';

export type ApiAuthMode = 'none' | 'optional' | 'session' | 'bearer' | 'session-or-bearer';

export type ApiRequestExample = {
  name: string;
  description: string;
  method: ApiHttpMethod;
  query?: Record<string, string | number | boolean | null>;
  body?: unknown;
};

export type ApiResponseExample = {
  status: number;
  description: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type ApiEndpointDoc = {
  id: string;
  group: string;
  title: string;
  endpoint: string;
  docsEndpoint: string;
  summary: string;
  detail: string;
  auth: {
    mode: ApiAuthMode;
    description: string;
  };
  methods: ApiHttpMethod[];
  steps: string[];
  requestExamples: ApiRequestExample[];
  responseExamples: ApiResponseExample[];
  notes?: string[];
};

export type ApiPlatformExamples = {
  curl: string;
  wget: string;
  node: string;
  python: string;
  ruby: string;
};

export type SerializedApiEndpointDoc = ApiEndpointDoc & {
  platformExamples: ApiPlatformExamples;
};

const endpoint = (doc: Omit<ApiEndpointDoc, 'docsEndpoint'>): ApiEndpointDoc => ({
  ...doc,
  docsEndpoint: `${doc.endpoint}-docs`
});

export const apiEndpointDocs: ApiEndpointDoc[] = [
  endpoint({
    id: 'admin-rate-limits',
    group: 'admin',
    title: 'Rate-limit config',
    endpoint: '/api/v1/admin/rate-limits',
    summary: 'Read or update the global per-endpoint rate limits (admin only).',
    detail:
      'Admins configure how often each throttled endpoint (e.g. things.react, things.comment) can be called per user. GET returns the current merged config plus the endpoint list + defaults; POST { endpoints: { <name>: { limit, windowMs, enabled } } } updates it. Unknown endpoints are ignored and values clamped server-side.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      'GET to load the current config, endpoint names, and defaults.',
      'POST endpoints with limit (per window), windowMs, and enabled to change a limit.',
      'Non-admins receive 403; anonymous callers 401.',
      'Changes take effect within seconds (the limiter caches config briefly).'
    ],
    requestExamples: [
      { name: 'Read config', description: 'Load the current rate limits.', method: 'GET' },
      {
        name: 'Update react limit',
        description: 'Allow 30 reactions per minute.',
        method: 'POST',
        body: { endpoints: { 'things.react': { limit: 30, windowMs: 60000, enabled: true } } }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Current config.',
        body: {
          ok: true,
          config: { 'things.react': { limit: 60, windowMs: 60000, enabled: true } },
          endpoints: ['things.react', 'things.comment'],
          defaults: { 'things.react': { limit: 60, windowMs: 60000, enabled: true } }
        }
      },
      { status: 403, description: 'Not an admin.', body: { ok: false, error: 'Admins only' } }
    ]
  }),
  endpoint({
    id: 'admin-users',
    group: 'admin',
    title: 'Admin user lookup',
    endpoint: '/api/v1/admin/users',
    summary: 'List current admins and search users to promote/demote (admin only).',
    detail:
      'Returns the current DB-flagged admins; with ?q=<query> also returns matching users (by username/email) so an admin can promote or demote them. Env-allowlist admins are marked envAdmin and cannot be demoted from the UI.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET'],
    steps: [
      'GET with credentials to list current admins.',
      'Add ?q=<username or email> to search users to manage.',
      'Use POST /api/v1/admin/set-admin with a returned user id to change their admin flag.',
      'Non-admins receive 403; anonymous callers 401.'
    ],
    requestExamples: [
      { name: 'List admins', description: 'Current admins only.', method: 'GET' },
      { name: 'Search users', description: 'Find users to promote.', method: 'GET', query: { q: 'lopu' } }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Admins + search results.',
        body: {
          ok: true,
          admins: [{ id: '64f000000000000000000001', username: 'lopu', isAdmin: true, envAdmin: true }],
          results: [{ id: '64f000000000000000000002', username: 'nik', isAdmin: false, envAdmin: false }]
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-set-admin',
    group: 'admin',
    title: 'Promote / demote admin',
    endpoint: '/api/v1/admin/set-admin',
    summary: 'Set a user’s stored admin flag (admin only).',
    detail:
      'POST { userId, admin } to grant or revoke the meta.admin flag. Env-allowlist admins keep access regardless (the returned isAdmin may stay true after a demote).',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
    steps: [
      'POST userId + admin:true to promote, admin:false to demote.',
      'Read the returned user row (id, username, isAdmin, envAdmin) to update the UI.',
      'Demoting an env-allowlist admin only clears the DB flag; they stay admin via env.',
      'Non-admins receive 403; missing userId 400; unknown user 404.'
    ],
    requestExamples: [
      {
        name: 'Promote user',
        description: 'Grant admin.',
        method: 'POST',
        body: { userId: '64f000000000000000000002', admin: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Updated user row.',
        body: { ok: true, user: { id: '64f000000000000000000002', username: 'nik', isAdmin: true, envAdmin: false } }
      },
      { status: 400, description: 'Missing userId.', body: { ok: false, error: 'userId is required' } }
    ]
  }),
  endpoint({
    id: 'root-data',
    group: 'root',
    title: 'Root data',
    endpoint: '/api/root-data',
    summary: 'Returns the app shell configuration used by the React Router root loader.',
    detail:
      'Use this endpoint when a client needs the public Thingtime runtime flags, title prefix, deployment labels, and current user shape in one request.',
    auth: {
      mode: 'optional',
      description: 'Reads the httpOnly auth cookie or Bearer token when present; anonymous callers receive user: null.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials included when calling from a browser.',
      'Read envFromCookie for public THINGTIME_* values and devKitEnv for request query overrides.',
      'Use user to decide whether to render anonymous, login, or profile flows.',
      'Preserve Set-Cookie when proxying because the route increments the root session ping counter.'
    ],
    requestExamples: [
      {
        name: 'Load app shell data',
        description: 'Fetch root data for the current browser session.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Root configuration and current user state.',
        body: {
          envFromCookie: { THINGTIME_BRANCH_NAME: 'main' },
          devKitEnv: { NODE_ENV: 'development' },
          titlePrefix: '[LC]',
          user: null
        }
      }
    ]
  }),
  endpoint({
    id: 'auth-accounts',
    group: 'auth',
    title: 'Account switcher roster',
    endpoint: '/api/v1/auth/accounts',
    summary: 'Lists every account signed in to this browser, marking the active one.',
    detail:
      'The account switcher roster is a Mongo document (rosters collection) referenced by an opaque id in the httpOnly tt_accounts cookie; its entries reference sessions by id, so there is no account limit and raw JWTs are never stored or returned. This route resolves each entry to its public user, prunes dead entries (expired, revoked, deleted), and updates the roster + cookie when anything changed.',
    auth: {
      mode: 'optional',
      description:
        'Reads the tt_accounts roster-id and tt_auth cookies. Works without an active session so a signed-out browser can still offer "continue as" for roster accounts.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials included so the httpOnly cookies travel.',
      'Read accounts[] for each signed-in public user; active: true marks the tt_auth account.',
      'Preserve Set-Cookie on the response — pruning rewrites the roster-id cookie.',
      'Call /api/v1/auth/accounts/switch with a listed user id to change the active account.'
    ],
    requestExamples: [
      {
        name: 'List signed-in accounts',
        description: 'Read the switcher roster for this browser.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Two accounts signed in; the first is active.',
        body: {
          ok: true,
          accounts: [
            { user: { id: '64f000000000000000000001', username: 'lopu' }, active: true },
            { user: { id: '64f000000000000000000002', username: 'nik' }, active: false }
          ]
        }
      },
      {
        status: 200,
        description: 'No accounts signed in.',
        body: { ok: true, accounts: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-accounts-remove',
    group: 'auth',
    title: 'Remove account from switcher',
    endpoint: '/api/v1/auth/accounts/remove',
    summary: 'Signs one roster account out: revokes its session and drops it from the switcher.',
    detail:
      'Use this to remove a single account from the browser without touching the others. Removing the active account promotes the next roster account to active; removing the last account clears both auth cookies, signing the browser out entirely.',
    auth: {
      mode: 'optional',
      description: 'Operates on the browser roster named by the httpOnly tt_accounts cookie; possession of that roster id is the authorization.'
    },
    methods: ['POST'],
    steps: [
      'POST the user id of the roster account to remove.',
      'The account session jti is revoked in MongoDB — the removed token is dead everywhere, not just in this browser.',
      'Read user for the account that is active after the removal (null when none remain).',
      'Store the returned Set-Cookie headers so tt_auth and tt_accounts stay in sync.'
    ],
    requestExamples: [
      {
        name: 'Remove one account',
        description: 'Sign the account out of this browser and revoke its session.',
        method: 'POST',
        body: { userId: '64f000000000000000000002' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Account removed; another account remains active.',
        body: {
          ok: true,
          user: { id: '64f000000000000000000001', username: 'lopu' },
          accounts: [{ user: { id: '64f000000000000000000001', username: 'lopu' }, active: true }]
        }
      },
      {
        status: 400,
        description: 'Missing userId.',
        body: { ok: false, error: 'userId is required' }
      }
    ]
  }),
  endpoint({
    id: 'auth-accounts-switch',
    group: 'auth',
    title: 'Switch active account',
    endpoint: '/api/v1/auth/accounts/switch',
    summary: 'Makes a signed-in roster account the active one without re-entering a password.',
    detail:
      'Mints a fresh JWT for the chosen roster account live session into tt_auth. Authorization is possession of the httpOnly roster-id cookie, so switching never needs credentials.',
    auth: {
      mode: 'optional',
      description: 'Operates on the browser roster named by the httpOnly tt_accounts cookie; the target entry must still resolve to a live session.'
    },
    methods: ['POST'],
    steps: [
      'POST the user id of a roster account (from /api/v1/auth/accounts).',
      'Store the returned Set-Cookie headers — tt_auth now carries the chosen account token.',
      'Refresh user-scoped state client-side; the active user changed for every subsequent request.',
      'A 404 means that account is no longer signed in here (session expired or revoked) — refresh the roster and log in again.'
    ],
    requestExamples: [
      {
        name: 'Switch account',
        description: 'Activate another signed-in account.',
        method: 'POST',
        body: { userId: '64f000000000000000000002' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active account switched.',
        body: {
          ok: true,
          user: { id: '64f000000000000000000002', username: 'nik' },
          accounts: [
            { user: { id: '64f000000000000000000001', username: 'lopu' }, active: false },
            { user: { id: '64f000000000000000000002', username: 'nik' }, active: true }
          ]
        }
      },
      {
        status: 404,
        description: 'The account is not signed in to this browser (or its session died).',
        body: { ok: false, error: 'That account is no longer signed in here', accounts: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-jwks',
    group: 'auth',
    title: 'JWKS discovery',
    endpoint: '/api/v1/auth/jwks',
    summary: 'Returns public ES256 JWT verification keys for external token verifiers.',
    detail:
      'Services can call this route to discover public keys for validating Thingtime bearer tokens without sharing private signing material.',
    auth: {
      mode: 'none',
      description: 'Public discovery endpoint. No cookie or bearer token is required.'
    },
    methods: ['GET'],
    steps: [
      'Fetch the JWKS URL before validating a Thingtime JWT.',
      'If the route returns 503 with an empty keys array, asymmetric signing keys are not configured in this runtime.',
      'Cache successful keys for the Cache-Control lifetime, then refresh before accepting new tokens.',
      'Match the token header kid to a key entry before verifying the signature.'
    ],
    requestExamples: [
      {
        name: 'Discover signing keys',
        description: 'Read the public key set.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Public key set is configured.',
        body: { keys: [{ kty: 'EC', crv: 'P-256', kid: 'thingtime-key-id', use: 'sig', alg: 'ES256' }] }
      },
      {
        status: 503,
        description: 'No asymmetric public key is configured in this environment.',
        body: { keys: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-logout',
    group: 'auth',
    title: 'Logout',
    endpoint: '/api/v1/auth/logout',
    summary: 'Signs the active account out; other switcher accounts stay signed in unless all: true.',
    detail:
      'Use this endpoint to end browser sessions or revoke a bearer token session server-side. The active account session is revoked and removed from the switcher roster; the next roster account becomes active and is returned as user. Pass all: true to revoke every roster session and clear both cookies. The route is idempotent and returns ok even without a token.',
    auth: {
      mode: 'optional',
      description: 'Uses the auth cookie or Authorization: Bearer token when one exists.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object, or { "all": true } to sign out every switcher account.',
      'If a token is present, Thingtime verifies it and revokes the session jti in MongoDB.',
      'Read user for the account active after logout — null means the browser is fully signed out.',
      'Store the returned Set-Cookie headers so tt_auth and the tt_accounts roster stay in sync.',
      'Treat repeated logout calls as success.'
    ],
    requestExamples: [
      {
        name: 'Logout current session',
        description: 'Sign out the active account; remaining switcher accounts stay signed in.',
        method: 'POST',
        body: {}
      },
      {
        name: 'Logout everywhere',
        description: 'Revoke every switcher account session in this browser.',
        method: 'POST',
        body: { all: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active account signed out; another switcher account took over.',
        body: {
          ok: true,
          user: { id: '64f000000000000000000001', username: 'lopu' },
          accounts: [{ user: { id: '64f000000000000000000001', username: 'lopu' }, active: true }]
        }
      },
      {
        status: 200,
        description: 'Fully signed out.',
        body: { ok: true, user: null, accounts: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-me',
    group: 'auth',
    title: 'Current user',
    endpoint: '/api/v1/auth/me',
    summary: 'Returns the authenticated public user or null.',
    detail:
      'Use this route for lightweight auth checks. It supports the same httpOnly cookie and bearer token model as the rest of the API.',
    auth: {
      mode: 'optional',
      description: 'Cookie or Authorization: Bearer token optional. Anonymous callers receive user: null.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials or an Authorization bearer token.',
      'Read user for account id, username, email verification, service-account shape, and storage allowance.',
      'If user is null, prompt for login or continue in anonymous mode.',
      'Do not expect password hashes, raw session documents, or JWTs in this response.'
    ],
    requestExamples: [
      {
        name: 'Read current user',
        description: 'Resolve the current account from cookie or bearer token.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Anonymous request.',
        body: { user: null }
      },
      {
        status: 200,
        description: 'Authenticated request.',
        body: {
          user: {
            id: '64f000000000000000000001',
            username: 'service-sync',
            email: 'service@example.com',
            emailVerified: true,
            accountKind: 'service',
            storageAllowanceBytes: 5368709120
          }
        }
      }
    ]
  }),
  endpoint({
    id: 'auth-register',
    group: 'auth',
    title: 'Register user',
    endpoint: '/api/v1/auth/register',
    summary: 'Creates a user account, starts email verification, logs the browser in, and sets the auth cookie.',
    detail:
      'This is the live user signup path. Tests and seed flows should call this endpoint instead of writing directly to MongoDB.',
    auth: {
      mode: 'none',
      description: 'Public signup endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST username, password, and email. displayName and meta are optional.',
      'Store the returned Set-Cookie header for browser clients.',
      'If verificationLink is present, it is a local/preview helper only; production sends email instead.',
      'Expect emailVerified to start false until the verification link is consumed.'
    ],
    requestExamples: [
      {
        name: 'Create user account',
        description: 'Register a standard browser/user account.',
        method: 'POST',
        body: {
          username: 'ada-lovelace',
          password: 'replace-with-a-long-password',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          meta: { source: 'external-app' }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'User created and auth cookie set.',
        body: {
          ok: true,
          user: {
            id: '64f000000000000000000002',
            username: 'ada-lovelace',
            email: 'ada@example.com',
            emailVerified: false
          }
        }
      },
      {
        status: 400,
        description: 'Validation failed.',
        body: { ok: false, error: 'A valid email is required' }
      }
    ]
  }),
  endpoint({
    id: 'auth-resend-verification',
    group: 'auth',
    title: 'Resend verification',
    endpoint: '/api/v1/auth/resend-verification',
    summary: 'Requests another verification email without revealing whether an account exists.',
    detail:
      'This route intentionally returns ok for empty, unknown, already verified, and valid unverified emails so callers cannot enumerate accounts.',
    auth: {
      mode: 'none',
      description: 'Public anti-enumeration endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST an email address when the user asks for a new verification email.',
      'The route creates and sends a token only if the email belongs to an existing unverified account.',
      'Always treat { ok: true } as a neutral accepted response, not proof that an account exists.',
      'In local/preview, verificationLink may be returned for development testing.'
    ],
    requestExamples: [
      {
        name: 'Resend verification email',
        description: 'Request a new verification email.',
        method: 'POST',
        body: { email: 'ada@example.com' }
      },
      {
        name: 'Empty anti-enumeration request',
        description: 'Empty requests also return ok and do not reveal account state.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Accepted without revealing account state.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'auth-service-account',
    group: 'auth',
    title: 'Service account provisioning',
    endpoint: '/api/v1/auth/service-account',
    summary: 'Creates a service-owned account with a non-expiring bearer token and 5 GiB storage allowance.',
    detail:
      'Use this endpoint to connect other apps to Thingtime backend data. The account is public self-service but must verify its email within seven days.',
    auth: {
      mode: 'none',
      description: 'Public endpoint. Email verification is required after creation.'
    },
    methods: ['POST'],
    steps: [
      'POST a serviceName and valid email. username, displayName, and meta are optional.',
      'Store accessToken securely server-side; it has no exp claim and should be treated like an API key.',
      'Send Authorization: Bearer <accessToken> to authenticated Thingtime API routes.',
      'Complete email verification before verificationRequiredBy to keep the integration trustworthy.'
    ],
    requestExamples: [
      {
        name: 'Create service account',
        description: 'Provision an integration account for a backend service.',
        method: 'POST',
        body: {
          serviceName: 'My Sync Worker',
          username: 'my-sync-worker',
          email: 'sync@example.com',
          displayName: 'My Sync Worker',
          meta: { app: 'calendar-sync', environment: 'production' }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Service account created.',
        body: {
          ok: true,
          accessToken: 'eyJhbGciOiJFUzI1NiIsImtpZCI6InRoaW5ndGltZSJ9...',
          tokenType: 'Bearer',
          expiresAt: null,
          verificationRequiredBy: '2026-07-15T00:00:00.000Z',
          storageAllowanceBytes: 5368709120,
          user: {
            accountKind: 'service',
            emailVerified: false
          }
        }
      },
      {
        status: 400,
        description: 'A valid email is required.',
        body: { ok: false, error: 'A valid email is required' }
      }
    ],
    notes: ['The bearer token is intentionally non-expiring; rotate it by creating a replacement service account when needed.']
  }),
  endpoint({
    id: 'auth-verify-email',
    group: 'auth',
    title: 'Verify email',
    endpoint: '/api/v1/auth/verify-email',
    summary: 'Consumes an email verification token and redirects to login with a status.',
    detail:
      'This endpoint is designed for email links. API clients usually follow redirects or inspect the Location header.',
    auth: {
      mode: 'none',
      description: 'Public token consumption endpoint.'
    },
    methods: ['GET'],
    steps: [
      'Open the verification URL with token as a query parameter.',
      'Thingtime burns the token so it cannot be reused.',
      'Successful tokens mark the user emailVerified and redirect to /login?verify=success.',
      'Missing, expired, or invalid tokens redirect to /login with a reason in the verify query parameter.'
    ],
    requestExamples: [
      {
        name: 'Verify token',
        description: 'Consume an email verification token.',
        method: 'GET',
        query: { token: 'verification-token-from-email' }
      }
    ],
    responseExamples: [
      {
        status: 302,
        description: 'Token accepted.',
        headers: { Location: '/login?verify=success' }
      },
      {
        status: 302,
        description: 'Token missing.',
        headers: { Location: '/login?verify=missing' }
      }
    ]
  }),
  endpoint({
    id: 'crypto',
    group: 'crypto',
    title: 'Crypto tools',
    endpoint: '/api/v1/crypto',
    summary: 'Lists crypto standards and runs key generation, JWT verification, signature verification, and key matching helpers.',
    detail:
      'Use this route for Thingtime-compatible ES256 key workflows and diagnostics. POST bodies are intent-driven.',
    auth: {
      mode: 'none',
      description: 'Public helper endpoint. Do not post private production secrets from untrusted clients.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET the route to list supported standards and Thingtime auth compatibility.',
      'POST intent: generate-key-pair to create an ES256 key pair for development or integration setup.',
      'POST intent: verify-jwt, verify-signature, or match-key-pair with the required material for diagnostics.',
      'Handle 400 responses for unsupported intents or invalid crypto input.'
    ],
    requestExamples: [
      {
        name: 'List standards',
        description: 'Read supported crypto standards.',
        method: 'GET'
      },
      {
        name: 'Generate ES256 key pair',
        description: 'Generate a development key pair.',
        method: 'POST',
        body: { intent: 'generate-key-pair', standard: 'ES256' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Supported standards.',
        body: { ok: true, standards: [{ value: 'ES256', label: 'ECDSA P-256 + SHA-256', thingtimeAuthCompatible: true }] }
      },
      {
        status: 400,
        description: 'Unknown intent.',
        body: { ok: false, error: 'Unknown crypto action.' }
      }
    ]
  }),
  endpoint({
    id: 'health-frontend',
    group: 'health',
    title: 'Frontend health',
    endpoint: '/api/v1/health/frontend',
    summary: 'Checks whether a Thingtime frontend shell is reachable.',
    detail:
      'Used by environment status UI to verify local, preview, or remote frontend availability.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters to check the current origin.',
      'Pass target or origin query parameters when checking another Thingtime environment.',
      'Read ok, state, statusCode, responseMs, and shellDetected for diagnostics.',
      'Treat ok false as a health signal, not a transport failure.'
    ],
    requestExamples: [
      {
        name: 'Check current frontend',
        description: 'Verify the frontend shell on the current origin.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Frontend status shape.',
        body: { ok: true, service: 'frontend', state: 'ready', shellDetected: true, statusCode: 200 }
      }
    ]
  }),
  endpoint({
    id: 'health-mongodb',
    group: 'health',
    title: 'MongoDB health',
    endpoint: '/api/v1/health/mongodb',
    summary: 'Returns MongoDB connectivity for the current or target environment.',
    detail:
      'This route wraps the MongoDB status helper and can proxy remote health checks through the environment status resolver.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. Secrets are sanitized from responses.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters for current runtime MongoDB health.',
      'Pass target or origin query parameters to compare another deployment when supported.',
      'Read connected, host, dbName, pingMs, checkedAt, and error.',
      'Do not expect raw credentials in host; connection strings are sanitized.'
    ],
    requestExamples: [
      {
        name: 'Check MongoDB',
        description: 'Check current MongoDB connection state.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'MongoDB health shape.',
        body: { connected: true, host: 'mongodb://localhost:27017/thingtime', dbName: 'thingtime', pingMs: 4 }
      }
    ]
  }),
  endpoint({
    id: 'health-nitro',
    group: 'health',
    title: 'Nitro health',
    endpoint: '/api/v1/health/nitro',
    summary: 'Reports Nitro API runtime readiness.',
    detail:
      'Use this endpoint to confirm the API server is alive and to compare local versus remote runtime status.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters for current runtime status.',
      'Pass target or origin query parameters to check a remote Thingtime runtime when supported.',
      'Read service, state, runtime, nodeEnv, and responseMs.',
      'Use this before deeper API tests to separate server availability from endpoint behavior.'
    ],
    requestExamples: [
      {
        name: 'Check Nitro',
        description: 'Confirm the Nitro API is ready.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Nitro is ready.',
        body: { ok: true, service: 'nitro', state: 'ready', runtime: 'nitro' }
      }
    ]
  }),
  endpoint({
    id: 'health-vercel',
    group: 'health',
    title: 'Vercel health',
    endpoint: '/api/v1/health/vercel',
    summary: 'Returns Vercel deployment status or a safe unavailable shape.',
    detail:
      'This endpoint powers environment status displays and avoids leaking dashboard credentials.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. It only returns status data exposed by server-side configuration.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters for current Vercel deployment status.',
      'Pass target or origin query parameters for remote environment checks when supported.',
      'Read configured, state, label, hasError, and error for UI diagnostics.',
      'Handle configured false as an expected state outside Vercel-enabled runtimes.'
    ],
    requestExamples: [
      {
        name: 'Check Vercel',
        description: 'Read deployment status for the current runtime.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Vercel status shape.',
        body: { configured: true, state: 'READY', label: 'Vercel: ready', hasError: false }
      }
    ]
  }),
  endpoint({
    id: 'login',
    group: 'auth',
    title: 'Login',
    endpoint: '/api/v1/login',
    summary: 'Validates username/password credentials and sets the auth cookie.',
    detail:
      'Use this for browser login. API clients that need service integration should prefer the service-account endpoint and bearer token.',
    auth: {
      mode: 'none',
      description: 'Public credential exchange endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST username and password.',
      'Store the Set-Cookie response header for browser clients.',
      'Use /api/v1/auth/me after login to confirm the current user.',
      'Handle 401 for invalid credentials and 500 for unavailable backing services.'
    ],
    requestExamples: [
      {
        name: 'Login user',
        description: 'Authenticate a username/password account.',
        method: 'POST',
        body: { username: 'ada-lovelace', password: 'replace-with-the-user-password' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Login succeeded and auth cookie was set.',
        body: { ok: true, user: { id: '64f000000000000000000002', username: 'ada-lovelace' } }
      },
      {
        status: 401,
        description: 'Invalid credentials.',
        body: { ok: false, error: 'Invalid username or password' }
      }
    ]
  }),
  endpoint({
    id: 'lopu-musing',
    group: 'lopu',
    title: 'Lopu musing stream',
    endpoint: '/api/v1/lopu/musing',
    summary: 'Streams a short Lopu musing as newline-delimited JSON.',
    detail:
      'The stream uses weather/time context from Vercel geo headers when present and falls back to a canned stream if no AI provider is configured or quota is exhausted.',
    auth: {
      mode: 'optional',
      description: 'Anonymous calls are allowed. Auth may affect rate-limit accounting when provider-backed output is enabled.'
    },
    methods: ['GET'],
    steps: [
      'Open a GET request with Accept: application/x-ndjson or Accept: */*.',
      'Read each newline as a JSON event.',
      'Append delta.text values until a done event arrives.',
      'Inspect X-Thingtime-Lopu-Rate-Limited to know whether the fallback path was used.'
    ],
    requestExamples: [
      {
        name: 'Stream musing',
        description: 'Read an NDJSON stream of Lopu events.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'NDJSON stream events.',
        body: [
          { type: 'meta', source: 'fallback', mode: 'weather' },
          { type: 'delta', text: 'Lopu is thinking...' },
          { type: 'done' }
        ]
      }
    ]
  }),
  endpoint({
    id: 'mongodb-get-connection',
    group: 'mongodb',
    title: 'MongoDB connection config',
    endpoint: '/api/v1/mongodb/get-connection',
    summary: 'Returns sanitized MongoDB host information for diagnostics.',
    detail:
      'Use this endpoint to check which MongoDB host the runtime is configured to use without exposing credentials.',
    auth: {
      mode: 'none',
      description: 'Development diagnostic endpoint. Returned host is sanitized.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object.',
      'Read data.host to confirm the configured MongoDB target.',
      'Handle 500 if MONGODB_CONNECTION_STRING is missing or invalid.',
      'Never use this response as a credential source; passwords are stripped.'
    ],
    requestExamples: [
      {
        name: 'Read sanitized host',
        description: 'Check the configured MongoDB host.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Sanitized connection host.',
        body: { message: 'Early return triggered in API V1 MongoDB Get Connection action: successful', data: { host: 'mongodb://localhost:27017/thingtime' } }
      }
    ]
  }),
  endpoint({
    id: 'mongodb-populate',
    group: 'mongodb',
    title: 'MongoDB populate',
    endpoint: '/api/v1/mongodb/populate',
    summary: 'Runs the MongoDB setup/populate script.',
    detail:
      'This is a mutating development utility. Use it carefully because it initializes or updates local Thingtime MongoDB state.',
    auth: {
      mode: 'none',
      description: 'Development utility endpoint. Restrict exposure by environment and network controls.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object from a trusted development environment.',
      'The route runs the shared MongoDB setup script.',
      'Read data.ret for setup output.',
      'Avoid calling this from production automation unless explicitly intended.'
    ],
    requestExamples: [
      {
        name: 'Populate MongoDB',
        description: 'Run setup/populate for a development database.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Populate script completed.',
        body: { message: 'Early return triggered in Populate action: successful', data: { ret: true } }
      }
    ],
    notes: ['This route mutates database state. It is present for local/dev workflows and test harness coverage.']
  }),
  endpoint({
    id: 'mongodb-raw-results',
    group: 'mongodb',
    title: 'MongoDB raw results',
    endpoint: '/api/v1/mongodb/raw-results',
    summary: 'Returns raw Thingtime records from MongoDB for diagnostics.',
    detail:
      'Use this route for low-level diagnostics when validating the database connection and stored Thingtime data.',
    auth: {
      mode: 'none',
      description: 'Development diagnostic endpoint. Treat returned data as sensitive.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object from a trusted development environment.',
      'The route opens the configured MongoDB connection and reads the things collection.',
      'Inspect data.rawResults for stored Thingtime records.',
      'Handle 500 if MongoDB is unavailable.'
    ],
    requestExamples: [
      {
        name: 'Read raw results',
        description: 'Fetch raw things collection results.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Raw things collection results.',
        body: { message: 'Early return triggered in Raw Results action: successful', data: { rawResults: [] } }
      }
    ],
    notes: ['Raw results can contain user data. Prefer higher-level API routes for app integrations.']
  }),
  endpoint({
    id: 'mongodb-status',
    group: 'mongodb',
    title: 'MongoDB status',
    endpoint: '/api/v1/mongodb/status',
    summary: 'Returns MongoDB connection status for UI status checks and API tests.',
    detail:
      'This route responds with HTTP 200 even when MongoDB is down; the body connected field carries the health state.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. Credentials are sanitized.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Send GET for normal status checks or POST for API tester parity.',
      'Read connected, host, dbName, pingMs, collections, checkedAt, and error.',
      'Treat connected false as a service-health result rather than a failed HTTP request.',
      'Use /api/v1/mongodb/status-data when you need a resource-only JSON endpoint.'
    ],
    requestExamples: [
      {
        name: 'Check MongoDB status',
        description: 'Read connection status.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Connection status.',
        body: { connected: true, host: 'mongodb://localhost:27017/thingtime', dbName: 'thingtime', pingMs: 4 }
      }
    ]
  }),
  endpoint({
    id: 'mongodb-status-data',
    group: 'mongodb',
    title: 'MongoDB status data',
    endpoint: '/api/v1/mongodb/status-data',
    summary: 'Resource-only JSON version of MongoDB status.',
    detail:
      'Use this route for plain fetch calls that should never render the in-app API tester component.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. Credentials are sanitized.'
    },
    methods: ['GET'],
    steps: [
      'Send GET from dashboards, status widgets, or health checks.',
      'Read the same MongoDB connection shape returned by /api/v1/mongodb/status.',
      'Use connected false and error fields for diagnostics.',
      'Prefer this endpoint over /status when a JSON-only resource is required.'
    ],
    requestExamples: [
      {
        name: 'Read MongoDB JSON status',
        description: 'Fetch status data only.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Connection status.',
        body: { connected: false, host: null, dbName: null, pingMs: null, error: 'connect ECONNREFUSED' }
      }
    ]
  }),
  endpoint({
    id: 'template',
    group: 'template',
    title: 'Template action',
    endpoint: '/api/v1/template',
    summary: 'Legacy test/template API action.',
    detail:
      'This route is retained as a simple API action harness and returns a predictable JSON message.',
    auth: {
      mode: 'none',
      description: 'Public development/test endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST any JSON object.',
      'Use the response to verify the catch-all route/action plumbing.',
      'Do not build production integrations on this placeholder route.',
      'Use specific API endpoints for real Thingtime operations.'
    ],
    requestExamples: [
      {
        name: 'Call template action',
        description: 'Exercise a simple POST action.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Template response.',
        body: { message: 'Early return triggered in login action: Template API' }
      }
    ]
  }),
  endpoint({
    id: 'themes',
    group: 'themes',
    title: 'Themes',
    endpoint: '/api/v1/themes',
    summary: 'Lists or saves themes for the authenticated user.',
    detail:
      'Theme records let Thingtime users save and share visual configurations. Reads and writes require an authenticated user.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with credentials to list themes owned by the current user.',
      'POST name, theme, and optional visibility to create or update a theme.',
      'Include id in POST only when updating one of the caller-owned themes.',
      'Keep theme payloads below 64 KiB.'
    ],
    requestExamples: [
      {
        name: 'List themes',
        description: 'Read saved themes for the current account.',
        method: 'GET'
      },
      {
        name: 'Save private theme',
        description: 'Create a theme owned by the current account.',
        method: 'POST',
        body: {
          name: 'Launch dark',
          visibility: 'private',
          theme: { colors: { accent: '#008060', background: '#0f172a' } }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Themes listed.',
        body: { ok: true, themes: [] }
      },
      {
        status: 401,
        description: 'No authenticated user.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'themes-active',
    group: 'themes',
    title: 'Active theme',
    endpoint: '/api/v1/themes/active',
    summary: 'Sets or clears the current user active theme.',
    detail:
      'Use this endpoint to make a saved or shared theme follow the user across browsers and devices.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST themeId as a string to set an active theme, or null to clear it.',
      'The theme must be owned by the user or publicly shared.',
      'Read activeThemeId from the response and update the local theme state.',
      'Handle 401 unauthenticated, 400 invalid themeId, and 404 missing theme.'
    ],
    requestExamples: [
      {
        name: 'Set active theme',
        description: 'Activate a saved or shared theme.',
        method: 'POST',
        body: { themeId: 'theme_123' }
      },
      {
        name: 'Clear active theme',
        description: 'Return the user to default theme resolution.',
        method: 'POST',
        body: { themeId: null }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active theme updated.',
        body: { ok: true, activeThemeId: 'theme_123' }
      }
    ]
  }),
  endpoint({
    id: 'themes-delete',
    group: 'themes',
    title: 'Delete theme',
    endpoint: '/api/v1/themes/delete',
    summary: 'Deletes a theme owned by the current user.',
    detail:
      'Use this route for explicit user deletion actions. It does not delete themes owned by other users.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the theme id to delete.',
      'The current user must own the theme.',
      'On success, remove the theme from local UI state.',
      'Handle 401 unauthenticated and 404 not found or not owned.'
    ],
    requestExamples: [
      {
        name: 'Delete theme',
        description: 'Delete a caller-owned theme.',
        method: 'POST',
        body: { id: 'theme_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Theme deleted.',
        body: { ok: true }
      },
      {
        status: 404,
        description: 'Theme not found for this user.',
        body: { ok: false, error: 'Theme not found' }
      }
    ]
  }),
  endpoint({
    id: 'themes-shared',
    group: 'themes',
    title: 'Shared theme',
    endpoint: '/api/v1/themes/shared',
    summary: 'Reads a shared theme by id/share id.',
    detail:
      'Anonymous callers can read public shared themes. Authenticated owners can also read their own private themes by id.',
    auth: {
      mode: 'optional',
      description: 'Anonymous public reads are allowed; auth cookie or bearer token can reveal caller-owned private themes.'
    },
    methods: ['GET'],
    steps: [
      'Send id as a query parameter.',
      'Use the returned theme to preview or apply a shared visual configuration.',
      'Treat 404 as not found without assuming whether a private theme exists.',
      'Authenticate only when reading one of your own private themes by id.'
    ],
    requestExamples: [
      {
        name: 'Read shared theme',
        description: 'Fetch a public shared theme.',
        method: 'GET',
        query: { id: 'theme_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Theme found.',
        body: { ok: true, theme: { id: 'theme_123', name: 'Launch dark', visibility: 'public' } }
      },
      {
        status: 404,
        description: 'No public or caller-owned theme found.',
        body: { ok: false, error: 'Theme not found' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms',
    group: 'algorithms',
    title: 'Feed algorithms',
    endpoint: '/api/v1/algorithms',
    summary: 'Lists or creates the current user feed-ranking algorithms.',
    detail:
      'Feed algorithms store per-user ranking weights trained from dwell, expand, reaction, comment, and share events. Users can keep multiple named algorithms and switch the active one.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with credentials to list the caller algorithms and active id.',
      'POST a name, optional emoji, optional branchFrom id, and optional events to create an algorithm.',
      'Use branchFrom to copy an existing algorithm weight profile before further training.',
      'Handle 401 for anonymous callers and 400 for invalid creation payloads.'
    ],
    requestExamples: [
      {
        name: 'List algorithms',
        description: 'Read the caller feed algorithms.',
        method: 'GET'
      },
      {
        name: 'Create algorithm',
        description: 'Create a named algorithm for the caller.',
        method: 'POST',
        body: { name: 'Quiet marketplace', emoji: 'compass' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Algorithms listed.',
        body: { ok: true, algorithms: [], activeAlgorithmId: null }
      },
      {
        status: 401,
        description: 'No authenticated user.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-active',
    group: 'algorithms',
    title: 'Active feed algorithm',
    endpoint: '/api/v1/algorithms/active',
    summary: 'Sets or clears the current user active feed algorithm.',
    detail:
      'Use this endpoint when the feed algorithm picker changes. A null algorithmId returns the feed to latest-first chronological ranking.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST algorithmId as a string to activate a saved algorithm, or null for Latest.',
      'The algorithm must belong to the current user.',
      'Persist activeAlgorithmId from the response in local UI state.',
      'Handle 401 unauthenticated and 404 for unknown or unowned algorithms.'
    ],
    requestExamples: [
      {
        name: 'Set active algorithm',
        description: 'Switch the caller feed to a saved algorithm.',
        method: 'POST',
        body: { algorithmId: 'algorithm_123' }
      },
      {
        name: 'Use latest feed',
        description: 'Clear the active algorithm.',
        method: 'POST',
        body: { algorithmId: null }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active algorithm updated.',
        body: { ok: true, activeAlgorithmId: 'algorithm_123' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-delete',
    group: 'algorithms',
    title: 'Delete feed algorithm',
    endpoint: '/api/v1/algorithms/delete',
    summary: 'Deletes one of the current user feed algorithms.',
    detail:
      'This route removes a user-owned algorithm and clears the active algorithm pointer when it pointed at the deleted algorithm.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the algorithm id to delete.',
      'The current user must own the algorithm.',
      'On success, remove it from the settings algorithm manager.',
      'Handle 401 unauthenticated and 404 for unknown or unowned algorithms.'
    ],
    requestExamples: [
      {
        name: 'Delete algorithm',
        description: 'Delete a caller-owned algorithm.',
        method: 'POST',
        body: { id: 'algorithm_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Algorithm deleted.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-track',
    group: 'algorithms',
    title: 'Track feed engagement',
    endpoint: '/api/v1/algorithms/track',
    summary: 'Trains the current or selected feed algorithm from engagement events.',
    detail:
      'The feed sends bounded batches of dwell, expand, reaction, comment, and share events so the active algorithm can update deterministic interest weights.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST events and optionally algorithmId.',
      'If algorithmId is omitted, the caller active feed algorithm is trained.',
      'Keep batches small; the route enforces a 128 KiB payload cap.',
      'Handle 400 for empty or malformed event batches.'
    ],
    requestExamples: [
      {
        name: 'Track engagement',
        description: 'Train from a small event batch.',
        method: 'POST',
        body: {
          algorithmId: 'algorithm_123',
          events: [{ type: 'dwell', postId: 'post_123', tags: ['tools'], value: 3 }]
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Events were applied.',
        body: { ok: true, trained: true, applied: 1 }
      },
      {
        status: 400,
        description: 'No valid events were provided.',
        body: { ok: false, error: 'events are required' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-update',
    group: 'algorithms',
    title: 'Update feed algorithm',
    endpoint: '/api/v1/algorithms/update',
    summary: 'Renames or restyles one of the current user feed algorithms.',
    detail:
      'Use this endpoint from the settings algorithm manager to update algorithm display metadata without changing its learned weights.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST id plus name and/or emoji.',
      'The current user must own the algorithm.',
      'Use the returned algorithm to refresh local state.',
      'Handle 401 unauthenticated, 400 invalid input, and 404 missing algorithm.'
    ],
    requestExamples: [
      {
        name: 'Rename algorithm',
        description: 'Update display fields.',
        method: 'POST',
        body: { id: 'algorithm_123', name: 'Home projects', emoji: 'house' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Algorithm updated.',
        body: { ok: true, algorithm: { id: 'algorithm_123', name: 'Home projects' } }
      }
    ]
  }),
  endpoint({
    id: 'things',
    group: 'things',
    title: 'Create feed post',
    endpoint: '/api/v1/things',
    summary: 'Creates a text, image, or marketplace feed post in the things collection.',
    detail:
      'Posts are stored as kind: post things with circle visibility, tags, reactions, comments, and share metadata. The route is the canonical creation path for feed content.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST type plus text, images, listing, visibility, and tags as needed.',
      'The route writes through the things API utility layer, not direct client database access.',
      'Use the returned post to prepend optimistic UI state.',
      'Handle 401 unauthenticated, 400 invalid payload, and 413 oversized payload.'
    ],
    requestExamples: [
      {
        name: 'Create text post',
        description: 'Create a private text post.',
        method: 'POST',
        body: { type: 'text', text: 'Today I learned...', visibility: 'private' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Post created.',
        body: { ok: true, post: { id: 'post_123', type: 'text', text: 'Today I learned...' } }
      }
    ]
  }),
  endpoint({
    id: 'things-comment',
    group: 'things',
    title: 'Comment on post',
    endpoint: '/api/v1/things/comment',
    summary: 'Adds a comment to a post visible to the current user.',
    detail:
      'The route re-checks visibility before writing so private or circle-limited posts cannot be commented on by unauthorized viewers.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST id and text.',
      'The post must be visible to the current user.',
      'Use commentCount from the response to update the card.',
      'Handle 401 unauthenticated, 404 not visible, and 400 invalid text.'
    ],
    requestExamples: [
      {
        name: 'Add comment',
        description: 'Comment on a visible post.',
        method: 'POST',
        body: { id: 'post_123', text: 'I am interested.' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Comment added.',
        body: { ok: true, comment: { text: 'I am interested.' }, commentCount: 1 }
      }
    ]
  }),
  endpoint({
    id: 'things-delete',
    group: 'things',
    title: 'Delete feed post',
    endpoint: '/api/v1/things/delete',
    summary: 'Deletes one of the current user feed posts.',
    detail:
      'Only the owning user may delete a post. The route is used by feed/profile card controls and preserves visibility checks.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the post id to delete.',
      'The current user must own the post.',
      'On success, remove the post from feed and profile lists.',
      'Handle 401 unauthenticated and 404 for missing or unowned posts.'
    ],
    requestExamples: [
      {
        name: 'Delete post',
        description: 'Delete a caller-owned post.',
        method: 'POST',
        body: { id: 'post_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Post deleted.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'things-feed',
    group: 'things',
    title: 'Feed page',
    endpoint: '/api/v1/things/feed',
    summary: 'Returns public and viewer-visible feed posts with optional algorithm ranking.',
    detail:
      'The feed reads a lean projection of recent visible posts, applies filters, then optionally ranks them with the selected or active feed algorithm.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers see public posts; authenticated callers may also see their own visible circles.'
    },
    methods: ['GET'],
    steps: [
      'Send optional types, circles, from, to, algorithm, cursor, and limit query parameters.',
      'Use algorithm=latest to force chronological ordering.',
      'Use nextCursor for infinite scrolling.',
      'Read ranked to know whether algorithm scoring affected the page.'
    ],
    requestExamples: [
      {
        name: 'Read feed',
        description: 'Fetch a public feed page.',
        method: 'GET',
        query: { types: 'marketplace', circles: 'public', limit: 5 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Feed page returned.',
        body: { ok: true, posts: [], nextCursor: null, ranked: false }
      }
    ]
  }),
  endpoint({
    id: 'things-react',
    group: 'things',
    title: 'React to post',
    endpoint: '/api/v1/things/react',
    summary: 'Toggles one of the current user reactions on a visible post (multi-react).',
    detail:
      'emoji may be a single emoji or a multi-emoji group typed/pasted as one token (e.g. "🤣🤣🙌💀💦"). Toggling a token you already have removes it, a new one is added — you can hold several at once. Adding a token also records it in your recent reactions. Posting the same token again, or null, is the clear/no-op. Reaction counts are returned for immediate card updates.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST id and emoji (a single emoji or a multi-emoji token), or emoji null for a no-op.',
      'The post must be visible to the current user.',
      'Use reactionCounts and viewerReactions to update UI state; recentReactions (present when a token was added) refreshes the picker.',
      'Handle 401 unauthenticated and 404 for missing or not-visible posts.'
    ],
    requestExamples: [
      {
        name: 'Toggle reaction',
        description: 'Add or remove one reaction token on a post.',
        method: 'POST',
        body: { id: 'post_123', emoji: '🤣🤣🙌💀💦' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Reaction toggled.',
        body: {
          ok: true,
          reactionCounts: { '👍': 3, '🤣🤣🙌💀💦': 1 },
          viewerReactions: ['👍', '🤣🤣🙌💀💦'],
          recentReactions: ['🤣🤣🙌💀💦', '👍']
        }
      }
    ]
  }),
  endpoint({
    id: 'things-reactions-recent',
    group: 'things',
    title: 'Recent reactions',
    endpoint: '/api/v1/things/reactions-recent',
    summary: 'Returns the caller recently-used emoji tokens (most-recent-first).',
    detail:
      'The custom-emoji picker loads this lazily when it opens and pages through it 20 at a time. Tokens are single emoji or multi-emoji groups. Anonymous callers get an empty list.',
    auth: {
      mode: 'optional',
      description: 'Reads the auth cookie or Bearer token when present; anonymous callers receive an empty list.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials or a bearer token.',
      'Render recentReactions in the picker, 20 at a time with a "show more" pager.',
      'Seed from a local snapshot first for an instant render, then reconcile with this response.'
    ],
    requestExamples: [
      {
        name: 'Load recent reactions',
        description: 'Fetch the caller recently-used emoji.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Recently-used tokens, newest first.',
        body: { ok: true, recentReactions: ['🤣🤣🙌💀💦', '👍', '🔥', '💀'] }
      }
    ]
  }),
  endpoint({
    id: 'things-share',
    group: 'things',
    title: 'Share post',
    endpoint: '/api/v1/things/share',
    summary: 'Creates a share post that points back to a visible root post.',
    detail:
      'Shares copy the root post reference rather than chaining share-of-share references, so delete and count behavior stays deterministic.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the post id plus optional text and visibility.',
      'The source post must be public or owned/visible to the current user.',
      'Use the returned share post to update feed state.',
      'Handle 401 unauthenticated and 404 for missing or not-visible posts.'
    ],
    requestExamples: [
      {
        name: 'Share post',
        description: 'Create a repost with optional commentary.',
        method: 'POST',
        body: { id: 'post_123', text: 'Worth saving', visibility: 'public' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Share created.',
        body: { ok: true, post: { id: 'share_123', shareOf: 'post_123' } }
      }
    ]
  }),
  endpoint({
    id: 'things-user',
    group: 'things',
    title: 'User posts',
    endpoint: '/api/v1/things/user',
    summary: 'Returns posts for a public profile, filtered by viewer visibility.',
    detail:
      'Profile pages use this route to page through a user posts. Owners can see their full circle set; other viewers only see public content.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers can read public posts; authenticated callers may see their own broader visibility.'
    },
    methods: ['GET'],
    steps: [
      'Send username, optional cursor, and optional limit query parameters.',
      'Use nextCursor to fetch more posts.',
      'Read postCount for profile summary display.',
      'Handle 400 missing username and 404 unknown user.'
    ],
    requestExamples: [
      {
        name: 'Read user posts',
        description: 'Fetch public posts for a profile.',
        method: 'GET',
        query: { username: 'rick.deckard', limit: 10 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'User posts returned.',
        body: { ok: true, posts: [], nextCursor: null, postCount: 0 }
      }
    ]
  }),
  endpoint({
    id: 'users-profile',
    group: 'profile',
    title: 'User profile',
    endpoint: '/api/v1/users/profile',
    summary: 'Reads public profiles or updates the current user profile fields.',
    detail:
      'GET returns a stripped public projection that never includes email or verification fields. POST updates the caller display name, bio, avatar URL, or banner URL.',
    auth: {
      mode: 'optional',
      description: 'GET is public. POST requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with username to read a public profile and post count.',
      'POST displayName, bio, avatarUrl, or bannerUrl to update the current user profile.',
      'Only http(s) and data:image URLs are accepted for avatar/banner fields.',
      'Handle 400 missing username or invalid profile fields, 401 anonymous updates, and 404 unknown users.'
    ],
    requestExamples: [
      {
        name: 'Read public profile',
        description: 'Fetch a public profile.',
        method: 'GET',
        query: { username: 'rick.deckard' }
      },
      {
        name: 'Update profile',
        description: 'Update the caller profile fields.',
        method: 'POST',
        body: { bio: 'Working on Thingtime.', avatarUrl: 'https://example.com/avatar.png' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Public profile returned.',
        body: { ok: true, profile: { username: 'rick.deckard', displayName: 'Rick Deckard' }, postCount: 0 }
      },
      {
        status: 401,
        description: 'Anonymous caller attempted a profile update.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'vercel-deployments',
    group: 'vercel',
    title: 'Vercel deployments',
    endpoint: '/api/v1/vercel/deployments',
    summary: 'Returns deployment overview data for environment pickers and dashboards.',
    detail:
      'This route is visible only when deployment status is enabled. It normalizes branch limits and hides itself with 404 otherwise.',
    auth: {
      mode: 'none',
      description: 'Public status endpoint when enabled by server-side deployment configuration.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call with an optional limit, branchLimit, or branches query parameter.',
      'Use returned deployments to populate preview/environment selectors.',
      'Handle 404 as intentionally hidden when deployment status is disabled.',
      'Avoid exposing Vercel API tokens; this route returns sanitized overview data only.'
    ],
    requestExamples: [
      {
        name: 'List deployments',
        description: 'Read up to five branch deployments.',
        method: 'GET',
        query: { limit: 5 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Deployment overview.',
        body: { ok: true, project: 'thingtime', deployments: [] }
      },
      {
        status: 404,
        description: 'Status is hidden in this runtime.',
        body: 'Not found'
      }
    ]
  }),
  endpoint({
    id: 'vercel-status',
    group: 'vercel',
    title: 'Vercel status',
    endpoint: '/api/v1/vercel/status',
    summary: 'Returns status for the current Vercel deployment.',
    detail:
      'Use this route for footer/status UI when the deployment status feature is enabled.',
    auth: {
      mode: 'none',
      description: 'Public status endpoint when enabled by server-side deployment configuration.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call GET for normal status checks or POST for API tester parity.',
      'Read configured, state, label, and error fields.',
      'Handle 404 as intentionally hidden when status is disabled.',
      'Use /api/v1/vercel/status-data when a resource-only GET endpoint is required.'
    ],
    requestExamples: [
      {
        name: 'Read Vercel status',
        description: 'Check deployment status.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Deployment status.',
        body: { configured: true, state: 'READY', label: 'Vercel: ready' }
      }
    ]
  }),
  endpoint({
    id: 'vercel-status-data',
    group: 'vercel',
    title: 'Vercel status data',
    endpoint: '/api/v1/vercel/status-data',
    summary: 'Resource-only GET version of Vercel deployment status.',
    detail:
      'Use this endpoint when fetch callers need JSON and should not hit route components or tester parity actions.',
    auth: {
      mode: 'none',
      description: 'Public status endpoint when enabled by server-side deployment configuration.'
    },
    methods: ['GET'],
    steps: [
      'Call GET from status widgets or remote health checks.',
      'Read the same deployment status shape as /api/v1/vercel/status.',
      'Handle 404 as intentionally hidden when status is disabled.',
      'Do not expect dashboard secrets or raw Vercel API responses.'
    ],
    requestExamples: [
      {
        name: 'Read Vercel JSON status',
        description: 'Fetch deployment status data only.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Deployment status.',
        body: { configured: true, state: 'READY', label: 'Vercel: ready' }
      }
    ]
  }),
  endpoint({
    id: 'waitlist',
    group: 'waitlist',
    title: 'Waitlist',
    endpoint: '/api/v1/waitlist',
    summary: 'Adds an email address to the launch waitlist.',
    detail:
      'Use this endpoint from the landing page or external launch signup surfaces. The route validates email and is idempotent/rate-limit aware.',
    auth: {
      mode: 'none',
      description: 'Public signup endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST a valid email address.',
      'Show success when ok is true.',
      'Handle 400 for invalid email and 413 for bodies over 2 KiB.',
      'Handle 429 as a temporary rate-limit response.'
    ],
    requestExamples: [
      {
        name: 'Join waitlist',
        description: 'Add an email to the launch waitlist.',
        method: 'POST',
        body: { email: 'hello@example.com' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Email accepted.',
        body: { ok: true }
      },
      {
        status: 400,
        description: 'Email validation failed.',
        body: { ok: false, error: 'A valid email is required' }
      }
    ]
  })
];

const normaliseApiPath = (input: string) => {
  const raw = String(input || '').trim();
  const pathname = raw.includes('://') ? new URL(raw).pathname : raw.split('?')[0].split('#')[0];
  let path = pathname.replace(/^\/+|\/+$/g, '');

  if (!path.startsWith('api/')) {
    path = `api/${path}`;
  }

  path = `/${path}`;

  if (path.endsWith('-docs')) {
    path = path.slice(0, -'-docs'.length);
  }

  return path;
};

const apiDocMap = new Map(apiEndpointDocs.map((doc) => [normaliseApiPath(doc.endpoint), doc]));

export const getApiDocByPath = (path: string) => apiDocMap.get(normaliseApiPath(path)) || null;

export const apiV1RouteKeys = apiEndpointDocs
  .filter((doc) => doc.endpoint.startsWith('/api/v1/'))
  .map((doc) => doc.endpoint.replace(/^\/api\//, ''));

export const apiV1DocsRouteKeys = apiV1RouteKeys.map((route) => `${route}-docs`);

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

const compactJson = (value: unknown) => JSON.stringify(value);

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const makeUrl = (origin: string, endpointPath: string, query?: ApiRequestExample['query']) => {
  const url = new URL(endpointPath, origin || 'https://thingtime.com');

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

const shouldIncludeAuthHeader = (mode: ApiAuthMode) =>
  mode === 'bearer' || mode === 'session-or-bearer' || mode === 'optional';

const buildHeaders = (doc: ApiEndpointDoc, hasBody: boolean) => {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  if (shouldIncludeAuthHeader(doc.auth.mode)) {
    headers.Authorization = 'Bearer YOUR_THINGTIME_TOKEN';
  }

  return headers;
};

const primaryRequestExample = (doc: ApiEndpointDoc): ApiRequestExample =>
  doc.requestExamples[0] || {
    name: doc.title,
    description: doc.summary,
    method: doc.methods[0]
  };

export const buildPlatformExamples = (
  doc: ApiEndpointDoc,
  origin = 'https://thingtime.com'
): ApiPlatformExamples => {
  const example = primaryRequestExample(doc);
  const method = example.method || doc.methods[0];
  const hasBody = example.body !== undefined;
  const url = makeUrl(origin, doc.endpoint, example.query);
  const headers = buildHeaders(doc, hasBody);
  const jsonBody = hasBody ? compactJson(example.body) : '';
  const prettyBody = hasBody ? prettyJson(example.body) : '';
  const headerEntries = Object.entries(headers);

  const curlLines = [`curl -X ${method} ${shellQuote(url)}`];
  headerEntries.forEach(([key, value]) => curlLines.push(`  -H ${shellQuote(`${key}: ${value}`)}`));
  if (hasBody) curlLines.push(`  --data ${shellQuote(jsonBody)}`);

  const wgetLines = [`wget --method=${method}`];
  headerEntries.forEach(([key, value]) => wgetLines.push(`  --header=${shellQuote(`${key}: ${value}`)}`));
  if (hasBody) wgetLines.push(`  --body-data=${shellQuote(jsonBody)}`);
  wgetLines.push(`  -O - ${shellQuote(url)}`);

  const node = [
    `const response = await fetch(${JSON.stringify(url)}, {`,
    `  method: ${JSON.stringify(method)},`,
    `  headers: ${prettyJson(headers).replace(/\n/g, '\n  ')}${hasBody ? ',' : ''}`,
    ...(hasBody ? [`  body: JSON.stringify(${prettyBody.replace(/\n/g, '\n  ')})`] : []),
    '});',
    '',
    'if (!response.ok) {',
    '  throw new Error("Thingtime API failed: " + response.status);',
    '}',
    '',
    'console.log(await response.json());'
  ].join('\n');

  const pythonHeaders = prettyJson(headers).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None');
  const python = [
    'import json',
    'from urllib import request',
    '',
    ...(hasBody ? [`payload = ${prettyBody}`, ''] : []),
    `req = request.Request(`,
    `    ${JSON.stringify(url)},`,
    ...(hasBody ? ['    data=json.dumps(payload).encode("utf-8"),'] : []),
    `    method=${JSON.stringify(method)},`,
    `    headers=${pythonHeaders.replace(/\n/g, '\n    ')}`,
    ')',
    '',
    'with request.urlopen(req) as response:',
    '    print(response.read().decode("utf-8"))'
  ].join('\n');

  const rubyHeaders = [
    '{',
    ...headerEntries.map(([key, value]) => `  ${JSON.stringify(key)} => ${JSON.stringify(value)}`),
    '}'
  ].join('\n');
  const ruby = [
    "require 'json'",
    "require 'net/http'",
    "require 'uri'",
    '',
    ...(hasBody ? [`payload = JSON.parse(<<~JSON)`, prettyBody, 'JSON', ''] : []),
    `uri = URI(${JSON.stringify(url)})`,
    `request = Net::HTTP::${method === 'GET' ? 'Get' : 'Post'}.new(uri)`,
    `${rubyHeaders}.each { |key, value| request[key] = value }`,
    ...(hasBody ? ['request.body = payload.to_json'] : []),
    '',
    'response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|',
    '  http.request(request)',
    'end',
    '',
    'puts response.body'
  ].join('\n');

  return {
    curl: curlLines.join(' \\\n'),
    wget: wgetLines.join(' \\\n'),
    node,
    python,
    ruby
  };
};

export const serializeApiDoc = (
  doc: ApiEndpointDoc,
  origin = 'https://thingtime.com'
): SerializedApiEndpointDoc => ({
  ...doc,
  platformExamples: buildPlatformExamples(doc, origin)
});

export const createApiDocPayload = (doc: ApiEndpointDoc, origin?: string) => ({
  ok: true,
  docs: serializeApiDoc(doc, origin)
});
