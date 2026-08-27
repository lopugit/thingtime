// OpenAI omni-moderation provider + the tiered openai+claude composition.
//
// omni-moderation-latest is FREE (verified 2026-08 — see
// docs/ai-api-cost-analysis.md) and accepts images up to 20 MB, so it works
// as a zero-cost first-pass screen: clean images stamp `clear` without ever
// paying for a Claude call; flagged or borderline images escalate to the
// Claude provider for the policy-nuanced verdict (Thingtime counts
// artistic/medical nudity as nsfw-for-blurring — a distinction omni's fixed
// taxonomy cannot make, so omni alone must never CLEAR a borderline image and
// never makes the final call on a flagged one while Claude is reachable).
//
// Hard limitation (per OpenAI docs): the `sexual/minors` category is
// TEXT-ONLY — the free screen cannot identify CSAM in images. Only the Claude
// escalation (or an admin) can stamp `blocked`; the standalone 'openai'
// provider therefore maps every flagged image to `nsfw` (blur + admin flag),
// never `blocked`, and is offered only as a keyless-Anthropic fallback.
//
// Privacy note (mirrors claudeProvider): image bytes come from the private S3
// object and go only to the OpenAI moderation endpoint as a data: URL — they
// never persist anywhere new. Per OpenAI, moderation inputs are not used for
// training.
import type { ModerationVerdict } from './moderationCore';
import type { ModerationImageInput, ModerationProvider } from './providers';

export const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';
export const OPENAI_MODERATION_URL = 'https://api.openai.com/v1/moderations';

// Escalate to Claude when omni is not confident the image is clean: flagged,
// OR any image-applicable category score at/above this threshold. 0 sends
// everything to Claude (omni becomes a no-op); 1 trusts omni's boolean flag
// alone. Deliberately low by default — omni is precision-tuned and can score
// artistic nudity well under its own flag point, and a false escalation only
// costs one Claude call while a false clear ships an unblurred image.
export const DEFAULT_MODERATION_ESCALATION_SCORE = 0.2;

export const resolveModerationEscalationScore = (env: NodeJS.ProcessEnv = process.env): number => {
	const raw = env.TT_MODERATION_ESCALATION_SCORE?.trim();
	if (!raw) return DEFAULT_MODERATION_ESCALATION_SCORE;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_MODERATION_ESCALATION_SCORE;
};

// The single result object from POST /v1/moderations (results[0]).
export type OmniModerationResult = {
	flagged: boolean;
	categories?: Record<string, boolean>;
	category_scores?: Record<string, number>;
	// which input modalities each category was applied to, e.g. { sexual: ['image'] }
	category_applied_input_types?: Record<string, string[]>;
};

// Scores that actually reflect the image. A category is excluded only when
// the API POSITIVELY attributes it elsewhere (e.g. ['text']); a score whose
// applied-input-types entry is missing — or a wholly absent/empty map — still
// counts, so response-shape drift fails safe by over-escalating (the cheap
// direction) instead of silently clearing.
export const omniImageScores = (result: OmniModerationResult): number[] => {
	const scores = result.category_scores ?? {};
	const applied = result.category_applied_input_types;
	return Object.entries(scores)
		.filter(([category, score]) => typeof score === 'number' && Number.isFinite(score) && (applied?.[category] ?? ['image']).includes('image'))
		.map(([, score]) => score);
};

export const omniMaxImageScore = (result: OmniModerationResult): number => Math.max(0, ...omniImageScores(result));

export const shouldEscalateOmniResult = (result: OmniModerationResult, escalationScore: number): boolean =>
	result.flagged === true || omniMaxImageScore(result) >= escalationScore;

