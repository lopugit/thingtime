import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Binary } from 'mongodb';
import { COLLECTION_SCHEMA_VERSIONS, ERROR_LOG_ID_PREFIX, ERROR_LOG_THINGTIME } from '../../../schemas/registry';
import { captureAdminErrorDiagnostic, redactNotificationText, sanitizeStoredAdminDiagnosticDetail } from './adminDiagnostic';

export const ERROR_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export type ErrorLogContext = { source: string; provider?: string; status?: number; code?: string; providerType?: string; providerRequestId?: string; retryAfter?: string; attempt?: number };
type RequestContext = { route: string; method: string; requestId: string; pending: Promise<unknown>[]; captured: number };
const context = new AsyncLocalStorage<RequestContext>();
const seen = new WeakMap<object, string>();
let windowStart = 0;
let windowCount = 0;
let inFlight = 0;

// A closed error snapshot, never request bodies, headers, cookies, images or
// arbitrary SDK objects. Apply deployment-secret and URL scrubbing as well as
// the shared diagnostic redactor. No reversible private values are retained.
export const scrubErrorLogText = (input: string): string => {
  let text = input;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|CONNECTION_STRING)/i.test(key)) text = text.split(value).join('[redacted-secret]');
  }
  text = text.replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/(?:https?:\/\/|data:)[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/[A-Za-z0-9+/_=-]{80,}/g, '[redacted-opaque-value]');
  return redactNotificationText(text);
};
const token = (value: unknown, max = 128) => typeof value === 'string' && /^[a-zA-Z0-9_./: -]+$/.test(value) ? scrubErrorLogText(value).slice(0, max) : undefined;

export const buildErrorLogThing = (error: unknown, fields: ErrorLogContext, request?: Pick<RequestContext, 'route' | 'method' | 'requestId'>, now = new Date()) => {
  const diagnostic = captureAdminErrorDiagnostic(error);
  const detail = scrubErrorLogText(diagnostic.detail);
  let message = 'Unexpected error';
  try { message = JSON.parse(detail).message || message; } catch { /* bounded truncated snapshot */ }
  return {
    shareId: ERROR_LOG_ID_PREFIX + randomUUID(), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: [ERROR_LOG_THINGTIME], storageClass: 'control', ownerId: 'tt:system:error-logs', acl: [], targetId: null,
    crystal: {
      source: token(fields.source) || 'server', message: String(message).slice(0, 2048),
      ...(request ? { route: request.route, method: request.method, requestId: request.requestId } : {}),
      provider: token(fields.provider), code: token(fields.code), providerType: token(fields.providerType),
      providerRequestId: token(fields.providerRequestId), retryAfter: token(fields.retryAfter),
      status: Number.isInteger(fields.status) && fields.status! >= 100 && fields.status! <= 599 ? fields.status : undefined,
      attempt: Number.isInteger(fields.attempt) ? fields.attempt : undefined
    },
    secure: new Binary(Buffer.from(detail)), tags: [ERROR_LOG_THINGTIME],
    createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + ERROR_LOG_RETENTION_MS)
  };
};

const persist = async (doc: ReturnType<typeof buildErrorLogThing>) => {
  // Lazy import keeps safeErrorText usable throughout Mongo/bootstrap without a
  // circular dependency. Deadline includes connection acquisition; a late
  // connection never starts a write after the caller's deadline.
  const deadline = Date.now() + 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const { getHomeThingsCollection } = await import('../mongodb/collections');
        const col = await getHomeThingsCollection();
        if (Date.now() >= deadline) return false;
        await col.insertOne(doc, { timeoutMS: Math.max(1, deadline - Date.now()) });
        return true;
      })(),
      new Promise<boolean>(resolve => { timer = setTimeout(() => { console.warn('[error-log] persistence deadline exceeded'); resolve(false); }, 1000); })
    ]);
  } catch {
    // Never feed a logging failure back into the logger or expose raw DB errors.
    console.warn('[error-log] persistence unavailable');
    return false;
  } finally { clearTimeout(timer); }
};

