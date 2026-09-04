import React from 'react';

import { Box, Checkbox, Flex, Grid, IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Portal, Text } from '@chakra-ui/react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';

import { ChakraThingRenderer, HtmlThingRenderer, RenderThing, isChakraThingNode } from '~/components/Kinds';
import type { ChakraThingNode, HtmlThingNode } from '~/components/Kinds';
import { DeviceCard } from '~/components/Devices/DeviceCard';
import { DeviceListRow } from '~/components/Devices/DeviceListRow';
import type { DeviceRuntimeState } from '~/components/Devices/deviceTypes';
import { CARD_STYLES } from '~/theme/card';

import type {
  ThingsDisplayMode,
  ThingsThing} from './thingsCore';
import {
  VISIBILITY_META,
  formatWhen,
  interpolateRenderTree,
  isDuplicable,
  isFolder,
  primaryKindOf,
  thingDisplayName,
  thingIcon
} from './thingsCore';

// What a preview draws: an explicit serialized render template wins, then a
// thingtime post's embedded free-form thing, then the crystal itself (kind
// renderers structurally match post/recipe/link/etc. crystals directly).
const previewSourceOf = (thing: ThingsThing): unknown => {
  const crystal = thing.crystal || {};
  if (crystal.render && typeof crystal.render === 'object' && !Array.isArray(crystal.render)) return crystal.render;
  if (crystal.thing && typeof crystal.thing === 'object' && !Array.isArray(crystal.thing)) return crystal.thing;
  return crystal;
};

// The page looks a data thing's schema render template up per thing (fetched +
// cached there); views just pass it through to the preview box.
export type SchemaRenderLookup = (thing: ThingsThing) => Record<string, unknown> | null;

// Bounded, non-interactive live render of a thing. pointerEvents none keeps
// clicks selecting the tile (a link inside a preview must never hijack
// selection), and the height clamp keeps arbitrary things from bloating rows.
// A data thing whose schema ships a render template draws through THAT
// template with its own crystal values interpolated ({field} tokens) — always
// via the sanitising allowlist renderers, same as /schemas cards.
const ThingPreviewBox = ({
  thing,
  maxHeight,
  fallback,
  schemaRender
}: {
  thing: ThingsThing;
  maxHeight: string;
  fallback: React.ReactNode;
  schemaRender?: Record<string, unknown> | null;
}) => {
  if (isFolder(thing)) return <>{fallback}</>;
  let body: React.ReactNode;
  if (schemaRender) {
    const node = interpolateRenderTree(schemaRender, thing.crystal || {});
		body = isChakraThingNode(node) ? <ChakraThingRenderer node={node as ChakraThingNode} /> : <HtmlThingRenderer node={node as HtmlThingNode} />;
  } else {
    // component and action things pass WHOLE — the component kind renderer
    // resolves the template against savedArgs/defaults (raw crystal.render
    // would draw unresolved {tokens} and skip the ttAction fold), and the
    // action kind renderer matches on the whole-thing shape (a bare action
    // crystal has no kind/render key, so it would fall through to the
    // native tree instead of the ⚡ card)
    const source =
      thing.thingtime.includes('component') || thing.thingtime.includes('action')
        ? (thing as unknown as Record<string, unknown>)
        : previewSourceOf(thing);
    body = <RenderThing context={{ size: 'compact' }} fallback={fallback} thing={source} />;
  }
  return (
    <Box
      maxHeight={maxHeight}
      overflow="hidden"
      pointerEvents="none"
      position="relative"
      sx={{
        maskImage: 'linear-gradient(to bottom, black 82%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 82%, transparent 100%)'
      }}
      width="100%"
    >
      {body}
    </Box>
  );
};

// Per-item actions the page implements; views only surface them. 'open' is
// double-click/enter (folders navigate, posts go to /post/:id, the rest
// preview). Rename applies to kinds whose crystal carries a name.
export type ThingsItemAction =
  | 'open'
  | 'preview'
  | 'rename'
  | 'move'
  | 'share'
  | 'copy'
  | 'cut'
  | 'duplicate'
  | 'copyLink'
  | 'delete';

