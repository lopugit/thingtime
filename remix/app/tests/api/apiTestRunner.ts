export type ApiTestGroup =
  | 'admin'
  | 'algorithms'
  | 'apps'
  | 'attachments'
  | 'auth'
  | 'crypto'
  | 'docs'
  | 'email'
  | 'embed'
  | 'health'
  | 'lopu'
  | 'lopu-recordings'
  | 'mongodb'
  | 'notifications'
  | 'profile'
  | 'root'
  | 'schemas'
  | 'social'
  | 'template'
  | 'themes'
  | 'things'
  | 'vercel'
  | 'waitlist'
  | 'webpages';

export type ApiTestResultStatus = 'pass' | 'fail';

export type ApiTestContext = {
  origin: string;
  // Node runner (scripts/run-api-tests.mts) injects a cookie-jar fetch here;
  // the browser /tests page leaves it unset and uses the page's own fetch
  fetchImpl?: typeof globalThis.fetch;
  // sanitized /api/v1/email/config payload — lets email tests respect the SES
  // sandbox send rate (1 msg/sec) and target the configured test recipient
  email?: {
    provider: 'console' | 'ses' | string;
    region: string;
    configurationSetName: string | null;
    transactionalFrom: string;
    newsletterFrom: string;
    sesSandbox: boolean;
    sandboxSendDelayMs: number;
    testRecipient: string;
    testRecipientDomain: string;
  };
};

export type ApiTestExpectation = (args: {
  response: Response;
  jsonBody: any;
  textBody: string;
  durationMs: number;
}) => { pass: boolean; details: string };

export type ApiTestDefinition = {
  id: string;
  name: string;
  description: string;
  group: ApiTestGroup;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  mutates?: boolean;
  // sends real email — the runner sleeps before these when the SES sandbox is
  // active so the 1 msg/sec sandbox limit is respected
  emailSend?: boolean;
  // auth-guard tests that must reach the API with NO ambient session: the
  // suite runs sequentially through one cookie state (register → session →
  // later tests), so once registration succeeds every later request carries a
  // session unless it opts out. credentials:'omit' strips cookies in the
  // browser /tests page; the preset empty Cookie header stops the Node
  // runner's jar from injecting one (browsers ignore it — forbidden header).
  anonymous?: boolean;
  timeoutMs?: number;
  body?: unknown | ((context: ApiTestContext) => unknown);
  headers?: Record<string, string>;
  expect: ApiTestExpectation;
};

export type ApiTestResult = {
  id: string;
  status: ApiTestResultStatus;
  httpStatus: number | null;
  durationMs: number;
  details: string;
  preview: string;
};

export type ApiTestRunOptions = {
  bodyOverride?: unknown;
  hasBodyOverride?: boolean;
};

export const resolveApiTestBody = (test: ApiTestDefinition, context: ApiTestContext) => {
  return typeof test.body === 'function' ? test.body(context) : test.body;
};

// plain globals so the same runner works on the /tests page and under Node
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getEmailSendDelayMs = (test: ApiTestDefinition, context: ApiTestContext) => {
  if (!test.emailSend || !context.email?.sesSandbox) return 0;
  return Math.max(1000, Number(context.email.sandboxSendDelayMs) || 0);
};

export const formatRequestPayload = (value: unknown) => {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

export const expectStatus = (statuses: number[], details?: string): ApiTestExpectation => {
  return ({ response }) => {
    const pass = statuses.includes(response.status);
    return {
      pass,
      details: pass
        ? details || `HTTP ${response.status} matched expected status.`
        : `Expected HTTP ${statuses.join(' or ')}, received ${response.status}.`
    };
  };
};

export const expectJson = (
  statuses: number[],
  predicate: (body: any, response: Response) => boolean,
  passDetails: string
): ApiTestExpectation => {
  return ({ response, jsonBody }) => {
    if (!statuses.includes(response.status)) {
      return {
        pass: false,
        details: `Expected HTTP ${statuses.join(' or ')}, received ${response.status}.`
      };
    }

    const pass = predicate(jsonBody, response);
    return {
      pass,
      details: pass ? passDetails : `Response JSON did not match the expected shape.`
    };
  };
};

export const expectRedirectedTo = (pathFragment: string): ApiTestExpectation => {
  return ({ response, textBody }) => {
    const pass =
      response.redirected ||
      response.url.includes(pathFragment) ||
      textBody.includes(pathFragment) ||
      textBody.includes('<div id="root"');

    return {
      pass,
      details: pass
        ? `Request redirected or resolved through the app shell for ${pathFragment}.`
        : `Expected redirect/app-shell response for ${pathFragment}; final URL was ${response.url}.`
    };
  };
};

export const expectNdjson = (): ApiTestExpectation => {
  return ({ response, textBody }) => {
    const contentType = response.headers.get('Content-Type') || '';
    const pass =
      response.status === 200 &&
      contentType.includes('application/x-ndjson') &&
      textBody
        .trim()
        .split('\n')
        .some((line) => {
          try {
            const parsed = JSON.parse(line);
            return parsed?.type === 'delta' || parsed?.type === 'done' || parsed?.type === 'meta';
          } catch {
            return false;
          }
        });

    return {
      pass,
      details: pass ? 'NDJSON stream returned Lopu events.' : 'Expected a 200 NDJSON stream with Lopu events.'
    };
  };
};

export const previewBody = (value: unknown) => {
  const redactedValue = redactPreviewValue(value);
  const text = typeof redactedValue === 'string' ? redactedValue : JSON.stringify(redactedValue, null, 2);
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
};

const redactPreviewValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactPreviewValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        const lowerKey = key.toLowerCase();
        const isSensitive =
          lowerKey.includes('token') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('password') ||
          lowerKey === 'authorization';

        return [key, isSensitive ? '[redacted]' : redactPreviewValue(entryValue)];
      })
    );
  }

  return value;
};

export const runApiTest = async (
  test: ApiTestDefinition,
  context: ApiTestContext,
  options: ApiTestRunOptions = {}
): Promise<ApiTestResult> => {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutMs = test.timeoutMs ?? 12000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const delayMs = getEmailSendDelayMs(test, context);
    if (delayMs) await sleep(delayMs);

    const body = options.hasBodyOverride ? options.bodyOverride : resolveApiTestBody(test, context);
    // In the browser test.path stays relative (same-origin); the Node runner
    // provides origin + fetchImpl, so paths resolve against the target server
    const fetchImpl = context.fetchImpl ?? fetch;
    const url = context.origin ? new URL(test.path, context.origin).toString() : test.path;
    const response = await fetchImpl(url, {
      method: test.method,
      credentials: test.anonymous ? 'omit' : 'include',
      redirect: 'follow',
      headers: {
        Accept: 'application/json, application/x-ndjson, text/plain, text/html',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(test.anonymous ? { Cookie: '' } : {}),
        ...(test.headers ?? {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    const textBody = await response.text();
    let jsonBody: any = null;
    try {
      jsonBody = textBody ? JSON.parse(textBody) : null;
    } catch {
      jsonBody = null;
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const expectation = test.expect({ response, jsonBody, textBody, durationMs });

    return {
      id: test.id,
      status: expectation.pass ? 'pass' : 'fail',
      httpStatus: response.status,
      durationMs,
      details: expectation.details,
      preview: previewBody(jsonBody ?? textBody)
    };
  } catch (err) {
    return {
      id: test.id,
      status: 'fail',
      httpStatus: null,
      durationMs: Math.round(performance.now() - startedAt),
      details: err instanceof Error ? err.message : String(err),
      preview: ''
    };
  } finally {
    clearTimeout(timeout);
  }
};
