import { randomUUID } from 'node:crypto';
import { moveManagedContent } from './managedPlacement';
import { isProtectedThingtime } from '../../../schemas/registry';
import { orderedTransferAttachments, serializeTransfer, transferAnnotations, validateTransfer, type ThingTransfer, type TransferThing } from '../../../utils/thingTransfer/format';
import { rewriteComposition } from '../actions/forkCompositionCore';
import { rewriteTransferMedia } from './transferMediaCore';
import { annotateAttachment, linkAttachment, deleteAttachment, createReadyAttachmentPostInsertHook, inspectReadyAttachmentsForPost, prepareAttachmentCascadeForThing } from '../attachments/attachments';
import { attachmentStore, commitRecordingImport } from '../attachments/attachmentStore';
import { prepareRecordingImport } from '../attachments/recordingImportCore';
import { isTransferRecording, recordingTransferFile } from '../../../utils/thingTransfer/recording';
import { createThing, deleteThing, fail, isFail, type Viewer } from './things';
import { createTransferTheme, isTransferTheme, removeTransferTheme, validateTransferTheme } from './themeTransfer';
import { createTransferAlgorithm, isTransferAlgorithm, removeTransferAlgorithm, validateTransferAlgorithm } from './algorithmTransfer';

type ImportDependencies = {
  create: typeof createThing;
  remove: typeof deleteThing;
  inspectFiles: typeof inspectReadyAttachmentsForPost;
  getFile: typeof attachmentStore.getOwned;
  bindFiles: typeof createReadyAttachmentPostInsertHook;
  uuid: () => string;
  link: typeof linkAttachment;
  annotate: typeof annotateAttachment;
  removeFile: typeof deleteAttachment;
  createTheme: typeof createTransferTheme;
  removeTheme: typeof removeTransferTheme;
  createAlgorithm: typeof createTransferAlgorithm;
  removeAlgorithm: typeof removeTransferAlgorithm;
  createRecording: typeof commitRecordingImport;
  moveRecording: typeof moveManagedContent;
  moveContent?: typeof moveManagedContent;
};
const defaults: ImportDependencies = { create: createThing, remove: deleteThing, inspectFiles: inspectReadyAttachmentsForPost, getFile: attachmentStore.getOwned, bindFiles: createReadyAttachmentPostInsertHook, uuid: randomUUID, link: linkAttachment, annotate: annotateAttachment, removeFile: deleteAttachment, createTheme: createTransferTheme, removeTheme: removeTransferTheme, createAlgorithm: createTransferAlgorithm, removeAlgorithm: removeTransferAlgorithm, createRecording: commitRecordingImport, moveRecording: moveManagedContent };
const dedicatedTransfer = (thing: TransferThing) => isTransferTheme(thing) || isTransferAlgorithm(thing) || isTransferRecording(thing);

/** Import ordering only constrains structural/provenance references. Action
 * cycles are legal: their fresh IDs are allocated before any create call.
 */
export const orderTransferImports = (manifest: ThingTransfer): TransferThing[] => {
  const remaining = new Map(manifest.things.map((thing) => [thing.id, thing]));
  const ordered: TransferThing[] = [];
  while (remaining.size) {
    const next = [...remaining.values()].find((thing) => ![thing.folderId, thing.targetId,
      ...(thing.thingtime.includes('data') && typeof thing.crystal.schemaId === 'string' ? [thing.crystal.schemaId] : [])
    ].some((id) => id && remaining.has(id)));
    if (!next) throw new Error('Circular folder, target, or schema provenance in the import');
    ordered.push(next); remaining.delete(next.id);
  }
  return ordered;
};

