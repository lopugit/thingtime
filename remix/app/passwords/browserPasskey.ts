import { parse as parseDomain } from 'tldts';
import type { PasswordEntry } from './model';

type Descriptor = { type: 'public-key'; id: string; transports?: string[] };
type PublicKeyOptions = {
  challenge: string; rpId?: string; rp?: { id?: string; name: string };
  user?: { id: string; name: string; displayName: string };
  pubKeyCredParams?: { type: string; alg: number }[];
  allowCredentials?: Descriptor[]; excludeCredentials?: Descriptor[];
  userVerification?: string; authenticatorSelection?: { authenticatorAttachment?: string; residentKey?: string; requireResidentKey?: boolean; userVerification?: string };
  attestation?: string; extensions?: Record<string, unknown>; timeout?: number;
};
/** origin must come from the browser's authenticated tab/frame sender, never page input. */
export type BrowserPasskeyRequest = { type: 'create' | 'get'; origin: string; crossOrigin?: false; publicKey: PublicKeyOptions };
export type BrowserPasskeyCredential = {
  id: string; rawId: string; type: 'public-key'; authenticatorAttachment: 'platform'; clientExtensionResults: { credProps?: { rk: true } };
  response: { clientDataJSON: string; attestationObject?: string; authenticatorData?: string; signature?: string; userHandle?: string; transports?: string[]; publicKey?: string; publicKeyAlgorithm?: number };
};
const fail = (name: string, message: string): never => { throw new DOMException(message, name); };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder();
export function passkeyBase64url(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function passkeyBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return fail('TypeError', 'Invalid base64url credential data.');
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
  if (passkeyBase64url(bytes) !== value) return fail('TypeError', 'Noncanonical base64url credential data.');
  return bytes;
}
const join = (...parts: Uint8Array[]) => { const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes; };
const bytes = (...values: number[]) => Uint8Array.from(values);
const hash = async (crypto: Crypto, value: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value)));

