import assert from 'node:assert/strict';
import test from 'node:test';

import { publicExternalAiSource, publicLopuMessageMeta } from './externalAi.ts';
import {
	LOPU_CHAT_SOURCE,
	LOPU_HISTORY_MAX_CHARS,
	buildLopuHistory,
	isLopuChatDoc,
	isLopuSource,
	lopuAssistantMessageShareId,
	lopuAssistantSource,
	lopuChatShareId,
	lopuChatStateOf,
	lopuUserMessageShareId,
	normalizeLopuChatSettings
} from './lopuChats.ts';

test('normalizeLopuChatSettings accepts catalog models, composed ids and null resets', () => {
	const plain = normalizeLopuChatSettings({ model: 'claude-opus-5', effort: 'high', speed: 'fast' });
	assert.deepEqual(plain, { ok: true, settings: { model: 'claude-opus-5', effort: 'high', speed: 'fast', providerId: null }, changed: true });

	const composed = normalizeLopuChatSettings({ model: 'claude-opus-5:max:fast' });
	assert.deepEqual(composed, { ok: true, settings: { model: 'claude-opus-5', effort: 'max', speed: 'fast', providerId: null }, changed: true });

	const explicitWins = normalizeLopuChatSettings({ model: 'claude-opus-5:max', effort: 'low' });
	assert.equal(explicitWins.ok, true);
	assert.equal((explicitWins as any).settings.effort, 'low');

	const untouched = normalizeLopuChatSettings({}, { model: 'gpt-5.5', effort: 'high', speed: null });
	assert.deepEqual(untouched, { ok: true, settings: { model: 'gpt-5.5', effort: 'high', speed: null, providerId: null }, changed: false });

	const reset = normalizeLopuChatSettings({ model: null, effort: '', speed: null }, { model: 'gpt-5.5', effort: 'high', speed: 'fast' });
	assert.deepEqual(reset, { ok: true, settings: { model: null, effort: null, speed: null, providerId: null }, changed: true });

	// the 'default' sentinel is not a pinned model
	assert.deepEqual(normalizeLopuChatSettings({ model: 'default' }), { ok: true, settings: { model: null, effort: null, speed: null, providerId: null }, changed: false });
});

