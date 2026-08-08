export type ApiFailureOutcome = 'rejected' | 'unknown';

type ApiFailureOptions = {
  status?: number | null;
  action?: string;
  method?: string;
  retryAfter?: string | null;
  outcome?: ApiFailureOutcome;
  reason?: string;
  accounts?: unknown[];
};

type ApiFailureInput = ApiFailureOptions & {
  payload?: unknown;
  cause?: unknown;
};

export class ThingtimeApiError extends Error {
  readonly error: string;
  readonly status: number | null;
  readonly action: string;
  readonly retryAfterSeconds: number | null;
  readonly outcome: ApiFailureOutcome;
  // Compatibility fields intentionally allowlisted from structured API
  // failures. Login uses reason to retire dead OTP challenges, and the
  // account switcher uses accounts to accept a server-pruned roster.
  readonly reason: string | undefined;
  readonly accounts: unknown[] | undefined;

  constructor(message: string, options: ApiFailureOptions = {}) {
    super(message);
    this.name = 'ThingtimeApiError';
    this.error = message;
    this.status = Number.isFinite(options.status) ? Number(options.status) : null;
    this.action = cleanAction(options.action);
    this.retryAfterSeconds = parseRetryAfter(options.retryAfter);
    this.outcome = options.outcome ?? mutationOutcome(options.method, this.status);
    this.reason = options.reason;
    this.accounts = options.accounts;
  }
}

const cleanAction = (action?: string) => action?.trim().replace(/[.]+$/, '') || 'complete that request';

const payloadRecord = (payload: unknown): Record<string, unknown> | null =>
  payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;

const authoredError = (payload: unknown, status: number | null): string | null => {
  const record = payloadRecord(payload);
  // Nitro's production error shape is { error:true, unhandled:true }. Its dev
  // shape can also contain exception text/stack, which must never reach users.
  if (status !== null && status >= 500 && record?.unhandled === true) return null;
  const value = record?.error;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const parseRetryAfter = (value?: string | null): number | null => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
};

const mutationOutcome = (method: string | undefined, status: number | null): ApiFailureOutcome => {
  const verb = (method || 'GET').toUpperCase();
  const mutates = verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS';
  return mutates && (status === null || status >= 500) ? 'unknown' : 'rejected';
};

const payloadOutcome = (payload: Record<string, unknown> | null): ApiFailureOutcome | undefined => {
  const value = payload?.outcome;
  return value === 'rejected' || value === 'unknown' ? value : undefined;
};

const fallbackMessage = (status: number | null, action: string, retryAfterSeconds: number | null) => {
  if (status === 401) return `Your session expired. Log in again to ${action}.`;
  if (status === 403) return `You don’t have permission to ${action}.`;
  if (status === 404) return `That Thing is no longer available, so Thingtime couldn’t ${action}.`;
  if (status === 409) return `That Thing changed somewhere else. Refresh before trying to ${action} again.`;
  if (status === 413) return `That request was too large for Thingtime to ${action}.`;
  if (status === 429) {
    const retry = retryAfterSeconds === null ? 'Please wait a moment and try again.' : `Try again in ${retryAfterSeconds} seconds.`;
    return `Thingtime is receiving too many requests to ${action}. ${retry}`;
  }
  if (status !== null && status >= 500) {
    return `Thingtime hit a server error while trying to ${action} (${status}).`;
  }
  if (status !== null && status >= 200 && status < 300) {
    return `Thingtime returned an unreadable response after trying to ${action}.`;
  }
  if (status === null) {
    return `Thingtime couldn’t reach the server while trying to ${action}. Check your connection and try again.`;
  }
  return `Thingtime couldn’t ${action} (error ${status}). Please try again.`;
};

export const createApiFailure = (input: ApiFailureInput): ThingtimeApiError => {
  if (input.cause instanceof ThingtimeApiError) return input.cause;

  const status = Number.isFinite(input.status) ? Number(input.status) : null;
  const action = cleanAction(input.action);
  const retryAfterSeconds = parseRetryAfter(input.retryAfter);
  const authored = authoredError(input.payload, status);
  const record = payloadRecord(input.payload);
  const genericUnauthorized = status === 401 && authored?.toLowerCase() === 'unauthorized';
  const message = authored && !genericUnauthorized ? authored : fallbackMessage(status, action, retryAfterSeconds);

  return new ThingtimeApiError(message, {
    status,
    action,
    method: input.method,
    retryAfter: input.retryAfter,
    outcome: input.outcome ?? payloadOutcome(record),
    reason: typeof record?.reason === 'string' ? record.reason : undefined,
    accounts: Array.isArray(record?.accounts) ? record.accounts : undefined
  });
};

const mutates = (method: string | undefined): boolean => {
  const verb = (method || 'GET').toUpperCase();
  return verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS';
};

export const readApiResponsePayload = async (
  response: Response,
  options: { action?: string; method?: string } = {}
): Promise<any> => {
  if (response.status === 204) return null;
  const contentType = response.headers.get('Content-Type') || '';
  try {
    return contentType.includes('application/json') ? await response.json() : await response.text();
  } catch (cause) {
    // A mutation can commit before its response body is truncated or becomes
    // unreadable. Treat a malformed 2xx body as commit-unknown so callers
    // reconcile server truth instead of blindly applying an inverse write.
    throw createApiFailure({
      cause,
      status: response.status,
      action: options.action,
      method: options.method,
      outcome: response.ok && mutates(options.method) ? 'unknown' : undefined
    });
  }
};

export const apiErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ThingtimeApiError) return error.error;
  const record = payloadRecord(error);
  const value = record?.error;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

export const hasUnknownMutationOutcome = (error: unknown): boolean =>
  error instanceof ThingtimeApiError && error.outcome === 'unknown';
