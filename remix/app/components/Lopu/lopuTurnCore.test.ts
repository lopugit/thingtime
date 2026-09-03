import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	buildAssistantMessages,
	buildLopuTimeline,
	buildUserMessage,
	chatTitleFromText,
	decorateLopuTimeline,
	describeLopuCodeBlock,
	describeLopuStatusLine,
	describeLopuTurnMeta,
	initialLopuTurn,
	isLopuAssistantMessage,
	isLopuChatEvent,
	isOptimisticLopuMessage,
	isSiteRelativePath,
	LIVE_PREVIEW_TOOLS,
	LOPU_TOOL_DETAILS_MAX_CHARS,
	lopuMessageMeta,
	markLopuTurnAborted,
	markLopuTurnFailed,
	mergeMessages,
	parseLopuInlines,
	parseLopuMarkdown,
	pendingUserMessageId,
	reduceLopuTurn,
	toolLabel,
	toolLinks,
	toolRowDetails,
	toolRowSummary,
	type LopuChatEvent,
	type LopuTurnState,
	lopuPlainText,
	confirmationMessageText,
	isLopuConfirmUsable,
	resolveLopuToolConfirm
} from './lopuTurnCore.ts';

const fold = (events: LopuChatEvent[], start?: LopuTurnState): LopuTurnState =>
	events.reduce((state, event) => reduceLopuTurn(state, event), start ?? initialLopuTurn({ requestId: 'req-1', userText: 'hello', startedAt: 1000 }));

const META: LopuChatEvent = {
	type: 'meta',
	chatId: 'chat-1',
	userMessageId: 'msg-user',
	requestId: 'req-1',
	model: 'claude-opus-5',
	effort: 'high',
	speed: 'normal',
	provider: 'claude',
	label: 'Claude Opus 5'
};

test('initial turn is streaming with a pending user id and no content', () => {
	const turn = initialLopuTurn({ requestId: 'req-1', chatId: null, userText: 'hi', startedAt: 5 });
	assert.equal(turn.status, 'streaming');
	assert.equal(turn.userMessageId, pendingUserMessageId('req-1'));
	assert.equal(turn.text, '');
	assert.deepEqual(turn.tools, []);
	assert.equal(turn.sequence, 0);
});

test('meta adopts the chat id and the persisted user message id', () => {
	const turn = fold([META]);
	assert.equal(turn.chatId, 'chat-1');
	assert.equal(turn.userMessageId, 'msg-user');
	assert.equal(turn.meta?.provider, 'claude');
	assert.equal(turn.meta?.model, 'claude-opus-5');
	assert.equal(turn.sequence, 1);
});

test('deltas accumulate text and stay in one text segment', () => {
	const turn = fold([META, { type: 'delta', text: 'Hello ' }, { type: 'delta', text: 'there' }]);
	assert.equal(turn.text, 'Hello there');
	assert.deepEqual(turn.segments, [{ kind: 'text', text: 'Hello there' }]);
	// an empty delta is a no-op — no paint forced
	assert.equal(reduceLopuTurn(turn, { type: 'delta', text: '' }), turn);
});

test('the tool lifecycle: start → input deltas → use → result, interleaved with prose', () => {
	const turn = fold([
		META,
		{ type: 'delta', text: 'Building it. ' },
		{ type: 'tool_use_start', id: 't1', name: 'create_component' },
		{ type: 'tool_input_delta', id: 't1', name: 'create_component', partial: '{"name":"Ca' },
		{ type: 'tool_input_delta', id: 't1', name: 'create_component', partial: 'rd"}' },
		{ type: 'tool_use', id: 't1', name: 'create_component', input: { name: 'Card' } },
		{ type: 'delta', text: 'Done!' }
	]);
	assert.equal(turn.tools.length, 1);
	const [tool] = turn.tools;
	assert.equal(tool.status, 'running');
	assert.equal(tool.partialInput, '{"name":"Card"}');
	assert.deepEqual(tool.input, { name: 'Card' });
	assert.deepEqual(turn.segments, [
		{ kind: 'text', text: 'Building it. ' },
		{ kind: 'tool', id: 't1' },
		{ kind: 'text', text: 'Done!' }
	]);

	const finished = reduceLopuTurn(turn, { type: 'tool_result', id: 't1', name: 'create_component', ok: true, summary: 'Created Card', data: { thing: { id: 'c1' } } });
	assert.equal(finished.tools[0].status, 'ok');
	assert.equal(finished.tools[0].result?.summary, 'Created Card');
	assert.deepEqual(finished.tools[0].result?.data, { thing: { id: 'c1' } });

	const failed = reduceLopuTurn(turn, { type: 'tool_result', id: 't1', name: 'create_component', ok: false, summary: 'render is required' });
	assert.equal(failed.tools[0].status, 'error');
});

