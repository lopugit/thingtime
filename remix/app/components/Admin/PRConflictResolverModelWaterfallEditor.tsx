import React from 'react';
import { Box, Button, Flex, IconButton, Select, Text, VisuallyHidden } from '@chakra-ui/react';

import {
  AI_MODEL_EFFORT_LABELS,
  AI_MODEL_PROVIDER_LABELS,
  AI_WORKFLOW_BASE_MODELS,
  DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL,
  describeAiWorkflowModelChoice,
  normalizePrConflictResolverModelWaterfall,
  parseAiWorkflowModelOptionId,
  type AiModelEffort,
  type AiModelSpeed,
  type PRConflictResolverModelId
} from '~/api/utils/settings/prConflictResolverModelWaterfallCore';
import { useLopu } from '~/components/Lopu/useLopu';
import { ReorderableList } from '~/components/Nav/Drawer/ReorderableList';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

const CACHE_KEY = 'tt-admin-pr-conflict-resolver-model-waterfall-v1';

const eyebrow = {
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  opacity: 0.45
};

const baseModelById = new Map(AI_WORKFLOW_BASE_MODELS.map((model) => [model.id, model]));

// Base models an admin can add from the picker; `default` is always present
// in the waterfall (it cannot be removed), so it is never offered here.
const PICKER_MODELS = AI_WORKFLOW_BASE_MODELS.filter((model) => model.provider !== 'default');
// Derived from the catalog so a new provider's models appear in the picker
// with no editor change — adding a model to the catalog stays the whole
// registration.
const PICKER_PROVIDERS = [...new Set(PICKER_MODELS.map((model) => model.provider))];

// Full human name of one waterfall entry, for aria labels and live
// announcements where the row subtitle is not read alongside the title.
const entryName = (id: PRConflictResolverModelId): string => {
  const choice = parseAiWorkflowModelOptionId(id);
  if (!choice) return id;
  const bits = [choice.label];
  if (choice.effort) bits.push(AI_MODEL_EFFORT_LABELS[choice.effort]);
  if (choice.speed === 'fast') bits.push('Fast');
  return bits.join(' · ');
};

const composePickedId = (baseId: string, effort: '' | AiModelEffort, speed: AiModelSpeed) =>
  [baseId, ...(effort ? [effort] : []), ...(speed === 'fast' ? ['fast'] : [])].join(':');

const sameWaterfall = (left: PRConflictResolverModelId[], right: PRConflictResolverModelId[]) =>
  left.length === right.length && left.every((modelId, index) => modelId === right[index]);

const readCachedWaterfall = () =>
	normalizePrConflictResolverModelWaterfall(readLocalCache<unknown>(CACHE_KEY) ?? DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL);

