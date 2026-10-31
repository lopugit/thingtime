import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBrowserPasskeyRegistration } from './browserPasskey';
import { loadProviderChoices, runProviderCeremony, validateProviderRequest, type BrowserProviderAttempt, type ProviderRequest } from './browserProviderCeremony';
import { BROWSER_PROVIDER_BLOCKS } from '../components/Passwords/browserProviderBlocks';
import { settingsDocumentBlocks } from '../components/Settings/settingsDocument';
import { validatePasswordEntry } from './model';

const create = (): ProviderRequest => ({ version: 1, id: crypto.randomUUID(), type: 'create', origin: 'https://login.example.com', publicKey: {
  challenge: 'AQID', rp: { id: 'example.com', name: 'Fixture site' }, user: { id: 'BAUG', name: 'fixture@example.test', displayName: 'Fixture account' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none',
} });
const get = (): ProviderRequest => ({ version: 1, id: crypto.randomUUID(), type: 'get', origin: 'https://login.example.com', publicKey: { challenge: 'AQID', rpId: 'example.com' } });
const sessionBinding = 'A'.repeat(43);
const errorName = (name: string) => (error: unknown) => error instanceof DOMException && error.name === name;
const signal = () => new AbortController().signal;

test('provider validates request identities before accepting browser options', () => {
  const request = create();
  assert.equal(validateProviderRequest(request).id, request.id);
  for (const invalid of [{ ...request, version: 2 }, { ...request, id: 'not-an-id' }, { ...request, id: '00000000-0000-1000-8000-000000000000' }]) {
    assert.throws(() => validateProviderRequest(invalid), errorName('DataError'));
  }
});

test('fresh verification must succeed for this exact request before catalog, read or save', async () => {
  const request = create();
  for (const verified of [{ verified: false, requestId: request.id }, { verified: true, requestId: crypto.randomUUID() },
    { verified: true, requestId: request.id }, { verified: true, requestId: request.id, sessionBinding: 'invalid' }]) {
    const calls: string[] = [];
    await assert.rejects(runProviderCeremony(request, 'synthetic-password', '', async body => {
      calls.push(String(body.operation)); return verified;
    }, signal()), errorName('NotAllowedError'));
    assert.deepEqual(calls, ['verify-passkey']);
  }
});

test('cancellation before invocation or during catalog prevents credential reads and saves', async () => {
  const cancelled = new AbortController(); cancelled.abort();
  let calls = 0;
  await assert.rejects(runProviderCeremony(create(), 'synthetic-password', '', async () => { calls++; }, cancelled.signal), errorName('AbortError'));
  assert.equal(calls, 0);
  for (const request of [create(), get()]) {
    const controller = new AbortController(), operations: string[] = [];
    await assert.rejects(runProviderCeremony(request, 'synthetic-password', 'selected', async body => {
      operations.push(String(body.operation));
      if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
      controller.abort();
      return { catalog: [{ id: 'selected', relyingParty: 'example.com', credentialId: 'AQID' }] };
    }, controller.signal), errorName('AbortError'));
    assert.deepEqual(operations, ['verify-passkey', 'catalog']);
  }
});

test('registration emits no successful credential when durable exact readback fails', async () => {
  const request = create(), operations: string[] = [];
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', '', async body => {
    operations.push(String(body.operation));
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
    if (body.operation === 'catalog') return { catalog: [] };
    if (body.operation === 'save') return { ok: true };
    return { entry: { passwordType: 'passkey', fields: [] } };
  }, signal()), /saved passkey could not be verified/);
  assert.deepEqual(operations, ['verify-passkey', 'catalog', 'save', 'read']);
});

