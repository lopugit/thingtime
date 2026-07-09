import React from 'react';
import ClickAwayListener from 'react-click-away-listener';
import { Center, Flex } from '@chakra-ui/react';

import { Icon } from '../../Icon/Icon';
import { useLopu } from '../../Lopu/useLopu';
import { useThingtime } from '../useThingtime';
import { buildThingModeUrl } from '../thingRoute';
import { sanitizeParsedJson } from '../jsonValue';
import { resolveThingZone } from '../thingZones';
import type { ThingZone } from '../thingZones';
import { ThingContextMenu } from './ThingContextMenu';
import type { ThingContextMenuAction } from './ThingContextMenu';
import {
	buildThingContextMenuModel,
	buildTypesSubmenu,
	DEFAULT_THING_TYPES
} from './contextMenuModel';
import type { ThingContextMenuModel, ThingTypeOption } from './contextMenuModel';
import { useThingContextMenu } from './useThingContextMenu';

import { safeJoin } from '~/utils';

// Live Thingtime integration of the Thing Context Menu (the SettingsMenu
// successor). Renders the wizard trigger icon, opens the menu on hover, tap,
// or right-click (via contextTargetRef), and dispatches menu commands to real
// thing mutations through setThingtime + the handlers Thingtime.tsx provides.
//
// Cross-menu coordination reuses the SettingsMenu event protocol: opening one
// menu broadcasts 'settings-menu-hide' so every other unpinned menu closes.

export interface ThingContextMenuTriggerProps {
	// 'thing' = full options menu; 'new-child' = pick a type for a new child
	variant?: 'thing' | 'new-child';
	editMode?: boolean;
	setEditMode?: (updater: (prev: boolean) => boolean) => void;
	uuid?: string;
	fullPath?: unknown;
	path?: string;
	parent?: unknown;
	parentPath?: unknown;
	thing?: unknown;
	thingType?: string;
	readonly?: boolean;
	opacity?: number;
	transition?: string;
	iconSize?: number | string;
	// things with children get View verbs (collapse/expand + all-variants)
	collapsible?: boolean;
	collapsed?: boolean;
	onCollapse?: (command: 'collapse' | 'expand' | 'collapse-all' | 'expand-all') => void;
	onType?: (args: { type: unknown; wrap?: boolean }) => void;
	onAddChild?: (args: { type: unknown }) => void;
	onDelete?: () => void;
	// element that opens this menu on right-click (e.g. the whole thing row)
	contextTargetRef?: React.RefObject<HTMLElement>;
}

// deep-clone helper for duplicate/template values; primitives pass through
const cloneValue = (value: unknown): unknown => {
	if (value === null || typeof value !== 'object') {
		return value;
	}

	try {
		return structuredClone(value);
	} catch {
		return JSON.parse(JSON.stringify(value));
	}
};

const serializeThing = (thing: unknown): string => {
	if (typeof thing === 'string') {
		return thing;
	}

	try {
		return JSON.stringify(thing, null, 2) ?? String(thing);
	} catch {
		return String(thing);
	}
};

