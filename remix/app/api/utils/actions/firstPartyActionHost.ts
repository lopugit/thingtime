import type { PublicUser } from '../auth/users';
import { runAction } from './execute';
import { dispatchActionRequest } from './internalActionRequest';
import { apiEndpointDocs } from '~/docs/apiDocs';
import { capabilitySatisfies } from '../capabilities/capabilityContract';
import { actionHttpEndpoint } from '~/schemas/browserActions';
import type { BrowserActionHost } from '~/components/Actions/browserActionRuntime';
import { finishBrowserAction, readActionResponse } from '~/components/Actions/actionFlowResult';
import { withTimelineMutationContext } from '../timeline/mutationContext';

// Server-only authority supplied by the authenticated chat entry point. It is
// never serialized into a program, provider prompt, tool input or tool result.
export type ResolveActionActor = () => Promise<PublicUser | null>;
type Options = { resolveActor: ResolveActionActor; isAuthorized: () => Promise<boolean>; signal?: AbortSignal };

const requireVersion = (feature: string, minimum: string) => {
	const doc = apiEndpointDocs.find((entry) => `api.${entry.id}` === feature);
	if (!doc || !capabilitySatisfies(doc.featureVersion ?? '1.0.0', minimum))
		throw new Error(`This Action requires ${feature} ${minimum}`);
};

export function createFirstPartyActionHost(actorId: string, options: Options): BrowserActionHost {
	const assertIdentity = (id: string) => {
		options.signal?.throwIfAborted();
		if (!actorId || id !== actorId) throw new Error('The Action account changed. Run the action again.');
	};
	const currentActor = async (id: string, signal: AbortSignal) => {
		assertIdentity(id);
		signal.throwIfAborted();
		if (!await options.isAuthorized()) throw new Error('Chat access changed to Ask before running. Run the Action again to confirm.');
		const user = await options.resolveActor();
		assertIdentity(id);
		signal.throwIfAborted();
		if (!user || user.id !== id || user.temporary || user.accountKind !== 'user')
			throw new Error('Running Actions requires your active first-party account session. Sign in again.');
		return user;
	};
	return {
		assertIdentity,
		prepare: async (action, inputs, id, signal) => {
			const user = await currentActor(id, signal);
			const result = await runAction({ id: user.id, username: user.username }, {
				action, inputs, source: 'component', execution: 'browser', executionVersion: '1.11.0'
			}, undefined, { firstPartyActorId: user.id, browserOnly: true });
			if (result.ok === false) throw new Error(result.error);
			if (result.status !== 'prepared') throw new Error('Use browser Actions when composing this flow');
			return result;
		},
		request: async (step, id, signal) => {
			const endpoint = actionHttpEndpoint(step.method, step.path);
			if (!endpoint)
				throw new Error(`Lopu cannot run this browser endpoint: ${step.method} ${step.path}`);
			const doc = apiEndpointDocs.find((entry) => entry.endpoint === step.path && entry.methods.some(method => method === step.method));
			if (!doc || step.feature !== `api.${doc.id}`) throw new Error('The Action capability does not match its API destination');
			requireVersion('api.actions-run', step.runtimeVersion || '1.7.0');
			requireVersion(step.feature, step.minimumVersion);
			const query = new URLSearchParams();
			for (const [key, value] of Object.entries(step.query)) {
				if (value == null || value === '') continue;
				if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Query values must be text, numbers or booleans');
				query.set(key, String(value));
			}
			await currentActor(id, signal);
			// No network I/O, cookies, bearer tokens, client headers or redirects.
			// The synthetic Request preserves the canonical body-size, JSON,
			// rate-limit, workspace ACL, quota and validation boundary.
			const request = new Request(`https://thingtime.internal${step.path}?${query}`, {
				method: step.method,
				headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.internal' },
				signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
				...(step.body === undefined ? {} : { body: JSON.stringify(step.body) })
			});
			let response: Response;
			try { response = await dispatchActionRequest(request, () => currentActor(id, signal)); }
			catch (error) { if (!(error instanceof Response)) throw error; response = error; }
			const data = await readActionResponse(response, step.maxResultBytes, request.signal);
			await currentActor(id, signal);
			if (!response.ok || data?.ok === false) throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status });
			return data;
		}
	};
}

async function executeFirstPartyAction(viewer: { id: string; username: string }, input: { action: string; inputs: Record<string, unknown> }, options: Options) {
	options.signal?.throwIfAborted();
	const user = await options.resolveActor();
	options.signal?.throwIfAborted();
	const firstParty = user?.id === viewer.id && !user.temporary && user.accountKind === 'user';
	if (!firstParty) return { ok: false as const, status: 403, error: 'Running Actions requires your active first-party account session. Sign in again.' };
	if (!await options.isAuthorized()) return { ok: false as const, status: 403, error: 'Chat access changed. Run the Action again to confirm.' };
	const prepared = await runAction(viewer, { ...input, execution: 'browser', executionVersion: '1.11.0' }, undefined,
		{ firstPartyActorId: user.id, assertAuthorized: async () => {
			options.signal?.throwIfAborted();
			const current = await options.resolveActor();
			if (!await options.isAuthorized() || current?.id !== viewer.id || current.temporary || current.accountKind !== 'user') throw new Error('Action permission or account session changed. Run the Action again.');
		} });
	if (prepared.ok === false || prepared.status !== 'prepared') return prepared;
	return finishBrowserAction(prepared, createFirstPartyActionHost(viewer.id, options));
}

export const runFirstPartyAction = (...args: Parameters<typeof executeFirstPartyAction>) =>
	withTimelineMutationContext(args[0].id, 'action', () => executeFirstPartyAction(...args));