test('registration readback accepts the real canonical writer normalization and still matches every secret', async () => {
  for (const changed of [undefined, 'privateKey', 'userHandle', 'relyingParty', 'credentialId'] as const) {
    const request = create();
    let persisted: unknown;
    const ceremony = runProviderCeremony(request, 'synthetic-only', '', async body => {
      if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
      if (body.operation === 'catalog') return { catalog: [] };
      if (body.operation === 'save') {
        const canonical = validatePasswordEntry(body.entry);
        persisted = canonical;
        assert.notEqual(JSON.stringify(canonical.fields), JSON.stringify((body.entry as any).fields), 'Fixture exercises the canonical field property order.');
        return {};
      }
      const readback = validatePasswordEntry(persisted);
      if (changed) readback.fields.find(field => field.id === changed)!.value += 'changed';
      return { entry: readback };
    }, signal());
    if (changed) await assert.rejects(ceremony, /saved passkey could not be verified/);
    else assert.equal((await ceremony).type, 'public-key');
  }
});

test('ambiguous registration retry preserves credential, item id and write identity', async () => {
  const request = create(), attempt: BrowserProviderAttempt = {};
  const saves: Record<string, unknown>[] = [];
  let persisted: unknown;
  let confirmations = 0;
  const vault = async (body: Record<string, unknown>) => {
    if (body.operation === 'verify-passkey') { confirmations++; return { verified: true, requestId: request.id, sessionBinding }; }
    if (body.operation === 'catalog') return { catalog: [] };
    if (body.operation === 'save') {
      saves.push(structuredClone(body)); persisted = structuredClone(body.entry);
      if (saves.length === 1) throw new Error('Synthetic uncertain transport completion');
      return { ok: true };
    }
    return { entry: persisted };
  };
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', '', vault, signal(), attempt), /uncertain transport/);
  assert.ok(attempt.prepared);
  const result = await runProviderCeremony(request, 'synthetic-password', '', vault, signal(), attempt);
  assert.equal(confirmations, 2, 'Retries need another fresh verification');
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1], saves[0]);
  assert.equal(result.id, attempt.prepared.response.id);
});

test('choices restrict RP and allowed credential identities across all catalog pages', async () => {
  const request = get(); request.publicKey.allowCredentials = [{ type: 'public-key', id: 'AQID' }];
  const pages = [
    { catalog: [{ id: 'foreign', relyingParty: 'attacker.test', credentialId: 'AQID' }, { id: 'disallowed', relyingParty: 'example.com', credentialId: 'BAUG' }], nextCursor: 'page-two' },
    { catalog: [{ id: 'missing', relyingParty: 'example.com' }, { id: 'allowed', relyingParty: 'example.com', credentialId: 'AQID' }] },
  ];
  const cursors: unknown[] = [];
  const choices = await loadProviderChoices(request, async body => { cursors.push(body.cursor); return pages.shift(); }, signal());
  assert.deepEqual(choices.map(choice => choice.id), ['allowed']);
  assert.deepEqual(cursors, [undefined, 'page-two']);
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', 'foreign', async body => body.operation === 'verify-passkey'
    ? { verified: true, requestId: request.id, sessionBinding } : { catalog: [{ id: 'foreign', relyingParty: 'attacker.test', credentialId: 'AQID' }] }, signal()), errorName('NotAllowedError'));
});

test('repeating catalog cursor terminates rather than looping indefinitely', async () => {
  let calls = 0;
  await assert.rejects(loadProviderChoices(get(), async () => { calls++; return { catalog: [], nextCursor: 'same-page' }; }, signal()), /password list could not finish/);
  assert.equal(calls, 2);
});

test('assertion is withheld when final live credential readback fails', async () => {
  const registration = await prepareBrowserPasskeyRegistration(create(), true);
  const request = get();
  let reads = 0;
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', 'selected', async body => {
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
    if (body.operation === 'catalog') return { catalog: [{ id: 'selected', relyingParty: 'example.com', credentialId: registration.response.id }] };
    if (body.operation === 'read' && ++reads === 1) return { entry: registration.entry };
    throw new Error('Synthetic live session revoked');
  }, signal()), /live session revoked/);
  assert.equal(reads, 2);
});

