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

// Read + parse a JSON request body while enforcing a real byte cap (the
// Content-Length header can be absent or wrong). Returns {} on malformed
// JSON — routes do their own field validation — and throws a 413 json()
// Response when the body exceeds maxBytes (the API catch-all passes thrown
// Responses through).
export const readJsonBody = async (request: Request, maxBytes: number): Promise<any> => {
  const tooLarge = () => json({ ok: false, error: 'Request body too large' }, { status: 413 });

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw tooLarge();

  const reader = request.body?.getReader();
  if (!reader) return {};

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  }

  try {
    const merged = new Uint8Array(received);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    return {};
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
