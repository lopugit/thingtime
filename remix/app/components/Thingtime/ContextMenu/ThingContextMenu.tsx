import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { Icon } from '../../Icon/Icon';
import type {
	ThingContextAction,
	ThingContextMenuModel,
	ThingContextSection,
	ThingContextSubmenu
} from './contextMenuModel';

// Thing Context Menu — design-system reference implementation.
//
// One menu surface, three presentations:
//   'popover'  anchored under a hover/click trigger (wrap in position:relative)
//   'context'  fixed at a pointer position (right-click / long-press)
//   'modal'    centered over a scrim (programmatic, e.g. from a button)
//
// The surface renders a ThingContextMenuModel (see contextMenuModel.ts) and
// reports every activation through onAction — it owns no thing state itself,
// so the same component serves the live app, the docs stories, and tests.
// Documented at /docs/design-system?component=thing-context-menu.

export type ThingContextMenuPresentation = 'popover' | 'context' | 'modal';

export type ThingContextMenuAction = {
	action: ThingContextAction;
	section: ThingContextSection;
	// present when the activation came from a submenu option
	option?: { key: string; label?: string };
};

export interface ThingContextMenuProps {
	model: ThingContextMenuModel;
	open: boolean;
	presentation?: ThingContextMenuPresentation;
	// thing being acted on; rendered in the header
	meta?: { path?: string; type?: string };
	// pointer position for the 'context' presentation
	position?: { x: number; y: number };
	pinned?: boolean;
	onPinnedChange?: (pinned: boolean) => void;
	onAction?: (args: ThingContextMenuAction) => void;
	onClose?: () => void;
	// close automatically after a non-submenu action fires (default true)
	closeOnAction?: boolean;
	// open with this action's submenu already expanded (docs/tests)
	defaultExpandedActionId?: string;
	// keep the menu open while the pointer is over it (hover presentations)
	onSurfaceMouseEnter?: () => void;
	onSurfaceMouseLeave?: () => void;
	width?: string;
	zIndex?: number;
}

const FOCUSABLE_ITEM_CLASS = 'thing-context-menu-item';

const CONTEXT_MENU_MARGIN = 8;

