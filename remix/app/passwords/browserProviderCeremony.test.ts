import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPasskeyExcludedError, prepareBrowserPasskeyRegistration } from './browserPasskey';
import { loadProviderChoices, browserProviderFailure, providerApprovalBudget, runProviderCeremony, validateProviderRequest, type BrowserProviderAttempt, type ProviderRequest } from './browserProviderCeremony';
import { BROWSER_PROVIDER_BLOCKS, migrateBrowserProviderRecoveryControls } from '../components/Passwords/browserProviderBlocks';
import { settingsDocumentBlocks } from '../components/Settings/settingsDocument';
import { validatePasswordEntry } from './model';

const create = (): ProviderRequest => ({ version: 1, id: crypto.randomUUID(), type: 'create', origin: 'https://login.example.com', publicKey: {
  challenge: 'AQID', rp: { id: 'example.com', name: 'Fixture site' }, user: { id: 'BAUG', name: 'fixture@example.test', displayName: 'Fixture account' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none',
} });
const get = (): ProviderRequest => ({ version: 1, id: crypto.randomUUID(), type: 'get', origin: 'https://login.example.com', publicKey: { challenge: 'AQID', rpId: 'example.com' } });
const selection = (credentialId: string) => ({ id: 'selected', relyingParty: 'example.com', credentialId });
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

test('approval uses the time remaining on the website request', () => {
  const request = get();
  assert.equal(providerApprovalBudget(request, 100, 100), 119_000);
  request.publicKey.timeout = 30_000;
  assert.equal(providerApprovalBudget(request, 100, 24_100), 5_000);
  assert.equal(providerApprovalBudget(request, 100, 29_100), 0);
  request.publicKey.timeout = 300_000;
  assert.equal(providerApprovalBudget(request, 100, 100), 119_000);
  const operation = {};
  assert.match(browserProviderFailure(new DOMException('', 'TimeoutError'), operation, operation)!.message, /Try again or choose another passkey provider/);
});

test('fresh verification must succeed for this exact request before catalog, read or save', async () => {
  const request = create();
  for (const verified of [{ verified: false, requestId: request.id }, { verified: true, requestId: crypto.randomUUID() },
    { verified: true, requestId: request.id }, { verified: true, requestId: request.id, sessionBinding: 'invalid' }]) {
    const calls: string[] = [];
    await assert.rejects(runProviderCeremony(request, 'synthetic-password', null, async body => {
      calls.push(String(body.operation)); return verified;
    }, signal()), errorName('NotAllowedError'));
    assert.deepEqual(calls, ['verify-passkey']);
  }
});

test('cancellation before invocation or during the first dependent operation withholds completion', async () => {
  const cancelled = new AbortController(); cancelled.abort();
  let calls = 0;
  await assert.rejects(runProviderCeremony(create(), 'synthetic-password', null, async () => { calls++; }, cancelled.signal), errorName('AbortError'));
  assert.equal(calls, 0);
  for (const request of [create(), get()]) {
    const controller = new AbortController(), operations: string[] = [];
    await assert.rejects(runProviderCeremony(request, 'synthetic-password', selection('AQID'), async body => {
      operations.push(String(body.operation));
      if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
      controller.abort();
      return { catalog: [{ id: 'selected', relyingParty: 'example.com', credentialId: 'AQID' }] };
    }, controller.signal), errorName('AbortError'));
    assert.deepEqual(operations, ['verify-passkey', request.type === 'get' ? 'read' : 'catalog']);
  }
});

test('registration emits no successful credential when durable exact readback fails', async () => {
  const request = create(), operations: string[] = [];
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', null, async body => {
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
    const ceremony = runProviderCeremony(request, 'synthetic-only', null, async body => {
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
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', null, vault, signal(), attempt), /uncertain transport/);
  assert.ok(attempt.prepared);
  const result = await runProviderCeremony(request, 'synthetic-password', null, vault, signal(), attempt);
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
  const refused = [null, { ...selection('AQID'), relyingParty: 'attacker.test' }, selection('BAUG')];
  for (const selected of refused)
    await assert.rejects(runProviderCeremony(request, 'synthetic-password', selected, async () => {
      assert.fail('Missing, foreign, and disallowed selections must fail before contacting the vault.');
    }, signal()), errorName('NotAllowedError'));
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
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', selection(registration.response.id), async body => {
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
    if (body.operation === 'read' && ++reads === 1) return { id: 'selected', entry: registration.entry };
    throw new Error('Synthetic live session revoked');
  }, signal()), /live session revoked/);
  assert.equal(reads, 2);
});

test('browser provider editable document passes the canonical settings block schema', () => {
  assert.equal(settingsDocumentBlocks(BROWSER_PROVIDER_BLOCKS).length, BROWSER_PROVIDER_BLOCKS.length);
});

