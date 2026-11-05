type JsonInit = ResponseInit & {
  headers?: HeadersInit;
};

export const json = (data: unknown, init: JsonInit = {}) => {
  const headers = new Headers(init.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
};

/** Shared user content has no application byte ceiling. Fixed control messages
 * retain their caller's numeric budget. Storage/provider admission is separate. */
export const JSON_BODY_WITHOUT_APPLICATION_LIMIT = 'without-application-limit' as const;
export type JsonBodyBudget = number | typeof JSON_BODY_WITHOUT_APPLICATION_LIMIT;

// Read incrementally (one outstanding pull), then parse once. JSON requires a
// complete value in memory; this does not override runtime or storage limits.
export const readJsonBody = async (request: Request, budget: JsonBodyBudget): Promise<any> => {
  const maxBytes = typeof budget === 'number' ? budget : Infinity;
  const tooLarge = () => json({ ok: false, error: 'Request body too large' }, { status: 413 });
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let received = 0;
  const aborted = () => { void reader.cancel(request.signal.reason).catch(() => {}); };
  request.signal.addEventListener('abort', aborted, { once: true });
  try {
    if (request.signal.aborted) aborted();
    request.signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      request.signal.throwIfAborted();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          throw tooLarge();
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
    const source = chunks.join('');
    try { return JSON.parse(source); }
    catch (error) { if (error instanceof SyntaxError) return {}; throw error; }
  } finally {
    request.signal.removeEventListener('abort', aborted);
    reader.releaseLock();
  }
};

// Cookie-authenticated mutations only accept JSON bodies: a cross-origin form
// (or a fetch with a safelisted content type) cannot send application/json
// without a preflight, so the header doubles as the CSRF fence. Every Lopu
// POST applies it before reading the body — the reply and voice streams and
// the vault included, since a session cookie is all they need otherwise.
export const requireJsonContentType = (request: Request): Response | null => {
  const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json' ? null : json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
};

export const redirect = (url: string, init: number | ResponseInit = 302) => {
  const responseInit: ResponseInit = typeof init === 'number' ? { status: init } : init;
  const headers = new Headers(responseInit.headers);

  headers.set('Location', url);

  return new Response(null, {
    ...responseInit,
    status: responseInit.status || 302,
    headers
  });
};
