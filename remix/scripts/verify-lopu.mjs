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
//   node scripts/verify-lopu.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or this worktree's nitro port. The
// admin section needs TT_VERIFY_ADMIN_USERNAME + TT_VERIFY_ADMIN_PASSWORD
// (a username listed in the server's ADMIN_USERNAMES); it is skipped, not
// failed, when they are absent. The reply section expects the server to run
// with LOPU_CHAT_PROVIDER=test (deterministic tool script); against any other
// provider the tool-specific checks are reported as skipped.

import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:18162';
const ADMIN_USERNAME = process.env.TT_VERIFY_ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.TT_VERIFY_ADMIN_PASSWORD || '';

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

const eventsOf = (events, type) => events.filter((event) => event?.type === type);
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

  console.log('\nB. model catalog');
  const models = await api('/api/v1/ai/models');
  const modelRows = Array.isArray(models.body?.models) ? models.body.models : [];
  check('GET /ai/models is public and 200', models.status === 200 && models.body?.ok === true);
  check('catalog lists models with the public shape', modelRows.length > 0 && modelRows.every((row) => typeof row.id === 'string' && typeof row.label === 'string' && ['anthropic', 'openai'].includes(row.provider) && Array.isArray(row.efforts) && Array.isArray(row.speeds) && typeof row.family === 'string' && typeof row.enabled === 'boolean' && typeof row.available === 'boolean' && typeof row.isDefault === 'boolean'));
  check('catalog carries provider status + defaults', models.body?.providers && typeof models.body.providers.anthropic?.configured === 'boolean' && typeof models.body.providers.openai?.configured === 'boolean' && models.body?.defaults && 'model' in models.body.defaults);
  check('the catalog response is not cached', (models.headers.get('cache-control') || '').includes('no-store'));
  const availableModel = modelRows.find((row) => row.available) || null;
  const defaultModel = models.body?.defaults?.model || null;
  check('defaults.model is null or an available catalog model', defaultModel === null || modelRows.some((row) => row.id === defaultModel && row.available));
  check('isDefault marks exactly the defaults.model row', modelRows.filter((row) => row.isDefault).map((row) => row.id).join(',') === (defaultModel || ''));
  const noStore = await api('/api/v1/ai/models', { cookie: user.cookie });
  check('the same list serves a signed-in viewer', noStore.status === 200 && noStore.body?.models?.length === modelRows.length);

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
  check('events are well-formed (every type is known)', built.events.every((event) => ['meta', 'delta', 'thinking', 'tool_use_start', 'tool_input_delta', 'tool_use', 'tool_result', 'patch', 'thing', 'navigate', 'error', 'done'].includes(event?.type)));

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
  const admin = ADMIN_USERNAME && ADMIN_PASSWORD ? await login(ADMIN_USERNAME, ADMIN_PASSWORD) : null;
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

  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length) {
    console.log('Failures:');
    for (const name of failures) console.log(`  - ${name}`);
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error('verify-lopu crashed:', error);
  process.exitCode = 1;
});