export const recordErrorLog = (error: unknown, fields: ErrorLogContext): Promise<string | null> => {
  try {
    if (error && typeof error === 'object' && seen.has(error)) return Promise.resolve(seen.get(error)!);
    const request = context.getStore();
    const doc = buildErrorLogThing(error, fields, request);
    console.error('[error-log]', JSON.stringify({ id: doc.shareId, ...doc.crystal }));
    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; windowCount = 0; }
    // Bound both per-request and per-instance load during an outage. Console
    // metadata remains available when the durable capture budget is exhausted.
    if (windowCount >= 60 || inFlight >= 5 || (request && request.captured >= 5)) return Promise.resolve(null);
    windowCount++; inFlight++;
    if (request) request.captured++;
    if (error && typeof error === 'object') seen.set(error, doc.shareId);
    const task = persist(doc).then(saved => saved ? doc.shareId : null).finally(() => { inFlight--; });
    request?.pending.push(task);
    return task;
  } catch { return Promise.resolve(null); }
};

// Await queued handled failures before a serverless response can freeze the
// instance. Context contains only a registered route, verb and generated id.
export const withErrorLogRequest = async <T>(route: string, method: string, work: () => Promise<T>): Promise<T> => {
  const request: RequestContext = { route, method, requestId: randomUUID(), pending: [], captured: 0 };
  return context.run(request, async () => {
    try { return await work(); }
    finally { await Promise.allSettled(request.pending); }
  });
};

export const listErrorLogs = async (input: { q?: string; before?: string }) => {
  const { getHomeThingsCollection } = await import('../mongodb/collections');
  const col = await getHomeThingsCollection();
  const q = (input.q || '').trim().slice(0, 160);
  const match: Record<string, unknown> = { thingtime: ERROR_LOG_THINGTIME, storageClass: 'control', expiresAt: { $gt: new Date() } };
  if (input.before) {
    // shareId is a unique UUID; pagination uses it as a stable tie-breaker.
    const [time, id] = input.before.split('|');
    if (!Number.isFinite(Date.parse(time)) || !/^error-log-[a-f0-9-]{36}$/.test(id || '')) throw new TypeError('Invalid error log cursor');
    match.$or = [{ createdAt: { $lt: new Date(time) } }, { createdAt: new Date(time), shareId: { $lt: id } }];
  }
  if (q) {
    const expression = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match.$and = [{ $or: ['shareId', ...['message', 'source', 'route', 'requestId', 'provider', 'code', 'providerType', 'providerRequestId'].map(k => 'crystal.' + k)].map(key => ({ [key]: { $regex: expression, $options: 'i' } })) }];
  }
  const rows = await col.find(match, { projection: { shareId: 1, crystal: 1, secure: 1, createdAt: 1, expiresAt: 1 }, maxTimeMS: 2000 }).sort({ createdAt: -1, shareId: -1 }).limit(31).toArray();
  const page = rows.slice(0, 30);
  const items = page.map((row: any) => {
    const c = row.crystal || {};
    const raw = row.secure instanceof Binary ? row.secure.value() : Buffer.alloc(0);
    return { id: row.shareId, thingtime: [ERROR_LOG_THINGTIME], createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString(),
      source: token(c.source) || 'server', message: scrubErrorLogText(String(c.message || '')).slice(0, 2048),
      route: token(c.route), method: token(c.method), requestId: typeof c.requestId === 'string' && /^[a-f0-9-]{36}$/.test(c.requestId) ? c.requestId : undefined,
      provider: token(c.provider), code: token(c.code), providerType: token(c.providerType), providerRequestId: token(c.providerRequestId), retryAfter: token(c.retryAfter), status: typeof c.status === 'number' ? c.status : undefined, attempt: typeof c.attempt === 'number' ? c.attempt : undefined,
      detail: scrubErrorLogText(sanitizeStoredAdminDiagnosticDetail(Buffer.from(raw).toString('utf8')).detail)
    };
  });
  const last = page.at(-1);
  return { items, nextCursor: rows.length > 30 && last ? new Date(last.createdAt).toISOString() + '|' + last.shareId : null };
};
