/** No account data or credentials are cached here, only a refresh generation. */
export const createRootIdentityState = () => {
	let state = { generation: 0, pending: false };
	const listeners = new Set<() => void>();
	const publish = (next: typeof state) => {
		state = next;
		listeners.forEach((listener) => listener());
	};
	return {
		read: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		changed: () => publish({ generation: state.generation + 1, pending: true }),
		confirm: (generation: number) => {
			if (state.pending && state.generation === generation) publish({ ...state, pending: false });
		}
	};
};
export const rootIdentity = createRootIdentityState();

/** Same-origin tabs share cookies. Broadcast only invalidation, never profiles
 * or credentials, and never echo a received change back to the other tabs. */
export const bindRootIdentityChannel = (
	identity: ReturnType<typeof createRootIdentityState>,
	channel: Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener'>,
	refresh: () => void
) => {
	let generation = identity.read().generation;
	let receiving = false;
	const unsubscribe = identity.subscribe(() => {
		const next = identity.read().generation;
		if (next === generation) return;
		generation = next;
		if (!receiving) {
			try { channel.postMessage('identity-changed'); } catch { /* Messaging must not fail a completed login/logout. */ }
		}
	});
	const receive = (event: MessageEvent) => {
		if (event.data !== 'identity-changed') return;
		receiving = true;
		try { identity.changed(); } finally { receiving = false; }
		refresh();
	};
	channel.addEventListener('message', receive);
	return () => {
		unsubscribe();
		channel.removeEventListener('message', receive);
	};
};

const identityActions = new Set([
	'/api/v1/login',
	'/api/v1/auth/register',
	'/api/v1/auth/logout',
	'/api/v1/auth/accounts/switch',
	'/api/v1/auth/accounts/remove',
	'/api/v1/auth/accounts/assume',
	'/api/v1/auth/sso-session',
	'/api/v1/auth/passkeys/login'
]);
export const changesRootIdentity = (action: string, payload: unknown): boolean => {
	if (!identityActions.has(action) || !payload || typeof payload !== 'object') return false;
	const result = payload as { requiresOtp?: unknown; user?: unknown; ok?: unknown };
	// A password step that returns an OTP challenge has not changed accounts;
	// unmounting the form here would discard that challenge.
	return (
		result.ok !== false && result.requiresOtp !== true && (action === '/api/v1/auth/logout' || Object.prototype.hasOwnProperty.call(result, 'user'))
	);
};