function relyingParty(request: BrowserPasskeyRequest): string {
  let origin: URL;
  try { origin = new URL(request.origin); } catch { return fail('SecurityError', 'Invalid requesting origin.'); }
  const host = origin.hostname;
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(?:\.[0-9]{1,3}){3}$/.test(host);
  if (origin.origin !== request.origin || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) || origin.username || origin.password)
    return fail('SecurityError', 'Passkeys require a secure requesting origin.');
  if (request.crossOrigin !== undefined && request.crossOrigin !== false) return fail('SecurityError', 'Cross-origin frames are unsupported.');
  const rp = (request.type === 'create' ? request.publicKey.rp?.id : request.publicKey.rpId) ?? host;
  if (typeof rp !== 'string' || !rp || rp !== rp.toLowerCase() || rp.endsWith('.') || (rp !== host && !host.endsWith(`.${rp}`))) return fail('SecurityError', 'Relying party does not match the requesting origin.');
  if (rp === host && loopback) return rp;
  const parsed = parseDomain(rp, { allowPrivateDomains: true });
  if (parsed.isIp || !parsed.domain || parsed.publicSuffix === rp || !/^[a-z0-9.-]+$/.test(rp) || rp.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
    return fail('SecurityError', 'A public suffix or invalid domain cannot be a relying party.');
  return rp;
}
export function validateBrowserPasskeyRequest(input: unknown): BrowserPasskeyRequest {
  if (!object(input) || !['create', 'get'].includes(input.type) || typeof input.origin !== 'string' || !object(input.publicKey)) return fail('TypeError', 'Invalid passkey request.');
  // Snapshot page-controlled options before any asynchronous operation.
  let request: BrowserPasskeyRequest;
  try { request = JSON.parse(JSON.stringify(input)); } catch { return fail('TypeError', 'Passkey options must be JSON data.'); }
  const options = request.publicKey;
  relyingParty(request); passkeyBytes(options.challenge);
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout < 0)) return fail('TypeError', 'Invalid passkey timeout.');
  if (options.extensions !== undefined && (!object(options.extensions) || Object.entries(options.extensions).some(([key, value]) => request.type !== 'create' || key !== 'credProps' || value !== true))) return fail('NotSupportedError', 'Requested passkey extensions are unsupported.');
  const verification = (value: unknown) => { if (value !== undefined && !['required', 'preferred', 'discouraged'].includes(value as string)) fail('TypeError', 'Invalid user verification option.'); };
  verification(options.userVerification);
  for (const key of ['allowCredentials', 'excludeCredentials'] as const) {
    if (options[key] !== undefined && !Array.isArray(options[key])) return fail('TypeError', 'Invalid credential descriptors.');
    for (const item of options[key] ?? []) { if (!object(item) || item.type !== 'public-key') return fail('TypeError', 'Invalid credential descriptor.'); passkeyBytes(item.id); }
  }
  if (request.type === 'create') {
    if (!object(options.rp) || typeof options.rp.name !== 'string' || !object(options.user) || typeof options.user.name !== 'string' || typeof options.user.displayName !== 'string') return fail('TypeError', 'Invalid passkey account.');
    const user = passkeyBytes(options.user.id); if (user.length > 64) return fail('TypeError', 'WebAuthn user handles must contain 1 to 64 bytes.');
    if (!Array.isArray(options.pubKeyCredParams) || !options.pubKeyCredParams.every(item => object(item) && item.type === 'public-key' && Number.isInteger(item.alg))) return fail('TypeError', 'Invalid passkey algorithms.');
    if (!options.pubKeyCredParams.some(item => item.alg === -7)) return fail('NotSupportedError', 'Only ES256 passkeys are supported.');
    if (options.attestation !== undefined && options.attestation !== 'none') return fail('NotSupportedError', 'Only none attestation is supported.');
    if (options.authenticatorSelection !== undefined && !object(options.authenticatorSelection)) return fail('TypeError', 'Invalid authenticator selection.');
    const selection = options.authenticatorSelection;
    verification(selection?.userVerification);
    if (selection?.authenticatorAttachment !== undefined && selection.authenticatorAttachment !== 'platform') return fail('NotSupportedError', 'Cross-platform authenticators use the browser provider.');
    if (selection?.residentKey !== undefined && !['required', 'preferred', 'discouraged'].includes(selection.residentKey)) return fail('TypeError', 'Invalid resident key option.');
  }
  return request;
}
function confirmed(value: boolean) { if (value !== true) fail('NotAllowedError', 'Fresh verified user consent is required.'); }
function clientData(request: BrowserPasskeyRequest): Uint8Array {
  return encoder.encode(JSON.stringify({ type: request.type === 'create' ? 'webauthn.create' : 'webauthn.get', challenge: request.publicKey.challenge, origin: request.origin, crossOrigin: false }));
}
function cborHead(major: number, size: number): Uint8Array {
  if (size < 24) return bytes((major << 5) | size);
  if (size < 256) return bytes((major << 5) | 24, size);
  if (size < 65536) return bytes((major << 5) | 25, size >> 8, size & 255);
  return fail('NotSupportedError', 'Unsupported internal CBOR value.');
}
const cborInt = (n: number) => cborHead(n >= 0 ? 0 : 1, n >= 0 ? n : -n - 1);
const cborBytes = (b: Uint8Array) => join(cborHead(2, b.length), b);
const cborText = (s: string) => join(cborHead(3, encoder.encode(s).length), encoder.encode(s));
const cborMap = (pairs: [Uint8Array, Uint8Array][]) => join(cborHead(5, pairs.length), ...pairs.flat());
// Zero counters are permitted for synced multi-device credentials. BE+BS match
// the encrypted durable multi-device vault; UP+UV require verified consent.
const authData = async (crypto: Crypto, rp: string, attested: boolean) => join(await hash(crypto, encoder.encode(rp)), bytes(attested ? 0x5d : 0x1d, 0, 0, 0, 0));
const field = (entry: PasswordEntry, id: string) => entry.fields.find(item => item.id === id)?.value ?? '';
const credential = (id: string, response: BrowserPasskeyCredential['response']): BrowserPasskeyCredential => ({ id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response });

