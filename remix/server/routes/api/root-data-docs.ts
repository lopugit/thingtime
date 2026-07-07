import { defineHandler } from 'nitro/h3';

import { createApiDocPayload, getApiDocByPath } from '../../../app/docs/apiDocs';

const jsonResponse = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(value), {
    ...init,
    headers
  });
};

export default defineHandler((event) => {
  const method = event.req.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, POST' }
    });
  }

  const doc = getApiDocByPath('/api/root-data');

  if (!doc) {
    return jsonResponse({ ok: false, error: 'API docs not found' }, { status: 404 });
  }

  return jsonResponse(createApiDocPayload(doc, new URL(event.req.url).origin));
});
