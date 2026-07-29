import React, { useState } from 'react';

import { Box, Flex, Text } from '@chakra-ui/react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { ThingsThing, isFolder, thingDisplayName, thingIcon } from './thingsCore';

// Collapsible folder tree — the desktop sidebar AND the Move dialog's picker
// (pick mode). Data comes from the page's folderPages map (one listing per
// folder, folders filtered out of it here); expanding a node asks the page to
// load that folder if it hasn't been fetched yet.
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
};

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
  const children = (props.itemsFor(folder.id) || []).filter(isFolder);
  const active = props.currentFolderId === folder.id;
  const disabled = props.disabledIds?.has(folder.id) || false;

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
        borderRadius="8px"
        cursor={disabled ? 'not-allowed' : 'pointer'}
        gap={1}
        onClick={() => {
          if (disabled) return;
          props.onPick(folder.id);
          if (!open) {
            setOpen(true);
            props.ensureLoaded(folder.id);
          }
        }}
        opacity={disabled ? 0.4 : 1}
        paddingLeft={`${8 + depth * 14}px`}
        paddingRight={2}
        paddingY="4px"
        userSelect="none"
      >
        <Box aria-label={open ? 'Collapse folder' : 'Expand folder'} as="button" onClick={toggle} type="button">
          {open ? (
            <ChevronDown color="var(--tt-faint, #b6b6c0)" size={13} />
          ) : (
            <ChevronRight color="var(--tt-faint, #b6b6c0)" size={13} />
          )}
        </Box>
        <Text fontSize="13px">{thingIcon(folder)}</Text>
        <Text flex="1" fontSize="13px" fontWeight={active ? 600 : 400} noOfLines={1} wordBreak="break-all">
          {thingDisplayName(folder)}
        </Text>
      </Flex>
      {open && (
        <Box>
          {children.map((child) => (
            <TreeNode key={child.id} depth={depth + 1} folder={child} props={props} />
          ))}
          {props.itemsFor(folder.id) && !children.length && (
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
      {props.itemsFor(null) && !rootFolders.length && (
        <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" paddingLeft={2} paddingY={1}>
          No folders yet — make one with New 📁
        </Text>
      )}
    </Box>
  );
};
