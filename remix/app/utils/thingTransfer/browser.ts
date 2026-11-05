import { binaryBlob, type TransferBinary } from './binary';
import { decodeTransferArchiveBlob, encodeTransferArchive, encodeTransferArchiveBlob, transferChecksum, type TransferBundle } from './archive';
import { parseTransfer, serializeTransfer, transferAnnotations, TRANSFER_FORMAT, TRANSFER_LIMITS, TransferFormatError, validateTransfer } from './format';
import type { TransferPlan } from './plan';
import { withExportDeadline } from './exportDeadline';
import { ORIGINAL_STREAM_POLICY } from './originalStreamPolicy';

const ZIP_TEXT_PREFIX = 'thingtime:zip:v1:';
export const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024;
const invalid = (message: string): never => { throw new TransferFormatError(message); };

export const bundleFromPlan = async (plan: TransferPlan, options: { key?: string; signal?: AbortSignal; fetch?: typeof fetch; originalStream?: boolean } = {}): Promise<TransferBundle<Blob>> => {
  options.signal?.throwIfAborted();
  const assertCurrent = typeof plan.assertCurrent === 'function' ? plan.assertCurrent : undefined;
  const readLocalFile = typeof plan.readLocalFile === 'function' ? plan.readLocalFile : undefined;
  const sources = structuredClone(plan.files);
  // Only negotiated pinned original streams and local Blob readers can exceed
  // the legacy remote budget. Buffered/redirecting consumers keep that budget.
  const budget = readLocalFile || options.originalStream ? {} : { maxFileBytes: TRANSFER_LIMITS.fileBytes };
  const manifest = parseTransfer(serializeTransfer(validateTransfer({ format: TRANSFER_FORMAT, version: 1, roots: plan.roots, things: plan.things,
    ...(plan.links ? { links: plan.links } : {}), ...(plan.attachmentOrder ? { attachmentOrder: plan.attachmentOrder } : {}),
    files: plan.files.map((file, index) => ({ id: file.id, targetId: file.targetId, name: file.name, mime: file.mime, bytes: file.bytes, ...transferAnnotations(file),
      path: `files/${index.toString().padStart(6, '0')}`, sha256: '0'.repeat(64) })) }), budget), budget);
  await assertCurrent?.(options.signal);
  const files = new Map<string, Blob>();
  const originalChecks: ((signal?: AbortSignal) => Promise<void>)[] = [];
  for (const [index, entry] of sources.entries()) {
    options.signal?.throwIfAborted();
    if (readLocalFile) {
      const bytes = binaryBlob(await readLocalFile(entry.id, options.signal));
      options.signal?.throwIfAborted();
      if (bytes.size !== entry.bytes) invalid('A local file changed size during export');
      manifest.files[index].sha256 = await transferChecksum(bytes, options.signal);
      files.set(entry.id, bytes);
      continue;
    }
    if (entry.inlineBase64 !== undefined) {
      const avatar = manifest.things.some(thing => thing.id === entry.targetId && thing.thingtime.length === 1 &&
        thing.thingtime[0] === 'chat-archive-participant' && thing.crystal.avatarFileId === entry.id);
      const limit = avatar ? 2 * 1024 * 1024 : 512 * 1024;
      if (typeof entry.inlineBase64 !== 'string' || entry.inlineBase64.length > Math.ceil(limit / 3) * 4 ||
        entry.sourceId !== undefined || entry.sharedRoot !== undefined || entry.bytes > limit ||
        !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(entry.mime) ||
        (!avatar && !manifest.things.some(thing => thing.id === entry.targetId && thing.thingtime.length === 1 &&
          thing.thingtime[0] === 'custom-emoji' && thing.crystal.emojiFileId === entry.id))) invalid('Invalid inline image');
      let binary: string;
      try { binary = atob(entry.inlineBase64); } catch { return invalid('Invalid inline emoji encoding'); }
      if (binary.length !== entry.bytes || !binary.length || btoa(binary) !== entry.inlineBase64) invalid('Inline emoji image changed size or encoding');
      const bytes = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))]);
      manifest.files[index].sha256 = await transferChecksum(bytes, options.signal);
      files.set(entry.id, bytes);
      continue;
    }
    if (entry.sharedRoot !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(entry.sharedRoot)) invalid('Invalid file audience');
    const sourceId = entry.sourceId ?? entry.id;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(sourceId)) invalid('Invalid file source');
    const query = new URLSearchParams({ id: sourceId, download: '1' });
    if (!options.originalStream && entry.bytes <= 16 * 1024 * 1024) query.set('cache', 'bytes');
    if (entry.sharedRoot) query.set('sharedRoot', entry.sharedRoot);
    if (options.key) query.set('key', options.key);
    const receipt = async (parent = options.signal) => withExportDeadline(async signal => {
      const selected = new URLSearchParams(query); selected.set('cache', 'validate');
      const response = await (options.fetch || fetch)(`/api/v1/attachments/content?${selected}`, { signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok || response.redirected) invalid('The original file is no longer readable');
      const value = await response.json();
      signal.throwIfAborted();
      if (value?.ok !== true || !/^[a-f0-9]{64}:original$/.test(value.cacheKey) || value.size !== entry.bytes) invalid('The original file receipt changed');
      return { cacheKey: value.cacheKey as string, size: value.size as number };
    }, parent);
    const pinned = options.originalStream ? await receipt() : null;
    const etag = pinned ? `"${pinned.cacheKey}:v1"` : null;
    if (pinned) query.set('cache', 'original-bytes');
    const streamSignal = pinned ? AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(ORIGINAL_STREAM_POLICY.totalMs)]) : options.signal;
    const response = await (options.fetch || fetch)(`/api/v1/attachments/content?${query}`, { signal: streamSignal, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
      ...(etag ? { redirect: 'error', headers: { 'If-Match': etag } } : {}) });
    if (pinned && (response.status !== 200 || response.redirected || response.headers.get('ETag') !== etag ||
      response.headers.get('Content-Length') !== String(entry.bytes) ||
      (response.headers.has('Content-Encoding') && response.headers.get('Content-Encoding') !== 'identity'))) {
      await response.body?.cancel().catch(() => {}); invalid('The original stream does not match its receipt');
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      invalid('A file is no longer readable; no partial export was created');
    }
    const reader = response.body!.getReader();
    const chunks: Blob[] = [];
    // Network frames can be arbitrarily small. Coalesce them so retained Blob
    // handles scale with file MiB rather than the number of received frames.
    const pending = new Uint8Array(Math.min(entry.bytes, 1024 * 1024));
    let pendingBytes = 0;
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    streamSignal?.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        streamSignal?.throwIfAborted();
        const part = await reader.read();
        streamSignal?.throwIfAborted();
        if (part.done) break;
        if (part.value.byteLength > entry.bytes - size) invalid('A file grew beyond its export limit');
        size += part.value.byteLength;
        for (let offset = 0; offset < part.value.byteLength;) {
          const length = Math.min(pending.length - pendingBytes, part.value.byteLength - offset);
          pending.set(part.value.subarray(offset, offset + length), pendingBytes);
          pendingBytes += length; offset += length;
          if (pendingBytes === pending.length) { chunks.push(new Blob([pending])); pendingBytes = 0; }
        }
      }
      if (size !== entry.bytes) invalid('A file changed size during export');
      if (pendingBytes) chunks.push(new Blob([pending.subarray(0, pendingBytes)]));
    } finally {
      streamSignal?.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {}); reader.releaseLock();
    }
    const bytes = new Blob(chunks);
    if (pinned) {
      const recheck = async (signal?: AbortSignal) => {
        const checkSignal = signal ? AbortSignal.any([...(options.signal ? [options.signal] : []), signal]) : options.signal;
        const current = await receipt(checkSignal); checkSignal?.throwIfAborted();
        if (current.cacheKey !== pinned.cacheKey || current.size !== pinned.size) invalid('The original file changed during export');
      };
      await recheck(); originalChecks.push(recheck);
    }
    manifest.files[index].sha256 = await transferChecksum(bytes, options.signal);
    files.set(entry.id, bytes);
  }
  options.signal?.throwIfAborted();
  await assertCurrent?.(options.signal);
  const recheck = async (signal?: AbortSignal) => {
    const check = () => { options.signal?.throwIfAborted(); signal?.throwIfAborted(); };
    check(); await assertCurrent?.(signal); check();
    for (const verify of originalChecks) { check(); await verify(signal); check(); }
  };
  return { manifest, files, ...(assertCurrent || originalChecks.length ? { assertCurrent: recheck } : {}) };
};

