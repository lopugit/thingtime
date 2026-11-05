// Closed diagnostics for the disposable HTTP fixture; never retain URLs,
// headers, query values or body bytes from signed object requests.
import { appendFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
export function createFixtureHttpObserver(file, now = () => Date.now()) {
  if (!isAbsolute(file)) throw Error('Fixture request timing path must be absolute');
  let sequence = 0;
  return request => {
    if (request.method !== 'PUT') return;
    const path = new URL(request.url, 'http://fixture.invalid').pathname;
    const known = path === '/api/v1/attachments/local-object' || path === '/api/v1/attachments/local-object/';
    appendFileSync(file, JSON.stringify({ at: now(), sequence: ++sequence,
      operation: known ? 'attachment-object-put' : 'other-put' }) + '\n', { mode: 0o600 });
  };
}
