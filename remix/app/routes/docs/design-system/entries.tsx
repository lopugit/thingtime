import type { DesignSystemStory } from './ThingContextMenuStories';
import { thingContextMenuStories } from './ThingContextMenuStories';

// Registry for the design-system tab of the docs UI — storybook-style entries
// for Thingtime components. Each entry carries its stories plus the reference
// documentation tabs (API, guidelines, accessibility, tokens).

export type DesignSystemStatus = 'Proposed' | 'Reference' | 'Adopted';

export type PropRow = {
	name: string;
	type: string;
	defaultValue?: string;
	description: string;
};

export type PropTable = {
	title: string;
	source: string;
	rows: PropRow[];
};

export type KeyboardRow = {
	keys: string;
	action: string;
};

export type TokenRow = {
	token: string;
	usedFor: string;
	// swatch preview kind
	preview?: 'color' | 'shadow' | 'radius' | 'font';
};

export type DesignSystemEntry = {
	slug: string;
	title: string;
	status: DesignSystemStatus;
	summary: string;
	notes: string;
	anatomy: string[];
	stories: DesignSystemStory[];
	propTables: PropTable[];
	guidelines: {
		intro: string;
		dos: string[];
		donts: string[];
	};
	accessibility: string[];
	keyboard: KeyboardRow[];
	tokens: TokenRow[];
	adoption: string[];
};

export const designSystemStatusColors: Record<DesignSystemStatus, { bg: string; color: string }> = {
	Proposed: { bg: '#eef2f7', color: '#374151' },
	Reference: { bg: '#e8e9ff', color: '#2f356b' },
	Adopted: { bg: 'var(--tt-docs-accent-soft, #d7f5df)', color: 'var(--tt-docs-accent-ink, #0f5132)' }
};