test('a tool_input_delta for an unseen id creates the activity (providers may skip tool_use_start)', () => {
	const turn = fold([META, { type: 'tool_input_delta', id: 'tx', name: 'patch_page', partial: '{"ops":[' }]);
	assert.equal(turn.tools.length, 1);
	assert.equal(turn.tools[0].name, 'patch_page');
	assert.equal(turn.tools[0].status, 'streaming');
	assert.deepEqual(turn.segments, [{ kind: 'tool', id: 'tx' }]);
});

test('patch and thing events attach to their tool and to the turn', () => {
	const block = { id: 'hero', type: 'text' as const, text: 'Hi', style: 'heading' as const };
	const turn = fold([
		META,
		{ type: 'tool_use_start', id: 'p1', name: 'patch_page' },
		{ type: 'tool_use', id: 'p1', name: 'patch_page', input: { target: 'active', ops: [] } },
		{ type: 'patch', id: 'p1', target: 'active', ops: [{ op: 'insert', containerId: null, index: 'end', block }], pageId: 'page-9', persisted: true },
		{ type: 'thing', id: 'p1', kind: 'webpage', thing: { id: 'page-9', thingtime: ['webpage'], crystal: { name: 'Home', blocks: [block] } } },
		{ type: 'tool_result', id: 'p1', name: 'patch_page', ok: true, summary: 'Inserted 1 block' }
	]);
	assert.equal(turn.patches.length, 1);
	assert.equal(turn.patches[0].pageId, 'page-9');
	assert.equal(turn.patches[0].persisted, true);
	assert.equal(turn.things.length, 1);
	assert.equal(turn.tools[0].patch?.ops.length, 1);
	assert.equal(turn.tools[0].thing?.thing.id, 'page-9');
	assert.equal(turn.tools[0].status, 'ok');
	assert.deepEqual(toolLinks(turn.tools[0]), [{ label: 'Open Home in the builder', href: '/builder?page=page-9' }]);
});

test('a thing event for an id that is not a tool falls back to the active tool', () => {
	const turn = fold([
		META,
		{ type: 'tool_use_start', id: 'c1', name: 'create_component' },
		{ type: 'tool_use', id: 'c1', name: 'create_component', input: {} },
		{ type: 'thing', id: 'other-id', kind: 'component', thing: { id: 'comp-1', thingtime: ['component'], crystal: { name: 'Card', componentKey: 'card' } } }
	]);
	assert.equal(turn.tools[0].thing?.thing.id, 'comp-1');
	assert.deepEqual(toolLinks(turn.tools[0]), [{ label: 'Open Card', href: '/components/card' }]);
});

test('a repeated thing event for the same thing id replaces the earlier record', () => {
	const turn = fold([
		META,
		{ type: 'tool_use_start', id: 'u1', name: 'update_component' },
		{ type: 'thing', id: 'u1', kind: 'component', thing: { id: 'comp-1', crystal: { name: 'v1' } } },
		{ type: 'thing', id: 'u1', kind: 'component', thing: { id: 'comp-1', crystal: { name: 'v2' } } }
	]);
	assert.equal(turn.things.length, 1);
	assert.equal(turn.things[0].thing.crystal?.name, 'v2');
});

