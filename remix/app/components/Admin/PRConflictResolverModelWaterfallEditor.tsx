import { SettingsSection } from '~/components/Settings/SettingsSection';
import React from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { SavedAiWaterfallSelector } from '~/components/AI/SavedAiWaterfallSelector';
import {
	parseAiWorkflowModelOptionId, parsePublishedAiWorkflowChoice, getAiWorkflowBaseModel, AI_MODEL_EFFORT_LABELS, type AiWorkflowBaseModel, type AiModelEffort
} from '~/api/utils/settings/prConflictResolverModelWaterfallCore';
import type { AiWaterfallConfig } from '~/api/utils/ai/waterfallConfig';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';

const CACHE_KEY = 'tt-admin-pr-conflict-resolver-model-waterfall-v1';
const cached = () => {const value=readLocalCache<unknown>(CACHE_KEY);return Array.isArray(value)&&value.length?value.filter((id):id is string=>typeof id==='string'):['default'];};
const cachedCatalog=()=>readLocalCache<AiWorkflowBaseModel[]>(CACHE_KEY+'-catalog')??readLocalCache<AiWorkflowBaseModel[]>('tt-ai-available-models')??[];
const endpoints = (['anthropic', 'openai', 'default'] as const).map((provider) => ({
	id: provider === 'default' ? 'default' : `server:${provider}`,
	label: provider === 'default' ? 'Provider default' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI',
	models: provider === 'default' ? [{ id: 'default', label: 'Default model', efforts: [], speeds: ['normal' as const] }] : []
}));
const asConfig = (waterfall: string[],models:readonly AiWorkflowBaseModel[]): AiWaterfallConfig => ({
 version:1,entries:waterfall.flatMap(id=>{
  const base=models.find(model=>model.id===id.split(':')[0])??getAiWorkflowBaseModel(id.split(':')[0]);
  // A cached selection remains representable while the async published
  // catalogue loads. This presentation fallback never authorizes a save/run.
  const choice=parsePublishedAiWorkflowChoice(id,models)??parseAiWorkflowModelOptionId(id,base?{...base,efforts:Object.keys(AI_MODEL_EFFORT_LABELS) as AiModelEffort[],speeds:['normal','fast']}:undefined);
  return choice?[{endpointId:choice.provider==='default'?'default':`server:${choice.provider}`,modelId:choice.model,effort:choice.effort,speed:choice.speed}]:[];
 })
});

export const PRConflictResolverModelWaterfallEditor = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const [catalog,setCatalog]=React.useState(cachedCatalog);
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
        if(cancelled)return;
        if(!response?.ok)throw new Error('Refresh failed');
        const published:AiWorkflowBaseModel[]=response.models??cachedCatalog();
        setCatalog(published);writeLocalCache(CACHE_KEY+'-catalog',published);
        // Catalogue refresh is independent of the draft-generation fence.
        // Opening/editing the chooser must not strand its outer catalogue.
        if(generation.current!==atStart)return;
        const next:string[]=response.waterfall;
        setWaterfall(next);setSaved(next);writeLocalCache(CACHE_KEY,next);
      })
			.catch(() => {
				if (!cancelled) setRefreshFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const dirty = JSON.stringify(waterfall) !== JSON.stringify(saved);
	const save = async (nextWaterfall = waterfall) => {
		generation.current += 1;
		setSaving(true);
		try {
			const response = await apiRef.current.v1.admin.setPrConflictResolverModelWaterfall(nextWaterfall);
			if (!response?.ok) throw new Error(response?.error || 'Could not save model order.');
			const published:AiWorkflowBaseModel[]=response.models??cachedCatalog();
        setCatalog(published);writeLocalCache(CACHE_KEY+'-catalog',published);
        const next:string[] = response.waterfall;
			setSaved(next);
			setWaterfall(next);
			writeLocalCache(CACHE_KEY, next);
			setRefreshFailed(false);
			lopu({ title: 'AI model order saved', status: 'success' });
		} catch (error) {
			lopu({ title: error instanceof Error ? error.message : 'Could not save model order.', status: 'error' });
			throw error;
		} finally {
			setSaving(false);
		}
	};
	return (
		<SettingsSection
			eyebrow="AI workflow model order"
			description="Shared model defaults for AI-backed features. Each runtime uses compatible entries."
			summary={`${waterfall.length} models · ${dirty ? 'Unsaved changes' : 'Saved'}`}
		>
			<Text fontSize="sm" overflowWrap="anywhere">
				{waterfall.map((id) => [parsePublishedAiWorkflowChoice(id,catalog)?.label || id, ...id.split(':').slice(1)].join(' · ')).join(' → ')}
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
				<Button size="sm" isDisabled={!dirty || saving} isLoading={saving} onClick={() => void save().catch(() => {})}>
					Save model order
				</Button>
			</Flex>
			<Text fontSize="xs">{dirty ? 'Unsaved changes' : refreshFailed ? 'Showing last-known order; reopen this page to refresh.' : 'Saved'}</Text>
			<SavedAiWaterfallSelector
				isOpen={open}
				value={asConfig(waterfall,catalog)}
				endpoints={endpoints}
				useLiveServerModels
				onSaveApply={async (config) => {
					await save(config.entries.map((entry) =>
						[entry.modelId, ...(entry.effort ? [entry.effort] : []), ...(entry.speed === 'fast' ? ['fast'] : [])].join(':')
					));
				}}
				allowInherit={false}
				onClose={() => setOpen(false)}
				onApply={(config) => {
					if (!config) return;
					generation.current += 1;
          setWaterfall(config.entries.map(entry=>[entry.modelId,...(entry.effort?[entry.effort]:[]),...(entry.speed==='fast'?['fast']:[])].join(':')));
				}}
			/>
		</SettingsSection>
	);
};
