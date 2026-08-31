export const STALE_CHUNK_RELOAD_KEY = 'tt-chunk-reload';
export const STALE_CHUNK_GUARD_RESET_MS = 10_000;

const STALE_CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported/i;

type StaleChunkRecoveryRuntime = {
	sessionStorage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;
	reload: () => void;
	now?: () => number;
};

const browserRuntime = (): StaleChunkRecoveryRuntime | null => {
	if (typeof window === 'undefined') return null;

	try {
		return {
			sessionStorage: window.sessionStorage,
			reload: () => window.location.reload(),
			now: () => Date.now()
		};
	} catch {
		return null;
	}
};

export const isStaleChunkLoadError = (error: unknown): boolean => {
	const message = String((error as Error)?.message || error || '');
	return STALE_CHUNK_ERROR.test(message);
};

export const reloadForStaleChunk = (beforeReload?: () => void, runtime: StaleChunkRecoveryRuntime | null = browserRuntime()): boolean => {
	if (!runtime) return false;

	try {
		if (runtime.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) return false;

		runtime.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String((runtime.now ?? Date.now)()));
		beforeReload?.();
		runtime.reload();
		return true;
	} catch {
		// Storage can be unavailable in strict privacy modes. Fail closed rather
		// than risking a reload loop when no durable per-session guard exists.
		return false;
	}
};

export const clearStaleChunkReloadGuard = (runtime: StaleChunkRecoveryRuntime | null = browserRuntime()): boolean => {
	if (!runtime) return false;

	try {
		runtime.sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
		return true;
	} catch {
		return false;
	}
};

export const recoverStaleChunk = (error: unknown, runtime: StaleChunkRecoveryRuntime | null = browserRuntime()): never => {
	if (isStaleChunkLoadError(error)) reloadForStaleChunk(undefined, runtime);
	throw error;
};