export type ThingsItemHandlers = {
  selected: Set<string>;
  cutIds: Set<string>;
  isMobile: boolean;
  // click = selection semantics (meta/shift handled by the page)
  onItemClick: (thing: ThingsThing, event: React.MouseEvent) => void;
  onItemOpen: (thing: ThingsThing) => void;
  onItemToggle: (thing: ThingsThing) => void;
  onItemAction: (thing: ThingsThing, action: ThingsItemAction) => void;
  // right-click → the Thing Context Menu at the pointer (page-owned)
  onItemContextMenu: (thing: ThingsThing, event: React.MouseEvent) => void;
  // HTML5 drag-and-drop: dragging a selected thing drags the whole selection;
  // folders (and the tree/breadcrumbs) are drop targets. null = the root,
  // undefined dropTargetId = nothing hovered.
  onItemDragStart: (thing: ThingsThing, event: React.DragEvent) => void;
  onItemDragEnd: () => void;
  dropTargetId: string | null | undefined;
  onFolderDragOver: (folderId: string | null, event: React.DragEvent) => void;
  onFolderDragLeave: (folderId: string | null) => void;
  onFolderDrop: (folderId: string | null, event: React.DragEvent) => void;
};

export type ThingsDevicePresentation = {
	devices?: DeviceRuntimeState[];
	deviceCounts?: Record<string, { commands: number; approvals: number }>;
	selectedDeviceId?: string | null;
	onDeviceSelect?: (deviceId: string) => void;
};

const pendingCommandCount = (state: DeviceRuntimeState): number =>
	state.commands.filter((command) => ['queued', 'claimed', 'leased', 'running', 'streaming', 'needs-approval'].includes(command.status)).length;

const pendingApprovalCount = (state: DeviceRuntimeState): number => state.approvals.filter((approval) => approval.status === 'pending').length;

const noopDeviceSelect = () => {};

const canRename = (thing: ThingsThing) => {
  const kind = primaryKindOf(thing);
  return kind === 'folder' || kind === 'data' || kind === 'schema';
};

// Prop bags every view spreads on its item rows/tiles: drag source on every
// thing, drop target + highlight on folders. Desktop only — mobile keeps
// tap-to-open and cut/paste.
const dragSourceProps = (thing: ThingsThing, handlers: ThingsItemHandlers) =>
  handlers.isMobile
    ? {}
    : {
        draggable: true,
        onDragStart: (event: React.DragEvent) => handlers.onItemDragStart(thing, event),
        onDragEnd: () => handlers.onItemDragEnd()
      };

const dropTargetProps = (thing: ThingsThing, handlers: ThingsItemHandlers) =>
  !isFolder(thing) || handlers.isMobile
    ? {}
    : {
        onDragOver: (event: React.DragEvent) => handlers.onFolderDragOver(thing.id, event),
        onDragLeave: () => handlers.onFolderDragLeave(thing.id),
        onDrop: (event: React.DragEvent) => handlers.onFolderDrop(thing.id, event)
      };

const dropHighlight = (thing: ThingsThing, handlers: ThingsItemHandlers) =>
  handlers.dropTargetId === thing.id
    ? {
        boxShadow: 'inset 0 0 0 2px var(--tt-accent, #f472b6)',
        background: 'var(--tt-accent-soft, rgba(244, 114, 182, 0.14))'
      }
    : {};

