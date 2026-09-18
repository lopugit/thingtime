import type { LoaderFunctionArgs } from 'react-router';
import { RootDataUnavailableError } from './rootDataRecovery';
import type { createRootIdentityState } from './rootIdentity';

/** Retain only this tab's current route, never a persistent session cache.
 * A failed background read must not unmount editors or stop the poller.
 * Navigation, identity changes and authoritative failures discard the fallback.
 */
export const createRootDataLoader = <T>(
	load: (args: LoaderFunctionArgs) => Promise<T>,
	identity: ReturnType<typeof createRootIdentityState>
) => {
	let previous: { url: string; generation: number; data: T } | undefined;
	let latest = 0;
	identity.subscribe(() => {
		if (identity.read().pending) previous = undefined;
	});
	return async (args: LoaderFunctionArgs): Promise<T> => {
		const { request } = args;
		const generation = identity.read().generation;
		const operation = ++latest;
		if (previous?.url !== request.url || previous?.generation !== generation) previous = undefined;
		const assertCurrent = () => {
			request.signal.throwIfAborted();
			if (operation !== latest || identity.read().generation !== generation) {
				throw new DOMException('Session changed during refresh', 'AbortError');
			}
		};
		try {
			const data = await load(args);
			assertCurrent();
			previous = { url: request.url, generation, data };
			return data;
		} catch (error) {
			assertCurrent();
			if (error instanceof RootDataUnavailableError && error.retryable && previous && !identity.read().pending) {
				return previous.data;
			}
			previous = undefined;
			throw error;
		}
	};
};