export const ThingContextMenuTrigger = (props: ThingContextMenuTriggerProps) => {
	const {
		variant = 'thing',
		editMode = false,
		setEditMode,
		uuid,
		fullPath,
		path,
		parent,
		parentPath,
		thing,
		thingType,
		readonly = false,
		opacity = 1,
		transition,
		iconSize = 7,
		collapsible = false,
		collapsed = false,
		onCollapse,
		onType,
		onAddChild,
		onDelete,
		contextTargetRef
	} = props;

	const { thingtime, setThingtime, events } = useThingtime();
	const lopu = useLopu();
	const menu = useThingContextMenu();

	const menuUuid = React.useId();

	const pinnedRef = React.useRef(menu.pinned);

	React.useEffect(() => {
		pinnedRef.current = menu.pinned;
	}, [menu.pinned]);

	// single-open coordination (same protocol SettingsMenu used)
	React.useEffect(() => {
		if (menu.open && menuUuid) {
			events.next({ type: 'settings-menu-hide', uuid: menuUuid });
		}
	}, [menu.open, menuUuid, events]);

	React.useEffect(() => {
		const subscription = events.subscribe((event: any) => {
			if (event?.type === 'settings-menu-hide' && event?.uuid !== menuUuid) {
				if (!pinnedRef.current || event?.force) {
					menu.closeMenu();
				}
			}
		});

		return () => {
			subscription?.unsubscribe?.();
		};
	}, [events, menuUuid, menu.closeMenu]);

	// which virtual bounding box (thingZones) the last right-click hit
	const [targetZone, setTargetZone] = React.useState<ThingZone>('thing');

	// activeElement as it was before the right-click's pointerdown — browsers
	// focus editors on right-mousedown, so this is the only reliable way to
	// know whether the user was already editing when they right-clicked
	const prePointerFocusRef = React.useRef<Element | null>(null);

	// right-click on the thing row opens the same menu at the pointer; the
	// deepest thing wins via stopPropagation. Zones make the click precise:
	// the key row, the value box, or the whole thing.
	React.useEffect(() => {
		const el = contextTargetRef?.current;

		if (!el || variant !== 'thing') {
			return;
		}

		const onPointerDown = (ev: PointerEvent) => {
			if (ev.button === 2 || ev.pointerType !== 'mouse') {
				prePointerFocusRef.current = document.activeElement;
			}
		};

		const handler = (e: MouseEvent) => {
			// the browser menu survives exactly two cases: selected text
			// (copy) and an editor the user was already focused in before the
			// right-click (caret paste, spellcheck)
			const target = e.target as HTMLElement | null;
			const selection = window.getSelection?.();
			const hasSelection = !!selection && !selection.isCollapsed && selection.toString().length > 0;
			const editable = target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]') as HTMLElement | null;
			const previousFocus = prePointerFocusRef.current;
			const editorWasFocused =
				!!editable && !!previousFocus && (previousFocus === editable || editable.contains(previousFocus));

			if (hasSelection || editorWasFocused) {
				e.stopPropagation();
				return;
			}

			e.preventDefault();
			e.stopPropagation();
			setTargetZone(resolveThingZone(target, el));
			menu.openAtPointer(e);
		};

		el.addEventListener('pointerdown', onPointerDown, true);
		el.addEventListener('contextmenu', handler);

		return () => {
			el.removeEventListener('pointerdown', onPointerDown, true);
			el.removeEventListener('contextmenu', handler);
		};
	}, [contextTargetRef, variant, menu.openAtPointer]);

	const dottedPath = React.useMemo(() => safeJoin(fullPath) || 'thingtime', [safeJoin(fullPath)]);

	// live types from settings (same source SettingsMenu read), mapped onto
	// the model's option shape
	const types = React.useMemo<ThingTypeOption[]>(() => {
		const baseTypes = thingtime?.settings?.types?.javascript || {};
		const customTypes = thingtime?.settings?.types?.custom || {};
		const baseKeys = Object.keys(baseTypes);
		const customKeys = Object.keys(customTypes).filter((key) => !baseKeys.includes(key));

		const mapped = [
			...baseKeys.map((key) => ({ ...baseTypes[key], key, group: 'JavaScript' })),
			...customKeys.map((key) => ({ ...customTypes[key], key, group: 'Custom' }))
		].map((type) => ({
			key: type.key,
			label: type.label || type.key,
			icon: type.icon || type.key,
			wrap: type.wrap,
			value: type.value,
			group: type.group
		}));

		return mapped.length ? mapped : DEFAULT_THING_TYPES;
	}, [thingtime?.settings?.types?.javascript, thingtime?.settings?.types?.custom]);

	const model = React.useMemo<ThingContextMenuModel>(() => {
		if (variant === 'new-child') {
			return {
				sections: [
					{
						id: 'add-child',
						actions: [
							{
								id: 'add-child',
								label: 'Add child of type…',
								icon: '🌱',
								hint: 'Grow a new thing here',
								submenu: buildTypesSubmenu(types, { command: 'add-child', wrapLevels: false, title: 'Add child' })
							}
						]
					}
				]
			};
		}

		const base = buildThingContextMenuModel({
			editMode,
			readonly,
			canDelete: !!onDelete,
			collapsible,
			collapsed,
			types
		});

		// right-clicking the key zone leads with key-specific verbs
		if (targetZone === 'key' && typeof path === 'string' && path) {
			return {
				sections: [
					{
						id: 'key-zone',
						label: 'Key',
						actions: [
							...(!readonly
								? [{ id: 'rename-key', command: 'rename-key', label: 'Rename key…', icon: '✏️', hint: 'Edit the property name' }]
								: []),
							{ id: 'copy-key', command: 'copy-key', label: 'Copy key', icon: '📋', hint: path }
						]
					},
					...base.sections
				]
			};
		}

		return base;
	}, [variant, editMode, readonly, onDelete, collapsible, collapsed, types, targetZone, path]);

	// ------------------------------------------------------------------
	// live command implementations
	// ------------------------------------------------------------------

	const duplicateThing = React.useCallback(() => {
		try {
			const clone = cloneValue(thing);

			if (parent instanceof Array) {
				const index = Number(path);
				const next = [...parent];
				next.splice(Number.isNaN(index) ? next.length : index + 1, 0, clone);
				setThingtime(parentPath, next, { namespace: 'user' });
			} else if (parent && typeof parent === 'object' && typeof path === 'string') {
				let name = `${path} copy`;
				let increment = 1;
				while (Object.hasOwnProperty.call(parent, name) && increment <= 999) {
					increment++;
					name = `${path} copy ${increment}`;
				}

				const next: Record<string, unknown> = {};
				Object.keys(parent as Record<string, unknown>).forEach((key) => {
					next[key] = (parent as Record<string, unknown>)[key];
					if (key === path) {
						next[name] = clone;
					}
				});
				setThingtime(parentPath, next, { namespace: 'user' });
			} else {
				lopu({ title: 'Nothing to duplicate into 🤔', description: 'This thing has no parent container.', status: 'warning' });
				return;
			}

			lopu({ title: 'Duplicated 🐑', description: `${dottedPath} now has a copy beside it.`, status: 'success', duration: 4000 });
		} catch (err) {
			console.error('[tt][context-menu] duplicate failed', err);
			lopu({ title: 'Could not duplicate 😅', description: 'This value could not be cloned.', status: 'error' });
		}
	}, [thing, parent, parentPath, path, setThingtime, lopu, dottedPath]);

	const copyThing = React.useCallback(async () => {
		try {
			await navigator.clipboard.writeText(serializeThing(thing));
			lopu({ title: 'Copied 📋', description: `${dottedPath} is on your clipboard.`, status: 'success', duration: 4000 });
			return true;
		} catch (err) {
			console.error('[tt][context-menu] copy failed', err);
			lopu({ title: 'Could not copy 😅', description: 'Clipboard access was blocked.', status: 'error' });
			return false;
		}
	}, [thing, lopu, dottedPath]);

	const pasteThing = React.useCallback(async () => {
		try {
			const text = await navigator.clipboard.readText();
			let value: unknown = text;

			try {
				value = sanitizeParsedJson(JSON.parse(text));
			} catch {
				// plain string paste is fine
			}

			setThingtime(fullPath, value, { namespace: 'user' });
			lopu({ title: 'Pasted 📥', description: `${dottedPath} took the clipboard value.`, status: 'success', duration: 4000 });
		} catch (err) {
			console.error('[tt][context-menu] paste failed', err);
			lopu({ title: 'Could not paste 😅', description: 'Clipboard access was blocked.', status: 'error' });
		}
	}, [fullPath, setThingtime, lopu, dottedPath]);

	const shareThing = React.useCallback(async () => {
		try {
			const url = `${window.location.origin}${encodeURI(buildThingModeUrl('view', dottedPath))}`;
			await navigator.clipboard.writeText(url);
			lopu({ title: 'Link copied 🔗', description: url, status: 'success', duration: 6000 });
		} catch (err) {
			console.error('[tt][context-menu] share failed', err);
			lopu({ title: 'Could not copy the link 😅', description: 'Clipboard access was blocked.', status: 'error' });
		}
	}, [dottedPath, lopu]);

	const modifyThing = React.useCallback(() => {
		setEditMode?.(() => true);

		// focus the value's editor once edit mode has rendered
		setTimeout(() => {
			const input = document.querySelector<HTMLElement>(`.uuid-${uuid} .magic-input-focusable`);
			input?.focus?.();
		}, 120);
	}, [setEditMode, uuid]);

	const onAction = React.useCallback(
		(fired: ThingContextMenuAction) => {
			const { action } = fired;
			const payload = (action.payload || {}) as { type?: unknown; wrap?: boolean; template?: { label?: string; value?: unknown }; permission?: { label?: string } };

			switch (action.command) {
				case 'toggle-edit-mode':
					setEditMode?.((prev) => !prev);
					break;
				case 'change-type':
					// wrapping needs a container value to wrap into
					if (payload.wrap && (payload.type as { value?: unknown } | undefined)?.value == null) {
						lopu({
							title: 'This type cannot wrap here 🤔',
							description: 'It has no container value to wrap the current value into.',
							status: 'warning',
							duration: 5000
						});
						break;
					}
					onType?.({ type: payload.type, wrap: payload.wrap });
					break;
				case 'add-child':
					onAddChild?.({ type: payload.type });
					break;
				case 'apply-template':
					setThingtime(fullPath, cloneValue(payload.template?.value), { namespace: 'user' });
					lopu({
						title: `Template applied 🌱`,
						description: `${dottedPath} is now a fresh ${payload.template?.label || 'thing'}.`,
						status: 'success',
						duration: 4000
					});
					break;
				case 'modify':
					modifyThing();
					break;
				case 'collapse':
				case 'expand':
				case 'collapse-all':
				case 'expand-all':
					onCollapse?.(action.command);
					break;
				case 'rename-key':
					setEditMode?.(() => true);
					setTimeout(() => {
						const input = document.querySelector<HTMLElement>(`.uuid-${uuid} .thingPathDom-raw .magic-input-focusable`);
						input?.focus?.();
					}, 120);
					break;
				case 'copy-key':
					navigator.clipboard
						.writeText(String(path ?? ''))
						.then(() => lopu({ title: 'Key copied 📋', description: `"${path}" is on your clipboard.`, status: 'success', duration: 4000 }))
						.catch(() => lopu({ title: 'Could not copy 😅', description: 'Clipboard access was blocked.', status: 'error' }));
					break;
				case 'duplicate':
					duplicateThing();
					break;
				case 'copy':
					copyThing();
					break;
				case 'cut':
					copyThing().then((copied) => {
						if (copied) {
							onDelete?.();
						}
					});
					break;
				case 'paste':
					pasteThing();
					break;
				case 'share':
					shareThing();
					break;
				case 'set-permission':
				case 'invite-person':
					lopu({
						title: 'Permissions are coming soon 🌈',
						description: 'Sharing controls land with the things permissions API.',
						status: 'info',
						duration: 6000
					});
					break;
				case 'recycle':
					onDelete?.();
					break;
				default:
					console.warn('[tt][context-menu] unhandled action', fired);
			}
		},
		[setEditMode, onType, onAddChild, onCollapse, setThingtime, fullPath, lopu, dottedPath, modifyThing, duplicateThing, copyThing, pasteThing, shareThing, onDelete]
	);

	const onClickAway = React.useCallback(() => {
		if (!pinnedRef.current) {
			menu.closeMenu();
		}
	}, [menu.closeMenu]);

	return (
		<ClickAwayListener onClickAway={onClickAway}>
			<Center className="thing-context-menu-trigger" position="relative">
				<Flex
					paddingLeft={1}
					opacity={menu.open ? 1 : opacity}
					transition={transition || 'all 0.2s ease-in-out'}
					cursor="pointer"
					title="Options"
					onMouseEnter={() => {
						setTargetZone('thing');
						menu.hoverTriggerProps.onMouseEnter();
					}}
					onMouseLeave={menu.hoverTriggerProps.onMouseLeave}
					onClick={() => {
						setTargetZone('thing');
						menu.openPopover();
					}}
				>
					<Icon name="wizard" size={iconSize}></Icon>
				</Flex>
				<ThingContextMenu
					{...menu.menuProps}
					model={model}
					meta={{ path: dottedPath, type: thingType, zone: targetZone }}
					onAction={onAction}
				/>
			</Center>
		</ClickAwayListener>
	);
};
