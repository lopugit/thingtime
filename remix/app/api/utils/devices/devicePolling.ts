import { setTimeout as delay } from 'node:timers/promises';

/** Internal resource budgets; these do not limit queued commands or event history. */
export type DeviceOperationOptions = { signal?: AbortSignal; deadlineAt?: number };
export const assertDeviceOperation = (options: DeviceOperationOptions = {}) => {
	options.signal?.throwIfAborted();
	if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
		throw new DOMException('Device operation timed out.', 'TimeoutError');
	}
};
export const deviceMongoOptions = (options: DeviceOperationOptions = {}) => {
	assertDeviceOperation(options);
	return {
		...(options.signal ? { signal: options.signal } : {}),
		timeoutMS: Math.max(1, Math.min(5_000, (options.deadlineAt ?? Infinity) - Date.now()))
	};
};
export const pauseDevicePolling = async (milliseconds: number, options: DeviceOperationOptions = {}) => {
	assertDeviceOperation(options);
	await delay(Math.max(1, Math.min(milliseconds, (options.deadlineAt ?? Infinity) - Date.now())), undefined, { signal: options.signal });
	assertDeviceOperation(options);
};

/** A collision requires a fresh authorized read, never an unbounded recursive retry. */
export const retryDeviceSnapshot = async <T>(write: () => Promise<T>, options: DeviceOperationOptions = {}): Promise<T | null> => {
	for (let attempt = 0; attempt < 3; attempt++) {
		assertDeviceOperation(options);
		try { return await write(); }
		catch (error: any) {
			if (error?.code !== 11000 && error?.status !== 409 && error?.message !== 'device_snapshot_race') throw error;
			if (attempt === 2) return null;
			await pauseDevicePolling(10 * (attempt + 1), options);
		}
	}
	return null;
};
