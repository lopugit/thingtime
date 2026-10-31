import type { MailAccount, MailBatch } from './model';
type MailBridge = {
	mailSyncVersion?: string;
	syncMail?: (request: unknown) => Promise<MailBatch & { ok: boolean; version: number }>;
	cancelMailSync?: (request: { requestId: string }) => Promise<unknown>;
};
function bridge(): MailBridge | undefined {
	return typeof window === 'undefined' ? undefined : (window as unknown as { thingtimeDesktop?: MailBridge }).thingtimeDesktop;
}
export function hasNativeMailSync() {
	const value = bridge();
	return /^1\.\d+\.\d+$/.test(value?.mailSyncVersion || '') && typeof value?.syncMail === 'function' && typeof value?.cancelMailSync === 'function';
}
export async function nativeMailRequest(account: MailAccount, request: Record<string, unknown>, signal: AbortSignal) {
	if (!account.sync.local || account.sync.transport !== 'native') throw new Error('Native device sync is not enabled.');
	if (!hasNativeMailSync())
		throw new Error('This app does not support direct device mail sync. Choose Thingtime API relay or a paired connector in Email settings.');
	signal.throwIfAborted();
	const host = bridge()!;
	const requestId = crypto.randomUUID();
	const bounded = AbortSignal.any([signal, AbortSignal.timeout(50000)]);
	let cancel: () => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		cancel = () => {
			void host.cancelMailSync!({ requestId }).catch(() => {});
			reject(new Error('Device mail sync was cancelled.'));
		};
		bounded.addEventListener('abort', cancel, { once: true });
	});
	try {
		const result = await Promise.race([host.syncMail!({ ...request, requestId, account }), cancelled]);
		bounded.throwIfAborted();
		if (!result?.ok || result.version !== 1) throw new Error('Incompatible native mail response.');
		return result;
	} catch {
		throw new Error(bounded.aborted ? 'Device mail sync was cancelled.' : 'Device mail sync failed. Check the server and app password, then retry.');
	} finally {
		bounded.removeEventListener('abort', cancel);
	}
}