const ItemMenu = ({ thing, handlers }: { thing: ThingsThing; handlers: ThingsItemHandlers }) => (
  <Menu isLazy placement="bottom-end">
    <MenuButton
      aria-label="Thing actions"
      as={IconButton}
      icon={<MoreHorizontal size={15} />}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      size="xs"
      variant="ghost"
    />
    <Portal>
      <MenuList fontSize="13px" minWidth="180px" zIndex={10250}>
        <MenuItem onClick={() => handlers.onItemAction(thing, 'open')}>
          {isFolder(thing) ? '📂 Open' : thing.thingtime.includes('post') ? '📝 Open post' : '👀 Preview'}
        </MenuItem>
        {canRename(thing) && <MenuItem onClick={() => handlers.onItemAction(thing, 'rename')}>✏️ Rename</MenuItem>}
        <MenuItem onClick={() => handlers.onItemAction(thing, 'move')}>📁 Move to…</MenuItem>
        <MenuItem onClick={() => handlers.onItemAction(thing, 'share')}>🌐 Share…</MenuItem>
        <MenuDivider />
        <MenuItem onClick={() => handlers.onItemAction(thing, 'copy')}>📋 Copy</MenuItem>
        {/* the kebab menu is the ONLY path to these actions on touch devices
            (iOS never fires contextmenu), so it mirrors the right-click set */}
        {isDuplicable(thing) && (
          <MenuItem onClick={() => handlers.onItemAction(thing, 'duplicate')}>🐑 Duplicate</MenuItem>
        )}
        <MenuItem onClick={() => handlers.onItemAction(thing, 'cut')}>✂️ Cut</MenuItem>
        <MenuItem onClick={() => handlers.onItemAction(thing, 'copyLink')}>🔗 Copy link</MenuItem>
        <MenuDivider />
        <MenuItem color="var(--tt-danger, #e5484d)" onClick={() => handlers.onItemAction(thing, 'delete')}>
          🗑️ Delete
        </MenuItem>
      </MenuList>
    </Portal>
  </Menu>
);

const selectionStyles = (selected: boolean) =>
  selected
    ? {
        borderColor: 'var(--tt-accent, #f472b6)',
        boxShadow: '0 0 0 1px var(--tt-accent, #f472b6)',
        background: 'var(--tt-accent-soft, rgba(244, 114, 182, 0.08))'
      }
    : {};

const KindChip = ({ thing }: { thing: ThingsThing }) => (
	<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="10px" textTransform="uppercase">
    {primaryKindOf(thing)}
  </Text>
);

const VisibilityChip = ({ thing }: { thing: ThingsThing }) => {
  const meta = VISIBILITY_META[thing.visibility] || VISIBILITY_META.private;
  return (
    <Text color="var(--tt-muted, #9a9aa6)" fontSize="11px" title={meta.label} whiteSpace="nowrap">
      {meta.icon} {meta.label}
    </Text>
  );
};

// ---------------------------------------------------------------------------
// Grid view — Drive-style tiles ('name') that become a gallery in 'preview'.