test('navigate only accepts site-relative paths', () => {
	assert.equal(fold([META, { type: 'navigate', path: '/builder?page=x' }]).navigate, '/builder?page=x');
	assert.equal(fold([META, { type: 'navigate', path: 'https://evil.example' }]).navigate, null);
	assert.equal(fold([META, { type: 'navigate', path: '//evil.example' }]).navigate, null);
	assert.equal(isSiteRelativePath('/ok'), true);
	assert.equal(isSiteRelativePath('/builder?page=p1&x=(1)'), true);
	// eslint-disable-next-line no-script-url -- the literal IS the thing under test
	assert.equal(isSiteRelativePath('javascript:alert(1)'), false);
	assert.equal(isSiteRelativePath('/has space'), false);
	// a backslash reads as a slash to the browser: "/\evil.com" resolves to
	// https://evil.com/ — the server's navigate guard and this one agree
	assert.equal(isSiteRelativePath('/\\evil.example'), false);
	assert.equal(isSiteRelativePath('/ok/\\evil.example'), false);
	assert.equal(isSiteRelativePath('/ok"x'), false);
	assert.equal(isSiteRelativePath("/ok'x"), false);
	assert.equal(isSiteRelativePath('/ok<x'), false);
	assert.equal(fold([META, { type: 'navigate', path: '/\\evil.example' }]).navigate, null);
	assert.deepEqual(parseLopuInlines('[Open your page](/\\evil.example)'), [{ kind: 'text', text: 'Open your page (/\\evil.example)' }]);
});

test('a confirm event turns the tool into a Confirm card; the card resolves once and knows when its grant is stale', () => {
	const future = new Date(Date.now() + 60_000).toISOString();
	const turn = fold([
		META,
		{ type: 'tool_use_start', id: 't1', name: 'delete_thing' },
		{ type: 'tool_use', id: 't1', name: 'delete_thing', input: { id: 'thing-1' } },
		{ type: 'confirm', id: 't1', name: 'delete_thing', key: 'delete_thing:thing-1', token: 'grant', expiresAt: future, summary: 'Delete "Landing" (thing thing-1)', subject: { id: 'thing-1', name: 'Landing' } },
		{ type: 'tool_result', id: 't1', name: 'delete_thing', ok: false, summary: 'Waiting for the user’s confirmation', needsConfirmation: true },
		{ type: 'delta', text: 'Please confirm.' },
		{ type: 'done', assistantMessageId: 'a1', messages: [], stopReason: 'end_turn' }
	]);
	const [tool] = turn.tools;
	assert.equal(tool.status, 'confirm', 'done never downgrades a card to error');
	assert.deepEqual(tool.confirm, { key: 'delete_thing:thing-1', token: 'grant', expiresAt: future, summary: 'Delete "Landing" (thing thing-1)', subject: { id: 'thing-1', name: 'Landing' }, resolved: null });
	assert.equal(tool.result?.needsConfirmation, true);
	assert.equal(toolLabel('delete_thing', 'confirm'), 'Needs your confirmation');
	assert.equal(toolRowSummary(tool), 'Delete "Landing" (thing thing-1)');
	assert.equal(isLopuConfirmUsable(tool.confirm), true);
	assert.equal(confirmationMessageText(tool.confirm!), 'Confirmed: Delete "Landing" (thing thing-1)');

	const confirmed = resolveLopuToolConfirm(turn, 't1', 'confirmed');
	assert.equal(confirmed.tools[0].confirm?.resolved, 'confirmed');
	assert.equal(isLopuConfirmUsable(confirmed.tools[0].confirm), false, 'a spent grant is never re-sent');
	assert.equal(resolveLopuToolConfirm(confirmed, 't1', 'declined'), confirmed, 'resolving twice is a no-op');
	assert.equal(resolveLopuToolConfirm(turn, 'missing', 'declined'), turn);
	assert.equal(isLopuConfirmUsable({ token: 'grant', expiresAt: new Date(Date.now() - 1000).toISOString(), resolved: null }), false, 'expired');
	assert.equal(isLopuConfirmUsable({ token: '', expiresAt: future, resolved: null }), false, 'no grant was minted');

	// needsConfirmation without a preceding confirm event is a plain failure
	const bare = fold([META, { type: 'tool_use', id: 't2', name: 'delete_thing', input: { id: 'x' } }, { type: 'tool_result', id: 't2', name: 'delete_thing', ok: false, summary: 'Waiting', needsConfirmation: true }]);
	assert.equal(bare.tools[0].status, 'error');
	// a malformed confirm event is ignored
	assert.equal(fold([META, { type: 'confirm', id: 't3', name: 'delete_thing', key: '', token: 'x', expiresAt: future, summary: '' } as LopuChatEvent]).tools.length, 0);
});