test('normalizeLopuChatSettings rejects unknown models and unsupported explicit knobs, clamps inherited ones', () => {
	const unknown = normalizeLopuChatSettings({ model: 'gpt-9000' });
	assert.equal(unknown.ok, false);
	assert.equal((unknown as any).status, 400);

	assert.equal(normalizeLopuChatSettings({ model: 42 }).ok, false);
	assert.equal(normalizeLopuChatSettings({ effort: 'turbo' }).ok, false);
	assert.equal(normalizeLopuChatSettings({ speed: 'warp' }).ok, false);

	// haiku has no effort tiers and no fast lane — explicit asks are 400s
	assert.equal(normalizeLopuChatSettings({ model: 'claude-haiku-4-5', effort: 'high' }).ok, false);
	assert.equal(normalizeLopuChatSettings({ model: 'claude-haiku-4-5', speed: 'fast' }).ok, false);
	assert.equal(normalizeLopuChatSettings({ model: 'claude-haiku-4-5:fast' }).ok, false);

	// switching models under inherited settings clamps instead of failing
	const clamped = normalizeLopuChatSettings({ model: 'claude-haiku-4-5' }, { model: 'claude-opus-5', effort: 'max', speed: 'fast' });
	assert.deepEqual(clamped, { ok: true, settings: { model: 'claude-haiku-4-5', effort: null, speed: null, providerId: null }, changed: true });
	const preferHigh = normalizeLopuChatSettings({ model: 'gpt-5' }, { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' });
	assert.deepEqual(preferHigh, { ok: true, settings: { model: 'gpt-5', effort: 'high', speed: 'fast', providerId: null }, changed: true });
	// a null (catalog default) model accepts any known effort token
	assert.equal(normalizeLopuChatSettings({ effort: 'ultra' }).ok, true);
});

test('lopuChatStateOf reads stored settings forgivingly', () => {
	assert.deepEqual(lopuChatStateOf(undefined), { model: null, effort: null, speed: null, providerId: null, turns: 0, lastModel: null });
	assert.deepEqual(lopuChatStateOf({ model: ' claude-opus-5 ', effort: 'high', speed: 'fast', turns: 3, lastModel: 'claude-opus-4-8' }), {
		model: 'claude-opus-5',
		effort: 'high',
		speed: 'fast',
		providerId: null,
		turns: 3,
		lastModel: 'claude-opus-4-8'
	});
	assert.deepEqual(lopuChatStateOf({ model: 7, effort: 'turbo', speed: 'warp', turns: -1, lastModel: '' }), {
		model: null,
		effort: null,
		speed: null,
		providerId: null,
		turns: 0,
		lastModel: null
	});
});

test('chat settings carry a Secure Vault providerId: pinned, kept across model changes, cleared by null, shape-checked', () => {
	const id = 'prov-0123456789abcdef';
	const pinned = normalizeLopuChatSettings({ providerId: id });
	assert.deepEqual(pinned, { ok: true, settings: { model: null, effort: null, speed: null, providerId: id }, changed: true });
	// a model change leaves the pin alone
	const kept = normalizeLopuChatSettings({ model: 'claude-opus-5' }, { model: null, effort: null, speed: null, providerId: id });
	assert.equal(kept.ok, true);
	assert.equal((kept as any).settings.providerId, id);
	// null and '' clear it; an identical pin is not a change
	for (const cleared of [null, '']) {
		const result = normalizeLopuChatSettings({ providerId: cleared }, { model: 'gpt-5.5', effort: 'high', speed: null, providerId: id });
		assert.deepEqual(result, { ok: true, settings: { model: 'gpt-5.5', effort: 'high', speed: null, providerId: null }, changed: true });
	}
	assert.equal((normalizeLopuChatSettings({ providerId: id }, { model: null, effort: null, speed: null, providerId: id }) as any).changed, false);
	// settings without the field read as "Thingtime's models"
	assert.equal((normalizeLopuChatSettings({}, { model: null, effort: null, speed: null }) as any).settings.providerId, null);
	// only vault-record-shaped ids are accepted (the writers then check ownership)
	for (const bad of ['short', 'has space', 'x'.repeat(121), 42, {}, 'semi;colon']) {
		const result = normalizeLopuChatSettings({ providerId: bad });
		assert.equal(result.ok, false, `accepted ${JSON.stringify(bad)}`);
		assert.equal((result as any).status, 400);
	}
	// the stored block reads back forgivingly
	assert.equal(lopuChatStateOf({ providerId: id }).providerId, id);
	assert.equal(lopuChatStateOf({ providerId: 'bad id' }).providerId, null);
	assert.equal(lopuChatStateOf({ providerId: 7 }).providerId, null);
	assert.equal(lopuChatStateOf(undefined).providerId, null);
});

test('share ids are owner-scoped, deterministic and distinct per segment and side', () => {
	assert.match(lopuChatShareId(), /^lopu-chat-[0-9a-f-]{36}$/);
	assert.notEqual(lopuChatShareId(), lopuChatShareId());
	assert.equal(lopuUserMessageShareId('user-1', 'req-1'), lopuUserMessageShareId('user-1', 'req-1'));
	assert.notEqual(lopuUserMessageShareId('user-1', 'req-1'), lopuUserMessageShareId('user-2', 'req-1'));
	assert.notEqual(lopuUserMessageShareId('user-1', 'req-1'), lopuUserMessageShareId('user-1', 'req-1', 1));
	assert.notEqual(lopuUserMessageShareId('user-1', 'req-1'), lopuAssistantMessageShareId('user-1', 'req-1'));
	assert.notEqual(lopuAssistantMessageShareId('user-1', 'req-1'), lopuAssistantMessageShareId('user-1', 'req-1', 1));
	assert.equal(lopuAssistantMessageShareId('user-1', 'req-1', 2), lopuAssistantMessageShareId('user-1', 'req-1', 2));
});

test('the chat and assistant sources project through publicExternalAiSource as the lopu branch', () => {
	assert.equal(isLopuSource(LOPU_CHAT_SOURCE), true);
	assert.equal(isLopuChatDoc({ crystal: { externalSource: LOPU_CHAT_SOURCE } }), true);
	assert.equal(isLopuChatDoc({ crystal: { externalSource: { access: 'imported', provider: 'claude' } } }), false);
	assert.equal(isLopuChatDoc({ crystal: {} }), false);

	const chat = publicExternalAiSource(LOPU_CHAT_SOURCE);
	assert.deepEqual(chat, { provider: 'lopu', sourceId: 'lopu', label: 'Lopu', access: 'lopu', connector: 'thingtime', readOnly: false });

	const assistant = publicExternalAiSource(lopuAssistantSource('req-1', 1, 2));
	assert.deepEqual(assistant, {
		provider: 'lopu',
		sourceId: 'lopu',
		label: 'Lopu',
		role: 'assistant',
		authorName: 'Lopu',
		segmentIndex: 1,
		segmentCount: 2,
		messageId: 'req-1',
		revision: 1,
		access: 'lopu',
		connector: 'thingtime',
		readOnly: true
	});

	// the discriminator cannot be worn by an import or a live session, and the
	// lopu access needs the lopu provider
	assert.equal(publicExternalAiSource({ ...LOPU_CHAT_SOURCE, access: 'imported' }), null);
	assert.equal(publicExternalAiSource({ ...LOPU_CHAT_SOURCE, access: undefined }), null);
	assert.equal(publicExternalAiSource({ ...LOPU_CHAT_SOURCE, provider: 'claude' }), null);
	assert.equal(publicExternalAiSource({ ...LOPU_CHAT_SOURCE, connector: '' }), null);
	// existing imported/live projections are untouched
	assert.deepEqual(publicExternalAiSource({ provider: 'claude', sourceId: 'desk', label: 'Claude', connector: 'claude-desktop' }), {
		provider: 'claude',
		sourceId: 'desk',
		label: 'Claude',
		access: 'imported',
		connector: 'claude-desktop',
		readOnly: true
	});
});

test('publicLopuMessageMeta bounds the turn metadata and keeps assistant-only fields off user rows', () => {
	assert.equal(publicLopuMessageMeta(null), null);
	assert.equal(publicLopuMessageMeta({ role: 'system' }), null);
	assert.deepEqual(publicLopuMessageMeta({ role: 'user', requestId: 'req-1', segmentIndex: 1, segmentCount: 2, model: 'x', toolCalls: [{ name: 'a' }] }), {
		role: 'user',
		requestId: 'req-1',
		segmentIndex: 1,
		segmentCount: 2
	});
	const meta = publicLopuMessageMeta({
		role: 'assistant',
		requestId: 'req-1',
		model: 'claude-opus-5',
		effort: 'high',
		speed: 'normal',
		provider: 'claude',
		usage: { inputTokens: 12, outputTokens: 34 },
		toolCalls: Array.from({ length: 25 }, (_, index) => ({ name: `tool-${index}`, ok: index % 2 === 0, summary: 'x'.repeat(500), thingId: index ? `thing-${index}` : '' })),
		stopReason: 'end_turn'
	});
	assert.ok(meta);
	assert.equal(meta!.role, 'assistant');
	assert.equal(meta!.segmentIndex, 0);
	assert.equal(meta!.segmentCount, 1);
	assert.deepEqual(meta!.usage, { inputTokens: 12, outputTokens: 34 });
	assert.equal(meta!.provider, 'claude');
	assert.equal(meta!.toolCalls!.length, 20);
	assert.equal(meta!.toolCalls![0]!.summary.length, 240);
	assert.equal('thingId' in meta!.toolCalls![0]!, false);
	assert.equal(meta!.toolCalls![1]!.thingId, 'thing-1');
	assert.equal(meta!.stopReason, 'end_turn');
	// garbage never becomes structure
	const sparse = publicLopuMessageMeta({ role: 'assistant', provider: 'gemini', usage: { inputTokens: -1 }, toolCalls: 'nope', stopReason: 5 });
	assert.deepEqual(sparse, { role: 'assistant', requestId: null, segmentIndex: 0, segmentCount: 1, model: null, effort: null, speed: null, stopReason: null });
});

const userRow = (text: string, requestId: string | null, segmentIndex = 0) => ({
	crystal: { text, deletedAt: null, systemType: null, externalSource: null, lopu: requestId ? { role: 'user', requestId, segmentIndex } : null }
});
const assistantRow = (text: string, requestId: string, segmentIndex = 0) => ({
	crystal: {
		text,
		deletedAt: null,
		systemType: null,
		externalSource: lopuAssistantSource(requestId, segmentIndex, 2),
		lopu: { role: 'assistant', requestId, segmentIndex }
	}
});

test('buildLopuHistory folds segments exactly, merges stray same-role rows and skips noise', () => {
	const rows = [
		{ crystal: { text: '', deletedAt: null, systemType: 'chat-created' } },
		userRow('Build me a hero', 'r1'),
		assistantRow('Sure — here is part one ', 'r1', 0),
		assistantRow('and part two.', 'r1', 1),
		{ crystal: { text: 'deleted words', deletedAt: '2026-01-01T00:00:00.000Z', systemType: null } },
		userRow('Sent from the messenger composer', null),
		userRow('And a second thought', null),
		userRow('   ', null),
		assistantRow('Answer to both.', 'r2', 0)
	];
	const folded = buildLopuHistory(rows);
	assert.deepEqual(folded.history, [
		{ role: 'user', text: 'Build me a hero' },
		{ role: 'assistant', text: 'Sure — here is part one and part two.' },
		{ role: 'user', text: 'Sent from the messenger composer\n\nAnd a second thought' },
		{ role: 'assistant', text: 'Answer to both.' }
	]);
	assert.equal(folded.truncated, false);
	assert.equal(folded.chars, folded.history.reduce((sum, turn) => sum + turn.text.length, 0));
});

test('buildLopuHistory keeps the newest turns under the turn and char caps', () => {
	const rows: any[] = [];
	for (let index = 0; index < 10; index += 1) {
		rows.push(userRow(`q${index}`, `r${index}`));
		rows.push(assistantRow(`a${index}`, `r${index}`));
	}
	const limited = buildLopuHistory(rows, { limit: 3 });
	assert.deepEqual(
		limited.history.map((turn) => turn.text),
		['a8', 'q9', 'a9']
	);
	assert.equal(limited.truncated, true);

	const big = [userRow('x'.repeat(50_000), 'big'), assistantRow('y'.repeat(20_000), 'big'), userRow('latest question', 'last')];
	const capped = buildLopuHistory(big);
	assert.deepEqual(
		capped.history.map((turn) => turn.text.length),
		[20_000, 'latest question'.length]
	);
	assert.equal(capped.truncated, true);
	assert.ok(capped.chars <= LOPU_HISTORY_MAX_CHARS);

	// a single turn larger than the cap keeps its tail rather than vanishing
	const oversized = buildLopuHistory([userRow(`${'a'.repeat(70_000)}TAIL`, 'huge')]);
	assert.equal(oversized.history.length, 1);
	assert.equal(oversized.history[0]!.text.length, LOPU_HISTORY_MAX_CHARS);
	assert.ok(oversized.history[0]!.text.endsWith('TAIL'));
	assert.equal(oversized.truncated, true);

	assert.deepEqual(buildLopuHistory([]), { history: [], chars: 0, truncated: false });
});
