import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createOmniScreen,
	createOpenAiModerationProvider,
	createTieredModerationProvider,
	DEFAULT_MODERATION_ESCALATION_SCORE,
	mapOmniVerdict,
	omniMaxImageScore,
	OPENAI_MODERATION_MODEL,
	OPENAI_MODERATION_URL,
	resolveModerationEscalationScore,
	shouldEscalateOmniResult,
	type OmniModerationResult
} from './openaiProvider';
import { resolveModerationProvider, type ModerationImageInput, type ModerationProvider } from './providers';

const input: ModerationImageInput = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', filename: 'pic.png' };

const cleanResult = (overrides: Partial<OmniModerationResult> = {}): OmniModerationResult => ({
	flagged: false,
	categories: { sexual: false, violence: false },
	category_scores: { sexual: 0.01, violence: 0.02 },
	category_applied_input_types: { sexual: ['image'], violence: ['image'] },
	...overrides
});

const flaggedResult = (overrides: Partial<OmniModerationResult> = {}): OmniModerationResult => ({
	flagged: true,
	categories: { sexual: true, 'violence/graphic': true, violence: false },
	category_scores: { sexual: 0.97, 'violence/graphic': 0.55, violence: 0.1 },
	category_applied_input_types: { sexual: ['image'], 'violence/graphic': ['image'], violence: ['image'] },
	...overrides
});

test('mapOmniVerdict maps flagged results to nsfw-only (never blocked) with kebab categories', () => {
	const flagged = mapOmniVerdict(flaggedResult());
	assert.equal(flagged.nsfw, true);
	// omni image categories cannot establish TOS violations (sexual/minors is text-only)
	assert.equal(flagged.tosViolation, false);
	assert.deepEqual(flagged.categories, ['sexual', 'violence-graphic']);
	assert.match(flagged.reason!, /sexual \(0\.97\)/);

	const clean = mapOmniVerdict(cleanResult());
	assert.deepEqual({ nsfw: clean.nsfw, tos: clean.tosViolation, categories: clean.categories }, { nsfw: false, tos: false, categories: [] });
	assert.match(clean.reason!, /max image score 0\.020/);

	// flagged with no category detail still lands a reviewable category
	assert.deepEqual(mapOmniVerdict({ flagged: true }).categories, ['omni-flagged']);
});

test('escalation checks the flag and image-applicable scores only', () => {
	assert.equal(shouldEscalateOmniResult(flaggedResult(), DEFAULT_MODERATION_ESCALATION_SCORE), true);
	assert.equal(shouldEscalateOmniResult(cleanResult(), DEFAULT_MODERATION_ESCALATION_SCORE), false);
	// borderline: unflagged but an image score at the threshold escalates
	assert.equal(shouldEscalateOmniResult(cleanResult({ category_scores: { sexual: 0.2 } }), 0.2), true);
	// a high TEXT-only score must not escalate an image
	assert.equal(
		shouldEscalateOmniResult(
			cleanResult({ category_scores: { harassment: 0.9, sexual: 0.01 }, category_applied_input_types: { harassment: ['text'], sexual: ['image'] } }),
			DEFAULT_MODERATION_ESCALATION_SCORE
		),
		false
	);
	// missing applied-input-types data fails safe at EVERY granularity: absent
	// map, empty map, and a category scored but missing from the map all count
	// toward escalation — only a positive non-image attribution excludes.
	assert.equal(shouldEscalateOmniResult({ flagged: false, category_scores: { sexual: 0.5 } }, 0.2), true);
	assert.equal(shouldEscalateOmniResult({ flagged: false, category_scores: { sexual: 0.5 }, category_applied_input_types: {} }, 0.2), true);
	assert.equal(
		shouldEscalateOmniResult(
			{ flagged: false, category_scores: { sexual: 0.5, violence: 0.01 }, category_applied_input_types: { violence: ['image'] } },
			0.2
		),
		true
	);
	assert.equal(omniMaxImageScore({ flagged: false }), 0);
});

test('escalation score env override parses and clamps to [0,1]', () => {
	assert.equal(resolveModerationEscalationScore({} as any), DEFAULT_MODERATION_ESCALATION_SCORE);
	assert.equal(resolveModerationEscalationScore({ TT_MODERATION_ESCALATION_SCORE: '0.5' } as any), 0.5);
	assert.equal(resolveModerationEscalationScore({ TT_MODERATION_ESCALATION_SCORE: '0' } as any), 0);
	for (const bad of ['1.5', '-1', 'nope', '']) {
		assert.equal(resolveModerationEscalationScore({ TT_MODERATION_ESCALATION_SCORE: bad } as any), DEFAULT_MODERATION_ESCALATION_SCORE);
	}
});