test('error events record the error and fail in-flight tools; done closes the turn', () => {
	const errored = fold([
		META,
		{ type: 'tool_use_start', id: 't1', name: 'run_action' },
		{ type: 'error', message: 'Too many tools', retryable: false }
	]);
	assert.deepEqual(errored.error, { message: 'Too many tools', retryable: false });
	assert.equal(errored.status, 'streaming');
	assert.equal(errored.tools[0].status, 'error');

	const done = reduceLopuTurn(errored, {
		type: 'done',
		assistantMessageId: 'msg-a',
		messages: [],
		usage: { inputTokens: 10, outputTokens: 20 },
		stopReason: 'end_turn'
	});
	assert.equal(done.status, 'done');
	assert.equal(done.assistantMessageId, 'msg-a');
	assert.deepEqual(done.usage, { inputTokens: 10, outputTokens: 20 });
	assert.equal(done.stopReason, 'end_turn');
});

test('markLopuTurnFailed / markLopuTurnAborted are idempotent and only touch streaming turns', () => {
	const streaming = fold([META, { type: 'delta', text: 'partial' }, { type: 'tool_use_start', id: 't1', name: 'get_thing' }]);
	const failed = markLopuTurnFailed(streaming, 'network');
	assert.equal(failed.status, 'error');
	assert.equal(failed.error?.message, 'network');
	assert.equal(failed.tools[0].status, 'error');
	assert.equal(markLopuTurnFailed(failed, 'again'), failed);

	const aborted = markLopuTurnAborted(streaming);
	assert.equal(aborted.status, 'aborted');
	assert.equal(aborted.text, 'partial');
	assert.equal(markLopuTurnAborted(aborted), aborted);
	const done = reduceLopuTurn(streaming, { type: 'done' });
	assert.equal(markLopuTurnAborted(done), done);
});

test('unknown events leave the state untouched', () => {
	const turn = fold([META]);
	assert.equal(reduceLopuTurn(turn, { type: 'sparkle' } as unknown as LopuChatEvent), turn);
	assert.equal(isLopuChatEvent({ type: 'delta', text: 'x' }), true);
	assert.equal(isLopuChatEvent({ text: 'x' }), false);
	assert.equal(isLopuChatEvent(null), false);
});

test('tool labels read naturally in every state and unknown tools humanise', () => {
	assert.equal(toolLabel('create_component', 'streaming'), 'Building a component');
	assert.equal(toolLabel('create_component', 'running'), 'Building a component');
	assert.equal(toolLabel('create_component', 'ok'), 'Built a component');
	assert.equal(toolLabel('create_component', 'error'), "Couldn't finish: building a component");
	assert.equal(toolLabel('summon_dragons', 'ok'), 'Summon dragons');
	assert.ok(LIVE_PREVIEW_TOOLS.has('patch_page'));
	assert.ok(!LIVE_PREVIEW_TOOLS.has('search_things'));
});

test('tool links cover pages, components, actions and result data, deduplicated', () => {
	const turn = fold([
		META,
		{ type: 'tool_use_start', id: 'a1', name: 'create_action' },
		{ type: 'thing', id: 'a1', kind: 'action', thing: { id: 'act-1', thingtime: ['action'], crystal: { name: 'Pong', actionKey: 'pong' } } },
		{ type: 'tool_result', id: 'a1', name: 'create_action', ok: true, summary: 'ok', data: { thing: { id: 'act-1', thingtime: ['action'], crystal: { name: 'Pong', actionKey: 'pong' } }, pageId: 'page-2' } }
	]);
	assert.deepEqual(toolLinks(turn.tools[0]), [
		{ label: 'Open Pong', href: '/actions/pong' },
		{ label: 'Open in the builder', href: '/builder?page=page-2' }
	]);
	const nav = fold([META, { type: 'tool_use_start', id: 'n1', name: 'navigate' }, { type: 'tool_use', id: 'n1', name: 'navigate', input: { path: '/feed' } }]);
	assert.deepEqual(toolLinks(nav.tools[0]), [{ label: 'Go to /feed', href: '/feed' }]);
});

