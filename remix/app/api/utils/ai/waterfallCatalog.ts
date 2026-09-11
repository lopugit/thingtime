import { AI_WORKFLOW_BASE_MODELS } from '../settings/prConflictResolverModelWaterfallCore';
import type { LopuVaultProviderPublic } from '../lopu/vaultProviders';
import type { AiWaterfallEndpoint } from './waterfallConfig';

export const aiWaterfallEndpoints = (connections: readonly LopuVaultProviderPublic[] = []): AiWaterfallEndpoint[] => [
	...(['anthropic', 'openai'] as const).map((provider) => ({
		id: `server:${provider}`,
		label: provider === 'anthropic' ? 'Thingtime · Anthropic API' : 'Thingtime · OpenAI API',
		models: AI_WORKFLOW_BASE_MODELS.filter((model) => model.provider === provider),
		hint: 'Uses the endpoint key configured on Thingtime. Missing keys fall through to the next entry.'
	})),
	...connections.map((connection) => ({
		id: `vault:${connection.id}`,
		label: `${connection.name}${connection.endpointHost ? ` · ${connection.endpointHost}` : ''}`,
		models: connection.model ? [{ id: connection.model, label: connection.model, efforts: [], speeds: ['normal' as const] }] : [],
		allowCustomModel: true,
		hint: connection.reason || 'Your Secure Vault endpoint. Enter the provider-native model ID.'
	}))
];
