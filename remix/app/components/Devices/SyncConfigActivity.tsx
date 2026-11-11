import React from 'react';
import { readNativeSyncActivity, SYNC_ACTIVITY_CHANGED_EVENT, type SyncActivityCursor, type SyncActivityRecord } from '~/fileSync/syncActivity.client';
import { coalescedSyncRefresh } from '~/fileSync/coalescedSyncRefresh';
import type { SyncScope } from '~/fileSync/reconcile';
import { rootIdentity } from '~/utils/rootIdentity';
import { SyncEditorBlocks, syncButton, syncElement, syncRow, syncWhen } from './SyncEditorBlocks';
import type { SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import type { WebpageBlock } from '../Builder/webpageBlocks';

type Activity = Pick<SyncActivityRecord, 'lastActivityAt' | 'sentBytes' | 'receivedBytes'>;
const status: Record<SyncActivityRecord['status'], string> = { complete: 'Finished', waiting: 'Waiting', paused: 'Paused', error: 'Needs attention' };
const dateLabel = (value: number) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const syncActivityBytesLabel = (bytes: number | null) => {
	if (bytes === null) return 'Unavailable';
	const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
	let value = bytes, index = 0;
	while (value >= 1000 && index < units.length - 1) { value /= 1000; index++; }
	return `${value.toLocaleString(undefined, { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`;
};
export const syncActivityLastLabel = (activity?: Activity) => activity ? `Last activity: ${dateLabel(activity.lastActivityAt)}` : '';
const muted = { color: 'var(--tt-muted, #71717a)', 'font-size': '12px' };
const historyBlocks: WebpageBlock[] = [
	syncWhen('activity-summary-visible', 'activity.showSummary', [syncRow('activity-metrics', [
		syncElement('activity-latest', 'span', '{activity.last}', undefined, muted),
		syncWhen('activity-counts', 'activity.hasActivity', [
			syncElement('activity-sent', 'span', 'Sent: {activity.sent}', undefined, muted),
			syncElement('activity-received', 'span', 'Received: {activity.received}', undefined, muted)
		])
	]),
	{ ...syncButton('activity-toggle', '{activity.toggleLabel}', 'toggle', '{activity.disabled}'),
		props: { ...syncButton('activity-toggle', '', 'toggle', '{activity.disabled}').props, 'aria-expanded': '{activity.open}' } }]),
	syncWhen('activity-list-visible', 'activity.open', [
		syncElement('activity-history-error', 'p', '{activity.error}', { role: 'alert' }, muted),
		syncWhen('activity-history-error-visible', 'activity.canRetry', [syncButton('activity-history-retry', 'Retry history', 'retry', '{activity.busy}')]),
		{ id: 'activity-history-list', type: 'collection', props: { itemsPath: 'activity.rows', label: 'Sync activity history', hideSearch: true, hideSize: true, hideCount: true, size: 'all', transparent: true, empty: '{activity.empty}' }, children: [
			syncRow('activity-history-row', [
				syncElement('activity-history-date', 'span', '{item.date}'),
				syncElement('activity-history-state', 'span', '{item.state}', undefined, muted),
				syncElement('activity-history-sent', 'span', 'Sent: {item.sent}', undefined, muted),
				syncElement('activity-history-received', 'span', 'Received: {item.received}', undefined, muted)
			])
		] },
		syncWhen('activity-history-more-visible', 'activity.more', [syncButton('activity-history-more', 'More activity', 'more', '{activity.busy}')])
	])
];

export function SyncConfigActivity({ scope, scopeKey, generation, currentOrigin, accountTransport, live, remotePage }: {
	scope: SyncScope; scopeKey: string; generation: number; currentOrigin(): string;
	accountTransport?: SettingsDocumentHostProps['accountTransport']; live?: Activity;
	remotePage?(signal: AbortSignal, before?: SyncActivityCursor): Promise<{ records: SyncActivityRecord[]; next: SyncActivityCursor | null }>;
}) {
	const [records, setRecords] = React.useState<SyncActivityRecord[]>([]);
	const [next, setNext] = React.useState<SyncActivityCursor | null>(null);
	const [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false);
	const [ready, setReady] = React.useState(false), [error, setError] = React.useState('');
	const [visible, setVisible] = React.useState(false), anchor = React.useRef<HTMLDivElement>(null);
	const lifetime = React.useRef<AbortController | null>(null), pending = React.useRef<AbortSignal | null>(null);
	const load = async (before?: SyncActivityCursor) => {
		const signal = lifetime.current?.signal;
		if (!signal || signal.aborted || pending.current === signal) return;
		const currentScope = () => {
			const identity = rootIdentity.read();
			if (identity.pending || identity.generation !== generation || currentOrigin() !== scope.origin) throw Error('The active account changed.');
			return scope;
		};
		pending.current = signal; setBusy(true); setError('');
		try {
			currentScope();
			const page = await (remotePage ? remotePage(signal, before) : readNativeSyncActivity(scope, { currentScope, signal, before }));
			signal.throwIfAborted(); currentScope();
			setRecords(previous => before
				? [...new Map([...previous, ...page.records].map(row => [row.id, row])).values()]
				: [...new Map([...page.records, ...previous].map(row => [row.id, row])).values()]);
			if (before || !ready) setNext(page.next);
			setReady(true);
		} catch {
			if (!signal.aborted) setError('Could not read activity on this device.');
		} finally {
			if (pending.current === signal) pending.current = null;
			if (!signal.aborted) setBusy(false);
		}
	};
	const readRef = React.useRef(load); readRef.current = load;
	React.useEffect(() => {
		if (!anchor.current || typeof IntersectionObserver !== 'function') { setVisible(true); return; }
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' });
		observer.observe(anchor.current);
		return () => observer.disconnect();
	}, []);
	const remote = !!remotePage;
	const watching = remote || visible || open;
	React.useEffect(() => {
		if (!watching) return;
		const controller = new AbortController(); lifetime.current = controller;
		const refresh = coalescedSyncRefresh(() => readRef.current());
		refresh.request(); if (!remote) window.addEventListener(SYNC_ACTIVITY_CHANGED_EVENT, refresh.request);
		return () => {
			controller.abort(); refresh.dispose();
			window.removeEventListener(SYNC_ACTIVITY_CHANGED_EVENT, refresh.request);
		};
	}, [watching, remote]);
	const latest = live ?? records[0];
	return <div ref={anchor}>
		<SyncEditorBlocks documentKey="file-sync-config-activity" title="Sync config activity" blocks={historyBlocks} scopeKey={scopeKey} accountTransport={accountTransport}
			scope={{ activity: {
				last: syncActivityLastLabel(latest) || (ready ? 'No activity recorded on this device yet.' : ''),
				showSummary: !remotePage,
				hasActivity: !!latest, sent: syncActivityBytesLabel(latest?.sentBytes ?? null), received: syncActivityBytesLabel(latest?.receivedBytes ?? null),
				toggleLabel: open ? 'Hide activity history' : 'Activity history', open: !!remotePage || open, busy, error, canRetry: !!error, more: !!next,
				empty: error ? '' : ready ? 'No saved sync activity yet.' : 'Reading activity…',
				rows: records.map(row => ({ id: row.id, date: dateLabel(row.endedAt), state: status[row.status], sent: syncActivityBytesLabel(row.sentBytes), received: syncActivityBytesLabel(row.receivedBytes) }))
			} }}
			actions={{ toggle: () => setOpen(value => !value), retry: () => load(), more: () => next ? load(next) : undefined }} />
	</div>;
}
