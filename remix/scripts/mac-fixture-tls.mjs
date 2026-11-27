// Ephemeral TLS for disposable fixtures only. No OS trust or global TLS change.
import { mkdir, chmod, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import { Readable } from 'node:stream';
export async function createFixtureTLS(directory) {
  const root = join(directory, 'tls'); await mkdir(root, { mode: 0o700 });
  try {
  const caFile = join(root, 'ca.pem'), caKey = join(root, 'ca.key'), keyFile = join(root, 'server.key'), certFile = join(root, 'server.pem');
  const request = join(root, 'server.csr'), extensions = join(root, 'server.ext');
  await writeFile(extensions, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { mode: 0o600 });
  const run = args => { if (spawnSync('openssl', args, { stdio: 'ignore', env: { PATH: process.env.PATH } }).status !== 0) throw Error('Ephemeral fixture TLS generation failed'); };
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Thingtime disposable fixture CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', caKey, '-out', caFile]);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', keyFile, '-out', request]);
  run(['x509', '-req', '-in', request, '-CA', caFile, '-CAkey', caKey, '-CAcreateserial', '-days', '1', '-extfile', extensions, '-out', certFile]);
  for (const file of [caFile, caKey, keyFile, certFile, request]) await chmod(file, 0o600);
  return { root, caFile, keyFile, certFile };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
/** Setup-only signed byte requests trust this one CA and one origin. The native
 * benchmark still uses the unchanged canonical child network implementation. */
export function createFixtureTLSFetch(origin, caFile, fallback = globalThis.fetch) {
  const ca = readFileSync(caFile);
  return async (target, init = {}) => {
    const url = new URL(String(target));
    if (url.origin !== origin) return fallback(target, init);
    return new Promise((resolve, reject) => {
      const request = https.request(url, { method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
        ca, rejectUnauthorized: true, signal: init.signal ?? undefined }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); reject(Error('Fixture TLS redirects are refused')); return; }
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : Readable.toWeb(response), { status: response.statusCode, headers }));
      });
      request.once('error', reject);
      const body = init.body;
      if (body == null) request.end();
      else if (body instanceof ReadableStream) Readable.fromWeb(body).once('error', error => request.destroy(error)).pipe(request);
      else if (typeof body === 'string' || body instanceof Uint8Array) request.end(body);
      else { request.destroy(); reject(Error('Unsupported fixture TLS body')); }
    });
  };
}
