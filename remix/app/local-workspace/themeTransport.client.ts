import {
	parseThemeSelection,
	parseThemeSelectionWrite,
	parseThemeSelectionAcknowledgment,
	type ThemeSelectionWrite
} from '../api/utils/themes/themeSelectionContract';
import type { ThemeSelectionTransport } from './themeSelection';
import { parseThemeWrite, parseThemeWriteAcknowledgment, type ThemeWrite } from '../api/utils/themes/themeSyncContract';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { rootIdentity } from '../utils/rootIdentity';
import { accountRemoteWorkspaceLease } from './runtime.client';
import { readBoundedJson } from './accountTransport.client';
import { WorkspaceError, type WorkspaceScope, type WorkspaceLease } from './storage';
import { parseAccountThemeSnapshot, type AccountThemeTransport } from './accountThemes';

/** Cached account theme content never authorizes a request. Every operation
 * negotiates the selected same origin and rechecks the current remote lease. */
export function accountThemeTransport(
	scope: Extract<WorkspaceScope, { kind: 'account' }>,
	lease: WorkspaceLease
): AccountThemeTransport & ThemeSelectionTransport {
	const request = async (
		operation: 'snapshot' | 'write' | 'selection' | 'select',
		command: ThemeWrite | ThemeSelectionWrite | undefined,
		signal: AbortSignal
	) => {
		lease.assertCurrent();
		const remote = accountRemoteWorkspaceLease(scope);
		remote.assertCurrent();
		const controller = new AbortController(),
			off = remote.onInvalidate(() => controller.abort());
		const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(20_000)]);
		try {
			if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account origin changed.', 409);
			await requireThingtimeCapability(
				'api.themes-sync',
				operation === 'snapshot' ? '1.4.0' : operation === 'selection' || operation === 'select' ? '1.1.0' : command && 'title' in command ? '1.4.0' : command && 'folderId' in command ? '1.3.0' : '1.0.1'
			);
			await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
			lease.assertCurrent();
			remote.assertCurrent();
			combined.throwIfAborted();
			const response = await fetch('/api/v1/themes/sync', {
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				redirect: 'error',
				signal: combined,
				headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane },
				body: JSON.stringify({
					operation,
					expectedOwnerId: scope.ownerId,
					...(command ? { command: operation === 'select' ? parseThemeSelectionWrite(command) : parseThemeWrite(command) } : {})
				})
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
				throw new WorkspaceError('WORKSPACE_CHANGED', 'Account confirmation changed. Device themes remain in their original workspace.', 409);
			}
			if (!response.ok || result?.ok !== true)
				throw Object.assign(
					new WorkspaceError('THEME_SYNC_REFUSED', 'The account theme request could not be completed.', response.ok ? 502 : response.status),
					{
						retryAfterMs: Math.min(86_400_000, Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000)
					}
				);
			if (result.storagePlane !== 'home') throw new WorkspaceError('INVALID_THEME_RESPONSE', 'Account theme storage confirmation is missing.', 502);
			return result;
		} finally {
			off();
		}
	};
	return {
		selection: async (signal) => parseThemeSelection((await request('selection', undefined, signal)).selection),
		select: async (command, signal) => parseThemeSelectionAcknowledgment((await request('select', command, signal)).acknowledgment),
		snapshot: async (signal) => {
			const result = await request('snapshot', undefined, signal);
			if (result.complete !== true)
				throw new WorkspaceError('INCOMPLETE_THEME_SNAPSHOT', 'Account theme catalogue is incomplete. Device themes are preserved.', 502);
			const rows=parseAccountThemeSnapshot(result.themes);
			if(rows.some(row=>row.title === undefined)) throw new WorkspaceError('INVALID_THEME_SNAPSHOT','Account theme title metadata is incomplete.',502);
			return rows;
		},
		write: async (command, signal) => parseThemeWriteAcknowledgment((await request('write', command, signal)).acknowledgment)
	};
}
