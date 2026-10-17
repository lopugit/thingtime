import {
	parseAlgorithmSelection,
	parseAlgorithmSelectionWrite,
	parseAlgorithmSelectionAcknowledgment,
	type AlgorithmSelectionWrite
} from '../api/utils/algorithms/algorithmSelectionContract';
import type { AlgorithmSelectionTransport } from './algorithmSelection';
import { parseAlgorithmWrite, parseAlgorithmWriteAcknowledgment, type AlgorithmWrite } from '../api/utils/algorithms/algorithmSyncContract';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { rootIdentity } from '../utils/rootIdentity';
import { accountRemoteWorkspaceLease } from './runtime.client';
import { readBoundedJson } from './accountTransport.client';
import { WorkspaceError, type WorkspaceScope, type WorkspaceLease } from './storage';
import { parseAccountAlgorithmSnapshot, type AccountAlgorithmTransport } from './accountAlgorithms';
/** Remote authority belongs to the current selected account/origin/plane even
 * though the algorithm content and immutable receipts live in home storage. */
export function accountAlgorithmTransport(
	scope: Extract<WorkspaceScope, { kind: 'account' }>,
	lease: WorkspaceLease
): AccountAlgorithmTransport & AlgorithmSelectionTransport {
	const request = async (
		operation: 'snapshot' | 'write' | 'selection' | 'select',
		command: AlgorithmWrite | AlgorithmSelectionWrite | undefined,
		signal: AbortSignal
	) => {
		lease.assertCurrent();
		const remote = accountRemoteWorkspaceLease(scope);
		remote.assertCurrent();
		const controller = new AbortController(),
			off = remote.onInvalidate(() => controller.abort()),
			offLocal = lease.onInvalidate(() => controller.abort());
		const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(20000)]);
		try {
			if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account origin changed.', 409);
			await requireThingtimeCapability(
				'api.algorithms-sync',
				operation === 'write' && command && 'folderId' in command ? '1.2.0' : ['selection', 'select'].includes(operation) ? '1.1.0' : '1.0.0'
			);
			await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
			lease.assertCurrent();
			remote.assertCurrent();
			combined.throwIfAborted();
			const response = await fetch('/api/v1/algorithms/sync', {
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				redirect: 'error',
				signal: combined,
				headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane },
				body: JSON.stringify({ operation, expectedOwnerId: scope.ownerId, ...(command ? { command } : {}) })
			});
			let result: any = null;
			try {
				result = await readBoundedJson(response);
			} catch (error) {
				if (response.ok) throw error;
			}
			lease.assertCurrent();
			remote.assertCurrent();
			combined.throwIfAborted();
			if (
				response.status === 401 ||
				(response.status === 409 && ['ACTOR_CHANGED', 'DATA_PLANE_CHANGED'].includes(result?.code)) ||
				(response.ok && (result?.ownerId !== scope.ownerId || result?.dataPlane !== scope.dataPlane))
			) {
				rootIdentity.changed();
				window.dispatchEvent(new Event('thingtime:root-data-refresh'));
				throw new WorkspaceError('WORKSPACE_CHANGED', 'Account confirmation changed. Device profiles remain in their original workspace.', 409);
			}
			if (!response.ok || result?.ok !== true)
				throw Object.assign(
					new WorkspaceError('ALGORITHM_SYNC_REFUSED', 'The account algorithm request could not be completed.', response.ok ? 502 : response.status),
					{ retryAfterMs: Math.min(86400000, Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000) }
				);
			if (result.storagePlane !== 'home')
				throw new WorkspaceError('INVALID_ALGORITHM_RESPONSE', 'Account algorithm storage confirmation is missing.', 502);
			return result;
		} finally {
			off();
			offLocal();
		}
	};
	return {
		selection: async (signal) => parseAlgorithmSelection((await request('selection', undefined, signal)).selection),
		select: async (raw, signal) => {
			const command = parseAlgorithmSelectionWrite(raw);
			const ack = parseAlgorithmSelectionAcknowledgment((await request('select', command, signal)).acknowledgment);
			if (ack.algorithmId !== command.algorithmId || ack.writeId !== command.writeId || ack.expectedVersion !== command.expectedVersion)
				throw new WorkspaceError('INVALID_SELECTION_ACK', 'Account algorithm selection acknowledgment changed.', 502);
			return ack;
		},
		snapshot: async (signal) => {
			const result = await request('snapshot', undefined, signal);
			if (result.complete !== true)
				throw new WorkspaceError('INCOMPLETE_ALGORITHM_SNAPSHOT', 'Account algorithm catalogue is incomplete. Device profiles are preserved.', 502);
			return parseAccountAlgorithmSnapshot(result.algorithms);
		},
		write: async (raw, signal) => {
			const command = parseAlgorithmWrite(raw),
				ack = parseAlgorithmWriteAcknowledgment((await request('write', command, signal)).acknowledgment);
			if (
				ack.id !== command.id ||
				ack.writeId !== command.writeId ||
				ack.action !== command.action ||
				ack.expectedVersion !== command.expectedVersion
			)
				throw new WorkspaceError('INVALID_ALGORITHM_ACK', 'Account algorithm acknowledgment does not match this save.', 502);
			return ack;
		}
	};
}