export const ThingsGridView = ({
  items,
  handlers,
  displayMode,
	schemaRenderFor,
	devices = [],
	deviceCounts = {},
	selectedDeviceId = null,
	onDeviceSelect
}: {
  items: ThingsThing[];
  handlers: ThingsItemHandlers;
  displayMode: ThingsDisplayMode;
  schemaRenderFor?: SchemaRenderLookup;
} & ThingsDevicePresentation) => (
	<Grid gap={3} templateColumns={`repeat(auto-fill, minmax(${displayMode === 'preview' ? '230px' : '150px'}, 1fr))`}>
		{devices.map((state) =>
			state.summary ? (
				<DeviceCard
					device={state.summary}
					key={`device:${state.deviceId}`}
					onSelect={onDeviceSelect || noopDeviceSelect}
					pendingApprovalCount={deviceCounts[state.deviceId]?.approvals ?? pendingApprovalCount(state)}
					pendingCommandCount={deviceCounts[state.deviceId]?.commands ?? pendingCommandCount(state)}
					selected={selectedDeviceId === state.deviceId}
					snapshot={state.snapshot}
				/>
			) : null
		)}
    {items.map((thing) => {
      const selected = handlers.selected.has(thing.id);
      const iconBlock = (
        <Text fontSize="34px" lineHeight="1.1" marginTop={displayMode === 'preview' ? 0 : 3} textAlign="center">
          {thingIcon(thing)}
        </Text>
      );
      return (
        <Flex
          key={thing.id}
          {...CARD_STYLES}
          {...selectionStyles(selected)}
          {...dragSourceProps(thing, handlers)}
          {...dropTargetProps(thing, handlers)}
          {...dropHighlight(thing, handlers)}
          alignItems="center"
          cursor="pointer"
          data-thing-id={thing.id}
          direction="column"
          gap={1}
          onClick={(event) => handlers.onItemClick(thing, event)}
          onContextMenu={(event) => handlers.onItemContextMenu(thing, event)}
          onDoubleClick={() => handlers.onItemOpen(thing)}
          opacity={handlers.cutIds.has(thing.id) ? 0.45 : 1}
          padding={3}
          position="relative"
          role="group"
          transition="box-shadow 120ms ease, background 120ms ease"
          userSelect="none"
        >
          <Box
            _groupHover={{ opacity: 1 }}
            left={2}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            opacity={selected || handlers.isMobile ? 1 : 0}
            position="absolute"
            top={2}
            transition="opacity 120ms ease"
          >
            <Checkbox colorScheme="pink" isChecked={selected} onChange={() => handlers.onItemToggle(thing)} size="sm" />
          </Box>
          <Box position="absolute" right={1} top={1}>
            <ItemMenu handlers={handlers} thing={thing} />
          </Box>
          {displayMode === 'preview' ? (
            <Box marginTop={4} width="100%">
							<ThingPreviewBox fallback={iconBlock} maxHeight="150px" schemaRender={schemaRenderFor?.(thing) || null} thing={thing} />
            </Box>
          ) : (
            iconBlock
          )}
          <Text fontSize="13px" fontWeight={600} noOfLines={2} textAlign="center" wordBreak="break-word">
            {thingDisplayName(thing)}
          </Text>
          <Flex alignItems="center" gap={2}>
            <KindChip thing={thing} />
            <Text color="var(--tt-faint, #b6b6c0)" fontSize="10px">
              {formatWhen(thing.updatedAt)}
            </Text>
          </Flex>
        </Flex>
      );
    })}
  </Grid>
);

// ---------------------------------------------------------------------------
// List view — the columns layout (name, kind, audience, tags, updated).

