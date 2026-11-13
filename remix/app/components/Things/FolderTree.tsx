import React, { useEffect, useRef, useState } from 'react';

import { Box, Button, Flex, Text, Tooltip } from '@chakra-ui/react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { ThingsThing } from './thingsCore';
import { isFolder, thingDisplayName, thingIcon } from './thingsCore';
import type { ThingsItemHandlers } from './ThingsViews';
import { ItemMenu, ItemSelection } from './ThingsViews';
import { browseClickIntent, BROWSE_CONTROLS_SX } from './browseInteraction';

// Collapsible folder tree — the desktop sidebar AND the Move dialog's picker
// (pick mode). Data comes from the page's folderPages map (one listing per
// folder, folders filtered out of it here); expanding a node asks the page to
// load that folder if it hasn't been fetched yet.

// Drag-and-drop wiring (sidebar only — the Move dialog picker passes none):
// every node is a drop target for the page's item drag, null = the root row.
export type FolderTreeDnd = {
  // folder id currently hovered by a drag (null = root row, undefined = none)
  dropTargetId: string | null | undefined;
  onDragOver: (folderId: string | null, event: React.DragEvent) => void;
  onDragLeave: (folderId: string | null) => void;
  onDrop: (folderId: string | null, event: React.DragEvent) => void;
};

export type FolderTreeProps = {
  // folder listing per key ('root' or folder shareId); undefined = not loaded
  itemsFor: (folderId: string | null) => ThingsThing[] | undefined;
  ensureLoaded: (folderId: string | null) => void;
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  // ids that can't be picked (the selection being moved + its descendants are
  // enforced server-side; disabling the exact ids here keeps the UI honest)
  disabledIds?: Set<string>;
  rootLabel?: string;
  dnd?: FolderTreeDnd;
  onNewFolder?: (parentId: string | null) => void;
  // Browse-only controls; Move dialog pickers keep their existing selection.
  handlers?: ThingsItemHandlers;
};

const dndProps = (folderId: string | null, dnd?: FolderTreeDnd) =>
  dnd
    ? {
        onDragOver: (event: React.DragEvent) => dnd.onDragOver(folderId, event),
        onDragLeave: () => dnd.onDragLeave(folderId),
        onDrop: (event: React.DragEvent) => dnd.onDrop(folderId, event)
      }
    : {};

const dndHighlight = (folderId: string | null, dnd?: FolderTreeDnd) =>
  dnd && dnd.dropTargetId === folderId
    ? { boxShadow: 'inset 0 0 0 2px var(--tt-accent, #f472b6)', background: 'var(--tt-accent-soft, rgba(244, 114, 182, 0.14))' }
    : {};