test('omni screen posts a data-URL image with bearer auth and rejects bad responses', async () => {
	let captured: { url: string; init: RequestInit } | null = null;
	const okFetch = (async (url: any, init: any) => {
		captured = { url: String(url), init };
		return { ok: true, json: async () => ({ results: [cleanResult()] }) };
	}) as unknown as typeof fetch;
	const screen = createOmniScreen({ OPENAI_API_KEY: 'sk-test' } as any, okFetch);
	const result = await screen(input);
	assert.equal(result.flagged, false);
	assert.equal(captured!.url, OPENAI_MODERATION_URL);
	assert.equal((captured!.init.headers as Record<string, string>).Authorization, 'Bearer sk-test');
	const body = JSON.parse(String(captured!.init.body));
	assert.equal(body.model, OPENAI_MODERATION_MODEL);
	assert.equal(body.input[0].type, 'image_url');
	assert.ok(String(body.input[0].image_url.url).startsWith('data:image/png;base64,'));

	const failing = createOmniScreen({} as any, (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch);
	await assert.rejects(() => failing(input), /omni-moderation request failed \(429\)/);
	const malformed = createOmniScreen({} as any, (async () => ({ ok: true, json: async () => ({ results: [] }) })) as unknown as typeof fetch);
	await assert.rejects(() => malformed(input), /malformed omni-moderation response/);
});

test('standalone openai provider maps the screen result directly and propagates screen failures', async () => {
	const provider = createOpenAiModerationProvider({} as any, async () => flaggedResult());
	assert.equal(provider.name, 'openai');
	assert.equal(provider.model, OPENAI_MODERATION_MODEL);
	const verdict = await provider.analyzeImage(input);
	assert.deepEqual({ nsfw: verdict.nsfw, tos: verdict.tosViolation }, { nsfw: true, tos: false });
	// a screen failure must reach the orchestrator (doc stays pending), never a fabricated clear
	const failing = createOpenAiModerationProvider({} as any, async () => {
		throw new Error('openai down');
	});
	await assert.rejects(() => failing.analyzeImage(input), /openai down/);
});

const fakeClaude = (options: { fail?: boolean } = {}): ModerationProvider & { calls: number } => {
	const provider = {
		calls: 0,
		name: 'claude',
		model: 'claude-test-model',
		analyzeImage: async () => {
			provider.calls += 1;
			if (options.fail) throw new Error('claude down');
			return { nsfw: false, tosViolation: true, categories: ['csam'], reason: 'claude verdict' };
		}
	};
	return provider;
};

test('tiered: clean screen clears for $0 without calling claude', async () => {
	const claude = fakeClaude();
	const provider = createTieredModerationProvider({} as any, { screen: async () => cleanResult(), claude });
	assert.equal(provider.name, 'openai+claude');
	const verdict = await provider.analyzeImage(input);
	assert.deepEqual({ nsfw: verdict.nsfw, tos: verdict.tosViolation }, { nsfw: false, tos: false });
	assert.equal(claude.calls, 0);
	// stamp attribution reflects the engine that decided
	assert.equal(provider.name, 'openai');
	assert.equal(provider.model, OPENAI_MODERATION_MODEL);
});

test('tiered: flagged and borderline screens escalate to claude for the final verdict', async () => {
	for (const screenResult of [flaggedResult(), cleanResult({ category_scores: { sexual: 0.3 } })]) {
		const claude = fakeClaude();
		const provider = createTieredModerationProvider({} as any, { screen: async () => screenResult, claude });
		const verdict = await provider.analyzeImage(input);
		assert.equal(claude.calls, 1);
		assert.equal(verdict.tosViolation, true, 'claude verdict wins');
		assert.equal(provider.name, 'claude');
		assert.equal(provider.model, 'claude-test-model');
	}
});

test('tiered: TT_MODERATION_ESCALATION_SCORE env wiring changes the escalation decision', async () => {
	// 0.1 clears under the default 0.2 threshold but must escalate at 0.05
	const screen = async () => cleanResult({ category_scores: { sexual: 0.1 } });
	const strictClaude = fakeClaude();
	const strict = createTieredModerationProvider({ TT_MODERATION_ESCALATION_SCORE: '0.05' } as any, { screen, claude: strictClaude });
	const verdict = await strict.analyzeImage(input);
	assert.equal(strictClaude.calls, 1);
	assert.equal(verdict.tosViolation, true);
	assert.equal(strict.name, 'claude');

	const laxClaude = fakeClaude();
	const lax = createTieredModerationProvider({} as any, { screen, claude: laxClaude });
	await lax.analyzeImage(input);
	assert.equal(laxClaude.calls, 0);

	// '0' is the documented send-everything-to-claude mode
	const zeroClaude = fakeClaude();
	const zero = createTieredModerationProvider({ TT_MODERATION_ESCALATION_SCORE: '0' } as any, { screen: async () => cleanResult(), claude: zeroClaude });
	await zero.analyzeImage(input);
	assert.equal(zeroClaude.calls, 1);
});

test('tiered lazy claude import contract holds without a network call', async () => {
	// getClaude() depends on this exact export; pin it so a rename/constructor
	// regression fails here instead of hiding inside the tiered catch in prod.
	const { createClaudeModerationProvider } = await import('./claudeProvider');
	assert.equal(typeof createClaudeModerationProvider, 'function');
	const claude = createClaudeModerationProvider({ ANTHROPIC_API_KEY: 'stub-key' } as any);
	assert.equal(claude.name, 'claude');
	assert.equal(typeof claude.analyzeImage, 'function');
});

test('tiered: screen outage goes straight to claude', async () => {
	const claude = fakeClaude();
	const provider = createTieredModerationProvider({} as any, {
		screen: async () => {
			throw new Error('openai down');
		},
		claude
	});
	const verdict = await provider.analyzeImage(input);
	assert.equal(claude.calls, 1);
	assert.equal(verdict.tosViolation, true);
});

test('tiered: claude outage falls back to the omni nsfw verdict for flagged images, rethrows without a flag', async () => {
	const flaggedFallback = createTieredModerationProvider({} as any, { screen: async () => flaggedResult(), claude: fakeClaude({ fail: true }) });
	const verdict = await flaggedFallback.analyzeImage(input);
	// fail-safe: blur + admin flag beats rendering an image omni flagged
	assert.deepEqual({ nsfw: verdict.nsfw, tos: verdict.tosViolation }, { nsfw: true, tos: false });
	assert.equal(flaggedFallback.name, 'openai');

	// borderline (unflagged) with claude down: no trustworthy signal → pending
	const borderline = createTieredModerationProvider({} as any, {
		screen: async () => cleanResult({ category_scores: { sexual: 0.5 } }),
		claude: fakeClaude({ fail: true })
	});
	await assert.rejects(() => borderline.analyzeImage(input), /claude down/);

	// both providers down: rethrows → pending for the sweep
	const bothDown = createTieredModerationProvider({} as any, {
		screen: async () => {
			throw new Error('openai down');
		},
		claude: fakeClaude({ fail: true })
	});
	await assert.rejects(() => bothDown.analyzeImage(input), /claude down/);
});

test('provider resolution covers the new openai and tiered values plus key-based defaults', async () => {
	const tiered = await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'openai+claude' } as any);
	assert.equal(tiered.kind === 'provider' && tiered.provider.name, 'openai+claude');
	const aliased = await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'tiered' } as any);
	assert.equal(aliased.kind === 'provider' && aliased.provider.name, 'openai+claude');
	const openai = await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'openai' } as any);
	assert.equal(openai.kind === 'provider' && openai.provider.name, 'openai');
	// unset: both keys → tiered; single key → that provider; none → off
	const bothKeys = await resolveModerationProvider({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' } as any);
	assert.equal(bothKeys.kind === 'provider' && bothKeys.provider.name, 'openai+claude');
	const openaiOnly = await resolveModerationProvider({ OPENAI_API_KEY: 'o' } as any);
	assert.equal(openaiOnly.kind === 'provider' && openaiOnly.provider.name, 'openai');
	const anthropicOnly = await resolveModerationProvider({ ANTHROPIC_API_KEY: 'a' } as any);
	assert.equal(anthropicOnly.kind === 'provider' && anthropicOnly.provider.name, 'claude');
	assert.equal((await resolveModerationProvider({} as any)).kind, 'off');
	// explicit choices are never silently rerouted by extra keys
	const explicitClaude = await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'claude', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' } as any);
	assert.equal(explicitClaude.kind === 'provider' && explicitClaude.provider.name, 'claude');
	// a typo'd value must not silently disable moderation: it warns and honors
	// the key-based default instead of resolving to 'off'
	const typo = await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'claude+openai', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' } as any);
	assert.equal(typo.kind === 'provider' && typo.provider.name, 'openai+claude');
	assert.equal((await resolveModerationProvider({ THINGTIME_MODERATION_PROVIDER: 'bogus' } as any)).kind, 'off');
});
