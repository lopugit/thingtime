/** A native file retains its original bytes in the host. Only the requested
 * multipart range crosses the bridge; browser Files use their ordinary slices. */
type FileSource = (start: number, end: number, signal?: AbortSignal) => Promise<Blob>;
const identities = new WeakMap<File, string>();
const sources = new WeakMap<File, FileSource>();
const previews = new WeakMap<File, () => Promise<Blob | null>>();
export function createAttachmentSourceFile(metadata: { id?: string; name: string; type: string; size: number; relativePath?: string }, read: FileSource, preview?: () => Promise<Blob | null>): File {
 const file = new File([], metadata.name, { type: metadata.type || 'application/octet-stream' });
 Object.defineProperty(file, 'size', { value: metadata.size });
 Object.defineProperty(file, 'webkitRelativePath', { value: metadata.relativePath || '' });
 sources.set(file, read);
 if (metadata.id) identities.set(file, metadata.id);
 if (preview) previews.set(file, preview);
 return file;
}
export const isAttachmentSourceFile = (file: File): boolean => sources.has(file);
export async function readAttachmentSlice(file: File, start: number, end: number, signal?: AbortSignal): Promise<Blob> {
 signal?.throwIfAborted();
 const body = await (sources.get(file)?.(start, end, signal) ?? Promise.resolve(file.slice(start, end, '')));
 signal?.throwIfAborted();
 if (body.size !== end - start) throw new Error('The original shared file could not be read completely.');
 return body;
}

export const attachmentSourcePreview = (file: File): Promise<Blob | null> => previews.get(file)?.() ?? Promise.resolve(null);

export const attachmentSourceIdentity = (file: File): string => identities.get(file) || '';
