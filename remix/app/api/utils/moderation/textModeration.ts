// Post/comment TEXT moderation via OpenAI's free omni-moderation endpoint.
// Text is where omni is at full strength: all 13 categories apply (including
// sexual/minors, threats, and hate — the ones that are image-blind), so the
// free endpoint alone is a defensible text gate with no paid escalation.
//
// Severity split:
//   BLOCK  (tosViolation → quarantine + admin flag): sexual/minors,
//          harassment/threatening, hate/threatening, illicit/violent,
//          self-harm/instructions — the flagged text IS the violation.
//   FLAG   (nsfw stamp → admin flag, content stays visible): every other
//          flagged category (sexual, harassment, hate, illicit, self-harm,
//          self-harm/intent, violence, violence/graphic). Text has no blur
//          treatment; the stamp is an advisory queue entry for admin review,
//          and an admin can escalate to block from the Moderation tab.
import type { ModerationVerdict } from './moderationCore';
import { OPENAI_MODERATION_MODEL, OPENAI_MODERATION_URL, type OmniModerationResult } from './openaiProvider';

// Categories whose flagged text is itself the violation — auto-quarantined.
export const TEXT_BLOCK_CATEGORIES = new Set([
	'sexual/minors',
	'harassment/threatening',
	'hate/threatening',
	'illicit/violent',
	'self-harm/instructions'
]);

// Bound what one moderation request carries; omni's own cap is far higher but
// post/comment text beyond this is truncated for classification purposes only.
export const MAX_MODERATION_TEXT_CHARS = 20_000;

export const mapOmniTextVerdict = (result: OmniModerationResult): ModerationVerdict => {
	const scores = result.category_scores ?? {};
	const flaggedCategories = Object.entries(result.categories ?? {})
		.filter(([, flagged]) => flagged === true)
		.map(([category]) => category);
	const tosViolation = flaggedCategories.some((category) => TEXT_BLOCK_CATEGORIES.has(category));
	const nsfw = result.flagged === true;
	const detail = flaggedCategories
		.map((category) => {
			const score = scores[category];
			return typeof score === 'number' && Number.isFinite(score) ? `${category} (${score.toFixed(2)})` : category;
		})
		.join(', ');
	return {
		nsfw,
		tosViolation,
		categories: nsfw && !flaggedCategories.length ? ['omni-flagged'] : flaggedCategories.map((category) => category.replace(/\//g, '-')),
		reason: nsfw ? `OpenAI omni-moderation flagged text: ${detail || 'no category detail'}.` : undefined
	};
};

export type OmniTextScreen = (text: string) => Promise<OmniModerationResult>;

export const createOmniTextScreen = (env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): OmniTextScreen =>
	async (text) => {
		const response = await fetchImpl(OPENAI_MODERATION_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}`
			},
			body: JSON.stringify({
				model: OPENAI_MODERATION_MODEL,
				input: [{ type: 'text', text: text.slice(0, MAX_MODERATION_TEXT_CHARS) }]
			})
		});
		if (!response.ok) throw new Error(`moderation: omni-moderation text request failed (${response.status})`);
		const payload = (await response.json()) as { results?: OmniModerationResult[] };
		const result = payload?.results?.[0];
		if (!result || typeof result.flagged !== 'boolean') {
			throw new Error('moderation: malformed omni-moderation text response');
		}
		return result;
	};

export type TextModerationChoice = { kind: 'off' } | { kind: 'screen'; screen: OmniTextScreen; provider: string; model: string };

// Admin setting outranks env; 'default' runs the free screen whenever an
// OpenAI key exists. There is no paid text tier — omni is the whole pipeline.
export const resolveTextModeration = (
	env: NodeJS.ProcessEnv = process.env,
	adminProvider: 'default' | 'openai' | 'off' = 'default'
): TextModerationChoice => {
	if (adminProvider === 'off') return { kind: 'off' };
	if (adminProvider === 'openai' || env.OPENAI_API_KEY) {
		return { kind: 'screen', screen: createOmniTextScreen(env), provider: 'openai', model: OPENAI_MODERATION_MODEL };
	}
	return { kind: 'off' };
};
