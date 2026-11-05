import { parseDeviceSyncHistory, parseDeviceSyncHistoryRange, deviceSyncHistoryScopeKey, type DeviceSyncHistory, type DeviceSyncHistoryRange, type DeviceSyncHistoryScope } from './deviceSyncHistory';
import { openSyncJournal } from './journal.client';
import { rootIdentity } from '../utils/rootIdentity';
import type { RemoteSyncClient } from './remoteSyncClient.client';

// One optional current-device warning, never raw storage errors or cached
// account data. Historical rows themselves stay readable after a write failure.
let recordingIssue: { key: string; generation: number } | undefined;
export function reportDeviceSyncHistoryStorage(scope: DeviceSyncHistoryScope, available: boolean) {
	const identity = rootIdentity.read();
	if (identity.pending) return;
	const key = deviceSyncHistoryScopeKey(scope);
	if (!available) recordingIssue = { key, generation: identity.generation };
	else if (recordingIssue?.key === key) recordingIssue = undefined;
}

export function withDeviceSyncHistoryRecordingIssue(scope: DeviceSyncHistoryScope, history: DeviceSyncHistory): DeviceSyncHistory {
	const identity = rootIdentity.read();
	return recordingIssue && !identity.pending && recordingIssue.generation === identity.generation &&
		recordingIssue.key === deviceSyncHistoryScopeKey(scope) ? { ...history, recordingIssue: 'storage-unavailable' } : history;
}

export async function readDeviceSyncHistory(input: {
	scope: DeviceSyncHistoryScope; range: DeviceSyncHistoryRange; assertCurrent(): void;
	signal?: AbortSignal; remote?: RemoteSyncClient;
}) {
	const scope = structuredClone(input.scope);
	const key = deviceSyncHistoryScopeKey(scope);
	const range = parseDeviceSyncHistoryRange(input.range);
	const check = () => {
		input.signal?.throwIfAborted();
		input.assertCurrent();
		if (deviceSyncHistoryScopeKey(input.scope) !== key) throw Error('The sync history scope changed.');
	};
	check();
	if (input.remote) {
		input.remote.assertHistoryScope(scope);
		const result = await input.remote.send({ action: 'history', range }, { signal: input.signal, timeoutMs: 30_000 });
		check();
		return parseDeviceSyncHistory(result, range);
	}
	const journal = await openSyncJournal();
	try {
		check();
		const history = await journal.deviceHistory({ scope, assertCurrent: check, signal: input.signal }).read(range);
		check();
		return withDeviceSyncHistoryRecordingIssue(scope, history);
	} finally { journal.close(); }
}
