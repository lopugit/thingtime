import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { AUTOMATION_SWITCHES, DEFAULT_AUTOMATION_SWITCHES, normalizeAutomationSwitches, type AutomationSwitchState } from '~/automation/automationSwitches';
import { automationSwitches } from '~/automation/automationSwitchesClient';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { AdminSettingsScope, type AdminSettingsEditorProps } from './AdminSettingsScope';
import { AUTOMATION_SWITCH_BLOCKS, automationSwitchScopeKey } from './automationSwitchBlocks';

/** Admin → Automation: one on/off switch per automatic background feature. */
export function AutomationSwitchesSettings() {
	return <AdminSettingsScope editor={Editor} />;
}

type Saved = { switches: AutomationSwitchState; updatedAt: string | null; updatedBy: string | null };

function Editor({ scope, transport, dataPlane }: AdminSettingsEditorProps) {
	const { expectedActor, expectedApiOrigin } = scope;
	const [saved, setSaved] = React.useState<Saved | null>(null);
	// Optimistic view: a toggled switch shows its new state at once and reverts
	// if the save fails.
	const [view, setView] = React.useState<AutomationSwitchState>(DEFAULT_AUTOMATION_SWITCHES);
	const [busy, setBusy] = React.useState(true);
	const [notice, setNotice] = React.useState('');
	const pending = React.useRef<AbortController | null>(null);

	const request = React.useCallback(async (signal: AbortSignal, changes?: Record<string, boolean>): Promise<Saved> => {
		if (dataPlane !== 'home') throw new Error('Select Home storage to manage automation switches.');
		await requireThingtimeCapability('api.admin-automation-switches', '1.0.0', expectedApiOrigin, { ...transport, signal });
		const response = await transport.fetch(new URL('/api/v1/admin/automation-switches', expectedApiOrigin).href, {
			method: changes ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin', signal,
			headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': expectedActor, 'X-Thingtime-Expected-Data-Plane': 'home' },
			...(changes ? { body: JSON.stringify({ changes }) } : {})
		});
		const result = await response.json();
		if (!response.ok || result.ok !== true) throw new Error(result.error || 'Could not read or save the automation switches.');
		signal.throwIfAborted();
		transport.currentOrigin();
		return { switches: normalizeAutomationSwitches(result.switches), updatedAt: result.updatedAt ?? null, updatedBy: result.updatedBy ?? null };
	}, [dataPlane, expectedActor, expectedApiOrigin, transport]);

	const run = React.useCallback(async (changes?: Record<string, boolean>) => {
		if (pending.current) return;
		const current = new AbortController();
		pending.current = current;
		setBusy(true);
		setNotice('');
		const before = view;
		if (changes) setView({ ...view, ...changes });
		try {
			const next = await request(current.signal, changes);
			setSaved(next);
			setView(next.switches);
			// This browser applies the change at once; other apps pick it up on
			// their next start or return to the foreground.
			automationSwitches().apply(next.switches);
			if (changes && Object.entries(changes).some(([id, enabled]) => next.switches[id] !== enabled))
				setNotice('Another administrator changed these switches. Showing the saved state.');
		} catch (error) {
			if (!current.signal.aborted) {
				if (changes) setView(before);
				setNotice(error instanceof Error ? error.message : 'Could not load the automation switches.');
			}
		} finally {
			if (pending.current === current) {
				pending.current = null;
				setBusy(false);
			}
		}
	}, [request, view]);

	React.useEffect(() => {
		void run();
		return () => {
			pending.current?.abort();
			pending.current = null;
		};
		// Load once per account/origin scope.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [request]);

	const onCount = AUTOMATION_SWITCHES.filter((entry) => view[entry.id] === true).length;
	const display: Record<string, unknown> = {
		busy,
		notice,
		disabled: busy || !saved,
		summary: !saved
			? busy ? '' : 'Switches are unavailable.'
			: `${onCount} of ${AUTOMATION_SWITCHES.length} on${saved.updatedAt ? ` · last changed ${new Date(saved.updatedAt).toLocaleString()}` : ''}`
	};
	for (const entry of AUTOMATION_SWITCHES) {
		const key = automationSwitchScopeKey(entry.id);
		display[key] = view[entry.id] === true;
		display[`${key}_label`] = view[entry.id] === true ? 'On' : 'Off';
	}
	const actions: TransientBlockActions = {
		toggle: ({ inputs, value }) => {
			const id = typeof inputs.id === 'string' ? inputs.id : '';
			if (!busy && saved && AUTOMATION_SWITCHES.some((entry) => entry.id === id)) return run({ [id]: value === true });
		},
		all: ({ inputs }) => {
			if (busy || !saved) return;
			const enabled = inputs.enabled === true || inputs.enabled === 'true';
			return run(Object.fromEntries(AUTOMATION_SWITCHES.map((entry) => [entry.id, enabled])));
		},
		reload: () => run()
	};
	const scopeKey = JSON.stringify([expectedActor, expectedApiOrigin]);
	return (
		<SettingsDocumentHost documentKey="admin-automation-switches" title="Automation switches layout" scopeKey={scopeKey} accountTransport={transport} defaultDocument={AUTOMATION_SWITCH_BLOCKS}>
			{({ blocks, chrome, editing }) => (
				<TransientBlockHost scopeKey={scopeKey} scope={{ auto: display }} enabled={!editing} actions={actions}>
					<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
				</TransientBlockHost>
			)}
		</SettingsDocumentHost>
	);
}
