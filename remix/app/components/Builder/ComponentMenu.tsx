import React from 'react';
import { ComponentStyle } from './ComponentStyle';
import { ComponentDialogHost, NativeControlsEnabled } from './NativeComponentControls';
import type { ComponentStyleRule } from './componentStyleRules';
import { menuPosition, setMenuDisplay } from './componentMenuPosition';

const menuStyles: ComponentStyleRule[] = [
	{ selector: ':where(.tt-native-menu-content)', declarations: { padding: '8px 0', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '6px', background: 'var(--tt-card, white)', color: 'inherit', 'min-width': '180px', 'max-width': 'calc(100vw - 24px)', 'max-height': 'min(480px, 90dvh)', overflow: 'auto', 'box-shadow': '0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1)' } },
	{ selector: ':where(.tt-native-menu-content) [role="menuitem"]', declarations: { display: 'flex', width: '100%', 'text-align': 'left' } }
];

// The trusted primitive owns top-layer placement and dismissal. Authored
// content stays in its original DOM/style/Action scope and remains sanitized.
export function ComponentMenu({ name, triggerContent, className, contentClassName, disabled, contextMenu, children }: {
	name?: unknown;
	triggerContent?: React.ReactNode;
	className?: unknown;
	contentClassName?: unknown;
	disabled?: unknown;
	contextMenu?: unknown;
	children: React.ReactNode;
}) {
	const enabled = React.useContext(NativeControlsEnabled);
	const root = React.useRef<HTMLDivElement>(null);
	const trigger = React.useRef<HTMLButtonElement>(null);
	const content = React.useRef<HTMLDivElement>(null);
	const restore = React.useRef<HTMLElement | null>(null);
	const id = React.useId();
	const [open, setOpen] = React.useState(false);
	const [dialogHost, setDialogHost] = React.useState<HTMLDivElement | null>(null);
	const host = React.useMemo(() => dialogHost ? { element: dialogHost, restoreFocus: () => restore.current?.focus() } : null, [dialogHost]);
	const label = typeof name === 'string' && name.trim() ? name.slice(0, 200) : 'Open menu';
	const context = contextMenu === true;
	React.useLayoutEffect(() => {
		const owner = root.current;
		if (!owner) return;
		const ownerDocument = owner.ownerDocument;
		const view = ownerDocument.defaultView;
		if (!view) return;
		// A nested menu owns its own slots, controls and events.
		const owned = (element: Element) => element.closest('[data-tt-native-menu]') === owner;
		const slot = (name: string) => Array.from(owner.querySelectorAll<HTMLElement>(`[data-tt-menu-slot="${name}"]`)).find(owned);
		const popup = context ? slot('content') : content.current;
		const target = context ? slot('target') : trigger.current;
		const buttons = context ? Array.from(owner.querySelectorAll<HTMLElement>('[data-tt-menu-trigger="true"]')).filter(owned) : trigger.current ? [trigger.current] : [];
		if (!popup || !target) return;
		const cleanups: (() => void)[] = [];
		const attribute = (element: HTMLElement, key: string, value: string | null) => {
			const previous = element.getAttribute(key);
			if (value === null) element.removeAttribute(key); else element.setAttribute(key, value);
			cleanups.push(() => { if (previous === null) element.removeAttribute(key); else element.setAttribute(key, previous); });
		};
		attribute(popup, 'popover', 'auto');
		attribute(popup, 'id', id);
		attribute(popup, 'role', 'menu');
		attribute(popup, 'aria-label', label);
		attribute(popup, 'inert', !enabled || disabled === true ? '' : null);
		attribute(popup, 'class', [popup.className, 'tt-native-menu-content', typeof contentClassName === 'string' ? contentClassName : ''].filter(Boolean).join(' '));
		const previousStyle = popup.getAttribute('style');
		const authoredDisplay = { value: popup.style.getPropertyValue('display'), priority: popup.style.getPropertyPriority('display') };
		// Authored grid/flex declarations outrank the UA closed-popover rule.
		// Closing must always hide the menu, without destroying its open layout.
		setMenuDisplay(popup.style, authoredDisplay, false);
		Object.assign(popup.style, { position: 'fixed', inset: 'auto', margin: '0', maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)' });
		cleanups.push(() => { if (previousStyle === null) popup.removeAttribute('style'); else popup.setAttribute('style', previousStyle); });
		buttons.forEach((button) => {
			attribute(button, 'aria-haspopup', 'menu'); attribute(button, 'aria-controls', id); attribute(button, 'aria-expanded', 'false');
			attribute(button, 'aria-disabled', !enabled || disabled === true ? 'true' : button.getAttribute('aria-disabled'));
		});
		let anchor: { left: number; right: number; top: number; bottom: number } | null = null;
		let search = { text: '', time: 0 };
		const isOpen = () => popup.matches(':popover-open');
		const choices = () => Array.from(popup.querySelectorAll<HTMLElement>('button, a[href], [role="menuitem"]'))
			.filter((item) => owned(item) && !item.closest('[data-tt-form-field], [hidden], [inert]') && !item.matches(':disabled, [aria-disabled="true"]') && item.getClientRects().length > 0);
		const sync = () => { const value = isOpen(); setMenuDisplay(popup.style, authoredDisplay, value); setOpen(value); buttons.forEach((button) => button.setAttribute('aria-expanded', String(value))); };
		const close = (focus = false) => { if (isOpen()) popup.hidePopover(); sync(); if (focus && restore.current?.isConnected) restore.current.focus(); };
		const place = () => {
			if (!isOpen()) return;
			const bounds = popup.getBoundingClientRect();
			const rect = anchor || target.getBoundingClientRect();
			const position = menuPosition(rect, bounds, view.innerWidth, view.innerHeight, context);
			popup.style.left = `${position.left}px`; popup.style.top = `${position.top}px`;
		};
		const show = (source: HTMLElement, last = false, point?: { x: number; y: number }) => {
			if (!enabled || disabled === true || source.matches(':disabled, [aria-disabled="true"]') || !popup.showPopover) return;
			restore.current = source;
			anchor = point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : source.getBoundingClientRect();
			if (!isOpen()) { setMenuDisplay(popup.style, authoredDisplay, true); popup.showPopover(); }
			sync();
			choices().forEach((item) => { if (item.getAttribute('role') !== 'menuitem') attribute(item, 'role', 'menuitem'); });
			place(); const items = choices(); (last ? items.at(-1) : items[0])?.focus();
		};
		const eventElement = (event: Event) => event.target instanceof view.Element && owned(event.target) ? event.target : null;
		const contextEvent = (event: MouseEvent) => {
			const element = eventElement(event);
			if (!context || !enabled || disabled === true || !element || !target.contains(element)) return;
			event.preventDefault(); event.stopPropagation();
			const focus = element.closest<HTMLElement>('button, a[href], [tabindex]') || target;
			show(focus, false, { x: event.clientX, y: event.clientY });
		};
		const click = (event: MouseEvent) => {
			const element = eventElement(event); if (!element) return;
			const button = buttons.find((candidate) => candidate.contains(element));
			if (button) { event.preventDefault(); event.stopPropagation(); if (isOpen()) close(true); else show(button); return; }
			if (element.closest('[data-tt-form-field]')) return;
			const item = element.closest<HTMLElement>('button, a[href], [role="menuitem"]');
			if (item && popup.contains(item) && !item.matches(':disabled, [aria-disabled="true"]')) close();
		};
		const keydown = (event: KeyboardEvent) => {
			const element = eventElement(event); if (!element) return;
			const button = buttons.find((candidate) => candidate.contains(element));
			if (context && target.contains(element) && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
				event.preventDefault(); event.stopPropagation(); show(element as HTMLElement); return;
			}
			if (button && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show(button, event.key === 'ArrowUp'); return; }
			if (!popup.contains(element) || !isOpen()) return;
			// Authored forms and Editor.js own typing, selection, native select
			// navigation and tool shortcuts. They are not menu typeahead targets.
			if (element.closest('input, textarea, select, [contenteditable="true"], [data-tt-form-field]')) return;
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
			if (event.key === 'Tab') { close(true); return; }
			if (event.key === ' ') { event.preventDefault(); element.closest<HTMLElement>('[role="menuitem"]')?.click(); return; }
			const items = choices(); const at = items.indexOf(ownerDocument.activeElement as HTMLElement);
			if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
				event.preventDefault(); const key = event.key.toLocaleLowerCase();
				const previous = Date.now() - search.time < 500 ? search.text : '';
				const prefix = previous === key ? key : previous + key; search = { text: prefix, time: Date.now() };
				[...items.slice(at + 1), ...items.slice(0, at + 1)].find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(prefix))?.focus(); return;
			}
			if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus();
		};
		const lifecycle = () => close();
		const beforeToggle = (event: Event) => setMenuDisplay(popup.style, authoredDisplay, (event as ToggleEvent).newState === 'open');
		owner.addEventListener('contextmenu', contextEvent); owner.addEventListener('click', click); owner.addEventListener('keydown', keydown);
		popup.addEventListener('beforetoggle', beforeToggle); popup.addEventListener('toggle', sync); view.addEventListener('resize', place); view.addEventListener('scroll', place, true); view.addEventListener('pagehide', lifecycle);
		const visibility = () => { if (ownerDocument.hidden) close(); }; ownerDocument.addEventListener('visibilitychange', visibility);
		const observer = new view.ResizeObserver(place); observer.observe(popup);
		return () => {
			close(); observer.disconnect(); owner.removeEventListener('contextmenu', contextEvent); owner.removeEventListener('click', click); owner.removeEventListener('keydown', keydown);
			popup.removeEventListener('beforetoggle', beforeToggle); popup.removeEventListener('toggle', sync); view.removeEventListener('resize', place); view.removeEventListener('scroll', place, true); view.removeEventListener('pagehide', lifecycle); ownerDocument.removeEventListener('visibilitychange', visibility);
			cleanups.reverse().forEach((cleanup) => cleanup());
		};
	}, [context, enabled, disabled, children, id, label, contentClassName]);
	return <ComponentStyle rules={menuStyles}>
		<div ref={root} data-tt-native-menu="" className={context && typeof className === 'string' ? className : undefined} style={{ display: 'contents' }}>
			<ComponentDialogHost.Provider value={host}>
				{context ? children : <>
					<button ref={trigger} type="button" className={['tt-native-menu-trigger', typeof className === 'string' ? className : ''].filter(Boolean).join(' ')} disabled={!enabled || disabled === true} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}>{triggerContent ?? label}</button>
					<div ref={content} popover="auto" role="menu" aria-label={label}>{children}</div>
				</>}
			</ComponentDialogHost.Provider>
			<div ref={setDialogHost} style={{ display: 'contents' }} />
		</div>
	</ComponentStyle>;
}
