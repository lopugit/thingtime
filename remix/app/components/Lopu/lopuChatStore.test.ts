import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	abortLopuTurn,
	bindLopuApi,
	archiveLopuChat,
	confirmLopuTool,
	declineLopuTool,
	getLopuStoreSnapshot,
	hydrateLopuStore,
	loadLopuChats,
	loadLopuMessages,
	lopuMessagesCacheKey,
	loadLopuModels,
	reconcileLopuSettings,
	resetLopuStoreForTests,
	selectLopuChat,
	sendLopuMessage,
	setLopuSettings,
	type AiModelPublic,
	type LopuApiClient,
	type LopuVaultProvider
} from './lopuChatStore.ts';
// @ts-ignore same
import { bindLopuAccountApi, getLopuAccountSnapshot, hydrateLopuAccount, refreshLopuAccount, resetLopuAccountForTests, type LopuAccountApiClient } from './useLopuAccount.ts';

// providerId plumbing (design brief): the choice reconciles against the
// viewer's vault list, persists per chat through the update route, rides on
// the reply body, and a 'vault' meta names the provider. Pure module state —
// no DOM (localStorage is absent in node, so caches are simply skipped).

const model = (id: string, provider: 'anthropic' | 'openai', available = true): AiModelPublic => ({
	id,
	label: id,
	provider,
	efforts: ['low', 'high'],
	speeds: ['normal', 'fast'],
	family: 'x',
	enabled: true,
	available,
	isDefault: id === 'gpt-5'
});
const MODELS = [model('gpt-5', 'openai'), model('claude-opus-5', 'anthropic', false)];
const VAULT: LopuVaultProvider[] = [
	{ id: 'vp-1', name: 'Acme proxy', kind: 'compatible', model: 'gpt-4o', endpointHost: 'llm.acme.test', available: true, reason: null, realtimeModels: [] },
	{ id: 'vp-off', name: 'Broken', kind: 'openai', model: null, endpointHost: null, available: false, reason: 'blocked host', realtimeModels: [] }
];
const DEFAULTS = { model: 'gpt-5', effort: 'high', speed: 'normal' };

const ndjson = (events: unknown[]): Response =>
	new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });

