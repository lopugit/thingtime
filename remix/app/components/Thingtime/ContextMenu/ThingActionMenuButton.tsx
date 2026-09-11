import React from 'react';
import { Box, IconButton } from '@chakra-ui/react';
import { MoreHorizontal } from 'lucide-react';
import { ThingContextMenu, type ThingContextMenuAction } from './ThingContextMenu';
import type { ThingContextMenuModel } from './contextMenuModel';
import { useThingContextMenu } from './useThingContextMenu';
import { useThingtime } from '../useThingtime';

// One accessible touch/keyboard/pointer entry point for persisted Things.
export function ThingActionMenuButton({ identity, model, onAction, onOpen, label = 'Thing actions', disabled = false }: {
  identity: string;
  model: ThingContextMenuModel;
  onAction: (event: ThingContextMenuAction) => void;
  onOpen?: () => void;
  label?: string;
  disabled?: boolean;
}) {
  const menu = useThingContextMenu();
  const { events } = useThingtime();
  const menuId = React.useId();
  const pinned = React.useRef(menu.pinned);
  pinned.current = menu.pinned;
  React.useEffect(() => {
    if (menu.open) events.next({ type: 'settings-menu-hide', uuid: menuId });
  }, [menu.open, events, menuId]);
  React.useEffect(() => {
    const subscription = events.subscribe((event: any) => {
      if (event?.type === 'settings-menu-hide' && event.uuid !== menuId && (!pinned.current || event.force)) menu.closeMenu();
    });
    return () => subscription?.unsubscribe?.();
  }, [events, menuId, menu.closeMenu]);
  const trigger = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => menu.closeMenu(), [identity, menu.closeMenu]);
  const close = () => { menu.closeMenu(); trigger.current?.focus({ preventScroll: true }); };
  return <Box display="inline-flex" position="relative" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <IconButton ref={trigger} aria-label={label} aria-haspopup="menu" aria-expanded={menu.menuProps.open}
      icon={<MoreHorizontal size={16} />} size="xs" variant="ghost" isDisabled={disabled}
      onClick={() => { if (menu.menuProps.open) close(); else { onOpen?.(); menu.openPopover(); } }}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); onOpen?.(); menu.openPopover(); } }} />
    <ThingContextMenu {...menu.menuProps} onSurfaceMouseLeave={undefined} model={model} onClose={close} onAction={onAction} />
  </Box>;
}