export const designSystemEntries: DesignSystemEntry[] = [
	{
		slug: 'thing-context-menu',
		title: 'Thing Context Menu',
		status: 'Adopted',
		summary:
			'The generalised options menu for any thing: change its type, share it, apply default/template values, duplicate, copy, cut, paste, modify, change permissions, or recycle it — reachable by hover, right-click, or programmatically as a modal, with infinite drill-down submenus in one fixed window.',
		notes:
			'Live in the Thingtime UI: every thing header renders ThingContextMenuTrigger (hover/tap the wizard icon or right-click the thing row), and the new-child seedling row uses the same surface to pick a type. It replaced the old SettingsMenu.',
		anatomy: [
			'Header — mono thing path, its type, and pin (popover/context) or close (modal). The header is also the drag handle: grab it to move the window (made for pinned mode).',
			'Back row — appears when drilled below the root level; shows the level title and pops one level on click, ← or Esc.',
			'Sections — Mode, then Type, Value, Clipboard, Sharing, and Danger last. Section order is fixed by the model so muscle memory transfers between presentations.',
			'Action rows — emoji icon, label, optional hint line, optional shortcut label, a ✓ on the selected radio option, and a ▸ when the action drills into a submenu.',
			'Drill levels — submenus never fly out or indent: the whole surface navigates down a level, infinitely deep, inside one window. The size locks on the first drill; levels scroll inside the frame.',
			'Zones — every atomic thing has virtual bounding boxes (thingZones): key, value, and the whole thing. Right-click resolves the zone it hit (badged in the header; key-zone clicks lead with key verbs) and the same boxes are the geometry layer for drag/drop.',
			'Resize grip — bottom-right corner resizes the window; content scrolls inside whatever size it gets.',
			'Danger zone — destructive actions render in --tt-danger, always in the last section, separated by a divider.'
		],
		stories: thingContextMenuStories,
		propTables: [
			{
				title: '<ThingContextMenu/>',
				source: 'remix/app/components/Thingtime/ContextMenu/ThingContextMenu.tsx',
				rows: [
					{ name: 'model', type: 'ThingContextMenuModel', description: 'The sections + actions to render. Submenus recurse infinitely; build with buildThingContextMenuModel() or hand-craft.' },
					{ name: 'open', type: 'boolean', description: 'Whether the menu is visible. The component renders nothing when closed; reopening resets drill, drag, and size.' },
					{ name: 'presentation', type: "'popover' | 'context' | 'modal'", defaultValue: "'popover'", description: 'How the surface is placed: anchored under a trigger, fixed at a pointer position, or centred over a scrim.' },
					{ name: 'meta', type: '{ path?, type? }', description: 'Thing identity for the header.' },
					{ name: 'position', type: '{ x, y }', description: 'Pointer coordinates for the context presentation; clamped to the viewport automatically.' },
					{ name: 'pinned / onPinnedChange', type: 'boolean / (next) => void', description: 'Pin state keeps the menu open across actions and hover-out; hidden in the modal presentation.' },
					{ name: 'onAction', type: '({ action, section, path }) => void', description: 'Fired for every leaf activation. path is the drill trail (action ids); switch on action.command and read action.payload.' },
					{ name: 'onClose', type: '() => void', description: 'Requested by Escape at the root level, the close button, scrim clicks, and post-action auto-close.' },
					{ name: 'closeOnAction', type: 'boolean', defaultValue: 'true', description: 'Auto-close after a leaf action fires (unless pinned).' },
					{ name: 'defaultDrillPath', type: 'string[]', description: 'Open already drilled to this path of action ids (docs/tests).' },
					{ name: 'onSurfaceMouseEnter / Leave', type: '() => void', description: 'Hover-linger wiring; supplied by useThingContextMenu for popovers.' },
					{ name: 'width / zIndex', type: 'number / number', defaultValue: '264 / 1400', description: 'Initial surface width and stacking context; the resize grip takes over from there.' }
				]
			},
			{
				title: '<ThingContextMenuTrigger/> (live integration)',
				source: 'remix/app/components/Thingtime/ContextMenu/ThingContextMenuTrigger.tsx',
				rows: [
					{ name: 'variant', type: "'thing' | 'new-child'", defaultValue: "'thing'", description: 'Full options menu on thing headers, or the type picker on the new-child seedling row.' },
					{ name: 'editMode / setEditMode / readonly', type: 'boolean / updater / boolean', description: 'Mode state drives the model (read-only menus drop mutating sections).' },
					{ name: 'fullPath / path / parent / parentPath / thing / thingType', type: 'thing context', description: 'Everything the live commands need: duplicate, paste, share, and the header meta.' },
					{ name: 'onType / onAddChild / onDelete', type: 'handlers', description: 'Thingtime.tsx handlers: change-type → onChangeType, add-child → addNewChild, recycle/cut → deleteValue.' },
					{ name: 'contextTargetRef', type: 'RefObject<HTMLElement>', description: 'Element that opens this menu on right-click (the whole thing row); the deepest thing under the pointer wins.' },
					{ name: 'opacity / transition / iconSize', type: 'trigger styling', description: 'Wizard-icon reveal styling, matching the old SettingsMenu behaviour.' }
				]
			},
			{
				title: 'useThingContextMenu()',
				source: 'remix/app/components/Thingtime/ContextMenu/useThingContextMenu.tsx',
				rows: [
					{ name: 'hoverTriggerProps', type: 'spread props', description: 'onMouseEnter/onMouseLeave for the hover trigger (opens the popover, schedules close with a linger).' },
					{ name: 'contextTriggerProps', type: 'spread props', description: 'onContextMenu for right-click / long-press targets (opens at the pointer).' },
					{ name: 'openModal / openPopover / openAtPointer', type: '() => void / (e) => void', description: 'Programmatic openers for each presentation.' },
					{ name: 'closeMenu', type: '() => void', description: 'Closes and unpins.' },
					{ name: 'menuProps', type: 'spread props', description: 'Everything <ThingContextMenu/> needs: open, presentation, position, pin state, close + hover-linger handlers.' },
					{ name: 'options.hoverCloseDelay', type: 'number', defaultValue: '555', description: 'Grace period (ms) before a hover-opened menu hides.' }
				]
			},
			{
				title: 'thingZones (virtual bounding boxes)',
				source: 'remix/app/components/Thingtime/thingZones.ts',
				rows: [
					{ name: 'data-tt-zone', type: "'key' | 'value'", description: 'DOM markers Thingtime stamps on the property-name row and the atomic value box; everything else in a thing is the thing zone.' },
					{ name: 'resolveThingZone(target, thing)', type: '(Element, Element) => ThingZone', description: 'Hit-test an event target against one thing’s zones (nested things own their zones — the deepest handler wins first).' },
					{ name: 'getThingZoneBoxes(thing)', type: '(HTMLElement) => { key?, value?, thing }', description: 'Measure the zone boxes in viewport coordinates; the thing box is the key + value union — the atomic thing’s virtual bounding box, ready for drag/drop.' }
				]
			},
			{
				title: 'buildThingContextMenuModel()',
				source: 'remix/app/components/Thingtime/ContextMenu/contextMenuModel.ts',
				rows: [
					{ name: 'editMode', type: 'boolean', defaultValue: 'false', description: 'Reflects the current mode in the toggle item (label + icon).' },
					{ name: 'readonly', type: 'boolean', defaultValue: 'false', description: 'Drops every mutating section: type, value, cut/paste, danger.' },
					{ name: 'canDelete', type: 'boolean', defaultValue: 'true', description: 'Hides Recycle when there is no parent to remove the thing from.' },
					{ name: 'types / templates / permissions', type: 'option lists', defaultValue: 'DEFAULT_*', description: 'Override the drill-level contents; the live menu feeds types from thingtime.settings.types. Templates carry real starter values; nested children make deeper levels.' },
					{ name: 'selectedPermissionKey', type: 'string', defaultValue: "'private'", description: 'Which permission renders checked.' },
					{ name: 'buildTypesSubmenu(types, opts)', type: 'helper', description: "Types drill level; opts.command ('change-type' | 'add-child') and opts.wrapLevels control the leaves. Wrappable types drill to Replace/Wrap." },
					{ name: 'resolveDrillPath(model, path)', type: 'helper', description: 'Turns an array of action ids into the drill stack (used by defaultDrillPath).' }
				]
			}
		],
		guidelines: {
			intro:
				'One action model, three presentations, one window. The menu is data first: buildThingContextMenuModel() decides what a thing can do, and hover/right-click/modal only decide where that model appears. Submenus are drill-down levels — the surface navigates, it never grows, indents, or spawns secondary surfaces — so the same tree works at any depth, in any presentation, on any input.',
			dos: [
				'Anchor hover popovers to the thing header (path row); wire right-click on the whole thing row and let the deepest thing win.',
				'Use the modal presentation for deliberate, button-triggered flows (e.g. a Share button, mobile toolbars).',
				'Keep Danger actions last, red, and separated — never adjacent to Duplicate/Copy.',
				'Reflect state in the model: edit-mode toggles relabel, the active permission is checked, disabled actions stay visible but inert.',
				'Give every leaf a command + payload and switch on command in one dispatcher (see ThingContextMenuTrigger) — presentations stay dumb.',
				'Route the resulting mutations through the Thingtime data layer (setThingtime / API endpoints) — the menu itself never touches data.'
			],
			donts: [
				'Don’t add flyout submenus or indentation — drill-down navigation is the pattern; it survives modals, touch, small viewports, and infinite depth.',
				'Don’t let drilling change the window size — the frame locks on the first drill and levels scroll inside it.',
				'Don’t auto-close a pinned menu after an action; pinning means “I’m doing several of these” — that’s what drag exists for.',
				'Don’t reproduce browser-native clipboard semantics loosely — Copy/Cut/Paste operate on things (structured values), and say so in hints when ambiguous.'
			]
		},
		accessibility: [
			'The surface is role="menu"; actions are role="menuitem"; radio-style options are role="menuitemradio" with aria-checked.',
			'Drill parents expose aria-haspopup="menu"; the back row is a focusable menuitem labelled Back.',
			'Focus is roving: arrow keys move between every row of the current level including the back row; drilling lands focus on the first action (not the back row).',
			'Hover/right-click menus never steal focus on open — a window-level fallback still honours Escape (back/close) and pulls focus in on ArrowDown/ArrowUp; the modal focuses the first item and traps Tab.',
			'Right-click opens the thing menu everywhere — including property names and values — except on selected text or an editor the user was already focused in, where the native menu (copy, caret paste, spellcheck) passes through.',
			'Hover popovers stay open while the pointer is over the surface and linger ~555ms after leaving, so travel gaps don’t dismiss them.',
			'Right-click maps to long-press on touch via the native contextmenu event; the trigger icon also opens on tap.',
			'Drag and resize use pointer events with generous handles (whole header / 15px grip) and never trap keyboard users — every capability they gate is also reachable without them.',
			'Danger styling pairs colour with position (always last section) so colour is never the only signal.'
		],
		keyboard: [
			{ keys: '↓ / ↑', action: 'Move focus to the next / previous row (wraps)' },
			{ keys: 'Home / End', action: 'First / last row' },
			{ keys: 'Enter / Space', action: 'Activate the focused row (leaf fires, parent drills in)' },
			{ keys: '→', action: 'Drill into the focused parent' },
			{ keys: '← ', action: 'Back one level' },
			{ keys: 'Esc', action: 'Back one level, then close at the root (works before focus enters the menu too)' },
			{ keys: 'Tab', action: 'Trapped inside the modal presentation; cycles rows' }
		],
		tokens: [
			{ token: '--tt-card', usedFor: 'Menu surface background', preview: 'color' },
			{ token: '--tt-border', usedFor: 'Surface border', preview: 'color' },
			{ token: '--tt-border-light', usedFor: 'Section dividers + header rule', preview: 'color' },
			{ token: '--tt-surface', usedFor: 'Inline submenu background', preview: 'color' },
			{ token: '--tt-surface-alt', usedFor: 'Hover / focused row background', preview: 'color' },
			{ token: '--tt-ink', usedFor: 'Action labels', preview: 'color' },
			{ token: '--tt-muted', usedFor: 'Path, hints, section headers', preview: 'color' },
			{ token: '--tt-faint', usedFor: 'Shortcut labels, disclosure carets', preview: 'color' },
			{ token: '--tt-danger', usedFor: 'Danger actions (Recycle)', preview: 'color' },
			{ token: '--tt-radius-md', usedFor: 'Surface corner radius', preview: 'radius' },
			{ token: '--tt-radius-sm', usedFor: 'Row + submenu radius', preview: 'radius' },
			{ token: '--tt-shadow-popover', usedFor: 'Surface elevation (hard-offset in Fable theme)', preview: 'shadow' },
			{ token: '--tt-font-mono', usedFor: 'Path, type, section headers, shortcuts', preview: 'font' }
		],
		adoption: [
			'Done — ThingContextMenuTrigger replaced SettingsMenu on every thing header (hover/tap + right-click on the row) and on the new-child seedling row, keeping the settings-menu-hide single-open protocol.',
			'Done — live commands: change-type/wrap → onChangeType, add-child → addNewChild, toggle-edit-mode → setEditMode, recycle → deleteValue, plus real duplicate, copy, cut, paste, apply-template, modify (focus the editor), and share (copies the /things link).',
			'Next — permissions: set-permission / invite-person currently toast “coming soon”; they wire up when the things permissions API lands.',
			'Next — keyboard shortcuts shown in the menu (⌘C/⌘X/⌘V/⌘D/⌘E) are display-only; bind them on focused things once a focus model exists.'
		]
	}
];

export const getDesignSystemEntryBySlug = (slug?: string | null) =>
	designSystemEntries.find((entry) => entry.slug === slug);
