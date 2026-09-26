import React from 'react';
import { ComponentStyle } from './ComponentStyle';
import type { ComponentStyleRule } from './componentStyleRules';
import { ComponentDataScope } from './ComponentSelect';
import { countdownDuration, countdownRemaining } from './nativeControlClock';

export const NativeControlsEnabled = React.createContext(false);
export const ComponentLocalControl = React.createContext<((input: Record<string, unknown>) => void) | null>(null);
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.slice(0, 200) : fallback);

const dialogStyles: ComponentStyleRule[] = [
	{
		selector: ':where(.tt-native-dialog)',
		declarations: {
			'box-sizing': 'border-box',
			width: 'min(560px, 92vw)',
			'max-width': '100vw',
			'max-height': '90dvh',
			padding: '20px',
			border: '1px solid var(--tt-border, #ddd)',
			'border-radius': '12px',
			background: 'var(--tt-card, white)',
			color: 'inherit'
		}
	},
	{
		selector: ':where(.tt-native-dialog[data-type="drawer"])',
		declarations: { inset: '0 auto 0 0', margin: '0', height: '100dvh', 'max-height': '100dvh', 'border-radius': '0' }
	},
	{
		selector: ':where(.tt-native-dialog-header)',
		declarations: { display: 'flex', 'justify-content': 'space-between', gap: '16px', 'margin-bottom': '16px' }
	}
];

// Native dialogs remain inside the component DOM so the same delegated Action
// and form boundary applies. The browser handles focus, Escape and inertness.
export function ComponentDialog({
	title,
	name,
	type,
	autoOpen,
	closeQuery,
	closeOnAction,
	className,
	children
}: {
	title?: unknown;
	name?: unknown;
	type?: unknown;
	autoOpen?: unknown;
	closeQuery?: unknown;
	closeOnAction?: unknown;
	className?: unknown;
	children: React.ReactNode;
}) {
	const enabled = React.useContext(NativeControlsEnabled);
	const local = React.useContext(ComponentLocalControl);
	const scope = React.useContext(ComponentDataScope);
	const handledResult = React.useRef(scope.last);
	const dialog = React.useRef<HTMLDialogElement>(null);
	const label = text(title, 'Component dialog');
	const dismiss = React.useCallback(() => {
		dialog.current?.close();
		if (closeQuery && typeof closeQuery === 'object' && !Array.isArray(closeQuery)) local?.({ op: 'query', params: closeQuery });
	}, [closeQuery, local]);
	React.useEffect(() => {
		if (autoOpen === true && enabled && !dialog.current?.open) dialog.current?.showModal();
	}, [autoOpen, enabled]);
	React.useEffect(() => {
		const last = scope.last as { action?: unknown; ok?: unknown } | undefined;
		if (last === handledResult.current) return;
		handledResult.current = last;
		if (last?.ok === true && last.action === closeOnAction) dismiss();
	}, [scope.last, closeOnAction, dismiss]);
	return (
		<ComponentStyle rules={dialogStyles}>
			{autoOpen !== true && (
				<button type="button" disabled={!enabled} onClick={() => dialog.current?.showModal()}>
					{text(name, `Open ${label}`)}
				</button>
			)}
			<dialog
				ref={dialog}
				className={['tt-native-dialog', typeof className === 'string' ? className : ''].filter(Boolean).join(' ')}
				data-type={type === 'drawer' ? 'drawer' : 'dialog'}
				onCancel={(event) => {
					event.preventDefault();
					dismiss();
				}}
				onClick={(event) => {
					if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.target as HTMLElement).closest('a[href]'))
						dialog.current?.close();
				}}
				aria-label={label}
			>
				<header className="tt-native-dialog-header">
					<strong>{label}</strong>
					<button type="button" aria-label="Close dialog" onClick={dismiss}>
						×
					</button>
				</header>
				{children}
			</dialog>
		</ComponentStyle>
	);
}