export async function prepareBrowserPasskeyRegistration(input: BrowserPasskeyRequest, freshVerified: boolean, existingEntries: PasswordEntry[] = [], crypto: Crypto = globalThis.crypto): Promise<{ entry: PasswordEntry; response: BrowserPasskeyCredential }> {
  const request = validateBrowserPasskeyRequest(input); if (request.type !== 'create') return fail('TypeError', 'Expected passkey creation.'); confirmed(freshVerified);
  const rp = relyingParty(request), user = request.publicKey.user!;
  if (existingEntries.some(entry => entry.passwordType === 'passkey' && field(entry, 'relyingParty') === rp && request.publicKey.excludeCredentials?.some(item => item.id === field(entry, 'credentialId')))) return fail('InvalidStateError', 'An excluded credential already exists.');
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const idBytes = crypto.getRandomValues(new Uint8Array(32)), id = passkeyBase64url(idBytes);
  const cose = cborMap([[cborInt(1), cborInt(2)], [cborInt(3), cborInt(-7)], [cborInt(-1), cborInt(1)], [cborInt(-2), cborBytes(passkeyBytes(jwk.x))], [cborInt(-3), cborBytes(passkeyBytes(jwk.y))]]);
  const authenticatorData = join(await authData(crypto, rp, true), new Uint8Array(16), bytes(0, idBytes.length), idBytes, cose);
  const attestation = cborMap([[cborText('fmt'), cborText('none')], [cborText('attStmt'), cborMap([])], [cborText('authData'), cborBytes(authenticatorData)]]);
  const fields: [string, string, string][] = [['username', 'Username', user.name], ['website', 'Website', `https://${rp}`], ['relyingParty', 'Relying party', rp], ['credentialId', 'Credential id', id], ['userHandle', 'User handle', user.id], ['privateKey', 'Passkey private key', jwk.d!]];
  const entry: PasswordEntry = { title: `${rp} · ${user.name}`, passwordType: 'passkey', fields: fields.map(([id, label, value]) => ({ id, label, value, type: id === 'privateKey' ? 'password' : id === 'website' ? 'url' : 'text', ...(id === 'privateKey' ? { concealed: true } : {}) })) };
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const response = credential(id, { clientDataJSON: passkeyBase64url(clientData(request)), attestationObject: passkeyBase64url(attestation), authenticatorData: passkeyBase64url(authenticatorData), transports: ['internal'], publicKey: passkeyBase64url(publicKey), publicKeyAlgorithm: -7 });
  if (request.publicKey.extensions?.credProps === true) response.clientExtensionResults = { credProps: { rk: true } };
  return { entry, response };
}
function derSignature(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) return fail('OperationError', 'Invalid ES256 signature encoding.');
  const integer = (value: Uint8Array) => { let start = 0; while (start < value.length - 1 && value[start] === 0) start++; const n = value.slice(start); const positive = n[0] & 0x80 ? join(bytes(0), n) : n; return join(bytes(2, positive.length), positive); };
  const body = join(integer(raw.slice(0, 32)), integer(raw.slice(32))); return join(bytes(0x30, body.length), body);
}
export async function createBrowserPasskeyAssertion(entry: PasswordEntry, input: BrowserPasskeyRequest, freshVerified: boolean, crypto: Crypto = globalThis.crypto): Promise<BrowserPasskeyCredential> {
  const request = validateBrowserPasskeyRequest(input); if (request.type !== 'get') return fail('TypeError', 'Expected passkey authentication.'); confirmed(freshVerified);
  const rp = relyingParty(request), id = field(entry, 'credentialId'), handle = field(entry, 'userHandle');
  if (entry.passwordType !== 'passkey' || field(entry, 'relyingParty') !== rp) return fail('NotAllowedError', 'Credential does not belong to this relying party.');
  passkeyBytes(id); const user = passkeyBytes(handle); if (user.length > 64) return fail('DataError', 'Invalid saved user handle.');
  if (request.publicKey.allowCredentials?.length && !request.publicKey.allowCredentials.some(item => item.id === id)) return fail('NotAllowedError', 'Credential is not allowed by the requesting site.');
  const raw = passkeyBytes(field(entry, 'privateKey')); if (raw.length !== 32) return fail('DataError', 'Invalid saved passkey.');
  // RFC 5915 ECPrivateKey inside PKCS#8; browsers derive the public point. This
  // also reads the existing Apple provider's raw P-256 private-key format.
  const prefix = bytes(0x30, 0x41, 2, 1, 0, 0x30, 0x13, 6, 7, 0x2a, 0x86, 0x48, 0xce, 0x3d, 2, 1, 6, 8, 0x2a, 0x86, 0x48, 0xce, 0x3d, 3, 1, 7, 4, 0x27, 0x30, 0x25, 2, 1, 1, 4, 0x20);
  const key = await crypto.subtle.importKey('pkcs8', join(prefix, raw), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const data = clientData(request), authenticatorData = await authData(crypto, rp, false);
  const signature = derSignature(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, join(authenticatorData, await hash(crypto, data)))));
  return credential(id, { clientDataJSON: passkeyBase64url(data), authenticatorData: passkeyBase64url(authenticatorData), signature: passkeyBase64url(signature), userHandle: handle });
}
