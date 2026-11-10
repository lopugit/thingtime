import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { canonicalDevicePairingClaimBytes } from '../app/api/utils/devices/deviceAuth';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../app/api/utils/capabilities/capabilityContract';

export const PERSONAL_PAIRING_REQUIREMENTS = {
  'api.devices-pairing': '1.0.0', 'api.devices-pairing-claim': '1.0.0',
  'api.lopu-recordings': '1.4.0', 'api.lopu-recordings-personal': '1.0.0'
} as const;
const claimPath = '/api/v1/devices/pairing/claim';
export const personalRecordingOrigin = (value: string) => {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
    throw new Error('Use an HTTPS Thingtime origin, or HTTP loopback for local tests.');
  return url.origin;
};
export type PersonalPairingState = {
  version: 1; origin: string; credential: string; deviceId?: string;
  pending?: { secret: string; publicKey: string; privateKey: string; nonce: string; proof?: { pairingId: string; serverNonce: string } };
};
export type PersonalPairingStore = {
  read(): Promise<PersonalPairingState | null>;
  write(value: PersonalPairingState): Promise<void>;
};

// Store is the local OS vault, not request data. Persist the exact claim before
// sending it so interruption cannot strand a successfully created device.
export const pairPersonalRecordingDevice = async (options: {
  origin: string; pairingSecret?: string; store: PersonalPairingStore; fetch?: typeof fetch;
}) => {
  const origin = personalRecordingOrigin(options.origin);
  const fetcher = options.fetch || fetch;
  const request = async (path: string, body?: unknown) => {
    const response = await fetcher(new URL(path, origin), { method: body ? 'POST' : 'GET',
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000),
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Pairing request was not accepted.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing pairing response.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length; if (size > 1024 * 1024) throw new Error('Pairing response is too large.');
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  try {
    const manifest = await request(THINGTIME_CAPABILITY_MANIFEST_PATH);
    if (manifest?.schemaVersion !== 1 || manifest.origin !== origin ||
        !Object.entries(PERSONAL_PAIRING_REQUIREMENTS).every(([id, min]) => capabilitySatisfies(manifest.features?.[id]?.version, min)) ||
        !Array.isArray(manifest.operations) || !manifest.operations.some((op: any) =>
          op.feature === 'api.devices-pairing-claim' && op.path === claimPath && Array.isArray(op.methods) && op.methods.includes('POST')))
      throw new Error('Incompatible pairing origin.');
    let state = await options.store.read();
    if (state && (state.version !== 1 || state.origin !== origin || !/^ttnode_[A-Za-z0-9_-]{43}$/.test(state.credential)))
      throw new Error('Invalid local pairing state.');
    if (state?.deviceId) return { deviceId: state.deviceId, alreadyPaired: true };
    if (!state) {
      if (!/^ttpair_[A-Za-z0-9_-]{43}$/.test(options.pairingSecret || '')) throw new Error('Use the one-time pairing secret.');
      const keys = generateKeyPairSync('ed25519');
      state = { version: 1, origin, credential: `ttnode_${randomBytes(32).toString('base64url')}`, pending: {
        secret: options.pairingSecret!, publicKey: keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'),
        privateKey: keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'), nonce: randomBytes(32).toString('base64url')
      } };
      await options.store.write(state);
    }
    const pending = state.pending;
    if (!pending || (options.pairingSecret && options.pairingSecret !== pending.secret)) throw new Error('Resume the existing pending pairing.');
    const proof = pending.proof || (await request(claimPath, { op: 'prepare', pairingSecret: pending.secret, publicKey: pending.publicKey, nonce: pending.nonce })).proof;
    if (typeof proof?.pairingId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(proof.pairingId) || !/^[A-Za-z0-9_-]{43}$/.test(proof.serverNonce))
      throw new Error('Invalid server pairing proof.');
    if (!pending.proof) {
      pending.proof = { pairingId: proof.pairingId, serverNonce: proof.serverNonce };
      await options.store.write(state);
    }
    const device = { name: 'Personal recording computer', platform: 'macos' as const, model: null, osVersion: null, appVersion: null };
    const capabilities = ['recordings.personal.v1'];
    const signature = sign(null, canonicalDevicePairingClaimBytes({ pairingId: proof.pairingId, pairingSecret: pending.secret,
      credential: state.credential, publicKey: pending.publicKey, nonce: pending.nonce, serverNonce: proof.serverNonce, device, capabilities
    }), createPrivateKey({ key: Buffer.from(pending.privateKey, 'base64url'), format: 'der', type: 'pkcs8' })).toString('base64url');
    const result = await request(claimPath, { op: 'complete', pairingSecret: pending.secret, credential: state.credential, device, capabilities,
      proof: { pairingId: proof.pairingId, publicKey: pending.publicKey, nonce: pending.nonce, serverNonce: proof.serverNonce, signature } });
    if (result?.ok !== true || result.credentialStored !== true || typeof result.device?.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(result.device.id)) throw new Error('Invalid pairing receipt.');
    await options.store.write({ version: 1, origin, credential: state.credential, deviceId: result.device.id });
    return { deviceId: result.device.id, alreadyPaired: false };
  } catch {
    // Never expose raw network, JSON, keychain or signature exceptions.
    throw new Error('Pairing did not finish. Check the origin and one-time challenge, then resume the saved pairing.');
  }
};