test('browser provider editable document passes the canonical settings block schema', () => {
  assert.equal(settingsDocumentBlocks(BROWSER_PROVIDER_BLOCKS).length, BROWSER_PROVIDER_BLOCKS.length);
});

test('an uncertain attempt cannot be reused for a different challenge or request', async () => {
  const request = create(), attempt: BrowserProviderAttempt = {};
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', '', async body => {
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
    if (body.operation === 'catalog') return { catalog: [] };
    throw new Error('Synthetic uncertain write');
  }, signal(), attempt), /uncertain write/);
  const changed = structuredClone(request); changed.publicKey.challenge = 'BAUG';
  let calls = 0;
  await assert.rejects(runProviderCeremony(changed, 'synthetic-password', '', async () => { calls++; }, signal(), attempt), errorName('InvalidStateError'));
  assert.equal(calls, 0);
});

test('credential replacement during signing withholds the old assertion', async () => {
  const registration = await prepareBrowserPasskeyRegistration(create(), true);
  const request = get();
  for (const change of ['revision', 'entry']) {
    let reads = 0;
    await assert.rejects(runProviderCeremony(request, 'synthetic-password', 'selected', async body => {
      if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
      if (body.operation === 'catalog') return { catalog: [{ id: 'selected', relyingParty: 'example.com', credentialId: registration.response.id }] };
      reads++;
      return { revision: reads === 2 && change === 'revision' ? 2 : 1, entry: reads === 2 && change === 'entry' ? { ...registration.entry, title: 'Changed credential' } : registration.entry };
    }, signal()), errorName('InvalidStateError'));
    assert.equal(reads, 2);
  }
});

test('every dependent operation carries the verified session binding and a retry cannot change it', async () => {
  const request = create(), attempt: BrowserProviderAttempt = {};
  const seen: Record<string, unknown>[] = [];
  let persisted: unknown;
  let uncertain = true;
  const vault = async (body: Record<string, unknown>) => {
    seen.push(structuredClone(body));
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
    assert.deepEqual(body.passkeySession, { requestId: request.id, binding: sessionBinding });
    if (body.operation === 'catalog') return { catalog: [] };
    if (body.operation === 'save') {
      persisted = body.entry;
      if (uncertain) { uncertain = false; throw new Error('Uncertain session-A write'); }
      return {};
    }
    return { entry: persisted };
  };
  await assert.rejects(runProviderCeremony(request, 'synthetic-only', '', vault, signal(), attempt), /Uncertain/);
  assert.equal(seen[0].passkeySession, undefined, 'Initial fresh verification has no earlier binding.');
  await runProviderCeremony(request, 'synthetic-only', '', vault, signal(), attempt);
  const verification = seen.filter(body => body.operation === 'verify-passkey');
  assert.deepEqual(verification[1].passkeySession, { requestId: request.id, binding: sessionBinding });
  let dependent = 0;
  await assert.rejects(runProviderCeremony(request, 'synthetic-only', '', async body => {
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding: 'B'.repeat(43) };
    dependent++; return {};
  }, signal(), attempt), errorName('NotAllowedError'));
  assert.equal(dependent, 0, 'Same-owner replacement proof cannot continue a prior attempt.');
});

test('assertion catalog and both secret readbacks stay bound to the same verified session', async () => {
  const registration = await prepareBrowserPasskeyRegistration(create(), true), request = get();
  const operations: string[] = [];
  const result = await runProviderCeremony(request, 'synthetic-only', 'selected', async body => {
    operations.push(String(body.operation));
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
    assert.deepEqual(body.passkeySession, { requestId: request.id, binding: sessionBinding });
    return body.operation === 'catalog' ? { catalog: [{ id: 'selected', relyingParty: 'example.com', credentialId: registration.response.id }] }
      : { entry: registration.entry, revision: 1 };
  }, signal());
  assert.equal(result.id, registration.response.id);
  assert.deepEqual(operations, ['verify-passkey', 'catalog', 'read', 'read']);
});
