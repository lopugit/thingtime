import React from 'react';
import { Box, Button, Flex, IconButton, Text, VisuallyHidden } from '@chakra-ui/react';

import {
  DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL,
  PR_CONFLICT_RESOLVER_MODEL_OPTIONS,
  normalizePrConflictResolverModelWaterfall,
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

const modelById = new Map(PR_CONFLICT_RESOLVER_MODEL_OPTIONS.map((model) => [model.id, model]));

const sameWaterfall = (left: PRConflictResolverModelId[], right: PRConflictResolverModelId[]) =>
  left.length === right.length && left.every((modelId, index) => modelId === right[index]);

const readCachedWaterfall = () =>
  normalizePrConflictResolverModelWaterfall(
    readLocalCache<unknown>(CACHE_KEY) ?? DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL
  );

export const PRConflictResolverModelWaterfallEditor = () => {
  const api = useApi();
  const lopu = useLopu();
  const [waterfall, setWaterfall] = React.useState<PRConflictResolverModelId[]>(readCachedWaterfall);
  const [savedWaterfall, setSavedWaterfall] = React.useState<PRConflictResolverModelId[]>(readCachedWaterfall);
  const [refreshing, setRefreshing] = React.useState(true);
  const [refreshFailed, setRefreshFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [moveAnnouncement, setMoveAnnouncement] = React.useState('');
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
    const labels = next.map((modelId) => modelById.get(modelId)?.label || modelId);
    setMoveAnnouncement(`Model order updated: ${labels.join(', ')}.`);
  }, []);

  const moveModel = React.useCallback(
    (modelId: PRConflictResolverModelId, direction: -1 | 1) => {
      const from = waterfall.indexOf(modelId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= waterfall.length) return;

      const next = [...waterfall];
      [next[from], next[to]] = [next[to], next[from]];
      updateWaterfall(next);
      const label = modelById.get(modelId)?.label || modelId;
      const priority = to === 0 ? 'Primary' : `Fallback ${to}`;
      setMoveAnnouncement(`${label} moved to ${priority}.`);
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

  const addModel = React.useCallback(
    (modelId: PRConflictResolverModelId) => {
      if (waterfall.includes(modelId)) return;
      updateWaterfall([...waterfall, modelId]);
    },
    [updateWaterfall, waterfall]
  );

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
        description: 'New conflict, rebase, and semantic-refresh runs will use this model order.',
        status: 'success',
        duration: 6000
      });
    } catch (err: any) {
      lopu({
        title: 'Could not save the conflict resolver order',
        description: err?.error || 'Your unsaved order is still here so you can try again.',
        status: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const unusedModels = PR_CONFLICT_RESOLVER_MODEL_OPTIONS.filter((model) => !waterfall.includes(model.id));

  const items = waterfall.map((modelId, index) => {
    const model = modelById.get(modelId)!;
    const priority = index === 0 ? 'Primary' : `Fallback ${index}`;

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

          <Box minWidth={0} flex="1 1 auto">
            <Flex alignItems="center" columnGap={2} flexWrap="wrap">
              <Text fontSize="sm" fontWeight={650} noOfLines={1}>
                {model.label}
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
              {modelId === 'default' ? 'Provider-selected model · Max effort when supported · always included' : 'Max effort'}
            </Text>
          </Box>

          <Flex alignItems="center" columnGap={1} flexShrink={0}>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={`Move ${model.label} up`}
              title={`Move ${model.label} up`}
              icon={<Text aria-hidden="true">↑</Text>}
              isDisabled={saving || index === 0}
              onClick={() => moveModel(modelId, -1)}
            />
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={`Move ${model.label} down`}
              title={`Move ${model.label} down`}
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
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={`Remove ${model.label}`}
                title={`Remove ${model.label}`}
                icon={<Text aria-hidden="true">×</Text>}
                isDisabled={saving}
                onClick={() => removeModel(modelId)}
              />
            )}
          </Flex>
        </Flex>
      )
    };
  });

  const status = dirty
    ? 'Unsaved changes'
    : refreshing
      ? 'Checking saved order…'
      : refreshFailed
        ? 'Showing the last-known saved order'
        : 'Saved';

  return (
    <Flex flexDirection="column" rowGap={3}>
      <Box>
        <Text sx={eyebrow}>AI workflow model order</Text>
        <Text marginTop={1} fontSize="sm" color="var(--tt-text, #5a5a66)">
          The first entry is preferred for merge-conflict resolution, stacked-PR rebases, and their semantic Graphify refreshes.
        </Text>
        <Text marginTop={1} fontSize="xs" color="var(--tt-muted, #8a8a96)">
          Conflict-editing calls try later entries only when a model is unavailable, overloaded, or returns an eligible server error. A completed attempt that leaves conflicts stops for review. Default is always included.
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

      {unusedModels.length > 0 && (
        <Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
          <Text fontSize="xs" color="var(--tt-muted, #8a8a96)">
            Add fallback
          </Text>
          {unusedModels.map((model) => (
            <Button
              key={model.id}
              size="xs"
              variant="outline"
              isDisabled={saving}
              onClick={() => addModel(model.id)}
            >
              + {model.label}
            </Button>
          ))}
        </Flex>
      )}

      <Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap">
        <Button size="xs" variant="outline" isLoading={saving} isDisabled={!dirty} onClick={save}>
          Save model order 💾
        </Button>
        <Text
          aria-live="polite"
          fontSize="xs"
          color={dirty ? 'var(--tt-accent, #6558d3)' : 'var(--tt-muted, #8a8a96)'}
        >
          {status}
        </Text>
      </Flex>
    </Flex>
  );
};