export const ThingsListView = ({
  items,
  handlers,
  onToggleAll,
  allSelected,
  displayMode,
	schemaRenderFor,
	devices = [],
	deviceCounts = {},
	selectedDeviceId = null,
	onDeviceSelect
}: {
  items: ThingsThing[];
  handlers: ThingsItemHandlers;
  onToggleAll: () => void;
  allSelected: boolean;
  displayMode: ThingsDisplayMode;
  schemaRenderFor?: SchemaRenderLookup;
} & ThingsDevicePresentation) => (
	<Flex direction="column" gap={devices.length && items.length ? 3 : 0}>
		{devices.length ? (
			<Box {...CARD_STYLES} overflow="hidden" padding={0}>
				{devices.map((state) =>
					state.summary ? (
						<DeviceListRow
							device={state.summary}
							key={`device:${state.deviceId}`}
							onSelect={onDeviceSelect || noopDeviceSelect}
							pendingApprovalCount={deviceCounts[state.deviceId]?.approvals ?? pendingApprovalCount(state)}
							pendingCommandCount={deviceCounts[state.deviceId]?.commands ?? pendingCommandCount(state)}
							selected={selectedDeviceId === state.deviceId}
							snapshot={state.snapshot}
						/>
					) : null
				)}
			</Box>
		) : null}
		{items.length ? (
  <Box {...CARD_STYLES} overflow="hidden">
    <Flex
      alignItems="center"
      borderBottom="1px solid var(--tt-border, #ececef)"
      color="var(--tt-muted, #9a9aa6)"
      fontFamily="var(--tt-font-mono, monospace)"
      fontSize="10px"
      gap={3}
      paddingX={3}
      paddingY={2}
      textTransform="uppercase"
    >
      <Checkbox
        colorScheme="pink"
        isChecked={allSelected && items.length > 0}
        isIndeterminate={!allSelected && handlers.selected.size > 0}
        onChange={onToggleAll}
        size="sm"
      />
      <Text flex="1">Name</Text>
      <Text display={['none', 'block']} width="70px">
        Kind
      </Text>
      <Text display={['none', 'block']} width="90px">
        Audience
      </Text>
      <Text display={['none', null, 'block']} flex="0.7">
        Tags
      </Text>
      <Text textAlign="right" width="72px">
        Updated
      </Text>
      <Box width="24px" />
    </Flex>
    {items.map((thing) => {
      const selected = handlers.selected.has(thing.id);
      return (
        <Flex
          key={thing.id}
          background={selected ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.08))' : 'transparent'}
          {...dragSourceProps(thing, handlers)}
          {...dropTargetProps(thing, handlers)}
          {...dropHighlight(thing, handlers)}
          borderBottom="1px solid var(--tt-border, #ececef)"
          cursor="pointer"
          data-thing-id={thing.id}
          direction="column"
          onClick={(event) => handlers.onItemClick(thing, event)}
          onContextMenu={(event) => handlers.onItemContextMenu(thing, event)}
          onDoubleClick={() => handlers.onItemOpen(thing)}
          opacity={handlers.cutIds.has(thing.id) ? 0.45 : 1}
          paddingX={3}
          paddingY={2}
          sx={{ '&:last-of-type': { borderBottom: 'none' } }}
          userSelect="none"
        >
        <Flex alignItems="center" gap={3}>
          <Box onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <Checkbox colorScheme="pink" isChecked={selected} onChange={() => handlers.onItemToggle(thing)} size="sm" />
          </Box>
          <Flex alignItems="center" flex="1" gap={2} minWidth={0}>
            <Text fontSize="16px">{thingIcon(thing)}</Text>
            <Text fontSize="13px" fontWeight={500} noOfLines={1} wordBreak="break-all">
              {thingDisplayName(thing)}
            </Text>
            {isFolder(thing) && <ChevronRight color="var(--tt-faint, #b6b6c0)" size={13} />}
          </Flex>
          <Box display={['none', 'block']} width="70px">
            <KindChip thing={thing} />
          </Box>
          <Box display={['none', 'block']} width="90px">
            <VisibilityChip thing={thing} />
          </Box>
          <Flex display={['none', null, 'flex']} flex="0.7" gap={1} minWidth={0} overflow="hidden">
            {thing.tags.slice(0, 3).map((tag) => (
              <Text
                key={tag}
                background="var(--tt-surface, #fafafb)"
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="999px"
                color="var(--tt-muted, #9a9aa6)"
                fontSize="10px"
                paddingX={2}
                whiteSpace="nowrap"
              >
                #{tag}
              </Text>
            ))}
          </Flex>
          <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" textAlign="right" whiteSpace="nowrap" width="72px">
            {formatWhen(thing.updatedAt)}
          </Text>
          <ItemMenu handlers={handlers} thing={thing} />
        </Flex>
        {displayMode === 'preview' && !isFolder(thing) && (
          <Box marginLeft="44px" marginTop={2}>
									<ThingPreviewBox fallback={null} maxHeight="120px" schemaRender={schemaRenderFor?.(thing) || null} thing={thing} />
          </Box>
        )}
        </Flex>
      );
    })}
  </Box>
		) : null}
	</Flex>
);

// ---------------------------------------------------------------------------
// Columns view — Finder-style Miller columns. Each column lists one folder;
// opening a folder in column N reveals its children in column N+1.

