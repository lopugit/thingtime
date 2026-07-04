export type ApiTestGroup =
  | 'auth'
  | 'crypto'
  | 'health'
  | 'lopu'
  | 'mongodb'
  | 'root'
  | 'template'
  | 'vercel';

export type ApiTestResultStatus = 'pass' | 'fail';

export type ApiTestContext = {
  origin: string;
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
  method: 'GET' | 'POST';
  path: string;
  mutates?: boolean;
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
  context: ApiTestContext
): Promise<ApiTestResult> => {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutMs = test.timeoutMs ?? 12000;
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = typeof test.body === 'function' ? test.body(context) : test.body;
    const response = await fetch(test.path, {
      method: test.method,
      credentials: 'include',
      redirect: 'follow',
      headers: {
        Accept: 'application/json, application/x-ndjson, text/plain, text/html',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
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
    window.clearTimeout(timeout);
  }
};
