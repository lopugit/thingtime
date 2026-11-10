import React from 'react';
import { Box, Button, Flex, Switch, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { SettingRow, SettingsSection } from './SettingsSection';
import { apiErrorMessage } from '~/hooks/apiFailure';
import type { CurrentUser } from '~/hooks/useCurrentUser';
import { HISTORY_PAUSED_THINGS_MAX, HISTORY_RETENTION, type HistoryPrefsPatch, type HistoryRetention } from '~/timeline/historyPrefs';
import { useHistoryPrefs } from '~/timeline/historyPrefsClient';
import { TimelineStorageProvider, useSelectedTimelineSession, useTimelineSession } from '~/timeline/TimelineProvider';
import { TIMELINE_CHANGED_EVENT } from '~/timeline/clientEvents';
import { timelineScopeKey } from '~/timeline/contract';
import { TIMELINE_PENDING_MAX_EVENTS } from '~/timeline/localStore';
import type { TimelineStorage } from '~/timeline/storageScope';
import { collectHistoryExport, downloadHistoryExport, HISTORY_EXPORT_MAX_EVENTS } from '~/components/Timeline/historyExport';
import { HISTORY_HOLD_WARNING_PENDING } from '~/components/Timeline/TimelineHost';

// Settings → History (/settings/history, ?settings=history). Account
// preferences come from the shared per-owner prefs store (cache first, one GET
// per owner per page load, optimistic updates that revert with a Lopu toast);
// "Show messages" is a per-viewer convenience in localStorage. Honest copy:
// nothing here deletes history, the hold is account-wide while queues are per
// device, and a paused Thing only stops client draft capture in the Builder
// page and definition editors — saved versions still record on the server.

const RETENTION_LABELS: Record<HistoryRetention, string> = { forever: 'Forever', '90d': '90 days', named: 'Named versions only' };
export const fullHistoryAccount = (user: CurrentUser) => !!user && !user.temporary && user.accountKind === 'user';

/** "n waiting on this device" for one session's queue; the home line is skipped when it shares the selected session's connection. */
function DevicePending({ storage, skip, held, label = '' }: { storage: TimelineStorage; skip?: string; held: boolean; label?: string }) {
	const { connection } = useTimelineSession();
	const [count, setCount] = React.useState<number | null>(null);
	const key = connection ? timelineScopeKey(connection.scope) : '';
	React.useEffect(() => {
		if (!connection) { setCount(null); return; }
		let alive = true;
		const refresh = () => { void connection.store.pendingCount().then(value => { if (alive) setCount(value); }).catch(() => { if (alive) setCount(null); }); };
		refresh();
		window.addEventListener(TIMELINE_CHANGED_EVENT, refresh); window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
		return () => { alive = false; window.removeEventListener(TIMELINE_CHANGED_EVENT, refresh); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
	}, [connection]);
	if (!connection || count === null || (storage === 'home' && key === skip)) return null;
	return <Box>
		<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">{count} {count === 1 ? 'change' : 'changes'} waiting on this device{label}</Text>
		{held && count >= HISTORY_HOLD_WARNING_PENDING ? <Text role="status" fontSize="xs" color="var(--tt-warning, #b7791f)">Resume soon — this device holds at most {TIMELINE_PENDING_MAX_EVENTS} changes.</Text> : null}
	</Box>;
}

/** Online-only client export of what this device can load from the chosen storage (bounded, never cached to IndexedDB). */
function ExportControl({ storage }: { storage: TimelineStorage }) {
	const { connection } = useTimelineSession();
	const [exporting, setExporting] = React.useState(false);
	const [notice, setNotice] = React.useState(''); const [error, setError] = React.useState('');
	const [online, setOnline] = React.useState(() => typeof navigator === 'undefined' || navigator.onLine);
	const controller = React.useRef<AbortController | null>(null);
	React.useEffect(() => {
		const changed = () => setOnline(navigator.onLine);
		window.addEventListener('online', changed); window.addEventListener('offline', changed);
		return () => { controller.current?.abort(); window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
	}, []);
	const caption = !connection ? 'Connecting Timeline…' : !connection.verified || !online ? 'Reconnect to export' : '';
	const run = async () => {
		if (!connection || caption || exporting) return;
		const attempt = new AbortController(); controller.current = attempt;
		setExporting(true); setError(''); setNotice('');
		try {
			const file = await collectHistoryExport(cursor => connection.sync.scan(cursor), { ownerId: connection.scope.ownerId, dataPlane: connection.scope.dataPlane, storage }, { signal: attempt.signal });
			if (attempt.signal.aborted) return;
			const filename = downloadHistoryExport(file);
			setNotice(`Exported ${file.entries.length} ${file.entries.length === 1 ? 'change' : 'changes'}, ${file.notes.length} ${file.notes.length === 1 ? 'note' : 'notes'} and ${file.names.length} ${file.names.length === 1 ? 'name' : 'names'} · ${filename}${file.truncated ? ` · older history beyond ${HISTORY_EXPORT_MAX_EVENTS} changes was left out` : ''}`);
		} catch (failure) {
			if (!attempt.signal.aborted) setError(apiErrorMessage(failure, 'Could not export your history. Nothing was changed.'));
		} finally { if (controller.current === attempt) { controller.current = null; setExporting(false); } }
	};
	return <Box>
		<Button size="xs" variant="outline" isLoading={exporting} isDisabled={!!caption} title={caption || undefined} onClick={() => void run()}>Export history 📦</Button>
		{caption ? <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" mt={1}>{caption}</Text> : null}
		{notice ? <Text role="status" fontSize="xs" color="var(--tt-muted, #9a9aa6)" mt={1} overflowWrap="anywhere">{notice}</Text> : null}
		{error ? <Text role="alert" fontSize="xs" mt={1} overflowWrap="anywhere">{error}</Text> : null}
	</Box>;
}

export const HistorySettings = (props: { user: NonNullable<CurrentUser> }) => {
	const { user } = props;
	const history = useHistoryPrefs();
	const selected = useSelectedTimelineSession();
	const [busy, setBusy] = React.useState('');
	const [exportStorage, setExportStorage] = React.useState<TimelineStorage>('home');
	const ready = history.status === 'ready';
	const selectedKey = selected.connection ? timelineScopeKey(selected.connection.scope) : '';
	const homeDiffers = !!selected.connection && selected.connection.scope.dataPlane !== 'home';
	const update = async (key: string, patch: HistoryPrefsPatch) => {
		if (busy) return;
		setBusy(key);
		// The store applies optimistically and reverts on failure; the hook reports the failure through Lopu.
		try { await history.update(patch); } catch { /* reported by the hook */ } finally { setBusy(''); }
	};
	if (!fullHistoryAccount(user)) return <SettingsSection eyebrow="History" description="History settings need a full account."><Text fontSize="sm">Sign in with a full account to manage how your Timeline syncs and records.</Text></SettingsSection>;
	const state = history.status === 'unavailable'
		? history.reason === 'origin' ? "This Thingtime doesn't support history settings yet." : 'History settings need a full account.'
		: history.status === 'error' ? (history.error || 'Could not load your history settings.') : '';
	return <SettingsSection eyebrow="History 🕰️" description="How your Timeline records, syncs and keeps changes. Nothing here deletes history.">
		<Flex flexDirection="column">
			<SettingRow label="Show messages in the timeline" hint="Notes, Lopu explanations and system lines in the History browser. This device only.">
				<Switch aria-label="Show messages in the timeline" isChecked={history.showMessages} onChange={event => history.setShowMessages(event.target.checked)} />
			</SettingRow>
			{state ? <Flex role={history.status === 'error' ? 'alert' : 'status'} align="center" gap={2} wrap="wrap" paddingY={2}>
				<Text fontSize="sm" minW={0} overflowWrap="anywhere">{state}</Text>
				{history.status === 'error' || history.reason === 'origin' ? <Button size="xs" variant="outline" onClick={() => history.retry()}>Retry</Button> : null}
			</Flex> : history.status === 'loading' ? <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" paddingY={1}>Checking your account…</Text> : null}
			<SettingRow label="Pause syncing history to my account (all devices)" hint="Changes stay on each device until you resume. Nothing is deleted.">
				<Switch aria-label="Pause syncing history to my account" isChecked={history.prefs.syncHold} isDisabled={!ready || busy === 'syncHold'} onChange={event => void update('syncHold', { syncHold: event.target.checked })} />
			</SettingRow>
			<Flex flexDirection="column" rowGap={1} paddingBottom={2}>
				<TimelineStorageProvider storage="selected"><DevicePending storage="selected" held={history.prefs.syncHold} label={homeDiffers ? ' · selected database' : ''} /></TimelineStorageProvider>
				<TimelineStorageProvider storage="home"><DevicePending storage="home" skip={selectedKey} held={history.prefs.syncHold} label=" · home account" /></TimelineStorageProvider>
			</Flex>
			<SettingRow label="Keep history" hint="Coming: nothing is deleted yet. Your choice is saved for when retention arrives.">
				<Flex role="group" aria-label="Keep history" columnGap={1} rowGap={1} flexWrap="wrap" justifyContent="flex-end">
					{HISTORY_RETENTION.map(value => <Button key={value} size="xs" variant={history.prefs.retention === value ? 'solid' : 'ghost'} aria-pressed={history.prefs.retention === value} isDisabled={!ready || !!busy} onClick={() => history.prefs.retention !== value && void update('retention', { retention: value })}>{RETENTION_LABELS[value]}</Button>)}
				</Flex>
			</SettingRow>
			<Box paddingY={2}>
				<Text fontSize="sm" color="var(--tt-ink, #16161a)">Paused Things</Text>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">Builder and definition editors stop capturing drafts for these Things on your devices. Saved versions still record. Pause a Thing from its ⋯ menu.</Text>
				{history.prefs.pausedThingIds.length ? <Flex as="ul" role="list" aria-label="Paused Things" flexDirection="column" rowGap={1} listStyleType="none" m={0} p={0} mt={2}>
					{history.prefs.pausedThingIds.map(id => <Flex as="li" key={id} align="center" gap={2} wrap="wrap" minW={0}>
						<Button as={Link} to={`/thing/${encodeURIComponent(id)}`} size="xs" variant="link" fontFamily="mono" minW={0} maxW="100%" whiteSpace="normal" textAlign="left" overflowWrap="anywhere">{id}</Button>
						<Button size="xs" variant="outline" flexShrink={0} isDisabled={!ready || !!busy} isLoading={busy === `resume:${id}`} onClick={() => void update(`resume:${id}`, { resume: [id] })}>Resume</Button>
					</Flex>)}
				</Flex> : <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" mt={2}>No paused Things.</Text>}
				{history.prefs.pausedThingIds.length >= HISTORY_PAUSED_THINGS_MAX ? <Text role="status" fontSize="xs" mt={1}>You have reached the limit of {HISTORY_PAUSED_THINGS_MAX} paused Things. Resume one to pause another.</Text> : null}
			</Box>
			<SettingRow label="Export history" hint="Exports what this device can load while connected: changes, notes and version names, newest first, to one JSON file.">
				<Flex flexDirection="column" alignItems="flex-end" rowGap={2}>
					{homeDiffers ? <Flex role="group" aria-label="Export from" columnGap={1} flexWrap="wrap" justifyContent="flex-end">
						{(['home', 'selected'] as const).map(value => <Button key={value} size="xs" variant={exportStorage === value ? 'solid' : 'ghost'} aria-pressed={exportStorage === value} onClick={() => setExportStorage(value)}>{value === 'home' ? 'Home account' : 'Selected database'}</Button>)}
					</Flex> : null}
					<TimelineStorageProvider storage={homeDiffers ? exportStorage : 'selected'}><ExportControl storage={homeDiffers ? exportStorage : 'selected'} /></TimelineStorageProvider>
				</Flex>
			</SettingRow>
		</Flex>
	</SettingsSection>;
};