export const ThingsColumnsView = ({
  path,
  itemsFor,
  activeFolderAt,
  onOpenFolderAt,
  handlers,
  displayMode,
	schemaRenderFor,
	devices = [],
	deviceCounts = {},
	selectedDeviceId = null,
	onDeviceSelect
}: {
  // folder ids by depth; index 0 is always null (the root)
  path: (string | null)[];
  itemsFor: (folderId: string | null) => ThingsThing[] | undefined;
  activeFolderAt: (depth: number) => string | null;
  onOpenFolderAt: (depth: number, folderId: string) => void;
  handlers: ThingsItemHandlers;
  displayMode: ThingsDisplayMode;
  schemaRenderFor?: SchemaRenderLookup;
} & ThingsDevicePresentation) => (
	<Flex {...CARD_STYLES} alignItems="stretch" minHeight="320px" overflowX="auto" padding={0} sx={{ WebkitOverflowScrolling: 'touch' }}>
    {path.map((folderId, depth) => {
      const items = itemsFor(folderId);
      const nextActive = activeFolderAt(depth);
      return (
        <Flex
          key={`${depth}-${folderId || 'root'}`}
          borderRight="1px solid var(--tt-border, #ececef)"
          direction="column"
          flexShrink={0}
          maxHeight="60vh"
          overflowY="auto"
          paddingY={1}
          sx={{ '&:last-of-type': { borderRight: 'none' } }}
          width={['85vw', '260px']}
        >
					{depth === 0
						? devices.map((state) =>
								state.summary ? (
									<DeviceListRow
										device={state.summary}
										key={`device:${state.deviceId}`}
										onSelect={onDeviceSelect || noopDeviceSelect}
										pendingApprovalCount={deviceCounts[state.deviceId]?.approvals ?? pendingApprovalCount(state)}
										pendingCommandCount={deviceCounts[state.deviceId]?.commands ?? pendingCommandCount(state)}
										selected={selectedDeviceId === state.deviceId}
										snapshot={state.snapshot}
									/>
								) : null
						  )
						: null}
          {(items || []).map((thing) => {
            const selected = handlers.selected.has(thing.id);
            const folder = isFolder(thing);
            const isOpenPath = folder && nextActive === thing.id;
            return (
              <Flex
                key={thing.id}
								background={isOpenPath ? 'var(--tt-surface, #fafafb)' : selected ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.08))' : 'transparent'}
                {...dragSourceProps(thing, handlers)}
                {...dropTargetProps(thing, handlers)}
                {...dropHighlight(thing, handlers)}
                cursor="pointer"
                data-thing-id={thing.id}
                direction="column"
                onClick={(event) => {
                  if (folder) {
                    onOpenFolderAt(depth, thing.id);
                  } else {
                    handlers.onItemClick(thing, event);
                  }
                }}
                onContextMenu={(event) => handlers.onItemContextMenu(thing, event)}
                onDoubleClick={() => handlers.onItemOpen(thing)}
                opacity={handlers.cutIds.has(thing.id) ? 0.45 : 1}
                paddingX={3}
                paddingY="6px"
                userSelect="none"
              >
                <Flex alignItems="center" gap={2}>
                  <Text fontSize="14px">{thingIcon(thing)}</Text>
                  <Text flex="1" fontSize="13px" noOfLines={1} wordBreak="break-all">
                    {thingDisplayName(thing)}
                  </Text>
                  <ItemMenu handlers={handlers} thing={thing} />
                  {folder && <ChevronRight color="var(--tt-faint, #b6b6c0)" size={13} />}
                </Flex>
                {displayMode === 'preview' && !folder && (
                  <Box marginLeft="24px" marginTop={1}>
										<ThingPreviewBox fallback={null} maxHeight="90px" schemaRender={schemaRenderFor?.(thing) || null} thing={thing} />
                  </Box>
                )}
              </Flex>
            );
          })}
					{items && !items.length && !(depth === 0 && devices.length) && (
            <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px" paddingX={3} paddingY={2}>
              Empty ✨
            </Text>
          )}
          {!items && (
            <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px" paddingX={3} paddingY={2}>
              Loading…
            </Text>
          )}
        </Flex>
      );
    })}
  </Flex>
);
