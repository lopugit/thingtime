import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { createClaudeOAuthClient } from './claudeOAuth';
import { resolveOwnedChatGPTPlan } from './chatgptPlanAdmission';
import type { OwnedPlanAdmission } from './chatgptPlanAdmissionCore';
import { adaptChatGPTResponsesRequest, normaliseChatGPTPlanError } from './chatgptPlanProtocol';
import { chatGPTPlanFailure, isChatGPTPlanProvider } from './chatgptPlanScope';
import {
	AI_MODEL_CHECK_MAX_OUTPUT_TOKENS,
	AI_MODEL_CHECK_PROMPT,
	AI_MODEL_CHECK_REQUEST_PREFIX,
	AI_MODEL_CHECK_SYSTEM,
	AI_MODEL_CHECK_TIMEOUT_MS,
	describeAiModelCheckFailure,
	lowestAiModelCheckEffort,
	summarizeAiModelCheckReply,
	type AiModelCheckBilling,
	type AiModelCheckOutcome,
	type AiModelCheckTarget
} from './modelCheckCore';
import { listAiModels } from './models';
import { resolveLopuModelChoice } from './modelsCore';
import { refreshUnavailableAiModel } from './modelSync';
import { LOPU_TEST_MODEL_ID, type PricedUsage } from './pricing';
import { assertLopuAccess } from '../lopu/access';
import { resolveLopuBilling, type LopuAccessRefusal, type LopuAccessUser } from '../lopu/accessCore';
import { debitLopuUsage } from '../lopu/accounting';
import { hasLopuChatProviderConfigured, lopuChatProviderMode, lopuOpenAiToolMode, vaultClientOptions } from '../lopu/chat';
import { getUserVaultProvider, userVaultConfigured } from '../lopu/userVault';
import {
	callVaultProviderCompletion,
	extractPlainCompletionText,
	extractPlainCompletionUsage,
	resolveVaultProviderClientConfig,
	type LopuVaultProviderRecord
} from '../lopu/vaultProviderClient';
import { friendlyVaultProviderError } from '../lopu/vaultProviders';
import {
	requiresOpenAiResponsesForTools,
	toAnthropicEffort,
	toOpenAiReasoningEffort,
	type AiModelEffort,
	type AiWorkflowModelChoice
} from '../settings/prConflictResolverModelWaterfallCore';

// POST /api/v1/ai/models/check — "is this model live?" (the model picker's
// Check Models button). One call checks exactly one selectable choice:
//
//   catalog model  → the SAME server client a chat turn uses for that
//                    provider (Claude OAuth runtime / the OpenAI key, with
//                    the Responses transport for models the registry marks),
//                    the catalog's cheapest effort tier, no fast lane
//   vault provider → the caller's own connection through the shared plain-
//                    completion adapter (the voice turn's path)
//   ChatGPT plan   → the owned runtime connection through the subscription
//                    Responses adapter, never API billing
//
// The model receives only AI_MODEL_CHECK_SYSTEM + "Live? Y/N": no tools, no
// history, no account data, no chat. There is never a fallback to another
// provider — the answer is about THIS choice. The Lopu access gate runs first
// (verified account, credits on Thingtime's keys, an in-flight slot exactly
// like a chat turn), and the tokens a check spends are recorded on the
// ledger as a `model-check` usage row. Nothing is written to a conversation.

export type AiModelCheckViewer = LopuAccessUser;

export type AiModelCheckCompletion = { text: string; model: string | null; usage: PricedUsage };

export type AiModelCheckServiceResult =
	| { kind: 'outcome'; outcome: AiModelCheckOutcome }
	| { kind: 'refused'; refusal: LopuAccessRefusal }
	| { kind: 'invalid'; status: number; error: string };

export type AiModelCheckDependencies = {
	listModels: typeof listAiModels;
	assertAccess: typeof assertLopuAccess;
	debit: typeof debitLopuUsage;
	providerMode: typeof lopuChatProviderMode;
	providerConfigured: typeof hasLopuChatProviderConfigured;
	refreshUnavailable: typeof refreshUnavailableAiModel;
	callCatalog: (choice: AiWorkflowModelChoice, signal: AbortSignal) => Promise<AiModelCheckCompletion>;
	vaultConfigured: () => boolean;
	resolveVault: (ownerId: string, providerId: string) => Promise<LopuVaultProviderRecord>;
	callVault: (provider: LopuVaultProviderRecord, signal: AbortSignal) => Promise<AiModelCheckCompletion>;
	resolvePlan: (request: Request, ownerId: string, providerId: string) => Promise<{ provider: LopuVaultProviderRecord; admission: OwnedPlanAdmission }>;
	callPlan: (provider: LopuVaultProviderRecord, signal: AbortSignal) => Promise<AiModelCheckCompletion>;
	now: () => number;
	randomId: () => string;
	timeoutMs?: number;
	log?: (message: string, detail?: unknown) => void;
};