const fakeClient = (options?: { reply?: (body: any) => Response; chats?: unknown[] }) => {
	const calls: { name: string; args: unknown }[] = [];
	const client: LopuApiClient = {
		models: async () => {
			calls.push({ name: 'models', args: null });
			return { ok: true, models: MODELS, defaults: DEFAULTS, providers: { openai: { configured: true } }, vaultProviders: VAULT, vault: { configured: true } };
		},
		chats: {
			list: async () => {
				calls.push({ name: 'chats.list', args: null });
				return { ok: true, chats: options?.chats ?? [] };
			},
			create: async (args) => {
				calls.push({ name: 'chats.create', args });
				return { ok: true, chat: { id: 'chat-new', name: args?.title || 'Lopu', updatedAt: new Date().toISOString(), lopu: { providerId: args?.providerId ?? null } } };
			},
			update: async (args) => {
				calls.push({ name: 'chats.update', args });
				return { ok: true, chat: { id: args.chatId } };
			},
			delete: async (args) => {
				calls.push({ name: 'chats.delete', args });
				return { ok: true };
			}
		},
		messages: async (args) => {
			calls.push({ name: 'messages', args });
			return { ok: true, messages: [] };
		},
		reply: async (body) => {
			calls.push({ name: 'reply', args: body });
			return options?.reply
				? options.reply(body)
				: ndjson([
						{ type: 'meta', chatId: body.chatId || 'chat-1', userMessageId: 'u-1', requestId: body.requestId, model: body.model || null, effort: body.effort || null, speed: body.speed || 'normal', provider: body.providerId ? 'vault' : 'openai', label: body.providerId ? 'Acme proxy' : 'GPT-5', providerLabel: body.providerId ? 'Acme proxy' : null, providerId: body.providerId || null },
						{ type: 'delta', text: 'Hello!' },
						{ type: 'done', assistantMessageId: 'a-1', messages: [], stopReason: 'end_turn' }
				  ]);
		}
	};
	return { client, calls };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('sent attachment metadata stays visible locally while only selected IDs go to the server', async () => {
	resetLopuStoreForTests(); hydrateLopuStore('owner');
	const { client, calls } = fakeClient(); bindLopuApi(client);
	const attachment = { id: 'att-qa', name: 'qa.txt', size: 150, contentType: 'text/plain', mediaKind: 'file' as const };
	const result = await sendLopuMessage('File attached', { attachmentIds: ['att-qa'], attachments: [attachment, { ...attachment, id: 'not-selected' }] });
	assert.equal(result.ok, true);
	assert.deepEqual(getLopuStoreSnapshot().messages['chat-1'].find(row => row.id === 'u-1')?.attachments, [attachment]);
	const sent = calls.find(call => call.name === 'reply')?.args as Record<string, unknown>;
	assert.deepEqual(sent.attachmentIds, ['att-qa']);
	assert.equal(Object.prototype.hasOwnProperty.call(sent, 'attachments'), false, 'client metadata does not change the wire contract');
});

test('a late message fetch cannot repopulate another account after switching away and back', async () => {
	resetLopuStoreForTests(); hydrateLopuStore('owner');
	const { client } = fakeClient();
	let finish!: (value: any) => void;
	client.messages = () => new Promise(resolve => { finish = resolve; });
	bindLopuApi(client);
	const pending = loadLopuMessages('old-chat');
	hydrateLopuStore('other'); hydrateLopuStore('owner');
	finish({ ok: true, messages: [{ id: 'old-private-message' }] }); await pending;
	assert.equal(getLopuStoreSnapshot().messages['old-chat'], undefined);
});
test('message caches are account scoped rather than inherited from another signed-in account', () => {
	assert.notEqual(lopuMessagesCacheKey('chat', 'owner'), lopuMessagesCacheKey('chat', 'other'));
});

// the account slice the chat store feeds (verified-credits design note §4) —
// a stateful fake server, since the slice refetches after every gate / done
const ACCOUNT = { ok: true, account: { verified: true, requireVerification: true, allowByoUnverified: false, balanceMicros: 2_000_000, lowBalance: false, lowBalanceWarningCredits: 1, month: { key: '2026-09', costMicros: 0, turns: 0 }, lifetime: { costMicros: 0, inputTokens: 0, outputTokens: 0, turns: 0 }, starterCredits: 0, topupUrl: null, pendingRequest: null } };
const fakeAccountClient = () => {
	const server = { balanceMicros: ACCOUNT.account.balanceMicros, verified: ACCOUNT.account.verified };
	const client: LopuAccountApiClient = {
		get: async () => ({ ...ACCOUNT, account: { ...ACCOUNT.account, balanceMicros: server.balanceMicros, verified: server.verified } }),
		history: async () => ({ ok: true, entries: [], usage: [], nextCursor: null }),
		requestTopup: async () => ({ ok: true })
	};
	return { client, server };
};

test('a done event hands its usage / cost / balance to the account slice, so the chip moves before the refetch', async () => {
	resetLopuStoreForTests();
	resetLopuAccountForTests();
	const accountServer = fakeAccountClient();
	bindLopuAccountApi(accountServer.client);
	hydrateLopuAccount('u1');
	await refreshLopuAccount();
	const { client } = fakeClient({
		reply: (body) =>
			ndjson([
				{ type: 'meta', chatId: 'chat-1', userMessageId: 'u-1', requestId: body.requestId, model: 'gpt-5', effort: 'high', speed: 'normal', provider: 'openai', label: 'GPT-5', billing: 'thingtime' },
				{ type: 'delta', text: 'Hello!' },
				{ type: 'done', assistantMessageId: 'a-1', messages: [], stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 50 }, costMicros: 13_200, billing: 'thingtime', balanceMicros: 1_986_800 }
			])
	});
	bindLopuApi(client);
	hydrateLopuStore('u1');
	await loadLopuModels();
	const result = await sendLopuMessage('hello');
	assert.equal(result.ok, true);
	const turn = result.ok ? getLopuStoreSnapshot().turns[result.requestId] : null;
	assert.equal(turn?.billing, 'thingtime');
	assert.equal(turn?.costMicros, 13_200);
	assert.equal(turn?.balanceMicros, 1_986_800);
	const account = getLopuAccountSnapshot().account;
	assert.equal(account?.balanceMicros, 1_986_800, 'the balance moved from the done event');
	assert.equal(account?.month.costMicros, 13_200);
	assert.equal(account?.month.turns, 1);
	resetLopuAccountForTests();
	resetLopuStoreForTests();
});

