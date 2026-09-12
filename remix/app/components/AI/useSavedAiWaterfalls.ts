import React from 'react';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { aiWaterfallEndpoints } from '~/api/utils/ai/waterfallCatalog';
import type { SavedAiWaterfall } from '~/api/utils/ai/savedWaterfallCore';
import type { AiWaterfallConfig } from '~/api/utils/ai/waterfallConfig';
import type { LopuVaultProviderPublic } from '~/api/utils/lopu/vaultProviders';
export const useSavedAiWaterfalls = (userId: string, active = true) => {
	const cacheKey = `tt-ai-waterfalls-v1:${userId}`;
	const [items, setItems] = React.useState<SavedAiWaterfall[]>(() => readLocalCache<SavedAiWaterfall[]>(cacheKey) ?? []);
	const [connections, setConnections] = React.useState<LopuVaultProviderPublic[]>([]);
	const [error, setError] = React.useState('');
	const [refresh, setRefresh] = React.useState(0);
	const generation = React.useRef(0);
	const alive = React.useRef(true);
	React.useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	React.useEffect(() => {
		if (!active) return;
		const controller = new AbortController();
		const atStart = generation.current;
		void (async () => {
			try {
				await requireThingtimeCapability('api.ai-waterfalls', '1.0.0');
				const response = await fetch('/api/v1/ai/waterfalls', {
					signal: controller.signal,
					credentials: 'same-origin',
					headers: { 'x-thingtime-expected-user': userId }
				});
				const data = await response.json();
				if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load saved waterfalls.');
				if (!controller.signal.aborted && generation.current === atStart) {
					setItems(data.waterfalls);
					writeLocalCache(cacheKey, data.waterfalls);
					setError('');
				}
			} catch (cause) {
				if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not refresh saved waterfalls.');
			}
		})();
		void (async () => {
			try {
				await requireThingtimeCapability('api.ai-models', '1.4.0');
				const response = await fetch('/api/v1/ai/models', { signal: controller.signal, credentials: 'same-origin' });
				const data = await response.json();
				if (!response.ok) throw new Error('Endpoint list unavailable.');
				if (!controller.signal.aborted) setConnections(data.vaultProviders ?? []);
			} catch {
				if (!controller.signal.aborted) setError('Endpoint list could not be refreshed. Reopen to retry.');
			}
		})();
		return () => controller.abort();
	}, [active, cacheKey, refresh, userId]);
	const save = async (input: { id?: string; updatedAt?: string; name: string; config: AiWaterfallConfig }) => {
		await requireThingtimeCapability('api.ai-waterfalls', '1.0.0');
		generation.current++;
		const response = await fetch('/api/v1/ai/waterfalls', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json', 'x-thingtime-expected-user': userId },
			body: JSON.stringify(input)
		});
		const data = await response.json();
		if (!response.ok || !data.ok) {
			if (response.status === 409 && alive.current) setRefresh((value) => value + 1);
			throw new Error(data.error || 'Could not save waterfall.');
		}
		if (!alive.current) throw new Error('The account changed. Reopen the selector.');
		setItems((current) => {
			const next = [data.waterfall, ...current.filter((item) => item.id !== data.waterfall.id)];
			writeLocalCache(cacheKey, next);
			return next;
		});
		setError('');
		return data.waterfall as SavedAiWaterfall;
	};
	return { items, save, error, endpoints: aiWaterfallEndpoints(connections) };
};