const isAbortError = (error: unknown): boolean =>
	!!error && typeof error === 'object' && ((error as { name?: unknown }).name === 'AbortError' || (error as { name?: unknown }).name === 'APIUserAbortError');

// OpenAI Responses usage → the ledger's shape (cached input moved out of input)
const responsesUsage = (usage: unknown): PricedUsage => {
	if (!usage || typeof usage !== 'object') return null;
	const value = usage as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } };
	const count = (entry: unknown) => (typeof entry === 'number' && Number.isFinite(entry) && entry > 0 ? Math.floor(entry) : 0);
	const cached = count(value.input_tokens_details?.cached_tokens);
	return { inputTokens: Math.max(0, count(value.input_tokens) - cached), outputTokens: count(value.output_tokens), ...(cached ? { cacheReadTokens: cached } : {}) };
};

// ——— provider calls (production) ————————————————————————————————————————————

/** One tiny, tool-free call on the server client a chat turn would use for this catalog model. */
export const callCatalogModelCheck = async (
	choice: AiWorkflowModelChoice,
	signal: AbortSignal,
	clients: { anthropic?: () => Anthropic; openai?: () => OpenAI } = {}
): Promise<AiModelCheckCompletion> => {
	if (choice.provider === 'anthropic') {
		const client = clients.anthropic ? clients.anthropic() : createClaudeOAuthClient();
		const effort = toAnthropicEffort(choice.effort);
		const result = await client.messages.create(
			{
				model: choice.model,
				max_tokens: AI_MODEL_CHECK_MAX_OUTPUT_TOKENS,
				system: AI_MODEL_CHECK_SYSTEM,
				messages: [{ role: 'user', content: AI_MODEL_CHECK_PROMPT }],
				...(effort ? { output_config: { effort } } : {})
			} as Anthropic.Messages.MessageCreateParamsNonStreaming,
			{ signal }
		);
		return { text: extractPlainCompletionText('anthropic', result) ?? '', model: result.model || choice.model, usage: extractPlainCompletionUsage('anthropic', result) };
	}
	// one call per check: the SDK's default retries would re-send a 429/5xx and
	// turn a quick "no" into a slow, repeated one (the key + base URL still come
	// from OPENAI_API_KEY / OPENAI_BASE_URL exactly as for a chat turn)
	const client = clients.openai ? clients.openai() : new OpenAI({ maxRetries: 0 });
	const effort = toOpenAiReasoningEffort(choice.effort);
	if (lopuOpenAiToolMode() === 'native' && requiresOpenAiResponsesForTools(choice.model)) {
		const result = await client.responses.create(
			{
				model: choice.model,
				instructions: AI_MODEL_CHECK_SYSTEM,
				input: AI_MODEL_CHECK_PROMPT,
				max_output_tokens: AI_MODEL_CHECK_MAX_OUTPUT_TOKENS,
				store: false,
				...(effort ? { reasoning: { effort: effort as OpenAI.Reasoning['effort'] } } : {})
			},
			{ signal }
		);
		return { text: result.output_text ?? '', model: result.model || choice.model, usage: responsesUsage(result.usage) };
	}
	const result = await client.chat.completions.create(
		{
			model: choice.model,
			// never max_tokens: reasoning models reject it (see musing.ts)
			max_completion_tokens: AI_MODEL_CHECK_MAX_OUTPUT_TOKENS,
			messages: [
				{ role: 'system', content: AI_MODEL_CHECK_SYSTEM },
				{ role: 'user', content: AI_MODEL_CHECK_PROMPT }
			],
			...(effort ? { reasoning_effort: effort as OpenAI.ReasoningEffort } : {})
		},
		{ signal }
	);
	return { text: extractPlainCompletionText('openai', result) ?? '', model: result.model || choice.model, usage: extractPlainCompletionUsage('openai', result) };
};

/** One tiny call on the caller's own connection (shared plain-completion adapter). */
export const callVaultModelCheck = async (provider: LopuVaultProviderRecord, signal: AbortSignal): Promise<AiModelCheckCompletion> => {
	const completion = await callVaultProviderCompletion(provider, {
		system: AI_MODEL_CHECK_SYSTEM,
		history: [],
		prompt: AI_MODEL_CHECK_PROMPT,
		maxTokens: AI_MODEL_CHECK_MAX_OUTPUT_TOKENS,
		signal
	});
	return { text: completion.text, model: completion.model, usage: completion.usage };
};

