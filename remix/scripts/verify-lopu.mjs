#!/usr/bin/env node
// Live verification of the Lopu AI assistant family — real API only, no
// mocks, no direct DB access (FUNDAMENTALS §2). Design note §4:
//
//   register throwaway user → GET /api/v1/ai/models → create chat → reply
//   (NDJSON; with LOPU_CHAT_PROVIDER=test the server builds a component AND a
//   page through the real tool loop) → resolve the created page → messages
//   listed through the messenger endpoint → rename → delete → the generic
//   /api/v1/things paths cannot reach the chat, its rows or the ai-model
//   catalog. Then, when an admin login is available: POST
//   /api/v1/admin/ai/models toggle + seed and GET/POST
//   /api/v1/settings/lopu-chat-defaults.
//
//   Section A2 (verified access + credits, design note "Lopu verified access,
//   usage accounting and credits" §5): a fresh account is unverified → create /
//   reply / voice session are 403 LOPU_UNVERIFIED (listing never is) → the
//   admin verifies both throwaway accounts → with no credits a reply is 402
//   LOPU_NO_CREDITS → the admin grants 2 credits → the reply streams (the test
//   provider's synthetic 100/50 tokens priced against test-model: 0.2 credits)
//   → done carries billing / costMicros / balanceMicros, the account and the
//   history show the debit + usage row → a top-up request (one pending at a
//   time) → admin approves (and declines another) → the admin directory lists
//   the user → the access rules round-trip → the generic /api/v1/things paths
//   cannot mint, read or edit the accounting kinds → a run budget is granted
//   so every later section can chat.
//
//   node scripts/verify-lopu.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or this worktree's nitro port. The
// admin sections need TT_VERIFY_ADMIN_USERNAME + TT_VERIFY_ADMIN_PASSWORD
// (a username listed in the server's ADMIN_USERNAMES); they are skipped, not
// failed, when they are absent — but under the default access rules
// (requireVerification) a fresh account cannot chat until an admin verifies
// it, so without admin credentials the script stops after the walls. The
// reply section expects the server to run with LOPU_CHAT_PROVIDER=test
// (deterministic tool script, synthetic usage); against any other provider
// the tool- and price-specific checks are reported as skipped.
//
// Section K ("your own providers", design note §1.3) always checks the vault
// status + redacted vaultProviders on GET /api/v1/ai/models and that a
// providerId that is not yours fails cleanly. When the server reports the
// vault as configured (THINGTIME_USER_VAULT_KEY set on the server) it also
// saves a compatible provider pointing at a local fake endpoint and runs a
// turn through it. Because vault endpoints must be public HTTPS hosts, the
// fake is reached through the dev-only rewrite table — start the server with
//
//   THINGTIME_USER_VAULT_KEY=<32-byte base64url>
//   THINGTIME_LOPU_PROVIDER_DEV_REWRITES=https://lopu-fake-provider.invalid=http://127.0.0.1:18170
//
// (TT_VERIFY_FAKE_PROVIDER_PORT overrides 18170 on both sides). Without the
// rewrite the connection is listed as unavailable and the turn must still
// fail cleanly (error event + canned line), which is checked instead.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:18162';
const ADMIN_USERNAME = process.env.TT_VERIFY_ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.TT_VERIFY_ADMIN_PASSWORD || '';
const FAKE_PROVIDER_ORIGIN = 'https://lopu-fake-provider.invalid';
const FAKE_PROVIDER_PORT = Number(process.env.TT_VERIFY_FAKE_PROVIDER_PORT || 18170);
const FAKE_PROVIDER_REPLY = 'Hello from your own provider 🦄';

// A stand-in for the user's OpenAI-compatible endpoint: refuses streaming
// (like the local Codex proxy, so the plain-completion rung serves it),
// answers 401 for the "broken-model" connection, and otherwise returns one
// canned completion. Records every request's bearer token + model.
const startFakeProvider = () =>
  new Promise((resolve) => {
    const requests = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = null;
      }
      requests.push({ path: request.url, authorization: request.headers.authorization || null, body });
      const send = (status, payload) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      if (request.method !== 'POST' || !String(request.url).endsWith('/chat/completions')) return send(404, { error: { message: 'unexpected route' } });
      if (body?.stream === true) return send(400, { error: true, statusCode: 400, message: 'Streaming is not implemented by this fake provider' });
      if (body?.model === 'broken-model') return send(401, { error: { message: 'invalid api key', type: 'invalid_request_error' } });
      return send(200, {
        id: 'chatcmpl_verify',
        object: 'chat.completion',
        created: 1,
        model: body?.model || 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: FAKE_PROVIDER_REPLY }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 6 }
      });
    });
    server.on('error', (error) => resolve({ ok: false, error: error?.message || String(error), requests, close: () => {} }));
    server.listen(FAKE_PROVIDER_PORT, '127.0.0.1', () => resolve({ ok: true, port: FAKE_PROVIDER_PORT, requests, close: () => server.close() }));
  });

let passed = 0;
let skipped = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const skip = (name, reason) => {
  skipped += 1;
  console.log(`  - ${name} (skipped: ${reason})`);
};

const api = async (path, { cookie, method = 'GET', body, headers = {}, raw = false } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(raw ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {})
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON — callers assert on status
  }
  return { status: response.status, body: json, headers: response.headers };
};

// crypto-random suffix: throwaway fixture accounts, still unguessable ids
const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

const cookieOf = (response) => {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = /tt_auth=[^;]+/.exec(setCookie);
  return match ? match[0] : null;
};

const register = async (name) => {
  const username = `${name}${suffix}`;
  const response = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Verify1234!pass', email: `${username}@example.com` })
  });
  const cookie = cookieOf(response);
  const body = await response.json();
  if (!response.ok || !cookie) throw new Error(`registration failed for ${username}: ${JSON.stringify(body)}`);
  return { username, id: body.user.id, cookie };
};

const login = async (username, password) => {
  const response = await fetch(`${BASE}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const cookie = cookieOf(response);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // ignore
  }
  if (!response.ok || !cookie) return null;
  return { username, id: body?.user?.id, cookie };
};

// POST /api/v1/lopu/chats/reply and collect the NDJSON events in order.
const reply = async (cookie, body) => {
  const response = await fetch(`${BASE}/api/v1/lopu/chats/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('application/x-ndjson')) {
    let json = null;
    try {
      json = await response.json();
    } catch {
      // ignore
    }
    return { status: response.status, contentType, events: [], body: json, invalidLines: 0 };
  }
  const events = [];
  let invalidLines = 0;
  let buffer = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const take = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      invalidLines += 1;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) take(buffer);
  return { status: response.status, contentType, events, body: null, invalidLines };
};

const summarize = () => {
  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length) {
    console.log('Failures:');
    for (const name of failures) console.log(`  - ${name}`);
    process.exitCode = 1;
  }
};

const BILLINGS = ['thingtime', 'byo', 'free'];

const eventsOf = (events, type) => events.filter((event) => event?.type === type);
const deltaText = (events) => eventsOf(events, 'delta').map((event) => event.text).join('');
const requestId = (label) => `verify-${label}-${suffix}-${randomBytes(3).toString('hex')}`;