test('chat titles come from the first non-empty line, collapsed and capped', () => {
	assert.equal(chatTitleFromText('\n\n  Build me a   landing page \n more'), 'Build me a landing page');
	assert.equal(chatTitleFromText(''), 'New chat');
	const long = chatTitleFromText('x'.repeat(200));
	assert.equal(long.length, 60);
	assert.ok(long.endsWith('…'));
});

test('markdown: paragraphs, inline code, bold/italic, lists, headings, fenced code — and never raw HTML', () => {
	const blocks = parseLopuMarkdown(
		'# Title\n\nHello **world** with `code` and *emphasis*.\n\n- one\n- two\n\n1. first\n2. second\n\n```ts\nconst x = 1;\n```\n\n<script>alert(1)</script>'
	);
	assert.equal(blocks[0].kind, 'heading');
	assert.equal(blocks[1].kind, 'paragraph');
	if (blocks[1].kind === 'paragraph') {
		assert.deepEqual(blocks[1].inlines, [
			{ kind: 'text', text: 'Hello ' },
			{ kind: 'strong', text: 'world' },
			{ kind: 'text', text: ' with ' },
			{ kind: 'code', text: 'code' },
			{ kind: 'text', text: ' and ' },
			{ kind: 'em', text: 'emphasis' },
			{ kind: 'text', text: '.' }
		]);
	}
	assert.equal(blocks[2].kind, 'list');
	if (blocks[2].kind === 'list') {
		assert.equal(blocks[2].ordered, false);
		assert.equal(blocks[2].items.length, 2);
	}
	assert.equal(blocks[3].kind, 'list');
	if (blocks[3].kind === 'list') assert.equal(blocks[3].ordered, true);
	assert.deepEqual(blocks[4], { kind: 'code', lang: 'ts', text: 'const x = 1;', open: false });
	// raw HTML survives only as literal text inside a paragraph
	assert.equal(blocks[5].kind, 'paragraph');
	if (blocks[5].kind === 'paragraph') assert.deepEqual(blocks[5].inlines, [{ kind: 'text', text: '<script>alert(1)</script>' }]);
});

test('markdown: an unterminated fence streams as an open code block', () => {
	const blocks = parseLopuMarkdown('Look:\n```json\n{"a":');
	assert.equal(blocks.length, 2);
	assert.deepEqual(blocks[1], { kind: 'code', lang: 'json', text: '{"a":', open: true });
	assert.deepEqual(parseLopuInlines(''), []);
	assert.deepEqual(parseLopuMarkdown(''), []);
});

test('markdown: links are site-relative only — anything else is demoted to plain text', () => {
	assert.deepEqual(parseLopuInlines('Open [the builder](/builder?page=p1) now'), [
		{ kind: 'text', text: 'Open ' },
		{ kind: 'link', text: 'the builder', href: '/builder?page=p1' },
		{ kind: 'text', text: ' now' }
	]);
	assert.deepEqual(parseLopuInlines('See [docs](https://evil.example/x)'), [
		{ kind: 'text', text: 'See ' },
		{ kind: 'text', text: 'docs (https://evil.example/x)' }
	]);
	assert.deepEqual(parseLopuInlines('[x](//evil.example) and [y](javascript:alert(1))'), [
		{ kind: 'text', text: 'x (//evil.example)' },
		{ kind: 'text', text: ' and ' },
		{ kind: 'text', text: 'y (javascript:alert(1))' }
	]);
	// a link inside inline code stays code
	assert.deepEqual(parseLopuInlines('`[a](/b)`'), [{ kind: 'code', text: '[a](/b)' }]);
});

test('code blocks describe themselves for the header + copy button', () => {
	assert.deepEqual(describeLopuCodeBlock({ kind: 'code', lang: 'ts', text: 'const x = 1;\nconst y = 2;\n\n', open: false }), {
		label: 'TS',
		clipboardText: 'const x = 1;\nconst y = 2;',
		copyable: true,
		lines: 2
	});
	const open = describeLopuCodeBlock({ kind: 'code', lang: null, text: '{"a":', open: true });
	assert.equal(open.label, 'CODE');
	assert.equal(open.copyable, false, 'a streaming block is not copyable yet');
	assert.equal(describeLopuCodeBlock({ kind: 'code', lang: 'sh', text: '   ', open: false }).copyable, false);
	assert.equal(describeLopuCodeBlock({ kind: 'code', lang: 'averyveryverylonglanguage', text: 'x', open: false }).label.length, 12);
});

