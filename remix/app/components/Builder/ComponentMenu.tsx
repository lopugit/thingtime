import React from 'react';
import { ComponentStyle } from './ComponentStyle';
import { ComponentDialogHost, NativeControlsEnabled } from './NativeComponentControls';
import type { ComponentStyleRule } from './componentStyleRules';

const menuStyles: ComponentStyleRule[] = [
	{ selector: ':where(.tt-native-menu-content)', declarations: { padding: '8px 0', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '6px', background: 'var(--tt-card, white)', color: 'inherit', 'min-width': '180px', 'max-width': 'calc(100vw - 24px)', 'max-height': 'min(480px, 90dvh)', overflow: 'auto', 'box-shadow': '0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1)' } },
	{ selector: ':where(.tt-native-menu-content) [role="menuitem"]', declarations: { display: 'flex', width: '100%', 'text-align': 'left' } }
];

// The trusted primitive owns top-layer placement and dismissal. Authored
// content stays in its original DOM/style/Action scope and remains sanitized.
export function ComponentMenu({ name, triggerContent, className, contentClassName, disabled, children }: {
	name?: unknown;
	triggerContent?: React.ReactNode;
	className?: unknown;
	contentClassName?: unknown;
	disabled?: unknown;
	children: React.ReactNode;
}) {
	const enabled = React.useContext(NativeControlsEnabled);
	const trigger = React.useRef<HTMLButtonElement>(null);
	const content = React.useRef<HTMLDivElement>(null);
	const id = React.useId();
	const search = React.useRef({ text: '', time: 0 });
	const [open, setOpen] = React.useState(false);
	const [dialogHost, setDialogHost] = React.useState<HTMLDivElement | null>(null);
	const host = React.useMemo(() => dialogHost ? { element: dialogHost, restoreFocus: () => trigger.current?.focus() } : null, [dialogHost]);
	const label = typeof name === 'string' && name.trim() ? name.slice(0, 200) : 'Open menu';
	const visibleItems = () => Array.from(content.current?.querySelectorAll<HTMLElement>('button, a[href], [role="menuitem"]') || [])
		.filter((item) => !item.matches('[hidden]') && item.getClientRects().length > 0).slice(0, 100);
	const items = () => visibleItems().filter((item) => !item.matches(':disabled, [aria-disabled="true"]'));
	const close = (restoreFocus = false) => {
		if (content.current?.matches(':popover-open')) content.current.hidePopover();
		setOpen(false);
		if (restoreFocus) trigger.current?.focus();
	};
	const place = React.useCallback(() => {
		const button = trigger.current;
		const popup = content.current;
		if (!button || !popup?.matches(':popover-open')) return;
		const anchor = button.getBoundingClientRect();
		const bounds = popup.getBoundingClientRect();
		const left = Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12));
		const top = anchor.bottom + 8 + bounds.height <= window.innerHeight - 12
			? anchor.bottom + 8 : Math.max(12, anchor.top - bounds.height - 8);
		popup.style.left = `${left}px`;
		popup.style.top = `${top}px`;
	}, []);
	const show = (last = false) => {
		const popup = content.current;
		if (!enabled || disabled === true || !popup?.showPopover) return;
		if (!popup.matches(':popover-open')) popup.showPopover();
		setOpen(true);
		visibleItems().forEach((item) => item.setAttribute('role', 'menuitem'));
		place();
		const choices = items();
		(last ? choices.at(-1) : choices[0])?.focus();
	};
	React.useEffect(() => {
		const popup = content.current;
		if (!popup) return;
		const toggle = () => setOpen(popup.matches(':popover-open'));
		popup.addEventListener('toggle', toggle);
		return () => popup.removeEventListener('toggle', toggle);
	}, []);
	React.useEffect(() => {
		if (!enabled || disabled === true) close();
		// Closing does not discard an authored form or change its identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, disabled]);
	React.useEffect(() => {
		if (!open) return;
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		const observer = new ResizeObserver(place);
		if (content.current) observer.observe(content.current);
		return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); observer.disconnect(); };
	}, [open, place]);
	return <ComponentStyle rules={menuStyles}>
		<button ref={trigger} type="button" className={['tt-native-menu-trigger', typeof className === 'string' ? className : ''].filter(Boolean).join(' ')}
			disabled={!enabled || disabled === true} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
			onClick={() => open ? close(true) : show()}
			onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowUp'); } }}>
			{triggerContent ?? label}
		</button>
		<div ref={content} id={id} popover="auto" role="menu" aria-label={label}
			className={['tt-native-menu-content', typeof contentClassName === 'string' ? contentClassName : ''].filter(Boolean).join(' ')}
			style={{ position: 'fixed', inset: 'auto', margin: 0, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)' }}
			onClick={(event) => {
				const item = (event.target as HTMLElement).closest('button, a[href], [role="menuitem"]');
				if (item && content.current?.contains(item) && !item.matches(':disabled, [aria-disabled="true"]')) close();
			}}
			onKeyDown={(event) => {
				// React portals bubble through this owner; modal fields are not menu items.
				if (!content.current?.contains(event.target as Node)) return;
				if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
				if (event.key === 'Tab') { close(true); return; }
				if (event.key === ' ') { event.preventDefault(); (event.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]')?.click(); return; }
				if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
					event.preventDefault();
					const key = event.key.toLocaleLowerCase();
					const previous = Date.now() - search.current.time < 500 ? search.current.text : '';
					const prefix = previous === key ? key : (previous + key).slice(0, 100);
					search.current = { text: prefix, time: Date.now() };
					const choices = items();
					const at = choices.indexOf(document.activeElement as HTMLElement);
					const ordered = [...choices.slice(at + 1), ...choices.slice(0, at + 1)];
					ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(prefix))?.focus();
					return;
				}
				if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
				event.preventDefault();
				const choices = items();
				const at = choices.indexOf(document.activeElement as HTMLElement);
				const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
				choices[next]?.focus();
			}}><ComponentDialogHost.Provider value={host}>{children}</ComponentDialogHost.Provider></div>
		<div ref={setDialogHost} style={{ display: 'contents' }} />
	</ComponentStyle>;
}