/** One tiny Responses call on an owned ChatGPT plan connection (subscription contract, no API fallback). */
export const callPlanModelCheck = async (provider: LopuVaultProviderRecord, signal: AbortSignal): Promise<AiModelCheckCompletion> => {
	const config = await resolveVaultProviderClientConfig(provider);
	const client = new OpenAI(vaultClientOptions(config));
	const combined = provider.authSignal ? AbortSignal.any([signal, provider.authSignal]) : signal;
	const request = adaptChatGPTResponsesRequest({
		model: config.model,
		instructions: AI_MODEL_CHECK_SYSTEM,
		input: [{ role: 'user', content: AI_MODEL_CHECK_PROMPT }],
		max_output_tokens: AI_MODEL_CHECK_MAX_OUTPUT_TOKENS
	});
	const stream = (await client.responses.create(request as unknown as OpenAI.Responses.ResponseCreateParamsStreaming, { signal: combined })) as AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
	let text = '';
	let model: string | null = config.model;
	let usage: PricedUsage = null;
	for await (const event of stream) {
		combined.throwIfAborted();
		if (event.type === 'response.output_text.delta') text += event.delta;
		else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
			usage = responsesUsage(event.response.usage);
			model = event.response.model || model;
			if (!text) text = event.response.output_text ?? '';
		} else if (event.type === 'error' || event.type === 'response.failed') throw normaliseChatGPTPlanError(event);
	}
	return { text, model, usage };
};

// ——— the service ——————————————————————————————————————————————————————————

