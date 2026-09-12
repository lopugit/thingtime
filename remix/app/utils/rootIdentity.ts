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
