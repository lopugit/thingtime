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
    summary: 'Revokes the current session and clears the auth cookie.',
    detail:
      'Use this endpoint to end browser sessions or revoke a bearer token session server-side. The route is idempotent and returns ok even without a token.',
    auth: {
      mode: 'optional',
      description: 'Uses the auth cookie or Authorization: Bearer token when one exists.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object or no body.',
      'If a token is present, Thingtime verifies it and revokes the session jti in MongoDB.',
      'Store the returned Set-Cookie header in browsers so the httpOnly cookie is cleared.',
      'Treat repeated logout calls as success.'
    ],
    requestExamples: [
      {
        name: 'Logout current session',
        description: 'Clear the browser session or revoke the bearer token session.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Logout completed.',
        body: { ok: true }
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
    summary: 'Admin-only provisioning for a service-owned account with an expiring bearer token and 5 GiB storage allowance.',
    detail:
      'Use this endpoint to connect trusted backend services to Thingtime data. Provisioning is restricted to authenticated admins because the route mints bearer credentials.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Requires an authenticated admin user allowlisted by THINGTIME_ADMIN_USER_IDS (preferred, non-claimable), THINGTIME_ADMIN_EMAILS, or THINGTIME_ADMIN_USERNAMES (email/username matches require a verified account).'
    },
    methods: ['POST'],
    steps: [
      'Authenticate as an allowlisted admin with a browser session or Bearer token.',
      'POST a serviceName and valid email. username, displayName, and meta are optional.',
      'Store accessToken securely server-side; it has an exp claim and remains revocable through its Mongo session.',
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
          expiresAt: '2026-08-14T00:00:00.000Z',
          verificationRequiredBy: '2026-07-15T00:00:00.000Z',
          storageAllowanceBytes: 5368709120,
          user: {
            accountKind: 'service',
            emailVerified: false
          }
        }
      },
      {
        status: 401,
        description: 'No authenticated admin session or bearer token was provided.',
        body: { ok: false, error: 'Unauthorized' }
      },
      {
        status: 403,
        description: 'The authenticated user is not in the admin allowlist.',
        body: { ok: false, error: 'Admin access required' }
      },
      {
        status: 400,
        description: 'A valid email is required.',
        body: { ok: false, error: 'A valid email is required' }
      }
    ],
    notes: [
      'The bearer token expires after THINGTIME_SERVICE_TOKEN_TTL_DAYS, defaulting to 30 days and capped at 90 days.',
      'Configure admins with THINGTIME_ADMIN_USER_IDS (preferred — the Mongo _id is non-claimable), THINGTIME_ADMIN_EMAILS, or THINGTIME_ADMIN_USERNAMES. Email/username allowlist matches are honoured only for a verified account.'
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
      'Handle 401 for invalid credentials/codes, 429 for exhausted OTP attempts, and 500 for unavailable backing services.'
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
    summary: 'Admin-only route that runs the MongoDB setup/populate script.',
    detail:
      'This is a mutating development utility. It is admin-gated because it initializes or updates Thingtime MongoDB state and can perform expensive seed work.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Requires an authenticated admin user allowlisted by THINGTIME_ADMIN_USER_IDS (preferred, non-claimable), THINGTIME_ADMIN_EMAILS, or THINGTIME_ADMIN_USERNAMES (email/username matches require a verified account).'
    },
    methods: ['POST'],
    steps: [
      'Authenticate as an allowlisted admin with a browser session or Bearer token.',
      'POST an empty JSON object from a trusted development environment.',
      'The route runs the shared MongoDB setup script.',
      'Read result for setup output.',
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
        body: { ok: true, result: { ok: true, created: 0, skipped: 10 } }
      },
      {
        status: 401,
        description: 'No authenticated admin session or bearer token was provided.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ],
    notes: ['This route mutates database state. Keep it admin-only even in preview and development deployments.']
  }),
  endpoint({
    id: 'mongodb-raw-results',
    group: 'mongodb',
    title: 'MongoDB raw results',
    endpoint: '/api/v1/mongodb/raw-results',
    summary: 'Admin-only diagnostic route that returns a filtered page of public post documents.',
    detail:
      'Use this route for low-level diagnostics when validating the database connection and stored Thingtime data. It is restricted to admins and excludes kind: record documents.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Requires an authenticated admin user allowlisted by THINGTIME_ADMIN_USER_IDS (preferred, non-claimable), THINGTIME_ADMIN_EMAILS, or THINGTIME_ADMIN_USERNAMES (email/username matches require a verified account).'
    },
    methods: ['POST'],
    steps: [
      'Authenticate as an allowlisted admin with a browser session or Bearer token.',
      'POST an empty JSON object from a trusted development environment.',
      'The route reads only public kind: post documents and strips Mongo _id.',
      'Inspect rawResults for the filtered diagnostic page.'
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
        description: 'Filtered public post diagnostics.',
        body: { ok: true, rawResults: [], filter: { kind: 'post', visibility: 'public' } }
      },
      {
        status: 401,
        description: 'No authenticated admin session or bearer token was provided.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ],
    notes: ['This route must never return kind: record documents. Prefer higher-level API routes for app integrations.']
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
    summary: 'Sets, replaces, or clears the current user reaction on a visible post.',
    detail:
      'Posting the same emoji again, or null, clears the viewer reaction. Reaction counts are returned for immediate card updates.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST id and emoji, or emoji null to clear.',
      'The post must be visible to the current user.',
      'Use reactionCounts and viewerReaction to update UI state.',
      'Handle 401 unauthenticated and 404 for missing or not-visible posts.'
    ],
    requestExamples: [
      {
        name: 'Set reaction',
        description: 'React to a post.',
        method: 'POST',
        body: { id: 'post_123', emoji: 'like' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Reaction updated.',
        body: { ok: true, reactionCounts: { like: 1 }, viewerReaction: 'like' }
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
  }),
  endpoint({
    id: 'auth-password-reset',
    group: 'auth',
    title: 'Password reset request',
    endpoint: '/api/v1/auth/password-reset',
    summary: 'Emails a single-use password reset link to a registered address.',
    detail:
      'Use this to start a password reset. The route always returns ok so account existence cannot be probed; when the email matches an account, a one-hour single-use reset link is delivered through the Thingtime email service.',
    auth: {
      mode: 'none',
      description: 'Public request endpoint — identity is proven later by the emailed token.'
    },
    methods: ['POST'],
    steps: [
      'POST the account email address.',
      'Treat the ok response as neutral — it does not confirm the account exists.',
      'The user opens the emailed link, which carries a single-use token valid for one hour.',
      'Finish with /api/v1/auth/password-reset/confirm using that token and the new password.'
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
    id: 'crud-types',
    group: 'crud',
    title: 'Data types',
    endpoint: '/api/v1/crud/types',
    summary: 'Lists visible user-defined data types, or creates/updates one.',
    detail:
      'Types are user-defined schemas (thingtime.thingTypes) for generic CRUD records. GET lists the caller-owned types plus public ones; POST creates a type, or updates a caller-owned type when id is provided. Field policies control kind, required, encryption, and searchability per field.',
    auth: {
      mode: 'optional',
      description: 'GET works anonymously (public types only). POST requires a session or bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET to list types you can use; anonymous callers see public types only.',
      'POST { key, name, fields } to create — field keys are lowercase slugs, kinds are text/number/boolean/date/json/url/fileRef.',
      'Mark a field encrypted: true to store it as an AES-256-GCM envelope; searchable: "exact" or "term" indexes it (blind-index tokens when encrypted).',
      'Pass id to update your own type; the key is immutable and field encryption cannot change while records exist.'
    ],
    requestExamples: [
      {
        name: 'Create a contact type',
        description: 'Define a schema with a searchable name and an encrypted note.',
        method: 'POST',
        body: {
          key: 'contact',
          name: 'Contact',
          visibility: 'private',
          fields: [
            { key: 'name', label: 'Name', kind: 'text', required: true, searchable: 'term' },
            { key: 'note', label: 'Private note', kind: 'text', encrypted: true, searchable: 'exact' }
          ]
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Type created.',
        body: {
          ok: true,
          type: { id: 'type-share-id', key: 'contact', name: 'Contact', visibility: 'private', version: 1 }
        }
      },
      {
        status: 401,
        description: 'POST without a session or bearer token.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'crud-types-delete',
    group: 'crud',
    title: 'Delete data type',
    endpoint: '/api/v1/crud/types/delete',
    summary: 'Deletes a caller-owned type, or archives it while records exist.',
    detail:
      'Types with live records refuse deletion (409) so data never orphans silently — pass archive: true to hide the type from lists and stop new records instead.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires the httpOnly session cookie or an Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the type id (its shareId).',
      'If records still exist you get a 409 — retry with archive: true to archive instead.',
      'Archived types stay readable for existing records but reject new ones.'
    ],
    requestExamples: [
      {
        name: 'Archive a type',
        description: 'Keep existing records readable but stop new writes.',
        method: 'POST',
        body: { id: 'type-share-id', archive: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Type deleted or archived.',
        body: { ok: true, archived: true }
      },
      {
        status: 409,
        description: 'Live records exist and archive was not requested.',
        body: { ok: false, error: 'This type still has 3 record(s) — pass archive: true instead' }
      }
    ]
  }),
  endpoint({
    id: 'crud-records',
    group: 'crud',
    title: 'Records',
    endpoint: '/api/v1/crud/records',
    summary: 'Reads or lists permitted records, or creates a new one.',
    detail:
      'Records are kind:"record" documents in thingtime.things, validated against their type schema. Reads/lists filter by the record ACL inside the database query; unauthorized ids return 404 so record existence never leaks. Encrypted field values decrypt only on a permitted direct read.',
    auth: {
      mode: 'optional',
      description: 'GET works anonymously for records granting the public subject. POST requires a session or bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET ?id=<recordId> for one record, or ?typeId=<typeId>&cursor=&limit= to page a type.',
      'POST { typeId, values } to create; values are validated against the type field policies.',
      'Optionally pass acl grants ({ readKeys: ["public"] } etc.) — subjects are public, user:<id>, or service:<id>.',
      'List responses return summaries: plain values only, encrypted fields listed by key but never their values.'
    ],
    requestExamples: [
      {
        name: 'Create a record',
        description: 'Store a validated record of an existing type.',
        method: 'POST',
        body: {
          typeId: 'type-share-id',
          values: { name: 'Grace Hopper', note: 'met at the conference' }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Record created (encrypted fields round-trip decrypted for the owner).',
        body: {
          ok: true,
          record: {
            id: 'record-share-id',
            typeId: 'type-share-id',
            version: 1,
            values: { name: 'Grace Hopper', note: 'met at the conference' },
            encryptedFields: ['note'],
            permissions: { canRead: true, canSearch: true, canWrite: true, canAdmin: true }
          }
        }
      },
      {
        status: 404,
        description: 'Unknown or unauthorized record id.',
        body: { ok: false, error: 'Record not found' }
      }
    ]
  }),
  endpoint({
    id: 'crud-records-update',
    group: 'crud',
    title: 'Update record',
    endpoint: '/api/v1/crud/records/update',
    summary: 'Updates values on a writable record with optional optimistic locking.',
    detail:
      'Submitted fields merge into the record after validating against the type schema; untouched fields keep their stored (and encrypted) values. Pass expectedVersion to fail with 409 instead of overwriting a concurrent write.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires write permission on the record via its ACL.'
    },
    methods: ['POST'],
    steps: [
      'POST { id, values } with just the fields to change.',
      'Include expectedVersion (the version you last read) for optimistic concurrency.',
      'Readable-but-not-writable callers get 403; everyone else gets 404.'
    ],
    requestExamples: [
      {
        name: 'Update one field',
        description: 'Change a single value with a version guard.',
        method: 'POST',
        body: { id: 'record-share-id', values: { note: 'updated note' }, expectedVersion: 1 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Record updated; version incremented.',
        body: { ok: true, record: { id: 'record-share-id', version: 2 } }
      },
      {
        status: 409,
        description: 'expectedVersion no longer matches.',
        body: { ok: false, error: 'Record changed since version 1 — reload and retry' }
      }
    ]
  }),
  endpoint({
    id: 'crud-records-delete',
    group: 'crud',
    title: 'Delete record',
    endpoint: '/api/v1/crud/records/delete',
    summary: 'Soft-deletes a record (admin or owner only).',
    detail:
      'Deletion sets deletedAt, hiding the record from reads, lists, and search immediately. Hard deletion is deferred to a future retention policy.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires admin permission on the record (owners are implicit admins).'
    },
    methods: ['POST'],
    steps: [
      'POST the record id.',
      'Only record admins (or the owner) can delete; readable non-admins get 403.',
      'Deleted records return 404 on subsequent reads.'
    ],
    requestExamples: [
      {
        name: 'Delete a record',
        description: 'Soft-delete by share id.',
        method: 'POST',
        body: { id: 'record-share-id' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Record soft-deleted.',
        body: { ok: true }
      },
      {
        status: 404,
        description: 'Unknown or unauthorized record id.',
        body: { ok: false, error: 'Record not found' }
      }
    ]
  }),
  endpoint({
    id: 'crud-records-permissions',
    group: 'crud',
    title: 'Record permissions',
    endpoint: '/api/v1/crud/records/permissions',
    summary: 'Replaces a record’s ACL grants (admin or owner only).',
    detail:
      'Grants are per-operation subject lists: readKeys, writeKeys, adminKeys, searchKeys. Subjects are public, user:<id>, or service:<id>. Owner authority can never be removed, public write/admin grants are rejected, and searchKeys defaults to readKeys because search reveals existence.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires admin permission on the record.'
    },
    methods: ['POST'],
    steps: [
      'POST { id } plus the grant lists to set — omitted searchKeys copies readKeys.',
      'Use explicit subjects: "public", "user:<userId>", or "service:<serviceUserId>".',
      'Admins receive the full ACL arrays back; everyone else only ever sees capability booleans.'
    ],
    requestExamples: [
      {
        name: 'Share a record',
        description: 'Grant public read/search while keeping writes private.',
        method: 'POST',
        body: { id: 'record-share-id', readKeys: ['public'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'ACL replaced.',
        body: {
          ok: true,
          permissions: { canRead: true, canSearch: true, canWrite: true, canAdmin: true },
          acl: { readKeys: ['user:64f000000000000000000002', 'public'], writeKeys: ['user:64f000000000000000000002'] }
        }
      },
      {
        status: 400,
        description: 'Illegal grant (public write/admin, malformed subject, class-wide grant).',
        body: { ok: false, error: 'public write grants are not allowed' }
      }
    ]
  }),
  endpoint({
    id: 'crud-search',
    group: 'crud',
    title: 'Record search',
    endpoint: '/api/v1/crud/search',
    summary: 'Searches permitted records of a type by its searchable fields.',
    detail:
      'Search is permission-first: the ACL filter is part of the database query, so records outside acl.searchKeys can never match. Plain searchable fields match normalized tokens; encrypted fields match through HMAC blind-index tokens (exact or whole-word term matches only — no prefix/fuzzy search on encrypted data).',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers only match records granting the public subject.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET ?q=<query>&typeId=<typeId> (or POST the same fields as JSON).',
      'Restrict matching with fields=<comma-separated field keys> when needed.',
      'Every query term must match a term-searchable field, or the whole query must equal an exact-searchable value.',
      'Page with cursor/limit; results are summaries that never include encrypted values.'
    ],
    requestExamples: [
      {
        name: 'Search records',
        description: 'Find records of a type matching a text query.',
        method: 'GET',
        query: { q: 'grace', typeId: 'type-share-id', limit: 20 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Matching permitted records.',
        body: {
          ok: true,
          records: [
            {
              id: 'record-share-id',
              typeId: 'type-share-id',
              version: 2,
              values: { name: 'Grace Hopper' },
              encryptedFields: ['note'],
              snippet: 'Grace Hopper'
            }
          ],
          nextCursor: null
        }
      },
      {
        status: 400,
        description: 'Missing query or no searchable fields requested.',
        body: { ok: false, error: 'A search query (q) is required' }
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
