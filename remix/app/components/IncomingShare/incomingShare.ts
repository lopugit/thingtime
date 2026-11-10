import { capabilitySatisfies } from '../../api/utils/capabilities/capabilityContract';
import { createAttachmentSourceFile } from '../Attachments/attachmentFileSource';
export type IncomingShareSubmission = { destination: 'post' | 'message' | 'save'; operationId: string; targetId?: string | null; recoveryPayload?: string; outcomeIds?: string[] };
export type IncomingShareDraft = { id: string; accountId: string; apiOrigin: string; text: string; files: File[]; directories: string[]; submission: IncomingShareSubmission | null };
export type IncomingShareBridge = { version: string; request: (body: Record<string, unknown>) => Promise<any> };
declare global { interface Window { thingtimeShare?: IncomingShareBridge } }
export function incomingShareRequestId(search: string): string | null {
 const value = new URLSearchParams(search).get('requestId');
 return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
export async function readIncomingShare(bridge: IncomingShareBridge, requestId: string, accountId: string, origin: string, signal: AbortSignal): Promise<IncomingShareDraft> {
 if (!capabilitySatisfies(bridge.version, '1.0.0')) throw new Error('This version of the share bridge is unavailable.');
 const manifest = await bridge.request({ method: 'manifest' });
 signal.throwIfAborted();
 if (!capabilitySatisfies(manifest.version, '1.0.0') || manifest.origin !== origin || String(manifest.requestId).toLowerCase() !== requestId.toLowerCase() || !Number.isSafeInteger(manifest.maxChunkBytes) || manifest.maxChunkBytes <= 0) throw new Error('The shared item belongs to another origin or request.');
 const chunkBytes = Math.min(manifest.maxChunkBytes, 262144);
 const payload = await bridge.request({ method: 'getIncomingShare', requestId, accountId });
 signal.throwIfAborted();
 if (String(payload.id).toLowerCase() !== requestId.toLowerCase() || payload.accountId !== accountId || payload.apiOrigin !== origin || typeof payload.text !== 'string' || !Array.isArray(payload.attachments)) throw new Error('The shared item could not be verified for this account.');
 if (payload.directories !== undefined && (!Array.isArray(payload.directories) || payload.directories.some((value: unknown) => typeof value !== 'string'))) throw new Error('A shared folder has invalid metadata.');
 const ids = new Set<string>();
 const files = payload.attachments.map((item: any) => {
  if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || typeof item.type !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('A shared file has invalid metadata.');
  ids.add(item.id);
  return createAttachmentSourceFile(item, async (start, end, transferSignal) => {
   const chunks: ArrayBuffer[] = [];
   for (let offset = start; offset < end;) {
    signal.throwIfAborted(); transferSignal?.throwIfAborted();
    const length = Math.min(chunkBytes, end - offset);
    const part = await bridge.request({ method: 'read', requestId, accountId, fileId: item.id, offset, length });
    signal.throwIfAborted(); transferSignal?.throwIfAborted();
    if (typeof part.base64 !== 'string' || part.base64.length > Math.ceil(length / 3) * 4) throw new Error('The original shared file is unavailable.');
    const binary = atob(part.base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (bytes.length !== length || part.nextOffset !== offset + length) throw new Error('The shared file transfer was interrupted.');
    chunks.push(bytes.buffer as ArrayBuffer); offset += bytes.length;
   }
   return new Blob(chunks);
  }, async () => {
   signal.throwIfAborted();
   if (manifest.thumbnailMaxDimension !== 640 || manifest.thumbnailMaxBytes !== 524288) return null;
   const result = await bridge.request({ method: 'thumbnail', requestId, accountId, fileId: item.id, maxDimension: 640 });
   signal.throwIfAborted();
   if (!result) return null;
   if (result.type !== 'image/jpeg' || typeof result.base64 !== 'string' || result.base64.length > 699052) throw new Error('The shared file preview is unavailable.');
   const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));
   if (bytes.length > 524288) throw new Error('The shared file preview is unavailable.');
   return new Blob([bytes], { type: 'image/jpeg' });
  });
 });
 const submission = payload.submission;
 if (submission && (!['post', 'message', 'save'].includes(submission.destination) || typeof submission.operationId !== 'string' || (submission.recoveryPayload !== undefined && typeof submission.recoveryPayload !== 'string') || (submission.outcomeIds !== undefined && (!Array.isArray(submission.outcomeIds) || submission.outcomeIds.some((id: unknown) => typeof id !== 'string'))))) throw new Error('This share has an invalid saved submission.');
 return { id: requestId.toLowerCase(), accountId, apiOrigin: origin, text: payload.text, files, submission: submission || null, directories: payload.directories || [] };
}
