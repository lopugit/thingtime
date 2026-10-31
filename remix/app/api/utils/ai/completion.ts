import { getUserVaultProvider, listUserVaultProviders } from '../lopu/userVault';
import { callVaultProviderPlainCompletion } from '../lopu/vaultProviderClient';
import { isLopuVaultProviderKind } from '../lopu/vaultProviders';
import { parseAiCompletionInput, type AiCompletionInput } from './completionCore';
import { runAiProviderWaterfall } from './providerWaterfall';

export const createAiCompletionService = (dependencies: {
	list: typeof listUserVaultProviders;
	resolve: typeof getUserVaultProvider;
	call: typeof callVaultProviderPlainCompletion;
}) => async (ownerId: string, input: AiCompletionInput, signal?: AbortSignal) => {
	const parsed = parseAiCompletionInput(input);
	// Validate the entire selection before sending text to even the first
	// connection. Invalid/foreign IDs must not cause partial external delivery.
	const entries = await dependencies.list(ownerId);
	if (parsed.connectionIds.some((id) => !entries.some((entry) => entry.id === id && isLopuVaultProviderKind(entry.provider))))
		throw new TypeError('Choose your own AI connections.');
	const result = await runAiProviderWaterfall({
		connectionIds: parsed.connectionIds,
		signal,
		beforeAttempt: async () => { signal?.throwIfAborted(); },
		attempt: async (id, attemptSignal) => {
			// Re-resolve ownership/current credentials immediately before each
			// attempt. This never enumerates or decrypts the shared CI vault.
			const provider = await dependencies.resolve(ownerId, id);
			if (!provider.token || provider.token.startsWith('sk-ant-oat'))
				throw new TypeError('Use an endpoint credential, not a Claude session token.');
			return dependencies.call(provider, {
				system: parsed.system, prompt: parsed.prompt, history: [], maxTokens: 6000, signal: attemptSignal
			});
		}
	});
	return { text: result.value, connectionId: result.connectionId, attempts: result.attempts };
};

export const completeWithAiConnections = createAiCompletionService({
	list: listUserVaultProviders, resolve: getUserVaultProvider, call: callVaultProviderPlainCompletion
});
