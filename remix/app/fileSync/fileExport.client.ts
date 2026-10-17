import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../utils/nativeBridge';
import type { TimelineScope } from '../timeline/contract';
import { parseCloudFile, type CloudFile } from './cloudFile';

class FileExportError extends Error {
	readonly error: string;
	constructor(message: string) {
		super(message);
		this.error = message;
	}
}

export const supportsFileExport = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()) =>
	!!bridge?.isNativeWebView && /^1\.\d+\.\d+$/.test(bridge.fileExportVersion ?? '');

/** Explicit Save As of one immutable version; no sync connection or folder grant. */
export function exportFileVersion(scope: TimelineScope, input: CloudFile, signal: AbortSignal): Promise<boolean> {
	const bridge = getNativeBridge(),
		file = parseCloudFile(structuredClone(input));
	signal.throwIfAborted();
	if (!supportsFileExport(bridge) || scope.dataPlane !== 'home' || scope.apiOrigin !== window.location.origin)
		return Promise.reject(Error('Saving files is unavailable in this app version.'));
	const requestId = crypto.randomUUID();
	const identity = { requestId, ownerId: scope.ownerId, origin: scope.apiOrigin };
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			clearTimeout(timer);
			window.removeEventListener(nativeBridgeMessageEvent, receive);
			signal.removeEventListener('abort', abort);
		};
		const finish = (saved: boolean, error?: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) reject(error);
			else resolve(saved);
		};
		const cancel = () => {
			try {
				bridge!.postMessage({ type: 'file-export', payload: { ...identity, action: 'cancel' } });
			} catch {
				/* Host may have closed. */
			}
		};
		const abort = () => {
			cancel();
			finish(false, signal.reason ?? Error('Saving cancelled.'));
		};
		const receive = (event: Event) => {
			const message = (event as CustomEvent).detail,
				p = message?.payload;
			if (message?.type !== 'file-export-result' || !p || Object.entries(identity).some(([key, value]) => p[key] !== value)) return;
			if (
				p.attachmentId !== file.content.attachmentId ||
				p.version !== file.content.version ||
				p.size !== file.content.size ||
				typeof p.saved !== 'boolean'
			) {
				cancel();
				finish(false, Error('The saved file could not be verified.'));
				return;
			}
			finish(p.saved, typeof p.error === 'string' ? new FileExportError(p.error.slice(0, 240)) : undefined);
		};
		const timer = setTimeout(() => {
			cancel();
			finish(false, Error('Saving timed out. Check Files before trying again.'));
		}, 30 * 60_000);
		window.addEventListener(nativeBridgeMessageEvent, receive);
		signal.addEventListener('abort', abort, { once: true });
		try {
			bridge!.postMessage({ type: 'file-export', payload: { ...identity, action: 'save', name: file.name, content: file.content } });
		} catch (error) {
			finish(false, error);
		}
	});
}