export const transferClipboardText = async (bundle: TransferBundle<TransferBinary>, signal?: AbortSignal): Promise<string> => {
  signal?.throwIfAborted();
  if (typeof bundle.assertCurrent === 'function') await bundle.assertCurrent(signal);
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

export const readTransferClipboard = async (text: string, signal?: AbortSignal): Promise<TransferBundle<Blob>> => {
  signal?.throwIfAborted();
  if (text.length > MAX_CLIPBOARD_BYTES) invalid('The clipboard transfer is too large');
  if (!text.startsWith(ZIP_TEXT_PREFIX)) {
    const manifest = parseTransfer(text);
    if (manifest.files.length) invalid('The clipboard contains a manifest without its file bytes. Import the complete ZIP.');
    return { manifest, files: new Map() };
  }
  let binary: string;
  try { binary = atob(text.slice(ZIP_TEXT_PREFIX.length)); } catch { return invalid('Invalid clipboard ZIP encoding'); }
  return decodeTransferArchiveBlob(new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))]), signal, { maxFileBytes: TRANSFER_LIMITS.fileBytes, maxArchiveBytes: MAX_CLIPBOARD_BYTES });
};

/** Call directly in the user's click/key handler. ClipboardItem receives a
 * promise immediately, preserving Safari's transient user activation while
 * authorized content and files are still loading. */
export const writeTransferClipboard = (bundle: Promise<TransferBundle<TransferBinary>>, signal?: AbortSignal): Promise<string> => {
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

export const downloadTransfer = async (bundle: TransferBundle<TransferBinary>, format: 'json' | 'zip' = 'zip', name = 'thingtime', signal?: AbortSignal) => {
  if (typeof bundle.assertCurrent === 'function') await bundle.assertCurrent(signal);
  if (format === 'json' && bundle.manifest.files.length) invalid('Use ZIP to include the file bytes');
  const blob = format === 'json' ? new Blob([serializeTransfer(bundle.manifest)], { type: 'application/json' })
    : await encodeTransferArchiveBlob(bundle, signal);
  signal?.throwIfAborted();
  if (typeof bundle.assertCurrent === 'function') await bundle.assertCurrent(signal);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'thingtime'}.${format}`;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
};
