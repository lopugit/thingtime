import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { AiTransportFailure } from './providerWaterfall';
import { isVaultGuardError } from '../lopu/vaultProviders';
import { validateAnthropicApiKey } from '../lopu/userVaultCore';

// Explicit Console authentication. No environment credentials, setup tokens,
// alternate auth mode or implicit retry/fallback may enter this client.
export const createAnthropicApiKeyClient = (options: ClientOptions): Anthropic => {
 const apiKey = validateAnthropicApiKey(typeof options.apiKey === 'string' ? options.apiKey : '');
 return new Anthropic({ ...options, apiKey, authToken: null, maxRetries: 0, logLevel: 'off' });
};

// SDK messages can contain an upstream body, credential or private URL. Only
// trusted local guard text and a validated HTTP status may cross this boundary.
export const sanitizeAnthropicApiKeyError = (error: unknown): Error => {
 if (isVaultGuardError(error)) return error as Error;
 const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
 return new AiTransportFailure(typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined);
};
