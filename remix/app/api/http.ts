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
