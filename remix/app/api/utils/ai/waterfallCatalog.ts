import type { AiModelPublic } from './modelsCore';
import type { LopuVaultProviderPublic } from '../lopu/vaultProviders';
import type { AiWaterfallEndpoint } from './waterfallConfig';

export const aiWaterfallEndpoints = (connections: readonly LopuVaultProviderPublic[] = [], models: readonly AiModelPublic[] = []): AiWaterfallEndpoint[] => [
	...(['anthropic', 'openai'] as const).map((provider) => ({
		id: `server:${provider}`,
		label: provider === 'anthropic' ? 'Thingtime · Anthropic API' : 'Thingtime · OpenAI API',
		models: models.filter((model) => model.available && model.provider === provider),
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
