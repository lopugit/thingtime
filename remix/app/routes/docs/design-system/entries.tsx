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
		status: 'Reference',
		summary:
			'The generalised options menu for any thing: change its type, share it, apply default/template values, duplicate, copy, cut, modify, change permissions, or recycle it — reachable by hover, right-click, or programmatically as a modal.',
		notes:
			'Reference implementation lives in components/Thingtime/ContextMenu. The live app currently ships the smaller SettingsMenu (toggle edit / types / recycle); this entry is the design it grows into.',
		anatomy: [
			'Header — mono thing path, its type, and pin (popover/context) or close (modal). The header answers “what am I acting on?” before any action is offered.',
			'Sections — Mode, then Type, Value, Clipboard, Sharing, and Danger last. Section order is fixed by the model so muscle memory transfers between presentations.',
			'Action rows — emoji icon, label, optional hint line, optional shortcut label on the right, and a ▸ disclosure when the action opens a submenu.',
			'Inline submenus — types, templates, and permissions expand in place (accordion) instead of flying out; they stay usable in the modal presentation and on touch.',
			'Danger zone — destructive actions render in --tt-danger, always in the last section, separated by a divider.'
		],
		stories: thingContextMenuStories,
		propTables: [
			{
				title: '<ThingContextMenu/>',
				source: 'remix/app/components/Thingtime/ContextMenu/ThingContextMenu.tsx',
				rows: [
					{ name: 'model', type: 'ThingContextMenuModel', description: 'The sections + actions to render. Build with buildThingContextMenuModel() or hand-craft.' },
					{ name: 'open', type: 'boolean', description: 'Whether the menu is visible. The component renders nothing when closed.' },
					{ name: 'presentation', type: "'popover' | 'context' | 'modal'", defaultValue: "'popover'", description: 'How the surface is placed: anchored under a trigger, fixed at a pointer position, or centred over a scrim.' },
					{ name: 'meta', type: '{ path?, type? }', description: 'Thing identity for the header.' },
					{ name: 'position', type: '{ x, y }', description: 'Pointer coordinates for the context presentation; clamped to the viewport automatically.' },
					{ name: 'pinned / onPinnedChange', type: 'boolean / (next) => void', description: 'Pin state keeps hover menus open; hidden in the modal presentation.' },
					{ name: 'onAction', type: '({ action, section, option? }) => void', description: 'Fired for every activation. Submenu picks include the chosen option.' },
					{ name: 'onClose', type: '() => void', description: 'Requested by Escape, the close button, scrim clicks, and post-action auto-close.' },
					{ name: 'closeOnAction', type: 'boolean', defaultValue: 'true', description: 'Auto-close after a non-submenu action fires (unless pinned).' },
					{ name: 'defaultExpandedActionId', type: 'string', description: 'Open with a submenu pre-expanded (docs/tests).' },
					{ name: 'onSurfaceMouseEnter / Leave', type: '() => void', description: 'Hover-linger wiring; supplied by useThingContextMenu for popovers.' },
					{ name: 'width / zIndex', type: 'string / number', defaultValue: "'264px' / 1400", description: 'Surface width and stacking context.' }
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
				title: 'buildThingContextMenuModel()',
				source: 'remix/app/components/Thingtime/ContextMenu/contextMenuModel.ts',
				rows: [
					{ name: 'editMode', type: 'boolean', defaultValue: 'false', description: 'Reflects the current mode in the toggle item (label + icon).' },
					{ name: 'readonly', type: 'boolean', defaultValue: 'false', description: 'Drops every mutating section: type, value, cut/paste, danger.' },
					{ name: 'canDelete', type: 'boolean', defaultValue: 'true', description: 'Hides Recycle when there is no parent to remove the thing from.' },
					{ name: 'types / templates / permissions', type: 'option lists', defaultValue: 'DEFAULT_*', description: 'Override the submenu contents; the live menu feeds types from thingtime.settings.types.' },
					{ name: 'selectedPermissionKey', type: 'string', defaultValue: "'private'", description: 'Which permission renders checked.' }
				]
			}
		],
		guidelines: {
			intro:
				'One action model, three presentations. The menu is data first: buildThingContextMenuModel() decides what a thing can do, and hover/right-click/modal only decide where that model appears. Never fork the action list per presentation — filter the model instead (see the read-only story).',
			dos: [
				'Anchor hover popovers to the thing header (path row) the way SettingsMenu does today.',
				'Use the modal presentation for deliberate, button-triggered flows (e.g. a Share button, mobile toolbars).',
				'Keep Danger actions last, red, and separated — never adjacent to Duplicate/Copy.',
				'Reflect state in the model: edit-mode toggles relabel, the active permission is checked, disabled actions stay visible but inert.',
				'Route the resulting mutations through the Thingtime API layer (setThingtime / API endpoints) — the menu itself never touches data.'
			],
			donts: [
				'Don’t add flyout submenus — inline expansion is the pattern; it survives modals, touch, and small viewports.',
				'Don’t open the hover popover on the value body — values are for reading/editing; the trigger lives in the header.',
				'Don’t auto-close a pinned menu after an action; pinning means “I’m doing several of these”.',
				'Don’t reproduce browser-native clipboard semantics loosely — Copy/Cut/Paste operate on things (structured values), and say so in hints when ambiguous.'
			]
		},
		accessibility: [
			'The surface is role="menu"; actions are role="menuitem"; permission options are role="menuitemradio" with aria-checked.',
			'Submenu parents expose aria-haspopup="menu" and aria-expanded.',
			'Focus is roving: arrow keys move between every visible item including expanded submenu options.',
			'The modal presentation focuses the first item on open; Escape closes (submenu first, then the menu).',
			'Hover popovers stay open while the pointer is over the surface and linger ~555ms after leaving, so travel gaps don’t dismiss them.',
			'Right-click maps to long-press on touch via the native contextmenu event; the modal presentation is the recommended touch fallback for primary flows.',
			'Danger styling pairs colour with position (always last section) so colour is never the only signal.'
		],
		keyboard: [
			{ keys: '↓ / ↑', action: 'Move focus to the next / previous item (wraps)' },
			{ keys: 'Home / End', action: 'First / last item' },
			{ keys: 'Enter / Space', action: 'Activate the focused item (or toggle its submenu)' },
			{ keys: '→ / ←', action: 'Expand / collapse the focused submenu' },
			{ keys: 'Esc', action: 'Close the open submenu, then the menu' }
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
			'Replace SettingsMenu’s inline action list with buildThingContextMenuModel() + <ThingContextMenu/>, keeping its event-bus single-open behaviour.',
			'Wire onAction ids to the existing handlers in Thingtime.tsx: change-type → onChangeType, recycle → deleteValue, toggle-edit-mode → setEditMode.',
			'Share… / Permissions… need the sharing API (things permissions endpoints) before they leave the docs.',
			'Add onContextMenu={contextTriggerProps.onContextMenu} to the thing row so right-click works everywhere the wizard icon does.'
		]
	}
];

export const getDesignSystemEntryBySlug = (slug?: string | null) =>
	designSystemEntries.find((entry) => entry.slug === slug);