test('persisted assistant rows expose their lopu meta (provider, tool calls) defensively', () => {
	assert.equal(lopuMessageMeta(null), null);
	assert.equal(lopuMessageMeta({ lopu: 'nope' }), null);
	const meta = lopuMessageMeta({
		lopu: {
			role: 'assistant',
			model: 'gpt-5',
			effort: 'high',
			speed: 'fast',
			provider: 'vault',
			providerLabel: 'Acme proxy',
			usage: { inputTokens: 10, outputTokens: '2' },
			toolCalls: [{ name: 'create_page', ok: true, summary: 'Created Home', thingId: 'p1' }, { name: '', ok: true }, 'junk', { name: 'get_thing', ok: 'no' }],
			stopReason: 'end_turn'
		}
	});
	assert.equal(meta?.provider, 'vault');
	assert.equal(meta?.providerLabel, 'Acme proxy');
	assert.deepEqual(meta?.usage, { inputTokens: 10 });
	assert.deepEqual(meta?.toolCalls, [
		{ name: 'create_page', ok: true, summary: 'Created Home', thingId: 'p1' },
		{ name: 'get_thing', ok: false, summary: '', thingId: null }
	]);
	assert.equal(lopuMessageMeta({ lopu: { provider: 'martian' } })?.provider, null);
});

test('turn meta and status lines read as one calm line', () => {
	assert.equal(describeLopuTurnMeta(null), null);
	assert.equal(describeLopuTurnMeta({ provider: 'fallback', label: null, model: null, effort: null, speed: null }), "from Lopu's little book");
	assert.equal(describeLopuTurnMeta({ provider: 'claude', label: 'Claude Opus 5', model: 'claude-opus-5', effort: 'high', speed: 'fast' }), 'via Claude Opus 5 · High · Fast');
	assert.equal(describeLopuTurnMeta({ provider: 'vault', label: null, model: 'gpt-4o', effort: null, speed: null, providerLabel: 'Acme proxy' }), 'via Acme proxy · gpt-4o');
	assert.equal(describeLopuTurnMeta({ provider: 'vault', label: null, model: null, effort: null, speed: null }), 'via your provider');
	const base = { model: 'gpt-5', effort: 'high', speed: 'normal', providerId: null, modelLabels: { 'gpt-5': 'GPT-5' }, providerNames: { 'vp-1': 'Acme proxy' } };
	assert.equal(describeLopuStatusLine(base), 'GPT-5 · High');
	assert.equal(describeLopuStatusLine({ ...base, speed: 'fast' }), 'GPT-5 · High · Fast');
	assert.equal(describeLopuStatusLine({ ...base, providerId: 'vp-1' }), 'Acme proxy');
	assert.equal(describeLopuStatusLine({ ...base, providerId: 'ghost' }), 'Your provider');
	assert.equal(describeLopuStatusLine({ ...base, streaming: true }), 'Replying…');
	assert.equal(describeLopuStatusLine({ ...base, streaming: true, listening: true }), 'Listening…');
	assert.equal(describeLopuStatusLine({ ...base, model: null }), 'Choosing a model');
	assert.equal(describeLopuStatusLine({ ...base, model: null, modelLabels: {} }), 'Ready');
});

