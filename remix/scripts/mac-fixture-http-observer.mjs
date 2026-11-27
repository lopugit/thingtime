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
    const id = ++sequence;
    const record = fields => appendFileSync(file, JSON.stringify({ at: now(), sequence: id, ...fields }) + '\n', { mode: 0o600 });
    record({ operation: known ? 'attachment-object-put' : 'other-put' });
    if (!known || typeof request.push !== 'function' || typeof request.once !== 'function') return;
    // Observe parsed body chunks at enqueue, without attaching a data listener:
    // flowing-mode observation could discard bytes before the API reads them.
    const push = request.push;
    let bytes = 0, firstByteAt = null;
    request.push = function(chunk, ...args) {
      if (chunk && chunk.length) {
        bytes += chunk.length;
        if (firstByteAt === null) {
          firstByteAt = now();
          record({ operation: 'attachment-object-put-first-byte', firstByteAt });
        }
      }
      return push.call(this, chunk, ...args);
    };
    request.once('end', () => record({ operation: 'attachment-object-put-body', firstByteAt, payloadBytes: bytes }));
  };
}
