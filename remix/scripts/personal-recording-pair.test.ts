import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import test from 'node:test';
import { canonicalDevicePairingClaimBytes } from '../app/api/utils/devices/deviceAuth';
import { pairPersonalRecordingDevice, PERSONAL_PAIRING_REQUIREMENTS, personalRecordingOrigin, type PersonalPairingState } from './personal-recording-pair';

const origin = 'https://pairing.example.invalid';
const secret = `ttpair_${'a'.repeat(43)}`;
const manifest = () => ({ schemaVersion: 1, origin,
  features: Object.fromEntries(Object.entries(PERSONAL_PAIRING_REQUIREMENTS).map(([id, version]) => [id, { version }])),
  operations: [{ feature: 'api.devices-pairing-claim', path: '/api/v1/devices/pairing/claim', methods: ['POST'] }] });
const fixture = () => {
  let saved: PersonalPairingState | null = null;
  const calls: any[] = [];
  const writes: PersonalPairingState[] = [];
  const store = { read: async () => structuredClone(saved), write: async (value: PersonalPairingState) => {
    saved = structuredClone(value); writes.push(structuredClone(value));
  } };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(new URL(String(url)).origin, origin);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push(body);
    if (!body) return Response.json(manifest());
    assert.ok(saved?.pending, 'persist the recoverable credential before transmitting');
    if (body.op === 'prepare') return Response.json({ proof: { pairingId: 'pairing-test', serverNonce: 'b'.repeat(43) } });
    assert.ok(saved.pending.proof, 'persist the server proof before completing');
    assert.deepEqual(body.capabilities, ['recordings.personal.v1']);
    assert.equal(body.credential, saved.credential);
    assert.equal(verify(null, canonicalDevicePairingClaimBytes({ ...body, ...body.proof }),
      createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(body.proof.publicKey, 'base64url')]), format: 'der', type: 'spki' }),
      Buffer.from(body.proof.signature, 'base64url')), true);
    return Response.json({ ok: true, credentialStored: true, device: { id: 'paired-computer' } });
  };
  return { store, fetcher, calls, writes, saved: () => saved };
};

test('pairing persists signed claim first and discards one-time material after its receipt', async () => {
  const f = fixture();
  assert.deepEqual(await pairPersonalRecordingDevice({ origin, pairingSecret: secret, store: f.store, fetch: f.fetcher }),
    { deviceId: 'paired-computer', alreadyPaired: false });
  assert.equal(f.writes.length, 3);
  assert.deepEqual(Object.keys(f.saved()!).sort(), ['credential', 'deviceId', 'origin', 'version']);
});

test('lost complete receipt resumes the exact signature and credential without prepare or duplicate registration', async () => {
  const f = fixture(); let lost = false;
  const fetcher: typeof fetch = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (!lost && init?.body && JSON.parse(String(init.body)).op === 'complete') { lost = true; throw new Error('private transport details'); }
    return response;
  };
  await assert.rejects(pairPersonalRecordingDevice({ origin, pairingSecret: secret, store: f.store, fetch: fetcher }), /Pairing did not finish/);
  assert.ok(f.saved()?.pending?.proof);
  await pairPersonalRecordingDevice({ origin, store: f.store, fetch: fetcher });
  assert.equal(f.calls.filter((call) => call?.op === 'prepare').length, 1);
  const completed = f.calls.filter((call) => call?.op === 'complete');
  assert.deepEqual(completed[0], completed[1]);
});

test('lost prepare receipt retains the same nonce and key on retry', async () => {
  const f = fixture(); let lost = false;
  const fetcher: typeof fetch = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (!lost && init?.body) { lost = true; throw new Error('lost'); }
    return response;
  };
  await assert.rejects(pairPersonalRecordingDevice({ origin, pairingSecret: secret, store: f.store, fetch: fetcher }));
  await pairPersonalRecordingDevice({ origin, store: f.store, fetch: fetcher });
  const prepares = f.calls.filter((call) => call?.op === 'prepare');
  assert.deepEqual(prepares[0], prepares[1]);
});

test('incompatible and foreign manifests cannot access local credentials or send a claim', async () => {
  for (const invalid of [{ ...manifest(), origin: 'https://elsewhere.invalid' }, { ...manifest(), features: {} }, { ...manifest(), operations: [] }]) {
    let calls = 0;
    await assert.rejects(pairPersonalRecordingDevice({ origin, pairingSecret: secret,
      store: { read: async () => { assert.fail('must negotiate before vault access'); }, write: async () => { assert.fail(); } },
      fetch: async () => { calls++; return Response.json(invalid); } }), /Pairing did not finish/);
    assert.equal(calls, 1);
  }
});

test('vault failure prevents transmission; secret-shaped exception text stays closed', async () => {
  const f = fixture();
  await assert.rejects(pairPersonalRecordingDevice({ origin, pairingSecret: secret, fetch: f.fetcher,
    store: { read: async () => null, write: async () => { throw new Error(secret); } } }), (error: Error) => {
    assert.equal(error.message.includes(secret), false); return true;
  });
  assert.deepEqual(f.calls, [null]);
});

test('already paired state only checks compatibility and never sends another secret', async () => {
  const f = fixture();
  await pairPersonalRecordingDevice({ origin, pairingSecret: secret, store: f.store, fetch: f.fetcher });
  f.calls.length = 0;
  assert.deepEqual(await pairPersonalRecordingDevice({ origin, store: f.store, fetch: f.fetcher }), { deviceId: 'paired-computer', alreadyPaired: true });
  assert.deepEqual(f.calls, [null]);
});

test('rejects mismatched origin vault state, invalid one-time secrets and oversized responses', async () => {
  const f = fixture();
  await assert.rejects(pairPersonalRecordingDevice({ origin, pairingSecret: 'not-a-pairing-secret', store: f.store, fetch: f.fetcher }));
  assert.equal(f.writes.length, 0);
  await f.store.write({ version: 1, origin: 'https://other.invalid', credential: `ttnode_${'x'.repeat(43)}`, deviceId: 'other-device' });
  await assert.rejects(pairPersonalRecordingDevice({ origin, store: f.store, fetch: f.fetcher }));
  await assert.rejects(pairPersonalRecordingDevice({ origin, store: f.store, fetch: async () => new Response(' '.repeat(1024 * 1024 + 1)) }));
});

test('accepts exact HTTPS/loopback origins only', () => {
  for (const good of [origin, 'http://localhost:18000', 'http://127.0.0.1:18000', 'http://[::1]:18000']) assert.equal(personalRecordingOrigin(good), good);
  for (const bad of ['http://remote.invalid', `${origin}/`, `${origin}/path`, `${origin}?key=secret`, 'https://user:pass@example.invalid', 'file:///tmp/file'])
    assert.throws(() => personalRecordingOrigin(bad));
});
