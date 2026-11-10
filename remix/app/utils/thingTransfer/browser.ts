import { decodeTransferArchive, encodeTransferArchive, transferChecksum, type TransferBundle } from './archive';
import { parseTransfer, serializeTransfer, transferAnnotations, TRANSFER_FORMAT, TRANSFER_LIMITS, TransferFormatError, validateTransfer } from './format';
import type { TransferPlan } from './plan';

const ZIP_TEXT_PREFIX = 'thingtime:zip:v1:';
export const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024;
const invalid = (message: string): never => { throw new TransferFormatError(message); };

export const bundleFromPlan = async (plan: TransferPlan, options: { key?: string; signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<TransferBundle> => {
  const manifest = validateTransfer({ format: TRANSFER_FORMAT, version: 1, roots: plan.roots, things: plan.things,
    ...(plan.links ? { links: plan.links } : {}), ...(plan.attachmentOrder ? { attachmentOrder: plan.attachmentOrder } : {}),
    files: plan.files.map((file, index) => ({ id: file.id, targetId: file.targetId, name: file.name, mime: file.mime, bytes: file.bytes, ...transferAnnotations(file),
      path: `files/${index.toString().padStart(6, '0')}`, sha256: '0'.repeat(64) })) });
  serializeTransfer(manifest);
  const files = new Map<string, Uint8Array>();
  for (const [index, entry] of plan.files.entries()) {
    options.signal?.throwIfAborted();
    if (entry.inlineBase64 !== undefined) {
      const avatar = plan.things.some(thing => thing.id === entry.targetId && thing.thingtime.length === 1 &&
        thing.thingtime[0] === 'chat-archive-participant' && thing.crystal.avatarFileId === entry.id);
      const limit = avatar ? 2 * 1024 * 1024 : 512 * 1024;
      if (typeof entry.inlineBase64 !== 'string' || entry.inlineBase64.length > Math.ceil(limit / 3) * 4 ||
        entry.sourceId !== undefined || entry.sharedRoot !== undefined || entry.bytes > limit ||
        !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(entry.mime) ||
        (!avatar && !plan.things.some(thing => thing.id === entry.targetId && thing.thingtime.length === 1 &&
          thing.thingtime[0] === 'custom-emoji' && thing.crystal.emojiFileId === entry.id))) invalid('Invalid inline image');
      let binary: string;
      try { binary = atob(entry.inlineBase64); } catch { return invalid('Invalid inline emoji encoding'); }
      if (binary.length !== entry.bytes || !binary.length || btoa(binary) !== entry.inlineBase64) invalid('Inline emoji image changed size or encoding');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      manifest.files[index].sha256 = await transferChecksum(bytes);
      files.set(entry.id, bytes);
      continue;
    }
    if (entry.sharedRoot !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(entry.sharedRoot)) invalid('Invalid file audience');
    const sourceId = entry.sourceId ?? entry.id;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(sourceId)) invalid('Invalid file source');
    const query = new URLSearchParams({ id: sourceId, download: '1' });
    if (entry.bytes <= 16 * 1024 * 1024) query.set('cache', 'bytes');
    if (entry.sharedRoot) query.set('sharedRoot', entry.sharedRoot);
    if (options.key) query.set('key', options.key);
    const response = await (options.fetch || fetch)(`/api/v1/attachments/content?${query}`, { signal: options.signal, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) invalid('A file is no longer readable; no partial export was created');
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        options.signal?.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > entry.bytes || size > TRANSFER_LIMITS.fileBytes) invalid('A file grew beyond its export limit');
        chunks.push(part.value);
      }
      if (size !== entry.bytes) invalid('A file changed size during export');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    manifest.files[index].sha256 = await transferChecksum(bytes);
    files.set(entry.id, bytes);
  }
  options.signal?.throwIfAborted();
  return { manifest, files };
};

export const transferClipboardText = async (bundle: TransferBundle, signal?: AbortSignal): Promise<string> => {
  signal?.throwIfAborted();
  if (!bundle.manifest.files.length) {
    if (bundle.files.size) invalid('The transfer contains undeclared file bytes');
    return serializeTransfer(bundle.manifest);
  }
  const estimated = bundle.manifest.files.reduce((sum, file) => sum + file.bytes, 0) + new TextEncoder().encode(serializeTransfer(bundle.manifest)).byteLength;
  if (estimated * 4 / 3 > MAX_CLIPBOARD_BYTES) invalid('This transfer is too large for the clipboard. Download a ZIP instead.');
  const bytes = await encodeTransferArchive(bundle, signal);
  if (Math.ceil(bytes.length / 3) * 4 + ZIP_TEXT_PREFIX.length > MAX_CLIPBOARD_BYTES) invalid('This transfer is too large for the clipboard. Download a ZIP instead.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  signal?.throwIfAborted();
  return ZIP_TEXT_PREFIX + btoa(binary);
};

export const readTransferClipboard = async (text: string, signal?: AbortSignal): Promise<TransferBundle> => {
  signal?.throwIfAborted();
  if (text.length > MAX_CLIPBOARD_BYTES) invalid('The clipboard transfer is too large');
  if (!text.startsWith(ZIP_TEXT_PREFIX)) {
    const manifest = parseTransfer(text);
    if (manifest.files.length) invalid('The clipboard contains a manifest without its file bytes. Import the complete ZIP.');
    return { manifest, files: new Map() };
  }
  let binary: string;
  try { binary = atob(text.slice(ZIP_TEXT_PREFIX.length)); } catch { return invalid('Invalid clipboard ZIP encoding'); }
  return decodeTransferArchive(Uint8Array.from(binary, (character) => character.charCodeAt(0)), signal);
};

/** Call directly in the user's click/key handler. ClipboardItem receives a
 * promise immediately, preserving Safari's transient user activation while
 * authorized content and files are still loading. */
export const writeTransferClipboard = (bundle: Promise<TransferBundle>, signal?: AbortSignal): Promise<string> => {
  const text = bundle.then((value) => transferClipboardText(value, signal));
  // A denied permission can settle before the export promise. Observe both.
  void text.catch(() => {});
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) return Promise.reject(new Error('Clipboard access is unavailable. Use Download instead.'));
  try {
    if (clipboard.write && typeof ClipboardItem !== 'undefined') {
      const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
      // A synchronous constructor/write failure must not leave the derived
      // promise unobserved when the pending export subsequently fails.
      void blob.catch(() => {});
      return Promise.resolve(clipboard.write([new ClipboardItem({ 'text/plain': blob })])).then(() => text);
    }
    return text.then(async (value) => {
      signal?.throwIfAborted();
      await clipboard.writeText(value);
      return value;
    });
  } catch (error) { return Promise.reject(error); }
};

export const downloadTransfer = async (bundle: TransferBundle, format: 'json' | 'zip' = 'zip', name = 'thingtime', signal?: AbortSignal) => {
  if (format === 'json' && bundle.manifest.files.length) invalid('Use ZIP to include the file bytes');
  const blob = format === 'json' ? new Blob([serializeTransfer(bundle.manifest)], { type: 'application/json' })
    : new Blob([Uint8Array.from(await encodeTransferArchive(bundle, signal))], { type: 'application/zip' });
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'thingtime'}.${format}`;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
};
