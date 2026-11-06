import React from 'react';
import { Button, Flex, Input, Text } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';
import type { LocalTimelineRow } from '../../timeline/localStore';
import { TIMELINE_VERSION_NAME_MAX_CHARS, parseTimelineVersionNameResult, type TimelineVersionName, type TimelineVersionNameCommand } from '../../timeline/versionNames';
import { downloadTimelineVersionExport } from './timelineExportDownload';
import { normalizeVersionName, versionControlState } from './timelineVersionControls';

/** The control strip under one Versions-tab row: 📌 name form (Save, Clear
 * when a name exists) and Export. It is a sibling of the row's select button,
 * never nested in it. Names are online only and the server is authoritative:
 * every write sends the revision this editor last saw and a 409 offers Refresh.
 * `drafts` outlives this editor (the mobile sheet unmounts the whole panel on
 * Escape), so a typed name is still there when the row is reopened. */
export function TimelineVersionNameEditor({ row, current, drafts, draftKey }: { row: LocalTimelineRow; current: TimelineVersionName | undefined; drafts: Map<string, string>; draftKey: string }) {
	const { connection } = useTimelineSession(); const api = useApi();
	const { event } = row;
	// A save or refresh knows the record before the history view repaints; the view's own record wins again as soon as it changes.
	const [override, setOverride] = React.useState<{ name: TimelineVersionName | null } | null>(null);
	React.useEffect(() => { setOverride(null); }, [current?.revision, current?.name, current?.updatedAt]);
	const live = override ? override.name : current ?? null;
	const [value, setValue] = React.useState(() => drafts.get(draftKey) ?? live?.name ?? '');
	const [saving, setSaving] = React.useState(false); const [exporting, setExporting] = React.useState(false);
	const [notice, setNotice] = React.useState(''); const [error, setError] = React.useState<{ message: string; stale: boolean } | null>(null);
	const input = React.useRef<HTMLInputElement>(null);
	const alive = React.useRef(true); const working = React.useRef(false);
	React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
	// Focus returns after the operation ends: while saving the input is disabled and cannot take focus.
	const wantFocus = React.useRef(false);
	React.useEffect(() => { if (!saving && !exporting && wantFocus.current) { wantFocus.current = false; input.current?.focus(); } }, [saving, exporting]);
	// A record that changed underneath an untouched field re-prefills it; a typed draft is kept until Save, Clear or Refresh.
	const seen = React.useRef(`${live?.revision ?? 0}:${live?.updatedAt ?? ''}`);
	React.useEffect(() => {
		const stamp = `${live?.revision ?? 0}:${live?.updatedAt ?? ''}`;
		if (stamp === seen.current) return;
		seen.current = stamp;
		if (!drafts.has(draftKey)) setValue(live?.name ?? '');
	}, [live?.revision, live?.updatedAt, live?.name, drafts, draftKey]);
	const state = versionControlState(row, !!connection?.verified);
	const name = normalizeVersionName(value);
	const unchanged = name === (live?.name ?? '');
	const change = (next: string) => { setValue(next); if (next === (live?.name ?? '')) drafts.delete(draftKey); else drafts.set(draftKey, next); };
	const settle = (fresh: TimelineVersionName | null, message: string) => {
		drafts.delete(draftKey);
		if (alive.current) { setOverride({ name: fresh }); setValue(fresh?.name ?? ''); setNotice(message); }
		window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
	};
	const send = async (next: string | null) => {
		if (!connection || working.current) return;
		const command: TimelineVersionNameCommand = { command: 'name-version', operationId: crypto.randomUUID(), eventId: event.id, thingId: event.thingId, name: next, expectedRevision: live?.revision ?? 0 };
		working.current = true; wantFocus.current = true; setSaving(true); setError(null); setNotice('');
		try {
			const result = parseTimelineVersionNameResult(await api.v1.timeline.nameVersion(connection.scope, command), connection.scope.ownerId, command);
			// The receipt is a real effect event: cache it with the version it names so every open history view repaints together.
			if (result.entry) await connection.store.accept([result.entry]);
			connection.names.accept(result.name ? [result.name] : [], { events: [event.id] });
			settle(result.name, next === null ? 'Removed the version name.' : live ? `Renamed this version “${result.name?.name ?? next}”.` : `Named this version “${result.name?.name ?? next}”.`);
		} catch (failure: any) {
			if (alive.current) setError({ message: failure?.error || failure?.message || 'Could not save this version name.', stale: failure?.status === 409 });
		} finally { working.current = false; if (alive.current) setSaving(false); }
	};
	const refresh = async () => {
		if (!connection || working.current) return;
		working.current = true; wantFocus.current = true; setSaving(true); setError(null); setNotice('');
		try {
			// The entry read carries the current name record (or none); the connection cache is updated by the read itself.
			await connection.sync.entry(event.id);
			const fresh = connection.names.forEvents([event.id]).get(event.id) ?? null;
			settle(fresh, fresh ? `This version is now named “${fresh.name}”.` : 'This version has no name now.');
		} catch (failure: any) { if (alive.current) setError({ message: failure?.error || failure?.message || 'Could not refresh this version.', stale: false }); }
		finally { working.current = false; if (alive.current) setSaving(false); }
	};
	const exportVersion = async () => {
		if (!connection || working.current) return;
		working.current = true; setExporting(true); setError(null); setNotice('');
		try {
			const filename = downloadTimelineVersionExport(await api.v1.timeline.exportVersion(connection.scope, event.id), event);
			if (alive.current) setNotice(`Exported ${live?.name ?? event.label} · ${filename}`);
		} catch (failure: any) { if (alive.current) setError({ message: failure?.error || failure?.message || 'Could not export this version.', stale: false }); }
		finally { working.current = false; if (alive.current) setExporting(false); }
	};
	return <Flex as="form" className="history-version-controls" gap={2} align="center" wrap="wrap" px={1} pb={2} minW={0}
		onClick={(click) => click.stopPropagation()}
		onSubmit={(submit) => { submit.preventDefault(); if (state.name && name && !unchanged) void send(name); }}>
		<Input ref={input} aria-label="Version name" placeholder="Name this version…" size="xs" maxLength={TIMELINE_VERSION_NAME_MAX_CHARS} flex="1" minW="140px" maxW="100%" value={value} isDisabled={!state.name || saving} title={state.name ? undefined : state.title} onChange={(field) => change(field.target.value)} />
		<Button type="submit" size="xs" isLoading={saving} isDisabled={!state.name || !name || unchanged || exporting} title={state.name ? undefined : state.title}>Save</Button>
		{live ? <Button type="button" size="xs" variant="ghost" isDisabled={!state.name || saving || exporting} onClick={() => void send(null)}>Clear</Button> : null}
		<Button type="button" size="xs" variant="outline" isLoading={exporting} isDisabled={!state.export || saving} title={state.export ? undefined : state.title} onClick={() => void exportVersion()}>Export</Button>
		{!state.name ? <Text fontSize="xs" color="var(--tt-muted)" flexBasis="100%">{state.title}</Text> : null}
		{notice ? <Text role="status" fontSize="xs" color="var(--tt-muted)" flexBasis="100%" overflowWrap="anywhere">{notice}</Text> : null}
		{error ? <Flex role="alert" flexBasis="100%" gap={2} align="center" wrap="wrap" minW={0}>
			<Text fontSize="xs" overflowWrap="anywhere" minW={0}>{error.message}</Text>
			{error.stale ? <Button type="button" size="xs" variant="outline" isDisabled={saving || exporting} onClick={() => void refresh()}>Refresh</Button> : null}
		</Flex> : null}
	</Flex>;
}
