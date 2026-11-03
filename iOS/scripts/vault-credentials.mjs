import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const keys = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_CONTENT', 'DEVELOPMENT_TEAM', 'PRODUCT_BUNDLE_IDENTIFIER', 'WATCH_BUNDLE_IDENTIFIER', 'IOS_DISTRIBUTION_CERTIFICATE_ID', 'IOS_DISTRIBUTION_CERT_P12', 'IOS_DISTRIBUTION_CERT_P12_PASSWORD'];
const audience = 'thingtime:ios-testflight';
const escapeCommand = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const mask = (value) => process.stdout.write(`::add-mask::${escapeCommand(value)}\n`);
async function json(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  // Never include a server response body or fetch exception in logs: it may contain credentials.
  if (!response.ok) throw new Error(`Release request failed (${response.status}).`);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Expected a JSON release response.');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512 * 1024) { await reader.cancel(); throw new Error('Release response exceeded its limit.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function request(origin, body) {
  const identityURL = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (identityURL.protocol !== 'https:') throw new Error('GitHub identity transport must use HTTPS.');
  identityURL.searchParams.set('audience', audience);
  const identity = await json(identityURL, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (typeof identity.value !== 'string') throw new Error('GitHub did not return an identity.');
  mask(identity.value);
  return json(`${origin}/api/v1/integrations/ios-release`, { method: 'POST', headers: { Authorization: `Bearer ${identity.value}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
try {
  const origin = new URL(process.env.THINGTIME_RELEASE_ORIGIN || 'https://thingtime.com');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid release origin.');
  const manifest = await json(`${origin.origin}/.well-known/thingtime-capabilities.json`);
  const feature = manifest.features?.['api.integration-ios-release'];
  const version = typeof feature === 'string' ? feature : feature?.version;
  if (manifest.origin !== origin.origin || !/^1\.\d+\.\d+$/.test(version ?? '')) throw new Error('This origin does not support iOS release vault delivery 1.x. Deploy the API first.');
  if (process.env.RELEASE_OPERATION === 'migrate-secrets') {
    const credentials = Object.fromEntries(keys.map((key) => [key, process.env[key] || '']));
    const result = await request(origin.origin, { operation: 'migrate', credentials });
    if (result.ok !== true) throw new Error('Apple credential migration failed.');
    console.log(result.imported ? 'Apple release bundle imported into the admin vault.' : 'Existing Apple release bundle preserved.');
  }
  // Fresh OIDC token after migration; no replay of an already consumed token.
  const result = await request(origin.origin, { operation: 'fetch' });
  if (result.ok !== true || !result.credentials || Object.keys(result.credentials).length !== keys.length) throw new Error('Invalid release bundle.');
  for (const key of keys) {
    const value = result.credentials[key];
    if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value) || value.length > 30 * 1024) throw new Error('Invalid release value.');
    mask(value);
  }
  // Mask decoded key/certificate lines too, before a downstream tool can print them.
  for (const line of Buffer.from(result.credentials.ASC_KEY_CONTENT, 'base64').toString('utf8').split(/\r?\n/).filter(Boolean)) mask(line);
  if (process.env.RELEASE_OPERATION !== 'migrate-secrets') {
    for (const key of keys) {
      const delimiter = `VAULT_${randomUUID()}`;
      appendFileSync(process.env.GITHUB_ENV, `${key}<<${delimiter}\n${result.credentials[key]}\n${delimiter}\n`, { mode: 0o600 });
    }
  }
  console.log('Verified purpose-scoped vault delivery. No credential values recorded.');
} catch {
  console.error('TestFlight vault delivery failed. Check the production capability, release policy and Apple bundle; no fallback was used.');
  process.exitCode = 1;
}
