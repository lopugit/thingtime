import React from 'react';

import { useThingtime } from '../../Thingtime/useThingtime';

// z-index ladder for the app chrome, above the fixed nav (9999) and below
// DevKit (99999+). Floating editor windows layer AROUND the drawer (bands
// 9900+ and 10040+, see EditorSplit) — so everything transient or blocking
// (popups, the trigger, modals, context menus) sits ABOVE the window bands
// and the hovered drawer, or frames would cover open menus and dialogs:
//   9900+   editor windows sent below the drawer
//   10000   drawer panel
//   10040+  editor windows above the drawer (their default)
//   10120   drawer panel while hovered (takes the front, hands it back)
//   10190   window drag ghosts / drop previews
//   10220   dropdowns & popups   10230 drawer trigger
//   10240/10250   modal overlay / modal
export const DRAWER_Z = 10000;
export const DRAWER_POPUP_Z = 10220;
export const DRAWER_TRIGGER_Z = 10230;
export const DRAWER_MODAL_OVERLAY_Z = 10240;
export const DRAWER_MODAL_Z = 10250;
// while the pointer is over the drawer it outranks floating editor windows
// (which default to layering above it — see EditorSplit's layer system)
export const DRAWER_HOVER_Z = 10120;

export const DRAWER_MIN_WIDTH = 220;
export const DRAWER_MAX_WIDTH = 520;
export const DRAWER_DEFAULT_WIDTH = 300;
export const DRAWER_TOP_LEVEL_DEFAULT_LIMIT = 5;
export const DRAWER_TOP_LEVEL_UNLIMITED = 'unlimited' as const;
export type DrawerTopLevelLimit = number | typeof DRAWER_TOP_LEVEL_UNLIMITED;

// keep the trigger button and a scrim strip reachable when the persisted
// width exceeds the viewport (e.g. resized wide on desktop, reopened on a phone)
export const DRAWER_VIEWPORT_GUTTER = 56;

// viewport-clamped CSS width expression shared by every drawer-width consumer;
// the persisted settings.drawer.width stays untouched so desktop restores fully
export const drawerWidthCss = (width: number): string => {
	return `min(${width}px, calc(100vw - ${DRAWER_VIEWPORT_GUTTER}px))`;
};

export const clampDrawerWidth = (width: any): number => {
	const numeric = Number(width);

	if (!Number.isFinite(numeric) || numeric <= 0) {
		return DRAWER_DEFAULT_WIDTH;
	}

	return Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, Math.round(numeric)));
};

export const normalizeDrawerTopLevelLimit = (limit: any): DrawerTopLevelLimit => {
	if (limit === DRAWER_TOP_LEVEL_UNLIMITED || limit === null || typeof limit === 'undefined' || limit === '') {
		return DRAWER_TOP_LEVEL_UNLIMITED;
	}

	const numeric = Number(limit);

	if (!Number.isFinite(numeric) || numeric <= 0) {
		return DRAWER_TOP_LEVEL_UNLIMITED;
	}

	return Math.max(1, Math.round(numeric));
};

// Matches Chakra's default md breakpoint (48em) — below it we treat the
// viewport as mobile for drawer behaviour branching.
const MOBILE_MEDIA_QUERY = '(max-width: 47.99em)';

export const useIsMobileViewport = (): boolean => {
	const [isMobile, setIsMobile] = React.useState(() => {
		try {
			return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
		} catch {
			return false;
		}
	});

	React.useEffect(() => {
		const media = window.matchMedia(MOBILE_MEDIA_QUERY);

		const onChange = () => {
			setIsMobile(media.matches);
		};

		onChange();
		media.addEventListener('change', onChange);

		return () => {
			media.removeEventListener('change', onChange);
		};
	}, []);

	return isMobile;
};

const DRAWER_RESIZE_EVENT = 'thingtime:drawer-resize';

// Broadcast live widths during a resize drag so layout (Main/Nav) can follow
// without flushing every pixel through setThingtime/localforage.
export const dispatchDrawerLiveWidth = (width: number | null) => {
	try {
		window.dispatchEvent(new CustomEvent(DRAWER_RESIZE_EVENT, { detail: width }));
	} catch {
		// nothing
	}
};

export const useDrawerLiveWidth = (): { width: number; resizing: boolean } => {
	const { width } = useDrawer();
	const [liveWidth, setLiveWidth] = React.useState<number | null>(null);

	React.useEffect(() => {
		const onResize = (event: any) => {
			setLiveWidth(typeof event?.detail === 'number' ? event.detail : null);
		};

		window.addEventListener(DRAWER_RESIZE_EVENT, onResize);

		return () => {
			window.removeEventListener(DRAWER_RESIZE_EVENT, onResize);
		};
	}, []);

	// resizing stays true until NavDrawer's queued width write settles, so
	// followers keep transitions disabled through the release frame
	return {
		width: liveWidth ?? width,
		resizing: liveWidth !== null
	};
};

// The account/settings modal is ephemeral UI state — deliberately NOT stored
// in thingtime so it never persists to localforage (no restore flash, no
// whole-tree serialize when it toggles). Provided by DrawerSystem.
const AccountModalContext = React.createContext<{ open: boolean; setOpen: (value: boolean) => void }>({
	open: false,
	setOpen: () => {
		console.warn('AccountModalContext used outside AccountModalProvider');
	}
});

