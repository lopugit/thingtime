import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	bindLopuApi,
	confirmLopuTool,
	declineLopuTool,
	getLopuStoreSnapshot,
	hydrateLopuStore,
	loadLopuChats,
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
