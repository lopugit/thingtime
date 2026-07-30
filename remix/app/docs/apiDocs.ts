export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
    id: 'docs',
    group: 'docs',
    title: 'All API docs as Markdown',
    endpoint: '/api/docs',
    summary: 'Every Thingtime API endpoint documented in one Markdown file — made for AIs and humans alike.',
    detail:
      'GET returns text/markdown covering every endpoint in this catalog: methods, auth, summary, detail, ' +
      'steps, request/response examples, and a curl call each. If you are an AI (or a person) discovering ' +
      'the API by scanning /api* routes, fetch this once and you have the whole reference. Per-endpoint ' +
      'JSON versions also exist at <endpoint>-docs (e.g. /api/v1/things-docs), and the human-readable ' +
      'browser docs live at /docs/api. Anonymous, no auth.',
    auth: { mode: 'none', description: 'Public — documentation data.' },
    methods: ['GET'],
    steps: ['GET /api/docs and read the Markdown.'],
    requestExamples: [{ name: 'Fetch the reference', description: 'The whole API as one Markdown document.', method: 'GET' }],
    responseExamples: [
      { status: 200, description: 'Markdown document.', headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }
    ]
  }),
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
    id: 'auth-password-reset',
    group: 'auth',
    title: 'Password reset request',
    endpoint: '/api/v1/auth/password-reset',
    summary: 'Emails a single-use password reset link to a registered address.',
    detail:
      'Use this to start a password reset. The route always returns ok so account existence cannot be probed; when the email matches an account, a one-hour single-use reset link is delivered through the Thingtime email service. Requests are rate-limited per IP — the neutral response would otherwise hide a mail bomb.',
    auth: {
      mode: 'none',
      description: 'Public request endpoint — identity is proven later by the emailed token.'
    },
    methods: ['POST'],
    steps: [
      'POST the account email address.',
      'Treat the ok response as neutral — it does not confirm the account exists.',
      'The user opens the emailed link (/reset-password?token=…), which carries a single-use token valid for one hour.',
      'Finish with /api/v1/auth/password-reset/confirm using that token and the new password.',
      'Handle 429 when the per-IP request window is exhausted.'
    ],
    requestExamples: [
      {
        name: 'Request a reset link',
        description: 'Ask for a password reset email.',
        method: 'POST',
        body: { email: 'ada@example.com' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Request accepted (whether or not the account exists). Local/preview runs also return resetLink.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'auth-password-reset-confirm',
    group: 'auth',
    title: 'Password reset confirm',
    endpoint: '/api/v1/auth/password-reset/confirm',
    summary: 'Burns a reset token, sets the new password, and revokes all sessions.',
    detail:
      'Use this with the token from the reset email. On success the password is replaced and every live session for the account is revoked, so stolen cookies or bearer tokens stop working immediately.',
    auth: {
      mode: 'none',
      description: 'The single-use emailed token is the credential.'
    },
    methods: ['POST'],
    steps: [
      'POST the reset token together with the new password (minimum 6 characters).',
      'Tokens are single-use and expire after one hour — expired/used tokens return 400.',
      'All existing sessions are revoked on success; the user logs in again with the new password.'
    ],
    requestExamples: [
      {
        name: 'Set a new password',
        description: 'Consume a reset token and rotate the password.',
        method: 'POST',
        body: { token: 'reset-token-from-the-email', password: 'a-new-password' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Password rotated and sessions revoked.',
        body: { ok: true }
      },
      {
        status: 400,
        description: 'Missing/expired/used token or invalid password.',
        body: { ok: false, error: 'This reset link has expired — request a new one' }
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
    id: 'auth-two-factor',
    group: 'auth',
    title: 'Email 2FA settings',
    endpoint: '/api/v1/auth/two-factor',
    summary: 'Reads or toggles opt-in email 2FA for the current account.',
    detail:
      'When enabled, POST /api/v1/login stops minting sessions from a password alone: it returns { requiresOtp, challenge } and emails a security code that completes the login. Enabling requires a verified email address.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires the httpOnly session cookie or an Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET returns the current enabled state for the session user.',
      'POST { enabled: true } turns email 2FA on (requires a verified email).',
      'POST { enabled: false } turns it off.',
      'Subsequent logins follow the two-step challenge flow documented on /api/v1/login.'
    ],
    requestExamples: [
      {
        name: 'Enable email 2FA',
        description: 'Require an emailed security code on every login.',
        method: 'POST',
        body: { enabled: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Setting applied.',
        body: { ok: true, enabled: true }
      },
      {
        status: 400,
        description: 'Email not verified yet.',
        body: { ok: false, error: 'Verify your email before enabling email 2FA' }
      },
      {
        status: 401,
        description: 'No session or bearer token.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
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
    id: 'email-config',
    group: 'email',
    title: 'Email delivery config',
    endpoint: '/api/v1/email/config',
    summary: 'Returns the sanitized email delivery configuration for diagnostics.',
    detail:
      'Use this to check which provider (console or SES), region, sender addresses, and sandbox settings the runtime resolved — no credentials are ever included.',
    auth: {
      mode: 'none',
      description: 'Public diagnostic endpoint returning non-secret configuration only.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET the endpoint (POST behaves identically).',
      'Read provider to confirm whether real SES delivery or console logging is active.',
      'Use sesSandbox and testRecipient to plan /tests email checks.'
    ],
    requestExamples: [
      {
        name: 'Read email config',
        description: 'Inspect the resolved delivery configuration.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Sanitized email configuration.',
        body: {
          ok: true,
          email: {
            provider: 'console',
            region: 'us-east-1',
            configurationSetName: null,
            transactionalFrom: 'Thingtime <no-reply@thingtime.com>',
            newsletterFrom: 'Thingtime Updates <updates@thingtime.com>',
            sesSandbox: false,
            sandboxSendDelayMs: 0,
            testRecipient: 'support@thingtime.com',
            testRecipientDomain: 'thingtime.com'
          }
        }
      }
    ]
  }),
  endpoint({
    id: 'email-test-otp',
    group: 'email',
    title: 'Email OTP test send',
    endpoint: '/api/v1/email/test-otp',
    summary: 'Sends a test security-code email to the configured test recipient.',
    detail:
      'Dev/preview-only helper for the /tests page: it exercises the OTP template and delivery service end to end. Production environments return 403, and recipients are restricted to the configured test address (or a plus alias of it).',
    auth: {
      mode: 'none',
      description: 'Gated by environment (local development and Vercel previews), not by session.'
    },
    methods: ['POST'],
    steps: [
      'POST an email matching the configured test recipient or one of its plus aliases.',
      'Optionally pass code and expiresMinutes; a random six-digit code is generated otherwise.',
      'Inspect the returned delivery result and the email_messages record it created.'
    ],
    requestExamples: [
      {
        name: 'Send a test OTP',
        description: 'Deliver a security-code email to the test recipient.',
        method: 'POST',
        body: { email: 'support+otp-test@thingtime.com' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Test email queued/sent.',
        body: { ok: true, result: { delivered: false, via: 'console', status: 'logged' } }
      },
      {
        status: 403,
        description: 'Not a dev/preview environment.',
        body: { ok: false, error: 'Email OTP test sends are available only in local development and Vercel previews.' }
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
      'If the account has email 2FA enabled, the response is { requiresOtp: true, challenge } and a code is emailed — POST { challenge, code } to this same endpoint to finish.',
      'Store the Set-Cookie response header for browser clients.',
      'Use /api/v1/auth/me after login to confirm the current user.',
      'Handle 401 for invalid credentials/codes, 429 for rate-limited attempts or exhausted OTP retries, and 500 for unavailable backing services.'
    ],
    requestExamples: [
      {
        name: 'Login user',
        description: 'Authenticate a username/password account.',
        method: 'POST',
        body: { username: 'ada-lovelace', password: 'replace-with-the-user-password' }
      },
      {
        name: 'Complete email 2FA login',
        description: 'Finish a login that returned requiresOtp using the emailed security code.',
        method: 'POST',
        body: { challenge: 'challenge-id-from-the-first-response', code: '123456' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Login succeeded and auth cookie was set.',
        body: { ok: true, user: { id: '64f000000000000000000002', username: 'ada-lovelace' } }
      },
      {
        status: 200,
        description: 'Email 2FA is enabled — a security code was emailed; no session yet.',
        body: { ok: true, requiresOtp: true, challenge: 'challenge-id', expiresAt: '2026-01-01T00:10:00.000Z' }
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
    id: 'mongodb-endpoint',
    group: 'mongodb',
    title: 'MongoDB data endpoint',
    endpoint: '/api/v1/mongodb/endpoint',
    summary: 'Read or change the MongoDB endpoint the data plane uses for this browser session.',
    detail:
      'Thin-frontend mode: the session can point the open data plane (things, feed, search, comments, reactions, schemas, app-data) at any reachable MongoDB. Identity, auth and the protected system kinds always stay on the home Thingtime DB. The override is an httpOnly session cookie (tt_mongo) — or send an x-tt-mongo-url header per request from API clients. Activation probes the endpoint (connect + ping) before accepting it. Responses never include the URL itself, only the credentials-stripped host and db name.',
    auth: {
      mode: 'optional',
      description:
        'Works logged out for { url } and { reset }. Selecting a saved endpoint ({ savedId }) requires a signed-in session.'
    },
    methods: ['GET', 'POST', 'DELETE'],
    steps: [
      'GET to read the active endpoint: { endpoint: { custom, host, dbName, savedId }, defaultHost }.',
      'POST { url } with a mongodb:// or mongodb+srv:// URL to activate it for this browser session.',
      'POST { savedId } (signed in) to activate one of your saved endpoints.',
      'POST { reset: true } or send DELETE to return to the Thingtime default.',
      'A failed probe returns 422 with a safe error — the previous endpoint stays active.'
    ],
    requestExamples: [
      {
        name: 'Read active endpoint',
        description: 'Which MongoDB the data plane currently uses.',
        method: 'GET'
      },
      {
        name: 'Activate a custom endpoint',
        description: 'Point the data plane at a custom MongoDB for this session.',
        method: 'POST',
        body: { url: 'mongodb://localhost:27017/mydb' }
      },
      {
        name: 'Back to default',
        description: 'Clear the override.',
        method: 'POST',
        body: { reset: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Custom endpoint active.',
        body: {
          ok: true,
          endpoint: { custom: true, host: 'localhost:27017', dbName: 'mydb', savedId: null },
          defaultHost: 'cluster0.mongodb.net'
        }
      },
      {
        status: 422,
        description: 'Endpoint unreachable — nothing changed.',
        body: { ok: false, error: 'MongoServerSelectionError (ECONNREFUSED)' }
      }
    ]
  }),
  endpoint({
    id: 'mongodb-endpoints',
    group: 'mongodb',
    title: 'Saved MongoDB endpoints',
    endpoint: '/api/v1/mongodb/endpoints',
    summary: 'Manage the signed-in user’s saved data-plane MongoDB endpoints.',
    detail:
      'Saved endpoints persist in the user’s private secure state on the home DB, with the Thingtime default always available. Saved URLs may embed credentials, so responses only ever return the sanitized host and db name. Activate a saved endpoint via POST /api/v1/mongodb/endpoint with { savedId }.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Session cookie or Bearer token. Endpoints belong to the signed-in account.'
    },
    methods: ['GET', 'POST', 'DELETE'],
    steps: [
      'GET to list saved endpoints; the one active for this session carries active: true.',
      'POST { name?, url } to save an endpoint (probed first; duplicates and >20 entries are rejected).',
      'DELETE { id } to remove one — if it is the session’s active endpoint the override is cleared too.',
      'Activate with POST /api/v1/mongodb/endpoint { savedId }.'
    ],
    requestExamples: [
      {
        name: 'List saved endpoints',
        description: 'All endpoints saved to this account.',
        method: 'GET'
      },
      {
        name: 'Save an endpoint',
        description: 'Persist a custom MongoDB endpoint.',
        method: 'POST',
        body: { name: 'Homelab', url: 'mongodb://user:pass@localhost:27017/mydb' }
      },
      {
        name: 'Remove an endpoint',
        description: 'Delete a saved endpoint by id.',
        method: 'DELETE',
        body: { id: '665f0c2ab1d2c300a1b2c3d4' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Saved endpoints.',
        body: {
          ok: true,
          endpoints: [
            {
              id: '665f0c2ab1d2c300a1b2c3d4',
              name: 'Homelab',
              host: 'localhost:27017',
              dbName: 'mydb',
              createdAt: '2026-07-19T00:00:00.000Z',
              active: true
            }
          ],
          activeSavedId: '665f0c2ab1d2c300a1b2c3d4'
        }
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
    title: 'MongoDB query workbench',
    endpoint: '/api/v1/mongodb/raw-results',
    summary: 'Advertises and runs bounded, read-only MongoDB queries for the no-code admin workbench.',
    detail:
      'GET returns the server-owned capability catalogue. POST accepts a structured query built from filters, typed Extended JSON values, projection, sort, collation, index hints, or a read-only aggregation pipeline. Results are capped by document count, response bytes, and execution time. Mutations, change streams, operational/session inspection, server-side JavaScript, arbitrary databases, and unknown collections are rejected recursively.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist). Every request is re-authorized and query execution is rate-limited.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET the endpoint as an admin to load the exact collections, operations, stages, blocked keys, and resource limits.',
      'Choose one allowlisted Thingtime collection and a read operation: find, findOne, exact/estimated count, distinct, aggregate, indexes, or collection stats.',
      'POST the structured request. Use canonical MongoDB Extended JSON wrappers such as $oid, $date, $numberLong, and $regularExpression for typed values.',
      'Read results, resultCount, durationMs, truncated, redactedFields, and explain from the response.',
      'Handle 400 for invalid/unsafe queries, 401/403 for non-admin callers, 413 for oversized bodies, 429 for rate limiting, and 503 when MongoDB is unavailable.'
    ],
    requestExamples: [
      {
        name: 'Find recent posts',
        description: 'Run a bounded, sorted query from the no-code builder.',
        method: 'POST',
        body: {
          collection: 'things',
          operation: 'find',
          filter: { thingtime: { $all: ['post'] } },
          projection: { shareId: 1, thingtime: 1, crystal: 1, createdAt: 1, _id: 0 },
          sort: { createdAt: -1 },
          limit: 25,
          skip: 0,
          maxTimeMS: 5000,
          explain: false
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'A successful bounded query.',
        body: {
          ok: true,
          operation: 'find',
          collection: 'things',
          results: [],
          resultCount: 0,
          durationMs: 4.2,
          truncated: false,
          redactedFields: 0,
          explain: false
        }
      }
    ],
    notes: [
      'This endpoint is an admin diagnostic surface, not an integration API. App data flows should use the higher-level Thingtime endpoints.',
      'Passwords, credentials, secrets, tokens, JWTs, session/roster identifiers, private keys, and credentialed MongoDB URLs are always redacted.',
      'Aggregation and computed projections are disabled for authentication/config collections so a user expression cannot rename a secret before redaction.',
      '$out, $merge, $where, $function, $accumulator, change streams, session inspection, and raw database commands are deliberately unavailable.'
    ]
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
    id: 'apps',
    group: 'embed',
    title: 'Embed apps',
    endpoint: '/api/v1/apps',
    summary: 'Register and list the apps that can embed "Login with Thingtime" on other websites.',
    detail:
      'An app is what an external website registers before it can show a "Login with Thingtime" button ' +
      '(via the embed SDK at /sdk/thingtime-login.js). POST { name, origins } registers one: the server ' +
      'mints the clientId (ttapp_<uuid>) and validates origins — bare https origins like ' +
      'https://example.com, with http allowed only for localhost dev. Only those exact origins can open ' +
      'the authorize popup and receive tokens. GET lists your registered apps.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session (cookie or full-account Bearer). App-scoped tokens are rejected.' },
    methods: ['GET', 'POST'],
    steps: [
      'POST { name, origins } to register an app and receive its clientId.',
      'Drop the SDK + clientId into the external site (see /sdk/thingtime-login.js).',
      'GET to list your apps; update or delete them via /api/v1/apps/update and /api/v1/apps/delete.'
    ],
    requestExamples: [
      { name: 'List apps', description: 'Your registered apps.', method: 'GET' },
      {
        name: 'Register an app',
        description: 'Create an app locked to one origin.',
        method: 'POST',
        body: { name: 'Rainbow Notes', origins: ['https://rainbownotes.example'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'App registered.',
        body: {
          ok: true,
          app: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', name: 'Rainbow Notes', origins: ['https://rainbownotes.example'] }
        }
      },
      { status: 400, description: 'Bad origin.', body: { ok: false, error: 'Origins must be bare https origins like https://example.com (http is allowed for localhost only)' } }
    ],
    notes: ['Apps are things (thingtime ["app"]) owned by you; the clientId is public, but tokens only ever reach allowlisted origins.']
  }),
  endpoint({
    id: 'apps-update',
    group: 'embed',
    title: 'Update an embed app',
    endpoint: '/api/v1/apps/update',
    summary: 'Rename one of your embed apps or change its origin allowlist.',
    detail:
      'POST { clientId, name?, origins? }. Origins are re-validated like registration. Removing an origin ' +
      'takes effect on the next request from any token bound to it — the app-token resolver re-checks the ' +
      'allowlist every time.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session (cookie or full-account Bearer); you can only update apps you own.' },
    methods: ['POST'],
    steps: [
      'POST the clientId plus the fields to change.',
      'Tokens bound to removed origins stop working immediately.'
    ],
    requestExamples: [
      {
        name: 'Change origins',
        description: 'Swap the allowlist to a new domain.',
        method: 'POST',
        body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', origins: ['https://new.example'] }
      }
    ],
    responseExamples: [
      { status: 200, description: 'Updated.', body: { ok: true, app: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', name: 'Rainbow Notes', origins: ['https://new.example'] } } },
      { status: 404, description: 'Not yours / unknown.', body: { ok: false, error: 'App not found' } }
    ]
  }),
  endpoint({
    id: 'apps-delete',
    group: 'embed',
    title: 'Delete an embed app',
    endpoint: '/api/v1/apps/delete',
    summary: 'Delete one of your embed apps and revoke every token it ever minted.',
    detail:
      'POST { clientId }. Every app-scoped session for the app is revoked, so tokens held by embedding ' +
      'sites die immediately. End users KEEP their app-data things — that data belongs to them, not the ' +
      'app developer.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session (cookie or full-account Bearer); you can only delete apps you own.' },
    methods: ['POST'],
    steps: ['POST the clientId.', 'All app tokens are revoked; user data stays with its users.'],
    requestExamples: [
      { name: 'Delete', description: 'Remove the app.', method: 'POST', body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f' } }
    ],
    responseExamples: [
      { status: 200, description: 'Deleted.', body: { ok: true } },
      { status: 404, description: 'Not yours / unknown.', body: { ok: false, error: 'App not found' } }
    ]
  }),
  endpoint({
    id: 'apps-public',
    group: 'embed',
    title: 'Public app lookup',
    endpoint: '/api/v1/apps/public',
    summary: 'Anonymous lookup the authorize popup uses to validate a clientId + origin pair.',
    detail:
      'GET ?clientId=…&origin=…&scope=…&optional_scope=…. Returns the app\'s public face (clientId + ' +
      'name) plus the REQUIRED (`scope`) and OPTIONAL (`optional_scope`) permission sets as descriptor ' +
      'entries ({ id, title, description, kind, baseline }) for the consent screen\'s permissions ' +
      'selector — only when the app exists AND the origin is on its allowlist, so the popup can refuse ' +
      'unregistered embedders before any login UI renders. Scope paths are hierarchical dot paths from ' +
      '/api/v1/oauth/scopes (unknown names 400; empty scope → profile + app-data). 404 for unknown ' +
      'apps, 403 for origins not on the allowlist. EXCEPTION: add sandbox=1 and the lookup answers for ' +
      'ANY clientId with a mock app payload (flagged sandbox: true, no allowlist check) so integrators ' +
      'can build the consent flow before registering — pair with POST /api/v1/oauth/sandbox for a ' +
      'working pretend token.',
    auth: { mode: 'none', description: 'Anonymous — returns only the app name + scope descriptors.' },
    methods: ['GET'],
    steps: ['GET with clientId, the embedding page origin, and the requested scope set.', 'Render the consent screen from the returned name + scope descriptors.'],
    requestExamples: [
      {
        name: 'Lookup',
        description: 'Validate a clientId for an origin: require app-data, offer email + avatar.',
        method: 'GET',
        query: {
          clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
          origin: 'https://rainbownotes.example',
          scope: 'profile.username app-data',
          optional_scope: 'email profile.avatar'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Allowed.',
        body: {
          ok: true,
          app: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', name: 'Rainbow Notes' },
          origin: 'https://rainbownotes.example',
          requiredScopes: [
            { id: 'profile.username', title: 'Username', description: 'Your @username — the login identity itself.', kind: 'field', baseline: true },
            { id: 'app-data', title: 'App storage', description: 'Store its own data for you in your Thingtime account — only its own, nothing else.', kind: 'capability' }
          ],
          optionalScopes: [
            { id: 'email', title: 'Email address', description: 'The email address on your Thingtime account.', kind: 'field' },
            { id: 'profile.avatar', title: 'Avatar', description: 'Your profile picture.', kind: 'field' }
          ]
        }
      },
      { status: 403, description: 'Origin not allowlisted.', body: { ok: false, error: 'This origin is not on the app’s allowlist' } }
    ]
  }),
  endpoint({
    id: 'oauth-authorize',
    group: 'embed',
    title: 'Authorize (mint app token)',
    endpoint: '/api/v1/oauth/authorize',
    summary: 'The consent step of the "Login with Thingtime" popup — mints an app-scoped Bearer token.',
    detail:
      'POST { clientId, origin, scope?, optionalScope?, extra?, scopes?, sharedThings? } with the ' +
      'user\'s real session cookie (the popup runs on the Thingtime origin). `scope` is the REQUIRED ' +
      'floor the platform declared (the grant must cover all of it — the user\'s alternative is ' +
      'Cancel); `optionalScope` its nice-to-haves; `scopes` the paths the user approved, which may — ' +
      'unless extra=\'0\' — include ANY known scope the user volunteered beyond the request ("auto" ' +
      'sharing). `sharedThings` carries the shareIds hand-picked for the things scope (each must be ' +
      'owned by the user, max 100). Mints a revocable app-scoped session (purpose "app", 30 days, ' +
      'meta { scopes, sharedThings }) and returns its Bearer token, the granted scopes, and a user ' +
      'object shaped by the grant (id + username always; displayName/avatarUrl only when granted). ' +
      'App tokens are rejected by every normal endpoint: they only work on /api/v1/app-data*, ' +
      '/api/v1/oauth/userinfo, and /api/v1/oauth/shared, so a leaked token can\'t touch the rest of ' +
      'the account or mint further tokens.',
    auth: { mode: 'session', description: 'The end user\'s Thingtime session cookie (popup is same-origin).' },
    methods: ['POST'],
    steps: [
      'The SDK opens /authorize?client_id=…&origin=…&state=…&scope=… in a popup.',
      'The popup validates via /api/v1/apps/public, has the user log in if needed, and shows the consent + permissions selector.',
      'On approve it POSTs here with the user\'s selection, then hands the token to the opener via postMessage (targetOrigin = the validated origin).'
    ],
    requestExamples: [
      {
        name: 'Authorize',
        description: 'Grant the required floor + email, declining the avatar the app offered.',
        method: 'POST',
        body: {
          clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
          origin: 'https://rainbownotes.example',
          scope: 'profile.username app-data',
          optionalScope: 'email profile.avatar',
          scopes: ['profile.username', 'app-data', 'email']
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Token minted (the grant covers the required floor; avatar declined).',
        body: {
          ok: true,
          token: '<app-scoped-jwt>',
          tokenType: 'Bearer',
          expiresAt: '2026-08-11T00:00:00.000Z',
          scopes: ['profile.username', 'app-data', 'email'],
          sharedThings: 0,
          user: { id: '664f1c2a9d3e5b0012345678', username: 'lopu' }
        }
      },
      { status: 400, description: 'Grant missed a required scope.', body: { ok: false, error: 'The app requires the app-data permission — cancel instead if you’d rather not share it' } },
      { status: 403, description: 'Origin not allowlisted.', body: { ok: false, error: 'This origin is not on the app’s allowlist' } }
    ],
    notes: ['Revocable from both sides: the developer deletes the app (/api/v1/apps/delete), or the user disconnects it (/api/v1/oauth/grants/revoke) — the token dies before its exp like every Thingtime JWT.']
  }),
  endpoint({
    id: 'oauth-sandbox',
    group: 'embed',
    title: 'Sandbox token (build before registering)',
    endpoint: '/api/v1/oauth/sandbox',
    summary: 'Mint a real, working sandbox token for ANY clientId — no registration, no account, no browser.',
    detail:
      'POST { clientId?, origin?, scope?, scopes?, space?, username? } (all optional; anonymous, ' +
      'per-IP rate-limited). ' +
      'Returns the same handoff shape as /oauth/authorize plus sandbox: true — a signed Bearer token ' +
      'that WORKS for one hour against /api/v1/app-data (read/write/delete, including visibility ' +
      "'app'), /api/v1/app-data/shared, and /api/v1/oauth/userinfo. It resolves to a synthetic " +
      "pretend user (username 'sandbox-<name>', default sandbox-you), every byte written under it is " +
      'namespaced to that one token and TTL-reaped within the hour, and the token can never act as an ' +
      'account credential. By default two sandboxes are fully isolated; to rehearse the MULTI-USER ' +
      'shared feed, mint several tokens with the same `space` (an 8-64 char pool secret you choose — ' +
      'use a uuid) and distinct `username`s: same-space tokens see each other\'s visibility-\'app\' ' +
      'entries via /app-data/shared, each entry authored by its own pretend user gated by that ' +
      "token's scopes — private entries stay per-token even inside a space. This is the headless " +
      'counterpart of the consent popup\'s ?sandbox=1 mode (which accepts sandbox_space / ' +
      'sandbox_username URL params, or SDK options sandboxSpace / sandboxUsername): integration code ' +
      'written against it works unchanged when you register a real app and switch to ' +
      'Thingtime.login().',
    auth: { mode: 'none', description: 'Anonymous — the whole point is testing before you have anything.' },
    methods: ['POST'],
    steps: [
      'POST with the clientId + scopes you PLAN to use (e.g. scope: "profile.username app-data app-data.shared").',
      'Use the returned Bearer token against /app-data*, /app-data/shared, and /oauth/userinfo exactly like a real grant.',
      'Data and token evaporate within an hour — mint another whenever you need one.',
      'When ready: register the app (POST /api/v1/apps) and swap in Thingtime.login() — no other code changes.'
    ],
    requestExamples: [
      {
        name: 'Mint',
        description: 'A sandbox token for an app that does not exist yet.',
        method: 'POST',
        body: { clientId: 'macrobiotica-dev', origin: 'http://localhost:5599', scope: 'profile.username app-data app-data.shared' }
      },
      {
        name: 'Mint into a pool',
        description: 'Two mints with the same space = two pretend users sharing one feed.',
        method: 'POST',
        body: {
          clientId: 'macrobiotica-dev',
          scope: 'profile.username app-data app-data.shared',
          space: 'f6b2c1e8-demo-pool-2a1f0c9d8e7f',
          username: 'ada'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'A working pretend session.',
        body: {
          ok: true,
          sandbox: true,
          token: 'eyJhbGciOi…',
          tokenType: 'Bearer',
          expiresAt: '2026-07-27T09:00:00.000Z',
          scopes: ['profile.username', 'app-data', 'app-data.shared'],
          sharedThings: 0,
          user: { id: 'sandbox', username: 'sandbox-you' }
        }
      }
    ]
  }),
  endpoint({
    id: 'oauth-scopes',
    group: 'embed',
    title: 'Scope catalog',
    endpoint: '/api/v1/oauth/scopes',
    summary: 'The public catalog of permission-scope paths platforms can request.',
    detail:
      'Anonymous. Scopes are hierarchical dot paths — granting an ancestor (profile) covers every ' +
      'descendant (profile.avatar); profile.username is the always-granted baseline identity. Each ' +
      'entry carries the consent-screen wording ({ id, title, description, kind, baseline }); kinds: ' +
      'namespace, field, capability, picker. The authorize popup renders its permissions selector and ' +
      '"share more" section from this catalog, so new scopes added here appear everywhere at once.',
    auth: { mode: 'none', description: 'Anonymous — documentation data.' },
    methods: ['GET'],
    steps: ['GET the catalog.', 'Request paths via the SDK scopes/optionalScopes options.'],
    requestExamples: [{ name: 'Catalog', description: 'Every scope path.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'The catalog (abridged).',
        body: {
          ok: true,
          scopes: [
            { id: 'profile.username', title: 'Username', description: 'Your @username — the login identity itself.', kind: 'field', baseline: true },
            { id: 'profile.avatar', title: 'Avatar', description: 'Your profile picture.', kind: 'field' },
            { id: 'things', title: 'Things you choose', description: 'Read-only access to specific things you hand-pick…', kind: 'picker' }
          ],
          defaults: ['profile', 'app-data']
        }
      }
    ]
  }),
  endpoint({
    id: 'oauth-shared',
    group: 'embed',
    title: 'Shared things (picker grant)',
    endpoint: '/api/v1/oauth/shared',
    summary: 'Read the things the user hand-picked to share with your app.',
    detail:
      'GET with the app-scoped Bearer token; requires the things scope. Returns exactly the set the ' +
      'user ticked on the consent screen — read-only, ownership re-checked at read time (things the ' +
      'user has since deleted drop out), projected to content fields only ({ shareId, thingtime, ' +
      'crystal, tags, createdAt, updatedAt }) — never acl/owner internals or the extended sidecar. ' +
      'Same CORS + origin binding as /api/v1/app-data.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token with the things scope.' },
    methods: ['GET'],
    steps: ['Request the things scope (SDK scopes/optionalScopes).', 'The user picks items on the consent screen.', 'GET here to read exactly those.'],
    requestExamples: [{ name: 'Read', description: 'The shared set.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'The user shared one thing.',
        body: {
          ok: true,
          things: [
            { shareId: '4f6b2c1e-…', thingtime: ['post'], crystal: { type: 'text', text: 'Sunset over the bay 🌅' }, tags: [], createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' }
          ]
        }
      },
      { status: 403, description: 'Token lacks the things scope.', body: { ok: false, error: 'This token was not granted the things scope' } }
    ]
  }),
  endpoint({
    id: 'oauth-grants',
    group: 'embed',
    title: 'Connected apps (grants)',
    endpoint: '/api/v1/oauth/grants',
    summary: 'List the apps connected to YOUR account via "Login with Thingtime".',
    detail:
      'GET with your own session. One entry per connected app, aggregated over your live app sessions: ' +
      'the app name (null if it was since deleted), the union of scopes you granted, how many live ' +
      'sessions it holds, first/last grant times, and the latest expiry. Disconnect one with ' +
      '/api/v1/oauth/grants/revoke.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session. App-scoped tokens are rejected.' },
    methods: ['GET'],
    steps: ['GET to see every app connected to your account.', 'POST the clientId to /api/v1/oauth/grants/revoke to disconnect one.'],
    requestExamples: [{ name: 'List', description: 'Apps connected to your account.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Connected apps.',
        body: {
          ok: true,
          grants: [
            {
              clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
              appName: 'Rainbow Notes',
              scopes: ['profile', 'app-data'],
              sessions: 1,
              firstGrantedAt: '2026-07-12T00:00:00.000Z',
              lastGrantedAt: '2026-07-12T00:00:00.000Z',
              expiresAt: '2026-08-11T00:00:00.000Z'
            }
          ]
        }
      }
    ]
  }),
  endpoint({
    id: 'oauth-grants-revoke',
    group: 'embed',
    title: 'Disconnect an app',
    endpoint: '/api/v1/oauth/grants/revoke',
    summary: 'Revoke every app session YOU granted to one app — its tokens stop working immediately.',
    detail:
      'POST { clientId } with your own session. Revokes all of your live app-scoped sessions for that ' +
      'clientId (other users are unaffected); the app-token resolver checks session liveness on every ' +
      'request, so any token the app still holds for you dies instantly. This is the end-user ' +
      'counterpart to the developer-side /api/v1/apps/delete.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session. App-scoped tokens are rejected.' },
    methods: ['POST'],
    steps: ['Find the clientId via /api/v1/oauth/grants.', 'POST it here; revoked reports how many sessions died.'],
    requestExamples: [
      { name: 'Disconnect', description: 'Cut an app off from your account.', method: 'POST', body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f' } }
    ],
    responseExamples: [{ status: 200, description: 'Revoked.', body: { ok: true, revoked: 1 } }]
  }),
  endpoint({
    id: 'oauth-userinfo',
    group: 'embed',
    title: 'Userinfo (SSO identity)',
    endpoint: '/api/v1/oauth/userinfo',
    summary: 'Resolve the user an app-scoped token was granted for — the SSO identity endpoint.',
    detail:
      'GET with the app-scoped Bearer token. Returns the granted scopes plus a user object shaped ' +
      'field-by-field by the grant: id, username, and a profileUrl Thingtime link always ' +
      '(profile.username baseline); displayName, avatarUrl, bio, bannerUrl each under their ' +
      'profile.<field> path (a granted profile namespace covers them all); email under the email ' +
      'scope; sharedThings reports the picker count. Platforms call this to sync the account on ' +
      'their side and light up features for whatever the user shared. Same CORS + origin binding as ' +
      '/api/v1/app-data.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token only.' },
    methods: ['GET'],
    steps: ['GET with the token from Thingtime.login(…).', 'Read user + scopes; email appears only under the email scope.'],
    requestExamples: [{ name: 'Lookup', description: 'Who is this token?', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Identity — avatar + email granted, bio/banner/displayName were not.',
        body: {
          ok: true,
          scopes: ['profile.username', 'app-data', 'profile.avatar', 'email'],
          sharedThings: 0,
          user: {
            id: '664f1c2a9d3e5b0012345678',
            username: 'lopu',
            profileUrl: 'https://thingtime.com/profile/lopu',
            avatarUrl: null,
            email: 'lopu@example.com'
          }
        }
      },
      { status: 401, description: 'Missing/expired/revoked token.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'app-data',
    group: 'embed',
    title: 'App data (read/write)',
    endpoint: '/api/v1/app-data',
    summary: 'Key/value storage an embedded app keeps in its user\'s Thingtime account.',
    detail:
      'Authenticated by an app-scoped Bearer token from /api/v1/oauth/authorize. GET ?key=… returns one ' +
      'entry ({ entry: null } when unset); GET without key lists every entry for this (user, app). ' +
      'POST { key, value, visibility?, acl? } inserts or updates one entry — keys are [A-Za-z0-9._:-] up to 128 chars ' +
      '(first char must be a letter or digit), values ' +
      'any JSON up to 32KB, at most 200 keys per user per app. Entries are things owned by the END USER, ' +
      'and their audience IS the acl array: ["tt:user"] (private, the default) or ' +
      '["tt:user", "tt:app/<clientId>"] (readable by other users of this one app via /api/v1/app-data/shared). ' +
      "visibility: 'private' | 'app' is accepted sugar for those two acls and derived back on the wire; " +
      'marking an entry \'app\' requires the app-data.shared scope, and a write that omits visibility/acl ' +
      "never changes an existing entry's audience. Users can always see and delete what an app stored. " +
      'CORS: browser calls must ' +
      'come from the token\'s own bound origin. Requires the app-data scope — 403 when the user declined ' +
      'it on the consent screen.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token with the app-data scope — cookies never authenticate this route.' },
    methods: ['GET', 'POST'],
    steps: [
      'Take the token from Thingtime.login(…) in the SDK.',
      'GET to read (with ?key for one entry), POST { key, value } to write.',
      'Values round-trip as JSON; delete keys via /api/v1/app-data/delete.'
    ],
    requestExamples: [
      { name: 'Read one', description: 'One key.', method: 'GET', query: { key: 'preferences' } },
      { name: 'List all', description: 'Everything this app stored for this user.', method: 'GET' },
      { name: 'Write', description: 'Upsert a key.', method: 'POST', body: { key: 'preferences', value: { theme: 'rainbow' } } },
      {
        name: 'Write shared',
        description: "Upsert a key other users of this app may read (needs the app-data.shared scope).",
        method: 'POST',
        body: { key: 'post:2026-07-27', value: { text: 'Miso soup 🍲' }, visibility: 'app' }
      }
    ],
    responseExamples: [
      { status: 200, description: 'Entry written.', body: { ok: true, entry: { key: 'preferences', value: { theme: 'rainbow' }, visibility: 'private', acl: ['tt:user'], updatedAt: '2026-07-12T00:00:00.000Z' } } },
      { status: 401, description: 'Missing/expired/revoked token.', body: { ok: false, error: 'Unauthorized' } },
      { status: 403, description: 'Browser origin ≠ token origin.', body: { ok: false, error: 'Origin does not match this token' } }
    ]
  }),
  endpoint({
    id: 'app-data-delete',
    group: 'embed',
    title: 'App data (delete)',
    endpoint: '/api/v1/app-data/delete',
    summary: 'Delete one key/value entry the app stored for this user.',
    detail:
      'POST { key } with the app-scoped Bearer token. Returns deleted: false when the key was already ' +
      'absent. Same CORS + origin binding as /api/v1/app-data.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token only.' },
    methods: ['POST'],
    steps: ['POST the key to remove.'],
    requestExamples: [
      { name: 'Delete', description: 'Remove a key.', method: 'POST', body: { key: 'preferences' } }
    ],
    responseExamples: [
      { status: 200, description: 'Removed (or already absent).', body: { ok: true, deleted: true } }
    ]
  }),
  endpoint({
    id: 'app-data-shared',
    group: 'embed',
    title: 'App data (shared pool)',
    endpoint: '/api/v1/app-data/shared',
    summary: "Read the entries every user of this app opted into sharing — the app-scoped social read.",
    detail:
      'GET ?key=&prefix=&limit=&cursor= returns entries from ALL users of the calling app whose acl carries ' +
      'tt:app/<clientId> (written via POST /api/v1/app-data with visibility \'app\'), newest first with a ' +
      'cursor — never entries from other apps, never private entries. key= matches exactly, key=post:* or ' +
      "prefix= matches a prefix; limit clamps to 1–50 (default 20). Requires the app-data.shared scope on " +
      "the calling token, and each entry's author must still hold a live grant covering that scope — a user " +
      'who disconnects the app (or whose grant expires) drops out of this feed instantly while keeping ' +
      "their data. Each entry's author is shaped by that AUTHOR's own grant, exactly like /oauth/userinfo: " +
      'id + username always, displayName/avatarUrl only when that author granted profile.displayName / ' +
      'profile.avatar. Same CORS + origin binding as /api/v1/app-data. Note the scope is EXACT consent: ' +
      "granting app-data does NOT imply app-data.shared — apps must request it and users see its own line " +
      'on the consent screen.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token with the app-data.shared scope.' },
    methods: ['GET'],
    steps: [
      "Request the app-data.shared scope in Thingtime.login({ scopes: [...] }).",
      "Write shared entries with POST /api/v1/app-data { key, value, visibility: 'app' }.",
      'GET this route (e.g. ?key=post:*) and page with nextCursor until it returns null.',
      'Render authors from each entry\'s author object — fields mirror what each author consented to.'
    ],
    requestExamples: [
      { name: 'App feed', description: 'Newest shared post entries.', method: 'GET', query: { key: 'post:*', limit: 20 } }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'One page, newest first.',
        body: {
          ok: true,
          entries: [
            {
              key: 'post:2026-07-27',
              value: { text: 'Miso soup 🍲' },
              visibility: 'app',
              updatedAt: '2026-07-27T00:00:00.000Z',
              createdAt: '2026-07-27T00:00:00.000Z',
              author: { id: '64f000000000000000000002', username: 'ada-lovelace', avatarUrl: null }
            }
          ],
          nextCursor: 'eyJ1IjoxNzAwMDAwMDAwMDAwLCJzIjoi…'
        }
      },
      { status: 403, description: 'Token lacks the scope.', body: { ok: false, error: 'This token was not granted the app-data.shared scope' } }
    ]
  }),
  endpoint({
    id: 'things',
    group: 'things',
    title: 'Things (full CRUD)',
    endpoint: '/api/v1/things',
    summary: 'One endpoint for every thing: create, read, update/upsert, and delete posts, comments, reactions, and shares.',
    detail:
      'Everything is a thing: one root Thing schema per doc, sub-schemas applied via the thingtime array of schema ids (see /schemas), the payload under crystal, and the audience under acl — tt: grants plus "-"-prefixed exclusions where the most specific matching entry wins (["tt:all"] public, ["-tt:all","tt:userFriends","tt:user"] friends-only, ["tt:all","-tt:user/somebody"] public except one user; owners always see their own things). POST creates (unified shape or the legacy post body — same path), GET reads one thing / lists a target’s attached things / lists your own, PUT upserts by id (create-or-replace), PATCH merges a partial update, DELETE removes an owned thing and its attached comments/reactions. The legacy visibility names still work as input and are derived on the wire. Crystals are optionally schema-less: omit thingtime and it defaults to ["data"], the bounded free-form crystal. Beside the crystal, every thing also carries a schema-free extended property — any JSON up to 512KB, stored and returned exactly as given, never validated or interpreted, and not structured-searchable (/search field conditions can’t target it, though its string content is indexed by the wildcard text index). extended replaces as a whole value on write (deep-merging arbitrary JSON is ambiguous) and null clears it — the open sidecar external apps park their data in.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Mutations require an auth cookie or Authorization: Bearer token. GET works logged out for tt:all things; attached things inherit their target audience.'
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    steps: [
      'POST { thingtime: ["post"], crystal: { type, text, images, listing, thing }, acl, tags } — or the legacy post body — to create. type is text, image, marketplace, or thingtime.',
      'Thingtime posts (type "thingtime") carry a free-form structured thing under crystal.thing — bounded like data crystals and searchable as crystal.thing.<field> on /search. They can also carry images and an optional marketplace listing (validated like a marketplace post’s when present).',
      'Omit thingtime entirely to create a schema-less thing: { crystal: { any: "shape" } } defaults to thingtime ["data"].',
      'Optionally add extended: any JSON up to 512KB, stored untouched and returned as-is — replace-on-write, null clears it. It is not structured-searchable (/search field conditions can’t target it), though its string content is indexed by the wildcard text index like any field.',
      'Attached kinds (comment, reaction) require targetId and carry acl ["tt:inherit"]; shares carry thingtime ["post","share"].',
      'GET ?id= reads one thing; GET ?target=&thingtime=comment lists a visible thing’s comments; GET ?thingtime=&cursor=&limit= lists your own things.',
      'PUT { id, thingtime, crystal, acl? } creates the thing at that id (201) or replaces the owned thing’s crystal whole (200); PATCH { id, crystal?, extended?, acl?, tags? } merges crystal fields (extended still replaces whole).',
      'DELETE ?id= (or body { id }) removes an owned thing; attached comments/reactions go with it, shares survive with an original-unavailable placeholder.',
      'Handle 401 unauthenticated, 400 invalid payload or acl, 404 missing target/thing, and 413 oversized payload.'
    ],
    requestExamples: [
      {
        name: 'Create public post',
        description: 'A public text post — acl ["tt:all"] is also the default when neither acl nor visibility is sent.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Everything is a thing ✨' },
          acl: ['tt:all'],
          tags: ['thingtime']
        }
      },
      {
        name: 'Create friends-only post',
        description: 'Exclude the world, grant the friends circle and yourself.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Bonfire at ours on Saturday 🔥' },
          acl: ['-tt:all', 'tt:userFriends', 'tt:user']
        }
      },
      {
        name: 'Create thingtime post',
        description: 'A post carrying any structured thing — searchable by its real datatypes on /search.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: {
            type: 'thingtime',
            text: 'My new standing desk 🌀',
            thing: { name: 'Walnut standing desk', legs: 4, material: 'wood', height: 130, sitStand: true }
          },
          tags: ['furniture']
        }
      },
      {
        name: 'Create public-except-one post',
        description: 'Grants and exclusions combine; the most specific entry wins per viewer.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Planning a surprise party 🎂🤫' },
          acl: ['tt:all', '-tt:user/birthday.person', 'tt:user']
        }
      },
      {
        name: 'Create marketplace post (legacy body)',
        description: 'The pre-unification body still works and maps onto the same path — visibility names become acls.',
        method: 'POST',
        body: {
          type: 'marketplace',
          text: 'Selling my hoverboard, barely used.',
          listing: { title: 'Hoverboard', price: 420, currency: 'AUD', category: 'other' },
          visibility: 'public'
        }
      },
      {
        name: 'Comment via the unified shape',
        description: 'Comments are things too — targetId points at the post, audience inherits.',
        method: 'POST',
        body: {
          thingtime: ['comment'],
          crystal: { text: 'So say we all 🚀' },
          targetId: 'post_123'
        }
      },
      {
        name: 'Create a schema-less thing',
        description: 'No thingtime needed — a bare crystal defaults to ["data"], and extended carries anything else as-is.',
        method: 'POST',
        body: {
          crystal: { name: 'Walnut standing desk', legs: 4, material: 'wood' },
          extended: { myApp: { mood: 'curious', readingList: ['FUNDAMENTALS.md', { title: 'Everything is a thing', progress: 0.42 }] } },
          acl: ['tt:user']
        }
      },
      {
        name: 'Read one thing',
        description:
          'Fetch a thing by id (posts AND comments include the full post projection; comments also return parent and root for thread navigation — the /post/:id permalink pages are backed by this).',
        method: 'GET',
        query: { id: 'post_123' }
      },
      {
        name: 'List comments of a post',
        description: 'Read the comment things attached to a visible thing.',
        method: 'GET',
        query: { target: 'post_123', thingtime: 'comment', limit: 20 }
      },
      {
        name: 'List your own things',
        description: 'Everything you own, newest first — filter with thingtime=post,comment.',
        method: 'GET',
        query: { thingtime: 'post', limit: 10 }
      },
      {
        name: 'Upsert by id',
        description: 'PUT creates the thing at your id or replaces the crystal whole — handy for idempotent sync clients.',
        method: 'PUT',
        body: {
          id: 'my-sync-doc-001',
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Synced snapshot v2' },
          acl: ['tt:user']
        }
      },
      {
        name: 'Patch a thing',
        description: 'PATCH merges crystal fields and can retarget the audience.',
        method: 'PATCH',
        body: { id: 'post_123', crystal: { text: 'Edited ✏️' }, acl: ['-tt:all', 'tt:userFamily', 'tt:user'] }
      },
      {
        name: 'Delete a thing',
        description: 'Removes an owned thing; its comments and reactions go with it.',
        method: 'DELETE',
        query: { id: 'post_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Post thing created.',
        body: {
          ok: true,
          post: {
            id: 'post_123',
            thingtime: ['post'],
            type: 'text',
            text: 'Everything is a thing ✨',
            acl: ['tt:all'],
            visibility: 'public'
          }
        }
      },
      {
        status: 201,
        description: 'PUT created a new thing at the caller-chosen id.',
        body: {
          ok: true,
          created: true,
          thing: {
            id: 'my-sync-doc-001',
            thingtime: ['post'],
            crystal: { type: 'text', text: 'Synced snapshot v2' },
            acl: ['tt:user']
          },
          post: { id: 'my-sync-doc-001', visibility: 'private' }
        }
      },
      {
        status: 200,
        description: 'Attached things listed.',
        body: {
          ok: true,
          things: [
            {
              id: 'comment_123',
              thingtime: ['comment'],
              crystal: { text: 'So say we all 🚀' },
              targetId: 'post_123',
              acl: ['tt:inherit'],
              visibility: 'inherit'
            }
          ],
          nextCursor: null
        }
      },
      {
        status: 400,
        description: 'Malformed acl entry.',
        body: { ok: false, error: "acl entries look like tt:all, tt:user, tt:userFriends, or tt:user/<username>, optionally '-' prefixed (got tt bogus)" }
      }
    ],
    notes: [
      'System kinds (user, theme, feed-algorithm, waitlist) are protected: this endpoint refuses to create, update, or delete them — they are managed exclusively by their dedicated endpoints (auth/register, users/profile, themes, algorithms, waitlist).',
      'acl entries: tt:all, tt:user (owner), tt:userFriends, tt:userFamily, tt:user/<username>, each optionally "-" prefixed; the most specific matching entry decides and owners always view. Circles resolve to the owner only until a relationship graph exists.',
      'Every doc stores the root schemaVersion it was written at; admins migrate older docs via /api/v1/admin/migrations.',
      'Browse every schema kind at /schemas or GET /api/v1/schemas.',
      'The comment/react/share/update/delete sub-routes remain as sugar over this endpoint.'
    ]
  }),
  endpoint({
    id: 'things-quota',
    group: 'things',
    title: 'Atomic service quota',
    endpoint: '/api/v1/things/quota',
    summary: 'Atomically reserve daily work and acquire rolling-window permits for a service account.',
    detail:
      'A server-to-server coordination primitive stored as one private, deterministic data Thing per service-account owner + key. ' +
      'GET ?key= returns bounded status. POST performs reserve, permit, release, or reset with one atomic Mongo findOneAndUpdate, ' +
      'so concurrent serverless invocations cannot oversubscribe a daily or rolling cap. The first reserve pins the policy. ' +
      'Every time decision uses Thingtime server time; request bodies cannot supply now. State and lookups are always scoped to the authenticated owner.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Requires a live service-purpose Thingtime credential, supplied as Authorization: Bearer or the tt_auth cookie. Ordinary browser sessions, user accounts, and app-scoped tokens are rejected.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'POST reserve with a globally unique reservationId, positive count, and policy. A replay with the same count is idempotent; a different count is 409.',
      'Before each expensive unit, POST permit with a permitId beginning with reservationId + ":". granted false is a normal 200 response; wait until retryAt before retrying.',
      'If a reserved unit became a cache hit before its permit, POST release with that same would-be child id as releaseId. Replays never decrement twice.',
      'GET status for daily and rolling remaining values. An authenticated service can POST reset for its own key; reset preserves in-flight identities and rolling permits.',
      'Treat 503 as fail-closed. No work should continue when quota state is unavailable.'
    ],
    requestExamples: [
      {
        name: 'Read status',
        description: 'Read this service account quota.',
        method: 'GET',
        query: { key: 'pokeworld:block-generation' }
      },
      {
        name: 'Reserve blocks',
        description: 'Reserve three daily generation slots.',
        method: 'POST',
        body: {
          key: 'pokeworld:block-generation',
          operation: 'reserve',
          reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd',
          count: 3,
          policy: { dailyLimit: 500, rollingLimit: 9, rollingWindowMs: 5000 }
        }
      },
      {
        name: 'Acquire permit',
        description: 'Acquire one of nine rolling-window permits.',
        method: 'POST',
        body: {
          key: 'pokeworld:block-generation',
          operation: 'permit',
          reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd',
          permitId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd:946647,488524'
        }
      },
      {
        name: 'Release cache hit',
        description: 'Return one reserved daily slot before it acquires a permit.',
        method: 'POST',
        body: {
          key: 'pokeworld:block-generation',
          operation: 'release',
          reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd',
          releaseId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd:946647,488524'
        }
      },
      {
        name: 'Reset daily usage',
        description: 'Clear daily use without cancelling in-flight work.',
        method: 'POST',
        body: { key: 'pokeworld:block-generation', operation: 'reset' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Reservation accepted.',
        body: {
          ok: true,
          status: {
            key: 'pokeworld:block-generation',
            policy: { dailyLimit: 500, rollingLimit: 9, rollingWindowMs: 5000 },
            dayKey: '2026-07-19',
            dailyUsed: 3,
            dailyRemaining: 497,
            rollingUsed: 0,
            rollingRemaining: 9,
            rollingResetAt: null
          },
          reservation: {
            dayKey: '2026-07-19',
            reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd'
          }
        }
      },
      {
        status: 200,
        description: 'Rolling cap reached; retry at the server epoch timestamp.',
        body: {
          ok: true,
          status: { rollingUsed: 9, rollingRemaining: 0 },
          permit: {
            permitId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd:946647,488524',
            granted: false,
            retryAt: 1784462405010
          }
        }
      },
      {
        status: 409,
        description: 'A caller tried to change a pinned policy.',
        body: {
          ok: false,
          error: 'Quota policy is already pinned to different limits',
          code: 'QUOTA_POLICY_CONFLICT'
        }
      },
      {
        status: 413,
        description: 'The JSON body exceeded the 16 KiB route cap.',
        body: { ok: false, error: 'Request body too large' }
      },
      {
        status: 503,
        description: 'Fail-closed storage error.',
        body: { ok: false, error: 'Quota store is unavailable', code: 'QUOTA_UNAVAILABLE' }
      }
    ],
    notes: [
      'Keys are 1-128 safe characters. Reservation, permit, and release ids are bounded; permitId/releaseId must begin with reservationId + ":".',
      'Policy bounds: dailyLimit 1-10000, rollingLimit 1-1000, rollingWindowMs 100-86400000.',
      'Errors include a stable code: INVALID_REQUEST, QUOTA_NOT_FOUND, QUOTA_POLICY_CONFLICT, QUOTA_RESERVATION_CONFLICT, QUOTA_DAILY_LIMIT, QUOTA_RESERVATION_EXPIRED, QUOTA_PERMIT_CONFLICT, QUOTA_RELEASE_CONFLICT, or QUOTA_UNAVAILABLE.',
      'The raw quota Thing is private (acl ["tt:user"]); responses expose only the bounded status and operation result.'
    ]
  }),
  endpoint({
    id: 'things-search',
    group: 'things',
    title: 'Search things',
    endpoint: '/api/v1/things/search',
    summary: 'Structured MongoDB-style search plus Google-like ranked text search over every thing you can see.',
    detail:
      'The search behind /search. Two modes that compose: q runs a ranked text search (weighted ' +
      'wildcard text index over every string field — relevance-sorted like a web search), and ' +
      'conditions runs a structured query built from a whitelisted operator grammar: eq, ne, gt, ' +
      'gte, lt, lte, between, in, nin, exists, type, contains, startsWith, endsWith. Fields address the ' +
      'crystal by path (bare names auto-prefix, so "legs" means crystal.legs) plus the root ' +
      'fields tags, thingtime, createdAt, updatedAt, shareId, and targetId. Conditions nest into ' +
      'all/any groups (depth ≤ 3, ≤ 32 conditions); values must be bounded primitives, and text ' +
      'operators escape to literal matching — raw regex and query operators from the client never ' +
      'reach the database. Results honour the same audience model as the feed: public things plus ' +
      'your own, with exact acl evaluation per doc; attached tt:inherit things (comments, ' +
      'reactions) only surface for their owner.',
    auth: {
      mode: 'optional',
      description:
        'Works logged out (tt:all things only, throttled per IP). Authenticated searches also see your own things.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET ?q=<text>&thingtime=&tags=&sort=&cursor=&limit= for the simple shareable form.',
      'POST { q?, mode: "all"|"any", conditions: [{ field, op, value | values } | { mode, conditions: [...] }], thingtime?, tags?, from?, to?, sort?, cursor?, limit? } for structured searches.',
      'Range searches are one atomic between condition ({ field, op: "between", values: [low, high] }, either end open); enum picks are one in condition.',
      'sort defaults to relevance with q, newest otherwise (oldest also supported); ranked pages cursor by offset, chronological pages by the standard createdAt_shareId cursor.',
      'Shortcut filters (the feed/profile Advanced panel) compose with everything above: types (post types, csv), circles (audience circles, csv), author (one username — unknown usernames match nothing), minTextChars/maxTextChars (post text length), and minReactions/minComments.',
      'Engagement thresholds (minReactions/minComments) count child things at read time, so they search a bounded window of the newest (or best-matching) 400 candidates and page within it by offset — the same determinism trade-off as the ranked feed.',
      'The response carries things (generic projections), posts (full post projections keyed by thing id), nextCursor, and a capped approximate total (a visibility-superset count, only computed on the first page).',
      'Handle 400 invalid grammar and 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Ranked text search',
        description: 'Google-style: relevance-ranked matches across every string field of every visible thing.',
        method: 'GET',
        query: { q: 'standing desk walnut', limit: 20 }
      },
      {
        name: 'Structured property search',
        description: 'Real datatype conditions on crystal fields — a 60–130cm sit/stand table with wood or concrete top.',
        method: 'POST',
        body: {
          mode: 'all',
          conditions: [
            { field: 'legs', op: 'gte', value: 3 },
            { field: 'material', op: 'in', values: ['wood', 'concrete'] },
            { field: 'height', op: 'between', values: [60, 130] },
            { field: 'features', op: 'contains', value: 'sit/stand' }
          ]
        }
      },
      {
        name: 'Any-of groups + datatype checks',
        description: 'Nested all/any groups compose; type/exists conditions search by developer datatype.',
        method: 'POST',
        body: {
          mode: 'all',
          conditions: [
            { field: 'price', op: 'type', value: 'number' },
            {
              mode: 'any',
              conditions: [
                { field: 'condition', op: 'eq', value: 'new' },
                { field: 'price', op: 'lt', value: 100 }
              ]
            }
          ],
          thingtime: ['post'],
          sort: 'newest'
        }
      },
      {
        name: 'Text + structure together',
        description: 'Relevance-ranked text matching, narrowed by structured conditions.',
        method: 'POST',
        body: {
          q: 'table',
          conditions: [{ field: 'legs', op: 'gte', value: 4 }]
        }
      },
      {
        name: 'Advanced feed shortcuts',
        description: 'The feed/profile Advanced panel: popular long-form posts by one user, tagged desk.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          author: 'rick.deckard',
          tags: 'desk',
          minReactions: 5,
          minComments: 2,
          minTextChars: 200
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Matches, newest or best first.',
        body: {
          ok: true,
          things: [
            {
              id: 'thing_123',
              thingtime: ['post'],
              crystal: { type: 'text', text: 'Standing desk, walnut top, 60–130cm' },
              tags: ['furniture'],
              acl: ['tt:all'],
              visibility: 'public'
            }
          ],
          posts: { thing_123: { id: 'thing_123', type: 'text', text: 'Standing desk, walnut top, 60–130cm' } },
          nextCursor: null,
          total: 1,
          totalCapped: false,
          ranked: true
        }
      },
      {
        status: 400,
        description: 'A condition failed the grammar.',
        body: { ok: false, error: 'Unknown search operator: where (use eq, ne, gt, gte, lt, lte, between, in, nin, exists, type, contains, startsWith, endsWith)' }
      }
    ],
    notes: [
      'Browse schemas to search by on /search — picking one prefills conditions from its field definitions (user-authored schema things use thingtime ["schema"]).',
      'contains/startsWith/endsWith match escaped literals case-insensitively; raw regex is deliberately not accepted.',
      'The text index weights crystal.name/crystal.text highest, then titles and tags, then everything else.'
    ]
  }),
  endpoint({
    id: 'things-comment',
    group: 'things',
    title: 'Comment on post',
    endpoint: '/api/v1/things/comment',
    summary: 'Adds a comment — comments share the post schema — to a thing visible to the current user.',
    detail:
      'Simple comments are standalone things (thingtime ["comment"]) pointing at their target via targetId and inheriting its visibility — this route is sugar over the unified thing path. Comments share the post schema: sending post fields (type, images, listing, thing, tags) creates a RICH comment, a full ["post","comment"] thing validated by the post crystal rules, so comments can carry photos, marketplace listings, and thingtime things. Comments are reactable and commentable like any post, and every comment has its own /post/:id permalink. The id may be a post or another comment (replies). Visibility is re-checked before writing so private or circle-limited posts cannot be commented on by unauthorized viewers.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST id and text for a simple comment, or id plus post fields (type, images, listing, thing, tags) for a rich comment.',
      'The target thing (post or comment) must be visible to the current user.',
      'The response comment carries the post vocabulary (reactionCounts, viewerReactions, commentCount) — use it and commentCount to update the card.',
      'Handle 401 unauthenticated, 404 not visible, and 400 invalid payload.'
    ],
    requestExamples: [
      {
        name: 'Add comment',
        description: 'Comment on a visible post.',
        method: 'POST',
        body: { id: 'post_123', text: 'I am interested.' }
      },
      {
        name: 'Add rich comment',
        description: 'Comment with photos, like a full post.',
        method: 'POST',
        body: { id: 'post_123', type: 'image', text: 'Here it is!', images: ['https://example.com/photo.jpg'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Comment added (post-shaped: reactions, reply count, permalink id).',
        body: {
          ok: true,
          comment: {
            id: 'comment_123',
            thingtime: ['comment'],
            type: 'text',
            text: 'I am interested.',
            reactionCounts: {},
            viewerReactions: [],
            commentCount: 0,
            targetId: 'post_123'
          },
          commentCount: 1
        }
      }
    ]
  }),
  endpoint({
    id: 'things-delete',
    group: 'things',
    title: 'Delete feed post',
    endpoint: '/api/v1/things/delete',
    summary: 'Deletes one of the current user things (post, comment, reaction, or share).',
    detail:
      'Only the owning user may delete a thing. Deleting a thing also deletes the comment and reaction things attached to it; share things pointing at it survive and render an original-unavailable placeholder.',
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
      'The feed reads recent posts whose acl admits the viewer (tt:all for logged-out callers, plus your own things when authenticated — acl exclusions like -tt:user/<you> are honoured), applies filters, then optionally ranks them with the selected or active feed algorithm.',
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
      'emoji may be a single emoji or a multi-emoji group typed/pasted as one token (e.g. "🤣🤣🙌💀💦"). Toggling a token you already have removes it, a new one is added — you can hold several at once. Adding a token also records it in your recent reactions; posting null is a no-op. Reactions are standalone things (thingtime ["reaction"], crystal.emoji = the token) pointing at their target via targetId — this route is toggle sugar over the unified thing path. Reaction counts are returned for immediate card updates.',
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
    id: 'things-save',
    group: 'things',
    title: 'Save to library',
    endpoint: '/api/v1/things/save',
    summary: 'Toggles a private library save of a visible thing ("add to my library").',
    detail:
      'Saves are relational child things (thingtime ["save"], targetId = the saved thing, acl ' +
      '["tt:user"]) — always private to the saver, never inheriting the target audience, so a ' +
      'library is personal by construction. Toggling an existing save removes it. List saved ' +
      'schemas via /api/v1/schemas/browse?library=1, or raw saves via GET /api/v1/things?thingtime=save.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the id of the thing to save (or unsave).',
      'The thing must be visible to the current user.',
      'Use the returned saved boolean to flip the UI state optimistically.',
      'Handle 401 unauthenticated and 404 for missing or not-visible things.'
    ],
    requestExamples: [
      {
        name: 'Toggle save',
        description: 'Add or remove a thing from the caller library.',
        method: 'POST',
        body: { id: 'schema_table_001' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Save toggled.',
        body: { ok: true, saved: true }
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
      },
      {
        name: 'Share to your friends only',
        description: 'Shares take acls too.',
        method: 'POST',
        body: { id: 'post_123', text: 'Keeping this in the circle', acl: ['-tt:all', 'tt:userFriends', 'tt:user'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Share created — a thing carrying both the post and share schemas.',
        body: { ok: true, post: { id: 'share_123', thingtime: ['post', 'share'], isShare: true } }
      }
    ]
  }),
  endpoint({
    id: 'things-update',
    group: 'things',
    title: 'Update thing',
    endpoint: '/api/v1/things/update',
    summary: 'Updates one of the current user things — crystal payload, acl audience, or tags.',
    detail:
      'Sugar over PATCH /api/v1/things: crystal patches merge over the existing crystal and are re-validated against the thing schemas in its thingtime array; acl (or a legacy visibility name) retargets the audience. Updating a pre-unification post upgrades it to the v2 doc shape in place. Attached things (comments, reactions) keep their inherited audience.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the thing id plus any of crystal, extended, visibility, and tags.',
      'Crystal fields you omit keep their current values; included fields are validated by the thing schemas.',
      'extended replaces as a whole value when provided (null clears it) — it is never deep-merged.',
      'The current user must own the thing.',
      'Handle 401 unauthenticated, 404 missing or unowned things, and 400 invalid patches.'
    ],
    requestExamples: [
      {
        name: 'Edit post text',
        description: 'Patch the crystal text of an owned post.',
        method: 'POST',
        body: { id: 'post_123', crystal: { text: 'Today I learned (edited)...' } }
      },
      {
        name: 'Retarget the audience',
        description: 'Swap the acl to friends-only without touching the crystal.',
        method: 'POST',
        body: { id: 'post_123', acl: ['-tt:all', 'tt:userFriends', 'tt:user'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Thing updated.',
        body: {
          ok: true,
          thing: { id: 'post_123', thingtime: ['post'], crystal: { text: 'Today I learned (edited)...' } },
          post: { id: 'post_123', text: 'Today I learned (edited)...' }
        }
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
    id: 'users-search',
    group: 'profile',
    title: 'Search people',
    endpoint: '/api/v1/users/search',
    summary: 'Public people search — matches usernames and display names for the /search People rail.',
    detail:
      'Escaped-literal, case-insensitive matching on username and displayName only (never email — an ' +
      'address can’t be reversed to an account). Returns public profile projections: username, ' +
      'displayName, bio, avatar/banner URLs, createdAt. Users live in the users collection, not ' +
      'things, so /api/v1/things/search never sees them — this endpoint is how the search page ' +
      'surfaces people alongside things.',
    auth: {
      mode: 'optional',
      description: 'Works logged out; anonymous callers are rate-limited per hashed IP.'
    },
    methods: ['GET'],
    steps: [
      'GET ?q=<text>&limit= — empty q returns an empty list.',
      'Render results as profile links (/profile/<username>).',
      'Handle 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Find people',
        description: 'Match usernames and display names.',
        method: 'GET',
        query: { q: 'lopu', limit: 8 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Matching public profiles.',
        body: {
          ok: true,
          users: [{ id: '664f…', username: 'lopu', displayName: 'Lopu', bio: 'Making Thingtime 🦄', avatarUrl: null }]
        }
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
  }),
  endpoint({
    id: 'schemas',
    group: 'schemas',
    title: 'Thingtime Schemas',
    endpoint: '/api/v1/schemas',
    summary: 'Returns every Thingtime Schema — the root thing schema, crystal sub-schemas, and collection schemas.',
    detail:
      'The registry the API validates against, as data: field lists, versions, examples, and the schema version each collection currently writes. Browse the same registry visually at /docs/schemas; published community schemas live at /schemas.',
    auth: {
      mode: 'none',
      description: 'Public — schemas describe shapes, never data.'
    },
    methods: ['GET'],
    steps: [
      'GET with no parameters for every schema plus collectionVersions.',
      'GET ?id=post (or comment, reaction, share, thing, ...) for one schema.',
      'Crystal schemas are the ids a thing may carry in its thingtime array.',
      'Handle 404 for unknown schema ids.'
    ],
    requestExamples: [
      {
        name: 'List schemas',
        description: 'Read the full schema registry.',
        method: 'GET'
      },
      {
        name: 'Read one schema',
        description: 'Read the post crystal schema.',
        method: 'GET',
        query: { id: 'post' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Registry returned.',
        body: { ok: true, schemas: [{ id: 'thing', kind: 'root', version: 2 }], collectionVersions: { things: 2 } }
      }
    ]
  }),
  endpoint({
    id: 'schemas-browse',
    group: 'schemas',
    title: 'Browse published schemas',
    endpoint: '/api/v1/schemas/browse',
    summary: 'Paginated browsing of user-published schema things — newest, oldest, popular, or text-searched.',
    detail:
      'The UGC side of /schemas: schema things (thingtime ["schema"]) with cursor pagination. ' +
      'sort=popular ranks by reaction count over a bounded window; q rides the same hardened ' +
      'text search as /api/v1/things/search; library=1 returns only the caller saved schemas ' +
      '(save recency order); mine=1 returns only the caller own schemas. Every entry carries ' +
      'reactionCounts, viewerReactions, saved, and usageCount (public data things whose crystal ' +
      'schema field names it). Built-in registry schemas are not included — clients merge them ' +
      'from GET /api/v1/schemas.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers see public schemas; library=1 and mine=1 require auth.'
    },
    methods: ['GET'],
    steps: [
      'GET with sort=newest|oldest|popular, optional q, limit (max 50).',
      'Page with the returned nextCursor until it is null (cursors are opaque).',
      'Pass library=1 for the caller saved schemas, mine=1 for their own.',
      'Handle 401 for library/mine without auth and 429 when rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Popular schemas',
        description: 'First page of the most-reacted schemas.',
        method: 'GET',
        query: { sort: 'popular', limit: 20 }
      },
      {
        name: 'Search schemas',
        description: 'Relevance-ranked text search.',
        method: 'GET',
        query: { q: 'table', limit: 20 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Schema page returned.',
        body: {
          ok: true,
          schemas: [
            {
              id: 'schema_table_001',
              thingtime: ['schema'],
              crystal: { name: 'Table', description: 'Tables of all kinds.', fields: [{ name: 'legs', type: 'number', min: 0, max: 12 }] },
              reactionCounts: { '🔥': 3 },
              viewerReactions: [],
              saved: false,
              usageCount: 12
            }
          ],
          nextCursor: null,
          total: 1,
          totalCapped: false
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-migrations',
    group: 'admin',
    title: 'Migration status',
    endpoint: '/api/v1/admin/migrations',
    summary: 'Per-collection schema-version census, storage generations, and registered migrations with pending counts.',
    detail:
      'Every doc stores the root-level schemaVersion it was written at (docs without one count as version 1), and every ' +
      'collection lives in a versioned physical collection — logical `things` at version 2 is the physical collection ' +
      '`things_v2`. This endpoint reports how many docs sit at each version per collection, every physical collection ' +
      'generation on the server (current, stale, or ahead), any legacy collections adoption could not rename, and which ' +
      'registered migrations still have work to do.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403.'
    },
    methods: ['GET'],
    steps: [
      'GET as an allowlisted admin.',
      'Read collections for the per-version doc census.',
      'Read generations for every physical collection and its stale/current status.',
      'Read migrations for pending counts per registered migration.',
      'Handle 401 for anonymous or non-admin callers.'
    ],
    requestExamples: [
      {
        name: 'Read migration status',
        description: 'Census of schema versions across collections.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Status returned.',
        body: {
          ok: true,
          collections: [
            {
              collection: 'things',
              physical: 'things_v2',
              currentVersion: 2,
              total: 42,
              versions: { '1': 24, '2': 18 },
              pendingMigrations: ['things-v1-to-v2']
            }
          ],
          generations: [
            { collection: 'things', physical: 'things_v2', version: 2, docs: 42, current: true, stale: false },
            { collection: 'things', physical: 'things', version: null, docs: 42, current: false, stale: true }
          ],
          adoptionIssues: [],
          migrations: [
            { id: 'things-v1-to-v2', collection: 'things', fromVersion: 1, toVersion: 2, destructive: false, pending: 24 }
          ]
        }
      },
      {
        status: 401,
        description: 'Anonymous or non-admin caller.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'admin-migrations-run',
    group: 'admin',
    title: 'Run migration',
    endpoint: '/api/v1/admin/migrations/run',
    summary: 'Runs (or dry-runs) a registered schema-version migration.',
    detail:
      'Migrations are idempotent, so re-running after a partial failure only touches what is left. The things v1→v2 ' +
      'migration explodes embedded comments/reactions into standalone things, converts share posts to thingtime ' +
      '["post","share"], moves post payloads under crystal, and stamps schemaVersion; the other collections stamp the ' +
      'version they already conform to. merge-legacy-collections folds leftover unversioned collections into their ' +
      'versioned successors, and drop-stale-collection-generations removes superseded physical collections — that one ' +
      'is destructive and additionally requires confirm: true on the non-dry run.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403.'
    },
    methods: ['POST'],
    steps: [
      'POST the migration id from /api/v1/admin/migrations.',
      'Pass dryRun: true first to see matched counts without writing.',
      'Pass confirm: true when running a destructive migration for real.',
      'Read the report for matched, migrated, created, skipped, and notes.',
      'Handle 401 non-admin callers and 404 unknown migration ids.'
    ],
    requestExamples: [
      {
        name: 'Dry-run the things migration',
        description: 'Count what the unified-thing migration would touch.',
        method: 'POST',
        body: { migration: 'things-v1-to-v2', dryRun: true }
      },
      {
        name: 'Run the things migration',
        description: 'Migrate v1 posts to unified v2 things.',
        method: 'POST',
        body: { migration: 'things-v1-to-v2' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Migration report returned.',
        body: {
          ok: true,
          migration: 'things-v1-to-v2',
          report: { dryRun: false, matched: 24, migrated: 24, created: 28, skipped: 0, notes: [] }
        }
      },
      {
        status: 404,
        description: 'Unknown migration id.',
        body: { ok: false, error: 'Unknown migration' }
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
    `request = Net::HTTP::${method.charAt(0) + method.slice(1).toLowerCase()}.new(uri)`,
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
