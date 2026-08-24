// Moderation provider registry. The provider analyzes ONE image and returns
// a ModerationVerdict; the orchestrator (analyzeAttachment.ts) owns loading
// bytes, stamping results, and every attachment-shape decision.
//
// Selection (THINGTIME_MODERATION_PROVIDER):
//   'openai+claude' (alias 'tiered')
//            — FREE omni-moderation first pass; flagged/borderline images
//              escalate to Claude for the policy-nuanced verdict. Recommended
//              whenever both keys exist (docs/ai-api-cost-analysis.md lever 1).
//   'claude' — Claude API vision on every image
//   'openai' — omni-moderation only ($0; flagged images stamp nsfw, never
//              blocked — its image categories can't establish TOS violations)
//   'test'   — deterministic filename-marker provider for tests/dev
//   'off'    — analysis disabled; images stamp 'skipped' and are served
//              normally (dev environments without an API key)
// Unset default by available keys: both → 'openai+claude'; ANTHROPIC only →
// 'claude'; OPENAI only → 'openai'; neither → 'off'.
// The Admin dashboard's AI-moderation settings (moderationSettingsCore.ts)
// override the env choice: resolveConfiguredModerationProvider reads the
// admin mediaProvider first and only falls through to the env/key logic when
// it is 'default' (or the settings read fails).
// An explicit 'off'/missing-key environment marks attachments skipped. When a
// configured provider fails, the durable pending stamp stays quarantined and
// the sweep retries it. Upload authorization remains the separate canonical
// public/private/all scope gate; moderation never reimplements permission.

import type { ModerationVerdict } from './moderationCore';
import { DEFAULT_MODERATION_SETTINGS, type ModerationMediaProviderId } from './moderationSettingsCore';

export type ModerationImageInput = {
	bytes: Uint8Array;
	contentType: string;
	filename: string;
};

export type ModerationProvider = {
	name: string;
	model?: string;
	analyzeImage: (input: ModerationImageInput) => Promise<ModerationVerdict>;
};

// Deterministic provider for tests and local dev: verdicts keyed by filename
// markers so API-suite fixtures can exercise every branch without a network.
export const testModerationProvider: ModerationProvider = {
	name: 'test',
	analyzeImage: async ({ filename }) => {
		const name = filename.toLowerCase();
		if (name.includes('tt-test-illegal') || name.includes('tt-test-tos')) {
			return { nsfw: false, tosViolation: true, categories: ['test-tos-violation'], reason: 'test provider filename marker' };
		}
		if (name.includes('tt-test-nsfw')) {
			return { nsfw: true, tosViolation: false, categories: ['test-nsfw'], reason: 'test provider filename marker' };
		}
		return { nsfw: false, tosViolation: false, categories: [] };
	}
};

export type ModerationProviderChoice = { kind: 'off' } | { kind: 'provider'; provider: ModerationProvider };

// Resolved lazily per call so tests and previews can flip env vars without a
// process restart; the Claude provider is imported lazily so environments
// that never analyze don't pay for the SDK import.
export const resolveModerationProvider = async (
	env: NodeJS.ProcessEnv = process.env,
	adminProvider: ModerationMediaProviderId = 'default'
): Promise<ModerationProviderChoice> => {
	// The admin setting outranks the env: a named admin choice maps straight to
	// its provider; 'default' delegates to the env/key resolution below.
	if (adminProvider === 'off') return { kind: 'off' };
	if (adminProvider === 'openai+claude') {
		const { createTieredModerationProvider } = await import('./openaiProvider');
		return { kind: 'provider', provider: createTieredModerationProvider(env) };
	}
	if (adminProvider === 'claude') {
		const { createClaudeModerationProvider } = await import('./claudeProvider');
		return { kind: 'provider', provider: createClaudeModerationProvider(env) };
	}
	if (adminProvider === 'openai') {
		const { createOpenAiModerationProvider } = await import('./openaiProvider');
		return { kind: 'provider', provider: createOpenAiModerationProvider(env) };
	}
	const configured = env.THINGTIME_MODERATION_PROVIDER?.trim().toLowerCase();
	if (configured === 'off') return { kind: 'off' };
	if (configured === 'test') return { kind: 'provider', provider: testModerationProvider };
	if (configured === 'openai+claude' || configured === 'tiered') {
		const { createTieredModerationProvider } = await import('./openaiProvider');
		return { kind: 'provider', provider: createTieredModerationProvider(env) };
	}
	if (configured === 'claude') {
		const { createClaudeModerationProvider } = await import('./claudeProvider');
		return { kind: 'provider', provider: createClaudeModerationProvider(env) };
	}
	if (configured === 'openai') {
		const { createOpenAiModerationProvider } = await import('./openaiProvider');
		return { kind: 'provider', provider: createOpenAiModerationProvider(env) };
	}
	if (configured) {
		// A typo'd value must not silently disable moderation while keys sit in
		// the env: warn audibly and honor the operator's clear intent to have
		// moderation ON by falling through to the key-based default below.
		console.warn(
			`[moderation] unrecognized THINGTIME_MODERATION_PROVIDER "${configured}" — using the key-based default. Valid: openai+claude | tiered | claude | openai | test | off.`
		);
	}
	if (env.OPENAI_API_KEY && env.ANTHROPIC_API_KEY) {
		const { createTieredModerationProvider } = await import('./openaiProvider');
		return { kind: 'provider', provider: createTieredModerationProvider(env) };
	}
	if (env.ANTHROPIC_API_KEY) {
		const { createClaudeModerationProvider } = await import('./claudeProvider');
		return { kind: 'provider', provider: createClaudeModerationProvider(env) };
	}
	if (env.OPENAI_API_KEY) {
		const { createOpenAiModerationProvider } = await import('./openaiProvider');
		return { kind: 'provider', provider: createOpenAiModerationProvider(env) };
	}
	return { kind: 'off' };
};

// The orchestrator's default resolver: admin settings first, env second. The
// settings read is isolated so a Mongo hiccup degrades to the env default
// instead of failing analysis outright (unit tests hit the pure
// resolveModerationProvider directly and never touch the DB).
export const resolveConfiguredModerationProvider = async (env: NodeJS.ProcessEnv = process.env): Promise<ModerationProviderChoice> => {
	let adminProvider = DEFAULT_MODERATION_SETTINGS.mediaProvider;
	try {
		const { getModerationSettings } = await import('./moderationSettings');
		adminProvider = (await getModerationSettings()).mediaProvider;
	} catch (error) {
		console.warn('[moderation] settings read failed; using env default provider:', (error as Error)?.message || error);
	}
	return resolveModerationProvider(env, adminProvider);
};