test('an uncertain attempt cannot be reused for a different challenge or request', async () => {
  const request = create(), attempt: BrowserProviderAttempt = {};
  await assert.rejects(runProviderCeremony(request, 'synthetic-password', null, async body => {
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
    if (body.operation === 'catalog') return { catalog: [] };
    throw new Error('Synthetic uncertain write');
  }, signal(), attempt), /uncertain write/);
  const changed = structuredClone(request); changed.publicKey.challenge = 'BAUG';
  let calls = 0;
  await assert.rejects(runProviderCeremony(changed, 'synthetic-password', null, async () => { calls++; }, signal(), attempt), errorName('InvalidStateError'));
  assert.equal(calls, 0);
});

test('credential replacement during signing withholds the old assertion', async () => {
  const registration = await prepareBrowserPasskeyRegistration(create(), true);
  const request = get();
  for (const change of ['id', 'revision', 'entry']) {
    let reads = 0;
    await assert.rejects(runProviderCeremony(request, 'synthetic-password', selection(registration.response.id), async body => {
      if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding };
      reads++;
      return { id: reads === 2 && change === 'id' ? 'replacement' : 'selected', revision: reads === 2 && change === 'revision' ? 2 : 1, entry: reads === 2 && change === 'entry' ? { ...registration.entry, title: 'Changed credential' } : registration.entry };
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
    assert.deepEqual(body.passkeySession, { requestId: request.id, binding: sessionBinding, context: request.type==='create' ? attempt.context : (body.passkeySession as any).context });
    if (body.operation === 'catalog') return { catalog: [] };
    if (body.operation === 'save') {
      persisted = body.entry;
      if (uncertain) { uncertain = false; throw new Error('Uncertain session-A write'); }
      return {};
    }
    return { entry: persisted };
  };
  await assert.rejects(runProviderCeremony(request, 'synthetic-only', null, vault, signal(), attempt), /Uncertain/);
  assert.equal(seen[0].passkeySession, undefined, 'Initial fresh verification has no earlier binding.');
  await runProviderCeremony(request, 'synthetic-only', null, vault, signal(), attempt);
  const verification = seen.filter(body => body.operation === 'verify-passkey');
  assert.deepEqual(verification[1].passkeySession, { requestId: request.id, binding: sessionBinding, context: attempt.context });
  let dependent = 0;
  await assert.rejects(runProviderCeremony(request, 'synthetic-only', null, async body => {
    if (body.operation === 'verify-passkey') return { verified: true, requestId: request.id, sessionBinding: 'B'.repeat(43) };
    dependent++; return {};
  }, signal(), attempt), errorName('NotAllowedError'));
  assert.equal(dependent, 0, 'Same-owner replacement proof cannot continue a prior attempt.');
});

test('assertion approval uses only the exact selection after a multi-page vault discovery', async () => {
  const registration = await prepareBrowserPasskeyRegistration(create(), true), request = get();
  request.publicKey.allowCredentials = [{ type: 'public-key', id: registration.response.id }];
  const lastPage = 8;
  let pages = 0;
  const [selected] = await loadProviderChoices(request, async () => {
    pages++;
    return pages < lastPage ? { catalog: [], nextCursor: String(pages) }
      : { catalog: [selection(registration.response.id)] };
  }, signal());
  assert.equal(pages, lastPage);
  const operations: string[] = [];
  let approvedContext:unknown;
  const result = await runProviderCeremony(request, '', selected, async body => {
    operations.push(String(body.operation));
    if (body.operation === 'verify-passkey') {
      assert.equal(body.password, '', 'A remembered device does not supply an account password.');
      approvedContext = body.context;
      const { requestHash, ...target } = body.context as { requestHash: string };
      assert.deepEqual(target, { entryId: 'selected', rp: 'example.com', purpose: 'get' });
      assert.match(requestHash, /^[A-Za-z0-9_-]{43}$/);
      return { verified: true, requestId: request.id, sessionBinding };
    }
    assert.equal(body.operation, 'read', 'Approval must not scan or decrypt the rest of the vault.');
    assert.equal(body.id, 'selected');
    assert.deepEqual(body.passkeySession, { requestId: request.id, binding: sessionBinding, context: approvedContext });
    return { id: 'selected', entry: registration.entry, revision: 1 };
  }, signal());
  assert.equal(result.id, registration.response.id);
  assert.deepEqual(operations, ['verify-passkey', 'read', 'read']);
});

test('assertion refuses a stale selection even when the replacement credential is also allowed', async () => {
  const registration = await prepareBrowserPasskeyRegistration(create(), true), request = get();
  const selected = selection('AQID');
  request.publicKey.allowCredentials = [{ type: 'public-key', id: selected.credentialId }, { type: 'public-key', id: registration.response.id }];
  const operations: string[] = [];
  await assert.rejects(runProviderCeremony(request, '', selected, async body => {
    operations.push(String(body.operation));
    return body.operation === 'verify-passkey' ? { verified: true, requestId: request.id, sessionBinding }
      : { id: 'selected', entry: registration.entry, revision: 2 };
  }, signal()), errorName('InvalidStateError'));
  assert.deepEqual(operations, ['verify-passkey', 'read']);
});

test('a retained registration retry rechecks newly present exact-site exclusions before another write', async () => {
  const request = create(), attempt: BrowserProviderAttempt = {};
  request.publicKey.excludeCredentials = [{type: 'public-key', id: 'AQID'}];
  let excludedPresent = false, saves = 0;
  const vault = async (body: Record<string, any>) => {
    if (body.operation === 'verify-passkey') return {verified: true, requestId: request.id, sessionBinding};
    if (body.operation === 'catalog') return {catalog: excludedPresent ? [{id: 'existing', relyingParty: 'example.com', credentialId: 'AQID'}] : []};
    if (body.operation === 'save') { saves++; throw new Error('Uncertain write'); }
    throw new Error('Unexpected secret read');
  };
  await assert.rejects(runProviderCeremony(request, 'synthetic-only', null, vault, signal(), attempt), /Uncertain write/);
  const retained = attempt.prepared;
  excludedPresent = true;
  await assert.rejects(runProviderCeremony(request, 'synthetic-only', null, vault, signal(), attempt), errorName('InvalidStateError'));
  assert.equal(saves, 1); assert.equal(attempt.prepared, retained);
});

test('an existing exact-site exclusion refuses registration before any save or secret read', async () => {
  const request = create(); request.publicKey.excludeCredentials = [{type: 'public-key', id: 'AQID'}];
  const operations: string[] = [];
  await assert.rejects(runProviderCeremony(request, 'synthetic-only', null, async body => {
    operations.push(String(body.operation));
    return body.operation === 'verify-passkey' ? {verified: true, requestId: request.id, sessionBinding}
      : {catalog: [{id: 'existing', relyingParty: 'example.com', credentialId: 'AQID'}]};
  }, signal()), errorName('InvalidStateError'));
  assert.deepEqual(operations, ['verify-passkey', 'catalog']);
});


test('only current typed exclusion is terminal; stale failure and other InvalidStateErrors cannot close a new request', () => {
  const first = {}, second = {};
  assert.equal(browserProviderFailure(new BrowserPasskeyExcludedError(), first, second), null);
  assert.equal(browserProviderFailure(new BrowserPasskeyExcludedError(), first, null), null);
  const excluded = browserProviderFailure(new BrowserPasskeyExcludedError(), first, first);
  assert.equal(excluded?.kind, 'excluded'); assert.ok(excluded?.message.includes('Keep your working passkey'));
  assert.equal(browserProviderFailure(new Error('Temporary network failure'), first, first)?.kind, 'retryable');
  assert.equal(browserProviderFailure(new DOMException('Changed session', 'InvalidStateError'), first, first)?.kind, 'retryable');
});


test('persisted legacy approval controls gain terminal guards without changing authored content or recreating deletions', () => {
  const legacy = [{id: 'root', type: 'element', tag: 'section', children: [
    {id: 'bp-retry', type: 'element', tag: 'button', text: 'My refresh text', css: {color: 'purple'}, props: {'data-extra': 'retained'}},
    {id: 'bp-fallback', type: 'element', tag: 'button', text: 'My alternate provider', css: {padding: '19px'}},
    {id: 'bp-cancel', type: 'element', tag: 'button', text: 'Cancel', css: {border: '2px solid green'}, props: {
      disabled: '{result.busy}', 'data-tt-action': '$transient', 'data-tt-action-inputs': {operation: 'provider.cancel'}, 'data-extra': 'retained',
    }},
  ]}] as any;
  const before = structuredClone(legacy), migrated = migrateBrowserProviderRecoveryControls(legacy);
  const controls = migrated[0].children!;
  assert.deepEqual(legacy, before, 'Migration never mutates the saved document');
  assert.equal((controls[0] as any).condition.arg, 'result.canRefresh'); assert.deepEqual(controls[0].children![0], before[0].children[0]);
  assert.equal((controls[1] as any).condition.arg, 'result.canChooseProvider'); assert.deepEqual(controls[1].children![0], before[0].children[1]);
  assert.equal((controls[2] as any).text, '{result.cancelLabel}'); assert.deepEqual(controls[2].css, before[0].children[2].css);
  assert.deepEqual(controls[2].props, { ...before[0].children[2].props, disabled: false }, 'The default Cancel stays usable while busy.');
  assert.deepEqual(migrateBrowserProviderRecoveryControls(migrated), migrated, 'Idempotent wrappers');
  assert.deepEqual(migrateBrowserProviderRecoveryControls([]), [], 'Deleted controls stay deleted');
  const custom = [{...before[0].children[2], text: 'My close label', props: {...before[0].children[2].props, disabled: '{result.customDisabled}'}}] as any;
  assert.deepEqual(migrateBrowserProviderRecoveryControls(custom), custom, 'An authored cancel label and custom disabled condition are retained');
});
