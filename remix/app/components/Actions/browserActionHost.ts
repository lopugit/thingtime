import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { actionHttpEndpoint, type PreparedBrowserAction } from '~/schemas/browserActions';
import type { BrowserActionHost } from './browserActionRuntime';
import { readActionResponse } from './actionFlowResult';
export { finishBrowserAction, readActionResponse } from './actionFlowResult';

// The browser transport uses its existing session, never a saved token, custom
// header, remote origin or redirect. The API independently checks actor identity.
export function createBrowserActionHost(actor: () => string | undefined, transport: typeof fetch = fetch, requireCapability = requireThingtimeCapability): BrowserActionHost {
	const assertIdentity = (id: string) => { if (actor() !== id) throw new Error('The active account changed. Run the action again.'); };
	const request: BrowserActionHost['request'] = async (step, id, signal) => {
		assertIdentity(id);
		if (!actionHttpEndpoint(step.method, step.path)) throw new Error('Invalid Action request destination');
		await requireCapability('api.actions-run', step.runtimeVersion || '1.7.0');
		await requireCapability(step.feature, step.minimumVersion);
		assertIdentity(id);
		signal.throwIfAborted();
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(step.query)) {
			if (value == null || value === '') continue;
			if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Query values must be text, numbers or booleans');
			query.set(key, String(value));
		}
		const response = await transport(`${step.path}${query.size ? `?${query}` : ''}`, {
			method: step.method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
			headers: { Accept: 'application/json', 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: id },
			...(step.body === undefined ? {} : { body: JSON.stringify(step.body) })
		});
		assertIdentity(id);
		const data = await readActionResponse(response, step.maxResultBytes, signal);
		assertIdentity(id);
		if (!response.ok || data?.ok === false) throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status });
		return data;
	};
	return { assertIdentity, request, prepare: async (action, inputs, id, signal) => {
		const response: any = await request({ path: '/api/v1/actions/run', method: 'POST', feature: 'api.actions-run', minimumVersion: '1.12.0', maxResultBytes: 256 * 1024, query: {}, body: { action, inputs, source: 'component', execution: 'browser', executionVersion: '1.11.0' } }, id, signal);
		if (response.status !== 'prepared') throw new Error('Use a browser Action when composing browser flows');
		return response;
	} };
}
