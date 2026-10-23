import React from 'react';

import type { ThingContextMenuPresentation } from './ThingContextMenu';

// Trigger wiring for the Thing Context Menu. One hook covers the three
// documented ways in: hover a trigger (popover), right-click / long-press a
// target (context), or call openModal() from anywhere (modal). Spread the
// returned prop bags onto the trigger/target and pass menuProps to
// <ThingContextMenu/>.
//
// Documented at /docs/design-system?component=thing-context-menu.

export type UseThingContextMenuOptions = {
	// grace period before a hover-opened menu hides (ms); mirrors the
	// SettingsMenu linger so the pointer can travel into the surface
	hoverCloseDelay?: number;
};

export const useThingContextMenu = (options: UseThingContextMenuOptions = {}) => {
	const hoverCloseDelay = options.hoverCloseDelay ?? 555;

	const [open, setOpen] = React.useState(false);
	const [presentation, setPresentation] = React.useState<ThingContextMenuPresentation>('popover');
	const [position, setPosition] = React.useState<{ x: number; y: number } | undefined>(undefined);
	const [pinned, setPinned] = React.useState(false);

	const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const pinnedRef = React.useRef(pinned);

	React.useEffect(() => {
		pinnedRef.current = pinned;
	}, [pinned]);

	React.useEffect(() => {
		return () => {
			if (hideTimerRef.current) {
				clearTimeout(hideTimerRef.current);
			}
		};
	}, []);

	const cancelScheduledClose = React.useCallback(() => {
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current);
			hideTimerRef.current = null;
		}
	}, []);

	const closeMenu = React.useCallback(() => {
		cancelScheduledClose();
		setOpen(false);
		setPinned(false);
	}, [cancelScheduledClose]);

	const scheduleClose = React.useCallback(() => {
		cancelScheduledClose();
		hideTimerRef.current = setTimeout(() => {
			if (!pinnedRef.current) {
				setOpen(false);
			}
		}, hoverCloseDelay);
	}, [cancelScheduledClose, hoverCloseDelay]);

	const openPopover = React.useCallback(() => {
		cancelScheduledClose();
		setPresentation('popover');
		setOpen(true);
	}, [cancelScheduledClose]);

	// accepts React or native mouse events (duck-typed) so it can back both
	// onContextMenu props and addEventListener('contextmenu', …) wiring
	const openAtPointer = React.useCallback(
		(e: { preventDefault?: () => void; stopPropagation?: () => void; clientX: number; clientY: number }) => {
			e.preventDefault?.();
			e.stopPropagation?.();
			cancelScheduledClose();
			setPresentation('context');
			setPosition({ x: e.clientX, y: e.clientY });
			setOpen(true);
		},
		[cancelScheduledClose]
	);

	const openModal = React.useCallback(() => {
		cancelScheduledClose();
		setPresentation('modal');
		setOpen(true);
	}, [cancelScheduledClose]);

	// spread on the element whose hover opens the menu. Hovering the trigger
	// never hijacks a menu that is already open in another presentation
	// (e.g. a right-click menu positioned at the pointer).
	const hoverTriggerProps = React.useMemo(
		() => ({
			onMouseEnter: () => {
				if (open && presentation !== 'popover') {
					return;
				}
				openPopover();
			},
			onMouseLeave: () => {
				if (open && presentation !== 'popover') {
					return;
				}
				scheduleClose();
			}
		}),
		[open, presentation, openPopover, scheduleClose]
	);

	// spread on the element whose right-click opens the menu
	const contextTriggerProps = React.useMemo(
		() => ({
			onContextMenu: openAtPointer
		}),
		[openAtPointer]
	);

	// pass straight to <ThingContextMenu/>
	const menuProps = React.useMemo(
		() => ({
			open,
			presentation,
			position,
			pinned,
			onPinnedChange: setPinned,
			onClose: closeMenu,
			// hover menus stay open while the pointer is over the surface
			onSurfaceMouseEnter: presentation === 'popover' ? cancelScheduledClose : undefined,
			onSurfaceMouseLeave: presentation === 'popover' ? scheduleClose : undefined
		}),
		[open, presentation, position, pinned, closeMenu, cancelScheduledClose, scheduleClose]
	);

	return {
		open,
		presentation,
		position,
		pinned,
		setPinned,
		openPopover,
		openAtPointer,
		openModal,
		closeMenu,
		hoverTriggerProps,
		contextTriggerProps,
		menuProps
	};
};
