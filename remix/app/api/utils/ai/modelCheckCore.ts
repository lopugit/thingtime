// Pure helpers behind POST /api/v1/ai/models/check — the Lopu model picker's
// "Check Models" button. One request checks exactly ONE selectable choice (a
// catalog model or one of the caller's own provider connections) by sending
// it the tiny message "Live? Y/N" with no tools, no history and no fallback
// to another provider, and answers whether it replied. No React, no fetch —
// unit-tested in node (modelCheck.test.ts).

/** The client's requirement map for this feature (selected-origin negotiation). */
export const AI_MODEL_CHECK_REQUIREMENTS = { 'api.ai-models-check': '1.0.0' } as const;

/** The tiny message every model is asked. */
export const AI_MODEL_CHECK_PROMPT = 'Live? Y/N';
/** Kept to one line so the check costs a handful of input tokens. */
export const AI_MODEL_CHECK_SYSTEM = 'Thingtime is checking that this model is reachable. Answer the question with the single letter Y.';
// Output ceiling for one check. Reasoning models bill their thinking inside
// this same budget (see musing.ts), so a text-sized cap would be spent
// reasoning and come back empty; this keeps headroom while staying tiny.
export const AI_MODEL_CHECK_MAX_OUTPUT_TOKENS = 512;
// One check never waits longer than this for its provider. Claude OAuth starts
// a local Claude Code process first, so the bound is generous.
export const AI_MODEL_CHECK_TIMEOUT_MS = 60_000;
// The visible echo of the model's answer ("Y", "Yes.", …).
export const AI_MODEL_CHECK_REPLY_CHARS = 40;
// Usage-row request ids are bounded (lopu-usage schema: 160 characters).
export const AI_MODEL_CHECK_REQUEST_PREFIX = 'model-check';

const MAX_ID_CHARS = 160;
const ID_PATTERN = /^[A-Za-z0-9_.:@/+-]+$/;

export type AiModelCheckTarget = { model: string; providerId?: undefined } | { providerId: string; model?: undefined };

export type AiModelCheckBilling = 'thingtime' | 'byo' | 'free';

export type AiModelCheckOutcome =
	| {
			ok: true;
			live: true;
			target: AiModelCheckTarget;
			// the provider-native model that answered
			model: string | null;
			// claude | openai | vault | test
			provider: string;
			billing: AiModelCheckBilling;
			reply: string;
			latencyMs: number;
			costMicros: number;
			checkedAt: string;
	  }
	| {
			ok: true;
			live: false;
			target: AiModelCheckTarget;
			model: string | null;
			provider: string | null;
			billing: AiModelCheckBilling | null;
			// a short, user-facing reason — never a provider body or credential
			error: string;
			latencyMs: number;
			costMicros: number;
			checkedAt: string;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const identifier = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed && trimmed.length <= MAX_ID_CHARS && ID_PATTERN.test(trimmed) ? trimmed : null;
};

/**
 * The request body: exactly one of `model` (a catalog model id) or
 * `providerId` (one of the caller's Secure Vault / ChatGPT plan connections).
 * Nothing else is accepted — no prompt, effort, endpoint or credential.
 */
export const parseAiModelCheckInput = (body: unknown): AiModelCheckTarget => {
	if (!isRecord(body)) throw new TypeError('Expected a model check request.');
	if (Object.keys(body).some((key) => key !== 'model' && key !== 'providerId')) throw new TypeError('Unsupported model check option.');
	const hasModel = body.model !== undefined && body.model !== null;
	const hasProvider = body.providerId !== undefined && body.providerId !== null;
	if (hasModel === hasProvider) throw new TypeError('Send exactly one of model or providerId.');
	if (hasModel) {
		const model = identifier(body.model);
		if (!model || model === 'default') throw new TypeError('model must be a catalog model id.');
		return { model };
	}
	const providerId = identifier(body.providerId);
	if (!providerId) throw new TypeError('providerId must be one of your provider connection ids.');
	return { providerId };
};

/** The cheapest reasoning tier the catalog row offers (catalog order is ascending), or null. */
export const lowestAiModelCheckEffort = (efforts: readonly string[] | null | undefined): string | null =>
	Array.isArray(efforts) && efforts.length ? efforts[0] ?? null : null;

/** The model's answer as one short line ("Y"), or '' when it said nothing visible. */
export const summarizeAiModelCheckReply = (text: unknown): string => {
	if (typeof text !== 'string') return '';
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length > AI_MODEL_CHECK_REPLY_CHARS ? `${line.slice(0, AI_MODEL_CHECK_REPLY_CHARS - 1)}…` : line;
};

const statusOf = (error: unknown): number | null => {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
};

const codeOf = (error: unknown): string => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === 'string' ? code : '';
};

const nameOf = (error: unknown): string => {
	const name = (error as { name?: unknown } | null)?.name;
	return typeof name === 'string' ? name : '';
};

/**
 * A short, safe reason for a failed catalog-model check. Only the HTTP
 * status, a model-unavailable code and transport class are read — provider
 * bodies and SDK messages (which can echo request details) are never
 * forwarded. Vault connections use friendlyVaultProviderError instead.
 */
export const describeAiModelCheckFailure = (label: string, error: unknown, options: { timedOut?: boolean } = {}): string => {
	const name = label.trim() || 'This model';
	if (options.timedOut) return `${name} did not answer within ${Math.round(AI_MODEL_CHECK_TIMEOUT_MS / 1000)} s.`;
	const status = statusOf(error);
	if (codeOf(error) === 'model_not_available' || status === 404 || status === 410) return `${name} is not available from its provider right now (model not found).`;
	if (status === 401 || status === 403) return `The provider rejected the server key for ${name} (HTTP ${status}).`;
	if (status === 402) return `The provider reports no remaining credit for ${name} (HTTP 402).`;
	if (status === 429) return `${name} is rate-limited or out of quota right now (HTTP 429).`;
	if (status !== null && status >= 500) return `${name}'s provider is having trouble (HTTP ${status}).`;
	if (status !== null && status >= 400) return `${name} rejected the check request (HTTP ${status}).`;
	if (/connection|timeout/i.test(nameOf(error))) return `${name}'s provider could not be reached.`;
	return `${name} did not answer the check.`;
};