export const ThingContextMenu = (props: ThingContextMenuProps) => {
	const {
		model,
		open,
		presentation = 'popover',
		meta,
		position,
		pinned = false,
		onPinnedChange,
		onAction,
		onClose,
		closeOnAction = true,
		defaultExpandedActionId = null,
		onSurfaceMouseEnter,
		onSurfaceMouseLeave,
		width = '264px',
		zIndex = 1400
	} = props;

	const surfaceRef = React.useRef<HTMLDivElement>(null);
	const [expandedActionId, setExpandedActionId] = React.useState<string | null>(defaultExpandedActionId);

	// fresh open = submenus back to their default state
	React.useEffect(() => {
		if (open) {
			setExpandedActionId(defaultExpandedActionId);
		}
	}, [open, defaultExpandedActionId]);

	// clamp the context presentation inside the viewport
	const [clampedPosition, setClampedPosition] = React.useState(position);

	React.useEffect(() => {
		setClampedPosition(position);
	}, [position?.x, position?.y]);

	React.useEffect(() => {
		if (!open || presentation !== 'context' || !position) {
			return;
		}

		const surface = surfaceRef.current;
		if (!surface) {
			return;
		}

		const rect = surface.getBoundingClientRect();
		const maxX = window.innerWidth - rect.width - CONTEXT_MENU_MARGIN;
		const maxY = window.innerHeight - rect.height - CONTEXT_MENU_MARGIN;

		setClampedPosition({
			x: Math.max(CONTEXT_MENU_MARGIN, Math.min(position.x, maxX)),
			y: Math.max(CONTEXT_MENU_MARGIN, Math.min(position.y, maxY))
		});
	}, [open, presentation, position?.x, position?.y, expandedActionId]);

	const focusItemAt = React.useCallback((index: number) => {
		const surface = surfaceRef.current;
		if (!surface) {
			return;
		}

		const items = Array.from(surface.querySelectorAll<HTMLElement>(`.${FOCUSABLE_ITEM_CLASS}`));
		if (!items.length) {
			return;
		}

		const next = ((index % items.length) + items.length) % items.length;
		items[next]?.focus();
	}, []);

	const moveFocus = React.useCallback(
		(delta: number) => {
			const surface = surfaceRef.current;
			if (!surface) {
				return;
			}

			const items = Array.from(surface.querySelectorAll<HTMLElement>(`.${FOCUSABLE_ITEM_CLASS}`));
			const current = items.indexOf(document.activeElement as HTMLElement);

			focusItemAt(current === -1 ? (delta > 0 ? 0 : -1) : current + delta);
		},
		[focusItemAt]
	);

	const onSurfaceKeyDown = React.useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				moveFocus(1);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				moveFocus(-1);
			} else if (e.key === 'Home') {
				e.preventDefault();
				focusItemAt(0);
			} else if (e.key === 'End') {
				e.preventDefault();
				focusItemAt(-1);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				if (expandedActionId) {
					setExpandedActionId(null);
				} else {
					onClose?.();
				}
			}
		},
		[moveFocus, focusItemAt, expandedActionId, onClose]
	);

	// focus the first item when a keyboard-less open happens in modal mode so
	// Escape/arrows work immediately
	React.useEffect(() => {
		if (open && presentation === 'modal') {
			const timer = setTimeout(() => focusItemAt(0), 30);
			return () => clearTimeout(timer);
		}
	}, [open, presentation, focusItemAt]);

	const fireAction = React.useCallback(
		(section: ThingContextSection, action: ThingContextAction, option?: { key: string; label?: string }) => {
			if (action.disabled) {
				return;
			}

			onAction?.({ action, section, option });

			if (closeOnAction && !pinned) {
				onClose?.();
			}
		},
		[onAction, closeOnAction, pinned, onClose]
	);

	const onItemActivate = React.useCallback(
		(section: ThingContextSection, action: ThingContextAction) => {
			if (action.submenu) {
				setExpandedActionId((prev) => (prev === action.id ? null : action.id));
				return;
			}

			fireAction(section, action);
		},
		[fireAction]
	);

	const renderSubmenu = (section: ThingContextSection, action: ThingContextAction, submenu: ThingContextSubmenu) => {
		const selectedKey = submenu.kind === 'permissions' ? submenu.selectedKey : undefined;

		return (
			<Flex
				aria-label={`${action.label} options`}
				className="thing-context-menu-submenu"
				flexDirection="column"
				marginX="6px"
				marginBottom="4px"
				maxHeight="240px"
				overflowY="auto"
				background="var(--tt-surface, #fafafb)"
				border="1px solid var(--tt-border-light, #f0f0f2)"
				borderRadius="var(--tt-radius-sm, 9px)"
				role="group"
			>
				{submenu.options.map((option) => {
					const selected = selectedKey === option.key;
					const description = 'description' in option ? option.description : undefined;

					return (
						<Flex
							key={option.key}
							className={FOCUSABLE_ITEM_CLASS}
							alignItems="center"
							columnGap="8px"
							paddingX="10px"
							paddingY="6px"
							borderRadius="var(--tt-radius-xs, 7px)"
							background={selected ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
							_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
							_focusVisible={{ outline: 'none', background: 'var(--tt-surface-alt, #f5f5f7)' }}
							transition="background 0.15s ease"
							cursor="pointer"
							role="menuitemradio"
							aria-checked={selectedKey === undefined ? undefined : selected}
							tabIndex={-1}
							onClick={() => fireAction(section, action, { key: option.key, label: option.label })}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									fireAction(section, action, { key: option.key, label: option.label });
								}
							}}
						>
							<Icon name={option.icon || option.key} size="12px"></Icon>
							<Box minWidth={0}>
								<Text fontSize="xs" fontWeight={selected ? 600 : 400}>
									{option.label || option.key}
								</Text>
								{description && (
									<Text fontSize="10px" color="var(--tt-muted, #9a9aa6)" lineHeight="1.3">
										{description}
									</Text>
								)}
							</Box>
							{selected && (
								<Box marginLeft="auto">
									<Icon name="check" size="10px"></Icon>
								</Box>
							)}
						</Flex>
					);
				})}
			</Flex>
		);
	};

	const renderAction = (section: ThingContextSection, action: ThingContextAction) => {
		const expanded = expandedActionId === action.id;

		return (
			<React.Fragment key={action.id}>
				<Flex
					className={FOCUSABLE_ITEM_CLASS}
					alignItems="center"
					columnGap="9px"
					marginX="6px"
					paddingX="8px"
					paddingY="6px"
					borderRadius="var(--tt-radius-sm, 9px)"
					opacity={action.disabled ? 0.4 : 1}
					color={action.danger ? 'var(--tt-danger, #d6455a)' : 'inherit'}
					background="transparent"
					_hover={{
						background: action.danger ? 'rgba(214, 69, 90, 0.08)' : 'var(--tt-surface-alt, #f5f5f7)'
					}}
					_focusVisible={{
						outline: 'none',
						background: action.danger ? 'rgba(214, 69, 90, 0.08)' : 'var(--tt-surface-alt, #f5f5f7)'
					}}
					transition="background 0.15s ease"
					cursor={action.disabled ? 'not-allowed' : 'pointer'}
					role="menuitem"
					aria-disabled={action.disabled || undefined}
					aria-haspopup={action.submenu ? 'menu' : undefined}
					aria-expanded={action.submenu ? expanded : undefined}
					tabIndex={-1}
					onClick={() => onItemActivate(section, action)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							onItemActivate(section, action);
						} else if (e.key === 'ArrowRight' && action.submenu && !expanded) {
							e.preventDefault();
							setExpandedActionId(action.id);
						} else if (e.key === 'ArrowLeft' && action.submenu && expanded) {
							e.preventDefault();
							setExpandedActionId(null);
						}
					}}
				>
					<Icon name={action.icon} size="12px"></Icon>
					<Box minWidth={0}>
						<Text fontSize="xs" fontWeight={500} noOfLines={1}>
							{action.label}
						</Text>
						{action.hint && (
							<Text fontSize="10px" color="var(--tt-muted, #9a9aa6)" lineHeight="1.3" noOfLines={1}>
								{action.hint}
							</Text>
						)}
					</Box>
					{action.kbd && (
						<Text marginLeft="auto" fontFamily="var(--tt-font-mono, monospace)" fontSize="10px" color="var(--tt-faint, #b6b6c0)">
							{action.kbd}
						</Text>
					)}
					{action.submenu && (
						<Box
							marginLeft={action.kbd ? '6px' : 'auto'}
							color="var(--tt-faint, #b6b6c0)"
							fontSize="10px"
							transform={expanded ? 'rotate(90deg)' : 'none'}
							transition="transform 0.15s ease"
						>
							▸
						</Box>
					)}
				</Flex>
				{action.submenu && expanded && renderSubmenu(section, action, action.submenu)}
			</React.Fragment>
		);
	};

	const surface = (
		<Flex
			ref={surfaceRef}
			className="thing-context-menu"
			flexDirection="column"
			width={width}
			maxWidth="calc(100vw - 16px)"
			maxHeight={presentation === 'modal' ? 'min(70vh, 560px)' : 'min(80vh, 480px)'}
			overflowY="auto"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
			paddingBottom="6px"
			role="menu"
			aria-label={meta?.path ? `Options for ${meta.path}` : 'Thing options'}
			onKeyDown={onSurfaceKeyDown}
			onMouseEnter={onSurfaceMouseEnter}
			onMouseLeave={onSurfaceMouseLeave}
			onContextMenu={(e) => e.preventDefault()}
		>
			{/* header: thing path + type + pin/close */}
			<Flex
				alignItems="center"
				columnGap="8px"
				paddingX="14px"
				paddingTop="10px"
				paddingBottom="8px"
				borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
				marginBottom="4px"
			>
				<Box minWidth={0}>
					<Text
						fontFamily="var(--tt-font-mono, monospace)"
						fontSize="11px"
						color="var(--tt-muted, #9a9aa6)"
						noOfLines={1}
						wordBreak="break-all"
					>
						{meta?.path || 'thingtime'}
					</Text>
					{meta?.type && (
						<Text
							fontFamily="var(--tt-font-mono, monospace)"
							fontSize="10px"
							letterSpacing="0.08em"
							textTransform="uppercase"
							color="var(--tt-faint, #b6b6c0)"
						>
							{meta.type}
						</Text>
					)}
				</Box>
				<Flex marginLeft="auto" alignItems="center" columnGap="6px">
					{presentation !== 'modal' && onPinnedChange && (
						<Flex
							as="button"
							aria-label={pinned ? 'Unpin menu' : 'Pin menu open'}
							aria-pressed={pinned}
							opacity={pinned ? 1 : 0.45}
							_hover={{ opacity: 1 }}
							transition="opacity 0.15s ease"
							cursor="pointer"
							title={pinned ? 'Unpin menu' : 'Pin menu open'}
							onClick={() => onPinnedChange(!pinned)}
						>
							<Icon name={pinned ? 'pinned' : 'pin'} size="11px"></Icon>
						</Flex>
					)}
					{(presentation === 'modal' || onClose) && (
						<Flex
							as="button"
							aria-label="Close menu"
							opacity={0.45}
							_hover={{ opacity: 1 }}
							transition="opacity 0.15s ease"
							cursor="pointer"
							title="Close"
							onClick={() => onClose?.()}
						>
							<Icon name="❌" size="9px"></Icon>
						</Flex>
					)}
				</Flex>
			</Flex>

			{model.sections.map((section, sectionIdx) => (
				<React.Fragment key={section.id}>
					{sectionIdx > 0 && <Box borderTop="1px solid var(--tt-border-light, #f0f0f2)" marginY="4px" />}
					{section.label && (
						<Text
							paddingX="14px"
							paddingTop="4px"
							paddingBottom="2px"
							fontFamily="var(--tt-font-mono, monospace)"
							fontSize="9px"
							fontWeight={600}
							letterSpacing="0.1em"
							textTransform="uppercase"
							color="var(--tt-muted, #9a9aa6)"
						>
							{section.label}
						</Text>
					)}
					{section.actions.map((action) => renderAction(section, action))}
				</React.Fragment>
			))}
		</Flex>
	);

	if (!open) {
		return null;
	}

	if (presentation === 'modal') {
		return (
			<Flex
				className="thing-context-menu-scrim"
				position="fixed"
				inset={0}
				alignItems="center"
				justifyContent="center"
				background="rgba(20, 20, 26, 0.35)"
				zIndex={zIndex}
				onClick={(e) => {
					if (e.target === e.currentTarget) {
						onClose?.();
					}
				}}
			>
				{surface}
			</Flex>
		);
	}

	if (presentation === 'context') {
		return (
			<Box position="fixed" top={`${clampedPosition?.y ?? 0}px`} left={`${clampedPosition?.x ?? 0}px`} zIndex={zIndex}>
				{surface}
			</Box>
		);
	}

	// 'popover' — anchored by a position:relative wrapper around the trigger
	return (
		<Box position="absolute" top="100%" left={0} paddingTop="4px" zIndex={zIndex}>
			{surface}
		</Box>
	);
};