test('tool rows: a one-line summary and a bounded details drawer', () => {
	const turn = fold([
		META,
		{ type: 'tool_use_start', id: 't1', name: 'create_component' },
		{ type: 'tool_input_delta', id: 't1', name: 'create_component', partial: '{"name":"Ca' },
		{ type: 'tool_use', id: 't1', name: 'create_component', input: { name: 'Card', render: { tag: 'div' } } },
		{ type: 'tool_result', id: 't1', name: 'create_component', ok: true, summary: 'Created Card\nwith two props', data: { thing: { id: 'c1' } } }
	]);
	const [tool] = turn.tools;
	assert.equal(toolRowSummary(tool), 'Created Card');
	const details = toolRowDetails(tool);
	assert.equal(details.hasDetails, true);
	assert.equal(details.input, JSON.stringify({ name: 'Card', render: { tag: 'div' } }, null, 2));
	assert.ok(details.result?.includes('"summary": "Created Card\\nwith two props"'));
	// streaming: the partial fragment stands in for the input
	const streaming = fold([META, { type: 'tool_input_delta', id: 't2', name: 'patch_page', partial: '{"ops":[' }]);
	assert.equal(toolRowDetails(streaming.tools[0]).input, '{"ops":[');
	assert.equal(toolRowSummary(streaming.tools[0]), '');
	assert.equal(toolRowSummary({ name: 'get_thing', status: 'error', result: null }), 'This step did not finish.');
	const long = toolRowSummary({ name: 'x', status: 'ok', result: { ok: true, summary: 'y'.repeat(400) } });
	assert.equal(long.length, 140);
	assert.ok(long.endsWith('…'));
	const huge = toolRowDetails({ input: { blob: 'z'.repeat(LOPU_TOOL_DETAILS_MAX_CHARS * 2) }, partialInput: '', result: null });
	assert.ok(huge.input!.length < LOPU_TOOL_DETAILS_MAX_CHARS + 32);
	assert.ok(huge.input!.endsWith('… (truncated)'));
	assert.equal(toolRowDetails({ input: null, partialInput: '', result: null }).hasDetails, false);
});

test('the timeline decorates same-author runs and time gaps for drawing', () => {
	const at = (ms: number) => new Date(ms).toISOString();
	const user = (id: string, ms: number) => ({ ...buildUserMessage(initialLopuTurn({ requestId: id, userText: id, startedAt: ms }), 'u1', 'chat-1'), id, createdAt: at(ms) });
	const lopu = (id: string, ms: number) => ({ ...user(id, ms), externalSource: { provider: 'lopu', role: 'assistant' } as any });
	const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);
	const messages = [user('u1', T0), user('u2', T0 + 30_000), lopu('a1', T0 + 60_000), lopu('a2', T0 + 90_000), user('u3', T0 + 40 * 60_000), lopu('a3', T0 + 41 * 60_000)];
	const rows = decorateLopuTimeline(buildLopuTimeline(messages, [], 'u1'), { now: T0 + 3_600_000, format: (value) => `sep:${(value - T0) / 60_000}` });
	assert.deepEqual(
		rows.map((row) => `${row.role}:${row.first ? 'F' : '-'}${row.last ? 'L' : '-'}${row.separator ? `[${row.separator}]` : ''}`),
		['user:F-[sep:0]', 'user:-L', 'assistant:F-', 'assistant:-L', 'user:FL[sep:40]', 'assistant:FL']
	);
	// a session turn sits in the assistant run right after its user row
	const turn = fold([{ ...META, userMessageId: 'u3' }, { type: 'delta', text: 'hi' }], initialLopuTurn({ requestId: 'r3', userText: 'u3', startedAt: T0 + 40 * 60_000 + 500 }));
	const withTurn = decorateLopuTimeline(buildLopuTimeline(messages.slice(0, 5), [turn], 'u1'), { now: T0 + 3_600_000, format: () => 'sep' });
	const last = withTurn[withTurn.length - 1];
	assert.equal(last.item.kind, 'turn');
	assert.equal(last.first, true);
	assert.equal(last.separator, null);
	assert.deepEqual(decorateLopuTimeline([]), []);
});

test('optimistic messages: user row re-keys after meta, assistant rows prefer the persisted segments', () => {
	const before = initialLopuTurn({ requestId: 'req-1', userText: 'hi', startedAt: 1000 });
	assert.equal(buildUserMessage(before, 'u1', 'chat-x').id, pendingUserMessageId('req-1'));
	const after = fold([META, { type: 'delta', text: 'Hey!' }], before);
	const user = buildUserMessage(after, 'u1');
	assert.equal(user.id, 'msg-user');
	assert.equal(user.chatId, 'chat-1');
	assert.equal(user.text, 'hi');

	const optimistic = buildAssistantMessages(reduceLopuTurn(after, { type: 'done' }), 'u1', 2000);
	assert.equal(optimistic.length, 1);
	assert.equal(optimistic[0].text, 'Hey!');
	assert.equal(isLopuAssistantMessage(optimistic[0]), true);
	assert.equal(isLopuAssistantMessage(user), false);

	const persisted = buildUserMessage(after, 'u1');
	const doneWithRows = reduceLopuTurn(after, { type: 'done', assistantMessageId: 'a1', messages: [{ ...persisted, id: 'a1', text: 'server copy' }] });
	assert.equal(buildAssistantMessages(doneWithRows, 'u1')[0].text, 'server copy');

	const aborted = buildAssistantMessages(markLopuTurnAborted(after), 'u1', 2000);
	assert.ok(aborted[0].text.endsWith('_(stopped)_'));
	const empty = buildAssistantMessages(markLopuTurnAborted(fold([META], before)), 'u1', 2000);
	assert.deepEqual(empty, []);
});

