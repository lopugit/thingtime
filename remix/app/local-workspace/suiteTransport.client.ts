import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import type { InstallSuiteResult } from '../schemas/suiteInstallation';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { rootIdentity } from '../utils/rootIdentity';
import type { AccountSuiteTransport } from './accountSuites';
import { accountRemoteWorkspaceLease } from './runtime.client';
import { WorkspaceError, type WorkspaceLease, type WorkspaceScope } from './storage';

/** Suite reconciliation has its own negotiated sender. It never gates the
 * local Install transaction or shares a mutable request with another queue. */
export function accountSuiteTransport(scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease): AccountSuiteTransport {
	return {
		async install(request, signal): Promise<InstallSuiteResult> {
			lease.assertCurrent();
			if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'The account origin changed.', 409);
			const remoteLease = accountRemoteWorkspaceLease(scope);
			remoteLease.assertCurrent();
			const retired = new AbortController();
			const off = remoteLease.onInvalidate(() => retired.abort()), offLocal = lease.onInvalidate(() => retired.abort());
			try {
				const child = AbortSignal.any([signal, retired.signal]);
				if (scope.delegatedBy !== undefined) await requireThingtimeCapability('api.auth-characters', '1.0.0');
				await requireThingtimeCapability('api.webpages-suites-install', '1.7.0');
				await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
				lease.assertCurrent(); remoteLease.assertCurrent(); child.throwIfAborted();
				const response = await fetch('/api/v1/webpages/suites/install', {
					method: 'POST', credentials: 'same-origin', redirect: 'error', signal: child,
					headers: { 'content-type': 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane,
						...(scope.delegatedBy !== undefined ? { 'X-Thingtime-Character': scope.ownerId } : {}) },
					body: JSON.stringify(request)
				});
				const data = await response.json().catch(() => null);
				lease.assertCurrent(); remoteLease.assertCurrent(); child.throwIfAborted();
				if (response.status === 401 || (response.status === 409 && ['ACTOR_CHANGED', 'DATA_PLANE_CHANGED', 'WORKSPACE_CHANGED'].includes(data?.code))) {
					rootIdentity.changed();
					window.dispatchEvent(new Event('thingtime:root-data-refresh'));
					throw new WorkspaceError('WORKSPACE_CHANGED', 'Account session changed. The device suite remains in its original workspace.', 409);
				}
				if (response.status === 409 && data?.code === 'SUITE_BUNDLE_CHANGED') throw new WorkspaceError('SUITE_BUNDLE_CHANGED',
					'This saved suite version differs from the server. Its account sync needs a server that supports the saved version or an explicit version-recovery migration; updating the app alone does not change this saved request. The editable device copy and export remain available.', 409);
				if (!response.ok || !data?.ok) throw new WorkspaceError('SUITE_INSTALL_REFUSED', `Suite sync could not be confirmed (${response.status}).`, response.status);
				return data as InstallSuiteResult;
			} finally { off(); offLocal(); }
		}
	};
}
