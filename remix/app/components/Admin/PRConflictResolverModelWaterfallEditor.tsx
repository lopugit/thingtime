import React from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { SavedAiWaterfallSelector } from '~/components/AI/SavedAiWaterfallSelector';
import {
	AI_WORKFLOW_BASE_MODELS,
	normalizePrConflictResolverModelWaterfall,
	parseAiWorkflowModelOptionId
} from '~/api/utils/settings/prConflictResolverModelWaterfallCore';
import type { AiWaterfallConfig } from '~/api/utils/ai/waterfallConfig';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';

const CACHE_KEY = 'tt-admin-pr-conflict-resolver-model-waterfall-v1';
const cached = () => normalizePrConflictResolverModelWaterfall(readLocalCache(CACHE_KEY));
const endpoints = (['anthropic', 'openai', 'default'] as const).map((provider) => ({
	id: provider === 'default' ? 'default' : `server:${provider}`,
	label: provider === 'default' ? 'Provider default' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI',
	models: AI_WORKFLOW_BASE_MODELS.filter((model) => model.provider === provider)
}));
const asConfig = (waterfall: string[]): AiWaterfallConfig => ({
	version: 1,
	entries: waterfall.map((id) => {
		const choice = parseAiWorkflowModelOptionId(id)!;
		return {
			endpointId: choice.provider === 'default' ? 'default' : `server:${choice.provider}`,
			modelId: choice.model,
			effort: choice.effort,
			speed: choice.speed
		};
	})
});

export const PRConflictResolverModelWaterfallEditor = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const [waterfall, setWaterfall] = React.useState(cached);
	const [saved, setSaved] = React.useState(cached);
	const [open, setOpen] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
	const [refreshFailed, setRefreshFailed] = React.useState(false);
	const generation = React.useRef(0);
	React.useEffect(() => {
		let cancelled = false;
		const atStart = generation.current;
		apiRef.current.v1.settings
			.prConflictResolverModelWaterfall()
			.then((response: any) => {
				if (cancelled || generation.current !== atStart) return;
				if (!response?.ok) throw new Error('Refresh failed');
				const next = normalizePrConflictResolverModelWaterfall(response.waterfall);
				setWaterfall(next);
				setSaved(next);
				writeLocalCache(CACHE_KEY, next);
			})
			.catch(() => {
				if (!cancelled) setRefreshFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const dirty = JSON.stringify(waterfall) !== JSON.stringify(saved);
	const save = async () => {
		generation.current += 1;
		setSaving(true);
		try {
			const response = await apiRef.current.v1.admin.setPrConflictResolverModelWaterfall(waterfall);
			if (!response?.ok) throw new Error(response?.error || 'Could not save model order.');
			const next = normalizePrConflictResolverModelWaterfall(response.waterfall);
			setSaved(next);
			setWaterfall(next);
			writeLocalCache(CACHE_KEY, next);
			setRefreshFailed(false);
			lopu({ title: 'AI model order saved', status: 'success' });
		} catch (error) {
			lopu({ title: error instanceof Error ? error.message : 'Could not save model order.', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Flex direction="column" gap={3}>
			<Text fontWeight="600">AI workflow model order</Text>
			<Text fontSize="sm">Shared defaults for AI-backed features. Each runtime uses compatible entries; features can save their own waterfall.</Text>
			<Text fontSize="sm" overflowWrap="anywhere">
				{waterfall.map((id) => [parseAiWorkflowModelOptionId(id)?.label || id, ...id.split(':').slice(1)].join(' · ')).join(' → ')}
			</Text>
			<Flex gap={2} wrap="wrap">
				<Button
					size="sm"
					isDisabled={saving}
					onClick={() => {
						generation.current += 1;
						setOpen(true);
					}}
				>
					Choose AI waterfall
				</Button>
				<Button size="sm" isDisabled={!dirty || saving} isLoading={saving} onClick={() => void save()}>
					Save model order
				</Button>
			</Flex>
			<Text fontSize="xs">{dirty ? 'Unsaved changes' : refreshFailed ? 'Showing last-known order; reopen this page to refresh.' : 'Saved'}</Text>
			<SavedAiWaterfallSelector
				isOpen={open}
				value={asConfig(waterfall)}
				endpoints={endpoints}
				allowInherit={false}
				onClose={() => setOpen(false)}
				onApply={(config) => {
					if (!config) return;
					generation.current += 1;
					setWaterfall(
						normalizePrConflictResolverModelWaterfall(
							config.entries.map((entry) =>
								[entry.modelId, ...(entry.effort ? [entry.effort] : []), ...(entry.speed === 'fast' ? ['fast'] : [])].join(':')
							)
						)
					);
				}}
			/>
		</Flex>
	);
};
