import React from 'react';
import { TransferSpeedTrackers, type TransferSpeedTrackersProps } from './TransferSpeedTrackers';
import type { ForegroundSyncProgress } from '~/fileSync/foregroundSync';
import { parseSyncProgressDescriptor, projectSyncProgress, type SyncProgressDescriptor, type SyncProgressSource, type SyncProgressState } from '~/fileSync/progressProjection';
import { createJournalSyncProgressSource } from '~/fileSync/progressProjection.client';
import type { SyncScope } from '~/fileSync/reconcile';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { syncProgressBlocks, syncProgressDisplay, type SyncProgressBranch } from './syncProgressBlocks';

export type SyncProgressViewerProps = {
	scopeKey: string; series?: TransferSpeedTrackersProps['series']; descriptor?: SyncProgressDescriptor | null; progress?: ForegroundSyncProgress;
	currentScope(): SyncScope; status?: SyncProgressState; message?: string;
	accountTransport?: SettingsDocumentHostProps['accountTransport'];
	/** Isolated fixtures may supply bounded synthetic metadata. */
	source?: SyncProgressSource;
};
const MAX_OPEN_BRANCHES = 8;
export function SyncProgressViewer(props: SyncProgressViewerProps) {
	const parsed = React.useMemo(() => { try { return { descriptor: props.descriptor ? parseSyncProgressDescriptor(props.descriptor) : null, invalid: false }; }
		catch { return { descriptor: null, invalid: true }; } }, [props.descriptor]);
	return <SyncProgressSession key={`${props.scopeKey}:${parsed.descriptor?.run.id ?? 'indexing'}`} {...props} descriptor={parsed.descriptor}
		invalidDescriptor={parsed.invalid} />;
}
function SyncProgressSession({ scopeKey, series, descriptor, progress, currentScope, status = 'running', message, accountTransport, source: suppliedSource, invalidDescriptor }: SyncProgressViewerProps & { invalidDescriptor?: boolean }) {
	const scopeRef = React.useRef(currentScope); scopeRef.current = currentScope;
	const progressRef = React.useRef(progress); progressRef.current = progress;
	const source = React.useMemo(() => suppliedSource || (descriptor ? createJournalSyncProgressSource(descriptor, () => scopeRef.current()) : null), [descriptor, suppliedSource]);
	const [branches, setBranches] = React.useState<Record<string, SyncProgressBranch>>({ '': { history: [], busy: false } });
	const [focusedFolder, setFocusedFolder] = React.useState('');
	const focusRef = React.useRef(focusedFolder); focusRef.current = focusedFolder;
	const latest = React.useRef(branches); latest.current = branches;
	const requests = React.useRef(new Map<string, AbortController>());
	const read = React.useCallback(async (parent: string, history?: (string | null)[]) => {
		if (!source) return;
		requests.current.get(parent)?.abort();
		const controller = new AbortController(); requests.current.set(parent, controller);
		const trail = history ?? latest.current[parent]?.history ?? [];
		setBranches(previous => ({ ...previous, [parent]: { ...previous[parent], history: trail, busy: true, error: '' } }));
		try {
			const page = await projectSyncProgress(source, { parent, after: trail.at(-1) ?? null, activePath: progressRef.current?.path, signal: controller.signal });
			if (!controller.signal.aborted) setBranches(previous => {
				if (!previous[parent]) return previous;
				return { ...previous, [parent]: { page, history: trail, busy: false } };
			});
		} catch (error) {
			if (!controller.signal.aborted) setBranches(previous => ({ ...previous, [parent]: { ...previous[parent], history: trail, busy: false,
				error: error instanceof RangeError ? error.message : 'Saved hierarchy is unavailable. The last displayed totals are preserved. Retry progress or resume sync; older completed metadata may have been cleaned up.' } }));
		} finally { if (requests.current.get(parent) === controller) requests.current.delete(parent); }
	}, [source]);
	React.useEffect(() => {
		void read(focusRef.current); const pending = requests.current;
		return () => { for (const request of pending.values()) request.abort(); pending.clear(); };
	}, [read]);
	const lastRead = React.useRef(Date.now());
	const stage = progress?.stage, confirmed = progress?.confirmed;
	React.useEffect(() => {
		if (!source || !stage) return;
		// Byte events update display immediately. Durable totals refresh at most
		// every thirty seconds, plus the final state, rather than rescanning per byte.
		const delay = ['complete', 'retained'].includes(stage) ? 0 : Math.max(0, 30_000 - (Date.now() - lastRead.current));
		const timer = setTimeout(() => {
			lastRead.current = Date.now();
			const final = ['complete', 'retained'].includes(stage);
			for (const parent of Object.keys(latest.current)) if (final || !requests.current.has(parent)) void read(parent);
		}, delay);
		return () => clearTimeout(timer);
	}, [source, read, confirmed, stage]);
	const navigate = async (parent: string, history: (string | null)[]) => {
		for (const [path, request] of requests.current) if (path !== parent && (!parent || path.startsWith(`${parent}/`))) { request.abort(); requests.current.delete(path); }
		setBranches(previous => Object.fromEntries(Object.entries(previous).filter(([path]) => path === parent || (parent && !path.startsWith(`${parent}/`)))));
		await read(parent, history);
	};
	const focus = async (path: string) => {
		for (const request of requests.current.values()) request.abort(); requests.current.clear();
		setFocusedFolder(path);
		setBranches(previous => ({ ...(previous[''] ? { '': previous[''] } : {}), [path]: { history: [], busy: false } }));
		await read(path, []);
	};
	const visibleFolder = (path: unknown): path is string => typeof path === 'string' &&
		Object.values(latest.current).some(branch => branch.page?.rows.some(row => row.path === path && row.kind === 'folder'));
	const actions = {
		refresh: async () => { for (const parent of Object.keys(latest.current)) await read(parent); },
		root: () => focus(''),
		up: () => focus(focusRef.current.split('/').slice(0, -1).join('/')),
		open: async ({ inputs }: { inputs: Readonly<Record<string, string | number | boolean>> }) => { if (visibleFolder(inputs.path)) await focus(inputs.path); },
		toggle: async ({ inputs }: { inputs: Readonly<Record<string, string | number | boolean>> }) => {
			if (!visibleFolder(inputs.path)) return;
			const path = inputs.path;
			if (latest.current[path]) {
				for (const [parent, request] of requests.current) if (parent === path || parent.startsWith(`${path}/`)) { request.abort(); requests.current.delete(parent); }
				setBranches(previous => Object.fromEntries(Object.entries(previous).filter(([parent]) => parent !== path && !parent.startsWith(`${path}/`))));
			} else {
				if (Object.keys(latest.current).filter(path => path !== '' && path !== focusRef.current).length >= MAX_OPEN_BRANCHES) {
					const current = focusRef.current;
					setBranches(previous => ({ ...previous, [current]: { ...previous[current], error: 'Use Open folder to explore deeper, or collapse an open folder. Up to eight expanded branches stay in memory.' } })); return;
				}
				await read(path, []);
			}
		},
		previous: async ({ inputs }: { inputs: Readonly<Record<string, string | number | boolean>> }) => {
			if (typeof inputs.parent !== 'string') return;
			const branch = latest.current[inputs.parent]; if (branch?.history.length && !branch.busy) await navigate(inputs.parent, branch.history.slice(0, -1));
		},
		next: async ({ inputs }: { inputs: Readonly<Record<string, string | number | boolean>> }) => {
			if (typeof inputs.parent !== 'string') return;
			const branch = latest.current[inputs.parent]; if (branch?.page?.next && !branch.busy) await navigate(inputs.parent, [...branch.history, branch.page.next]);
		}
	};
	const displayBranches = invalidDescriptor ? { ...branches, '': { ...branches[''], error: 'Saved sync progress metadata is invalid. Resume sync to read its current journal.' } } : branches;
	return <><SettingsDocumentHost documentKey="file-sync-progress" defaultDocument={syncProgressBlocks} scopeKey={scopeKey} title="File sync progress" accountTransport={accountTransport}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={syncProgressDisplay(displayBranches, progress, status, !!source, message, focusedFolder)} actions={actions} enabled={!editing}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost><TransferSpeedTrackers scopeKey={scopeKey} stage={progress?.stage} state={status === 'running' && progress?.stage === 'complete' ? 'complete' : status} series={series} accountTransport={accountTransport} /></>;
}
