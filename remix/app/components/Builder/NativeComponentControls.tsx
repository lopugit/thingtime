import React from 'react';
import { countdownDuration, countdownRemaining } from './nativeControlClock';

export const NativeControlsEnabled = React.createContext(false);
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.slice(0, 200) : fallback);

// Native dialogs remain inside the component DOM so the same delegated Action
// and form boundary applies. The browser handles focus, Escape and inertness.
export function ComponentDialog({ title, name, type, children }: { title?: unknown; name?: unknown; type?: unknown; children: React.ReactNode }) {
	const enabled = React.useContext(NativeControlsEnabled);
	const dialog = React.useRef<HTMLDialogElement>(null);
	const label = text(title, 'Component dialog');
	return (
		<>
			<button type="button" disabled={!enabled} onClick={() => dialog.current?.showModal()}>
				{text(name, `Open ${label}`)}
			</button>
			<dialog
				ref={dialog}
				onClick={(event) => {
					if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.target as HTMLElement).closest('a[href]'))
						dialog.current?.close();
				}}
				aria-label={label}
				style={{
					boxSizing: 'border-box',
					width: 'min(560px, 92vw)',
					maxWidth: '100vw',
					maxHeight: '90dvh',
					padding: 20,
					border: '1px solid var(--tt-border, #ddd)',
					borderRadius: 12,
					background: 'var(--tt-card, white)',
					color: 'var(--tt-ink, #16161a)',
					...(type === 'drawer' ? { position: 'fixed', inset: '0 auto 0 0', margin: 0, height: '100dvh', maxHeight: '100dvh', borderRadius: 0 } : {})
				}}
			>
				<header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
					<strong>{label}</strong>
					<button type="button" aria-label="Close dialog" onClick={() => dialog.current?.close()}>
						Close
					</button>
				</header>
				{children}
			</dialog>
		</>
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
