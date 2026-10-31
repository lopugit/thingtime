import React from 'react';
import { TransientBlockHost, type TransientBlockActions } from '~/components/Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost } from './SettingsDocumentHost';
import { chatGPTPlanBlocks } from './chatGPTPlanBlocks';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useDataPlane } from '~/hooks/useDataPlane';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { useChatGPTPlanTransfer } from './ChatGPTPlanTransfer';

const ENDPOINT = '/api/v1/ai/chatgpt-plan';
const USAGE = 'https://chatgpt.com/settings/usage';
const CAPABILITY = 'api.ai-chatgpt-plan';
const ATTEMPT_LIFETIME = 10 * 60 * 1000;
type Account = { id: string; label: string; email?: string; connected: boolean; model: string; models: { slug: string; displayName: string }[] };
type Attempt = { id: string; status: 'pending' | 'connecting' | 'connected' | 'cancelled' | 'failed'; error?: string };
type Snapshot = { available: boolean; accounts: Account[]; attempts: Attempt[]; canAuthorize: boolean; storageMode?: string };
type Pending = { id: string; url: string; expiresAt: number; status: 'pending' | 'connecting' };
// Only public account metadata is cached; authorization URLs and tokens never persist.
const snapshots = new Map<string, Snapshot>();
const acknowledged = new Set<string>();
function safeAuthorizationUrl(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Sign-in could not be prepared. Please try again.');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Sign-in could not be prepared. Please try again.');
	}
	if (
		url.origin !== 'https://auth.openai.com' ||
		url.pathname !== '/api/accounts/authorize' ||
		url.username ||
		url.password ||
		url.hash ||
		['id_token_hint', 'access_token', 'refresh_token', 'id_token'].some((name) => url.searchParams.has(name))
	)
		throw new Error('Sign-in could not be prepared securely. Please try again.');
	return url.toString();
}
function planFailure(status: number, code?: string) {
	if (status === 401) return 'Sign in to Thingtime again before managing ChatGPT accounts.';
	if (status === 403) return 'This Thingtime account cannot manage that connection. Refresh and try again.';
	if (status === 429) return 'Too many requests. Wait a moment and try again.';
	if (code === 'plan_permission_missing') return 'ChatGPT plan permission was not granted. Continue with ChatGPT to enable it.';
	return 'The ChatGPT connection could not be updated. Check that the local runtime is running, then try again.';
}

export const ChatGPTPlanSettings = () => {
	const user = useCurrentUser();
	const dataPlane = useDataPlane();
	const origin = typeof window === 'undefined' ? '' : window.location.origin;
	const scope = user && !user.temporary && user.accountKind !== 'service' ? `${origin}:${user.id}:${dataPlane || "unavailable"}` : '';
	const currentScope = React.useRef(scope);
	currentScope.current = scope;
	return scope && user ? (
		<ChatGPTPlanScope key={scope} ownerId={user.id} dataPlane={dataPlane} origin={origin} scope={scope} currentScope={currentScope} />
	) : <PlanDocument scopeKey={`${origin}:signed-out`} view={{ plan: { signedIn: false } }} actions={{}} />;
};