test('optimistic assistant rows are flagged so a server page can replace them', () => {
	const turn = fold([META, { type: 'delta', text: 'Hey!' }, { type: 'done' }]);
	const [row] = buildAssistantMessages(turn, 'u1', 2000);
	assert.equal(isOptimisticLopuMessage(row), true);
	assert.equal(isOptimisticLopuMessage(buildUserMessage(turn, 'u1')), false);
	assert.equal(isOptimisticLopuMessage(null), false);
});

test('the timeline places turns after their user row, absorbs the Lopu rows that follow, and appends unplaced turns', () => {
	const at = (ms: number) => new Date(ms).toISOString();
	const user = (id: string, ms: number): ReturnType<typeof buildUserMessage> => ({ ...buildUserMessage(initialLopuTurn({ requestId: id, userText: id, startedAt: ms }), 'u1', 'chat-1'), id });
	const lopu = (id: string, ms: number) => ({ ...user(id, ms), externalSource: { provider: 'lopu', role: 'assistant' } as any });
	const system = { ...user('sys', 50), systemType: 'chat-created' };
	const older = fold([{ ...META, userMessageId: 'u-1' }, { type: 'delta', text: 'first reply' }, { type: 'done', messages: [lopu('a-1', 200)] }]);
	const streaming = fold([{ ...META, userMessageId: 'u-2' }, { type: 'delta', text: 'second…' }]);
	const unplaced = fold([{ ...META, userMessageId: 'u-3' }], initialLopuTurn({ requestId: 'req-3', userText: 'third', startedAt: 900 }));
	const messages = [system, user('u-1', 100), lopu('a-1', 200), lopu('a-1b', 210), user('u-2', 300), lopu('a-2', 400), user('u-x', 500), lopu('a-x', 600)];
	const items = buildLopuTimeline(messages, [older, streaming, unplaced], 'u1');
	assert.deepEqual(
		items.map((item) => (item.kind === 'turn' ? `turn:${item.turn.userMessageId}` : `${item.role}:${item.message.id}`)),
		['user:u-1', 'turn:u-1', 'user:u-2', 'turn:u-2', 'user:u-x', 'assistant:a-x', 'user:u-3', 'turn:u-3']
	);
	// a plain reload (no session turns) draws every persisted row
	assert.equal(buildLopuTimeline(messages, [], 'u1').length, messages.length - 1);
	assert.equal(at(0), '1970-01-01T00:00:00.000Z');
});

test('mergeMessages dedupes by id, re-keys pending rows and orders oldest first', () => {
	const base = initialLopuTurn({ requestId: 'req-1', userText: 'hi', startedAt: 1000 });
	const pending = buildUserMessage(base, 'u1', 'chat-1');
	const later = { ...pending, id: 'later', createdAt: new Date(3000).toISOString() };
	const merged = mergeMessages([later, pending], [{ ...pending, id: 'msg-user', text: 'hi (server)' }], { [pending.id]: 'msg-user' });
	assert.deepEqual(
		merged.map((message) => message.id),
		['msg-user', 'later']
	);
	assert.equal(merged[0].text, 'hi (server)');
});

test('lopuPlainText drops markdown markers for conversation previews', () => {
	assert.equal(lopuPlainText('Hello! I can build **pages**, `sections`.\n\n_(reply stopped)_'), 'Hello! I can build pages, sections. (reply stopped)');
	assert.equal(lopuPlainText('# Title\n- one\n- *two*\n[Open](/p/x)'), 'Title one · two Open');
	assert.equal(lopuPlainText(''), '');
});