const TreeNode = ({
  folder,
  depth,
  props
}: {
  folder: ThingsThing;
  depth: number;
  props: FolderTreeProps;
}) => {
  const [open, setOpen] = useState(false);
  const [showFullName, setShowFullName] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const touchUntil = useRef(0);
  const children = (props.itemsFor(folder.id) || []).filter(isFolder);
  const active = props.currentFolderId === folder.id;
  const disabled = props.disabledIds?.has(folder.id) || false;
  const name = thingDisplayName(folder);
  const fullName = typeof folder.crystal?.title === 'string' && folder.crystal.title.trim()
    ? folder.crystal.title
    : typeof folder.crystal?.name === 'string' && folder.crystal.name.trim()
      ? folder.crystal.name
      : name;

  const clearHoldTimer = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const clearHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  useEffect(() => () => {
    clearHoldTimer();
    clearHideTimer();
  }, []);

  const startHold = () => {
    touchUntil.current = Date.now() + 700;
    clearHoldTimer();
    clearHideTimer();
    held.current = false;
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setShowFullName(true);
    }, 500);
  };
  const endHold = () => {
    touchUntil.current = Date.now() + 700;
    clearHoldTimer();
    if (held.current) {
      clearHideTimer();
      hideTimer.current = setTimeout(() => setShowFullName(false), 1800);
    }
  };
  useEffect(() => {
    clearHoldTimer();
    clearHideTimer();
    held.current = false;
    touchUntil.current = 0;
    setShowFullName(false);
  }, [props.currentFolderId]);
  useEffect(() => {
    if (!showFullName) return;
    const closeOnScroll = () => setShowFullName(false);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => window.removeEventListener('scroll', closeOnScroll, true);
  }, [showFullName]);

  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    const next = !open;
    setOpen(next);
    if (next) props.ensureLoaded(folder.id);
  };

  return (
    <Box>
      <Flex
        alignItems="center"
        background={active ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.08))' : 'transparent'}
        {...dndProps(folder.id, props.dnd)}
        {...dndHighlight(folder.id, props.dnd)}
        borderRadius="8px"
        cursor={disabled ? 'not-allowed' : 'pointer'}
        gap={1}
        data-tree-thing-id={folder.id}
        position="relative"
        role="group"
        sx={props.handlers ? { ...BROWSE_CONTROLS_SX,
          '& .thing-item-controls button, & .thing-item-controls label': { minWidth: '24px', minHeight: '24px' },
          '@media (hover: none), (pointer: coarse)': {
            ...BROWSE_CONTROLS_SX['@media (hover: none), (pointer: coarse)'],
            '& .thing-item-controls button, & .thing-item-controls label': { minWidth: '28px', minHeight: '28px' }
          }
        } : undefined}
        onContextMenu={props.handlers ? event => {
          if (held.current || Date.now() < touchUntil.current) { event.preventDefault(); return; }
          props.handlers!.onItemContextMenu(folder, event);
        } : undefined}
        opacity={disabled ? 0.4 : 1}
        paddingLeft={`${8 + depth * 14}px`}
        paddingRight={2}
        paddingY="2px"
        userSelect="none"
      >
        <Box aria-label={`${open ? 'Collapse' : 'Expand'} ${fullName}`} as="button" alignItems="center" display="inline-flex" flexShrink={0}
          justifyContent="center" minHeight="24px" minWidth="24px" onClick={toggle} type="button">
          {open ? (
            <ChevronDown color="var(--tt-faint, #b6b6c0)" size={13} />
          ) : (
            <ChevronRight color="var(--tt-faint, #b6b6c0)" size={13} />
          )}
        </Box>
        <Tooltip isOpen={showFullName} label={fullName} placement="bottom-start" hasArrow maxWidth="min(340px, calc(100vw - 32px))"
          onClose={() => setShowFullName(false)} sx={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
          <Flex as="button" type="button" alignItems="center" gap={1} flex="1" minWidth={0} textAlign="left"
            aria-expanded={open} aria-disabled={disabled} aria-label={fullName}
            onMouseEnter={() => { if (Date.now() >= touchUntil.current && matchMedia('(hover: hover) and (pointer: fine)').matches) setShowFullName(true); }}
            onMouseLeave={() => setShowFullName(false)}
            onFocus={() => { if (Date.now() >= touchUntil.current) setShowFullName(true); }} onBlur={() => setShowFullName(false)}
            onKeyDown={event => { touchUntil.current = 0; if (event.key === 'Escape') setShowFullName(false); else setShowFullName(true); }}
            onTouchStart={startHold} onTouchMove={() => { touchUntil.current = Date.now() + 700; clearHoldTimer(); setShowFullName(false); held.current = false; }}
            onTouchEnd={endHold} onTouchCancel={() => { touchUntil.current = Date.now() + 700; clearHoldTimer(); clearHideTimer(); held.current = false; setShowFullName(false); }}
            onPointerCancel={() => { clearHoldTimer(); clearHideTimer(); held.current = false; setShowFullName(false); }}
            onClick={event => {
              if (held.current) { held.current = false; event.preventDefault(); return; }
              if (disabled) return;
              const intent = props.handlers ? browseClickIntent(event) : 'open';
              if (intent === 'select') { props.handlers!.onItemClick(folder, event); return; }
              if (intent !== 'open') return;
              props.onPick(folder.id);
              if (!open) { setOpen(true); props.ensureLoaded(folder.id); }
            }}>
            <Text fontSize="13px">{thingIcon(folder)}</Text>
            <Text flex="1" fontSize="13px" fontWeight={active ? 600 : 400} noOfLines={1} wordBreak="break-all">
              {name}
            </Text>
          </Flex>
        </Tooltip>
        {props.handlers && <ItemSelection thing={folder} handlers={props.handlers} />}
        {props.handlers && <ItemMenu thing={folder} handlers={props.handlers} />}
      </Flex>
      {open && (
        <Box>
          {children.map((child) => (
            <TreeNode key={child.id} depth={depth + 1} folder={child} props={props} />
          ))}
          {props.onNewFolder && <Button size="xs" variant="ghost" ml={`${30 + depth * 14}px`} my={1} onClick={() => props.onNewFolder?.(folder.id)}>New folder +</Button>}
          {!props.onNewFolder && props.itemsFor(folder.id) && !children.length && (
            <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" paddingLeft={`${30 + depth * 14}px`} paddingY="2px">
              No subfolders
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

export const FolderTree = (props: FolderTreeProps) => {
  const rootFolders = (props.itemsFor(null) || []).filter(isFolder);
  const rootActive = props.currentFolderId === null;
  return (
    <Box>
      <Flex
        alignItems="center"
        background={rootActive ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.08))' : 'transparent'}
        {...dndProps(null, props.dnd)}
        {...dndHighlight(null, props.dnd)}
        borderRadius="8px"
        cursor="pointer"
        gap={2}
        onClick={() => props.onPick(null)}
        paddingX={2}
        paddingY="4px"
        userSelect="none"
      >
        <Text fontSize="13px">🏠</Text>
        <Text fontSize="13px" fontWeight={rootActive ? 600 : 400}>
          {props.rootLabel || 'All things'}
        </Text>
      </Flex>
      {rootFolders.map((folder) => (
        <TreeNode key={folder.id} depth={0} folder={folder} props={props} />
      ))}
      {props.onNewFolder && <Button size="xs" variant="ghost" ml={2} my={1} onClick={() => props.onNewFolder?.(null)}>New folder +</Button>}
      {!props.onNewFolder && props.itemsFor(null) && !rootFolders.length && (
        <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" paddingLeft={2} paddingY={1}>
          No folders yet — make one with New 📁
        </Text>
      )}
    </Box>
  );
};