export const AccountModalProvider = (props: { children: React.ReactNode }) => {
	const [open, setOpen] = React.useState(false);

	const value = React.useMemo(() => {
		return { open, setOpen };
	}, [open]);

	return <AccountModalContext.Provider value={value}>{props.children}</AccountModalContext.Provider>;
};

export type DrawerDirection = 'left' | 'right';

export const useDrawer = () => {
	const { thingtime, setThingtime, loading } = useThingtime();
	const accountModal = React.useContext(AccountModalContext);

	const drawerSettings = thingtime?.settings?.drawer;

	const open = !!drawerSettings?.open;
	const direction: DrawerDirection = drawerSettings?.opens?.direction === 'right' ? 'right' : 'left';
	const width = clampDrawerWidth(drawerSettings?.width);
	const topLevelLimit = normalizeDrawerTopLevelLimit(drawerSettings?.toplevelitems?.limit);
	const topLevelLimitIsUnlimited = topLevelLimit === DRAWER_TOP_LEVEL_UNLIMITED;
	const searchClosesDrawer = drawerSettings?.searchClosesDrawer !== false;
	const ordering = drawerSettings?.userDrawerOrdering || {};
	const selectedItem = drawerSettings?.selectedItem || 'home';
	const collapsedGroups = drawerSettings?.collapsedGroups || {};

	// Drawer chrome state is UI preference, not content — keep it out of the
	// undo/redo timeline.
	const setDrawerSetting = React.useCallback(
		(path: string, value: any) => {
			setThingtime?.(`settings.drawer.${path}`, value, {
				ignoreUndoRedo: true,
				namespace: 'drawer'
			});
		},
		[setThingtime]
	);

	const setOpen = React.useCallback(
		(value: boolean) => {
			setDrawerSetting('open', !!value);
		},
		[setDrawerSetting]
	);

	const toggleOpen = React.useCallback(() => {
		setOpen(!open);
	}, [open, setOpen]);

	const setWidth = React.useCallback(
		(value: number) => {
			setDrawerSetting('width', clampDrawerWidth(value));
		},
		[setDrawerSetting]
	);

	const setDirection = React.useCallback(
		(value: DrawerDirection) => {
			setDrawerSetting('opens.direction', value === 'right' ? 'right' : 'left');
		},
		[setDrawerSetting]
	);

	const setTopLevelLimit = React.useCallback(
		(value: DrawerTopLevelLimit) => {
			setDrawerSetting('toplevelitems.limit', normalizeDrawerTopLevelLimit(value));
		},
		[setDrawerSetting]
	);

	const setTopLevelLimitUnlimited = React.useCallback(() => {
		setDrawerSetting('toplevelitems.limit', DRAWER_TOP_LEVEL_UNLIMITED);
	}, [setDrawerSetting]);

	const setSearchClosesDrawer = React.useCallback(
		(value: boolean) => {
			setDrawerSetting('searchClosesDrawer', !!value);
		},
		[setDrawerSetting]
	);

	const setSelectedItem = React.useCallback(
		(id: string) => {
			setDrawerSetting('selectedItem', id);
		},
		[setDrawerSetting]
	);

	const setOrderingFor = React.useCallback(
		(listId: string, ids: string[]) => {
			setDrawerSetting('userDrawerOrdering', {
				...ordering,
				[listId]: ids
			});
		},
		[ordering, setDrawerSetting]
	);

	const resetOrdering = React.useCallback(() => {
		setDrawerSetting('userDrawerOrdering', {});
	}, [setDrawerSetting]);

	const toggleGroupCollapsed = React.useCallback(
		(groupKey: string) => {
			setDrawerSetting('collapsedGroups', {
				...collapsedGroups,
				[groupKey]: !collapsedGroups?.[groupKey]
			});
		},
		[collapsedGroups, setDrawerSetting]
	);

	const setAccountModalOpen = accountModal.setOpen;
	const accountModalOpen = accountModal.open;

	// Opens the global Commander (search); optionally closes the drawer based
	// on thingtime.settings.drawer.searchClosesDrawer.
	const openSearch = React.useCallback(() => {
		setThingtime?.('settings.commander.nav.commanderActive', true, {
			ignoreUndoRedo: true,
			namespace: 'drawer'
		});

		if (searchClosesDrawer && open) {
			setOpen(false);
		}
	}, [setThingtime, searchClosesDrawer, open, setOpen]);

	return {
		loading,
		open,
		setOpen,
		toggleOpen,
		direction,
		setDirection,
		width,
		setWidth,
		topLevelLimit,
		topLevelLimitIsUnlimited,
		setTopLevelLimit,
		setTopLevelLimitUnlimited,
		searchClosesDrawer,
		setSearchClosesDrawer,
		ordering,
		setOrderingFor,
		resetOrdering,
		selectedItem,
		setSelectedItem,
		collapsedGroups,
		toggleGroupCollapsed,
		accountModalOpen,
		setAccountModalOpen,
		openSearch
	};
};
