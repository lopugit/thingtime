import type { DesignSystemEntry } from '../entries';
import { commanderStories, drawerStories, segmentedTabsStories, topNavStories } from './NavigationStories';

// Navigation group: the fixed glass top nav, the drawer system, the global
// Commander search pill, and the admin segmented-control idiom. Every entry is
// grounded in the live sources under remix/app/components/Nav, Commander, and
// Admin — line references point at the current files.

export const navigationEntries: DesignSystemEntry[] = [
	{
		slug: 'top-nav',
		title: 'Top nav',
		status: 'Adopted',
		summary:
			'The fixed glass bar over every page: a translucent card wash (color-mix 78% --tt-card over transparent) blurred 14px with a --tt-border hairline underneath, safe-area aware, and drawer-aware — the pinned drawer offsets it on desktop and translates it on mobile. Three zones: home unicorn (left), the centred Commander pill, and the account cluster (right).',
		notes:
			'Mounted exactly once, in root.tsx (skipped only for the OAuth authorize popup). Pages never touch it — they clear it with PAGE_TOP_CLEARANCE / var(--tt-nav-clearance, 54px) from the page scaffold. The native iOS webview override swaps the glass for solid --tt-card (blur is too costly in WKWebView), and Electron reveals an extra search button plus titlebar insets. Hidden bonus: seven rapid clicks on the unicorn make it gallop (motion switch permitting).',
		anatomy: [
			'Chassis — position fixed, zIndex 9999, top = var(--thingtime-safe-area-top, 0px); background color-mix(in srgb, var(--tt-card) 78%, transparent) + backdrop-filter blur(14px); 1px --tt-border bottom hairline. Inner row is a real <nav> with 18px side padding.',
			'Left section — desktop only (display ["none","flex"]): the mirrored 🦄 home link, plus the Electron-only search button. paddingLeft reserves 34px for the fixed drawer trigger unless the drawer is pinned left (then the nav already starts right of it).',
			'Centre — <CommanderV2 global id="nav" rainbow={false}/>: the search pill absolutely centred over the bar (its own entry covers it).',
			'Right cluster — position relative + zIndex 10000, ABOVE the commander host, because long usernames (and the bell) can extend under the centred pill and must stay tappable: 👀 editor toggle (only in /edit), 🎨 edit toggle (on editor-toggleable routes), NotificationsBell (claimed users), account link (display name + 🌈, or “Login”), and the mobile-only 🦄.',
			'Drawer-aware geometry — desktop split view: the left/right edge offsets by the live drawer width; mobile: the whole bar translates by it. Both ride drawerWidthCss() and transition 0.28s ease-out, suppressed while settings load or the drawer is resizing.',
			'Platform overrides — html.thingtime-native-webview forces solid --tt-card + isolation; html.thingtime-electron-desktop shows the left search button and repositions the commander under the titlebar.'
		],
		stories: topNavStories,
		propTables: [
			{
				title: '<Nav/> (context-driven — no props)',
				source: 'remix/app/components/Nav/Nav.tsx',
				rows: [
					{
						name: 'useDrawer()',
						type: 'open · direction · loading · openSearch',
						description: 'Drawer state drives the shift: which edge offsets (direction), whether to offset at all (open), and transition suppression while settings load. openSearch backs the Electron search button.'
					},
					{
						name: 'useDrawerLiveWidth()',
						type: '{ width, resizing }',
						description: 'The live width during a resize drag (broadcast via the thingtime:drawer-resize window event) — the nav follows every pixel with transitions off, then settles on the persisted width.'
					},
					{
						name: 'useIsMobileViewport()',
						type: 'boolean',
						description: 'Chakra md breakpoint (48em). Below it the bar translates with the page instead of resizing against the drawer.'
					},
					{
						name: 'useCurrentUser()',
						type: 'user | null',
						description: 'Temporary (unclaimed) users render as logged out here: the bell hides and the account link shows “Login”.'
					},
					{
						name: 'pathname toggles',
						type: 'inEditMode / inEditorMode / editorToggleable',
						description: 'Route-derived: 🎨 swaps /things ↔ /edit (or enters edit from a thing URL page), 👀 swaps /edit ↔ /editor. Inactive toggles sit at 0.3 opacity.'
					},
					{
						name: 'useUnicornGallop()',
						type: '{ onLogoClick, galloping }',
						description: 'The 🥚: a 7-click streak inside 1.5s triggers the tt-gallop animation + confetti — animation only when motionOK() (the --tt-motion flag) allows.'
					}
				]
			},
			{
				title: 'Layout contract',
				source: 'remix/app/components/Nav/Nav.tsx · remix/app/components/Layout/PageShell.tsx',
				rows: [
					{
						name: '--tt-nav-clearance',
						type: 'CSS var',
						defaultValue: '54px',
						description: 'The height pages must clear. Consumed by PAGE_TOP_CLEARANCE (safe-area + clearance) — the one blessed way to not slide under the bar.'
					},
					{
						name: 'zIndex 9999 / 10000',
						type: 'stacking',
						description: 'Bar at 9999 (below the drawer ladder, which starts at 10000); the right cluster at 10000 relative so it beats the absolutely-centred commander host.'
					},
					{
						name: 'drawerWidthCss(width)',
						type: '(number) => string',
						description: 'min(width, 100vw − 56px) — the shared viewport-clamped width expression; the nav must use the same one as the drawer or the seam drifts.'
					},
					{
						name: '--thingtime-safe-area-top',
						type: 'CSS var',
						description: 'iOS notch inset: the bar pins below it, and the same var feeds PAGE_TOP_CLEARANCE so content and chrome agree.'
					}
				]
			}
		],
		guidelines: {
			intro:
				'The nav is a singleton and a landmark: one glass bar, one home link, one search pill, one account cluster. It owns no page content and no page owns it — pages interact with it only through the clearance contract and the drawer settings. Anything that wants to live “in the nav” must earn a place in one of the three zones rather than floating its own fixed chrome at the top of the screen.',
			dos: [
				'Clear it with PAGE_TOP_CLEARANCE (or var(--tt-nav-clearance) for bespoke surfaces) — never a hand-tuned padding.',
				'Keep right-cluster additions tiny and icon-first (the bell is the model), and remember they render above the commander pill on purpose.',
				'Route new “open search from X” affordances through useDrawer().openSearch() so the searchClosesDrawer setting keeps working.',
				'Respect the platform overrides: solid background in the native webview, titlebar insets in Electron — test both when touching the chassis.',
				'Keep the glass recipe exact — 78% color-mix + blur(14px) + 1px --tt-border; it is tuned so text behind stays readable through it.'
			],
			donts: [
				'Don’t render a second fixed bar or portal content into the nav from pages — the nav is mounted once in root.tsx and owns the top edge.',
				'Don’t read the drawer width from settings directly for layout — use useDrawerLiveWidth(), or mid-drag your surface will judder against the nav.',
				'Don’t raise page content above zIndex 9999 — the ladder above it (10000+) belongs to the drawer system, popups, and modals.',
				'Don’t add nav items that only apply to one page; route-scoped controls (like the 🎨/👀 toggles) must derive from pathname, not page-side state.'
			]
		},
		accessibility: [
			'The inner row is a real <nav> element — one landmark, first in the DOM, so “skip to navigation” and rotor users get it for free.',
			'Home and account are real <Link>s (middle-click, copy link work); the Electron search control is a real <button> with aria-label="Search".',
			'The 🎨/👀 edit toggles are currently pointer-only Centers with onClick — a known gap; new controls in the bar must be real buttons with labels.',
			'The 78% card glass plus blur keeps --tt-ink text above contrast on the scrolled-under content; the native webview goes fully opaque rather than risk low-contrast composites.',
			'The gallop easter egg checks motionOK() before animating, honouring the theme motion switch and reduced-motion themes.',
			'Drawer shift transitions are transform/edge-offset only — no layout thrash, and they disable entirely during settings load so restore never animates.'
		],
		keyboard: [
			{ keys: 'Tab', action: 'Native order through the bar: home link, commander input, right-cluster links/buttons' },
			{ keys: 'Enter', action: 'Activate the focused link/button' },
			{ keys: '⌘P / Esc / ↑↓', action: 'Belong to the Commander once its input has focus — see the Commander entry' }
		],
		tokens: [
			{ token: '--tt-card', usedFor: 'Glass base (78% color-mix) and the solid native-webview chassis', preview: 'color' },
			{ token: '--tt-border', usedFor: 'The bottom hairline', preview: 'color' },
			{ token: '--tt-surface-hover', usedFor: 'Icon-button hover wash (Electron search)', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'The commander pill it hosts', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Username and active toggles', preview: 'color' },
			{ token: '--tt-nav-clearance', usedFor: 'The 54px clearance contract pages consume' },
			{ token: '--thingtime-safe-area-top', usedFor: 'iOS notch inset above the bar' },
			{ token: '--thingtime-electron-titlebar-nav-start', usedFor: 'Left padding reserving the drawer-trigger / titlebar space (34px default)' }
		],
		adoption: [
			'Done — root.tsx renders <Nav/> app-wide (skipped only for the OAuth authorize popup); every conforming page clears it via the page scaffold.',
			'Done — drawer-aware geometry: desktop edge offset + mobile translate, following live resize via the thingtime:drawer-resize broadcast.',
			'Done — platform variants: native-webview solid chassis, Electron titlebar insets + left search button.',
			'Ongoing — the right cluster accrues carefully (the bell pushed the mobile commander allowance to 200px); converting the pointer-only edit toggles to real buttons is an open follow-up.'
		]
	},
	{
		slug: 'drawer',
		title: 'Nav drawer',
		status: 'Adopted',
		summary:
			'The app’s navigation drawer: one fixed trigger button, a panel flush with the top/bottom/opening edge (left or right per user setting), resizable 220–520px with the width persisted, a desktop hover preview popup, and a mobile mode with scrim + scroll lock + Escape. One DrawerContent renders both the pinned panel and the popup; the menu is data (drawerMenuItems) that users reorder by click-and-hold drag.',
		notes:
			'Mounted once in root.tsx as <DrawerSystem/>. Everything the user changes — open state, direction, width, per-list ordering, top-level limit, collapsed groups, per-item close-on-click — persists under thingtime.settings.drawer.* (undo/redo-exempt via ignoreUndoRedo). The z ladder is documented at the top of useDrawer.tsx: panel 10000, hovered panel 10120 (outranking floating editor windows), popups 10220, trigger 10230, modal 10240/10250 — the fixed nav (9999) sits below all of it.',
		anatomy: [
			'Trigger — the single fixed 36px button top-left (PanelLeft icon, radius 8px, --tt-surface-hover on hover, z 10230). Desktop hover previews after 160ms; click pins; the popup closes 260ms after the pointer leaves.',
			'Panel — position fixed, flush top 0 / bottom 0 / left-or-right 0, width drawerWidthCss(persisted); --tt-card surface, 1px --tt-border on the inner edge, --tt-shadow-panel while open; slides via translateX(±102%) at 0.28s ease-out with visibility deferred until the slide-out ends.',
			'Resize handle — an invisible 8px strip on the inner edge (cursor col-resize); a 2px bar fades in on hover. Drags clamp 220–520 AND to the viewport minus a 56px gutter; live widths broadcast on a window event, the final width persists on release.',
			'Header — brand row (🦄 + “Thingtime”, navigates home) and a search button that opens Commander; when the drawer opens left, the header pads 52px so the fixed trigger doesn’t cover the brand.',
			'Menus — top-level rows (icon + label, radius-sm slab selection), limited to 5 by default with a faint “More (n)” expander; the selected item’s children render below a mono uppercase section label, with named groups collapsible and everything reorderable by click-and-hold (280ms).',
			'Account footer — sticky: avatar (uploaded image, or a rainbow-gradient initial), display name, and a gear that opens the settings modal (ephemeral React state — deliberately never persisted).',
			'Mobile mode — the page shifts rather than resizes, a transparent tap-away scrim covers it, body scroll locks, and Escape closes (suspended while the settings modal is up so surfaces peel one at a time).'
		],
		stories: drawerStories,
		propTables: [
			{
				title: 'The surfaces',
				source: 'remix/app/components/Nav/Drawer/DrawerSystem.tsx · NavDrawer.tsx · DrawerTrigger.tsx · DrawerContent.tsx',
				rows: [
					{
						name: '<DrawerSystem/>',
						type: 'no props',
						description: 'The root host (mounted in root.tsx): renders NavDrawer + DrawerTrigger + UserSettingsModal inside AccountModalProvider, and owns mobile scrim, body scroll lock, and Escape-to-close.'
					},
					{
						name: '<NavDrawer onNavigate?/>',
						type: '() => void',
						description: 'The pinned panel. onNavigate fires after navigating menu actions — DrawerSystem passes a close-on-mobile handler. Also owns the resize handle and the hover z-boost (10120) that lets the drawer outrank floating editor windows under the pointer.'
					},
					{
						name: '<DrawerTrigger/>',
						type: 'no props',
						description: 'The fixed button + desktop hover popup (open 160ms / close 260ms timers). The popup is a closed-drawer preview: it dismisses itself the moment the drawer pins open.'
					},
					{
						name: '<DrawerContent variant/>',
						type: "'panel' | 'popup'",
						description: 'The shared inner content — ONE component for both surfaces. variant only changes chrome details (header trigger-clearance padding, selection-sync persistence guard).'
					},
					{
						name: 'DrawerContent onNavigate?',
						type: '() => void',
						description: '“Dismiss the containing surface” — the parent decides what closing means: the popup hides itself, the mobile panel closes, the desktop panel stays per setting.'
					}
				]
			},
			{
				title: 'useDrawer()',
				source: 'remix/app/components/Nav/Drawer/useDrawer.tsx',
				rows: [
					{ name: 'open / setOpen / toggleOpen', type: 'boolean / setters', description: 'Pinned state, persisted at settings.drawer.open. All drawer writes go through setDrawerSetting → ignoreUndoRedo, namespace "drawer".' },
					{ name: 'direction / setDirection', type: "'left' | 'right'", defaultValue: "'left'", description: 'Which viewport edge the drawer (and the nav offset) uses — settings.drawer.opens.direction.' },
					{ name: 'width / setWidth', type: 'number', defaultValue: '300', description: 'Persisted width, clamped 220–520 by clampDrawerWidth(); render through drawerWidthCss() for the viewport gutter.' },
					{ name: 'topLevelLimit / setTopLevelLimit', type: "number | 'unlimited'", defaultValue: '5', description: 'How many top-level rows show before “More”; normalizeDrawerTopLevelLimit treats empty/invalid as unlimited.' },
					{ name: 'ordering / setOrderingFor / resetOrdering', type: 'Record<string, string[]>', description: 'Per-list user ordering (settings.drawer.userDrawerOrdering) keyed "toplevel" or a top-item id; applyDrawerOrdering merges new default items in.' },
					{ name: 'closesOnClick / setCloseOnClickFor', type: '(id) => boolean / setter', description: 'The per-item close-after-click resolver (drawerItemClosesOnClick) — default ON for navigating items, OFF for the keep-open hubs.' },
					{ name: 'selectedItem / setSelectedItem', type: 'string', defaultValue: "'home'", description: 'Which top-level item’s submenu shows; synced to the pathname only while the panel is open (a hidden drawer must not persist on route changes).' },
					{ name: 'collapsedGroups / toggleGroupCollapsed', type: 'Record<string, boolean>', description: 'Collapsed named groups, keyed "<topId>:<group>".' },
					{ name: 'accountModalOpen / setAccountModalOpen', type: 'boolean / setter', description: 'The settings modal — ephemeral React context, deliberately NOT in thingtime (no restore flash, no tree serialise per toggle).' },
					{ name: 'openSearch()', type: '() => void', description: 'Opens the nav Commander (settings.commander.nav.commanderActive) and closes the drawer if searchClosesDrawer (default true).' }
				]
			},
			{
				title: 'Constants + geometry',
				source: 'remix/app/components/Nav/Drawer/useDrawer.tsx',
				rows: [
					{ name: 'DRAWER_MIN/DEFAULT/MAX_WIDTH', type: '220 / 300 / 520', description: 'The resize clamp. Out-of-range or unparseable stored widths resolve to the default.' },
					{ name: 'DRAWER_VIEWPORT_GUTTER', type: '56', description: 'drawerWidthCss(w) = min(w, 100vw − 56px): the trigger and a scrim strip stay reachable when a desktop-wide width reopens on a phone — without touching the persisted value.' },
					{ name: 'DRAWER_Z ladder', type: '10000 → 10250', description: 'panel 10000 · hovered panel 10120 · dropdowns/popups 10220 · trigger 10230 · modal overlay/modal 10240/10250. Editor windows band around the panel (9900+/10040+); everything transient sits above them.' },
					{ name: 'dispatchDrawerLiveWidth / useDrawerLiveWidth', type: 'event + hook', description: 'The thingtime:drawer-resize broadcast: followers (Nav, Main) track mid-drag widths without flushing thingtime; resizing stays true until the queued persisted write lands, keeping transitions off through the release frame.' },
					{ name: 'useIsMobileViewport()', type: '() => boolean', description: 'matchMedia (max-width: 47.99em) — the one mobile branch every drawer surface shares.' }
				]
			},
			{
				title: 'Menu model',
				source: 'remix/app/components/Nav/Drawer/drawerMenu.tsx',
				rows: [
					{ name: 'DrawerTopItem', type: '{ id, label, icon, to?, children }', description: 'A hub: navigates via to (optional — without it a click only selects) and owns a submenu.' },
					{ name: 'DrawerSubItem', type: '{ id, label, icon?, to?, mode?, group?, auth flags }', description: 'mode items switch the thing mode (view/edit/editor) for the thing path currently on screen instead of navigating; group nests them under a collapsible header; authOnly/guestOnly/adminOnly filter per user.' },
					{ name: 'drawerMenuItems', type: 'DrawerTopItem[]', description: 'The default model: Home, Feed, Messages, Search, Schemas, Components, Actions, Builder, Things, Account, Status, Dev, Branding, Docs.' },
					{ name: 'DRAWER_KEEP_OPEN_DEFAULT_IDS', type: "['dev','status','branding','docs']", description: 'Hubs whose click keeps the drawer open by default so their submenu stays browsable; the per-item setting always wins in either direction.' },
					{ name: 'applyDrawerOrdering / filterDrawerItemsByAuth / buildDrawerSubSections', type: 'pure helpers', description: 'Saved-order merge (new ids append at their default slot), auth filtering, and the flat-list → ungrouped + named-group sectioning — all pure, all reused by the stories on this page.' }
				]
			},
			{
				title: '<ReorderableList/>',
				source: 'remix/app/components/Nav/Drawer/ReorderableList.tsx',
				rows: [
					{ name: 'items', type: '{ id, node }[]', description: 'The rows, pre-rendered; the list only manages order.' },
					{ name: 'onReorder', type: '(ids: string[]) => void', description: 'Fired on release with the new id order; the drawer persists it via setOrderingFor. A pending-order buffer bridges the setThingtime queue so the drop never paints one frame in the old order.' },
					{ name: 'hold-to-drag', type: 'HOLD_MS 280 · MOVE_CANCEL_PX 8', description: 'Pointer-events based (mouse + touch, no deps): hold ~280ms mostly-still to arm; moving >8px first cancels, so taps and scrolls pass through. Non-active rows preview-shift out of the way while dragging.' },
					{ name: 'disabled / handleOnly', type: 'boolean / boolean', description: 'handleOnly restricts drag starts to elements marked data-reorder-handle; drawer lists deliberately keep hold-anywhere.' }
				]
			}
		],
		guidelines: {
			intro:
				'One drawer, one model, three faces. The menu is data (drawerMenuItems) rendered by exactly one component (DrawerContent) into a pinned panel, a hover preview, and a mobile sheet-like mode — so a menu change lands everywhere at once. User agency is the design: direction, width, order, limits, and close-on-click are all persisted preferences, which means code must treat every one of them as unknown at render time.',
			dos: [
				'Add destinations by editing drawerMenuItems — id + label + icon + to (+ auth flags/group) — and let ordering, limiting, filtering, and sectioning happen in the existing helpers.',
				'Fire onNavigate after any action that should dismiss the containing surface, and let the PARENT decide what dismissal means for its variant.',
				'Persist drawer chrome through setDrawerSetting (ignoreUndoRedo) — user preferences must never enter the content undo timeline.',
				'Respect the z ladder in useDrawer.tsx when adding chrome near the drawer: transient UI goes in the 10220+ band, never between panel and windows.',
				'Use closesOnClick(itemId) for any new click path — the checkbox in settings and the actual behaviour must resolve through the one shared function.',
				'Reuse ReorderableList for any new user-orderable list; pass handleOnly when rows have their own click targets.'
			],
			donts: [
				'Don’t mount a second drawer or a parallel side nav — DrawerSystem is a root singleton; new nav sections are menu data, not new chrome.',
				'Don’t write settings.drawer.* directly with setThingtime — the useDrawer setters carry the clamps, normalisers, and undo exemption.',
				'Don’t track live resize by re-reading settings — subscribe via useDrawerLiveWidth() or accept one-frame-behind jank.',
				'Don’t persist ephemeral surface state (like the settings modal) into thingtime — that is exactly what AccountModalProvider exists to avoid.',
				'Don’t give menu rows borders, accent bars, or new selection treatments — selection is the --tt-surface-alt slab, everywhere.'
			]
		},
		accessibility: [
			'The trigger is a real <button> with a state-aware label (“Open menu” / “Close menu”) and title; it is the drawer’s single, always-visible entry point.',
			'The closed panel is aria-hidden with visibility: hidden (delayed until the slide-out finishes), so off-screen rows can never be tabbed into.',
			'Mobile: a tap-away scrim covers the shifted page, body scroll locks while open, and Escape closes — suspended while the settings modal is up so Escape peels one surface at a time.',
			'Brand, search, More/Less, and the footer gear are real buttons; menu rows are currently pointer-only flex rows (onClick, no tabindex) — a known follow-up, called out rather than papered over.',
			'Hold-to-drag never traps input: moving before the 280ms hold cancels into a normal tap/scroll, and reordering is a convenience on top of a usable default order.',
			'Hover preview timing (160ms in / 260ms linger) tolerates pointer travel gaps; the popup never steals focus and dismisses itself once the drawer pins.'
		],
		keyboard: [
			{ keys: 'Tab', action: 'Reach the trigger and, inside the drawer, the real buttons (brand, search, More, gear)' },
			{ keys: 'Enter / Space', action: 'Activate the focused button (trigger toggles the drawer)' },
			{ keys: 'Esc', action: 'Close the mobile drawer (the desktop split view is persistent UI; the settings modal takes Escape while open)' }
		],
		tokens: [
			{ token: '--tt-card', usedFor: 'Panel, popup, and footer surfaces', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Inner-edge border, popup border, footer hairline', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Selected row slab, gear hover', preview: 'color' },
			{ token: '--tt-surface-hover', usedFor: 'Row + button hover wash', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Section labels, group headers', preview: 'color' },
			{ token: '--tt-radius-sm', usedFor: 'Row slabs and header buttons', preview: 'radius' },
			{ token: '--tt-radius-lg', usedFor: 'The hover preview popup', preview: 'radius' },
			{ token: '--tt-shadow-panel', usedFor: 'The open pinned panel', preview: 'shadow' },
			{ token: '--tt-shadow-popover', usedFor: 'The hover preview popup', preview: 'shadow' },
			{ token: '--tt-font-mono', usedFor: 'Section + group labels (10px, 600, 0.08em, uppercase)', preview: 'font' },
			{ token: '--thingtime-safe-area-top', usedFor: 'Panel top padding (with the Electron titlebar height)' },
			{ token: '--thingtime-safe-area-bottom', usedFor: 'Panel bottom padding above the home indicator' }
		],
		adoption: [
			'Done — DrawerSystem mounts once in root.tsx; the drawer is the app’s primary navigation on both viewports, with the nav and Main following its geometry.',
			'Done — full preference surface persisted under settings.drawer.*: open, direction, width, per-list ordering, top-level limit, collapsed groups, per-item close-on-click, searchClosesDrawer.',
			'Done — desktop hover preview, resize with live broadcast, mobile scrim + scroll lock + Escape, hover z-boost over floating editor windows.',
			'Next — keyboard focusability for menu rows (today only the real buttons are tabbable) and a keyboard path for reordering.'
		]
	},
	{
		slug: 'commander',
		title: 'Commander',
		status: 'Adopted',
		summary:
			'The global search pill in the nav — placeholder “Imagine..” — and the closest thing Thingtime has to a command line. One input takes three kinds of utterance: free text (searches the platform), a thing path (navigates to it), and a setter (“path = value” writes it). The dropdown layers a pinned full-search row, live ACL-aware platform results, and local fuzzy path matches, in that fixed order.',
		notes:
			'Mounted by the nav as <CommanderV2 global id="nav" rainbow={false}/>. Its open state is a thingtime setting (settings.commander.<id>.commanderActive), which is exactly why the drawer’s search button and the Electron search button can open it from anywhere via useDrawer().openSearch() — and why searchClosesDrawer can coordinate the two systems. The component itself is deliberately entangled with the live tree (paths for fuzzy search, setThingtime for setters), so this entry documents the pattern; the stories render the pill and the dropdown skins.',
		anatomy: [
			'Pill — a borderless Input on --tt-surface-alt, radius-xs, inside a 1px-padded radius-sm shell; absolutely centred in the nav (400px on desktop, calc(100vw − 200px) on mobile to clear the trigger and the right cluster). Focusing opens Commander; the placeholder is always “Imagine..”.',
			'Rainbow ring — the optional glow variant (rainbow prop): Rainbow components wrap the shell and fade in around the active pill. The nav currently mounts rainbow={false}.',
			'Dropdown — --tt-surface-alt panel, radius-md, --tt-shadow-popover, max 300px scroll. Row 0 is always the pinned “🔍 Search things for …” row; a mono uppercase “Across Thingtime” tier lists platform results (🌀 things, 👤 people) with mono context lines; “Local paths” lists fuzzy matches over the local tree in mono.',
			'Setter grammar — “=”, or the word “is” with spaces, splits input into path + value; parseCommanderLiteral coerces the value (numbers, booleans, JSON) before setThingtime writes it and the context panel shows the result.',
			'Context panel — after a setter runs, a Thingtime view of the written path renders under the pill in the same popover skin.',
			'Selection model — hoveredSuggestion is state, not DOM focus: mouse hover and arrow keys move the same highlight, Enter activates it, and every selection path resets input + closes.',
			'Electron mode — the pill hides until commanderActive (data-commander-active attribute), then floats beneath the titlebar with the popover shadow.'
		],
		stories: commanderStories,
		propTables: [
			{
				title: '<CommanderV2/>',
				source: 'remix/app/components/Commander/CommanderV2.tsx',
				rows: [
					{ name: 'id', type: 'string', defaultValue: "'global'", description: 'The commander instance key: settings live under settings.commander.<id>.*. The nav uses id="nav" — which is why openSearch() writes settings.commander.nav.commanderActive.' },
					{ name: 'global', type: 'boolean', description: 'Marks the app-wide instance hosted by the nav (absolute centring over the bar).' },
					{ name: 'rainbow', type: 'boolean', description: 'Wraps the pill in the animated Rainbow glow while active. Currently false in the nav (the duplicate-markup fallback renders the plain shell).' },
					{ name: 'mode', type: 'string', defaultValue: "'value'", description: 'Reserved command-interpretation mode; the nav uses the default.' }
				]
			},
			{
				title: 'Settings + behaviours',
				source: 'remix/app/components/Commander/CommanderV2.tsx · Nav/Drawer/useDrawer.tsx',
				rows: [
					{ name: 'settings.commander.<id>.commanderActive', type: 'boolean (thingtime)', description: 'THE open/close switch. Focus opens it, Escape/click-away/selection close it, and any surface can toggle it by writing the setting — that is the drawer integration.' },
					{ name: 'settings.drawer.searchClosesDrawer', type: 'boolean', defaultValue: 'true', description: 'When the drawer’s search affordance opens Commander, should the drawer close? Honoured by useDrawer().openSearch(), not by Commander itself — each system owns its own chrome.' },
					{ name: 'clearCommanderOnToggle', type: 'boolean setting', description: 'Optional per-id setting: wipe the input (and hovered row) whenever Commander closes.' },
					{ name: 'remote search', type: 'debounced 250ms', description: 'things.search (limit 8, anon for guests) + profile.search (limit 4) in parallel; a sequence counter discards stale responses; failures degrade to local tiers — typeahead is progressive enhancement.' },
					{ name: 'local paths', type: 'Fuse over useThingtime().paths', description: 'Fuzzy path matching (limit 6) over the local tree — the command tier; selecting one navigates via changePath.' },
					{ name: 'setter grammar', type: "'=' | ' is '", description: 'validSetters split path from value; parseCommanderLiteral coerces; setThingtime(path, value, { namespace: "user" }) writes; the context panel opens on the result.' },
					{ name: 'CommanderClickAwayBoundary', type: 'wrapper', description: 'Closes on outside clicks but skips defaultPrevented events — which is how the drawer’s search button can open Commander without the same click instantly closing it.' }
				]
			}
		],
		guidelines: {
			intro:
				'Commander is one input with tiers, not a menu of features. Row order is a contract — pinned search, then platform, then local paths — so muscle memory (“Enter = search”, “arrow down twice = second live result”) holds regardless of what the user typed. Every surface that wants “search from here” opens THIS commander by writing its setting; nothing grows its own search box.',
			dos: [
				'Open Commander by writing settings.commander.nav.commanderActive (via useDrawer().openSearch() where drawer coordination matters) — never by focusing the input imperatively from another component.',
				'Keep the placeholder “Imagine..” — it is the brand voice for “this takes anything”, and tests/users key on it.',
				'Keep the tier order fixed: pinned full-search row first, remote results, then local paths; new result kinds join an existing tier or earn a labelled one below.',
				'Guard async results the way the source does — sequence-count and discard stale responses, and degrade to local tiers on network failure.',
				'preventDefault on any click that opens Commander from chrome the click-away boundary can see, or the opener and closer will fight (the drawer search row is the reference).'
			],
			donts: [
				'Don’t add per-page search inputs to the nav region — pages get in-page search; the nav pill is the one global entry.',
				'Don’t reorder or interleave suggestion tiers by score across sources — tier locality beats global ranking here by design.',
				'Don’t run setter commands through anything but setThingtime with the user namespace — Commander writes are ordinary, undoable tree edits.',
				'Don’t bind new global hotkeys inside Commander’s window listener; it deliberately ignores keys unless its input has focus.'
			]
		},
		accessibility: [
			'The pill is a real text input, so focus, IME composition, paste, and screen-reader text editing all behave natively; focusing it is what opens the surface.',
			'Placeholder contrast rides --tt-muted on --tt-surface-alt; the input never relies on placeholder text alone once the user types.',
			'Row highlight is shared between hover and arrow keys (one hoveredSuggestion state), so pointer and keyboard users see the same selection; arrow keys are inert while the dropdown is hidden, preventing invisible-selection surprises.',
			'Closing Commander only blurs its own input — an outside click that focused another control never has that focus stolen back.',
			'Escape closes from anywhere while the input is focused; selection and execution paths all reset input state so the pill never reopens stale.',
			'The suggestion rows are pointer/arrow-key targets rather than focusable options (no aria-listbox yet) — a known gap worth naming in future work.'
		],
		keyboard: [
			{ keys: '⌘P', action: 'Toggle Commander (while its input has focus)' },
			{ keys: '↓ / ↑', action: 'Move the row highlight (wraps; row 0 is the pinned search row) — only while the dropdown is visible' },
			{ keys: 'Enter', action: 'Activate the highlighted row; with no highlight: run a setter command, else fall through to the pinned search row' },
			{ keys: 'Esc', action: 'Close Commander' }
		],
		tokens: [
			{ token: '--tt-surface-alt', usedFor: 'Pill background and dropdown panel', preview: 'color' },
			{ token: '--tt-surface-hover', usedFor: 'Highlighted suggestion row', preview: 'color' },
			{ token: '--tt-muted', usedFor: '“Imagine..” placeholder, tier labels, context lines', preview: 'color' },
			{ token: '--tt-text', usedFor: 'Suggestion row text', preview: 'color' },
			{ token: '--tt-radius-sm', usedFor: 'The pill shell', preview: 'radius' },
			{ token: '--tt-radius-xs', usedFor: 'The input inside the shell', preview: 'radius' },
			{ token: '--tt-radius-md', usedFor: 'The dropdown panel', preview: 'radius' },
			{ token: '--tt-shadow-popover', usedFor: 'Dropdown + active Electron pill elevation', preview: 'shadow' },
			{ token: '--tt-font-mono', usedFor: 'Pinned row, tier labels, paths, context lines', preview: 'font' }
		],
		adoption: [
			'Done — the nav mounts the global instance (id="nav"); the drawer search button, drawer header search, and the Electron nav search all open it through the one setting.',
			'Done — three-tier suggestions: pinned /search row, debounced ACL-aware platform results (things + people), local fuzzy paths; stale-response guarding and offline degradation.',
			'Done — setter commands (“path = value”, “path is value”) with literal coercion and the post-write context panel; secret-word easter eggs ride the same Enter path.',
			'Next — the rainbow glow variant exists but ships disabled in the nav (duplicate-markup hack noted in source); suggestion rows still need real listbox semantics.'
		]
	},
	{
		slug: 'segmented-tabs',
		title: 'Segmented tabs',
		status: 'Adopted',
		summary:
			'The admin segmented-control idiom: Chakra Tabs with variant="unstyled" for behaviour, skinned as a pill rail — TabList on --tt-surface-alt with 3px padding and radius-pill, each Tab a mono 12px pill that lifts onto --tt-card with --tt-shadow-card when selected. Selection reads as a physical segment raised out of an inset rail, in any theme, with zero custom interaction code.',
		notes:
			'Shipped as ADMIN_TAB_STYLES in AdminDashboard.tsx (lines 182–197), driving the seven admin sections (Users · Apps · Moderation · Tiers · CI Control · External integrations · System) with isLazy + lazyBehavior="keepMounted" so heavy panels mount once and stay mounted. The recipe is deliberately a module-local style object, not a component: adopters copy the two style objects onto stock Chakra parts, so behaviour can never fork from Chakra’s tested Tabs.',
		anatomy: [
			'Rail — TabList: background --tt-surface-alt, radius-pill, padding 3px, gap 2px; width fit-content with maxWidth 100% and flexWrap so a crowded rail wraps to extra rows instead of scrolling.',
			'Segment — Tab: radius-pill, --tt-font-mono 12px weight 600, px 3 / py 1.5, whiteSpace nowrap; --tt-muted at rest.',
			'Hover — text sharpens to --tt-ink; no background change (the rail stays calm until selection).',
			'Selected — _selected lifts the segment: --tt-card fill + --tt-shadow-card + --tt-ink text. The 3px rail padding is what makes the lifted pill read as sitting inside the groove.',
			'Behaviour — stock Chakra Tabs (variant="unstyled" size="sm"): roving focus, arrow keys, tablist/tab/tabpanel roles. The admin instance adds isLazy + lazyBehavior="keepMounted".',
			'Panels — TabPanel px={0}: content aligns with the page column; the rail, not the panel, carries the visual identity.'
		],
		stories: segmentedTabsStories,
		propTables: [
			{
				title: 'ADMIN_TAB_STYLES (per-segment recipe)',
				source: 'remix/app/components/Admin/AdminDashboard.tsx (lines 182–197)',
				rows: [
					{ name: 'borderRadius', type: "'var(--tt-radius-pill, 999px)'", description: 'Full pill per segment (collapses square with the whole scale under Fable’s radiusScale 0).' },
					{ name: 'color / fontFamily / fontSize / fontWeight', type: 'muted · mono · 12px · 600', description: 'The resting label voice — the same mono eyebrow language the rest of the chrome uses for wayfinding.' },
					{ name: 'px / py / whiteSpace', type: '3 · 1.5 · nowrap', description: 'Compact hit area; labels never truncate — the RAIL wraps instead.' },
					{ name: '_hover', type: '{ color: --tt-ink }', description: 'Ink-only hover; deliberately no background so only selection gets the lifted treatment.' },
					{ name: '_selected', type: 'card bg + shadow-card + ink', description: 'The lift: --tt-card fill, --tt-shadow-card elevation, --tt-ink text. Follows the theme dialect automatically (hard offsets in Fable).' }
				]
			},
			{
				title: 'The rail + behaviour props',
				source: 'remix/app/components/Admin/AdminDashboard.tsx (lines 971–988)',
				rows: [
					{ name: '<Tabs variant="unstyled" size="sm">', type: 'Chakra Tabs', description: 'unstyled removes Chakra’s visual variants while keeping ALL behaviour — focus management, keyboard, ARIA wiring.' },
					{ name: 'isLazy + lazyBehavior="keepMounted"', type: 'Chakra props', description: 'Heavy admin panels mount on first visit and stay mounted — switching tabs never refetches or loses scroll/filter state.' },
					{ name: '<TabList bg=…/>', type: 'rail styles', description: 'bg --tt-surface-alt · radius-pill · padding 3px · gap 2px · flexWrap wrap · width fit-content · maxWidth 100%.' },
					{ name: '<Tab {...ADMIN_TAB_STYLES}>', type: 'spread', description: 'Each segment spreads the one recipe object — a style tweak lands on every segment at once.' },
					{ name: '<TabPanel px={0}>', type: 'panel', description: 'Zero horizontal padding so panel content lines up with the PageShell column.' }
				]
			}
		],
		guidelines: {
			intro:
				'Skin, never re-implement. The idiom is two style objects on stock Chakra Tabs: all interaction, focus, and ARIA behaviour stays Chakra’s, and the Thingtime look is pure token CSS. Use it for peer views of one dataset — sections of a dashboard, facets of a manager — where the pill rail says “same place, different lens”. It is a view switcher, not navigation: URLs don’t change when segments do.',
			dos: [
				'Copy the recipe verbatim (segment + rail objects) onto Tabs variant="unstyled" — and keep the 3px rail padding; the inset groove is the identity.',
				'Use short nouns for segments (Users, Apps, Tiers); the 12px mono treats labels as system vocabulary, not sentences.',
				'Add isLazy + lazyBehavior="keepMounted" when panels are expensive — the admin dashboard is the reference.',
				'Let a crowded rail wrap (flexWrap + fit-content + maxWidth 100%) rather than shrinking or scrolling segments.',
				'Keep TabPanel px={0} so panel content aligns with the page column the rail sits in.'
			],
			donts: [
				'Don’t rebuild this with Buttons + state — you would re-implement roving focus, arrow keys, and ARIA that Chakra Tabs already ships.',
				'Don’t use it for page navigation or more than ~7 peer views — that is the drawer’s job (or a select).',
				'Don’t recolour selection with accent — the lift (card + shadow-card) IS the selected state; accent stays reserved for CTAs.',
				'Don’t truncate labels to avoid wrapping; whiteSpace nowrap + rail wrap exists precisely so labels stay whole.',
				'Don’t hardcode greys for the rail — --tt-surface-alt / --tt-card keep the groove-and-lift working in every theme, including Fable’s hard dialect.'
			]
		},
		accessibility: [
			'Full Chakra Tabs semantics survive variant="unstyled": role tablist/tab/tabpanel, aria-selected, and aria-controls all ship for free.',
			'Selection is never colour-alone: the selected segment changes fill, elevation, AND text colour, so it reads in forced-colors and low-vision contexts.',
			'Focus is roving per the tabs pattern — one tab stop for the rail, arrows move within it, Tab leaves to the active panel.',
			'keepMounted panels preserve in-panel state (filters, scroll, form input) across switches — no destroyed context for assistive tech either.',
			'Labels are real text at 12px/600 mono on --tt-muted → --tt-ink; the rest state stays above contrast on the --tt-surface-alt rail in the builtin themes.'
		],
		keyboard: [
			{ keys: 'Tab', action: 'Move focus into the rail (the selected segment), then on to the active panel' },
			{ keys: '← / →', action: 'Move between segments and select them (Chakra automatic activation)' },
			{ keys: 'Home / End', action: 'First / last segment' },
			{ keys: 'Enter / Space', action: 'Select the focused segment (relevant if manual activation is ever enabled)' }
		],
		tokens: [
			{ token: '--tt-surface-alt', usedFor: 'The inset rail', preview: 'color' },
			{ token: '--tt-card', usedFor: 'Selected segment fill', preview: 'color' },
			{ token: '--tt-shadow-card', usedFor: 'Selected segment lift', preview: 'shadow' },
			{ token: '--tt-radius-pill', usedFor: 'Rail and segments', preview: 'radius' },
			{ token: '--tt-muted', usedFor: 'Resting segment labels', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Hover + selected labels', preview: 'color' },
			{ token: '--tt-font-mono', usedFor: 'Segment labels (12px, 600)', preview: 'font' }
		],
		adoption: [
			'Done — the admin dashboard runs its seven sections on this idiom (ADMIN_TAB_STYLES + the pill TabList) with keepMounted lazy panels.',
			'Done — the recipe is intentionally copy-not-import: two style objects over stock Chakra parts, so no behaviour fork exists to maintain.',
			'Next — a second adopter should promote the recipe into a shared module (e.g. ~/theme/segmentedTabs) rather than a third copy; the stories on this page already isolate the two objects.'
		]
	}
];