export const importTransfer = async (
  viewer: Viewer, input: { manifest?: unknown; files?: unknown; folderId?: unknown },
  signal?: AbortSignal, overrides: Partial<ImportDependencies> = {}
) => {
  if (!viewer?.id) return fail(401, 'Sign in to import Things');
  const deps = { ...defaults, moveContent: moveManagedContent, ...overrides };
  let manifest: ThingTransfer;
  let ordered: TransferThing[];
  try {
    manifest = validateTransfer(input.manifest);
    serializeTransfer(manifest);
    ordered = orderTransferImports(manifest);
    for (const theme of ordered.filter(thing => isTransferTheme(thing) || isTransferAlgorithm(thing))) {
      if (isTransferTheme(theme)) validateTransferTheme(theme);
      else validateTransferAlgorithm(theme);
      if (ordered.some(thing => thing.folderId === theme.id || thing.targetId === theme.id) ||
        orderedTransferAttachments(manifest).some(file => file.targetId === theme.id)) {
        throw new Error('Themes and algorithms cannot own child Things or gallery files');
      }
    }
    for (const recording of ordered.filter(isTransferRecording)) {
      recordingTransferFile(recording, manifest);
    }
  } catch (error) { return fail(400, error instanceof Error ? error.message : 'Invalid transfer'); }
  if (manifest.things.some((thing) => isProtectedThingtime(thing.thingtime) && !dedicatedTransfer(thing))) return fail(403, 'Managed account records must use their dedicated import workflow');
  if (input.folderId !== undefined && input.folderId !== null && (typeof input.folderId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.folderId))) return fail(400, 'Invalid import destination');
  const supplied = input.files === undefined ? {} : input.files;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return fail(400, 'Invalid uploaded file map');
  const fileMap = new Map(Object.entries(supplied));
  if (fileMap.size !== manifest.files.length || [...fileMap].some(([original, copied]) =>
    !manifest.files.some((file) => file.id === original) || typeof copied !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(copied)
  ) || new Set(fileMap.values()).size !== fileMap.size) return fail(400, 'Upload every file once before importing');
  const files = fileMap as Map<string, string>;
  const ids = new Map(manifest.things.map((thing) => [thing.id, deps.uuid()]));
  const created: string[] = [];
  const createdThemes = new Set<string>();
  const createdAlgorithms = new Set<string>();
  const createdRecordings = new Set<string>();
  const createdLinks: string[] = [];
  const attachments = orderedTransferAttachments(manifest);
  const suffix = deps.uuid().slice(0, 8);
  const expires = Date.now() + 120_000;
  const check = () => {
    signal?.throwIfAborted();
    if (Date.now() > expires) throw new Error('The import timed out');
  };
  try {
    for (const recording of ordered.filter(isTransferRecording)) {
      check();
      const file = recordingTransferFile(recording, manifest);
      const copied = files.get(file.id)!;
      const uploaded = await deps.getFile(viewer.id, copied);
      if (!uploaded) throw new Error('Recording upload not found');
      prepareRecordingImport(uploaded, viewer.id, file.bytes, transferAnnotations(file));
      // Embedded recording URLs use the original Thing ID, whereas archive
      // byte entries have distinct portable IDs. Both resolve to the new file.
      files.set(recording.id, copied);
      ids.set(recording.id, copied);
    }
    for (const link of manifest.links || []) {
      check();
      // Same canonical writer/quota policy as pasting a URL into a gallery.
      // It does not fetch remote bytes or grant stored-upload approval.
      const result = await deps.link(viewer.id, { url: link.url, mediaKind: link.mediaKind, purpose: 'post' });
      if (isFail(result)) throw result;
      createdLinks.push(result.attachment.id);
      files.set(link.id, result.attachment.id);
      if (link.title || link.description || link.filenamePreview) {
        check();
        const annotated = await deps.annotate(viewer.id, { id: result.attachment.id, title: link.title, description: link.description, filenamePreview: link.filenamePreview }, { unboundPostOnly: true });
        if (isFail(annotated)) throw annotated;
      }
    }
    const crystals = rewriteTransferMedia(ordered, files);
    // All uploads must be fresh, ready and owned by the real caller. Validate
    // them before the first Thing write, then the bind hook checks again in
    // the create transaction. A manifest cannot attach someone else's file.
    const inspections = new Map<string, Awaited<ReturnType<typeof deps.inspectFiles>>>();
    for (const thing of ordered) {
      check();
      if (isTransferRecording(thing)) continue;
      const bound = attachments.filter((file) => file.targetId === thing.id);
      if (!bound.length) continue;
      const inspected = await deps.inspectFiles(viewer.id, bound.map((file) => files.get(file.id)!));
      if (isFail(inspected)) throw inspected;
      for (const file of bound) {
        const uploaded = await deps.getFile(viewer.id, files.get(file.id)!);
        if (!uploaded || ('bytes' in file ? uploaded.attachmentLinked || uploaded.crystal.size !== file.bytes : !uploaded.attachmentLinked || uploaded.crystal.url !== file.url)) throw new Error('Uploaded file does not match the transfer');
      }
      inspections.set(thing.id, inspected);
    }
    for (const file of manifest.files) {
      if (ordered.some(thing => thing.id === file.targetId && isTransferRecording(thing))) continue;
      const annotations = transferAnnotations(file);
      if (!Object.keys(annotations).length) continue;
      check();
      const annotated = await deps.annotate(viewer.id, { id: files.get(file.id)!, ...annotations }, { unboundPostOnly: true });
      if (isFail(annotated)) throw annotated;
    }
    // Dedicated writers mint their own IDs. Resolve those only after file
    // validation, before rewriting references in ordinary content. Roll back
    // through that same writer if a subsequent operation fails.
    for (const theme of ordered.filter(isTransferTheme)) {
      check();
      const result = await deps.createTheme(viewer.id, theme);
      if (isFail(result)) throw result;
      ids.set(theme.id, result.theme.id);
      created.push(result.theme.id);
      createdThemes.add(result.theme.id);
    }
    for (const algorithm of ordered.filter(isTransferAlgorithm)) {
      check();
      const result = await deps.createAlgorithm(viewer.id, algorithm);
      if (isFail(result)) throw result;
      ids.set(algorithm.id, result.algorithm.id);
      created.push(result.algorithm.id);
      createdAlgorithms.add(result.algorithm.id);
    }
    for (const recording of ordered.filter(isTransferRecording)) {
      check();
      const file = recordingTransferFile(recording, manifest);
      const doc = await deps.createRecording(viewer.id, files.get(file.id)!, file.bytes, transferAnnotations(file));
      ids.set(recording.id, doc.shareId);
      created.push(doc.shareId);
      createdRecordings.add(doc.shareId);
    }
    for (const thing of ordered) {
      check();
      if (dedicatedTransfer(thing)) continue;
      const crystal = rewriteComposition(thing.thingtime, crystals.get(thing.id)!, (_kind, id) => ids.get(id) || id);
      for (const key of ['componentKey', 'actionKey', 'pageKey']) if (typeof crystal[key] === 'string') crystal[key] = `${crystal[key].slice(0, 48)}-${suffix}`;
      if (thing.thingtime.includes('schema') && typeof crystal.name === 'string') crystal.name = `${crystal.name.slice(0, 48)}-${suffix}`;
      // Import is content creation, never site publication or posting back
      // into the original community just because the source carried a route.
      if (thing.thingtime.includes('webpage')) delete crystal.siteRoute;
      if (thing.thingtime.includes('post')) { delete crystal.subspaceId; delete crystal.flairId; }
      const bound = attachments.filter((file) => file.targetId === thing.id).map((file) => files.get(file.id)!);
      const inspected = inspections.get(thing.id);
      const result = await deps.create(viewer.id, {
        shareId: ids.get(thing.id), thingtime: thing.thingtime, crystal, extended: thing.extended, tags: thing.tags,
        acl: ['tt:user'], targetId: thing.targetId ? ids.get(thing.targetId) : undefined,
        folderId: thing.folderId ? ids.get(thing.folderId) : input.folderId ?? null
      }, viewer, null, bound.length && inspected && !isFail(inspected) ? {
        postAttachments: { hasAny: inspected.hasAny, hasVisual: inspected.hasVisual }, afterInsert: deps.bindFiles(bound)
      } : {});
      if (isFail(result)) throw result;
      created.push(result.doc.shareId);
    }
    // All ordinary parent folders now exist. Placement never changes the
    // recording's immutable upload purpose or turns it into a bound gallery.
    for (const recording of ordered.filter(isTransferRecording)) {
      check();
      const destination = recording.folderId ? ids.get(recording.folderId)! : input.folderId;
      if (typeof destination === 'string' && destination) await deps.moveRecording(viewer.id, ids.get(recording.id)!, destination);
    }
    for (const thing of ordered.filter(thing => isTransferTheme(thing) || isTransferAlgorithm(thing))) {
      check();
      const destination = thing.folderId ? ids.get(thing.folderId)! : input.folderId;
      if (typeof destination === 'string' && destination) await (deps.moveContent || moveManagedContent)(viewer.id, ids.get(thing.id)!, destination);
    }
    return { ok: true as const, roots: manifest.roots.map((id) => ids.get(id)!), ids: Object.fromEntries(ids), imported: created.length, filesImported: manifest.files.length, linksImported: createdLinks.length };
  } catch (error) {
    const remaining: string[] = [];
    for (const id of [...created].reverse()) {
      try {
        if (createdRecordings.has(id)) {
          const removed = await deps.removeFile(viewer.id, { id });
          if (isFail(removed) || removed.deferred) remaining.push(id);
          continue;
        }
        const removed = createdThemes.has(id) ? await deps.removeTheme(viewer.id, id) : createdAlgorithms.has(id)
          ? await deps.removeAlgorithm(viewer.id, id) : await deps.remove(viewer, id, null, { beforeCascade: prepareAttachmentCascadeForThing });
        if (isFail(removed)) remaining.push(id);
      }
      catch { remaining.push(id); }
    }
    for (const id of createdLinks) {
      try {
        const doc = await deps.getFile(viewer.id, id);
        // Bound links belong to the Thing cascade above. Never detach a link
        // from a surviving copy whose cascade failed.
        if (doc && !doc.targetId) {
          const removed = await deps.removeFile(viewer.id, { id });
          if (isFail(removed) || removed.deferred) remaining.push(id);
        }
      } catch { remaining.push(id); }
    }
    const failure = isFail(error) ? error : fail(400, error instanceof Error ? error.message : 'Import failed');
    return { ...failure,
      ...(remaining.length ? { status: 503, error: 'Import failed and some new copies could not be cleaned up', remainingIds: remaining } : {}) };
  }
};