export const createAiModelCheckService = (deps: AiModelCheckDependencies) => {
	const timeoutMs = deps.timeoutMs ?? AI_MODEL_CHECK_TIMEOUT_MS;
	const log = deps.log ?? ((message: string, detail?: unknown) => console.warn(message, detail ?? ''));

	return async (request: Request, user: AiModelCheckViewer, target: AiModelCheckTarget, signal?: AbortSignal): Promise<AiModelCheckServiceResult> => {
		const startedAt = deps.now();
		const requestId = `${AI_MODEL_CHECK_REQUEST_PREFIX}-${deps.randomId()}`;
		const elapsed = () => Math.max(0, Math.round(deps.now() - startedAt));
		const stamp = () => new Date(deps.now()).toISOString();
		const notLive = (fields: { model: string | null; provider: string | null; billing: AiModelCheckBilling | null; error: string }): AiModelCheckServiceResult => ({
			kind: 'outcome',
			outcome: { ok: true, live: false, target, ...fields, latencyMs: elapsed(), costMicros: 0, checkedAt: stamp() }
		});

		// Run one provider call under the access gate: reserve → call (bounded) →
		// record usage → release. The caller's own abort propagates; the check's
		// own deadline becomes a "did not answer" result.
		const run = async (input: {
			billing: AiModelCheckBilling;
			provider: string;
			providerLabel?: string | null;
			model: string | null;
			pricingModel?: string | null;
			ownedPlan?: OwnedPlanAdmission | null;
			call: (signal: AbortSignal) => Promise<AiModelCheckCompletion>;
			failure: (error: unknown, timedOut: boolean) => Promise<string> | string;
		}): Promise<AiModelCheckServiceResult> => {
			const access = await deps.assertAccess(user, { billing: input.billing, reserve: true, ownedPlan: input.ownedPlan ?? null });
			if (access.ok === false) return { kind: 'refused', refusal: access };
			// a plain (ref'd, always cleared) timer rather than AbortSignal.timeout,
			// whose unref'd timer cannot be relied on to fire in every runtime
			const deadlineController = new AbortController();
			const deadline = deadlineController.signal;
			const timer = setTimeout(() => deadlineController.abort(), timeoutMs);
			const callSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
			try {
				let completion: AiModelCheckCompletion;
				try {
					completion = await input.call(callSignal);
				} catch (error) {
					if (signal?.aborted) throw error;
					const timedOut = deadline.aborted || (isAbortError(error) && !signal?.aborted);
					return notLive({ model: input.model, provider: input.provider, billing: input.billing, error: await input.failure(error, timedOut) });
				}
				const answered = completion.model || input.model;
				const usage = completion.usage ?? null;
				let costMicros = 0;
				const accounted = await deps.debit(user.id, {
					surface: 'model-check',
					billing: input.billing,
					provider: input.provider,
					providerLabel: input.providerLabel ?? null,
					model: answered,
					pricingModel: input.pricingModel === undefined ? answered : input.pricingModel,
					usage,
					requestId,
					durationMs: elapsed()
				}).catch((error: unknown) => {
					log('[ai-model-check] usage was not recorded', error);
					return null;
				});
				if (accounted && accounted.ok) costMicros = accounted.costMicros;
				return {
					kind: 'outcome',
					outcome: {
						ok: true,
						live: true,
						target,
						model: answered,
						provider: input.provider,
						billing: input.billing,
						reply: summarizeAiModelCheckReply(completion.text),
						latencyMs: elapsed(),
						costMicros,
						checkedAt: stamp()
					}
				};
			} finally {
				clearTimeout(timer);
				await access.release?.().catch(() => null);
			}
		};

		// ——— a catalog model on Thingtime's keys ———
		if (target.model) {
			const catalog = await deps.listModels({ id: user.id });
			const row = catalog.models.find((entry) => entry.id === target.model);
			if (!row) return { kind: 'invalid', status: 404, error: `Unknown model "${target.model.slice(0, 80)}".` };
			const provider = row.provider === 'anthropic' ? 'claude' : 'openai';
			const effort = lowestAiModelCheckEffort(row.efforts);
			const resolved = resolveLopuModelChoice({ model: row.id, ...(effort ? { effort: effort as AiModelEffort } : {}), speed: 'normal' }, catalog.models, { defaults: catalog.defaults });
			if (resolved.ok === false) return notLive({ model: row.id, provider, billing: null, error: resolved.error });
			const choice = resolved.choice;
			const mode = deps.providerMode();
			const billing = resolveLopuBilling({ vault: false, mode, configured: deps.providerConfigured() });
			if (billing === 'free') return notLive({ model: row.id, provider, billing: null, error: 'No AI provider is configured on this server.' });
			if (mode === 'test') {
				// LOPU_CHAT_PROVIDER=test: chat answers every model from the scripted
				// provider, so the check does too — deterministic and keyless.
				return run({
					billing,
					provider: 'test',
					model: choice.model,
					pricingModel: LOPU_TEST_MODEL_ID,
					call: async () => ({ text: 'Y', model: choice.model, usage: { inputTokens: 12, outputTokens: 1 } }),
					failure: () => describeAiModelCheckFailure(row.label, null)
				});
			}
			return run({
				billing,
				provider,
				model: choice.model,
				call: (callSignal) => deps.callCatalog(choice, callSignal),
				failure: async (error, timedOut) => {
					if (!timedOut) await deps.refreshUnavailable(row.provider, error).catch(() => null);
					return describeAiModelCheckFailure(row.label || row.id, error, { timedOut });
				}
			});
		}

		const providerId = target.providerId as string;

		// ——— an owned ChatGPT plan connection ———
		if (isChatGPTPlanProvider(providerId)) {
			let resolved: Awaited<ReturnType<AiModelCheckDependencies['resolvePlan']>>;
			try {
				resolved = await deps.resolvePlan(request, user.id, providerId);
			} catch (error) {
				return notLive({ model: null, provider: 'vault', billing: null, error: chatGPTPlanFailure(error).error });
			}
			const plan = resolved.provider;
			return run({
				billing: 'byo',
				provider: 'vault',
				providerLabel: plan.name,
				model: plan.model,
				ownedPlan: resolved.admission,
				call: (callSignal) => deps.callPlan(plan, callSignal),
				failure: (error, timedOut) => (timedOut ? describeAiModelCheckFailure(plan.name, error, { timedOut }) : normaliseChatGPTPlanError(error).message)
			});
		}

		// ——— one of the caller's Secure Vault connections ———
		if (!deps.vaultConfigured()) return { kind: 'invalid', status: 400, error: 'Secure Vault is not configured on this server.' };
		let connection: LopuVaultProviderRecord;
		try {
			connection = await deps.resolveVault(user.id, providerId);
		} catch {
			return { kind: 'invalid', status: 404, error: 'Choose one of your own provider connections.' };
		}
		return run({
			billing: 'byo',
			provider: 'vault',
			providerLabel: connection.name,
			model: connection.model,
			call: (callSignal) => deps.callVault(connection, callSignal),
			failure: (error, timedOut) => (timedOut ? describeAiModelCheckFailure(connection.name, error, { timedOut }) : friendlyVaultProviderError(connection.name, connection.model, error))
		});
	};
};

export const checkAiModel = createAiModelCheckService({
	listModels: listAiModels,
	assertAccess: assertLopuAccess,
	debit: debitLopuUsage,
	providerMode: lopuChatProviderMode,
	providerConfigured: hasLopuChatProviderConfigured,
	refreshUnavailable: refreshUnavailableAiModel,
	callCatalog: (choice, signal) => callCatalogModelCheck(choice, signal),
	vaultConfigured: userVaultConfigured,
	resolveVault: getUserVaultProvider,
	callVault: callVaultModelCheck,
	resolvePlan: (request, ownerId, providerId) => resolveOwnedChatGPTPlan(request, ownerId, providerId),
	callPlan: callPlanModelCheck,
	now: () => Date.now(),
	randomId: () => randomUUID()
});