const run = async () => {
  console.log(`Lopu verification against ${BASE}\n`);

  console.log('A. registration + auth walls');
  const user = await register('vl-user-');
  const other = await register('vl-other-');
  check('two users registered through the real path', !!(user.id && other.id));
  const wallList = await api('/api/v1/lopu/chats');
  check('GET /lopu/chats without auth is 401', wallList.status === 401);
  const wallReply = await api('/api/v1/lopu/chats/reply', { method: 'POST', body: { text: 'hi', requestId: requestId('anon') } });
  check('POST /lopu/chats/reply without auth is 401', wallReply.status === 401);
  const wallDocs = await api('/api/v1/lopu/chats-docs');
  check('lopu chats docs endpoint is public and shaped', wallDocs.status === 200 && wallDocs.body?.docs?.endpoint === '/api/v1/lopu/chats');
  const replyDocs = await api('/api/v1/lopu/chats/reply-docs');
  check('reply docs endpoint is public and shaped', replyDocs.status === 200 && replyDocs.body?.docs?.endpoint === '/api/v1/lopu/chats/reply');
  const formPost = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', raw: true, body: 'title=forged', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  check('form-encoded POST is refused (415 CSRF fence)', formPost.status === 415);
  // every Lopu POST applies the JSON-only fence before the body is read or a
  // rate-limit bucket is spent — the reply and voice streams and the vault too
  const formReply = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', raw: true, body: 'text=hi', headers: { 'Content-Type': 'text/plain' } });
  check('a non-JSON reply body is refused (415)', formReply.status === 415);
  const vaultAnon = await api('/api/v1/lopu/vault');
  check('GET /lopu/vault without auth is 401', vaultAnon.status === 401);
  const vaultForm = await api('/api/v1/lopu/vault', { cookie: user.cookie, method: 'POST', raw: true, body: 'action=delete', headers: { 'Content-Type': 'text/plain' } });
  check('a non-JSON vault write is refused (415)', vaultForm.status === 415);
  const voiceAnon = await api('/api/v1/lopu/voice/reply', { method: 'POST', body: { transcript: 'hi', transcribeMode: true } });
  check('POST /lopu/voice/reply without auth is 401', voiceAnon.status === 401);
  const voiceForm = await api('/api/v1/lopu/voice/reply', { cookie: user.cookie, method: 'POST', raw: true, body: 'transcript=hi', headers: { 'Content-Type': 'text/plain' } });
  check('a non-JSON voice body is refused (415)', voiceForm.status === 415);
  // direct voice (design note §6.1): the credential mint sits behind the same walls
  const sessionAnon = await api('/api/v1/lopu/voice/session', { method: 'POST', body: { providerId: 'prov-does-not-exist-000' } });
  check('POST /lopu/voice/session without auth is 401', sessionAnon.status === 401 && sessionAnon.body?.ok === false && !('session' in (sessionAnon.body || {})));
  const sessionForm = await api('/api/v1/lopu/voice/session', { cookie: user.cookie, method: 'POST', raw: true, body: 'providerId=x', headers: { 'Content-Type': 'text/plain' } });
  check('a non-JSON voice session body is refused (415)', sessionForm.status === 415);
  const sessionDocs = await api('/api/v1/lopu/voice/session-docs');
  check('voice session docs endpoint is public and shaped', sessionDocs.status === 200 && sessionDocs.body?.docs?.endpoint === '/api/v1/lopu/voice/session');

  console.log('\nA2. verified access + credits (design note "Lopu verified access, usage accounting and credits")');
  // the walls: public rules, session-only account routes, JSON-only writes, admin-only admin routes
  const accessRules = await api('/api/v1/settings/lopu-access');
  const rules = accessRules.body?.settings || null;
  check('GET /settings/lopu-access is public and shaped', accessRules.status === 200 && accessRules.body?.ok === true && accessRules.body?.key === 'Thingtime.LopuAccess' && !!rules && typeof rules.requireVerification === 'boolean' && typeof rules.allowByoUnverified === 'boolean' && typeof rules.starterCredits === 'number' && typeof rules.lowBalanceWarningCredits === 'number');
  check('the access rules response is not cached', (accessRules.headers.get('cache-control') || '').includes('no-store'));
  const accountAnon = await api('/api/v1/lopu/account');
  check('GET /lopu/account without auth is 401', accountAnon.status === 401 && !('account' in (accountAnon.body || {})));
  const historyAnon = await api('/api/v1/lopu/account/history');
  check('GET /lopu/account/history without auth is 401', historyAnon.status === 401);
  const topupAnon = await api('/api/v1/lopu/account/topup-request', { method: 'POST', body: { credits: 1 } });
  check('POST /lopu/account/topup-request without auth is 401', topupAnon.status === 401);
  const topupForm = await api('/api/v1/lopu/account/topup-request', { cookie: user.cookie, method: 'POST', raw: true, body: 'credits=1', headers: { 'Content-Type': 'text/plain' } });
  check('a non-JSON top-up request is refused (415)', topupForm.status === 415);
  const accountDocs = await api('/api/v1/lopu/account-docs');
  check('account docs endpoint is public and shaped', accountDocs.status === 200 && accountDocs.body?.docs?.endpoint === '/api/v1/lopu/account');
  const plainVerify = await api('/api/v1/admin/users/lopu-access', { cookie: user.cookie, method: 'POST', body: { userId: user.id, verified: true } });
  check('a plain user cannot verify Lopu access', plainVerify.status === 403 || plainVerify.status === 401);
  const plainAccounts = await api('/api/v1/admin/lopu/accounts', { cookie: user.cookie });
  check('a plain user cannot list Lopu accounts', (plainAccounts.status === 403 || plainAccounts.status === 401) && !('accounts' in (plainAccounts.body || {})));
  const plainCredits = await api('/api/v1/admin/lopu/credits', { cookie: user.cookie, method: 'POST', body: { userId: user.id, credits: 100 } });
  check('a plain user cannot grant credits', plainCredits.status === 403 || plainCredits.status === 401);
  const plainRules = await api('/api/v1/settings/lopu-access', { cookie: user.cookie, method: 'POST', body: { requireVerification: false } });
  check('a plain user cannot change the access rules', plainRules.status === 403 || plainRules.status === 401);

  // the account is created lazily on the first read, unverified
  const account0 = await api('/api/v1/lopu/account', { cookie: user.cookie });
  const acct0 = account0.body?.account || null;
  check('GET /lopu/account creates the account lazily with the public shape', account0.status === 200 && account0.body?.ok === true && !!acct0 && acct0.userId === user.id && typeof acct0.verified === 'boolean' && typeof acct0.requireVerification === 'boolean' && typeof acct0.allowByoUnverified === 'boolean' && Number.isSafeInteger(acct0.balanceMicros) && typeof acct0.balanceCredits === 'number' && typeof acct0.lowBalance === 'boolean' && /^\d{4}-\d{2}$/.test(acct0.month?.key || '') && Number.isSafeInteger(acct0.month?.turns) && Number.isSafeInteger(acct0.lifetime?.turns) && typeof acct0.starterCredits === 'number' && acct0.starterGranted === true && 'topupUrl' in acct0 && 'pendingRequest' in acct0, JSON.stringify(account0.body));
  check('the account response is not cached', (account0.headers.get('cache-control') || '').includes('no-store'));
  check('a fresh account is not verified', acct0?.verified === false);
  const starterMicros = Math.round((rules?.starterCredits ?? 0) * 1_000_000);
  check('the starter grant matches the rules', acct0?.balanceMicros === starterMicros);
  const requireVerification = acct0?.requireVerification === true;
  const admin = ADMIN_USERNAME && ADMIN_PASSWORD ? await login(ADMIN_USERNAME, ADMIN_PASSWORD) : null;

  if (requireVerification) {
    const lockedCreate = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: {} });
    check('an unverified account cannot start a conversation (403 LOPU_UNVERIFIED, Lopu-voiced copy)', lockedCreate.status === 403 && lockedCreate.body?.ok === false && lockedCreate.body?.code === 'LOPU_UNVERIFIED' && /invite-only/.test(String(lockedCreate.body?.error)), JSON.stringify(lockedCreate.body));
    const lockedReply = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { text: 'hi', requestId: requestId('locked') } });
    check('an unverified account cannot reply (403 LOPU_UNVERIFIED, nothing streamed)', lockedReply.status === 403 && lockedReply.body?.code === 'LOPU_UNVERIFIED');
    const lockedSession = await api('/api/v1/lopu/voice/session', { cookie: user.cookie, method: 'POST', body: { providerId: 'prov-does-not-exist-000' } });
    check('an unverified account cannot start a direct voice session (403 before the connection is checked)', lockedSession.status === 403 && lockedSession.body?.code === 'LOPU_UNVERIFIED');
    const lockedVoice = await api('/api/v1/lopu/voice/reply', { cookie: user.cookie, method: 'POST', body: { transcript: 'hi', sessionId: 'verify-voice', providerId: 'prov-does-not-exist-000' } });
    check('an unverified account cannot run a voice turn (403)', lockedVoice.status === 403 && lockedVoice.body?.code === 'LOPU_UNVERIFIED');
    const lockedList = await api('/api/v1/lopu/chats', { cookie: user.cookie });
    check('listing conversations is never gated', lockedList.status === 200 && lockedList.body?.ok === true);
    const lockedPersisted = await api('/api/v1/lopu/chats', { cookie: user.cookie });
    check('the refused turns persisted no conversation', lockedPersisted.body?.chats?.length === 0);
  } else {
    skip('the unverified walls (403 LOPU_UNVERIFIED)', 'the server does not require verification (Thingtime.LopuAccess.requireVerification=false)');
  }

  if (!admin) {
    skip('verified access + credits (admin verifies, grants, approves)', ADMIN_USERNAME ? 'admin login failed' : 'set TT_VERIFY_ADMIN_USERNAME + TT_VERIFY_ADMIN_PASSWORD');
    if (requireVerification) {
      skip('every later section', 'under requireVerification a fresh account cannot chat until an admin verifies it — provide the admin credentials');
      summarize();
      return;
    }
  } else {
    // the admin verifies both throwaway accounts: the rest of the script
    // chats as `user`, and `other` exercises the "another user" walls, which
    // must be permission walls rather than the verification wall
    const verified = await api('/api/v1/admin/users/lopu-access', { cookie: admin.cookie, method: 'POST', body: { userId: user.id, verified: true } });
    check('admin verifies the account (the admin row carries lopuVerified)', verified.status === 200 && verified.body?.ok === true && verified.body?.user?.id === user.id && verified.body.user.lopuVerified === true, JSON.stringify(verified.body));
    const verifiedOther = await api('/api/v1/admin/users/lopu-access', { cookie: admin.cookie, method: 'POST', body: { userId: other.id, verified: true } });
    check('admin verifies the second account', verifiedOther.status === 200 && verifiedOther.body?.user?.lopuVerified === true);
    const badVerify = await api('/api/v1/admin/users/lopu-access', { cookie: admin.cookie, method: 'POST', body: { userId: user.id, verified: 'yes' } });
    check('a non-boolean verified is a 400', badVerify.status === 400);
    const unknownVerify = await api('/api/v1/admin/users/lopu-access', { cookie: admin.cookie, method: 'POST', body: { userId: 'does-not-exist', verified: true } });
    check('verifying an unknown user is a 404', unknownVerify.status === 404);
    const formVerify = await api('/api/v1/admin/users/lopu-access', { cookie: admin.cookie, method: 'POST', raw: true, body: 'userId=x', headers: { 'Content-Type': 'text/plain' } });
    check('a non-JSON verify is refused (415)', formVerify.status === 415);
    const account1 = await api('/api/v1/lopu/account', { cookie: user.cookie });
    check('the account now reads verified', account1.body?.account?.verified === true);
    const rootData = await api('/api/root-data', { cookie: user.cookie });
    check('the self profile carries lopuVerified', rootData.status === 200 && rootData.body?.user?.lopuVerified === true, JSON.stringify(rootData.body?.user?.lopuVerified));

    // credits: with an empty balance a thingtime turn is a 402
    const balance0 = account1.body?.account?.balanceMicros ?? 0;
    if (balance0 <= 0) {
      const broke = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { text: 'hi', requestId: requestId('broke') } });
      check('with no credits a reply is a 402 LOPU_NO_CREDITS carrying the balance', broke.status === 402 && broke.body?.ok === false && broke.body?.code === 'LOPU_NO_CREDITS' && broke.body?.balanceMicros === balance0 && /credits/.test(String(broke.body?.error)), JSON.stringify(broke.body));
      const brokeCreate = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: {} });
      check('with no credits a conversation cannot be started either (402)', brokeCreate.status === 402 && brokeCreate.body?.code === 'LOPU_NO_CREDITS');
    } else {
      skip('402 with no credits', `the account already holds ${balance0} micros (starterCredits=${rules?.starterCredits})`);
    }

    // the admin grants 2 credits
    const granted = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { userId: user.id, credits: 2, reason: 'verify-lopu grant' } });
    check('admin grants 2 credits (account row + ledger row echoed)', granted.status === 200 && granted.body?.ok === true && granted.body?.account?.user?.id === user.id && granted.body.account.balanceMicros === balance0 + 2_000_000 && granted.body?.ledger?.entry === 'grant' && granted.body.ledger.amountMicros === 2_000_000 && granted.body?.request === null, JSON.stringify(granted.body));
    check('the admin credits response is private', /no-store/.test(granted.headers.get('cache-control') || ''));
    const zeroGrant = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { userId: user.id, credits: 0 } });
    check('a zero grant is a 400', zeroGrant.status === 400);
    const negativeGrant = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { userId: user.id, credits: -1, entry: 'grant' } });
    check('a negative grant is a 400 (adjust / refund carry signs)', negativeGrant.status === 400);
    const unknownGrant = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { userId: 'does-not-exist', credits: 1 } });
    check('granting an unknown user is a 404', unknownGrant.status === 404);

    // a priced turn: the test provider reports 100 in / 50 out per hop
    // against test-model → 0.2 credits for this one-hop greeting
    const balanceBefore = balance0 + 2_000_000;
    const paidRequest = requestId('paid');
    const paid = await reply(user.cookie, { text: 'Hello Lopu, are credits working?', requestId: paidRequest });
    const paidMeta = paid.events[0];
    const paidDone = paid.events[paid.events.length - 1];
    const paidChatId = paidMeta?.chatId || null;
    check('with credits the reply streams and meta carries billing', paid.status === 200 && paidMeta?.type === 'meta' && BILLINGS.includes(paidMeta.billing), `status ${paid.status} ${JSON.stringify(paid.body || paidMeta)}`);
    check('done carries billing, costMicros, priced and balanceMicros', paidDone?.type === 'done' && BILLINGS.includes(paidDone.billing) && Number.isSafeInteger(paidDone.costMicros) && typeof paidDone.priced === 'boolean' && (paidDone.balanceMicros === null || Number.isSafeInteger(paidDone.balanceMicros)), JSON.stringify(paidDone));
    const testBilled = paidMeta?.provider === 'test';
    if (testBilled) {
      check('the test provider turn bills credits, priced against test-model (0.2 credits per hop)', paidMeta.billing === 'thingtime' && paidDone?.billing === 'thingtime' && paidDone?.priced === true && paidDone?.costMicros === 200_000 && paidDone?.usage?.inputTokens === 100 && paidDone?.usage?.outputTokens === 50, JSON.stringify({ meta: paidMeta, done: paidDone }));
      check('the balance decreased by the priced amount', paidDone?.balanceMicros === balanceBefore - 200_000, `${paidDone?.balanceMicros} vs ${balanceBefore - 200_000}`);
    } else {
      skip('the test-model price of the turn', `provider=${paidMeta?.provider} — run the server with LOPU_CHAT_PROVIDER=test`);
    }
    check('the persisted turn carries billing and costMicros', paidDone?.messages?.[0]?.lopu?.billing === paidDone?.billing && paidDone?.messages?.[0]?.lopu?.costMicros === paidDone?.costMicros && paidDone?.messages?.[0]?.lopu?.balanceMicros === paidDone?.balanceMicros, JSON.stringify(paidDone?.messages?.[0]?.lopu));
    const account2 = await api('/api/v1/lopu/account', { cookie: user.cookie });
    check('GET /lopu/account reflects the turn', account2.body?.account?.balanceMicros === paidDone?.balanceMicros && account2.body.account.lifetime.turns >= 1 && account2.body.account.month.turns >= 1 && account2.body.account.lifetime.inputTokens >= (paidDone?.usage?.inputTokens || 0), JSON.stringify(account2.body?.account));
    const history = await api('/api/v1/lopu/account/history?limit=10', { cookie: user.cookie });
    const entries = Array.isArray(history.body?.entries) ? history.body.entries : [];
    check('history lists the ledger newest first with the usage rows', history.status === 200 && history.body?.ok === true && entries.length >= 1 && entries.some((row) => row.entry === 'grant' && row.amountMicros === 2_000_000) && Array.isArray(history.body?.usage) && ('nextCursor' in history.body), JSON.stringify(history.body));
    if (testBilled) {
      const debit = entries.find((row) => row.entry === 'debit');
      const usageRow = history.body?.usage?.find((row) => row.id === debit?.usageId);
      check('the debit row links the usage row (chat, test provider, 100/50 tokens, priced, debited)', entries[0]?.entry === 'debit' && !!debit && debit.amountMicros === -200_000 && debit.balanceAfterMicros === paidDone?.balanceMicros && !!usageRow && usageRow.surface === 'chat' && usageRow.requestId === paidRequest && usageRow.chatId === paidChatId && usageRow.provider === 'test' && usageRow.inputTokens === 100 && usageRow.outputTokens === 50 && usageRow.costMicros === 200_000 && usageRow.debitedMicros === 200_000 && usageRow.billing === 'thingtime' && usageRow.priced === true && usageRow.hops === 1, JSON.stringify({ debit, usageRow }));
    }
    const badCursor = await api('/api/v1/lopu/account/history?cursor=junk', { cookie: user.cookie });
    check('a bad history cursor is a 400', badCursor.status === 400);
    const otherHistory = await api('/api/v1/lopu/account/history', { cookie: other.cookie });
    check('another user’s history is their own', otherHistory.status === 200 && Array.isArray(otherHistory.body?.entries) && !otherHistory.body.entries.some((row) => entries.some((mine) => mine.id === row.id)));

    // a top-up request → pending → approved; one pending at a time
    const badTopup = await api('/api/v1/lopu/account/topup-request', { cookie: user.cookie, method: 'POST', body: { credits: 0.1 } });
    check('a too-small top-up request is a 400', badTopup.status === 400);
    const topup = await api('/api/v1/lopu/account/topup-request', { cookie: user.cookie, method: 'POST', body: { credits: 3, note: 'verify-lopu request' } });
    const requestRow = topup.body?.request || null;
    check('POST /lopu/account/topup-request creates a pending request', topup.status === 200 && topup.body?.ok === true && !!requestRow && requestRow.entry === 'request' && requestRow.requestStatus === 'pending' && requestRow.amountMicros === 3_000_000 && requestRow.amountCredits === 3 && requestRow.note === 'verify-lopu request' && requestRow.balanceAfterMicros === null, JSON.stringify(topup.body));
    const secondTopup = await api('/api/v1/lopu/account/topup-request', { cookie: user.cookie, method: 'POST', body: { credits: 1 } });
    check('a second request while one is pending is a 409', secondTopup.status === 409);
    const account3 = await api('/api/v1/lopu/account', { cookie: user.cookie });
    check('the account shows the pending request', !!requestRow && account3.body?.account?.pendingRequest?.id === requestRow.id);
    const adminSearch = await api(`/api/v1/admin/lopu/accounts?q=${encodeURIComponent(user.username)}`, { cookie: admin.cookie });
    const adminRow = adminSearch.body?.accounts?.find((row) => row.user?.id === user.id) || null;
    check('the admin directory finds the user with balance, verification and the pending request', adminSearch.status === 200 && adminSearch.body?.ok === true && !!adminRow && adminRow.user.username === user.username && adminRow.user.lopuVerified === true && adminRow.hasAccount === true && typeof adminRow.accountId === 'string' && adminRow.balanceMicros === account3.body?.account?.balanceMicros && adminRow.pendingRequest?.id === requestRow?.id && typeof adminRow.lifetime?.turns === 'number' && !!adminSearch.body?.settings && typeof adminSearch.body.settings.requireVerification === 'boolean', JSON.stringify(adminSearch.body));
    check('the admin directory is private', /no-store/.test(adminSearch.headers.get('cache-control') || ''));
    const adminPage = await api('/api/v1/admin/lopu/accounts?limit=2', { cookie: admin.cookie });
    check('the admin directory pages newest first', adminPage.status === 200 && Array.isArray(adminPage.body?.accounts) && adminPage.body.accounts.length <= 2 && 'nextCursor' in adminPage.body && adminPage.body.accounts.every((row) => typeof row.user?.id === 'string' && typeof row.balanceMicros === 'number'));
    if (adminPage.body?.nextCursor) {
      const adminPage2 = await api(`/api/v1/admin/lopu/accounts?limit=2&cursor=${encodeURIComponent(adminPage.body.nextCursor)}`, { cookie: admin.cookie });
      check('the next directory page continues past the cursor', adminPage2.status === 200 && Array.isArray(adminPage2.body?.accounts) && !adminPage2.body.accounts.some((row) => adminPage.body.accounts.some((first) => first.user.id === row.user.id)));
    }
    const approved = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { requestId: requestRow?.id, reason: 'verify-lopu approve' } });
    const balanceBeforeApprove = account3.body?.account?.balanceMicros ?? 0;
    check('admin approves the request (topup ledger row linked, balance up, request approved)', approved.status === 200 && approved.body?.ok === true && approved.body?.request?.id === requestRow?.id && approved.body.request.requestStatus === 'approved' && approved.body.request.grantedMicros === 3_000_000 && approved.body?.ledger?.entry === 'topup' && approved.body.ledger.amountMicros === 3_000_000 && approved.body.ledger.requestId === requestRow?.id && approved.body?.account?.balanceMicros === balanceBeforeApprove + 3_000_000 && approved.body.account.pendingRequest === null, JSON.stringify(approved.body));
    const approveAgain = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { requestId: requestRow?.id } });
    check('approving twice is a 409', approveAgain.status === 409);
    const account4 = await api('/api/v1/lopu/account', { cookie: user.cookie });
    check('the pending request is cleared and the balance moved', account4.body?.account?.pendingRequest === null && account4.body?.account?.balanceMicros === balanceBeforeApprove + 3_000_000);
    const afterApprove = await api('/api/v1/lopu/account/topup-request', { cookie: user.cookie, method: 'POST', body: { credits: 1 } });
    check('a fresh request is possible once the last one is resolved', afterApprove.status === 200 && afterApprove.body?.request?.requestStatus === 'pending');
    const declined = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { requestId: afterApprove.body?.request?.id, decline: true, reason: 'not now' } });
    check('admin declines a request (no balance change, no ledger row)', declined.status === 200 && declined.body?.request?.requestStatus === 'declined' && declined.body?.ledger === null && declined.body?.account?.balanceMicros === balanceBeforeApprove + 3_000_000, JSON.stringify(declined.body));
    const history2 = await api('/api/v1/lopu/account/history?limit=2', { cookie: user.cookie });
    check('history pages with a cursor (request, topup, …)', history2.status === 200 && history2.body?.entries?.length === 2 && history2.body.entries[0].entry === 'request' && history2.body.entries[0].requestStatus === 'declined' && typeof history2.body.nextCursor === 'string', JSON.stringify(history2.body?.entries));
    if (history2.body?.nextCursor) {
      const history3 = await api(`/api/v1/lopu/account/history?limit=2&cursor=${encodeURIComponent(history2.body.nextCursor)}`, { cookie: user.cookie });
      check('the next history page continues past the cursor', history3.status === 200 && Array.isArray(history3.body?.entries) && history3.body.entries.length >= 1 && !history3.body.entries.some((row) => history2.body.entries.some((first) => first.id === row.id)));
    }

    // the access rules round-trip (a partial save keeps the other fields)
    const setRules = await api('/api/v1/settings/lopu-access', { cookie: admin.cookie, method: 'POST', body: { lowBalanceWarningCredits: 2.5 } });
    check('admin patches the access rules (partial save keeps the rest)', setRules.status === 200 && setRules.body?.ok === true && setRules.body?.settings?.lowBalanceWarningCredits === 2.5 && setRules.body.settings.requireVerification === rules?.requireVerification && setRules.body.settings.starterCredits === rules?.starterCredits, JSON.stringify(setRules.body));
    const readRules = await api('/api/v1/settings/lopu-access');
    check('the saved rules read back publicly and at once', readRules.body?.settings?.lowBalanceWarningCredits === 2.5);
    const accountRules = await api('/api/v1/lopu/account', { cookie: user.cookie });
    check('the account read reflects the new threshold', accountRules.body?.account?.lowBalanceWarningCredits === 2.5);
    const badRules = await api('/api/v1/settings/lopu-access', { cookie: admin.cookie, method: 'POST', body: { starterCredits: -1 } });
    check('a bad access setting is a 400', badRules.status === 400);
    const formRules = await api('/api/v1/settings/lopu-access', { cookie: admin.cookie, method: 'POST', raw: true, body: 'starterCredits=1', headers: { 'Content-Type': 'text/plain' } });
    check('a non-JSON rules save is refused (415)', formRules.status === 415);
    const restoreRules = await api('/api/v1/settings/lopu-access', { cookie: admin.cookie, method: 'POST', body: rules });
    check('the previous rules are restored', restoreRules.status === 200 && restoreRules.body?.settings?.lowBalanceWarningCredits === rules?.lowBalanceWarningCredits);

    // the generic things paths never reach the accounting kinds
    const forgeLedger = await api('/api/v1/things', { cookie: user.cookie, method: 'POST', body: { thingtime: ['lopu-credit'], crystal: { entry: 'grant', amountMicros: 999_999_999, balanceAfterMicros: 999_999_999, reason: 'forged', actorId: user.id } } });
    check('generic /things cannot mint a ledger row (protected kind)', forgeLedger.status === 403 || forgeLedger.status === 400, `status ${forgeLedger.status}`);
    const forgeAccount = await api('/api/v1/things', { cookie: user.cookie, method: 'POST', body: { thingtime: ['lopu-account'], crystal: { balanceMicros: 999_999_999 } } });
    check('generic /things cannot mint an account (protected kind)', forgeAccount.status === 403 || forgeAccount.status === 400);
    const forgeUsage = await api('/api/v1/things', { cookie: user.cookie, method: 'POST', body: { thingtime: ['lopu-usage'], crystal: { surface: 'chat', billing: 'free', costMicros: 0 } } });
    check('generic /things cannot mint a usage row (protected kind)', forgeUsage.status === 403 || forgeUsage.status === 400);
    const accountRowId = adminRow?.accountId || null;
    if (accountRowId) {
      const otherPeek = await api(`/api/v1/things?id=${accountRowId}`, { cookie: other.cookie });
      check('another user cannot read the account through generic /things', otherPeek.status === 403 || otherPeek.status === 404, `status ${otherPeek.status}`);
      const ownerPatch = await api('/api/v1/things', { cookie: user.cookie, method: 'PATCH', body: { id: accountRowId, crystal: { balanceMicros: 999_999_999 } } });
      check('the owner cannot edit the account through generic /things', ownerPatch.status === 403 || ownerPatch.status === 400 || ownerPatch.status === 404 || ownerPatch.status === 405, `status ${ownerPatch.status}`);
      const ownerDelete = await api('/api/v1/things', { cookie: user.cookie, method: 'DELETE', body: { id: accountRowId } });
      check('the owner cannot delete the account through generic /things', ownerDelete.status === 403 || ownerDelete.status === 400 || ownerDelete.status === 404 || ownerDelete.status === 405, `status ${ownerDelete.status}`);
      const untouched = await api('/api/v1/lopu/account', { cookie: user.cookie });
      check('the balance is untouched by the refused generic writes', untouched.body?.account?.balanceMicros === balanceBeforeApprove + 3_000_000);
    }

    // a run budget so every later section can chat, and the fixture chat goes
    const runBudget = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { userId: user.id, credits: 100, entry: 'topup', reason: 'verify-lopu run budget' } });
    check('admin tops up the run budget', runBudget.status === 200 && runBudget.body?.ledger?.entry === 'topup');
    const otherBudget = await api('/api/v1/admin/lopu/credits', { cookie: admin.cookie, method: 'POST', body: { userId: other.id, credits: 5, reason: 'verify-lopu other budget' } });
    check('the second account gets a budget too', otherBudget.status === 200 && otherBudget.body?.account?.balanceMicros === 5_000_000);
    if (paidChatId) await api('/api/v1/lopu/chats/delete', { cookie: user.cookie, method: 'POST', body: { chatId: paidChatId } });
    const cleaned = await api('/api/v1/lopu/chats', { cookie: user.cookie });
    check('the section’s conversation is cleaned up', cleaned.body?.chats?.length === 0);
  }

  console.log('\nB. model catalog');
  const models = await api('/api/v1/ai/models');
  const modelRows = Array.isArray(models.body?.models) ? models.body.models : [];
  check('GET /ai/models is public and 200', models.status === 200 && models.body?.ok === true);
  check('catalog lists models with the public shape', modelRows.length > 0 && modelRows.every((row) => typeof row.id === 'string' && typeof row.label === 'string' && ['anthropic', 'openai'].includes(row.provider) && Array.isArray(row.efforts) && Array.isArray(row.speeds) && typeof row.family === 'string' && typeof row.enabled === 'boolean' && typeof row.available === 'boolean' && typeof row.isDefault === 'boolean'));
  check('catalog carries provider status + defaults', models.body?.providers && typeof models.body.providers.anthropic?.configured === 'boolean' && typeof models.body.providers.openai?.configured === 'boolean' && models.body?.defaults && 'model' in models.body.defaults);
  // keys are verified, not merely detected: providers.<p> carries the bounded
  // probe's verdict and every model mirrors its provider (design note §1.1)
  const providerStatusOk = (entry) => !!entry && typeof entry.configured === 'boolean' && (entry.verified === null || typeof entry.verified === 'boolean') && (entry.checkedAt === null || typeof entry.checkedAt === 'string') && (entry.configured || entry.verified === null) && (entry.reason === undefined || typeof entry.reason === 'string');
  check('providers carry the key probe verdict (configured / verified / checkedAt)', providerStatusOk(models.body?.providers?.anthropic) && providerStatusOk(models.body?.providers?.openai));
  check('a configured provider has been probed (checkedAt set), an unconfigured one never is', ['anthropic', 'openai'].every((provider) => (models.body?.providers?.[provider]?.configured ? typeof models.body.providers[provider].checkedAt === 'string' : models.body?.providers?.[provider]?.checkedAt === null)));
  check('every model mirrors its provider verdict and a rejected key hides its models', modelRows.every((row) => row.verified === (models.body?.providers?.[row.provider]?.verified ?? null) && (!row.available || row.verified !== false)));
  check('the catalog response is not cached', (models.headers.get('cache-control') || '').includes('no-store'));
  // the viewer's Secure Vault providers ride on the same response as metadata
  // only (id/name/kind/model/endpointHost/available/reason — never a key)
  const vaultOnServer = 'vaultProviders' in (models.body || {});
  if (!vaultOnServer) skip('anonymous catalog lists no vault providers', 'server predates vaultProviders on GET /ai/models');
  else {
    check('anonymous catalog lists no vault providers', Array.isArray(models.body.vaultProviders) && models.body.vaultProviders.length === 0 && typeof models.body.vault?.configured === 'boolean');
  }
  const availableModel = modelRows.find((row) => row.available) || null;
  const defaultModel = models.body?.defaults?.model || null;
  check('defaults.model is null or an available catalog model', defaultModel === null || modelRows.some((row) => row.id === defaultModel && row.available));
  check('isDefault marks exactly the defaults.model row', modelRows.filter((row) => row.isDefault).map((row) => row.id).join(',') === (defaultModel || ''));
  const noStore = await api('/api/v1/ai/models', { cookie: user.cookie });
  check('the same list serves a signed-in viewer', noStore.status === 200 && noStore.body?.models?.length === modelRows.length);
  if (vaultOnServer) {
    const vaultRows = Array.isArray(noStore.body?.vaultProviders) ? noStore.body.vaultProviders : null;
    check('a signed-in viewer gets their vault providers as metadata only', !!vaultRows && vaultRows.every((row) => typeof row.id === 'string' && typeof row.name === 'string' && typeof row.available === 'boolean' && !('key' in row) && !('value' in row) && !('secret' in row) && !('apiKey' in row)));
    const otherVault = await api('/api/v1/ai/models', { cookie: other.cookie });
    check('vault providers are per viewer', Array.isArray(otherVault.body?.vaultProviders) && !otherVault.body.vaultProviders.some((row) => vaultRows?.some((mine) => mine.id === row.id)));
  }

  console.log('\nC. conversations');
  const created = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: {} });
  const chat = created.body?.chat;
  check('POST /lopu/chats creates a one-member Lopu chat', created.status === 200 && created.body?.ok === true && chat?.id && chat?.memberCount === 1 && chat?.name === 'Lopu');
  check('the chat is discriminated by externalSource.access === lopu', chat?.externalSource?.access === 'lopu' && chat?.externalSource?.provider === 'lopu' && chat?.externalSource?.readOnly === false);
  check('the viewer is the owner member', chat?.myMember?.role === 'owner' && chat?.myMember?.state === 'active');
  const chatId = chat?.id;
  const titled = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: { title: 'Titled chat', ...(availableModel ? { model: availableModel.id, effort: availableModel.efforts?.[0] } : {}) } });
  check('a titled chat keeps its title (+ model settings when given)', titled.status === 200 && titled.body?.chat?.name === 'Titled chat');
  const titledId = titled.body?.chat?.id;
  const badModel = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: { model: 'not-a-model' } });
  check('an unknown model is a 400', badModel.status === 400);
  const list = await api('/api/v1/lopu/chats', { cookie: user.cookie });
  check('GET /lopu/chats lists both chats for the owner', list.status === 200 && Array.isArray(list.body?.chats) && [chatId, titledId].every((id) => list.body.chats.some((entry) => entry.id === id)));
  const otherList = await api('/api/v1/lopu/chats', { cookie: other.cookie });
  check('another user sees none of them', otherList.status === 200 && !otherList.body?.chats?.some((entry) => entry.id === chatId || entry.id === titledId));
  const messengerList = await api('/api/v1/chats', { cookie: user.cookie });
  const messengerEntry = messengerList.body?.chats?.find((entry) => entry.id === chatId);
  check('the messenger chat list carries the Lopu chat with its source', messengerList.status === 200 && messengerEntry?.externalSource?.access === 'lopu');
  const otherPeek = await api(`/api/v1/chats/messages?chatId=${chatId}`, { cookie: other.cookie });
  check('another user cannot read the Lopu chat', otherPeek.status === 403 || otherPeek.status === 404);
  const addMember = await api('/api/v1/chats/members', { cookie: user.cookie, method: 'POST', body: { chatId, add: [other.id] } });
  check('members cannot be added to a Lopu chat', addMember.status === 400 || addMember.status === 403 || addMember.status === 409);

  console.log('\nD. the streamed reply (test provider builds a component + a page)');
  const firstRequest = requestId('build');
  const built = await reply(user.cookie, { chatId, text: 'Build me a page with a card component', requestId: firstRequest });
  check('reply streams NDJSON', built.status === 200 && built.contentType.includes('application/x-ndjson') && built.invalidLines === 0 && built.events.length > 0, `status ${built.status} ${built.contentType} ${JSON.stringify(built.body)}`);
  const meta = built.events[0];
  check('meta is the first event and names the chat + request', meta?.type === 'meta' && meta.chatId === chatId && meta.requestId === firstRequest && typeof meta.userMessageId === 'string' && typeof meta.label === 'string');
  const testProvider = meta?.provider === 'test';
  if (!testProvider) skip('provider is the scripted test provider', `provider=${meta?.provider} — run the server with LOPU_CHAT_PROVIDER=test for the tool checks`);
  else check('provider is the scripted test provider', true);
  check('assistant text streams as delta events', eventsOf(built.events, 'delta').length >= 3 && eventsOf(built.events, 'delta').every((event) => typeof event.text === 'string'));
  const done = built.events[built.events.length - 1];
  check('done is the last event with the persisted rows', done?.type === 'done' && typeof done.assistantMessageId === 'string' && done.assistantMessageId && Array.isArray(done.messages) && done.messages.length >= 1 && typeof done.stopReason === 'string');
  check('events are well-formed (every type is known)', built.events.every((event) => ['meta', 'delta', 'thinking', 'tool_use_start', 'tool_input_delta', 'tool_use', 'tool_result', 'patch', 'thing', 'navigate', 'confirm', 'error', 'done'].includes(event?.type)));

  let pageId = null;
  let componentId = null;
  let componentKey = null;
  if (testProvider) {
    const starts = eventsOf(built.events, 'tool_use_start');
    const uses = eventsOf(built.events, 'tool_use');
    const results = eventsOf(built.events, 'tool_result');
    check('create_component + create_page were requested', starts.some((event) => event.name === 'create_component') && starts.some((event) => event.name === 'create_page'));
    const componentInputDeltas = eventsOf(built.events, 'tool_input_delta').filter((event) => event.name === 'create_component');
    const pageInputDeltas = eventsOf(built.events, 'tool_input_delta').filter((event) => event.name === 'create_page');
    check('tool inputs stream in ≥ 6 partial chunks each', componentInputDeltas.length >= 6 && pageInputDeltas.length >= 6);
    const partialJoined = pageInputDeltas.map((event) => event.partial).join('');
    const pageUse = uses.find((event) => event.name === 'create_page');
    check('the joined partials equal the complete tool input', !!pageUse && partialJoined === JSON.stringify(pageUse.input));
    const componentResult = results.find((event) => event.name === 'create_component');
    const pageResult = results.find((event) => event.name === 'create_page');
    check('both tools succeeded', componentResult?.ok === true && pageResult?.ok === true, `${componentResult?.summary} / ${pageResult?.summary}`);
    const things = eventsOf(built.events, 'thing');
    const componentThing = things.find((event) => event.kind === 'component');
    const pageThing = things.find((event) => event.kind === 'webpage');
    check('thing events carry the created component and page', !!componentThing?.thing?.id && !!pageThing?.thing?.id);
    check('tool-scoped events share the tool call id', !!componentThing && componentThing.id === componentResult?.id && !!pageThing && pageThing.id === pageResult?.id);
    componentId = componentThing?.thing?.id || null;
    componentKey = componentThing?.thing?.crystal?.componentKey || null;
    pageId = pageThing?.thing?.id || pageResult?.data?.pageId || null;
    const navigateEvent = eventsOf(built.events, 'navigate')[0];
    check('create_page with open:true navigates to the builder', navigateEvent?.path === `/builder?page=${pageId}`);
    const order = built.events.map((event) => event.type);
    const firstResult = order.indexOf('tool_result');
    const firstThing = order.indexOf('thing');
    check('thing events land before their tool_result', firstThing >= 0 && firstResult > firstThing);
    check('tool_result precedes the follow-up text', order.lastIndexOf('tool_result') < order.lastIndexOf('delta'));
    check('done carries the tool calls in usage-bearing meta', done?.messages?.[0]?.lopu?.toolCalls?.length >= 2 && done.messages[0].lopu.toolCalls.every((call) => typeof call.name === 'string' && typeof call.ok === 'boolean' && typeof call.summary === 'string'));
  }

  const replay = await reply(user.cookie, { chatId, text: 'Build me a page with a card component', requestId: firstRequest });
  check('re-using a requestId is a 409', replay.status === 409);
  const tooLong = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId, text: 'x'.repeat(8001), requestId: requestId('long') } });
  check('an 8001-char message is a 400', tooLong.status === 400);
  const badContext = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId, text: 'hi', requestId: requestId('ctx'), context: { page: { blocks: 'nope' } } } });
  check('a malformed context is a 400', badContext.status === 400);
  const otherReply = await api('/api/v1/lopu/chats/reply', { cookie: other.cookie, method: 'POST', body: { chatId, text: 'hi', requestId: requestId('other') } });
  check('another user cannot reply into the chat', otherReply.status === 403 || otherReply.status === 404);

  const lazyRequest = requestId('lazy');
  const lazy = await reply(user.cookie, { text: 'Hello Lopu, what can you do?', requestId: lazyRequest });
  const lazyMeta = lazy.events[0];
  check('a reply without chatId creates the conversation', lazy.status === 200 && lazyMeta?.type === 'meta' && typeof lazyMeta.chatId === 'string' && lazyMeta.chatId !== chatId);
  const lazyList = await api('/api/v1/lopu/chats', { cookie: user.cookie });
  const lazyEntry = lazyList.body?.chats?.find((entry) => entry.id === lazyMeta?.chatId);
  check('the new conversation is titled from the first message', lazyEntry?.name === 'Hello Lopu, what can you do');
  check('the conversation preview is the assistant text', typeof lazyEntry?.lastMessage?.text === 'string' && lazyEntry.lastMessage.text.length > 0 && lazyEntry?.lastMessage?.externalSource?.access === 'lopu');
  check('the owner has nothing unread in their own conversation', lazyEntry?.unreadCount === 0);
  const lazyChatId = lazyMeta?.chatId || null;
  // a chat created without an effort inherits the admin default effort
  // (a stored null is "catalog default", never "the provider's own default")
  const defaultEffort = models.body?.defaults?.effort ?? null;
  if (!availableModel) skip('a chat without a stored effort inherits the admin default effort', 'no available model');
  else check('a chat without a stored effort inherits the admin default effort', typeof lazyMeta?.effort === 'string' && (!defaultEffort || !defaultModel || lazyMeta.model !== defaultModel || lazyMeta.effort === defaultEffort), JSON.stringify({ effort: lazyMeta?.effort, defaultEffort, model: lazyMeta?.model, defaultModel }));

  console.log('\nE. the built things');
  if (testProvider && pageId) {
    const resolved = await api(`/api/v1/webpages/resolve?id=${pageId}`, { cookie: user.cookie });
    const blocks = resolved.body?.page?.crystal?.blocks || [];
    check('the created page resolves for its owner as a user page', resolved.status === 200 && resolved.body?.ok === true && resolved.body?.source === 'user' && resolved.body?.page?.crystal?.name === 'Lopu test page');
    const section = blocks[0];
    const componentBlock = section?.children?.find((block) => block.type === 'component');
    check('the page holds the streamed section (heading, copy, component)', section?.type === 'container' && section?.children?.length === 3 && componentBlock?.component === componentKey);
    const componentThing = await api(`/api/v1/things?id=${componentId}`, { cookie: user.cookie });
    check('the component is the viewer’s own private thing', componentThing.status === 200 && componentThing.body?.thing?.author?.id === user.id && componentThing.body?.thing?.visibility === 'private' && componentThing.body?.thing?.crystal?.componentKey === componentKey);
    const otherComponent = await api(`/api/v1/things?id=${componentId}`, { cookie: other.cookie });
    check('the component is private to its owner by default', otherComponent.status === 403 || otherComponent.status === 404);
    const otherPage = await api(`/api/v1/webpages/resolve?id=${pageId}`, { cookie: other.cookie });
    check('the page is private to its owner by default', otherPage.status === 403 || otherPage.status === 404 || otherPage.body?.ok === false);
  } else {
    skip('created page resolves', 'no test-provider build to inspect');
  }

  console.log('\nF. messages through the messenger endpoint');
  const messages = await api(`/api/v1/chats/messages?chatId=${chatId}`, { cookie: user.cookie });
  const rows = Array.isArray(messages.body?.messages) ? messages.body.messages : [];
  check('GET /chats/messages lists the conversation', messages.status === 200 && rows.length >= 2);
  const userRow = rows.find((row) => row.text === 'Build me a page with a card component');
  const assistantRows = rows.filter((row) => row.externalSource?.access === 'lopu');
  check('the user turn is a plain owned row', !!userRow && userRow.authorId === user.id && !userRow.externalSource);
  check('assistant rows carry the read-only Lopu source', assistantRows.length >= 1 && assistantRows.every((row) => row.externalSource.readOnly === true && row.externalSource.role === 'assistant' && row.externalSource.authorName === 'Lopu'));
  check('assistant rows project the lopu meta (provider, toolCalls)', assistantRows.some((row) => row.lopu?.role === 'assistant' && typeof row.lopu.provider === 'string' && Array.isArray(row.lopu.toolCalls)));
  const assistantId = assistantRows[0]?.id;
  const editAssistant = await api('/api/v1/chats/messages/edit', { cookie: user.cookie, method: 'POST', body: { messageId: assistantId, id: assistantId, text: 'forged' } });
  check('assistant rows cannot be edited', editAssistant.status === 409 || editAssistant.status === 403 || editAssistant.status === 400);
  const deleteAssistant = await api('/api/v1/chats/messages/delete', { cookie: user.cookie, method: 'POST', body: { messageId: assistantId, id: assistantId } });
  check('assistant rows can be deleted by the owner', deleteAssistant.status === 200);
  const memberRow = (await api('/api/v1/lopu/chats', { cookie: user.cookie })).body?.chats?.find((entry) => entry.id === chatId);
  check('the chat list entry stays readable after a delete', !!memberRow && memberRow.unreadCount === 0);

  console.log('\nG. rename + settings');
  const renamed = await api('/api/v1/lopu/chats/update', { cookie: user.cookie, method: 'POST', body: { chatId, title: 'Renamed by verify' } });
  check('POST /lopu/chats/update renames the chat', renamed.status === 200 && renamed.body?.chat?.name === 'Renamed by verify');
  const otherRename = await api('/api/v1/lopu/chats/update', { cookie: other.cookie, method: 'POST', body: { chatId, title: 'hijacked' } });
  check('another user cannot rename it', otherRename.status === 403 || otherRename.status === 404);
  const badSettings = await api('/api/v1/lopu/chats/update', { cookie: user.cookie, method: 'POST', body: { chatId, model: 'not-a-model' } });
  check('an unknown model setting is a 400', badSettings.status === 400);
  // providerId (a Secure Vault provider) is a per-chat setting on create,
  // update and reply; an id the viewer does not own is refused
  if (vaultOnServer) {
    const badProvider = await api('/api/v1/lopu/chats/update', { cookie: user.cookie, method: 'POST', body: { chatId, providerId: 'not-a-provider' } });
    check('an unknown providerId on update is a 400', badProvider.status === 400);
    const badProviderCreate = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: { providerId: 'not-a-provider' } });
    check('an unknown providerId on create is a 400', badProviderCreate.status === 400);
    const badProviderReply = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId, text: 'hi', requestId: requestId('prov'), providerId: 'not-a-provider' } });
    check('an unknown providerId on reply is a 400', badProviderReply.status === 400);
    const clearProvider = await api('/api/v1/lopu/chats/update', { cookie: user.cookie, method: 'POST', body: { chatId, providerId: null } });
    check('providerId: null clears the chat provider (or is a no-op 400 when already clear)', clearProvider.status === 200 || clearProvider.status === 400);
    const afterClear = (await api('/api/v1/lopu/chats', { cookie: user.cookie })).body?.chats?.find((entry) => entry.id === chatId);
    check('the chat entry projects lopu.providerId', !!afterClear?.lopu && 'providerId' in afterClear.lopu && (afterClear.lopu.providerId === null || typeof afterClear.lopu.providerId === 'string'));
  } else {
    skip('providerId validation on create/update/reply', 'server predates vault providers');
  }
  if (availableModel) {
    const retuned = await api('/api/v1/lopu/chats/update', { cookie: user.cookie, method: 'POST', body: { chatId, model: availableModel.id, effort: availableModel.efforts?.[0] ?? null } });
    check('the chat adopts a catalog model', retuned.status === 200 && retuned.body?.chat?.lopu?.model === availableModel.id);
  } else {
    skip('the chat adopts a catalog model', 'no available model');
  }
  const messengerRename = await api('/api/v1/chats/update', { cookie: user.cookie, method: 'POST', body: { id: chatId, name: 'Renamed via messenger' } });
  check('the messenger rename path also works for Lopu chats', messengerRename.status === 200 && messengerRename.body?.chat?.name === 'Renamed via messenger');
  const leave = await api('/api/v1/chats/members', { cookie: user.cookie, method: 'POST', body: { chatId, leave: true } });
  check('leaving a Lopu chat is refused (delete instead)', leave.status === 400 || leave.status === 403);

  console.log('\nH. the generic things paths stay closed');
  const genericDeleteChat = await api(`/api/v1/things?id=${chatId}`, { cookie: user.cookie, method: 'DELETE' });
  const stillThere = await api(`/api/v1/chats/messages?chatId=${chatId}&limit=1`, { cookie: user.cookie });
  check('generic DELETE cannot destroy the chat', (genericDeleteChat.status === 404 || genericDeleteChat.status === 403) && stillThere.status === 200);
  if (userRow) {
    const genericDeleteRow = await api(`/api/v1/things?id=${userRow.id}`, { cookie: user.cookie, method: 'DELETE' });
    check('generic DELETE cannot reach chat rows', genericDeleteRow.status === 404 || genericDeleteRow.status === 403);
  }
  const genericCreate = await api('/api/v1/things', { cookie: user.cookie, method: 'POST', body: { thingtime: ['chat'], crystal: { chatType: 'group', name: 'forged', externalSource: { access: 'lopu', provider: 'lopu' } } } });
  check('generic create of a Lopu chat is refused', genericCreate.status === 403 || genericCreate.status === 400);
  const genericModel = await api('/api/v1/things', { cookie: user.cookie, method: 'POST', body: { thingtime: ['ai-model'], crystal: { modelId: 'forged', label: 'Forged', provider: 'openai', enabled: true } } });
  check('generic create of an ai-model is refused', genericModel.status === 403 || genericModel.status === 400);
  const catalogRow = modelRows[0];
  if (catalogRow) {
    const genericModelUpdate = await api('/api/v1/things', { cookie: user.cookie, method: 'PATCH', body: { id: `ai-model-${catalogRow.id}`, crystal: { enabled: false } } });
    check('generic update of an ai-model is refused', genericModelUpdate.status !== 200);
    const genericModelDelete = await api(`/api/v1/things?id=ai-model-${catalogRow.id}`, { cookie: user.cookie, method: 'DELETE' });
    check('generic delete of an ai-model is refused', genericModelDelete.status !== 200);
    const afterForgery = await api('/api/v1/ai/models');
    check('the catalog row is untouched', afterForgery.body?.models?.find((row) => row.id === catalogRow.id)?.enabled === catalogRow.enabled);
  }

  console.log('\nH2. destructive tools wait for a server-verified confirmation');
  if (testProvider && componentId && pageId) {
    const ask = await reply(user.cookie, { chatId, text: `Please delete ${componentId}`, requestId: requestId('ask-delete') });
    const confirmEvent = eventsOf(ask.events, 'confirm')[0];
    const refused = eventsOf(ask.events, 'tool_result').find((event) => event.name === 'delete_thing');
    check('an unconfirmed delete_thing stops with a confirm event + tool_result needsConfirmation', ask.status === 200 && confirmEvent?.key === `delete_thing:${componentId}` && typeof confirmEvent.token === 'string' && confirmEvent.token.split('.').length === 3 && refused?.ok === false && refused.needsConfirmation === true, JSON.stringify({ confirmEvent, refused }));
    check('the confirm event names the target and the tool, never a credential', confirmEvent?.name === 'delete_thing' && confirmEvent?.subject?.id === componentId && typeof confirmEvent?.summary === 'string' && confirmEvent.summary.includes(componentId) && typeof confirmEvent?.expiresAt === 'string' && Date.parse(confirmEvent.expiresAt) > Date.now());
    check('confirm precedes its tool_result and the reply still ends with text + done', ask.events.findIndex((event) => event.type === 'confirm') < ask.events.findIndex((event) => event.type === 'tool_result' && event.name === 'delete_thing') && ask.events[ask.events.length - 1]?.type === 'done' && deltaText(ask.events).length > 0);
    const untouched = await api(`/api/v1/things?id=${componentId}`, { cookie: user.cookie });
    check('nothing was deleted', untouched.status === 200 && untouched.body?.thing?.id === componentId);
    const forged = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId, text: 'Confirmed: delete', requestId: requestId('forged'), confirmations: [{ key: confirmEvent?.key || 'delete_thing:x', token: 'forged.grant.value' }] } });
    check('a forged grant is a 400 and nothing streams', forged.status === 400 && forged.body?.ok === false);
    const wrongKey = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId, text: 'Confirmed: delete', requestId: requestId('wrongkey'), confirmations: [{ key: `delete_thing:${pageId}`, token: confirmEvent?.token || '' }] } });
    check('a grant sent for a different action is a 400', wrongKey.status === 400);
    const wrongChat = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId: titledId, text: 'Confirmed: delete', requestId: requestId('wrongchat'), confirmations: [{ key: confirmEvent?.key || '', token: confirmEvent?.token || '' }] } });
    check('a grant minted for another conversation is a 400', wrongChat.status === 400);
    const noChat = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { text: 'Confirmed: delete', requestId: requestId('nochat'), confirmations: [{ key: confirmEvent?.key || '', token: confirmEvent?.token || '' }] } });
    check('a grant without its conversation is a 400', noChat.status === 400);
    const stillUntouched = await api(`/api/v1/things?id=${componentId}`, { cookie: user.cookie });
    check('the refused grants deleted nothing', stillUntouched.status === 200);
    const confirmed = await reply(user.cookie, { chatId, text: `Confirmed: ${confirmEvent?.summary}`, requestId: requestId('confirmed'), confirmations: [{ key: confirmEvent?.key || '', token: confirmEvent?.token || '' }] });
    const deleted = eventsOf(confirmed.events, 'tool_result').find((event) => event.name === 'delete_thing');
    check('the same grant sent back runs the delete (no second card)', confirmed.status === 200 && deleted?.ok === true && eventsOf(confirmed.events, 'confirm').length === 0, JSON.stringify(deleted));
    const gone = await api(`/api/v1/things?id=${componentId}`, { cookie: user.cookie });
    check('the component is gone', gone.status === 404 || gone.status === 403 || gone.body?.ok === false);
    check('the persisted turn records the refused and the run calls', confirmed.events[confirmed.events.length - 1]?.messages?.[0]?.lopu?.toolCalls?.some((call) => call.name === 'delete_thing' && call.ok === true) && ask.events[ask.events.length - 1]?.messages?.[0]?.lopu?.toolCalls?.some((call) => call.name === 'delete_thing' && call.ok === false));

    // run_action on a program that deletes things: the purge script creates a
    // Purge action (things.delete — actions touch Data Things only) and tries
    // to run it on a data thing made through the ordinary things path
    const target = await api('/api/v1/things', { cookie: user.cookie, method: 'POST', body: { thingtime: ['data'], crystal: { schema: 'note', name: 'Purge me', text: 'a note Lopu is asked to purge' } } });
    const targetId = target.body?.thing?.id || null;
    check('a data thing to purge exists', target.status === 200 && !!targetId, JSON.stringify(target.body));
    const purge = await reply(user.cookie, { chatId, text: `purge ${targetId}`, requestId: requestId('purge') });
    const purgeConfirm = eventsOf(purge.events, 'confirm')[0];
    const purgeCreated = eventsOf(purge.events, 'tool_result').find((event) => event.name === 'create_action');
    const purgeRun = eventsOf(purge.events, 'tool_result').find((event) => event.name === 'run_action');
    check('run_action on an action that deletes things stops for confirmation (create_action itself ran)', purge.status === 200 && purgeCreated?.ok === true && typeof purgeConfirm?.key === 'string' && purgeConfirm.key.startsWith('run_action:') && purgeRun?.ok === false && purgeRun.needsConfirmation === true, JSON.stringify({ purgeCreated, purgeConfirm, purgeRun }));
    check('the run card names the action and its inputs', purgeConfirm?.name === 'run_action' && purgeConfirm?.subject?.kind === 'action' && typeof purgeConfirm?.summary === 'string' && purgeConfirm.summary.includes(targetId) && /deletes things/.test(purgeConfirm.summary));
    const targetStill = await api(`/api/v1/things?id=${targetId}`, { cookie: user.cookie });
    check('the data thing survives the unconfirmed run', targetStill.status === 200 && targetStill.body?.thing?.id === targetId);
    const purged = await reply(user.cookie, { chatId, text: `Confirmed: ${purgeConfirm?.summary}`, requestId: requestId('purged'), confirmations: [{ key: purgeConfirm?.key || '', token: purgeConfirm?.token || '' }] });
    const ran = eventsOf(purged.events, 'tool_result').find((event) => event.name === 'run_action');
    check('the approved run executes the deleting action', purged.status === 200 && ran?.ok === true && ran.data?.status === 'ok' && eventsOf(purged.events, 'confirm').length === 0, JSON.stringify(ran));
    const targetGone = await api(`/api/v1/things?id=${targetId}`, { cookie: user.cookie });
    check('the data thing is gone', targetGone.status === 404 || targetGone.status === 403 || targetGone.body?.ok === false);
    // the same grant again: spent keys never re-run (the program id + inputs
    // still match, but the thing is gone — the run reports, nothing breaks)
    const replayed = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId, text: `Confirmed: ${purgeConfirm?.summary}`, requestId: requestId('replay'), confirmations: [{ key: purgeConfirm?.key || '', token: purgeConfirm?.token || '' }] } });
    check('replaying a fresh grant is accepted by the route (it only re-approves the identical, already-done action)', replayed.status === 200);
  } else {
    skip('server-verified confirmations (delete_thing / run_action)', 'needs the test provider and the section-D build');
  }

  console.log('\nI. delete');
  const otherDelete = await api('/api/v1/lopu/chats/delete', { cookie: other.cookie, method: 'POST', body: { chatId } });
  check('another user cannot delete the chat', otherDelete.status === 403 || otherDelete.status === 404);
  const deleted = await api('/api/v1/lopu/chats/delete', { cookie: user.cookie, method: 'POST', body: { chatId } });
  check('POST /lopu/chats/delete removes the chat', deleted.status === 200 && deleted.body?.ok === true);
  const afterDelete = await api('/api/v1/lopu/chats', { cookie: user.cookie });
  check('the chat is gone from the list', afterDelete.status === 200 && !afterDelete.body?.chats?.some((entry) => entry.id === chatId));
  const gone = await api(`/api/v1/chats/messages?chatId=${chatId}`, { cookie: user.cookie });
  check('its messages are unreachable', gone.status === 403 || gone.status === 404);
  const again = await api('/api/v1/lopu/chats/delete', { cookie: user.cookie, method: 'POST', body: { chatId } });
  check('deleting twice is a 404', again.status === 404);
  const unknownDelete = await api('/api/v1/lopu/chats/delete', { cookie: user.cookie, method: 'POST', body: { chatId: 'does-not-exist' } });
  check('deleting an unknown chat is a 404', unknownDelete.status === 404);
  for (const id of [titledId, lazyChatId]) {
    if (id) await api('/api/v1/lopu/chats/delete', { cookie: user.cookie, method: 'POST', body: { chatId: id } });
  }
  const swept = await api('/api/v1/lopu/chats', { cookie: user.cookie });
  check('the fixture conversations are all cleaned up', swept.status === 200 && swept.body?.chats?.length === 0);

  console.log('\nJ. admin: catalog toggle + seed, chat defaults');
  const nonAdminToggle = await api('/api/v1/admin/ai/models', { cookie: user.cookie, method: 'POST', body: { id: modelRows[0]?.id, enabled: false } });
  check('a plain user cannot toggle catalog models', nonAdminToggle.status === 403 || nonAdminToggle.status === 401);
  const nonAdminDefaults = await api('/api/v1/settings/lopu-chat-defaults', { cookie: user.cookie, method: 'POST', body: { model: modelRows[0]?.id, effort: 'high', speed: 'normal' } });
  check('a plain user cannot set the chat defaults', nonAdminDefaults.status === 403 || nonAdminDefaults.status === 401);
  const publicDefaults = await api('/api/v1/settings/lopu-chat-defaults');
  check('GET /settings/lopu-chat-defaults is public and shaped', publicDefaults.status === 200 && publicDefaults.body?.ok === true && publicDefaults.body?.defaults && 'model' in publicDefaults.body.defaults && publicDefaults.body?.resolved && Array.isArray(publicDefaults.body?.models));
  // `admin` was logged in by section A2 (the same credentials)
  if (!admin) {
    skip('admin catalog toggle / seed / defaults', ADMIN_USERNAME ? 'admin login failed' : 'set TT_VERIFY_ADMIN_USERNAME + TT_VERIFY_ADMIN_PASSWORD');
  } else {
    const adminList = await api('/api/v1/admin/ai/models', { cookie: admin.cookie });
    check('admin GET lists the catalog', adminList.status === 200 && adminList.body?.models?.length === modelRows.length);
    const target = modelRows.find((row) => !row.isDefault) || modelRows[0];
    const disabled = await api('/api/v1/admin/ai/models', { cookie: admin.cookie, method: 'POST', body: { id: target.id, enabled: false } });
    check('admin disables a model', disabled.status === 200 && disabled.body?.model?.id === target.id && disabled.body.model.enabled === false);
    const afterDisable = await api('/api/v1/ai/models');
    const disabledRow = afterDisable.body?.models?.find((row) => row.id === target.id);
    check('the public catalog shows it disabled and unavailable', disabledRow?.enabled === false && disabledRow?.available === false);
    // chat settings are a stored preference validated against the static
    // catalog; enablement/availability is resolved per turn by the reply route
    // (lenient for stored settings, so an admin toggle never strands a chat)
    const useDisabled = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: { model: target.id } });
    check('a disabled model is still storable as a chat preference', useDisabled.status === 200 && useDisabled.body?.chat?.lopu?.model === target.id);
    if (useDisabled.status === 200 && useDisabled.body?.chat?.id) {
      const disabledTurn = await reply(user.cookie, { chatId: useDisabled.body.chat.id, text: 'hello', requestId: requestId('disabled') });
      const disabledMeta = disabledTurn.events[0];
      check('a turn on that chat substitutes the disabled model instead of failing', disabledTurn.status === 200 && disabledMeta?.type === 'meta' && disabledMeta.model !== target.id);
      const strictOverride = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { chatId: useDisabled.body.chat.id, text: 'hello', requestId: requestId('strict'), model: target.id } });
      check('an explicit per-turn override of a disabled model is a 400', strictOverride.status === 400);
      await api('/api/v1/lopu/chats/delete', { cookie: user.cookie, method: 'POST', body: { chatId: useDisabled.body.chat.id } });
    }
    const enabled = await api('/api/v1/admin/ai/models', { cookie: admin.cookie, method: 'POST', body: { id: target.id, enabled: true } });
    check('admin re-enables it', enabled.status === 200 && enabled.body?.model?.enabled === true);
    const unknownToggle = await api('/api/v1/admin/ai/models', { cookie: admin.cookie, method: 'POST', body: { id: 'not-a-model', enabled: true } });
    check('toggling an unknown model is a 404', unknownToggle.status === 404);
    const badToggle = await api('/api/v1/admin/ai/models', { cookie: admin.cookie, method: 'POST', body: { id: target.id, enabled: 'yes' } });
    check('a non-boolean enabled is a 400', badToggle.status === 400);
    const seeded = await api('/api/v1/admin/ai/models', { cookie: admin.cookie, method: 'POST', body: { seed: true } });
    check('admin re-seeds the catalog idempotently', seeded.status === 200 && seeded.body?.seeded === modelRows.length && seeded.body?.report?.created === 0 && Array.isArray(seeded.body?.models));
    const afterSeed = await api('/api/v1/ai/models');
    check('re-seeding keeps every enabled flag', afterSeed.body?.models?.every((row) => row.enabled === modelRows.find((entry) => entry.id === row.id)?.enabled));

    // POST { probe: true } bypasses the probe cache: fresh checkedAt for every
    // configured provider, the same verdict the public catalog then reports
    const probeStart = Date.now() - 1000;
    const probed = await api('/api/v1/admin/ai/models', { cookie: admin.cookie, method: 'POST', body: { probe: true } });
    check('admin re-checks the provider keys', probed.status === 200 && probed.body?.ok === true && probed.body?.probed === true && providerStatusOk(probed.body?.providers?.anthropic) && providerStatusOk(probed.body?.providers?.openai) && Array.isArray(probed.body?.models) && probed.body.models.length === modelRows.length && probed.body?.defaults && 'model' in probed.body.defaults);
    check('a forced re-check is fresh (checkedAt after the request) for every configured provider', ['anthropic', 'openai'].every((provider) => !probed.body?.providers?.[provider]?.configured || Date.parse(probed.body.providers[provider].checkedAt) >= probeStart));
    const afterProbe = await api('/api/v1/ai/models');
    check('the fresh verdict is what the public catalog now reports', JSON.stringify(afterProbe.body?.providers) === JSON.stringify(probed.body?.providers));
    const nonAdminProbe = await api('/api/v1/admin/ai/models', { cookie: user.cookie, method: 'POST', body: { probe: true } });
    check('a plain user cannot re-check the keys', nonAdminProbe.status === 403 || nonAdminProbe.status === 401);

    const before = publicDefaults.body?.defaults;
    const anthropicRow = modelRows.find((row) => row.provider === 'anthropic') || modelRows[0];
    const setDefaults = await api('/api/v1/settings/lopu-chat-defaults', { cookie: admin.cookie, method: 'POST', body: { model: anthropicRow.id, effort: anthropicRow.efforts.includes('high') ? 'high' : anthropicRow.efforts[0] ?? null, speed: 'normal' } });
    check('admin stores the chat defaults', setDefaults.status === 200 && setDefaults.body?.defaults?.model === anthropicRow.id);
    const readBack = await api('/api/v1/settings/lopu-chat-defaults');
    check('the stored defaults read back publicly', readBack.body?.defaults?.model === anthropicRow.id);
    check('resolved defaults honour availability', readBack.body?.resolved?.model === null || readBack.body?.models?.some((row) => row.id === readBack.body.resolved.model && row.available));
    const badDefaults = await api('/api/v1/settings/lopu-chat-defaults', { cookie: admin.cookie, method: 'POST', body: { model: 'not-a-model' } });
    check('unknown default model is a 400', badDefaults.status === 400);
    const badEffort = await api('/api/v1/settings/lopu-chat-defaults', { cookie: admin.cookie, method: 'POST', body: { model: anthropicRow.id, effort: 'galactic' } });
    check('an effort the model does not offer is a 400', badEffort.status === 400);
    if (before && typeof before.model === 'string') {
      const restored = await api('/api/v1/settings/lopu-chat-defaults', { cookie: admin.cookie, method: 'POST', body: { model: before.model, effort: before.effort ?? null, speed: before.speed ?? 'normal' } });
      check('the previous defaults are restored', restored.status === 200 && restored.body?.defaults?.model === before.model);
    }
  }

  console.log('\nK. your own providers (Secure Vault → Lopu)');
  const catalogForUser = await api('/api/v1/ai/models', { cookie: user.cookie });
  check('GET /ai/models carries vault.configured + vaultProviders for a session', catalogForUser.status === 200 && typeof catalogForUser.body?.vault?.configured === 'boolean' && Array.isArray(catalogForUser.body?.vaultProviders));
  const anonCatalog = await api('/api/v1/ai/models');
  check('the anonymous catalog has an empty vaultProviders list and the vault status', Array.isArray(anonCatalog.body?.vaultProviders) && anonCatalog.body.vaultProviders.length === 0 && typeof anonCatalog.body?.vault?.configured === 'boolean');
  const vaultConfigured = catalogForUser.body?.vault?.configured === true;
  const unknownProviderReply = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { text: 'hi', requestId: requestId('noprov'), providerId: 'prov-does-not-exist-000' } });
  check('a reply with a providerId that is not yours fails cleanly (400, nothing streamed)', unknownProviderReply.status === 400 && unknownProviderReply.body?.ok === false && typeof unknownProviderReply.body?.error === 'string');
  const malformedProvider = await api('/api/v1/lopu/chats/reply', { cookie: user.cookie, method: 'POST', body: { text: 'hi', requestId: requestId('badprov'), providerId: 'bad id!' } });
  check('a malformed providerId is a 400', malformedProvider.status === 400);
  const unknownProviderChat = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: { providerId: 'prov-does-not-exist-000' } });
  check('a chat cannot pin a provider that is not in your vault', unknownProviderChat.status === 400);
  // direct voice: a connection that is not yours (or a vault with no key) is a
  // clean 400 error shape — never a session, never a token
  const unknownSession = await api('/api/v1/lopu/voice/session', { cookie: user.cookie, method: 'POST', body: { providerId: 'prov-does-not-exist-000', model: 'grok-voice-latest' } });
  check('a voice session for a providerId that is not yours fails cleanly (400, no credential)', unknownSession.status === 400 && unknownSession.body?.ok === false && typeof unknownSession.body?.error === 'string' && !('session' in unknownSession.body) && !JSON.stringify(unknownSession.body).includes('"token"'), JSON.stringify(unknownSession.body));
  const malformedSession = await api('/api/v1/lopu/voice/session', { cookie: user.cookie, method: 'POST', body: { providerId: 'bad id!' } });
  check('a malformed providerId on the voice session is a 400', malformedSession.status === 400 && malformedSession.body?.ok === false);
  check('the voice session response is not cached', (unknownSession.headers.get('cache-control') || '').includes('no-store'));
  const swept2 = await api('/api/v1/lopu/chats', { cookie: user.cookie });
  check('a refused reply persisted nothing', swept2.status === 200 && swept2.body?.chats?.length === 0);

  if (!vaultConfigured) {
    check('with the vault unconfigured the catalog lists no providers', catalogForUser.body.vaultProviders.length === 0);
    skip('BYO provider turn through a local fake endpoint', 'the server reports vault.configured=false — set THINGTIME_USER_VAULT_KEY (and THINGTIME_LOPU_PROVIDER_DEV_REWRITES, see the header) on the server');
  } else {
    const fake = await startFakeProvider();
    if (!fake.ok) {
      skip('BYO provider turn through a local fake endpoint', `fake provider could not listen on 127.0.0.1:${FAKE_PROVIDER_PORT} (${fake.error})`);
    } else {
      const providerName = `Verify fake ${suffix}`;
      const token = `verify-token-${suffix}`;
      const saved = await api('/api/v1/lopu/vault', { cookie: user.cookie, method: 'POST', body: { action: 'save-provider', name: providerName, provider: 'compatible', endpoint: `${FAKE_PROVIDER_ORIGIN}/v1`, model: 'fake-model', token } });
      const providerId = saved.body?.entry?.id || null;
      check('a compatible provider pointing at the fake origin saves', saved.status === 200 && !!providerId, JSON.stringify(saved.body));
      check('the vault never returns the token', !JSON.stringify(saved.body || {}).includes(token));
      const brokenSaved = await api('/api/v1/lopu/vault', { cookie: user.cookie, method: 'POST', body: { action: 'save-provider', name: `${providerName} broken`, provider: 'compatible', endpoint: `${FAKE_PROVIDER_ORIGIN}/v1`, model: 'broken-model', token: `${token}-broken` } });
      const brokenId = brokenSaved.body?.entry?.id || null;
      const listedCatalog = await api('/api/v1/ai/models', { cookie: user.cookie });
      const listed = listedCatalog.body?.vaultProviders?.find((entry) => entry.id === providerId) || null;
      check('the catalog lists the connection redacted (hostname only — no token, no endpoint)', !!listed && listed.name === providerName && listed.kind === 'compatible' && listed.model === 'fake-model' && listed.endpointHost === 'lopu-fake-provider.invalid' && typeof listed.available === 'boolean' && !('token' in listed) && !('endpoint' in listed) && !JSON.stringify(listedCatalog.body).includes(token));
      check('a custom host lists no realtime models (direct voice needs xAI Grok Voice)', Array.isArray(listed?.realtimeModels) && listed.realtimeModels.length === 0);
      const noRealtime = await api('/api/v1/lopu/voice/session', { cookie: user.cookie, method: 'POST', body: { providerId } });
      check('a voice session on a provider without realtime speech is a 400 that names the rule and mints nothing', noRealtime.status === 400 && noRealtime.body?.ok === false && /realtime/i.test(String(noRealtime.body?.error)) && !JSON.stringify(noRealtime.body).includes(token) && !fake.requests.some((entry) => String(entry.path).includes('realtime')), JSON.stringify(noRealtime.body));
      const otherSees = (await api('/api/v1/ai/models', { cookie: other.cookie })).body?.vaultProviders?.some((entry) => entry.id === providerId);
      check('another user does not see it', otherSees === false);
      const otherPins = await api('/api/v1/lopu/chats', { cookie: other.cookie, method: 'POST', body: { providerId } });
      check('another user cannot pin it to a chat', otherPins.status === 400);
      const otherReply = await api('/api/v1/lopu/chats/reply', { cookie: other.cookie, method: 'POST', body: { text: 'hi', requestId: requestId('otherprov'), providerId } });
      check('another user cannot run a turn on it', otherReply.status === 400);
      const pinned = await api('/api/v1/lopu/chats', { cookie: user.cookie, method: 'POST', body: { title: 'BYO chat', providerId } });
      const byoChatId = pinned.body?.chat?.id || null;
      check('a chat pins the provider (settings round-trip)', pinned.status === 200 && pinned.body?.chat?.lopu?.providerId === providerId);
      const listedChat = (await api('/api/v1/lopu/chats', { cookie: user.cookie })).body?.chats?.find((entry) => entry.id === byoChatId);
      check('the list entry carries lopu.providerId', listedChat?.lopu?.providerId === providerId);

      if (listed?.available) {
        const byo = await reply(user.cookie, { chatId: byoChatId, text: 'Say hello from my own key', requestId: requestId('byo') });
        const byoMeta = byo.events[0];
        check('the turn runs on the vault provider (meta provider=vault, providerLabel, its model)', byo.status === 200 && byoMeta?.type === 'meta' && byoMeta.provider === 'vault' && byoMeta.providerLabel === providerName && byoMeta.model === 'fake-model', JSON.stringify(byoMeta));
        check('the fake endpoint received the decrypted token and the connection model', fake.requests.some((entry) => entry.authorization === `Bearer ${token}` && entry.body?.model === 'fake-model'));
        check('the reply text came from the fake endpoint', deltaText(byo.events).includes(FAKE_PROVIDER_REPLY));
        const byoDone = byo.events[byo.events.length - 1];
        check('the persisted assistant row records provider vault + the model + the connection name', byoDone?.type === 'done' && byoDone.messages?.[0]?.lopu?.provider === 'vault' && byoDone.messages[0].lopu.model === 'fake-model' && byoDone.messages[0].lopu.providerLabel === providerName);
        if (brokenId) {
          const broken = await reply(user.cookie, { chatId: byoChatId, text: 'hi', requestId: requestId('broken'), providerId: brokenId });
          const brokenMeta = broken.events[0];
          const errorEvent = eventsOf(broken.events, 'error')[0];
          check('a rejecting provider surfaces a friendly error event then the canned vault line', broken.status === 200 && brokenMeta?.provider === 'vault' && !!errorEvent && /rejected the saved key \(HTTP 401\)/.test(errorEvent.message) && deltaText(broken.events).includes('your own provider'), JSON.stringify(errorEvent));
          check('the failed turn never leaks the token', !JSON.stringify(broken.events).includes(token));
          const brokenDone = broken.events[broken.events.length - 1];
          check('the failed turn is persisted as a fallback reply', brokenDone?.type === 'done' && brokenDone.stopReason === 'fallback');
          const repinned = (await api('/api/v1/lopu/chats', { cookie: user.cookie })).body?.chats?.find((entry) => entry.id === byoChatId);
          check('an explicit per-turn providerId becomes the chat setting', repinned?.lopu?.providerId === brokenId);
        }
      } else {
        skip('BYO turn through the fake endpoint', `the connection is unavailable (${listed?.reason}) — start the server with THINGTIME_LOPU_PROVIDER_DEV_REWRITES=${FAKE_PROVIDER_ORIGIN}=http://127.0.0.1:${fake.port}`);
        const byo = await reply(user.cookie, { chatId: byoChatId, text: 'hi', requestId: requestId('byo-unavailable') });
        check('an unavailable provider still fails cleanly (meta vault → error event → canned line → done)', byo.status === 200 && byo.events[0]?.provider === 'vault' && eventsOf(byo.events, 'error').length >= 1 && byo.events[byo.events.length - 1]?.type === 'done' && deltaText(byo.events).length > 0);
      }
      const cleared = await api('/api/v1/lopu/chats/update', { cookie: user.cookie, method: 'POST', body: { chatId: byoChatId, providerId: null } });
      check('providerId: null clears the pin', cleared.status === 200 && (cleared.body?.chat?.lopu?.providerId ?? null) === null);
      if (byoChatId) await api('/api/v1/lopu/chats/delete', { cookie: user.cookie, method: 'POST', body: { chatId: byoChatId } });
      for (const id of [providerId, brokenId]) {
        if (id) await api('/api/v1/lopu/vault', { cookie: user.cookie, method: 'POST', body: { action: 'delete', id } });
      }
      const afterVault = await api('/api/v1/ai/models', { cookie: user.cookie });
      check('the fixture providers are cleaned up', !afterVault.body?.vaultProviders?.some((entry) => entry.id === providerId || entry.id === brokenId));
      fake.close();
    }
  }

  summarize();
};

run().catch((error) => {
  console.error('verify-lopu crashed:', error);
  process.exitCode = 1;
});