// Map omni's fixed taxonomy onto a Thingtime verdict. Used standalone and as
// the tiered fail-safe when Claude is unreachable for a flagged image: a
// flagged image becomes `nsfw` (blurred + moderationFlag for admin review),
// never `blocked` — omni's image categories cannot establish a TOS violation
// (sexual/minors is text-only), so removal stays a Claude/admin decision.
export const mapOmniVerdict = (result: OmniModerationResult): ModerationVerdict => {
	const scores = result.category_scores ?? {};
	const flaggedCategories = Object.entries(result.categories ?? {})
		.filter(([, flagged]) => flagged === true)
		.map(([category]) => category);
	const nsfw = result.flagged === true;
	const detail = flaggedCategories
		.map((category) => {
			const score = scores[category];
			return typeof score === 'number' && Number.isFinite(score) ? `${category} (${score.toFixed(2)})` : category;
		})
		.join(', ');
	return {
		nsfw,
		tosViolation: false,
		categories: nsfw && !flaggedCategories.length ? ['omni-flagged'] : flaggedCategories.map((category) => category.replace(/\//g, '-')),
		reason: nsfw
			? `OpenAI omni-moderation flagged: ${detail || 'no category detail'}.`
			: `OpenAI omni-moderation screen clean (max image score ${omniMaxImageScore(result).toFixed(3)}).`
	};
};

export type OmniScreen = (input: ModerationImageInput) => Promise<OmniModerationResult>;

// One bounded request per image; the endpoint is free, so the only spend here
// is bandwidth. Uploads are capped at MAX_MODERATION_IMAGE_BYTES (10 MiB) —
// comfortably under OpenAI's 20 MB image limit.
export const createOmniScreen = (env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): OmniScreen =>
	async ({ bytes, contentType }) => {
		const response = await fetchImpl(OPENAI_MODERATION_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}`
			},
			body: JSON.stringify({
				model: OPENAI_MODERATION_MODEL,
				input: [{ type: 'image_url', image_url: { url: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}` } }]
			})
		});
		if (!response.ok) throw new Error(`moderation: omni-moderation request failed (${response.status})`);
		const payload = (await response.json()) as { results?: OmniModerationResult[] };
		const result = payload?.results?.[0];
		if (!result || typeof result.flagged !== 'boolean') {
			throw new Error('moderation: malformed omni-moderation response');
		}
		return result;
	};

// Standalone omni provider ('openai'): free, but every flagged image is only
// ever `nsfw` and clears are taken on omni's word alone — meant for
// environments with an OpenAI key and no Anthropic key. Prefer the tiered
// provider whenever both keys exist.
export const createOpenAiModerationProvider = (
	env: NodeJS.ProcessEnv = process.env,
	screen: OmniScreen = createOmniScreen(env)
): ModerationProvider => ({
	name: 'openai',
	model: OPENAI_MODERATION_MODEL,
	analyzeImage: async (input) => mapOmniVerdict(await screen(input))
});

export type TieredModerationDependencies = {
	screen?: OmniScreen;
	claude?: ModerationProvider;
};

// Tiered 'openai+claude' provider — the recommended production setup:
//   clean screen      → clear, $0, Claude never called
//   flagged/borderline → Claude makes the policy-nuanced final call
//   screen errors      → straight to Claude (omni outage never blocks analysis)
//   Claude errors      → flagged images fall back to omni's nsfw verdict
//                        (fail-safe: blur + admin flag beats rendering an
//                        image omni flagged); borderline/no-signal rethrows so
//                        the doc stays pending for the sweep to retry.
export const createTieredModerationProvider = (
	env: NodeJS.ProcessEnv = process.env,
	dependencies: TieredModerationDependencies = {}
): ModerationProvider => {
	const screen = dependencies.screen ?? createOmniScreen(env);
	const escalationScore = resolveModerationEscalationScore(env);
	let claudeProvider: ModerationProvider | null = dependencies.claude ?? null;
	const getClaude = async (): Promise<ModerationProvider> => {
		if (!claudeProvider) {
			const { createClaudeModerationProvider } = await import('./claudeProvider');
			claudeProvider = createClaudeModerationProvider(env);
		}
		return claudeProvider;
	};
	// The orchestrator stamps provider/model AFTER analyzeImage resolves, so
	// these getters report which engine produced the last verdict (same
	// last-call pattern — and the same cosmetic concurrent-call caveat — as
	// claudeProvider's resolved-model getter).
	let engine: { name: string; model?: string } = { name: 'openai+claude', model: OPENAI_MODERATION_MODEL };
	return {
		get name() {
			return engine.name;
		},
		get model() {
			return engine.model;
		},
		analyzeImage: async (input) => {
			let omni: OmniModerationResult | null = null;
			try {
				omni = await screen(input);
			} catch (error) {
				console.warn('[moderation] omni-moderation screen failed; escalating to claude:', (error as Error)?.message || error);
			}
			if (omni && !shouldEscalateOmniResult(omni, escalationScore)) {
				engine = { name: 'openai', model: OPENAI_MODERATION_MODEL };
				return mapOmniVerdict(omni);
			}
			try {
				const claude = await getClaude();
				const verdict = await claude.analyzeImage(input);
				engine = { name: claude.name, model: claude.model };
				return verdict;
			} catch (error) {
				if (omni?.flagged) {
					console.warn('[moderation] claude escalation failed; falling back to omni nsfw verdict:', (error as Error)?.message || error);
					engine = { name: 'openai', model: OPENAI_MODERATION_MODEL };
					return mapOmniVerdict(omni);
				}
				throw error;
			}
		}
	};
};
