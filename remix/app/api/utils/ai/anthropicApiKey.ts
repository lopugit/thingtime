import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { AiTransportFailure, type AiTransportFailureReason } from './providerWaterfall';
import { isVaultGuardError } from '../lopu/vaultProviders';
import { validateAnthropicApiKey } from '../lopu/userVaultCore';

// Explicit Console authentication. No environment credentials, setup tokens,
// alternate auth mode or implicit retry/fallback may enter this client.
export const createAnthropicApiKeyClient = (options: ClientOptions): Anthropic => {
 const apiKey = validateAnthropicApiKey(typeof options.apiKey === 'string' ? options.apiKey : '');
 return new Anthropic({ ...options, apiKey, authToken: null, maxRetries: 0, logLevel: 'off' });
};

// Match only the SDK's structured response and complete known messages. Never
// inspect the SDK's formatted Error.message (it can echo the request). These
// literals are classifiers, not text to copy into an error or diagnostic log.
const diagnosticReason = (error: unknown, status: number | undefined): AiTransportFailureReason | undefined => {
 if (!(error instanceof Anthropic.APIError)) return undefined;
 const body = error.error as { type?: unknown; error?: { type?: unknown; message?: unknown; details?: { error_code?: unknown } } } | undefined;
 if (body?.type !== 'error') return undefined;
 const detail = body.error;
 if (status === 402 && detail?.type === 'billing_error') return 'billing';
 if (status === 429 && detail?.type === 'rate_limit_error' && detail.details?.error_code === 'enforced_spend_limit_reached') return 'spend_limit';
 if (typeof detail?.message !== 'string') return undefined;
 const message = detail.message;
 if (status === 400 && detail.type === 'invalid_request_error') {
  if (message === 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.') return 'billing';
  if (/^You have reached your specified(?: workspace)? API usage limits(?:\. You will regain access on \d{4}-\d{2}-\d{2} at 00:00 UTC)?\.$/.test(message)) return 'spend_limit';
  if ([
   'adaptive thinking is not supported on this model',
   '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.',
   '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.',
   'output_config: Extra inputs are not permitted',
   'output_config.effort: Extra inputs are not permitted'
  ].includes(message)) return 'unsupported_parameter';
 }
 if ((status === 403 && detail.type === 'permission_error') || (status === 404 && detail.type === 'not_found_error')) {
  if (/^(?:model: claude-[a-z0-9-]+|Your (?:organization|account) does not have access to (?:the )?model claude-[a-z0-9-]+\.?)$/.test(message)) return 'model_access';
 }
 return undefined;
};

// Only static diagnostic categories and a validated HTTP status cross this
// boundary. Unknown provider text, headers, request IDs and causes are dropped.
export const sanitizeAnthropicApiKeyError = (error: unknown): Error => {
 if (isVaultGuardError(error)) return error as Error;
 const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
 const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
 return new AiTransportFailure(safeStatus, diagnosticReason(error, safeStatus));
};
