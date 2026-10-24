// Claude API vision moderation provider. One bounded request per image:
// base64 image + a strict-JSON classification ask. The raw image never
// persists anywhere new — bytes come from the private S3 object and go only
// to the Claude API call.
import Anthropic from '@anthropic-ai/sdk';

import { getAiPreferredModelWaterfall } from '../settings/prConflictResolverModelWaterfall';
import { resolveAiPreferredClaudeModel } from '../settings/prConflictResolverModelWaterfallCore';
import type { ModerationVerdict } from './moderationCore';
import { sanitizeModerationCategories } from './moderationCore';
import type { ModerationProvider } from './providers';

export const DEFAULT_MODERATION_MODEL = 'claude-opus-5';

// Claude vision accepts these media types (attachmentCore's avif is gated out
// by the orchestrator before the provider runs).
export const CLAUDE_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const MODERATION_PROMPT = `You are the content-moderation classifier for Thingtime, a general-audience social platform. Classify the attached user-uploaded image.

Definitions:
- "nsfw": sexual/adult content, explicit nudity, fetish content, or gratuitous gore/graphic violence. Artistic/medical nudity still counts as nsfw for blurring purposes.
- "tosViolation": content that is illegal or prohibited outright — any sexual content involving minors, non-consensual sexual content, credible threats or incitement of violence, terrorism propaganda, sale of illegal drugs or weapons, or content that primarily exists to harass a private individual. tosViolation implies removal, so only set it when the image itself is the violation.

Respond with ONLY a JSON object, no prose, matching:
{"nsfw": boolean, "tosViolation": boolean, "categories": string[], "reason": string}
categories: short kebab-case labels for what you saw (e.g. "explicit-nudity", "graphic-violence", "csam", "drug-sale"). Empty array when clear.
reason: one sentence justifying the classification.`;

const parseVerdict = (text: string): ModerationVerdict | null => {
	// The model is asked for bare JSON; tolerate accidental fencing.
	const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
	try {
		const parsed = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== 'object') return null;
		return {
			nsfw: parsed.nsfw === true,
			tosViolation: parsed.tosViolation === true,
			categories: sanitizeModerationCategories(parsed.categories),
			reason: typeof parsed.reason === 'string' ? parsed.reason : undefined
		};
	} catch {
		return null;
	}
};

export const createClaudeModerationProvider = (env: NodeJS.ProcessEnv = process.env): ModerationProvider => {
	// The Thingtime Admin AI model waterfall governs every application AI
	// client (ai-model-routing-contract.mjs); TT_MODERATION_MODEL is only the
	// provider default used when the waterfall says 'default'.
	const providerDefaultModel = env.TT_MODERATION_MODEL?.trim() || DEFAULT_MODERATION_MODEL;
	let lastResolvedModel = providerDefaultModel;
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	return {
		name: 'claude',
		get model() {
			return lastResolvedModel;
		},
		analyzeImage: async ({ bytes, contentType }) => {
			const model = resolveAiPreferredClaudeModel(await getAiPreferredModelWaterfall(), providerDefaultModel);
			lastResolvedModel = model;
			const response = await client.messages.create({
				model,
				max_tokens: 2048,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'image',
								source: {
									type: 'base64',
									media_type: contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
									data: Buffer.from(bytes).toString('base64')
								}
							},
							{ type: 'text', text: MODERATION_PROMPT }
						]
					}
				]
			});

			// A safety-classifier refusal on a moderation request is itself signal:
			// the image was extreme enough that the model declined to process it.
			// Quarantine it for human review rather than failing open.
			if ((response as { stop_reason?: string }).stop_reason === 'refusal') {
				return {
					nsfw: true,
					tosViolation: true,
					categories: ['analysis-refused'],
					reason: 'Claude safety classifiers refused to process this image — quarantined for human review.'
				};
			}

			const text = response.content
				.filter((block): block is Anthropic.TextBlock => block.type === 'text')
				.map((block) => block.text)
				.join('\n');
			const verdict = parseVerdict(text);
			if (!verdict) {
				// Unparseable answer: keep the attachment un-stamped (analysis error
				// path) rather than inventing a verdict — the orchestrator leaves the
				// doc pending so a sweep can retry.
				throw new Error(`moderation: unparseable classifier response for model ${model}`);
			}
			return verdict;
		}
	};
};
