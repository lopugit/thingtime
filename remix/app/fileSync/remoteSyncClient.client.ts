import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { REMOTE_SYNC_SOURCE_PATH_REQUIREMENTS, validateRemoteSyncCommand, type RemoteSyncCommand } from './remoteSyncProtocol';

/** Optional display contract: older origins keep ordinary controls and explicit
 * destination selection. Callers recheck their identity after awaiting this. */
export async function negotiateRemoteSourcePaths(requireCapability = requireThingtimeCapability): Promise<boolean> {
 try {
  await requireCapability('api.devices-sync-control', REMOTE_SYNC_SOURCE_PATH_REQUIREMENTS['api.devices-sync-control']);
  return true;
 } catch { return false; }
}

type Reply = { ok: boolean; status: 'pending' | 'processing' | 'complete' | 'error' | 'expired'; result?: unknown; error?: string };
export type RemoteSyncClient = ReturnType<typeof createRemoteSyncClient>;

/** Commands keep one request identity throughout polling. A lost reply never
 * automatically replays a folder picker, restore, or transfer admission. */
export function createRemoteSyncClient(input: {
	ownerId: string; deviceId: string; origin: string; signal: AbortSignal;
	assertCurrent(): void; fetch?: typeof fetch; pollMilliseconds?: number;
	requireCapability?: typeof requireThingtimeCapability;
	storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}) {
	const fetcher = input.fetch ?? ((url, init) => window.fetch(url, init));
	const endpoint = `${input.origin}/api/v1/devices/sync-control`;
	const receiptKey = `tt-remote-sync-pending:${JSON.stringify([input.origin, input.ownerId, input.deviceId])}`;
	type Pending = { requestId: string; command: RemoteSyncCommand; createdAt: number };
	const storage = () => input.storage ?? window.localStorage;
	const pending = (key = receiptKey): Pending | null => {
		const raw = storage().getItem(key);
		if (!raw) return null;
		const value = JSON.parse(raw) as Pending;
		if (!value || typeof value.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.requestId) || !Number.isFinite(value.createdAt))
			throw Error('The pending device request needs recovery. Refresh the device status before continuing.');
		return { ...value, command: validateRemoteSyncCommand(value.command) };
	};
	const forget = (requestId: string, key = receiptKey) => { if (pending(key)?.requestId === requestId) storage().removeItem(key); };
	const mutating = (command: RemoteSyncCommand) => ['start', 'pause', 'review'].includes(command.action) ||
		(command.action === 'priorities' && command.operation === 'save') ||
		(command.action === 'folders' && ['choose', 'remove', 'trash-restore-reviewed', 'version-restore-reviewed'].includes(command.request.action));
	const check = (signal: AbortSignal) => { input.signal.throwIfAborted(); signal.throwIfAborted(); input.assertCurrent(); };
	const headers = { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': input.ownerId,
		[EXPECTED_DATA_PLANE_HEADER]: 'home', 'X-Thingtime-Expected-Api-Origin': input.origin };
	const request = async (signal: AbortSignal, requestId: string, command?: RemoteSyncCommand): Promise<Reply> => {
		check(signal);
		const response = await fetcher(command ? endpoint : `${endpoint}?${new URLSearchParams({ deviceId: input.deviceId, requestId })}`, {
			method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, signal,
			...(command ? { body: JSON.stringify({ action: 'enqueue', deviceId: input.deviceId, requestId, command }) } : {})
		});
		check(signal);
		if (response.redirected) throw Error('The sync server changed. Reopen this device’s settings.');
		let reply: Reply;
		try { reply = await response.json(); } catch { throw Error('Remote sync is unavailable. Update Thingtime on the server and device, then retry.'); }
		check(signal);
		if (!response.ok || reply?.ok !== true) throw Object.assign(Error(reply?.error || 'Remote sync could not be reached. Your saved settings remain available.'), { status: response.status });
		if (!['pending', 'processing', 'complete', 'error', 'expired'].includes(reply.status)) throw Error('The device returned an invalid sync response.');
		return reply;
	};
	return {
		async send<T = unknown>(value: RemoteSyncCommand, options: { signal?: AbortSignal; timeoutMs?: number; onPending?(): void } = {}): Promise<T> {
			const command = validateRemoteSyncCommand(value);
			// A stop must remain available even if a start confirmation was lost.
			const receiptSlot = command.action === 'pause' ? `${receiptKey}:pause:${command.connectionId}` : receiptKey;
			let requestId: string = crypto.randomUUID(), saved: Pending | null = null, dispatched = false;
			const timeout = AbortSignal.timeout(options.timeoutMs ?? 125_000);
			const signal = AbortSignal.any([input.signal, timeout, ...(options.signal ? [options.signal] : [])]);
			try {
				check(signal);
				try { await (input.requireCapability ?? requireThingtimeCapability)('api.devices-sync-control', '1.0.0'); }
				catch { throw Error('Remote sync needs an updated, reachable Thingtime server. Saved settings are still available.'); }
				check(signal);
				if (mutating(command)) {
					saved = pending(receiptSlot);
					if (saved && JSON.stringify(saved.command) !== JSON.stringify(command)) {
						let earlier: Reply | null = null;
						try { earlier = await request(signal, saved.requestId); }
						catch (cause) {
							const status = (cause as { status?: number })?.status;
							if (!(status === 409 || (status === 404 && Date.now() - saved.createdAt >= 120_000))) throw cause;
						}
						if (earlier && ['pending', 'processing'].includes(earlier.status)) throw Error('An earlier device request is still awaiting confirmation. Wait for it to finish before sending another action.');
						forget(saved.requestId, receiptSlot); saved = null;
					}
					if (saved) requestId = saved.requestId;
					else {
						const record = JSON.stringify({ requestId, command, createdAt: Date.now() });
						storage().setItem(receiptSlot, record);
						if (storage().getItem(receiptSlot) !== record) throw Error('Could not preserve the device request. Retry after freeing browser storage.');
					}
				}
				dispatched = true;
				let reply: Reply;
				try { reply = await request(signal, requestId, saved ? undefined : command); }
				catch (cause) {
					if (saved && (cause as { status?: number })?.status === 409) {
						forget(requestId, receiptSlot); throw Error('The device connection changed. Refresh its status before retrying this action.');
					}
					if (saved && (cause as { status?: number })?.status === 404) {
						if (Date.now() - saved.createdAt < 120_000) reply = await request(signal, requestId, command);
						else { forget(requestId, receiptSlot); throw Error('The earlier request has expired. Refresh the device status before starting a new request.'); }
					} else throw cause;
				}
				while (reply.status === 'pending' || reply.status === 'processing') {
					options.onPending?.();
					await new Promise<void>((resolve, reject) => {
						const abort = () => { clearTimeout(timer); reject(signal.reason); };
						const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, input.pollMilliseconds ?? 750);
						signal.addEventListener('abort', abort, { once: true });
						if (signal.aborted) abort();
					});
					check(signal); reply = await request(signal, requestId);
				}
				check(signal);
				if (mutating(command)) forget(requestId, receiptSlot);
				if (reply.status !== 'complete') throw Error(reply.error || 'The device did not confirm this request. Open Thingtime on the device and refresh its status.');
				return reply.result as T;
			} catch (cause) {
				if (timeout.aborted && !input.signal.aborted && !options.signal?.aborted)
					throw Error(command.action === 'status'
						? 'Device unavailable. Open the updated Thingtime app on this device to connect. You can still edit saved settings.'
						: 'The device has not confirmed this request yet. Refresh its status before retrying; an accepted request may still finish.');
				if (dispatched && mutating(command) && !signal.aborted && pending(receiptSlot)?.requestId === requestId)
					throw Error(`${cause instanceof Error ? cause.message : 'Device confirmation was interrupted.'} Retrying this action checks the same saved request.`);
				throw cause;
			}
		}
	};
}
