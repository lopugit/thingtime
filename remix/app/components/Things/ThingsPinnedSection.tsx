import React from 'react';
import { Box, Button, Flex, Grid, Spinner, Text } from '@chakra-ui/react';
import { Pin } from 'lucide-react';
import { ThingsGridView, ThingsListView, type ThingsDevicePresentation, type ThingsItemHandlers, type SchemaRenderLookup } from './ThingsViews';
import type { ThingsDisplayMode, ThingsThing } from './thingsCore';
import type { ThingPathPinsController } from './useThingPathPins';
import type { ThingPinPath } from './thingPathPins';
import type { DeviceRuntimeState } from '../Devices/deviceTypes';

/** Pinned targets share one ordered surface, including devices, independently
 * of ordinary grouping/sort. Hidden targets retain their saved positions. */
export function ThingsPinnedSection({ controller, path, items, devices = [], handlers, devicePresentation = {}, displayMode, list = false, reordering, onReorderingChange, schemaRenderFor, compact = false, targetError, loadingTargets = false, retryTargets }: {
  controller: ThingPathPinsController; path: ThingPinPath; items: ThingsThing[]; devices?: DeviceRuntimeState[];
  handlers: ThingsItemHandlers; devicePresentation?: ThingsDevicePresentation; displayMode: ThingsDisplayMode;
  list?: boolean; reordering: boolean; onReorderingChange: (value: boolean) => void;
  schemaRenderFor?: SchemaRenderLookup; compact?: boolean; targetError?: string; loadingTargets?: boolean; retryTargets?: () => void;
}) {
  const state = controller.state(path);
  if (!controller.enabled) return null;
  const byId = new Map(items.map(thing => [thing.id, thing]));
  const devicesById = new Map(devices.map(device => [device.deviceId, device]));
  const visible = state.ids.filter(id => byId.has(id) || devicesById.has(id));
  if (!visible.length && !state.error && !targetError && !loadingTargets && !reordering) return null;
  return <Box data-pin-surface={JSON.stringify(path)} marginBottom={4} minWidth={0}>
    <Flex alignItems="center" gap={2} marginBottom={2} wrap="wrap" aria-busy={state.busy || loadingTargets || undefined}>
      <Pin size={13} /><Text fontSize="11px" color="var(--tt-muted, #9a9aa6)">Pinned{reordering ? ' · drag a handle or use the arrows' : ''}</Text>
      {(state.busy || loadingTargets) && <Spinner size="xs" label={state.busy ? "Saving pins" : "Loading pinned Things"} />}
      {reordering && <Button size="sm" marginLeft="auto" onClick={() => onReorderingChange(false)}>Done</Button>}
    </Flex>
    {(state.error || targetError) && <Flex alignItems="center" gap={2} marginBottom={2} wrap="wrap"><Text role="alert" fontSize="12px">{state.error || targetError}</Text><Button size="sm" variant="outline" onClick={() => { if (state.error) void controller.retry(path).catch(() => {}); if (targetError) retryTargets?.(); }}>Retry pins</Button></Flex>}
    {!visible.length && reordering && <Text fontSize="12px">Pin a Thing from its actions menu to arrange it here.</Text>}
    <Grid gap={list ? 1 : 3} templateColumns={list ? 'minmax(0, 1fr)' : `repeat(auto-fill, minmax(min(100%, ${displayMode === 'preview' ? '230px' : reordering ? '180px' : compact ? '110px' : '150px'}), 1fr))`}>
      {visible.map(id => {
        const thing = byId.get(id), device = devicesById.get(id);
        const common = { displayMode, handlers: compact ? { ...handlers, compact: true } : handlers, schemaRenderFor, ...devicePresentation, deviceSetup: undefined, items: thing ? [thing] : [], devices: device ? [device] : [] };
        return <Box key={id} minWidth={0} sx={{ '&[data-pin-drop-target="before"]': { boxShadow: '0 -3px 0 var(--tt-accent, #f472b6)' }, '&[data-pin-drop-target="after"]': { boxShadow: '0 3px 0 var(--tt-accent, #f472b6)' } }}>
          {list ? <ThingsListView {...common} hideHeader allSelected={false} onToggleAll={() => {}} /> : <ThingsGridView {...common} />}
        </Box>;
      })}
    </Grid>
  </Box>;
}
