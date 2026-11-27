import { sha256 } from '@noble/hashes/sha2.js';
import { getElectronBridge } from '~/utils/electronBridge';

const CHUNK_BYTES = 256 * 1024;

export async function resolveDesktopFileUpload(ownerId: string) {
    const bridge = getElectronBridge();
    if (bridge?.attachmentUploadVersion !== '1.0.0' || !bridge.attachmentUploadRequest || !bridge.getInfo) return null;
    const info = await bridge.getInfo();
    if (!info.isPackaged || !info.apiOrigin || info.origin !== window.location.origin ||
        info.apiOrigin === info.origin || new URL(info.apiOrigin).protocol !== 'https:') return null;
    const scope = { expectedActor: ownerId, expectedApiOrigin: new URL(info.apiOrigin).origin, expectedDataPlane: 'home' };
    const invoke = bridge.attachmentUploadRequest;
    return {
        scope,
        async put(uploadId: string, partNumber: number, body: Blob, signal: AbortSignal, progress: (bytes: number) => void) {
            const hash = sha256.create();
            for (let offset = 0; offset < body.size; offset += CHUNK_BYTES) {
                signal.throwIfAborted();
                hash.update(new Uint8Array(await body.slice(offset, offset + CHUNK_BYTES).arrayBuffer()));
            }
            signal.throwIfAborted();
            const identity = { version: '1.0.0' as const, requestId: crypto.randomUUID() };
            const cancel = () => { void invoke({ ...identity, action: 'cancel' }).catch(() => {}); };
            signal.addEventListener('abort', cancel, { once: true });
            try {
                await invoke({ ...identity, action: 'open', origin: scope.expectedApiOrigin, ownerId, uploadId,
                    partNumber, length: body.size, checksum: btoa(String.fromCharCode(...hash.digest())) });
                for (let offset = 0; offset < body.size; offset += CHUNK_BYTES) {
                    signal.throwIfAborted();
                    const bytes = new Uint8Array(await body.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
                    signal.throwIfAborted();
                    await invoke({ ...identity, action: 'chunk', offset, bytes });
                    progress(offset + bytes.length);
                }
                signal.throwIfAborted();
                await invoke({ ...identity, action: 'finish' });
                signal.throwIfAborted();
            } catch (error) {
                if (!signal.aborted) cancel();
                throw error;
            } finally {
                signal.removeEventListener('abort', cancel);
            }
        }
    };
}