export const PRConflictResolverModelWaterfallEditor = () => {
  const api = useApi();
  const lopu = useLopu();
  const [waterfall, setWaterfall] = React.useState<PRConflictResolverModelId[]>(readCachedWaterfall);
  const [savedWaterfall, setSavedWaterfall] = React.useState<PRConflictResolverModelId[]>(readCachedWaterfall);
  const [refreshing, setRefreshing] = React.useState(true);
  const [refreshFailed, setRefreshFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [moveAnnouncement, setMoveAnnouncement] = React.useState('');
  const [pickedModelId, setPickedModelId] = React.useState('');
  const [pickedEffort, setPickedEffort] = React.useState<'' | AiModelEffort>('');
  const [pickedSpeed, setPickedSpeed] = React.useState<AiModelSpeed>('normal');
	const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
	const [editingModelId, setEditingModelId] = React.useState('');
	const [editingEffort, setEditingEffort] = React.useState<'' | AiModelEffort>('');
	const [editingSpeed, setEditingSpeed] = React.useState<AiModelSpeed>('normal');
  const editGenerationRef = React.useRef(0);
  const saveGenerationRef = React.useRef(0);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  const dirty = !sameWaterfall(waterfall, savedWaterfall);

  React.useEffect(() => {
    let cancelled = false;
    const requestEditGeneration = editGenerationRef.current;
    const requestSaveGeneration = saveGenerationRef.current;

    apiRef.current.v1.settings
      .prConflictResolverModelWaterfall()
      .then((resp: any) => {
        // A save started after this background read. Its response is now the
        // authoritative one even if this older GET happens to finish last.
        if (cancelled || requestSaveGeneration !== saveGenerationRef.current) return;
        if (!resp?.ok) {
          setRefreshFailed(true);
          return;
        }

        const resolved = normalizePrConflictResolverModelWaterfall(resp.waterfall);
        setSavedWaterfall(resolved);
        writeLocalCache(CACHE_KEY, resolved);

        // Do not let a slow background read erase a reorder the admin has
        // already made while this request was in flight.
        if (requestEditGeneration === editGenerationRef.current) {
          setWaterfall(resolved);
        }
      })
      .catch(() => {
        if (!cancelled && requestSaveGeneration === saveGenerationRef.current) setRefreshFailed(true);
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateWaterfall = React.useCallback((next: unknown) => {
    editGenerationRef.current += 1;
    setWaterfall(normalizePrConflictResolverModelWaterfall(next));
  }, []);

  const announceOrder = React.useCallback((next: PRConflictResolverModelId[]) => {
    setMoveAnnouncement(`Model order updated: ${next.map(entryName).join(', ')}.`);
  }, []);

  const moveModel = React.useCallback(
    (modelId: PRConflictResolverModelId, direction: -1 | 1) => {
      const from = waterfall.indexOf(modelId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= waterfall.length) return;

      const next = [...waterfall];
      [next[from], next[to]] = [next[to], next[from]];
      updateWaterfall(next);
      const priority = to === 0 ? 'Primary' : `Fallback ${to}`;
      setMoveAnnouncement(`${entryName(modelId)} moved to ${priority}.`);
    },
    [updateWaterfall, waterfall]
  );

  const removeModel = React.useCallback(
    (modelId: PRConflictResolverModelId) => {
      if (modelId === 'default') return;
      updateWaterfall(waterfall.filter((entry) => entry !== modelId));
    },
    [updateWaterfall, waterfall]
  );

  const pickedModel = baseModelById.get(pickedModelId);
  const pickedId = pickedModel ? composePickedId(pickedModel.id, pickedEffort, pickedSpeed) : '';
  const pickedAlreadyListed = !!pickedId && waterfall.includes(pickedId);

  const pickModel = React.useCallback((nextModelId: string) => {
    setPickedModelId(nextModelId);
    // Effort tiers and fast mode are per-model: reset both on a model change.
    setPickedEffort('');
    setPickedSpeed('normal');
  }, []);

  const addPickedModel = React.useCallback(() => {
    if (!pickedId || waterfall.includes(pickedId)) return;
    updateWaterfall([...waterfall, pickedId]);
    setMoveAnnouncement(`${entryName(pickedId)} added as Fallback ${waterfall.length}.`);
  }, [pickedId, updateWaterfall, waterfall]);

	const startEditing = React.useCallback(
		(index: number) => {
			const choice = parseAiWorkflowModelOptionId(waterfall[index]);
			if (!choice || choice.model === 'default') return;
			setEditingIndex(index);
			setEditingModelId(choice.model);
			setEditingEffort(choice.effort ?? '');
			setEditingSpeed(choice.speed);
		},
		[waterfall]
	);

	const changeEditingModel = React.useCallback((modelId: string) => {
		setEditingModelId(modelId);
		setEditingEffort('');
		setEditingSpeed('normal');
	}, []);

	const applyEditing = React.useCallback(() => {
		if (editingIndex === null) return;
		const base = baseModelById.get(editingModelId);
		if (!base) return;
		const nextId = composePickedId(base.id, editingEffort, editingSpeed);
		if (waterfall.some((entry, index) => index !== editingIndex && entry === nextId)) return;
		const next = [...waterfall];
		next[editingIndex] = nextId;
		updateWaterfall(next);
		setMoveAnnouncement(`${entryName(nextId)} updated in place.`);
		setEditingIndex(null);
	}, [editingEffort, editingIndex, editingModelId, editingSpeed, updateWaterfall, waterfall]);

  const save = async () => {
    if (!dirty || saving) return;
    saveGenerationRef.current += 1;
    setSaving(true);

    try {
      const resp = await apiRef.current.v1.admin.setPrConflictResolverModelWaterfall(waterfall);
      if (!resp?.ok) {
        throw resp;
      }

      const resolved = normalizePrConflictResolverModelWaterfall(resp.waterfall);
      setWaterfall(resolved);
      setSavedWaterfall(resolved);
      writeLocalCache(CACHE_KEY, resolved);
      setRefreshFailed(false);
      setRefreshing(false);
      lopu({
        title: 'AI workflow model order saved ✨',
        description: 'New Claude-backed workflows and features will use this model order.',
        status: 'success',
        duration: 6000
      });
    } catch (err: any) {
      lopu({
        title: 'Could not save the AI model order',
        description: err?.error || 'Your unsaved order is still here so you can try again.',
        status: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const items = waterfall.map((modelId, index) => {
    const choice = parseAiWorkflowModelOptionId(modelId);
    const label = choice?.label || modelId;
    const name = entryName(modelId);
    const priority = index === 0 ? 'Primary' : `Fallback ${index}`;
		const isEditing = editingIndex === index;
		const editingModel = isEditing ? baseModelById.get(editingModelId) : null;
		const editingId = editingModel ? composePickedId(editingModel.id, editingEffort, editingSpeed) : '';
		const editingDuplicate = !!editingId && waterfall.some((entry, entryIndex) => entryIndex !== index && entry === editingId);

    return {
      id: modelId,
      node: (
        <Flex
          role="listitem"
          aria-posinset={index + 1}
          aria-setsize={waterfall.length}
          alignItems="center"
          columnGap={2}
          minHeight="60px"
          padding={2}
          paddingRight={3}
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-md, 12px)"
          background={index === 0 ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-card, #ffffff)'}
        >
          <Flex
            data-reorder-handle
            aria-hidden="true"
            alignItems="center"
            justifyContent="center"
            width="44px"
            height="44px"
            flex="0 0 44px"
            borderRadius="var(--tt-radius-sm, 9px)"
            color="var(--tt-muted, #9a9aa6)"
            cursor={saving ? 'not-allowed' : 'grab'}
            fontSize="18px"
            letterSpacing="-4px"
            sx={{ touchAction: 'pan-y' }}
            title="Hold, then drag to reorder"
          >
            ⋮⋮
          </Flex>

					{isEditing && editingModel ? (
						<Flex minWidth={0} flex="1 1 auto" gap={2} wrap="wrap" align="center">
							<Select
								size="xs"
								width="auto"
								maxW="240px"
								aria-label={`Edit model for ${priority}`}
								value={editingModelId}
								onChange={(event) => changeEditingModel(event.target.value)}
								isDisabled={saving}
							>
								{PICKER_PROVIDERS.map((provider) => (
									<optgroup key={provider} label={AI_MODEL_PROVIDER_LABELS[provider]}>
										{PICKER_MODELS.filter((model) => model.provider === provider).map((model) => (
											<option key={model.id} value={model.id}>
												{model.label}
											</option>
										))}
									</optgroup>
								))}
							</Select>
							{editingModel.efforts.length ? (
								<Select
									size="xs"
									width="auto"
									maxW="170px"
									aria-label={`Edit effort for ${priority}`}
									value={editingEffort}
									onChange={(event) => setEditingEffort(event.target.value as '' | AiModelEffort)}
									isDisabled={saving}
								>
									<option value="">Default effort</option>
									{editingModel.efforts.map((effort) => (
										<option key={effort} value={effort}>
											{AI_MODEL_EFFORT_LABELS[effort]}
										</option>
									))}
								</Select>
							) : null}
							{editingModel.speeds.includes('fast') ? (
								<Select
									size="xs"
									width="auto"
									maxW="120px"
									aria-label={`Edit speed for ${priority}`}
									value={editingSpeed}
									onChange={(event) => setEditingSpeed(event.target.value as AiModelSpeed)}
									isDisabled={saving}
								>
									<option value="normal">Normal</option>
									<option value="fast">Fast</option>
								</Select>
							) : null}
							<Button size="xs" colorScheme="purple" onClick={applyEditing} isDisabled={saving || editingDuplicate}>
								Apply
							</Button>
							<Button size="xs" variant="ghost" onClick={() => setEditingIndex(null)} isDisabled={saving}>
								Cancel
							</Button>
							{editingDuplicate ? (
								<Text fontSize="xs" color="orange.500">
									Already in the list.
								</Text>
							) : null}
						</Flex>
					) : (
          <Box minWidth={0} flex="1 1 auto">
            <Flex alignItems="center" columnGap={2} flexWrap="wrap">
              <Text fontSize="sm" fontWeight={650} noOfLines={1}>
                {label}
              </Text>
              <Text
                as="span"
                paddingX={2}
                paddingY="1px"
                borderRadius="999px"
                background={index === 0 ? 'var(--tt-accent-soft, #ececff)' : 'var(--tt-surface-alt, #f5f5f7)'}
                fontSize="10px"
                fontWeight={600}
                color="var(--tt-muted, #6f6f7a)"
              >
                {priority}
              </Text>
            </Flex>
            <Text fontSize="xs" color="var(--tt-muted, #8a8a96)" noOfLines={1}>
              {choice ? describeAiWorkflowModelChoice(choice) : 'Unknown entry'}
            </Text>
          </Box>
					)}

          <Flex alignItems="center" columnGap={1} flexShrink={0}>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={`Move ${name} up`}
              title={`Move ${name} up`}
              icon={<Text aria-hidden="true">↑</Text>}
              isDisabled={saving || index === 0}
              onClick={() => moveModel(modelId, -1)}
            />
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={`Move ${name} down`}
              title={`Move ${name} down`}
              icon={<Text aria-hidden="true">↓</Text>}
              isDisabled={saving || index === waterfall.length - 1}
              onClick={() => moveModel(modelId, 1)}
            />
            {modelId === 'default' ? (
              <Flex
                role="img"
                aria-label="Required fallback; cannot be removed"
                title="Required fallback; cannot be removed"
                alignItems="center"
                justifyContent="center"
                width="32px"
                height="32px"
                fontSize="13px"
              >
                🔒
              </Flex>
            ) : (
							<>
								<IconButton
									size="xs"
									variant="ghost"
									aria-label={`Edit ${name}`}
									title={`Edit ${name}`}
									icon={<Text aria-hidden="true">✎</Text>}
									isDisabled={saving}
									onClick={() => startEditing(index)}
								/>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={`Remove ${name}`}
                title={`Remove ${name}`}
                icon={<Text aria-hidden="true">×</Text>}
                isDisabled={saving}
                onClick={() => removeModel(modelId)}
              />
							</>
            )}
          </Flex>
        </Flex>
      )
    };
  });

	const status = dirty ? 'Unsaved changes' : refreshing ? 'Checking saved order…' : refreshFailed ? 'Showing the last-known saved order' : 'Saved';

  return (
    <Flex flexDirection="column" rowGap={3}>
      <Box>
        <Text sx={eyebrow}>AI workflow model order</Text>
        <Text marginTop={1} fontSize="sm" color="var(--tt-text, #5a5a66)">
					The first entry is preferred across AI-backed Thingtime features: conflict resolution, stacked-PR rebases, semantic Graphify refreshes, and
					Lopu musings. Add as many fallback entries as you like — every Claude and OpenAI model, with per-entry reasoning effort and normal/fast
					mode.
        </Text>
        <Text marginTop={1} fontSize="xs" color="var(--tt-muted, #8a8a96)">
          Workflow conflict edits run Claude-capable entries and try later ones only on eligible model failures. Direct Anthropic features use the
          first Anthropic entry; OpenAI-backed features use the first OpenAI entry; each falls back to its provider-valid model when Default comes
          first. Fast mode maps to Anthropic fast mode or OpenAI priority processing. Default is always included.
        </Text>
      </Box>

      <Flex role="list" aria-label="AI workflow model priority" flexDirection="column" rowGap={2}>
        <ReorderableList
          items={items}
          onReorder={(ids) => {
            updateWaterfall(ids);
            announceOrder(ids as PRConflictResolverModelId[]);
          }}
          disabled={saving}
          handleOnly
        />
      </Flex>

      <VisuallyHidden aria-live="polite">{moveAnnouncement}</VisuallyHidden>

      <Flex alignItems="flex-end" columnGap={2} rowGap={2} flexWrap="wrap">
        <Box>
          <Text fontSize="xs" color="var(--tt-muted, #8a8a96)" marginBottom={1}>
            Add fallback
          </Text>
          <Select
            size="xs"
            width="auto"
            maxWidth="240px"
            aria-label="Model to add"
            placeholder="Choose a model…"
            value={pickedModelId}
            isDisabled={saving}
            onChange={(event) => pickModel(event.target.value)}
          >
            {PICKER_PROVIDERS.map((provider) => (
              <optgroup key={provider} label={AI_MODEL_PROVIDER_LABELS[provider]}>
                {PICKER_MODELS.filter((model) => model.provider === provider).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Box>
        {pickedModel && pickedModel.efforts.length > 0 && (
          <Select
            size="xs"
            width="auto"
            maxWidth="180px"
            aria-label="Reasoning effort"
            value={pickedEffort}
            isDisabled={saving}
            onChange={(event) => setPickedEffort(event.target.value as '' | AiModelEffort)}
          >
            <option value="">Default effort</option>
            {pickedModel.efforts.map((effort) => (
              <option key={effort} value={effort}>
                {AI_MODEL_EFFORT_LABELS[effort]}
              </option>
            ))}
          </Select>
        )}
        {pickedModel && pickedModel.speeds.includes('fast') && (
          <Select
            size="xs"
            width="auto"
            maxWidth="140px"
            aria-label="Speed mode"
            value={pickedSpeed}
            isDisabled={saving}
            onChange={(event) => setPickedSpeed(event.target.value as AiModelSpeed)}
          >
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </Select>
        )}
        <Button
          size="xs"
          variant="outline"
          isDisabled={saving || !pickedId || pickedAlreadyListed}
          title={pickedAlreadyListed ? 'Already in the model order' : undefined}
          onClick={addPickedModel}
        >
          + Add
        </Button>
        {pickedAlreadyListed && (
          <Text fontSize="xs" color="var(--tt-muted, #8a8a96)">
            Already in the model order.
          </Text>
        )}
      </Flex>

      <Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap">
        <Button size="xs" variant="outline" isLoading={saving} isDisabled={!dirty} onClick={save}>
          Save model order 💾
        </Button>
				<Text aria-live="polite" fontSize="xs" color={dirty ? 'var(--tt-accent, #6558d3)' : 'var(--tt-muted, #8a8a96)'}>
          {status}
        </Text>
      </Flex>
    </Flex>
  );
};
