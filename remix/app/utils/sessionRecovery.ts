/** A recovery probe reads the same contract as the root loader. A generic
 * health check, login redirect, SPA shell or unrelated JSON cannot prove that
 * the current session can be loaded. No account data is retained here. */
export const SESSION_RECOVERY_KEY = 'tt-session-recovery-reload';
const object = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
export const isSessionRootData = (value: unknown): boolean => object(value) &&
	typeof value.dataPlane === 'string' && typeof value.titlePrefix === 'string' &&
	object(value.envFromCookie) && object(value.devKitEnv) &&
	(value.dataEnvironment === null || object(value.dataEnvironment)) &&
	(value.user === null || (object(value.user) && typeof value.user.id === 'string' && value.user.id.length > 0));

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const clearSessionRecovery = () => {
	try { window.sessionStorage.removeItem(SESSION_RECOVERY_KEY); } catch { /* Storage may be unavailable. */ }
};

/** A healthy loader alone is insufficient: a descendant/effect may still fail
 * during boot. Only a stable mounted app may reset the cross-reload guard. */
export const scheduleSessionRecoveryReset = (
	clear = clearSessionRecovery,
	timers = { set: (callback: () => void, delay: number) => setTimeout(callback, delay), clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) }
) => {
	const timer = timers.set(clear, 30_000);
	return () => timers.clear(timer);
};

/** Persists only a time and counter, never a URL, account or response. Repeated
 * bootstrap failures after a healthy probe slow reloads to at most one per five
 * minutes; they never permanently disable eventual automatic recovery. */
const reloadGuard = (storage: () => Storage, now: number) => {
	let attempt = 0;
	try {
		const value: unknown = JSON.parse(storage().getItem(SESSION_RECOVERY_KEY) || 'null');
		if (object(value) && typeof value.at === 'number' && typeof value.attempt === 'number' &&
			Number.isFinite(value.at) && Number.isInteger(value.attempt) && value.attempt > 0 && value.at <= now) {
			attempt = Math.min(5, value.attempt);
			if (now - value.at < Math.min(300_000, 30_000 * 2 ** (attempt - 1))) return false;
		}
		storage().setItem(SESSION_RECOVERY_KEY, JSON.stringify({ at: now, attempt: attempt + 1 }));
	} catch {
		// Fail closed for automatic reload when a cross-navigation guard cannot
		// be saved. The user's existing manual controls remain available.
		return false;
	}
	return true;
};

export const startSessionRecovery = ({ search, storage, reload, subscribe, fetcher = fetch, now = Date.now, timeoutMs = 10_000 }: {
	search: string;
	storage: () => Storage;
	reload: () => void;
	subscribe: (key: string, listener: () => Promise<void>, interval: number, immediate: boolean) => () => void;
	fetcher?: typeof fetch;
	now?: () => number;
	timeoutMs?: number;
}) => {
	let stopped = false;
	let reloading = false;
	let pending: AbortController | undefined;
	const off = subscribe('session-error-recovery', async () => {
		if (stopped || reloading || pending) return;
		const controller = new AbortController();
		pending = controller;
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetcher(`/api/root-data${search}`, {
				method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
				headers: { Accept: 'application/json' }, signal: controller.signal
			});
			if (!response.ok || response.redirected ||
				!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) {
				await response.body?.cancel();
				throw new Error('Session unavailable');
			}
			const data: unknown = await response.json();
			if (stopped || controller.signal.aborted) return;
			if (!isSessionRootData(data)) throw new Error('Session unavailable');
			if (reloadGuard(storage, now())) {
				reloading = true;
				reload(); // Reload preserves pathname, query and fragment without replaying a mutation.
			}
		} finally {
			clearTimeout(timeout);
			if (pending === controller) pending = undefined;
		}
	}, 5_000, true);
	return () => {
		stopped = true;
		off();
		pending?.abort();
	};
};