test('a 402 / 403 from the reply endpoint becomes a gated turn kept in the timeline — the text is not handed back and the account learns of it', async () => {
	resetLopuStoreForTests();
	resetLopuAccountForTests();
	const accountServer = fakeAccountClient();
	bindLopuAccountApi(accountServer.client);
	hydrateLopuAccount('u1');
	await refreshLopuAccount();
	const { client } = fakeClient({
		reply: () => {
			accountServer.server.balanceMicros = 0;
			return new Response(JSON.stringify({ ok: false, error: "Lopu's credits for your account are used up — add credits to keep going", code: 'LOPU_NO_CREDITS', balance: 0 }), { status: 402, headers: { 'Content-Type': 'application/json' } });
		}
	});
	bindLopuApi(client);
	hydrateLopuStore('u1');
	await loadLopuModels();
	const result = await sendLopuMessage('build me a hero');
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.text, '', 'the viewer bubble stays; nothing goes back to the composer');
	assert.equal(result.ok === false && result.gate?.code, 'LOPU_NO_CREDITS');
	const snapshot = getLopuStoreSnapshot();
	const turn = Object.values(snapshot.turns)[0];
	assert.ok(turn, 'the gated turn stays in the store');
	assert.equal(turn.status, 'error');
	assert.equal(turn.gate?.code, 'LOPU_NO_CREDITS');
	assert.equal(turn.userText, 'build me a hero');
	assert.equal(snapshot.sending, false);
	assert.equal(snapshot.streamingId, null);
	assert.equal(snapshot.error, null, 'no raw error line — the bubble explains');
	assert.equal(snapshot.notices.length, 0, 'no toast either');
	assert.equal(getLopuAccountSnapshot().account?.balanceMicros, 0, 'the 402 named the balance');
	// an unverified refusal reads the same way
	const refused = fakeClient({
		reply: () => {
			accountServer.server.verified = false;
			return new Response(JSON.stringify({ ok: false, error: 'Lopu is invite-only for now — an admin needs to verify your account before it can build with you', code: 'LOPU_UNVERIFIED' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
		}
	});
	bindLopuApi(refused.client);
	const second = await sendLopuMessage('again');
	assert.equal(second.ok === false && second.gate?.code, 'LOPU_UNVERIFIED');
	assert.equal(getLopuAccountSnapshot().account?.verified, false);
	// an ordinary failure still drops the turn and hands the text back
	const broken = fakeClient({ reply: () => new Response(JSON.stringify({ ok: false, error: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) });
	bindLopuApi(broken.client);
	const failed = await sendLopuMessage('one more');
	assert.equal(failed.ok === false && failed.text, 'one more');
	assert.equal(failed.ok === false && failed.gate, undefined);
	resetLopuAccountForTests();
	resetLopuStoreForTests();
});

test('reconcileLopuSettings keeps a providerId only while the vault lists it as available', () => {
	assert.equal(reconcileLopuSettings({ model: 'gpt-5', providerId: 'vp-1' }, MODELS, DEFAULTS, VAULT).providerId, 'vp-1');
	assert.equal(reconcileLopuSettings({ model: 'gpt-5', providerId: 'vp-off' }, MODELS, DEFAULTS, VAULT).providerId, null);
	assert.equal(reconcileLopuSettings({ model: 'gpt-5', providerId: 'ghost' }, MODELS, DEFAULTS, VAULT).providerId, null);
	// an unknown vault (null) trusts the cached choice; an empty list drops it
	assert.equal(reconcileLopuSettings({ providerId: 'ghost' }, MODELS, DEFAULTS, null).providerId, 'ghost');
	assert.equal(reconcileLopuSettings({ providerId: 'ghost' }, MODELS, DEFAULTS, []).providerId, null);
	// the catalog choice still clamps alongside the provider
	const clamped = reconcileLopuSettings({ model: 'claude-opus-5', effort: 'max', providerId: 'vp-1' }, MODELS, DEFAULTS, VAULT);
	assert.deepEqual(clamped, { model: 'gpt-5', effort: 'high', speed: 'normal', providerId: 'vp-1' });
	assert.deepEqual(reconcileLopuSettings(null, [], null, null), { model: null, effort: null, speed: null, providerId: null });
});

test('the catalog load adopts vaultProviders + vault and drops a providerId the vault no longer offers', async () => {
	resetLopuStoreForTests();
	const { client } = fakeClient();
	bindLopuApi(client);
	hydrateLopuStore('u1');
	setLopuSettings({ providerId: 'ghost' });
	assert.equal(getLopuStoreSnapshot().settings.providerId, 'ghost', 'before the catalog loads the cached choice is trusted');
	await loadLopuModels();
	const snapshot = getLopuStoreSnapshot();
	assert.equal(snapshot.vaultProviders.length, 2);
	assert.deepEqual(snapshot.vault, { configured: true });
	assert.equal(snapshot.settings.providerId, null);
	assert.equal(snapshot.settings.model, 'gpt-5');
	resetLopuStoreForTests();
});

test('choosing a provider persists it on the active chat and clears it back through the same route', async () => {
	resetLopuStoreForTests();
	const { client, calls } = fakeClient();
	bindLopuApi(client);
	hydrateLopuStore('u1');
	await loadLopuModels();
	selectLopuChat('chat-1');
	setLopuSettings({ providerId: 'vp-1' });
	assert.equal(getLopuStoreSnapshot().settings.providerId, 'vp-1');
	await flush();
	const update = calls.find((call) => call.name === 'chats.update');
	assert.deepEqual(update?.args, { chatId: 'chat-1', providerId: 'vp-1' });
	// same value again → no second write; an unavailable provider is refused locally
	calls.length = 0;
	setLopuSettings({ providerId: 'vp-1' });
	setLopuSettings({ providerId: 'vp-off' });
	await flush();
	assert.equal(getLopuStoreSnapshot().settings.providerId, 'vp-1');
	assert.equal(calls.filter((call) => call.name === 'chats.update').length, 0);
	setLopuSettings({ providerId: null });
	await flush();
	assert.deepEqual(calls.find((call) => call.name === 'chats.update')?.args, { chatId: 'chat-1', providerId: null });
	// a model change alone never touches the chat's provider
	calls.length = 0;
	setLopuSettings({ effort: 'low' });
	await flush();
	assert.equal(calls.filter((call) => call.name === 'chats.update').length, 0);
	resetLopuStoreForTests();
});

test('selecting a chat adopts its stored providerId (and a chat without one clears it)', async () => {
	resetLopuStoreForTests();
	const now = new Date().toISOString();
	const { client } = fakeClient({
		chats: [
			{ id: 'chat-with', name: 'with provider', updatedAt: now, lopu: { model: 'gpt-5', effort: 'low', speed: 'normal', providerId: 'vp-1' } },
			{ id: 'chat-plain', name: 'plain', updatedAt: now, lopu: { model: 'gpt-5', providerId: null } },
			{ id: 'chat-legacy', name: 'legacy', updatedAt: now, lopu: { model: 'gpt-5' } }
		]
	});
	bindLopuApi(client);
	hydrateLopuStore('u1');
	await loadLopuModels();
	await loadLopuChats();
	selectLopuChat('chat-with');
	assert.equal(getLopuStoreSnapshot().settings.providerId, 'vp-1');
	assert.equal(getLopuStoreSnapshot().settings.effort, 'low');
	selectLopuChat('chat-plain');
	assert.equal(getLopuStoreSnapshot().settings.providerId, null, 'an explicit null clears the provider');
	setLopuSettings({ providerId: 'vp-1' });
	selectLopuChat('chat-legacy');
	assert.equal(getLopuStoreSnapshot().settings.providerId, 'vp-1', 'a row without the key leaves the choice alone');
	resetLopuStoreForTests();
});

test('send carries providerId in the reply body and a vault meta names the provider on the turn and the chat', async () => {
	resetLopuStoreForTests();
	const { client, calls } = fakeClient();
	bindLopuApi(client);
	hydrateLopuStore('u1');
	await loadLopuModels();
	const plain = await sendLopuMessage('hello');
	assert.equal(plain.ok, true);
	const plainBody = calls.find((call) => call.name === 'reply')?.args as { providerId?: string; model?: string };
	assert.equal(plainBody.providerId, undefined);
	assert.equal(plainBody.model, 'gpt-5');

	calls.length = 0;
	const viaVault = await sendLopuMessage('use my proxy', { settings: { providerId: 'vp-1' } });
	assert.equal(viaVault.ok, true);
	const body = calls.find((call) => call.name === 'reply')?.args as { providerId?: string; chatId?: string };
	assert.equal(body.providerId, 'vp-1');
	const snapshot = getLopuStoreSnapshot();
	assert.equal(snapshot.settings.providerId, 'vp-1', 'a per-send override becomes the current choice');
	const turn = viaVault.ok ? snapshot.turns[viaVault.requestId] : null;
	assert.equal(turn?.meta?.provider, 'vault');
	assert.equal(turn?.meta?.providerLabel, 'Acme proxy');
	const chat = snapshot.chats.find((entry) => entry.id === 'chat-1');
	assert.equal(chat?.lopu?.providerId, 'vp-1');
	// an unknown provider never reaches the wire — the current one stays
	calls.length = 0;
	await sendLopuMessage('again', { settings: { providerId: 'ghost' } });
	const kept = calls.find((call) => call.name === 'reply')?.args as { providerId?: string };
	assert.equal(kept.providerId, 'vp-1');
	assert.equal(getLopuStoreSnapshot().settings.providerId, 'vp-1');
	// clearing it is stated on the wire (the chat carries its own settings now,
	// so a null must reach the server — it clears the pin the server holds)
	calls.length = 0;
	await sendLopuMessage('and back', { settings: { providerId: null } });
	const cleared = calls.find((call) => call.name === 'reply')?.args as { providerId?: string | null };
	assert.equal(cleared.providerId, null);
	assert.equal('providerId' in cleared, true);
	assert.equal(getLopuStoreSnapshot().settings.providerId, null);
	resetLopuStoreForTests();
});

test('the provider choice is stated on the wire whenever the chat carries its own settings, and omitted for a chat the store does not know', async () => {
	resetLopuStoreForTests();
	const now = new Date().toISOString();
	const { client, calls } = fakeClient({
		chats: [
			{ id: 'chat-with', name: 'with provider', updatedAt: now, lopu: { model: 'gpt-5', providerId: 'vp-1' } },
			{ id: 'chat-legacy', name: 'legacy', updatedAt: now }
		]
	});
	bindLopuApi(client);
	hydrateLopuStore('u1');
	await loadLopuModels();
	await loadLopuChats();
	selectLopuChat('chat-with');
	assert.equal(getLopuStoreSnapshot().settings.providerId, 'vp-1');
	// the picker moved back to a Thingtime model: the server's pin must not
	// route the turn behind its back, so null travels explicitly
	setLopuSettings({ providerId: null });
	await flush();
	calls.length = 0;
	await sendLopuMessage('hello');
	const explicit = calls.find((call) => call.name === 'reply')?.args as { providerId?: string | null };
	assert.equal('providerId' in explicit, true);
	assert.equal(explicit.providerId, null);
	// a summary without a lopu block: the client does not know the chat's
	// setting, so the key is omitted and the server keeps what it has
	selectLopuChat('chat-legacy');
	calls.length = 0;
	await sendLopuMessage('hello again');
	const omitted = calls.find((call) => call.name === 'reply')?.args as { providerId?: string | null };
	assert.equal('providerId' in omitted, false);
	resetLopuStoreForTests();
});

test('a Confirm card sends its grant back once as a "Confirmed:" turn; Cancel retires it locally; a stale grant never leaves the client', async () => {
	resetLopuStoreForTests();
	const future = new Date(Date.now() + 60_000).toISOString();
	const meta = (body: any) => ({ type: 'meta', chatId: body.chatId || 'chat-1', userMessageId: `u-${body.requestId}`, requestId: body.requestId, model: 'gpt-5', effort: 'high', speed: 'normal', provider: 'openai', label: 'GPT-5' });
	const done = { type: 'done', assistantMessageId: 'a-1', messages: [], stopReason: 'end_turn' };
	const { client, calls } = fakeClient({
		reply: (body) =>
			body.confirmations
				? ndjson([
						meta(body),
						{ type: 'tool_use', id: 't2', name: 'delete_thing', input: { id: 'thing-1' } },
						{ type: 'tool_result', id: 't2', name: 'delete_thing', ok: true, summary: 'Deleted thing-1' },
						{ type: 'delta', text: 'Gone.' },
						done
				  ])
				: ndjson([
						meta(body),
						{ type: 'tool_use', id: 't1', name: 'delete_thing', input: { id: 'thing-1' } },
						{ type: 'confirm', id: 't1', name: 'delete_thing', key: 'delete_thing:thing-1', token: body.text.includes('stale') ? '' : 'grant', expiresAt: future, summary: 'Delete thing thing-1', subject: { id: 'thing-1' } },
						{ type: 'tool_result', id: 't1', name: 'delete_thing', ok: false, summary: 'Waiting for the user’s confirmation', needsConfirmation: true },
						{ type: 'delta', text: 'Please confirm.' },
						done
				  ])
	});
	bindLopuApi(client);
	hydrateLopuStore('u1');
	await loadLopuModels();

	const asked = await sendLopuMessage('delete thing-1');
	assert.equal(asked.ok, true);
	const requestId = asked.ok ? asked.requestId : '';
	const card = getLopuStoreSnapshot().turns[requestId]?.tools.find((tool) => tool.id === 't1');
	assert.equal(card?.status, 'confirm');
	assert.equal(card?.confirm?.resolved, null);

	calls.length = 0;
	const confirmed = await confirmLopuTool(requestId, 't1');
	assert.equal(confirmed.ok, true);
	const body = calls.find((call) => call.name === 'reply')?.args as any;
	assert.equal(body.chatId, 'chat-1');
	assert.equal(body.text, 'Confirmed: Delete thing thing-1');
	assert.deepEqual(body.confirmations, [{ key: 'delete_thing:thing-1', token: 'grant' }]);
	assert.equal(getLopuStoreSnapshot().turns[requestId].tools[0].confirm?.resolved, 'confirmed');
	// the approved turn ran the delete
	const ran = confirmed.ok ? getLopuStoreSnapshot().turns[confirmed.requestId].tools[0] : null;
	assert.equal(ran?.status, 'ok');
	// a second press never re-sends the grant
	calls.length = 0;
	const again = await confirmLopuTool(requestId, 't1');
	assert.equal(again.ok, false);
	assert.equal(calls.filter((call) => call.name === 'reply').length, 0);

	// Cancel: local only
	const asked2 = await sendLopuMessage('delete thing-1 again');
	const requestId2 = asked2.ok ? asked2.requestId : '';
	calls.length = 0;
	declineLopuTool(requestId2, 't1');
	assert.equal(getLopuStoreSnapshot().turns[requestId2].tools[0].confirm?.resolved, 'declined');
	assert.equal(calls.length, 0);
	assert.equal((await confirmLopuTool(requestId2, 't1')).ok, false, 'a declined card cannot be confirmed later');

	// a card whose grant never arrived (empty token) cannot be sent
	const asked3 = await sendLopuMessage('delete stale thing-1');
	const requestId3 = asked3.ok ? asked3.requestId : '';
	calls.length = 0;
	const stale = await confirmLopuTool(requestId3, 't1');
	assert.equal(stale.ok, false);
	assert.equal(calls.filter((call) => call.name === 'reply').length, 0);
	assert.equal(getLopuStoreSnapshot().turns[requestId3].tools[0].confirm?.resolved, null);
	resetLopuStoreForTests();
});

test('another conversation can reply while the first stream stays active', async () => {
 resetLopuStoreForTests(); hydrateLopuStore('parallel-owner');
 let controller: ReadableStreamDefaultController<Uint8Array>;
 const emit = (event: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
 const { client } = fakeClient({reply: body => body.chatId === 'first-chat' ? new Response(new ReadableStream({start(c) {controller=c; emit({type:'meta',chatId:body.chatId,userMessageId:'first-user',requestId:body.requestId});}}),{headers:{'Content-Type':'application/x-ndjson'}}) : ndjson([{type:'meta',chatId:body.chatId,userMessageId:'second-user',requestId:body.requestId},{type:'delta',text:'Second complete'},{type:'done',stopReason:'end_turn'}])});
 bindLopuApi(client); selectLopuChat('first-chat');
 const first = sendLopuMessage('First reply'); await flush();
 selectLopuChat('second-chat'); const second = await sendLopuMessage('Second reply');
 assert.equal(second.ok,true);
 assert.equal(Object.values(getLopuStoreSnapshot().turns).find(t=>t.chatId==='first-chat')?.status,'streaming');
 emit({type:'delta',text:'First complete'});emit({type:'done',stopReason:'end_turn'});controller.close();
 assert.equal((await first).ok,true);assert.equal(getLopuStoreSnapshot().activeChatId,'second-chat');
 assert.equal(Object.values(getLopuStoreSnapshot().turns).filter(t=>t.status==='done').length,2);
 resetLopuStoreForTests();
});

test('background conversation reads reject an older account generation, even after switching back', async () => {
  resetLopuStoreForTests(); hydrateLopuStore('viewer-a');
  const { client } = fakeClient(); let resolve!: (value: unknown) => void;
  client.chats.list = () => new Promise(r => { resolve = r; }); bindLopuApi(client);
  const pending = loadLopuChats({ quiet: true });
  hydrateLopuStore('viewer-b'); hydrateLopuStore('viewer-a');
  resolve({ ok: true, chats: [{ id: 'stale', name: 'Stale response' }] }); await pending;
  assert.deepEqual(getLopuStoreSnapshot().chats, []);
});

test('background reads preserve cached conversations on malformed responses and network failures', async () => {
  resetLopuStoreForTests(); hydrateLopuStore('viewer-a');
  const { client } = fakeClient({ chats: [{ id: 'saved', name: 'Saved chat' }] }); bindLopuApi(client);
  await loadLopuChats();
  client.chats.list = async () => ({ ok: false }); await loadLopuChats({ quiet: true });
  assert.equal(getLopuStoreSnapshot().chats[0].id, 'saved');
  client.chats.list = async () => { throw new Error('offline'); }; await loadLopuChats({ quiet: true });
  assert.equal(getLopuStoreSnapshot().chats[0].id, 'saved'); assert.equal(getLopuStoreSnapshot().error, null);
});

test('periodic reads discover new conversations without changing the selected chat', async () => {
  resetLopuStoreForTests(); hydrateLopuStore('viewer-a');
  const { client } = fakeClient({ chats: [{ id: 'first', name: 'First' }] }); bindLopuApi(client);
  await loadLopuChats(); selectLopuChat('first');
  client.chats.list = async () => ({ ok: true, chats: [{ id: 'second', name: 'Created elsewhere' }, { id: 'first', name: 'First' }] });
  await loadLopuChats({ quiet: true });
  assert.equal(getLopuStoreSnapshot().chats.length, 2); assert.equal(getLopuStoreSnapshot().activeChatId, 'first');
  client.messages = async () => ({ ok: true, messages: [{ id: 'remote-message', chatId: 'first', text: 'From another tab', createdAt: '2026-09-16T00:00:00Z' }] });
  await loadLopuMessages('first');
  assert.equal(getLopuStoreSnapshot().messages.first[0].text, 'From another tab');
});

test('an older list read cannot undo a rename and polling waits for the write', async () => {
  const { renameLopuChat } = await import('./lopuChatStore.ts');
  resetLopuStoreForTests(); hydrateLopuStore('viewer-a');
  const { client } = fakeClient({ chats: [{ id: 'first', name: 'Old title' }] }); bindLopuApi(client); await loadLopuChats();
  let resolveRead!: (value: unknown) => void, resolveWrite!: (value: unknown) => void; let reads = 0;
  client.chats.list = () => { reads++; return new Promise(r => { resolveRead = r; }); };
  client.chats.update = () => new Promise(r => { resolveWrite = r; });
  const pendingRead = loadLopuChats({ quiet: true }); const pendingWrite = renameLopuChat('first', 'New title');
  resolveRead({ ok: true, chats: [{ id: 'first', name: 'Old title' }] }); await pendingRead;
  await loadLopuChats({ quiet: true }); assert.equal(reads, 1);
  assert.equal(getLopuStoreSnapshot().chats[0].name, 'New title');
  resolveWrite({ ok: true, chat: { id: 'first', name: 'New title' } }); await pendingWrite;
});

test('a deleted conversation clears cached messages when the read API returns 404', async () => {
  const { getMessengerJson } = await import('../Messenger/messengerRequest.ts');
  resetLopuStoreForTests(); hydrateLopuStore('viewer-a');
  const { client } = fakeClient({ chats: [{ id: 'gone', name: 'Deleted elsewhere' }] }); bindLopuApi(client);
  client.messages = async () => ({ ok: true, messages: [{ id: 'm', chatId: 'gone', text: 'Private history', createdAt: '2026-09-16T00:00:00Z' }] });
  await loadLopuChats(); selectLopuChat('gone'); await loadLopuMessages('gone');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'Chat not found' }), { status: 404 });
    client.messages = () => getMessengerJson('/api/v1/chats/messages?chatId=gone');
    await loadLopuMessages('gone');
    assert.deepEqual(getLopuStoreSnapshot().messages.gone, []);
    assert.equal(getLopuStoreSnapshot().activeChatId, null);
    assert.deepEqual(getLopuStoreSnapshot().chats, []);
  } finally { globalThis.fetch = original; }
});


test('message acceptance releases the composer before the reply stream finishes', async () => {
	resetLopuStoreForTests(); hydrateLopuStore('owner');
	let stream!: ReadableStreamDefaultController<Uint8Array>;
	const encoder = new TextEncoder();
	const { client } = fakeClient({ reply: body => new Response(new ReadableStream({
		start(controller) {
			stream = controller;
			controller.enqueue(encoder.encode(JSON.stringify({ type: 'meta', chatId: 'chat-1', userMessageId: 'u-1', requestId: body.requestId }) + '\n'));
		}
	})) });
	bindLopuApi(client);
	let accepted = 0;
	let finished = false;
	const sending = sendLopuMessage('File attached', { onAccepted: () => { accepted++; } }).then(result => { finished = true; return result; });
	await flush();
	assert.equal(accepted, 1);
	assert.equal(finished, false);
	stream.enqueue(encoder.encode(JSON.stringify({ type: 'done', assistantMessageId: 'a-1', messages: [], stopReason: 'end_turn' }) + '\n'));
	stream.close();
	await sending;
	assert.equal(accepted, 1);
});

test('rejected sends do not release draft attachments', async () => {
	resetLopuStoreForTests(); hydrateLopuStore('owner');
	const { client } = fakeClient({ reply: () => new Response('Unavailable', { status: 503 }) });
	bindLopuApi(client);
	let accepted = false;
	const result = await sendLopuMessage('Retry me', { onAccepted: () => { accepted = true; } });
	assert.equal(result.ok, false);
	assert.equal(accepted, false);
});

const continuationReply = (body: any, reason: string, extra: unknown[] = [], saved = true) => ndjson([
 { type: 'meta', chatId: body.chatId || 'chat-1', userMessageId: `u-${body.requestId}`, requestId: body.requestId, model: body.model || null, effort: body.effort || null, speed: body.speed || 'normal', provider: 'openai', label: 'GPT-5' },
 { type: 'delta', text: 'Progress saved.' }, ...extra,
 { type: 'done', assistantMessageId: saved ? `a-${body.requestId}` : '', messages: [], stopReason: reason }
]);

test('saved budget boundaries automatically continue with fresh IDs and preserve the selected model', async () => {
 resetLopuStoreForTests(); hydrateLopuStore('owner');
 let count = 0, accepted = 0;
 const { client, calls } = fakeClient({ reply: body => continuationReply(body, count++ === 0 ? 'time_limit' : 'end_turn') });
 bindLopuApi(client);
 const result = await sendLopuMessage('Build it', { settings: { model: 'gpt-5', effort: 'high', providerId: null }, onAccepted: () => accepted++, attachmentIds: ['file'], confirmations: [{ key: 'once', token: 'grant' }], context: { route: '/builder', page: { id: 'page', blocks: [] } } });
 assert.equal(result.ok, true);
 const bodies = calls.filter(c => c.name === 'reply').map(c => c.args as any);
 assert.equal(bodies.length, 2);
 assert.equal(bodies[1].chatId, 'chat-1');
 assert.notEqual(bodies[0].requestId, bodies[1].requestId);
 assert.equal(bodies[1].model, 'gpt-5'); assert.equal(bodies[1].effort, 'high');
 assert.match(bodies[1].text, /Do not repeat completed actions/);
 assert.equal(bodies[1].attachmentIds, undefined); assert.equal(bodies[1].confirmations, undefined);
 assert.equal(bodies[1].context.page.blocks, undefined); assert.equal(bodies[1].context.page.id, 'page'); assert.equal(accepted, 1);
 assert.equal(getLopuStoreSnapshot().sending, false);
});

test('automatic continuation has no fixed step or continuation count cap', async () => {
 resetLopuStoreForTests(); hydrateLopuStore('owner');
 let count = 0;
 const { client, calls } = fakeClient({ reply: body => continuationReply(body, count++ < 16 ? 'checkpoint' : 'end_turn') }); bindLopuApi(client);
 await sendLopuMessage('Build it');
 assert.equal(calls.filter(c => c.name === 'reply').length, 17);
});

for (const reason of ['end_turn', 'aborted', 'error', 'fallback']) test(`does not automatically resume ${reason}`, async () => {
 resetLopuStoreForTests(); hydrateLopuStore('owner');
 const { client, calls } = fakeClient({ reply: body => continuationReply(body, reason) }); bindLopuApi(client);
 await sendLopuMessage('Build it'); assert.equal(calls.filter(c => c.name === 'reply').length, 1);
});

for (const scenario of ['unsaved', 'confirmation', 'unfinished-tool', 'account-change', 'stop']) test(`does not auto-continue after ${scenario}`, async () => {
 resetLopuStoreForTests(); hydrateLopuStore('owner');
 const { client, calls } = fakeClient({ reply: body => {
  const extra = scenario === 'confirmation' ? [{ type: 'confirm', id: 'delete', name: 'delete_thing', key: 'delete:x', token: 'grant', expiresAt: '2099-01-01', summary: 'Delete x' }] : scenario === 'unfinished-tool' ? [{ type: 'tool_use_start', id: 'write', name: 'create_thing' }] : [];
  const response = continuationReply(body, 'time_limit', extra, scenario !== 'unsaved');
  if (scenario === 'account-change') hydrateLopuStore('other');
  if (scenario === 'stop') abortLopuTurn();
  return response;
 } }); bindLopuApi(client);
 await sendLopuMessage('Build it'); assert.equal(calls.filter(c => c.name === 'reply').length, 1);
});


test('continuation stays with its original conversation without changing the newly selected chat or model', async () => {
 resetLopuStoreForTests(); hydrateLopuStore('owner');
 let count = 0;
 const { client, calls } = fakeClient({ reply: body => {
  if (count++ === 0) return new Response(new ReadableStream({ async start(controller) {
   const data = continuationReply(body, 'hop_limit');
   controller.enqueue(new Uint8Array(await data.arrayBuffer()));
   await flush();
   selectLopuChat('chat-other'); setLopuSettings({ model: 'another-model' });
   controller.close();
  } }));
  return continuationReply(body, 'end_turn');
 } }); bindLopuApi(client);
 await sendLopuMessage('Build it', { settings: { model: 'gpt-5' } });
 const bodies = calls.filter(c => c.name === 'reply').map(c => c.args as any);
 assert.equal(bodies.length, 2); assert.equal(bodies[1].chatId, 'chat-1'); assert.equal(bodies[1].model, 'gpt-5');
 assert.equal(getLopuStoreSnapshot().activeChatId, 'chat-other'); assert.equal(getLopuStoreSnapshot().settings.model, 'another-model');
});

test('a truncated stream never automatically replays the request', async () => {
 resetLopuStoreForTests(); hydrateLopuStore('owner');
 const { client, calls } = fakeClient({ reply: body => ndjson([
  { type: 'meta', chatId: 'chat-1', userMessageId: 'u-1', requestId: body.requestId, model: null, effort: null, speed: 'normal', provider: 'openai', label: 'AI' },
  { type: 'delta', text: 'Working' }
 ]) }); bindLopuApi(client);
 await sendLopuMessage('Build it'); assert.equal(calls.filter(c => c.name === 'reply').length, 1);
});

test('queued sends retain the target and immutable id without selecting it over another conversation', async () => {
 resetLopuStoreForTests(); hydrateLopuStore('queue-owner');
 let body: any;
 const { client } = fakeClient({ reply: input => { body = input; return ndjson([{type:'meta',chatId:input.chatId,userMessageId:'queued-user',requestId:input.requestId},{type:'delta',text:'Done'},{type:'done',stopReason:'end_turn'}]); } });
 bindLopuApi(client); selectLopuChat('other-chat');
 await sendLopuMessage('first\n\nsecond', { chatId: 'queued-chat', requestId: 'stable-queue-id', settings: { model: 'gpt-5' } });
 assert.equal(body.chatId, 'queued-chat'); assert.equal(body.requestId, 'stable-queue-id');
 assert.equal(getLopuStoreSnapshot().activeChatId, 'other-chat');
});

test('archive and restore preserve selection and prevent an older list refresh undoing the change', async () => {
 resetLopuStoreForTests();
 hydrateLopuStore('archive-owner');
 const { client } = fakeClient({ chats: [{ id: 'chat-archive', name: 'Keep me', lopu: {} }] });
 bindLopuApi(client);
 await loadLopuChats();
 selectLopuChat('chat-archive');
 let finishRead!: (value: any) => void;
 client.chats.list = () => new Promise(resolve => { finishRead = resolve; });
 const read = loadLopuChats();
 let finishWrite!: (value: any) => void;
 client.chats.update = () => new Promise(resolve => { finishWrite = resolve; });
 const write = archiveLopuChat('chat-archive', true);
 assert.equal(getLopuStoreSnapshot().chats[0].lopu?.archived, true);
 assert.equal(getLopuStoreSnapshot().activeChatId, 'chat-archive');
 finishRead({ ok: true, chats: [{ id: 'chat-archive', lopu: {} }] });
 await read;
 finishWrite({ ok: true });
 await write;
 assert.equal(getLopuStoreSnapshot().chats[0].lopu?.archived, true);
 client.chats.update = async args => { assert.equal(args.archived, false); return { ok: true }; };
 assert.equal((await archiveLopuChat('chat-archive', false)).ok, true);
 assert.equal(getLopuStoreSnapshot().chats[0].lopu?.archived, false);
});

test('archive failure rolls back only its own field and never crosses an account switch', async () => {
 resetLopuStoreForTests();
 hydrateLopuStore('archive-owner');
 const { client } = fakeClient({ chats: [{ id: 'chat-archive', name: 'Keep me', lopu: {} }] });
 bindLopuApi(client);
 await loadLopuChats();
 client.chats.update = async () => ({ ok: false, error: 'Unavailable' });
 assert.equal((await archiveLopuChat('chat-archive', true)).ok, false);
 assert.equal(getLopuStoreSnapshot().chats[0].lopu?.archived, false);
 let reject!: (reason: Error) => void;
 client.chats.update = () => new Promise((_resolve, failure) => { reject = failure; });
 const write = archiveLopuChat('chat-archive', true);
 hydrateLopuStore('other-owner');
 reject(new Error('Unavailable'));
 await write;
 assert.deepEqual(getLopuStoreSnapshot().chats, []);
 assert.deepEqual(getLopuStoreSnapshot().notices, []);
});

test('new invite-gated chats can change management without an available model', async () => {
 resetLopuStoreForTests();
 const {client}=fakeClient();
 client.models=async()=>({ok:true,models:MODELS.map(model=>({...model,available:false})),defaults:DEFAULTS,vaultProviders:[],providers:{}});
 bindLopuApi(client); hydrateLopuStore('invite-gated'); await loadLopuModels();
 assert.equal(getLopuStoreSnapshot().activeChatId,null);
 for (const management of ['server','client','server'] as const) {
  setLopuSettings({management}); assert.equal(getLopuStoreSnapshot().settings.management,management);
  assert.equal(getLopuStoreSnapshot().settings.model,null);
 }
 resetLopuStoreForTests();
});