const ChatGPTPlanScope = ({
	ownerId,
	dataPlane,
	origin,
	scope,
	currentScope
}: {
	ownerId: string;
	dataPlane: string | null;
	origin: string;
	scope: string;
	currentScope: React.MutableRefObject<string>;
}) => {
	const lopu = useLopu();
	const [snapshot, setSnapshot] = React.useState<Snapshot | null>(() => snapshots.get(scope) ?? null);
	const [error, setError] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [pending, setPending] = React.useState<Pending | null>(null);
	const [welcome, setWelcome] = React.useState(false);
	const live = React.useRef(true);
	const generation = React.useRef(0);
	const readSequence = React.useRef(0);
	const requests = React.useRef(new Set<AbortController>());
	const pendingRef = React.useRef<Pending | null>(null);
	const busyRef = React.useRef(false);
	const capabilityReady = React.useRef(false);
	const toast = React.useRef(lopu);
	toast.current = lopu;
	const current = React.useCallback(
		() => live.current && currentScope.current === scope && window.location.origin === origin,
		[currentScope, origin, scope]
	);

	const updatePending = React.useCallback((value: Pending | null) => {
		pendingRef.current = value;
		setPending(value);
	}, []);
	const request = React.useCallback(
		async (body?: Record<string, unknown>, signal?: AbortSignal) => {
			signal?.throwIfAborted();
			if (!dataPlane) throw new Error('The active database is still being verified. Please wait for the account to finish loading.');
			const controller = new AbortController();
			const started = generation.current;
			requests.current.add(controller);
			try {
				try {
					await requireThingtimeCapability(CAPABILITY, '1.1.0');
				} catch {
					throw new Error('This Thingtime origin does not support ChatGPT plan connections yet. Update it, then retry.');
				}
				if (!current() || controller.signal.aborted || signal?.aborted || started !== generation.current) throw new DOMException('Scope changed', 'AbortError');
				capabilityReady.current = true;
				const response = await fetch(`${origin}${ENDPOINT}`, {
					method: body ? 'POST' : 'GET',
					credentials: 'same-origin',
					cache: 'no-store',
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
					headers: { Accept: 'application/json', 'X-Thingtime-Expected-User': ownerId, 'X-Thingtime-Expected-Actor': ownerId, ...(dataPlane ? { [EXPECTED_DATA_PLANE_HEADER]: dataPlane } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
					...(body ? { body: JSON.stringify(body) } : {})
				});
				const data = await response.json().catch(() => null);
				if (!current() || controller.signal.aborted || signal?.aborted || started !== generation.current) throw new DOMException('Scope changed', 'AbortError');
				if (!response.ok || !data?.ok) throw new Error(planFailure(response.status, data?.code));
				return data;
			} finally {
				requests.current.delete(controller);
			}
		},
		[current, dataPlane, origin, ownerId]
	);

	const refresh = React.useCallback(async (signal?: AbortSignal) => {
		const sequence = ++readSequence.current;
		const result = await request(undefined, signal);
		if (typeof result.available !== 'boolean' || !Array.isArray(result.accounts) || !Array.isArray(result.attempts))
			throw new Error('ChatGPT connection status is unavailable. Please retry.');
		const next: Snapshot = { available: result.available, accounts: result.accounts, attempts: result.attempts,
			canAuthorize: result.canAuthorize === true, storageMode: result.storageMode };
		if (current() && sequence === readSequence.current) {
			snapshots.set(scope, next);
			setSnapshot(next);
			setError('');
		}
		return next;
	}, [current, request, scope]);

	// Best effort on a same-account unmount. Expected-user fencing prevents a new
	// cookie identity from exercising authority on the old account's attempt.
	const cancelOnExit = React.useCallback(
		(attemptId: string) => {
			if (!dataPlane || !capabilityReady.current || currentScope.current !== scope || window.location.origin !== origin) return;
			void fetch(`${origin}${ENDPOINT}`, {
				method: 'POST',
				credentials: 'same-origin',
				keepalive: true,
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-User': ownerId, 'X-Thingtime-Expected-Actor': ownerId, ...(dataPlane ? { [EXPECTED_DATA_PLANE_HEADER]: dataPlane } : {}) },
				body: JSON.stringify({ action: 'cancel', attemptId })
			}).catch(() => {});
		},
		[currentScope, dataPlane, origin, ownerId, scope]
	);

	const stopRequests = React.useCallback(() => {
		live.current = false;
		generation.current++;
		readSequence.current++;
		for (const controller of requests.current) controller.abort();
		requests.current.clear();
		const owned = pendingRef.current;
		if (owned) cancelOnExit(owned.id);
		pendingRef.current = null;
	}, [cancelOnExit]);
	React.useEffect(() => {
		live.current = true;
		const started = ++generation.current;
		void refresh().catch((failure) => {
			if (current() && generation.current === started)
				setError(failure instanceof Error ? failure.message : 'ChatGPT connection status is unavailable.');
		});
		return stopRequests;
	}, [current, refresh, stopRequests]);

	React.useEffect(() => {
		if (!pending?.id) return;
		const id = pending.id;
		const expiresAt = pending.expiresAt;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let failures = 0;
		const poll = async () => {
			if (stopped || !current() || pendingRef.current?.id !== id) return;
			if (Date.now() >= expiresAt) {
				cancelOnExit(id);
				updatePending(null);
				setError('ChatGPT sign-in timed out. Continue with ChatGPT to start again.');
				return;
			}
			try {
				const result = await refresh();
				if (stopped || !current() || pendingRef.current?.id !== id) return;
				const attempt = result.attempts.find((item) => item.id === id);
				if (!attempt || !['pending', 'connecting'].includes(attempt.status)) {
					updatePending(null);
					if (attempt?.status === 'connected') {
						toast.current({ title: 'ChatGPT plan connected', description: 'Choose this account in Lopu’s Your providers menu.', status: 'success' });
						const key = `tt-chatgpt-plan-welcome:${scope}`;
						let seen = acknowledged.has(key);
						try {
							seen ||= localStorage.getItem(key) === '1';
						} catch {
							/* Acknowledgement is optional local UI state. */
						}
						if (!seen) setWelcome(true);
					} else if (attempt?.status !== 'cancelled') setError('ChatGPT sign-in did not complete. Continue with ChatGPT to try again.');
					return;
				}
				failures = 0;
				if (attempt.status === 'connecting') updatePending({ ...pendingRef.current!, status: 'connecting' });
			} catch (failure) {
				if (stopped || !current()) return;
				failures++;
				setError(failure instanceof Error ? failure.message : 'Connection status is temporarily unavailable.');
			}
			if (!stopped && current()) timer = setTimeout(poll, Math.min(2000 * 2 ** Math.min(failures, 3), 15000));
		};
		timer = setTimeout(poll, 1500);
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		};
	}, [pending?.id, pending?.expiresAt, cancelOnExit, current, refresh, scope, updatePending]);

	const run = async (body: Record<string, unknown>, signal: AbortSignal) => {
		if (signal.aborted) return;
		if (busyRef.current || !current()) return;
		busyRef.current = true;
		setBusy(true);
		setError('');
		readSequence.current++;
		try {
			const data = await request(body, signal);
			if (!current()) return;
			if (body.action === 'begin') {
				const id = data.result?.attemptId;
				if (typeof id !== 'string' || !id) throw new Error('Sign-in could not be prepared. Please retry.');
				try {
					updatePending({
						id,
						url: safeAuthorizationUrl(data.result?.authorizationUrl),
						expiresAt: Date.now() + ATTEMPT_LIFETIME,
						status: 'pending'
					});
				} catch (failure) {
					cancelOnExit(id);
					throw failure;
				}
			} else if (body.action === 'cancel') updatePending(null);
			else if (body.action === 'disconnect')
				toast.current({
					title: 'ChatGPT account signed out',
					status: data.result?.remoteRevoked ? 'success' : 'warning',
					description: data.result?.remoteRevoked
						? 'The account registration is saved for your next sign-in.'
						: 'Local access was cleared. Remote revocation was not confirmed; disconnect Thingtime in ChatGPT settings.',
					...(data.result?.remoteRevoked ? {} : { link: { label: 'Manage usage', href: USAGE } })
				});
			else if (body.action === 'select-model')
				toast.current({ title: 'ChatGPT model saved', description: 'Choose this account in Lopu’s Your providers menu.', status: 'success' });
			await refresh(signal);
		} catch (failure) {
			if (current() && !signal.aborted) {
				const message = failure instanceof Error ? failure.message : 'Please try again.';
				setError(message);
				toast.current({ title: 'ChatGPT connection unavailable', description: message, status: 'error' });
			}
		} finally {
			if (current()) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	};
	const acknowledge = () => {
		const key = `tt-chatgpt-plan-welcome:${scope}`;
		acknowledged.add(key);
		try {
			localStorage.setItem(key, '1');
		} catch {
			/* Storage may be disabled. */
		}
		setWelcome(false);
	};
	const transfer = useChatGPTPlanTransfer({ accounts: snapshot?.accounts || [], disabled: busy || !!pending || !snapshot?.available, request, refresh });
	const account = (id: unknown) => typeof id === 'string' ? snapshot?.accounts.find(value => value.id === id) : undefined;
	const actions: TransientBlockActions = {
		...transfer.actions,
		'plan.begin': ({ inputs, signal }) => {
			if (!snapshot?.available || !snapshot.canAuthorize || pending || (inputs.id !== undefined && !account(inputs.id))) return;
			return run({ action: 'begin', ...(inputs.id ? { id: inputs.id } : {}) }, signal);
		},
		'plan.cancel': ({ signal }) => pendingRef.current ? run({ action: 'cancel', attemptId: pendingRef.current.id }, signal) : undefined,
		'plan.open': () => {
			const attempt = pendingRef.current;
			if (current() && attempt?.status === 'pending' && attempt.expiresAt > Date.now())
				window.open(safeAuthorizationUrl(attempt.url), '_blank', 'noopener,noreferrer');
		},
		'plan.select-model': ({ inputs, value, signal }) => {
			const selected = account(inputs.id);
			if (selected?.connected && selected.models.some(model => model.slug === value))
				return run({ action: 'select-model', id: selected.id, model: value }, signal);
		},
		'plan.refresh-models': ({ inputs, signal }) => account(inputs.id)?.connected && !pending ? run({ action: 'refresh-models', id: inputs.id }, signal) : undefined,
		'plan.disconnect': ({ inputs, signal }) => account(inputs.id) && !pending ? run({ action: 'disconnect', id: inputs.id }, signal) : undefined,
		'plan.retry': async ({ signal }) => {
			try { await refresh(signal); }
			catch (failure) { if (current() && !signal.aborted) setError(failure instanceof Error ? failure.message : 'Please retry.'); }
		},
		'plan.acknowledge': acknowledge
	};
	const plan = {
		signedIn: true, available: !!snapshot?.available, unavailable: snapshot?.available === false,
		moveOnly: !!snapshot?.available && !snapshot.canAuthorize, loading: !snapshot && !error, error, busy, welcome,
		cannotBegin: busy || !snapshot?.available || !snapshot.canAuthorize || !!pending,
		cannotManage: busy || !snapshot?.available || !!pending,
		pending: !!pending, canOpen: pending?.status === 'pending',
		pendingMessage: pending?.status === 'connecting' ? 'Verifying your ChatGPT account…' : 'Sign-in is ready. Continue in your browser, then return here.',
		accounts: (snapshot?.accounts || []).map(item => ({ ...item,
			label: `${item.label || item.email || 'ChatGPT account'} · ${item.id.slice(-8)}`,
			connectionStatus: item.connected ? 'Connected' : 'Signed out',
			modelLabel: item.models.find(model => model.slug === item.model)?.displayName || '', noModels: item.models.length === 0,
			cannotChooseModel: busy || !snapshot?.available || item.models.length === 0
		}))
	};
	return <PlanDocument scopeKey={scope} view={{ plan, transfer: transfer.scope }} actions={actions}
		onError={() => { if (current()) setError('The connection could not be updated. Please retry.'); }} />;
};

function PlanDocument({ scopeKey, view, actions, onError }: {
	scopeKey: string; view: Record<string, unknown>; actions: TransientBlockActions; onError?: () => void;
}) {
	return <SettingsDocumentHost documentKey="chatgpt-plan" defaultDocument={chatGPTPlanBlocks} scopeKey={scopeKey} title="ChatGPT plan layout">
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={view} actions={actions} enabled={!editing} onError={onError}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