export function ComponentCountdown({ value }: { value?: unknown }) {
	const enabled = React.useContext(NativeControlsEnabled);
	const duration = countdownDuration(value);
	return <Countdown key={`${enabled}:${duration}`} duration={duration} enabled={enabled} />;
}
function Countdown({ duration, enabled }: { duration: number; enabled: boolean }) {
	const [remaining, setRemaining] = React.useState(duration);
	const [deadline, setDeadline] = React.useState<number | null>(null);
	React.useEffect(() => {
		if (deadline === null || !enabled) return;
		const tick = () => {
			const next = countdownRemaining(deadline, performance.now());
			setRemaining(next);
			if (!next) setDeadline(null);
		};
		tick();
		const timer = window.setInterval(tick, 200);
		return () => window.clearInterval(timer);
	}, [deadline, enabled]);
	const pause = () => {
		if (deadline !== null) setRemaining(countdownRemaining(deadline, performance.now()));
		setDeadline(null);
	};
	return (
		<fieldset style={{ display: 'grid', gap: 12, border: 0, padding: 0, minWidth: 0 }}>
			<output aria-label="Time remaining">
				{Math.floor(remaining / 3600)
					.toString()
					.padStart(2, '0')}
				:
				{Math.floor((remaining / 60) % 60)
					.toString()
					.padStart(2, '0')}
				:{(remaining % 60).toString().padStart(2, '0')}
			</output>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
				<button
					type="button"
					disabled={!enabled || deadline !== null || remaining === 0}
					onClick={() => setDeadline(performance.now() + remaining * 1000)}
				>
					Start countdown
				</button>
				<button type="button" disabled={deadline === null} onClick={pause}>
					Pause countdown
				</button>
				<button
					type="button"
					disabled={!enabled}
					onClick={() => {
						setDeadline(null);
						setRemaining(duration);
					}}
				>
					Reset countdown
				</button>
			</div>
			{remaining === 0 ? <p role="status">Time is up.</p> : null}
		</fieldset>
	);
}

// A configurable form boundary with one stable operation identity. Refreshes and
// failed/ambiguous writes retain the same id; only an explicit resetKey change
// or switching to another saved identity starts a new draft.
export function ComponentForm({
	identityName,
	identity,
	revisionName,
	revision,
	resetKey,
	children
}: {
	identityName?: unknown;
	identity?: unknown;
	revisionName?: unknown;
	revision?: unknown;
	resetKey?: unknown;
	children: React.ReactNode;
}) {
	const enabled = React.useContext(NativeControlsEnabled);
	const name = typeof identityName === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(identityName) ? identityName : '';
	const saved = typeof identity === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(identity) ? identity : '';
	const reset = typeof resetKey === 'string' || typeof resetKey === 'number' ? String(resetKey).slice(0, 200) : '';
	return (
		<FormInstance
			key={JSON.stringify([saved, reset, enabled])}
			name={name}
			saved={saved}
			revisionName={revisionName}
			revision={revision}
			enabled={enabled}
		>
			{children}
		</FormInstance>
	);
}
function FormInstance({
	name,
	saved,
	revisionName,
	revision,
	enabled,
	children
}: {
	name: string;
	saved: string;
	revisionName: unknown;
	revision: unknown;
	enabled: boolean;
	children: React.ReactNode;
}) {
	const [id] = React.useState(() => saved || crypto.randomUUID());
	const [stamp] = React.useState(() => (typeof revision === 'string' ? revision.slice(0, 200) : ''));
	const stampName = typeof revisionName === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(revisionName) ? revisionName : '';
	return (
		<fieldset disabled={!enabled} style={{ display: 'grid', gap: 12, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
			{name ? <input type="hidden" name={name} value={id} /> : null}
			{stampName ? <input type="hidden" name={stampName} value={stamp} /> : null}
			{children}
		</fieldset>
	);
}
