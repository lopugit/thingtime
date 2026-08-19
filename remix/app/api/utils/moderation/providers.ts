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
// Fail-open note: 'off'/missing-key environments do NOT block uploads — the
// beta admin-grant gate (PR #302) is the hard spam control; analysis is the
// content-quality layer on top. Set the provider in prod so it actually runs.

import type { ModerationVerdict } from './moderationCore';

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
export const resolveModerationProvider = async (env: NodeJS.ProcessEnv = process.env): Promise<ModerationProviderChoice> => {
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
